-- Attendance: true range totals, and newest day first.
--
-- WHAT WAS WRONG. 20260928000000's header reasoned:
--
--   "Range is capped at 31 days (723 employees x 31 days < the 25000 row cap),
--    so the row cap can never silently truncate a legitimate report."
--
-- That checked the RPC's own `limit 25000` and missed the one that actually
-- bites: **PostgREST's `db-max-rows`, which is 1000 on this project**. It
-- truncates the response long before the function's own limit is reached.
--
-- Measured 2026-10-08 for 02-08 Oct, running this function's own body against
-- the live database. The page received 1,000 rows and had no way to know. But
-- the missing rows are the smaller half of the problem: every headline number
-- was computed IN THE BROWSER from that truncated slice, so all five were
-- wrong -- not rounded, wrong:
--
--     stat card            shown        actual
--     -----------------    ---------    ---------
--     Employee-days            1,000        3,385
--     Employees                  594          672
--     Total time on site     12,032h      34,368h
--     No OUT yet                   3          337
--     Check times                 26           70
--
-- "No OUT yet" read 3 when 337 people had an unclosed day. "Total time on
-- site" reported a third of the hours worked. And Export wrote the same
-- truncated set into a spreadsheet someone would file as a payroll record,
-- with nothing in the file to say it was partial.
--
-- WHAT THIS DOES.
--
-- 1. `get_attendance_summary()` -- a new function returning ONE row of true,
--    uncapped aggregates for the range. The browser stops deriving headline
--    numbers from the rows it happens to hold and reads them from the same
--    query that produced them. ~150 bytes on the wire, once per report run,
--    against the ~180 KB of rows already being sent: egress-neutral in
--    practice, and it is what makes the figures correct at any range size.
--
--    `row_count` is the total BEFORE any cap, so the client can say
--    "1,000 of 3,385" instead of quietly implying 1,000 is all there is.
--
-- 2. `get_attendance_report()` -- ordering flips to newest day first. A
--    report is read from the most recent day backwards; `order by 5` (date
--    ascending) meant a 7-day range opened on the oldest day and you paged
--    forward to reach today. Only the ORDER BY changes.
--
-- The summary deliberately repeats the report's CTEs verbatim rather than
-- factoring them out. Two functions reading the same scan history must agree
-- exactly, and the cheapest way to guarantee that is for the SQL to be the
-- same SQL -- a shared view would add an object whose definition could drift
-- from either caller. If one is edited, edit both; the tests compare their
-- outputs.
--
-- Gate is unchanged: is_admin_or_manager(), the same as the report.

CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  p_from date,
  p_to date,
  p_tz text DEFAULT 'Asia/Manila'
)
RETURNS TABLE(
  row_count bigint,
  employees bigint,
  worked_seconds bigint,
  open_punches bigint,
  anomalies bigint
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
    select e.id as eid,
           (l.elem->>'scanned_at')::timestamptz as at_ts,
           l.elem->>'direction' as dir,
           lead((l.elem->>'scanned_at')::timestamptz) over w as next_at,
           lead(l.elem->>'direction') over w as next_dir
    from public.employees e
    join cand c on c.id = e.id
    cross join lateral jsonb_array_elements(e.scan_logs) with ordinality as l(elem, ord)
    window w as (partition by e.id order by l.ord)
  ),
  -- One row per employee-day, exactly as the report builds them.
  days as (
    select s.eid,
           coalesce(sum(extract(epoch from (s.next_at - s.at_ts)))
                    filter (where s.next_dir = 'out' and s.next_at >= s.at_ts), 0)::bigint as worked,
           coalesce(bool_or(s.next_dir is distinct from 'out'), false) as open_punch,
           coalesce(bool_or(s.next_dir = 'out' and s.next_at < s.at_ts), false) as anomaly
    from seq s
    where s.dir = 'in'
      and s.at_ts >= v_lo
      and s.at_ts < v_report_hi
    group by s.eid, (s.at_ts at time zone p_tz)::date
  )
  select count(*)::bigint,
         count(distinct d.eid)::bigint,
         coalesce(sum(d.worked), 0)::bigint,
         count(*) filter (where d.open_punch)::bigint,
         count(*) filter (where d.anomaly)::bigint
  from days d;
end;
$function$;

-- Only the ORDER BY changes from 20260928000000. Everything else is that
-- function verbatim, so a diff between the two migrations shows one line.
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
  -- Newest day first (was `order by 5`, oldest first). PostgREST's
  -- db-max-rows truncates the TAIL, so with the old ordering a truncated
  -- report silently dropped the most recent days -- the ones anyone running
  -- an attendance report actually wants.
  order by 5 desc, s.ename
  limit 25000;
end;
$function$;

-- Count of audit_log rows, so the page can show a true total instead of
-- implying its p_limit is all there is. Scalar, admin-gated the same way
-- get_audit_log() is (which returns zero rows rather than raising).
CREATE OR REPLACE FUNCTION public.get_audit_log_count()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  select count(*)::bigint from public.audit_log where public.is_admin();
$function$;

REVOKE ALL ON FUNCTION public.get_attendance_summary(date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_summary(date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(date, date, text) TO service_role;

REVOKE ALL ON FUNCTION public.get_audit_log_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_audit_log_count() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_audit_log_count() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_log_count() TO service_role;
