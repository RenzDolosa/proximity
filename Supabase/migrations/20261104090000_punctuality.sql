-- Punctuality: who arrives late, measured against a configured shift start.
--
-- WHY THIS IS NOT DERIVABLE TODAY. Every attendance figure in this system is
-- descriptive -- "this person was here for 8h 14m". None is normative, because
-- nothing anywhere records what time they were SUPPOSED to arrive. So the
-- report can tell you a person worked a short day but not that they turned up
-- an hour late, and those are different conversations.
--
-- COST. Zero new requests. AttendancePage already calls
-- get_attendance_summary() and get_attendance_report() on every load; this
-- adds columns to both rather than a third call. Classification happens
-- server-side, so the shift times never have to reach the browser for the
-- report to be correct -- the client renders numbers it is handed.
--
-- Measured payload cost: two columns per report row (late boolean,
-- first_in_offset_minutes integer) is ~20 bytes of JSON, so ~1 KB on a 50-row
-- page, plus ~45 bytes on the one-row summary.
--
-- NO INVENTED BASELINE. The default is NULL, not 07:00. A guessed shift start
-- would silently label hundreds of people late against a time nobody chose,
-- and a wrong punctuality figure is worse than no punctuality figure because
-- it looks authoritative. With no rule configured the columns come back null
-- and the panel says so.

CREATE TABLE public.shift_rules (
  -- '*' is the fallback applied to any department without its own row. A
  -- sentinel rather than a nullable column because it keeps the primary key
  -- doing the deduplication: there can be exactly one default, by
  -- construction, with no partial unique index to get wrong.
  department text PRIMARY KEY,
  starts_at time NOT NULL,
  -- Minutes after starts_at that still count as on time. Separate from
  -- starts_at because "the shift starts at 07:00 and we don't quibble under
  -- five minutes" is two facts, and folding them into one time (06:55) would
  -- misreport the shift start everywhere it is displayed.
  grace_minutes integer NOT NULL DEFAULT 0 CHECK (grace_minutes >= 0 AND grace_minutes <= 240),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

-- RLS on, deliberately with no policies. Every read and write below goes
-- through a SECURITY DEFINER function that checks is_admin() or
-- is_admin_or_manager() itself, so there is no reason for a client to hold a
-- direct grant on the table -- and no policy to review when the rules change.
-- (The rls_auto_enable event trigger would do this anyway; stated explicitly
-- so the intent is readable here rather than inferred from a trigger.)
ALTER TABLE public.shift_rules ENABLE ROW LEVEL SECURITY;

-- Resolves the rule that applies to a department: its own row if it has one,
-- otherwise the '*' default, otherwise nothing.
--
-- `order by (r.department = '*')` sorts false before true in Postgres, so the
-- specific row wins over the default without needing a CASE.
CREATE FUNCTION public.shift_rule_for(p_department text)
RETURNS TABLE(starts_at time, grace_minutes integer)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT r.starts_at, r.grace_minutes
    FROM public.shift_rules r
   WHERE r.department = coalesce(p_department, '')
      OR r.department = '*'
   ORDER BY (r.department = '*')
   LIMIT 1;
$function$;

-- ---------------------------------------------------------------------------
-- get_attendance_report: + late, + first_in_offset_minutes
--
-- Adding columns to a RETURNS TABLE needs DROP then CREATE. The argument
-- signature is byte-identical, so no client changes and no stale-overload
-- problem of the kind 20261009000000 had to clean up. New columns go at the
-- END, and PostgREST returns objects keyed by name, so nothing that reads the
-- existing ten columns can be affected by position.
--
-- READ THIS BEFORE APPLYING -- it is the one residual risk in this file.
--
-- The companion migration (20261104093000) deliberately does NOT replace
-- scan_proximity_code(), because this repo cannot see whether the live copy
-- has un-migrated changes. The two functions below are a DROP plus CREATE, so
-- the same hazard applies to them in principle. The reason it is accepted here
-- and not there:
--
--   * get_attendance_report()/get_attendance_summary() have a complete
--     migration history in this directory (20260928000000 -> 20261008160000 ->
--     20261009000000) and are NOT in test/schema-drift.test.mjs's
--     KNOWN_MISSING_FUNCTIONS. scan_proximity_code() is explicitly recorded in
--     Supabase/README.md's 2026-10-05 entry as having been behind live.
--   * These two are read-only reporting functions. Reverting an un-migrated
--     tweak would show wrong numbers until it was re-applied. Reverting an
--     un-migrated tweak to scan_proximity_code() could stop a badge opening a
--     door.
--
-- That is a judgement, not a guarantee. Run this first and confirm the bodies
-- match 20261009000000 before applying -- the committed copy is the baseline
-- the CREATEs below are built from:
--
--   select p.proname, md5(pg_get_functiondef(p.oid)) as body_md5
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('get_attendance_report', 'get_attendance_summary');
--
-- If either body contains anything not in 20261009000000, stop and port that
-- change into the CREATEs below rather than losing it.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text);

CREATE FUNCTION public.get_attendance_report(
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
  anomaly boolean,
  -- null when no shift rule covers this department, or when the arrival is so
  -- far from the shift start that the comparison is meaningless (see below).
  late boolean,
  first_in_offset_minutes integer
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
  ),
  -- Resolved once per distinct department rather than once per row: the rule
  -- table has a handful of rows, but a lateral per employee-day would still be
  -- thousands of needless lookups on a 31-day range.
  rules as (
    select dd.dept, rr.starts_at, rr.grace_minutes
    from (select distinct coalesce(edept, '') as dept from days) dd
    left join lateral public.shift_rule_for(dd.dept) rr on true
  ),
  marked as (
    select d.*,
           r.starts_at as r_starts,
           r.grace_minutes as r_grace,
           case
             when r.starts_at is null then null
             else (extract(epoch from ((d.fin at time zone p_tz)::time - r.starts_at)) / 60)::int
           end as off_min
    from days d
    left join rules r on r.dept = coalesce(d.edept, '')
  ),
  classified as (
    select m.*,
           -- A clock-time subtraction cannot know it crossed midnight: a
           -- 22:00 shift arrived for at 01:00 reads as +180 minutes late when
           -- it is three hours EARLY for the next one. Rather than guess which
           -- side of midnight the shift belongs to, anything more than 12
           -- hours from the shift start is reported as unclassified. For a day
           -- operation this never fires; for a night shift it declines to
           -- answer instead of answering wrongly.
           case when abs(m.off_min) > 720 then null else m.off_min end as off_clean
    from marked m
  )
  select c.eid, c.ecode, c.ename, c.edept, c.wdate, c.fin, c.lout, c.ins, c.worked, c.opened, c.anom,
         case when c.off_clean is null then null else c.off_clean > c.r_grace end,
         c.off_clean
  from classified c
  where (v_q is null
         or c.ename ilike '%' || v_q || '%'
         or c.ecode ilike '%' || v_q || '%')
    and (nullif(p_department, '') is null or coalesce(c.edept, '') = p_department)
    and (nullif(p_status, '') is null
         or p_status = (case when c.anom then 'anomaly' when c.opened then 'open' else 'complete' end))
  -- Total order: OFFSET paging over ties can repeat or skip rows between pages.
  order by c.wdate desc, c.ename, c.eid
  limit v_limit offset v_offset;
end;
$function$;

-- ---------------------------------------------------------------------------
-- get_attendance_summary: + on_time, + late_days, + unclassified,
--                         + avg_first_in_seconds, + rules_configured
-- ---------------------------------------------------------------------------
DROP FUNCTION public.get_attendance_summary(date, date, text, text, text, text);

CREATE FUNCTION public.get_attendance_summary(
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
  anomalies bigint,
  on_time bigint,
  late_days bigint,
  -- Days the rules could not judge. Surfaced rather than folded into on_time,
  -- because "84% on time" computed over a set that quietly excluded a third of
  -- the days is the kind of number that gets quoted in a meeting.
  unclassified bigint,
  -- Seconds past local midnight, averaged over the filtered days. Null when
  -- there are no days. Lets the panel show a mean arrival clock time without
  -- the client needing any of the underlying timestamps.
  avg_first_in_seconds integer,
  -- Whether ANY shift rule exists at all. Cannot be derived from the counts:
  -- zero classified days also happens when the range is empty, and the panel
  -- has to tell "nothing configured" apart from "nothing to show".
  rules_configured boolean
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
  v_has_rules boolean;
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

  select exists (select 1 from public.shift_rules) into v_has_rules;

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
           min(s.at_ts) as fin,
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
  rules as (
    select dd.dept, rr.starts_at, rr.grace_minutes
    from (select distinct coalesce(edept, '') as dept from days) dd
    left join lateral public.shift_rule_for(dd.dept) rr on true
  ),
  classified as (
    select d.*,
           r.grace_minutes as r_grace,
           case
             when r.starts_at is null then null
             when abs((extract(epoch from ((d.fin at time zone p_tz)::time - r.starts_at)) / 60)::int) > 720 then null
             else (extract(epoch from ((d.fin at time zone p_tz)::time - r.starts_at)) / 60)::int
           end as off_clean
    from days d
    left join rules r on r.dept = coalesce(d.edept, '')
  ),
  filtered as (
    select * from classified d
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
         count(*) filter (where f.anom)::bigint,
         count(*) filter (where f.off_clean is not null and f.off_clean <= f.r_grace)::bigint,
         count(*) filter (where f.off_clean is not null and f.off_clean > f.r_grace)::bigint,
         count(*) filter (where f.off_clean is null)::bigint,
         avg(extract(epoch from (f.fin at time zone p_tz)::time))::int,
         v_has_rules
  from filtered f;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Admin surface for the rules themselves.
-- ---------------------------------------------------------------------------

-- Readable by anyone who can already see attendance: a manager looking at a
-- punctuality figure needs to know which shift start produced it, and hiding
-- the baseline behind admin-only would make the number unauditable.
CREATE FUNCTION public.get_shift_rules()
RETURNS TABLE(department text, starts_at time, grace_minutes integer, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to view shift rules';
  end if;
  return query
  select r.department, r.starts_at, r.grace_minutes, r.updated_at
    from public.shift_rules r
   -- Default first, then departments alphabetically: the fallback is the one
   -- that explains every row below it.
   order by (r.department <> '*'), r.department;
end;
$function$;

-- Writing is admin-only and audit-logged. This changes what every punctuality
-- figure in the system means, so it belongs in the same tier as editing a
-- scanner, not in the same tier as reading a report.
CREATE FUNCTION public.set_shift_rule(
  p_department text,
  p_starts_at time,
  p_grace_minutes integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_dept text;
  v_prev public.shift_rules;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change shift rules';
  end if;
  if p_starts_at is null then
    raise exception 'a shift start time is required';
  end if;

  -- A blank department means the caller is editing the default, so it maps to
  -- the '*' sentinel. The consequence worth knowing: employees whose
  -- department is null or empty resolve through coalesce(edept, '') = '',
  -- which no rule can ever be created for, so they always fall through to the
  -- default. That is the intended behaviour -- an unfiled employee should be
  -- judged by the house rule -- but it does mean there is no way to give
  -- "no department" a shift start of its own, and that is a deliberate
  -- omission rather than an oversight.
  v_dept := coalesce(nullif(btrim(p_department), ''), '*');

  select * into v_prev from public.shift_rules where department = v_dept;

  insert into public.shift_rules (department, starts_at, grace_minutes, updated_at, updated_by)
  values (v_dept, p_starts_at, greatest(0, least(coalesce(p_grace_minutes, 0), 240)), now(), auth.uid())
  on conflict (department) do update
     set starts_at = excluded.starts_at,
         grace_minutes = excluded.grace_minutes,
         updated_at = now(),
         updated_by = excluded.updated_by;

  perform public.log_audit_event(
    'shift_rule_updated',
    'shift_rule',
    v_dept,
    jsonb_build_object(
      'department', v_dept,
      'starts_at', p_starts_at,
      'grace_minutes', greatest(0, least(coalesce(p_grace_minutes, 0), 240)),
      'previous_starts_at', v_prev.starts_at,
      'previous_grace_minutes', v_prev.grace_minutes
    )
  );
end;
$function$;

CREATE FUNCTION public.delete_shift_rule(p_department text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_dept text;
  v_prev public.shift_rules;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change shift rules';
  end if;
  v_dept := coalesce(nullif(btrim(p_department), ''), '*');

  select * into v_prev from public.shift_rules where department = v_dept;
  if v_prev.department is null then
    return;
  end if;

  delete from public.shift_rules where department = v_dept;

  perform public.log_audit_event(
    'shift_rule_deleted',
    'shift_rule',
    v_dept,
    jsonb_build_object('department', v_dept,
                       'previous_starts_at', v_prev.starts_at,
                       'previous_grace_minutes', v_prev.grace_minutes)
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.shift_rule_for(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shift_rule_for(text) FROM anon;
REVOKE ALL ON FUNCTION public.shift_rule_for(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_shift_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shift_rules() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shift_rules() TO authenticated;

REVOKE ALL ON FUNCTION public.set_shift_rule(text, time, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_shift_rule(text, time, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_shift_rule(text, time, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_shift_rule(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_shift_rule(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_shift_rule(text) TO authenticated;
