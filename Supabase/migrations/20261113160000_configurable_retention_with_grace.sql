-- Retention becomes a setting, off by default, and never takes effect on the
-- day it is changed.
--
-- THE REQUIREMENT, as given: "Default is 0, user set to 90 Days, the data
-- older than 90 Days will be deleted the next day, not on the day it was
-- set." Two separate guarantees in that sentence:
--
--   1. ADJUSTABLE, AND OFF UNTIL SOMEBODY CHOOSES. 0 means delete nothing,
--      and it is the default. Today the cron job calls
--      trim_employee_scan_logs(180) with the horizon hardcoded into the
--      schedule, so nobody can change it without a migration.
--
--   2. A DAY OF GRACE. Setting a horizon makes data deletable; the deletion
--      waits until the next local day. Someone who types 90 when they meant
--      900 has until tomorrow to notice, and the job that would have acted
--      on the mistake has not run yet.
--
-- BEHAVIOUR CHANGE, STATED PLAINLY: after this migration retention is OFF.
-- The schedule previously passed 180 and would have begun deleting around
-- March 2027. It now deletes nothing until an admin sets a horizon. That is
-- the direction the requirement asks for, and it is the safe direction, but
-- it is a change and not a no-op.
--
-- WHAT THIS DOES NOT TOUCH: archive_old_scan_events(). That job MOVES rows
-- from scan_events to scan_events_archive — it deletes nothing and loses
-- nothing, and get_all_scan_events() reads both tables. Gating it behind a
-- retention setting would let an operator switch off the only thing keeping
-- the live table small, in exchange for no safety at all. Its 180-day
-- horizon stays independent and hardcoded.
--
-- COST: the setting is one row read inside a job that already runs. The
-- getter is one request when an admin opens the panel. No polling, no
-- egress, no new log volume.

-- ---------------------------------------------------------------------------
-- 1. The setting
-- ---------------------------------------------------------------------------
--
-- Single-row by construction: a boolean primary key with a CHECK that only
-- admits true can hold exactly one row, so "there is one setting" is
-- enforced by the key rather than by every caller remembering to filter.
-- Same reasoning as shift_rules' '*' sentinel.
CREATE TABLE IF NOT EXISTS public.retention_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),

  -- 0 = retention off, delete nothing. Otherwise floored at 90, which is the
  -- window get_scanner_performance_stats() and get_scanner_scan_details()
  -- can still ask for; a shorter horizon would silently break them. The
  -- CHECK makes the floor part of the data rather than something each
  -- function re-derives.
  scan_logs_days integer NOT NULL DEFAULT 0
    CHECK (scan_logs_days = 0 OR (scan_logs_days >= 90 AND scan_logs_days <= 3650)),

  -- The first LOCAL DATE on which the horizon above may be acted on. Set to
  -- tomorrow every time scan_logs_days changes, which is the whole grace
  -- mechanism. NULL while retention is off.
  effective_from date,

  -- The zone "the next day" is counted in. Stored rather than assumed so the
  -- grace means the same thing to the job and to the panel explaining it.
  tz text NOT NULL DEFAULT 'Asia/Manila',

  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users (id) ON DELETE SET NULL
);

-- Exactly one row, created off. A missing row and a row of 0 must not mean
-- different things, but only one of them can be read without a coalesce at
-- every call site.
INSERT INTO public.retention_settings (id, scan_logs_days, effective_from)
VALUES (true, 0, NULL)
ON CONFLICT (id) DO NOTHING;

-- RLS on with no policies at all, deliberately: every read and write goes
-- through the SECURITY DEFINER functions below, which carry their own
-- admin checks. Same pattern as shift_rules.
ALTER TABLE public.retention_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.retention_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.retention_settings FROM anon;
REVOKE ALL ON TABLE public.retention_settings FROM authenticated;

COMMENT ON TABLE public.retention_settings IS
  'Single row. scan_logs_days 0 = retention off (the default); otherwise entries older than that many days become deletable, but not before effective_from, which is always the day after the value was last changed.';

-- ---------------------------------------------------------------------------
-- 2. Reading it
-- ---------------------------------------------------------------------------
--
-- Returns what the panel needs to explain itself, not just the number:
-- whether it is active yet, and if not, when. A control that says "90 days"
-- while quietly doing nothing for another eighteen hours is the kind of
-- thing this whole migration exists to avoid.
CREATE OR REPLACE FUNCTION public.get_retention_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  r public.retention_settings%rowtype;
  v_today date;
begin
  if not public.is_admin() then
    raise exception 'not permitted to view retention settings';
  end if;

  select * into r from public.retention_settings where id;
  if r is null then
    return jsonb_build_object('scan_logs_days', 0, 'effective_from', null,
                              'tz', 'Asia/Manila', 'active_now', false,
                              'days_until_active', null, 'updated_at', null);
  end if;

  v_today := (now() at time zone r.tz)::date;

  return jsonb_build_object(
    'scan_logs_days', r.scan_logs_days,
    'effective_from', r.effective_from,
    'tz', r.tz,
    'today', v_today,
    -- Off is not "waiting to become active"; it is a third state and the
    -- panel must be able to tell them apart.
    'active_now', r.scan_logs_days > 0
                  and r.effective_from is not null
                  and v_today >= r.effective_from,
    'days_until_active', case
      when r.scan_logs_days = 0 or r.effective_from is null then null
      else greatest(0, r.effective_from - v_today)
    end,
    'updated_at', r.updated_at
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_retention_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_retention_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_retention_settings() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Changing it
-- ---------------------------------------------------------------------------
--
-- effective_from is computed HERE, server-side, from the server's own clock.
-- A client-supplied date would make the grace period something a caller can
-- set to today, which is exactly the thing being prevented.
--
-- EVERY change resets the clock, including raising the horizon. 180 -> 90
-- obviously needs the grace; 90 -> 180 does not, but a rule with an
-- exception is a rule somebody has to remember, and waiting a day to delete
-- LESS costs nothing.
CREATE OR REPLACE FUNCTION public.set_retention_days(p_days integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_days integer := coalesce(p_days, 0);
  v_tz text;
  v_from date;
begin
  if not public.is_admin() then
    raise exception 'not permitted to change retention settings';
  end if;

  -- Rejected rather than silently floored. Someone typing 30 has a specific
  -- intention, and quietly storing 90 instead would be a worse answer than
  -- telling them why 30 is not available.
  if v_days <> 0 and (v_days < 90 or v_days > 3650) then
    raise exception 'retention must be 0 (off) or between 90 and 3650 days';
  end if;

  select tz into v_tz from public.retention_settings where id;
  v_tz := coalesce(v_tz, 'Asia/Manila');

  -- Tomorrow, in the configured zone. Not now() + 24h: the requirement is
  -- stated in days ("the next day, not the day it was set"), and a date
  -- comparison is what the job can check without caring what time it runs.
  v_from := case when v_days = 0 then null
                 else ((now() at time zone v_tz)::date + 1) end;

  update public.retention_settings
     set scan_logs_days = v_days,
         effective_from = v_from,
         updated_at = now(),
         updated_by = auth.uid()
   where id;

  -- Written explicitly here, not by a trigger. Changing the rule that
  -- governs deletion is worth attributing, and this fires once per human
  -- action rather than once per row of anything.
  perform public.log_audit_event(
    'retention_changed', 'retention_settings', 'retention',
    jsonb_build_object('scan_logs_days', v_days, 'effective_from', v_from, 'tz', v_tz));

  return public.get_retention_settings();
end;
$function$;

REVOKE ALL ON FUNCTION public.set_retention_days(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_retention_days(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_retention_days(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The job obeys it
-- ---------------------------------------------------------------------------
--
-- SIGNATURE AND RETURN TYPE UNCHANGED, so pg_cron and
-- Models/ScanLogsTrimModel.js keep working. What changes is where the
-- horizon comes from and whether the run is allowed to happen at all.
--
-- p_older_than_days is now an override that can only ever KEEP MORE:
-- greatest(setting, argument). An admin running this by hand cannot reach
-- further back than the configured horizon, so the setting is a floor on
-- what survives rather than a suggestion. With retention off, no argument
-- makes it delete anything.
CREATE OR REPLACE FUNCTION public.trim_employee_scan_logs(p_older_than_days integer DEFAULT NULL)
RETURNS TABLE(employees_trimmed integer, entries_removed integer, cutoff timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_set_days integer;
  v_from date;
  v_tz text;
  v_days integer;
  v_cutoff timestamptz;
  v_employees_trimmed integer;
  v_entries_removed integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to run scan-log trimming';
  end if;

  select scan_logs_days, effective_from, tz
    into v_set_days, v_from, v_tz
    from public.retention_settings where id;

  -- Off. The default, and the only state in which this function is a no-op
  -- by configuration rather than by having nothing old enough to remove.
  if coalesce(v_set_days, 0) = 0 then
    return query select 0, 0, null::timestamptz;
    return;
  end if;

  -- Set, but not yet. THE GRACE PERIOD. A horizon chosen today is acted on
  -- from tomorrow, so the run that would have destroyed data on the strength
  -- of a typo has not happened yet.
  if v_from is null or (now() at time zone coalesce(v_tz, 'Asia/Manila'))::date < v_from then
    return query select 0, 0, null::timestamptz;
    return;
  end if;

  v_days := greatest(v_set_days, coalesce(p_older_than_days, v_set_days));
  v_cutoff := now() - make_interval(days => v_days);

  with candidates as (
    select e.id,
           jsonb_array_length(e.scan_logs) as old_len,
           (select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
            from jsonb_array_elements(e.scan_logs) with ordinality as t(elem, ord)
            -- Unchanged from 20261113140000: remove only what can be dated
            -- AND is older. coalesce(..., true) keeps anything undatable.
            where coalesce(public.try_timestamptz(elem->>'scanned_at') >= v_cutoff, true)
           ) as new_logs
    from public.employees e
    where jsonb_array_length(e.scan_logs) > 0
  ),
  to_trim as (
    select id, new_logs, old_len, jsonb_array_length(new_logs) as new_len
    from candidates
    where jsonb_array_length(new_logs) < old_len
  ),
  updated as (
    update public.employees e
    set scan_logs = t.new_logs
    from to_trim t
    where e.id = t.id
    returning t.old_len - t.new_len as removed
  )
  select count(*)::int, coalesce(sum(removed), 0)::int
  into v_employees_trimmed, v_entries_removed
  from updated;

  return query select v_employees_trimmed, v_entries_removed, v_cutoff;
end;
$function$;

COMMENT ON FUNCTION public.trim_employee_scan_logs(integer) IS
  'Removes employees.scan_logs entries older than retention_settings.scan_logs_days. Does nothing while that is 0 (the default) or before retention_settings.effective_from, which is always the day after the horizon was last changed. p_older_than_days can only widen the window kept, never narrow it. An entry is removed only when it can be dated and that date precedes the cutoff.';

REVOKE ALL ON FUNCTION public.trim_employee_scan_logs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trim_employee_scan_logs(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.trim_employee_scan_logs(integer) TO authenticated;

-- The schedule passed 180 as a hardcoded argument. It must now pass nothing,
-- or that argument would override the setting on every run — and since the
-- override can only keep MORE, a stored horizon of 90 with a hardcoded 180
-- would silently never honour the 90.
SELECT cron.unschedule('trim-employee-scan-logs')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trim-employee-scan-logs');

SELECT cron.schedule(
  'trim-employee-scan-logs',
  '10 3 * * *',
  $$SELECT public.trim_employee_scan_logs()$$
);

-- ---------------------------------------------------------------------------
-- 5. The preview follows the setting too
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_scan_logs_trim(p_older_than_days integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_set_days integer;
  v_from date;
  v_tz text;
  v_days integer;
  v_cutoff timestamptz;
  v_active boolean;
  v_would_remove bigint;
  v_would_affect bigint;
  v_undated bigint;
  v_oldest timestamptz;
  v_newest_removed timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not permitted to preview scan-log trimming';
  end if;

  select scan_logs_days, effective_from, tz
    into v_set_days, v_from, v_tz
    from public.retention_settings where id;
  v_tz := coalesce(v_tz, 'Asia/Manila');
  v_active := coalesce(v_set_days, 0) > 0
              and v_from is not null
              and (now() at time zone v_tz)::date >= v_from;

  -- With retention off there is no cutoff to preview against, so the counts
  -- that depend on one are null rather than 0. Zero would read as "nothing
  -- would be removed", which is a different claim from "nothing is
  -- configured to be removed".
  if coalesce(v_set_days, 0) = 0 then
    return jsonb_build_object(
      'retention_off', true, 'active_now', false, 'cutoff', null,
      'horizon_days', 0, 'effective_from', null,
      'would_remove_entries', null, 'would_affect_employees', null,
      'newest_removed_at', null, 'oldest_entry_at', null, 'undated_entries', null);
  end if;

  v_days := greatest(v_set_days, coalesce(p_older_than_days, v_set_days));
  v_cutoff := now() - make_interval(days => v_days);

  with entries as (
    select e.id,
           public.try_timestamptz(t.elem->>'scanned_at') as at_ts
      from public.employees e
      cross join lateral jsonb_array_elements(e.scan_logs) as t(elem)
     where e.scan_logs_count > 0
  )
  select count(*) filter (where at_ts is not null and at_ts < v_cutoff),
         count(distinct id) filter (where at_ts is not null and at_ts < v_cutoff),
         count(*) filter (where at_ts is null),
         min(at_ts),
         max(at_ts) filter (where at_ts is not null and at_ts < v_cutoff)
    into v_would_remove, v_would_affect, v_undated, v_oldest, v_newest_removed
    from entries;

  return jsonb_build_object(
    'retention_off', false,
    'active_now', v_active,
    'effective_from', v_from,
    'cutoff', v_cutoff,
    'horizon_days', v_days,
    'oldest_entry_at', v_oldest,
    'would_remove_entries', v_would_remove,
    'would_affect_employees', v_would_affect,
    'newest_removed_at', v_newest_removed,
    'undated_entries', v_undated
  );
end;
$function$;

-- The previous one-argument form had a DEFAULT of 180; replacing it with a
-- DEFAULT of NULL does not change the signature, so CREATE OR REPLACE is
-- enough and no second overload is created.
REVOKE ALL ON FUNCTION public.preview_scan_logs_trim(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_scan_logs_trim(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_scan_logs_trim(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run through Supabase/local/Invoke-Sql.ps1)
--
-- 1. Default state: off, nothing scheduled to go.
--
--      select jsonb_pretty(public.get_retention_settings());
--      -- scan_logs_days 0, effective_from null, active_now false
--
--      select jsonb_pretty(public.preview_scan_logs_trim());
--      -- retention_off true, would_remove_entries null
--
-- 2. The grace period, demonstrated without waiting a day. Inside a
--    transaction that always aborts, so the live setting is untouched:
--
--      begin;
--        select public.set_retention_days(90);
--        select (public.get_retention_settings()->>'active_now')::boolean as should_be_false,
--               public.get_retention_settings()->>'effective_from' as tomorrow,
--               (public.get_retention_settings()->>'days_until_active')::int as should_be_1;
--        -- and the job itself refuses to act today:
--        select * from public.trim_employee_scan_logs();
--        -- expect 0, 0, null
--      rollback;
--
-- 3. The floor is refused rather than silently raised:
--
--      begin;
--        select public.set_retention_days(30);  -- expect: ERROR
--      rollback;
--
-- 4. The schedule now passes no argument:
--
--      select jobname, schedule, command from cron.job
--       where jobname in ('trim-employee-scan-logs', 'archive-old-scan-events');
--      -- trim: SELECT public.trim_employee_scan_logs()
--      -- archive: unchanged, SELECT public.archive_old_scan_events(180)
