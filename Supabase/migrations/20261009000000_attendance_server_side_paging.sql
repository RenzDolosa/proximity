-- Attendance: every row reachable, while sending fewer bytes than before.
--
-- THE TENSION. "Show all attendance rows" and "do not increase egress" look
-- like opposites: the report really holds 3,382 employee-days for a week and
-- the page was receiving 1,000 (PostgREST's db-max-rows). Fetching the other
-- 2,382 as one payload costs roughly +26 MB/month.
--
-- They are only opposites while the client does the paging. Today the browser
-- downloads 1,000 rows and shows 50 of them. Moving LIMIT/OFFSET and the
-- filters into SQL means it downloads the rows it is actually displaying:
--
--     viewing                 before        after (500/page)
--     --------------------    ----------    -----------------
--     first page only            1,000 rows        500 rows
--     two pages                  1,000             1,000
--     the whole 3,382-row set    impossible        3,382
--
-- Typical use gets cheaper, the cap disappears, and the only way to pay more
-- than before is to deliberately read data that was previously unreachable.
-- Egress becomes proportional to what someone looks at instead of a fixed
-- download whether they read it or not.
--
-- FILTERS MOVE TOO, and they have to: filtering client-side over one page
-- would filter the page rather than the report. Both functions now share the
-- same WHERE, so the headline totals describe exactly the rows the table is
-- paging through -- which also settles the awkwardness 20261008160000 left
-- behind, where the stat cards covered the whole range while the table showed
-- a filtered subset of it.
--
-- `p_status` is derived, not stored: anomaly beats open beats complete, the
-- same precedence as Utils/attendance.js's attendanceStatus(). It is applied
-- after grouping because it is a property of the assembled day, not of a scan.
--
-- Ordering stays newest-day-first (20261008160000), and is now total --
-- (work_date desc, full_name, employee_id) -- because OFFSET paging over a
-- non-deterministic order can repeat or skip a row between pages.

CREATE OR REPLACE FUNCTION public.get_attendance_report(
  p_from date,
  p_to date,
  p_tz text DEFAULT 'Asia/Manila',
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0,
  p_query text DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_status text DEFAULT NULL
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
  v_limit integer;
  v_offset integer;
  v_q text;
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

  v_limit := greatest(1, least(coalesce(p_limit, 500), 1000));
  v_offset := greatest(0, coalesce(p_offset, 0));
  v_q := nullif(btrim(coalesce(p_query, '')), '');

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
  ),
  days as (
    select s.eid, s.ecode, s.ename, s.edept,
           (s.at_ts at time zone p_tz)::date as wdate,
           min(s.at_ts) as fin,
           max(s.next_at) filter (where s.next_dir = 'out') as lout,
           count(*)::int as ins,
           coalesce(sum(extract(epoch from (s.next_at - s.at_ts)))
                    filter (where s.next_dir = 'out' and s.next_at >= s.at_ts), 0)::bigint as worked,
           coalesce(bool_or(s.next_dir is distinct from 'out'), false) as opened,
           coalesce(bool_or(s.next_dir = 'out' and s.next_at < s.at_ts), false) as anom
    from seq s
    where s.dir = 'in'
      and s.at_ts >= v_lo
      and s.at_ts < v_report_hi
    group by s.eid, s.ecode, s.ename, s.edept, (s.at_ts at time zone p_tz)::date
  )
  select d.eid, d.ecode, d.ename, d.edept, d.wdate, d.fin, d.lout, d.ins, d.worked, d.opened, d.anom
  from days d
  where (v_q is null
         or d.ename ilike '%' || v_q || '%'
         or d.ecode ilike '%' || v_q || '%')
    and (nullif(p_department, '') is null or coalesce(d.edept, '') = p_department)
    and (nullif(p_status, '') is null
         or p_status = (case when d.anom then 'anomaly' when d.opened then 'open' else 'complete' end))
  -- Total order: OFFSET paging over ties can repeat or skip rows between pages.
  order by d.wdate desc, d.ename, d.eid
  limit v_limit offset v_offset;
end;
$function$;

-- Same filters, so the headline totals describe exactly the rows the table is
-- paging through. row_count is the filtered total, uncapped — it is what the
-- pagination counts against.
CREATE OR REPLACE FUNCTION public.get_attendance_summary(
  p_from date,
  p_to date,
  p_tz text DEFAULT 'Asia/Manila',
  p_query text DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_status text DEFAULT NULL
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
  v_q text;
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

  v_q := nullif(btrim(coalesce(p_query, '')), '');
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
  ),
  days as (
    select s.eid, s.ecode, s.ename, s.edept,
           coalesce(sum(extract(epoch from (s.next_at - s.at_ts)))
                    filter (where s.next_dir = 'out' and s.next_at >= s.at_ts), 0)::bigint as worked,
           coalesce(bool_or(s.next_dir is distinct from 'out'), false) as opened,
           coalesce(bool_or(s.next_dir = 'out' and s.next_at < s.at_ts), false) as anom
    from seq s
    where s.dir = 'in'
      and s.at_ts >= v_lo
      and s.at_ts < v_report_hi
    group by s.eid, s.ecode, s.ename, s.edept, (s.at_ts at time zone p_tz)::date
  ),
  filtered as (
    select * from days d
    where (v_q is null
           or d.ename ilike '%' || v_q || '%'
           or d.ecode ilike '%' || v_q || '%')
      and (nullif(p_department, '') is null or coalesce(d.edept, '') = p_department)
      and (nullif(p_status, '') is null
           or p_status = (case when d.anom then 'anomaly' when d.opened then 'open' else 'complete' end))
  )
  -- Precedence matters, and 20261008160000 got it wrong: it counted every
  -- `opened` day, including ones that are also anomalies, while the status
  -- filter and Utils/attendance.js's attendanceStatus() both treat anomaly as
  -- beating open. The stat card and "filter by No OUT yet" must agree, so the
  -- counts here are mutually exclusive the same way the labels are.
  select count(*)::bigint,
         count(distinct f.eid)::bigint,
         coalesce(sum(f.worked), 0)::bigint,
         count(*) filter (where f.opened and not f.anom)::bigint,
         count(*) filter (where f.anom)::bigint
  from filtered f;
end;
$function$;

-- Every department present in the range, so the filter dropdown no longer
-- depends on whatever happened to be in the first page of rows. A handful of
-- short strings.
CREATE OR REPLACE FUNCTION public.get_attendance_departments(
  p_from date,
  p_to date,
  p_tz text DEFAULT 'Asia/Manila'
)
RETURNS TABLE(department text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_lo timestamptz;
  v_read_hi timestamptz;
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to view attendance';
  end if;
  if p_from is null or p_to is null then
    raise exception 'from and to dates are required';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_tz) then
    raise exception 'unknown time zone';
  end if;

  v_lo := p_from::timestamp at time zone p_tz;
  v_read_hi := (p_to + 2)::timestamp at time zone p_tz;

  return query
  select distinct e.department
  from public.employees e
  where e.department is not null and e.department <> ''
    and exists (
      select 1 from public.scan_events se
      where se.employee_id = e.id
        and se.result = 'matched'
        and se.scanned_at >= v_lo
        and se.scanned_at < v_read_hi
    )
  order by 1;
end;
$function$;

-- The 3-argument forms are gone: PostgREST resolves by argument name, and
-- leaving the old overloads in place would let a stale client silently keep
-- calling the unpaged version.
DROP FUNCTION IF EXISTS public.get_attendance_report(date, date, text);
DROP FUNCTION IF EXISTS public.get_attendance_summary(date, date, text);

REVOKE ALL ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_attendance_departments(date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_departments(date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_departments(date, date, text) TO authenticated;
