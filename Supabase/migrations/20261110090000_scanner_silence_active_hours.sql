-- Option A, part 1 of 3: stop raising scanner_went_silent overnight.
--
-- THE PROBLEM, from the live alert table: 357 of 422 alerts are
-- scanner_went_silent, and ~305 of those fall between 20:00 and 07:00
-- Asia/Manila. A scanner that is quiet at 02:00 is not broken, it is a
-- scanner at a closed site. Those 305 are the reason the alert list is
-- unreadable, and the reason nobody looks at the 52 that are real.
--
-- WHAT COUNTS AS "EXPECTED ACTIVE". Scanners have no department and
-- shift_rules is keyed by department, so there is no per-scanner schedule to
-- read. The union of every shift window is the closest honest answer: if
-- anyone is expected to be working, every scanner is expected to be awake.
--
-- THE EMPTY-TABLE CASE IS THE WHOLE DESIGN. shift_rules had ZERO rows when
-- last checked (2026-11-07), and the union of an empty set is empty — taken
-- literally this function would switch silence alerting off completely,
-- including for a scanner that dies at noon. A safety feature that fails
-- closed and silent is worse than the noise it replaced. So an empty table
-- falls back to a default working day, and the moment real shift rules exist
-- they take over automatically with no further change here.
--
-- A RULE WITH NO ends_at CONTRIBUTES NOTHING. ends_at is nullable and
-- deliberately opt-in (see 20261106090000) — a rule that only knows when the
-- shift starts cannot say when it ends, and guessing would be inventing a
-- schedule. Such rules are skipped; if every rule lacks ends_at the fallback
-- applies, exactly as if the table were empty.
--
-- COST: zero new requests. check_scanner_silence() already runs 96 times a
-- day under pg_cron; this adds one read of a table with single-digit rows to
-- each run and causes it to raise FEWER alerts. Egress and log ingestion both
-- move down, never up.

-- ---------------------------------------------------------------------------
-- 1. Is anyone expected to be at work right now?
-- ---------------------------------------------------------------------------
--
-- Parameters rather than baked-in literals so the window can be tried out
-- read-only ("would 06:00 have suppressed this?") without a migration.
CREATE OR REPLACE FUNCTION public.scanner_silence_active_now(
  p_at timestamptz DEFAULT now(),
  p_tz text DEFAULT 'Asia/Manila',
  p_default_from time DEFAULT '07:00',
  p_default_to time DEFAULT '20:00'
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_local time := (p_at at time zone coalesce(nullif(p_tz, ''), 'Asia/Manila'))::time;
  v_any boolean := false;
  v_open time;
  v_close time;
  r record;
begin
  for r in
    select starts_at, ends_at, coalesce(grace_minutes, 0) as grace
    from public.shift_rules
    where starts_at is not null
      and ends_at is not null
  loop
    v_any := true;
    -- Widened at BOTH ends by the grace minutes. grace_minutes is a lateness
    -- allowance, so strictly it only belongs after starts_at — but widening
    -- the window errs toward alerting, and for a "is my scanner dead" check
    -- a false alarm costs a glance while a missed one costs a shift.
    --
    -- Postgres time arithmetic wraps modulo 24h, so 23:30 + 60min is 00:30
    -- rather than an error. That is what makes a night shift work below.
    v_open := r.starts_at - make_interval(mins => r.grace);
    v_close := r.ends_at + make_interval(mins => r.grace);

    if v_open <= v_close then
      if v_local >= v_open and v_local <= v_close then
        return true;
      end if;
    else
      -- Wraps midnight: the window is the UNION of two spans, not the gap
      -- between them. Same shape as trg_detect_after_hours() in
      -- 20261106090000 — kept identical on purpose so the two agree about
      -- what "inside a shift" means.
      if v_local >= v_open or v_local <= v_close then
        return true;
      end if;
    end if;
  end loop;

  -- Rules exist and none of them cover now: genuinely outside working hours.
  if v_any then
    return false;
  end if;

  -- No usable rules at all. Fall back rather than fail closed.
  if p_default_from <= p_default_to then
    return v_local >= p_default_from and v_local <= p_default_to;
  end if;
  return v_local >= p_default_from or v_local <= p_default_to;
end;
$function$;

REVOKE ALL ON FUNCTION public.scanner_silence_active_now(timestamptz, text, time, time) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scanner_silence_active_now(timestamptz, text, time, time) FROM anon;
GRANT EXECUTE ON FUNCTION public.scanner_silence_active_now(timestamptz, text, time, time) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Gate the check itself
-- ---------------------------------------------------------------------------
--
-- SIGNATURE DELIBERATELY UNCHANGED. pg_cron is scheduled against
-- check_scanner_silence(...) and adding an optional parameter would create a
-- second overload, not replace this one — a no-argument call would then be
-- ambiguous and the cron job would start failing. The whole change is in the
-- body.
CREATE OR REPLACE FUNCTION public.check_scanner_silence(p_silence_minutes integer DEFAULT 60)
RETURNS TABLE(scanners_flagged integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  -- Floored well above scannerState()'s 10-minute "online" window (see
  -- JS/Utils/dashboard.js) so this can never fire for a scanner the UI
  -- would still call "online" — the two thresholds are deliberately
  -- independent, not the same number reused in two places.
  v_minutes integer := greatest(15, coalesce(p_silence_minutes, 60));
  v_count integer := 0;
  r record;
begin
  -- Same two-caller permission split as archive_old_scan_events() /
  -- trim_employee_scan_logs(): pg_cron's scheduled call has no PostgREST
  -- request behind it (auth.uid() is null, proceed); an admin's
  -- on-demand run from Settings is a real request and must actually be
  -- an admin.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to check scanner silence';
  end if;

  -- Checked ONCE, before the loop, not per scanner: the answer cannot differ
  -- between two rows of the same run, and this is the whole added cost of the
  -- change.
  --
  -- Returns 0 rather than raising. An admin pressing "Check now" at 22:00
  -- should be told "nothing flagged", not handed an error — and the status
  -- function below is what explains why.
  if not public.scanner_silence_active_now() then
    return query select 0;
    return;
  end if;

  for r in
    select scanner_id, label, last_seen_at
    from public.scanners
    where is_enabled = true
      and last_seen_at <= now() - make_interval(mins => v_minutes)
  loop
    perform public.raise_alert(
      'scanner_went_silent', 'warning',
      coalesce(r.label, r.scanner_id) || ' has not reported in over ' || v_minutes || ' minutes',
      jsonb_build_object('scanner_id', r.scanner_id, 'label', r.label, 'last_seen_at', r.last_seen_at, 'silence_minutes', v_minutes),
      'scanner-silent:' || r.scanner_id, 180
    );
    v_count := v_count + 1;
  end loop;

  return query select v_count;
end;
$function$;

REVOKE ALL ON FUNCTION public.check_scanner_silence(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_scanner_silence(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_scanner_silence(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Say so in the Settings panel
-- ---------------------------------------------------------------------------
--
-- ADDITIVE ONLY: returns jsonb, and the existing keys keep their names and
-- meanings, so a deployed client that knows nothing about the new ones is
-- unaffected. Without this an admin pressing "Check now" at 22:00 sees
-- "0 flagged" and reasonably concludes the feature is broken.
CREATE OR REPLACE FUNCTION public.get_scanner_silence_status(p_silence_minutes integer DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_minutes integer := greatest(15, coalesce(p_silence_minutes, 60));
  v_total integer;
  v_enabled integer;
  v_silent integer;
  v_rules integer;
  v_last_run jsonb;
begin
  if not public.is_admin() then
    raise exception 'not permitted to view scanner silence status';
  end if;

  select count(*), count(*) filter (where is_enabled)
    into v_total, v_enabled
  from public.scanners;

  select count(*) into v_silent
  from public.scanners
  where is_enabled = true
    and last_seen_at <= now() - make_interval(mins => v_minutes);

  select count(*) into v_rules
  from public.shift_rules
  where starts_at is not null and ends_at is not null;

  begin
    select jsonb_build_object('status', jrd.status, 'started_at', jrd.start_time,
                               'ended_at', jrd.end_time, 'message', jrd.return_message)
    into v_last_run
    from cron.job_run_details jrd
    join cron.job j on j.jobid = jrd.jobid
    where j.jobname = 'check-scanner-silence'
    order by jrd.start_time desc
    limit 1;
  exception when others then
    v_last_run := null;
  end;

  return jsonb_build_object(
    'silence_minutes', v_minutes,
    'total_scanners', v_total,
    'enabled_scanners', v_enabled,
    'silent_now', v_silent,
    'last_run', v_last_run,
    -- New keys below.
    'alerting_active_now', public.scanner_silence_active_now(),
    'usable_shift_rules', v_rules,
    'window_source', case when v_rules > 0 then 'shift_rules' else 'default' end,
    'default_window', '07:00-20:00 Asia/Manila'
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_scanner_silence_status(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_silence_status(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scanner_silence_status(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY -------------------------------------------------------------------
--
--   -- 1. grants: PUBLIC and anon must both be false, authenticated true
--   select has_function_privilege('anon', 'public.scanner_silence_active_now(timestamptz,text,time,time)', 'EXECUTE') as anon,
--          has_function_privilege('authenticated', 'public.scanner_silence_active_now(timestamptz,text,time,time)', 'EXECUTE') as auth;
--
--   -- 2. the window, hour by hour, with the table as it stands today
--   select h, public.scanner_silence_active_now(
--            (date_trunc('day', now() at time zone 'Asia/Manila') + make_interval(hours => h))
--              at time zone 'Asia/Manila')
--   from generate_series(0, 23) h;
--   -- expect false for 00..06 and 21..23, true for 07..20
--
--   -- 3. how much noise this would have removed, against real history
--   select count(*) filter (where public.scanner_silence_active_now(created_at)) as would_still_fire,
--          count(*) filter (where not public.scanner_silence_active_now(created_at)) as suppressed
--   from public.alerts
--   where kind = 'scanner_went_silent';
--   -- expect suppressed to land near 305 of 357
--
--   -- 4. exactly one overload, or pg_cron's no-arg call becomes ambiguous
--   select count(*) from pg_proc where proname = 'check_scanner_silence';
--   -- expect 1
