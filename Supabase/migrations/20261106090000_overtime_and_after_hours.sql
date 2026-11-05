-- Overtime, and scans well outside a shift.
--
-- WHAT 20261104090000 LEFT HALF-DONE. shift_rules has starts_at and
-- grace_minutes and nothing else, so the system can answer "did they arrive on
-- time" but not "did they stay their hours" -- and the second is the one
-- payroll actually asks. This adds the other half of a shift, and two features
-- fall out of the same three columns.
--
-- COST. Zero new requests for either feature. Overtime rides on the two RPCs
-- AttendancePage already calls, the same way punctuality does. After-hours
-- detection runs in a trigger inside the transaction a scan already performs,
-- writing to the `alerts` table the bell already polls. Nothing new is
-- fetched, nothing new is polled.
--
-- NOTHING IS INVENTED, AGAIN. All three new columns are NULLABLE with no
-- default. A shift that has a start but no end reports punctuality and stays
-- silent about hours, rather than guessing an eight-hour day. Consistent with
-- why starts_at has no default: a wrong overtime figure reaches payroll, and
-- looks authoritative while doing it.
--
-- AFTER-HOURS ALERTING IS SEPARATELY OPT-IN. Setting ends_at switches on
-- overtime REPORTING. Alerting additionally requires
-- after_hours_margin_minutes, which is null by default. Someone configuring
-- hours for a report should not silently start generating security alerts --
-- and on an operation with genuinely irregular hours those alerts would be
-- noise that buries the card-sharing ones, which are unambiguous.
--
-- A SIGNAL FROM THE SKETCH WAS DROPPED. "Scan on a non-working day" needs a
-- record of which days each department works, and nothing here has one. That
-- is the absence feature's territory, not this one's. Guessing weekends would
-- be wrong for a three-site operation that may well run them.

-- ---------------------------------------------------------------------------
-- 1. The other half of a shift.
-- ---------------------------------------------------------------------------

-- When the shift is expected to end. Nullable: no end configured means no
-- overtime figure, rather than a guessed one.
ALTER TABLE public.shift_rules ADD COLUMN ends_at time;

-- Expected WORKED minutes in a day, which is deliberately NOT derived from
-- ends_at - starts_at. A 07:00-16:00 shift is nine hours elapsed but usually
-- eight hours paid, because an unpaid break sits inside it. Deriving one from
-- the other would overstate everyone's expected hours by exactly the break,
-- and so understate overtime for every person every day.
ALTER TABLE public.shift_rules ADD COLUMN expected_minutes integer
  CHECK (expected_minutes IS NULL OR (expected_minutes > 0 AND expected_minutes <= 1440));

-- How far outside the shift a scan has to be before it is worth an alert.
-- NULL means after-hours alerting is OFF for this department, which is the
-- default and the point: this is a second switch, not a consequence of the
-- first.
ALTER TABLE public.shift_rules ADD COLUMN after_hours_margin_minutes integer
  CHECK (after_hours_margin_minutes IS NULL OR (after_hours_margin_minutes >= 15 AND after_hours_margin_minutes <= 720));

-- Return type changes, so DROP then CREATE. Safe to drop ahead of its callers:
-- plpgsql bodies are not dependency-tracked, and both callers are recreated
-- below anyway.
DROP FUNCTION public.shift_rule_for(text);

CREATE FUNCTION public.shift_rule_for(p_department text)
RETURNS TABLE(
  starts_at time,
  grace_minutes integer,
  ends_at time,
  expected_minutes integer,
  after_hours_margin_minutes integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT r.starts_at, r.grace_minutes, r.ends_at, r.expected_minutes, r.after_hours_margin_minutes
    FROM public.shift_rules r
   WHERE r.department = coalesce(p_department, '')
      OR r.department = '*'
   ORDER BY (r.department = '*')
   LIMIT 1;
$function$;

-- ---------------------------------------------------------------------------
-- 2. get_attendance_report: + overtime_minutes
--
-- Same DROP/CREATE reasoning as 20261104090000, and the same residual risk:
-- if the live body has an un-migrated change this replaces it. Confirm first
-- if anything has been edited through the SQL Editor since 2026-11-05:
--
--   select p.proname, md5(pg_get_functiondef(p.oid)) as body_md5
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('get_attendance_report', 'get_attendance_summary');
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
  late boolean,
  first_in_offset_minutes integer,
  -- Signed: positive is overtime, negative is a short day. Null when no
  -- expected_minutes covers this department, OR when the day is flagged for
  -- review -- see the comment at the computation.
  overtime_minutes integer
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
  rules as (
    select dd.dept, rr.starts_at, rr.grace_minutes, rr.expected_minutes
    from (select distinct coalesce(edept, '') as dept from days) dd
    left join lateral public.shift_rule_for(dd.dept) rr on true
  ),
  marked as (
    select d.*,
           r.starts_at as r_starts,
           r.grace_minutes as r_grace,
           r.expected_minutes as r_expected,
           case
             when r.starts_at is null then null
             else (extract(epoch from ((d.fin at time zone p_tz)::time - r.starts_at)) / 60)::int
           end as off_min
    from days d
    left join rules r on r.dept = coalesce(d.edept, '')
  ),
  classified as (
    select m.*,
           case when abs(m.off_min) > 720 then null else m.off_min end as off_clean,
           -- HOURS ON A FLAGGED DAY ARE NOT FINAL, so no overtime is reported
           -- for one. An open_punch day has an IN and no OUT, so worked
           -- under-counts by the whole afternoon and would read as a massive
           -- short day; an anomaly day has an OUT before its IN, whose
           -- negative gap worked deliberately excludes. Reporting either as
           -- "-7h 20m short" would be a confident wrong number about hours,
           -- which is the one thing this must not produce. Close the day in
           -- the review queue (20261103120000) and it gets an overtime figure
           -- on the next load.
           case
             when m.r_expected is null then null
             when m.opened or m.anom then null
             else ((m.worked / 60.0) - m.r_expected)::int
           end as ot_min
    from marked m
  )
  select c.eid, c.ecode, c.ename, c.edept, c.wdate, c.fin, c.lout, c.ins, c.worked, c.opened, c.anom,
         case when c.off_clean is null then null else c.off_clean > c.r_grace end,
         c.off_clean,
         c.ot_min
  from classified c
  where (v_q is null
         or c.ename ilike '%' || v_q || '%'
         or c.ecode ilike '%' || v_q || '%')
    and (nullif(p_department, '') is null or coalesce(c.edept, '') = p_department)
    and (nullif(p_status, '') is null
         or p_status = (case when c.anom then 'anomaly' when c.opened then 'open' else 'complete' end))
  order by c.wdate desc, c.ename, c.eid
  limit v_limit offset v_offset;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. get_attendance_summary: + overtime totals
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
  unclassified bigint,
  avg_first_in_seconds integer,
  rules_configured boolean,
  -- Totals, not averages: "214 hours of overtime this week" is a number
  -- somebody can act on, where a mean per day hides the few people carrying
  -- it.
  overtime_minutes bigint,
  short_minutes bigint,
  over_days bigint,
  short_days bigint,
  -- Days with no overtime figure at all -- no expected_minutes, or flagged
  -- for review. Surfaced for the same reason `unclassified` is: a total whose
  -- denominator quietly dropped a third of the range is how a wrong number
  -- gets quoted.
  unmeasured_days bigint,
  -- Whether ANY rule carries expected_minutes. Not derivable from the totals,
  -- for the same reason rules_configured is not: zero also means "nothing
  -- matched".
  expected_configured boolean
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
  v_has_expected boolean;
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
  select exists (select 1 from public.shift_rules where expected_minutes is not null) into v_has_expected;

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
    select dd.dept, rr.starts_at, rr.grace_minutes, rr.expected_minutes
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
           end as off_clean,
           case
             when r.expected_minutes is null then null
             when d.opened or d.anom then null
             else ((d.worked / 60.0) - r.expected_minutes)::int
           end as ot_min
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
  select count(*)::bigint,
         count(distinct f.eid)::bigint,
         coalesce(sum(f.worked), 0)::bigint,
         count(*) filter (where f.opened and not f.anom)::bigint,
         count(*) filter (where f.anom)::bigint,
         count(*) filter (where f.off_clean is not null and f.off_clean <= f.r_grace)::bigint,
         count(*) filter (where f.off_clean is not null and f.off_clean > f.r_grace)::bigint,
         count(*) filter (where f.off_clean is null)::bigint,
         avg(extract(epoch from (f.fin at time zone p_tz)::time))::int,
         v_has_rules,
         coalesce(sum(f.ot_min) filter (where f.ot_min > 0), 0)::bigint,
         coalesce(-sum(f.ot_min) filter (where f.ot_min < 0), 0)::bigint,
         count(*) filter (where f.ot_min > 0)::bigint,
         count(*) filter (where f.ot_min < 0)::bigint,
         count(*) filter (where f.ot_min is null)::bigint,
         v_has_expected
  from filtered f;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. After-hours detection.
--
-- A SEPARATE trigger from trg_detect_card_sharing rather than a branch inside
-- it. The two answer different questions from different data -- one compares
-- this scan against the previous one, the other against a clock -- and
-- keeping them apart means this migration adds rather than replaces, which is
-- the same reasoning that made card sharing a trigger in the first place. The
-- cost of the split is one primary-key lookup on employees per matched scan.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.trg_detect_after_hours()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  -- The same default every attendance RPC uses. A trigger has no client to
  -- ask, and "which day is this scan on" has to agree with the report or the
  -- two will disagree about the same scan.
  v_tz constant text := 'Asia/Manila';
  v_dept text;
  v_name text;
  v_starts time;
  v_ends time;
  v_margin integer;
  v_local timestamp;
  v_minute integer;
  v_open integer;
  v_close integer;
  v_inside boolean;
begin
  if new.employee_id is null or new.result <> 'matched' then
    return new;
  end if;

  -- Guarded for the same reason trg_detect_card_sharing is: this runs in the
  -- scan's own transaction, so an uncaught fault in an ANALYTICS rule would
  -- refuse a badge at a door. A missed alert is an inconvenience; a dead
  -- turnstile is an outage.
  begin
    select e.department, e.full_name into v_dept, v_name
      from public.employees e where e.id = new.employee_id;

    select r.starts_at, r.ends_at, r.after_hours_margin_minutes
      into v_starts, v_ends, v_margin
      from public.shift_rule_for(coalesce(v_dept, '')) r;

    -- All three required. A margin of null is the off switch, and it is the
    -- default -- setting shift hours for a report must not silently start
    -- generating security alerts.
    if v_margin is null or v_starts is null or v_ends is null then
      return new;
    end if;

    v_local := new.scanned_at at time zone v_tz;
    v_minute := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;

    -- Window in minutes-of-day, wrapped into 0..1439. `% 1440` on a negative
    -- stays negative in Postgres, hence the + 1440 before it.
    v_open := ((extract(hour from v_starts)::int * 60 + extract(minute from v_starts)::int) - v_margin + 1440) % 1440;
    v_close := ((extract(hour from v_ends)::int * 60 + extract(minute from v_ends)::int) + v_margin) % 1440;

    if v_open <= v_close then
      -- Ordinary day shift: one contiguous window.
      v_inside := v_minute >= v_open and v_minute <= v_close;
    else
      -- The window crosses midnight, either because the shift is a night
      -- shift (22:00-06:00) or because the margin pushed it over the
      -- boundary. Inside means "after it opens OR before it closes", which is
      -- the union of two spans rather than the gap between them.
      v_inside := v_minute >= v_open or v_minute <= v_close;
    end if;

    if v_inside then
      return new;
    end if;

    perform public.raise_alert('after_hours_scan', 'warning',
      -- substring rather than to_char: there is no to_char(time, text) in
      -- Postgres, so to_char would resolve through the implicit time ->
      -- interval cast. It happens to work, but relying on an implicit cast
      -- inside an exception-swallowed block means a future type change would
      -- fail silently and the alert would just stop appearing.
      coalesce(v_name, 'An employee') || '''s card was used at '
        || to_char(v_local, 'HH24:MI') || ', outside the '
        || substring(v_starts::text from 1 for 5) || '-' || substring(v_ends::text from 1 for 5)
        || ' shift for ' || coalesce(nullif(v_dept, ''), 'their department')
        || ' (margin ' || v_margin::text || ' min).',
      jsonb_build_object(
        'employee_id', new.employee_id,
        'employee_name', v_name,
        'department', v_dept,
        'scanner_id', new.scanner_id,
        'scanned_at', new.scanned_at,
        'local_time', to_char(v_local, 'YYYY-MM-DD HH24:MI'),
        'shift_starts_at', v_starts,
        'shift_ends_at', v_ends,
        'margin_minutes', v_margin,
        'offline', coalesce((new.raw_payload ->> 'captured_offline')::boolean, false)),
      -- One alert per person per local day. Someone working through a night
      -- may scan repeatedly; that is one situation, not twelve.
      'after-hours:' || new.employee_id::text || ':' || v_local::date::text,
      720);
  exception
    when others then
      -- Deliberately swallowed. See above.
      null;
  end;

  return new;
end;
$function$;

CREATE TRIGGER trg_scan_events_detect_after_hours
AFTER INSERT ON public.scan_events
FOR EACH ROW
EXECUTE FUNCTION public.trg_detect_after_hours();

-- ---------------------------------------------------------------------------
-- 5. The admin surface gains the new fields.
-- ---------------------------------------------------------------------------
DROP FUNCTION public.get_shift_rules();

CREATE FUNCTION public.get_shift_rules()
RETURNS TABLE(
  department text,
  starts_at time,
  grace_minutes integer,
  ends_at time,
  expected_minutes integer,
  after_hours_margin_minutes integer,
  updated_at timestamptz
)
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
  select r.department, r.starts_at, r.grace_minutes,
         r.ends_at, r.expected_minutes, r.after_hours_margin_minutes, r.updated_at
    from public.shift_rules r
   order by (r.department <> '*'), r.department;
end;
$function$;

-- The 3-argument form is dropped, not overloaded: PostgREST resolves by
-- argument name, so leaving it would let a stale client keep saving rules
-- that silently discard the end time. Same trap 20261009000000 had to clean
-- up.
DROP FUNCTION public.set_shift_rule(text, time, integer);

CREATE FUNCTION public.set_shift_rule(
  p_department text,
  p_starts_at time,
  p_grace_minutes integer DEFAULT 0,
  p_ends_at time DEFAULT NULL,
  p_expected_minutes integer DEFAULT NULL,
  p_after_hours_margin_minutes integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_dept text;
  v_prev public.shift_rules;
  v_grace integer;
  v_expected integer;
  v_margin integer;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change shift rules';
  end if;
  if p_starts_at is null then
    raise exception 'a shift start time is required';
  end if;

  -- An end with no expected minutes is allowed (it drives after-hours only),
  -- and expected minutes with no end is allowed (it drives overtime only).
  -- But a margin with no end cannot work: there is no window to be outside.
  if p_after_hours_margin_minutes is not null and p_ends_at is null then
    raise exception 'an after-hours margin needs a shift end time';
  end if;

  v_dept := coalesce(nullif(btrim(p_department), ''), '*');
  v_grace := greatest(0, least(coalesce(p_grace_minutes, 0), 240));
  v_expected := case when p_expected_minutes is null then null
                     else greatest(1, least(p_expected_minutes, 1440)) end;
  v_margin := case when p_after_hours_margin_minutes is null then null
                   else greatest(15, least(p_after_hours_margin_minutes, 720)) end;

  select * into v_prev from public.shift_rules where department = v_dept;

  insert into public.shift_rules (department, starts_at, grace_minutes, ends_at,
                                  expected_minutes, after_hours_margin_minutes,
                                  updated_at, updated_by)
  values (v_dept, p_starts_at, v_grace, p_ends_at, v_expected, v_margin, now(), auth.uid())
  on conflict (department) do update
     set starts_at = excluded.starts_at,
         grace_minutes = excluded.grace_minutes,
         ends_at = excluded.ends_at,
         expected_minutes = excluded.expected_minutes,
         after_hours_margin_minutes = excluded.after_hours_margin_minutes,
         updated_at = now(),
         updated_by = excluded.updated_by;

  perform public.log_audit_event(
    'shift_rule_updated',
    'shift_rule',
    v_dept,
    jsonb_build_object(
      'department', v_dept,
      'starts_at', p_starts_at, 'grace_minutes', v_grace,
      'ends_at', p_ends_at, 'expected_minutes', v_expected,
      'after_hours_margin_minutes', v_margin,
      'previous_starts_at', v_prev.starts_at,
      'previous_grace_minutes', v_prev.grace_minutes,
      'previous_ends_at', v_prev.ends_at,
      'previous_expected_minutes', v_prev.expected_minutes,
      'previous_after_hours_margin_minutes', v_prev.after_hours_margin_minutes
    )
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.shift_rule_for(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shift_rule_for(text) FROM anon;
REVOKE ALL ON FUNCTION public.shift_rule_for(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_detect_after_hours() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_detect_after_hours() FROM anon;
REVOKE ALL ON FUNCTION public.trg_detect_after_hours() FROM authenticated;

REVOKE ALL ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_report(date, date, text, integer, integer, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_summary(date, date, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_shift_rules() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_shift_rules() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_shift_rules() TO authenticated;

REVOKE ALL ON FUNCTION public.set_shift_rule(text, time, integer, time, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_shift_rule(text, time, integer, time, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_shift_rule(text, time, integer, time, integer, integer) TO authenticated;

-- PostgREST answers an unknown function from its in-memory schema cache
-- without touching the database, so every signature changed above would
-- return PGRST202 until that cache happened to refresh.
-- test/migration-conventions.test.mjs guards this.
NOTIFY pgrst, 'reload schema';
