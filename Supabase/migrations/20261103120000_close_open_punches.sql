-- Review and close the days where someone scanned IN and never scanned OUT.
--
-- Measured on the live project 2026-11-03: 382 of 3,345 employee-days in a
-- one-week window carry open_punch. Those days have no computable hours, so
-- HR either guesses them or chases them by hand.
--
-- WHY THIS MATTERS MORE THAN 382 BAD ROWS. Direction is parity over an
-- employee's whole history (employees.scan_parity_count, see
-- 20261001040000). A missing OUT leaves that employee's parity one step out
-- for *every scan after it*, so the next morning's arrival is stored as an
-- OUT. get_attendance_report() builds its days with `where s.dir = 'in'`, so
-- a day whose first scan is mislabelled OUT is not under-counted — it is
-- dropped from the report entirely. One missed tap-out can therefore hide
-- every subsequent day for that person. Closing the gap re-derives the rest
-- (20261024090000 made the trigger re-sort and re-label by time), which is
-- why this is a repair and not a cosmetic tidy-up.
--
-- THE CLOSING RULE, chosen by the operator: close at the last scan recorded
-- at the SAME scanner on the SAME day. It is evidence from the site rather
-- than an assumption about shifts, it can never land in the future, and it
-- is explainable to the person whose hours it changes.
--
-- COST: one read when the queue is opened, one write for a whole batch.
-- Nothing polls. No change to egress or log ingestion in steady state.

-- 1. The preview. Everything the reviewer needs to decide, including WHY a
--    day cannot be closed, so a blocked row is visible rather than absent.
CREATE OR REPLACE FUNCTION public.get_open_punch_closures(
  p_from date,
  p_to date,
  p_tz text DEFAULT 'Asia/Manila',
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  employee_id uuid,
  employee_code text,
  full_name text,
  department text,
  work_date date,
  open_in_at timestamptz,
  scanner_id text,
  proposed_out_at timestamptz,
  blocked_reason text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_lo timestamptz;
  v_hi timestamptz;
  v_today date;
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to view attendance';
  end if;
  if p_from is null or p_to is null then
    raise exception 'from and to dates are required';
  end if;
  if p_to < p_from then
    raise exception 'to date must not be before from date';
  end if;
  if p_to - p_from > 30 then
    raise exception 'date range too large (max 31 days)';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'unknown time zone';
  end if;

  v_lo := p_from::timestamp at time zone p_tz;
  v_hi := (p_to + 1)::timestamp at time zone p_tz;
  v_today := (now() at time zone p_tz)::date;

  return query
  with seq as (
    select e.id as eid, e.employee_code as ecode, e.full_name as ename,
           e.department as edept,
           (l.elem->>'scanned_at')::timestamptz as at_ts,
           l.elem->>'direction' as dir,
           l.elem->>'scanner_id' as sid,
           lead(l.elem->>'direction') over w as next_dir
      from public.employees e
      cross join lateral jsonb_array_elements(e.scan_logs) with ordinality as l(elem, ord)
     window w as (partition by e.id order by l.ord)
  ),
  open_ins as (
    -- The IN with nothing following it, or followed by another IN. Same test
    -- get_attendance_report() uses for open_punch, so the queue and the
    -- report can never disagree about which days are open.
    select s.eid, s.ecode, s.ename, s.edept, s.at_ts, s.sid,
           (s.at_ts at time zone p_tz)::date as wdate
      from seq s
     where s.dir = 'in'
       and s.next_dir is distinct from 'out'
       and s.at_ts >= v_lo
       and s.at_ts < v_hi
  )
  select o.eid, o.ecode, o.ename, o.edept, o.wdate, o.at_ts, o.sid,
         c.last_at,
         case
           when o.wdate >= v_today then 'still today'
           when c.last_at is null then 'no later scan at this scanner'
           else null
         end
    from open_ins o
    left join lateral (
      -- The site's own last scan that day, strictly after the open IN. Read
      -- from scan_events rather than scan_logs: scan_logs holds only this
      -- employee's scans, and the whole point is to use the SITE as evidence.
      select max(se.scanned_at) as last_at
        from public.scan_events se
       where se.scanner_id = o.sid
         and se.scanned_at > o.at_ts
         and (se.scanned_at at time zone p_tz)::date = o.wdate
    ) c on true
   order by o.wdate desc, o.ename, o.eid
   limit greatest(1, least(coalesce(p_limit, 500), 1000))
  offset greatest(0, coalesce(p_offset, 0));
end;
$function$;

-- 2. The write. Takes only (employee_id, work_date) pairs and recomputes the
--    closing time server-side — a client-supplied timestamp would be a way to
--    write arbitrary hours into payroll through a reviewed-looking UI.
CREATE OR REPLACE FUNCTION public.close_open_punches(
  p_closures jsonb,
  p_tz text DEFAULT 'Asia/Manila'
)
RETURNS TABLE(
  employee_id uuid,
  work_date date,
  closed_at timestamptz,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_item jsonb;
  v_eid uuid;
  v_date date;
  v_today date;
  v_in_at timestamptz;
  v_sid text;
  v_out_at timestamptz;
  v_code text;
  v_card uuid;
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to change attendance';
  end if;
  if jsonb_typeof(p_closures) <> 'array' then
    raise exception 'closures must be an array';
  end if;
  if jsonb_array_length(p_closures) > 500 then
    raise exception 'too many closures in one call (max 500)';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'unknown time zone';
  end if;

  v_today := (now() at time zone p_tz)::date;

  for v_item in select * from jsonb_array_elements(p_closures)
  loop
    v_eid := (v_item->>'employee_id')::uuid;
    v_date := (v_item->>'work_date')::date;
    v_in_at := null; v_sid := null; v_out_at := null;

    -- Never close a day that is still running: the person may be on site.
    if v_date >= v_today then
      return query select v_eid, v_date, null::timestamptz, 'skipped: still today';
      continue;
    end if;

    select s.at_ts, s.sid into v_in_at, v_sid
      from (
        select (l.elem->>'scanned_at')::timestamptz as at_ts,
               l.elem->>'direction' as dir,
               l.elem->>'scanner_id' as sid,
               lead(l.elem->>'direction') over (order by l.ord) as next_dir
          from public.employees e
          cross join lateral jsonb_array_elements(e.scan_logs) with ordinality as l(elem, ord)
         where e.id = v_eid
      ) s
     where s.dir = 'in'
       and s.next_dir is distinct from 'out'
       and (s.at_ts at time zone p_tz)::date = v_date
     order by s.at_ts
     limit 1;

    -- Re-checked here, not taken on trust from the preview: the queue may
    -- have been open in a browser tab while someone else fixed the same day.
    if v_in_at is null then
      return query select v_eid, v_date, null::timestamptz, 'skipped: no longer open';
      continue;
    end if;

    select max(se.scanned_at) into v_out_at
      from public.scan_events se
     where se.scanner_id = v_sid
       and se.scanned_at > v_in_at
       and (se.scanned_at at time zone p_tz)::date = v_date;

    if v_out_at is null then
      return query select v_eid, v_date, null::timestamptz, 'skipped: no later scan at this scanner';
      continue;
    end if;

    select e.employee_code, e.proximity_card_id into v_code, v_card
      from public.employees e where e.id = v_eid;

    begin
      insert into public.scan_events
        (proximity_code, employee_id, proximity_card_id, scanner_id, result, scanned_at, raw_payload)
      values (
        coalesce((select pc.proximity_code from public.proximity_cards pc where pc.id = v_card), v_code),
        v_eid, v_card, v_sid, 'matched', v_out_at,
        jsonb_build_object(
          'auto_closed', true,
          'close_rule', 'site_last_scan',
          'closed_by', auth.uid(),
          -- Deterministic, so re-running the same closure collides with
          -- scan_events_request_id_key (20261023070023) instead of writing a
          -- second OUT. Idempotency for free, from machinery already here.
          'request_id', md5(v_eid::text || ':' || v_date::text)::uuid
        )
      );
    exception when unique_violation then
      return query select v_eid, v_date, v_out_at, 'skipped: already closed';
      continue;
    end;

    perform public.log_audit_event(
      'attendance_day_closed', 'employee', v_eid::text,
      jsonb_build_object('work_date', v_date, 'closed_at', v_out_at,
                         'scanner_id', v_sid, 'rule', 'site_last_scan')
    );

    return query select v_eid, v_date, v_out_at, 'closed';
  end loop;
end;
$function$;

REVOKE ALL ON FUNCTION public.get_open_punch_closures(date, date, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_open_punch_closures(date, date, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_open_punch_closures(date, date, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_open_punch_closures(date, date, text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.close_open_punches(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_open_punches(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_open_punches(jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_open_punches(jsonb, text) TO service_role;

NOTIFY pgrst, 'reload schema';
