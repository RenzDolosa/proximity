-- Attendance report: per-employee, per-day first IN / last OUT / worked time,
-- derived from employees.scan_logs (the authoritative IN/OUT source — see
-- trg_append_scan_log(): direction is the parity of the log's length at the
-- moment of insert, NOT a column on scan_events and NOT derived from
-- scanned_at). Read-only; no schema change, no new table.
--
-- Design notes
--  * Pairing uses the log's own sequence (WITH ORDINALITY), so a backdated
--    offline sync can't invert an IN/OUT pair the way ordering by timestamp could.
--  * A shift's OUT is paired with its IN even across midnight; the row belongs
--    to the work_date of the IN (in p_tz). The scan window is read one day past
--    p_to so a shift starting on p_to still finds its OUT.
--  * Range is capped at 31 days (723 employees x 31 days < the 25000 row cap),
--    so the row cap can never silently truncate a legitimate report.
--  * Gate: is_admin_or_manager() — same as get_all_scan_events(), since this is
--    the same per-employee scan history, aggregated.

CREATE OR REPLACE FUNCTION public.get_attendance_report(
  p_from date,
  p_to date,
  p_tz text DEFAULT 'Asia/Manila'
)
RETURNS TABLE(
  employee_id uuid,
  employee_code text,
  full_name text,
  department text,
  work_date date,
  first_in timestamptz,
  last_out timestamptz,
  in_count integer,
  worked_seconds bigint,
  open_punch boolean,
  anomaly boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_lo timestamptz;
  v_read_hi timestamptz;
  v_report_hi timestamptz;
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
  v_report_hi := (p_to + 1)::timestamp at time zone p_tz;
  v_read_hi := (p_to + 2)::timestamp at time zone p_tz;

  return query
  with cand as (
    select e.id
    from public.employees e
    where exists (
      select 1 from public.scan_events se
      where se.employee_id = e.id
        and se.result = 'matched'
        and se.scanned_at >= v_lo
        and se.scanned_at < v_read_hi
    )
  ),
  seq as (
    select e.id as eid, e.employee_code as ecode, e.full_name as ename, e.department as edept,
           (l.elem->>'scanned_at')::timestamptz as at_ts,
           l.elem->>'direction' as dir,
           lead((l.elem->>'scanned_at')::timestamptz) over w as next_at,
           lead(l.elem->>'direction') over w as next_dir
    from public.employees e
    join cand c on c.id = e.id
    cross join lateral jsonb_array_elements(e.scan_logs) with ordinality as l(elem, ord)
    window w as (partition by e.id order by l.ord)
  )
  select s.eid, s.ecode, s.ename, s.edept,
         (s.at_ts at time zone p_tz)::date,
         min(s.at_ts),
         max(s.next_at) filter (where s.next_dir = 'out'),
         count(*)::int,
         coalesce(sum(extract(epoch from (s.next_at - s.at_ts)))
                  filter (where s.next_dir = 'out' and s.next_at >= s.at_ts), 0)::bigint,
         coalesce(bool_or(s.next_dir is distinct from 'out'), false),
         coalesce(bool_or(s.next_dir = 'out' and s.next_at < s.at_ts), false)
  from seq s
  where s.dir = 'in'
    and s.at_ts >= v_lo
    and s.at_ts < v_report_hi
  group by s.eid, s.ecode, s.ename, s.edept, (s.at_ts at time zone p_tz)::date
  order by 5, s.ename
  limit 25000;
end;
$function$;

-- Project convention: new functions default to EXECUTE for PUBLIC — revoke,
-- then grant to signed-in users only (the function's own role check is the
-- real gate; this just keeps anon from even reaching it).
REVOKE ALL ON FUNCTION public.get_attendance_report(date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_report(date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_report(date, date, text) TO authenticated;
