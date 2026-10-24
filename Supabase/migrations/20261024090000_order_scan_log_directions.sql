-- IN/OUT direction is assigned by INSERT order. It should follow TIME order.
--
-- THE BUG, from a real scan log (10 Oct, one employee):
--
--   05:55 IN    08:32 OUT    08:45 OUT  <-- OUT after OUT
--   08:47 IN    08:47 IN   <-- IN after IN
--   11:01 OUT   11:46 OUT  <-- OUT after OUT
--   ... 11:46 IN, OUT, IN, OUT, 11:47 IN, 20:44 IN
--
-- trg_append_scan_log() appends to employees.scan_logs and stamps
--   direction := case when scan_parity_count % 2 = 0 then 'in' else 'out' end
-- at the moment the scan_events row is INSERTED. The Scan Logs dialog, the
-- Attendance report and the on-site roster all read that stored direction
-- while ordering rows by scanned_at. Those two orders agree only while scans
-- arrive in the order they happened.
--
-- On a slow or intermittent link they do not. StandaloneScanner.doScan() sends
-- a live scan immediately, and only afterwards notices a backlog and flushes
-- the offline queue. So a scan taken at 08:47 is inserted FIRST and takes the
-- earlier parity, and a scan captured at 08:45 is replayed SECOND and takes the
-- later one. Sorted by time, the pair reads OUT, OUT. Every "repeat" above is
-- one of these; the perfectly alternating 11:46 burst is a different fault
-- (duplicate submissions), addressed by 20261023070023.
--
-- This is not cosmetic. get_attendance_report() pairs IN->OUT with
-- `lead(direction) over (order by scanned_at)`, so a flipped pair silently
-- changes hours worked, and get_onsite_roster_delta() decides who is on site
-- from `last_log ->> 'direction' = 'in'`.
--
-- A client-side fix (drain the queue before sending a live scan, shipped
-- alongside this) removes the common case but cannot remove all of it: 74
-- employees scan at both sites, so a queued scan replaying from one kiosk can
-- always interleave with a live scan on another. Ordering has to be settled
-- where the rows actually meet, which is here.
--
-- COST: no new requests, so no egress and no log-ingestion change. The fast
-- path below is the same single UPDATE it always was.

-- 1. Splice an out-of-order scan into its place in time, and re-derive every
--    direction after it.
--
-- Inserting a scan in the middle of a history flips the parity of everything
-- that follows it, which is exactly what re-deriving does. The first retained
-- entry's direction is preserved as the anchor rather than recomputed: older
-- entries may have been trimmed (trim_employee_scan_logs keeps 180 days), so
-- the array alone cannot say what parity the history started on.
CREATE OR REPLACE FUNCTION public.trg_append_scan_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_logs jsonb;
  v_last_at timestamptz;
  v_entry jsonb;
  v_count integer;
  v_base integer;
  v_next_parity integer;
begin
  if new.employee_id is null or new.result <> 'matched' then
    return new;
  end if;

  select scan_logs, scan_parity_count into v_logs, v_count
    from public.employees where id = new.employee_id for update;

  v_logs := coalesce(v_logs, '[]'::jsonb);
  v_last_at := (v_logs -> -1 ->> 'scanned_at')::timestamptz;

  v_entry := jsonb_build_object(
    'scan_id', new.id,
    'proximity_code', new.proximity_code,
    'scanner_id', new.scanner_id,
    'scanned_at', new.scanned_at,
    'result', new.result,
    'direction', case when v_count % 2 = 0 then 'in' else 'out' end,
    'offline', coalesce((new.raw_payload->>'captured_offline')::boolean, false)
  );

  -- FAST PATH, and still the overwhelmingly common one: this scan is the
  -- newest, so appending is already in time order and the stamped direction is
  -- correct. Identical work to the pre-2026-10-24 trigger.
  if v_last_at is null or new.scanned_at >= v_last_at then
    update public.employees
       set scan_logs = v_logs || jsonb_build_array(v_entry),
           scan_parity_count = v_count + 1
     where id = new.employee_id;
    return new;
  end if;

  -- SLOW PATH: a backdated arrival. Re-sort by scanned_at and re-derive.
  -- `ordinality` breaks ties so two scans in the same second keep the order
  -- they were inserted in, which is the only evidence available for them.
  v_base := case when (v_logs -> 0 ->> 'direction') = 'out' then 1 else 0 end;

  select coalesce(jsonb_agg(
           (e.value - 'direction') || jsonb_build_object(
             'direction',
             case when (v_base + e.pos - 1) % 2 = 0 then 'in' else 'out' end
           ) order by e.pos
         ), '[]'::jsonb)
    into v_logs
    from (
      select value,
             row_number() over (
               order by (value ->> 'scanned_at')::timestamptz, ord
             ) as pos
        from jsonb_array_elements(v_logs || jsonb_build_array(v_entry))
               with ordinality as t(value, ord)
    ) e;

  -- Keep scan_parity_count consistent with what the array now says, so the
  -- next in-order scan alternates from the real last entry rather than from a
  -- count that the re-derive may have put out of phase. Still monotonic.
  v_next_parity := case when (v_logs -> -1 ->> 'direction') = 'in' then 1 else 0 end;
  v_count := v_count + 1;
  if v_count % 2 <> v_next_parity then
    v_count := v_count + 1;
  end if;

  update public.employees
     set scan_logs = v_logs,
         scan_parity_count = v_count
   where id = new.employee_id;

  return new;
end;
$function$;

-- 2. One-time repair of histories already written out of order.
--
-- Scoped to employees whose scan_logs are actually mis-ordered, so this
-- rewrites as few rows as possible: every rewrite bumps employees.updated_at,
-- which costs one roster delta and one kiosk cache delta per affected row.
-- A one-off cost, not an ongoing one.
WITH disordered AS (
  SELECT e.id,
         CASE WHEN e.scan_logs -> 0 ->> 'direction' = 'out' THEN 1 ELSE 0 END AS base,
         e.scan_logs
    FROM public.employees e
   WHERE jsonb_array_length(coalesce(e.scan_logs, '[]'::jsonb)) > 1
     -- "some entry is older than the one stored before it" — one pass with
     -- lag(), rather than a max() over every earlier entry per entry.
     AND EXISTS (
       SELECT 1
         FROM (
           SELECT (value ->> 'scanned_at')::timestamptz AS at,
                  lag((value ->> 'scanned_at')::timestamptz) OVER (ORDER BY ord) AS prev
             FROM jsonb_array_elements(e.scan_logs) WITH ORDINALITY AS t(value, ord)
         ) s
        WHERE s.at < s.prev
     )
), fixed AS (
  SELECT d.id,
         coalesce(jsonb_agg(
           (r.value - 'direction') || jsonb_build_object(
             'direction', CASE WHEN (d.base + r.pos - 1) % 2 = 0 THEN 'in' ELSE 'out' END
           ) ORDER BY r.pos
         ), '[]'::jsonb) AS logs
    FROM disordered d
    CROSS JOIN LATERAL (
      SELECT value,
             row_number() OVER (ORDER BY (value ->> 'scanned_at')::timestamptz, ord) AS pos
        FROM jsonb_array_elements(d.scan_logs) WITH ORDINALITY AS t(value, ord)
    ) r
   GROUP BY d.id, d.base
)
UPDATE public.employees e
   SET scan_logs = f.logs,
       -- Re-phase the counter against the repaired array, as the trigger does.
       scan_parity_count = e.scan_parity_count
         + CASE WHEN e.scan_parity_count % 2
                     <> CASE WHEN f.logs -> -1 ->> 'direction' = 'in' THEN 1 ELSE 0 END
                THEN 1 ELSE 0 END
  FROM fixed f
 WHERE e.id = f.id;
