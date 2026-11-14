-- Make the archive horizon behave exactly like the scan-log trim horizon.
--
-- Asked for twice, and I diverged twice on my own judgement: the archive
-- horizon shipped with a default of 180 and a guard that treated "no
-- effective date" as "carry on", while the trim shipped with a default of 0
-- and a guard that treated the same state as "do nothing". The reasoning was
-- that archiving relocates rather than destroys, so leaving it on is free.
--
-- That reasoning is not wrong, and it is not the point. Two adjacent panels
-- that look identical and follow different rules is a worse property than
-- either rule on its own, because the rule a person learns from one is the
-- rule they will assume for the other. Same mechanism, same defaults, one
-- thing to know.
--
-- WHAT STAYS DIFFERENT, and why these are not inconsistencies:
--   * The FLOOR: 30 for archiving, 90 for trimming. Asked for explicitly,
--     and load-bearing — get_attendance_report() reads 31-day ranges out of
--     scan_logs, so a 30-day trim would race the job deleting the month it
--     is reporting on. Archiving has no such caller since 20261114090000
--     taught the Analytics drilldown to read the archive.
--   * The WORDING: archiveSummary() never says "deleted", because archiving
--     does not delete. That is accuracy, not a divergent rule.
--
-- EFFECT ON THIS PROJECT TODAY: none observable. scan_events_days is 180 and
-- the oldest live row is ~48 days old, so the job has never moved a row and
-- will not start to. After this it reads 0 and waits to be chosen, exactly
-- as the trim did when it shipped.

-- ---------------------------------------------------------------------------
-- 1. Default 0, like the trim
-- ---------------------------------------------------------------------------
ALTER TABLE public.retention_settings
  ALTER COLUMN scan_events_days SET DEFAULT 0;

-- The existing row is normalised too, not just the default for rows nobody
-- will ever insert — this table holds exactly one row by construction, so a
-- default alone would have changed nothing at all.
--
-- Deliberately a reset to "unchosen" rather than carrying 180 forward with a
-- grace date. The trim shipped off and waited to be chosen; this now does
-- the same thing, and the operator makes one decision in one place with the
-- same meaning on both sides of the panel.
UPDATE public.retention_settings
   SET scan_events_days = 0,
       scan_events_effective_from = NULL,
       updated_at = now()
 WHERE id;

COMMENT ON COLUMN public.retention_settings.scan_events_days IS
  'How many days of scans stay in the live scan_events table. 0 = never archive, and the default, matching scan_logs_days. Controls how far back Scanner Analytics and the Dashboard can see; exports read the archive too and are unaffected.';

-- ---------------------------------------------------------------------------
-- 2. The same guard, character for character
-- ---------------------------------------------------------------------------
--
-- WAS:  if v_from is not null and today < v_from  -- null => run anyway
-- NOW:  if v_from is null     or  today < v_from  -- null => do nothing
--
-- The second is the trim's rule: never act without a dated decision. Since
-- set_archive_days() always writes a date when the horizon is non-zero, the
-- only way to reach a non-zero horizon with a null date is the row this
-- migration just reset — which is now zero anyway.
CREATE OR REPLACE FUNCTION public.archive_old_scan_events(p_older_than_days integer DEFAULT NULL)
RETURNS TABLE(archived_count integer, cutoff timestamptz)
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
  v_count integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to run scan archival';
  end if;

  select scan_events_days, scan_events_effective_from, tz
    into v_set_days, v_from, v_tz
    from public.retention_settings where id;

  -- Off, and now the default. coalesce to 0 rather than 180: an absent row
  -- must mean the same thing as a row saying zero.
  if coalesce(v_set_days, 0) = 0 then
    return query select 0, null::timestamptz;
    return;
  end if;

  -- The trim's guard, verbatim.
  if v_from is null
     or (now() at time zone coalesce(v_tz, 'Asia/Manila'))::date < v_from then
    return query select 0, null::timestamptz;
    return;
  end if;

  -- Floored at 30 to match the CHECK, so a row written by a direct UPDATE
  -- cannot push the cutoff nearer than the Analytics drilldown reaches back.
  v_days := greatest(30, v_set_days);
  v_days := greatest(v_days, coalesce(p_older_than_days, v_days));
  v_cutoff := now() - make_interval(days => v_days);

  WITH moved AS (
    DELETE FROM public.scan_events
    WHERE scanned_at < v_cutoff
    RETURNING id, proximity_code, employee_id, proximity_card_id, scanner_id, result, scanned_at, raw_payload
  )
  INSERT INTO public.scan_events_archive
    (id, proximity_code, employee_id, proximity_card_id, scanner_id, result, scanned_at, raw_payload)
  SELECT id, proximity_code, employee_id, proximity_card_id, scanner_id, result, scanned_at, raw_payload
  FROM moved;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count, v_cutoff;
end;
$function$;

COMMENT ON FUNCTION public.archive_old_scan_events(integer) IS
  'Moves scan_events rows older than retention_settings.scan_events_days into scan_events_archive. Nothing is deleted: get_scan_events_page() unions both tables. Same rules as trim_employee_scan_logs() — 0 is off and the default, a change takes effect the following local day, and no dated decision means no run. Floor 30; the trim''s is 90.';

REVOKE ALL ON FUNCTION public.archive_old_scan_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_old_scan_events(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_old_scan_events(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The readouts agree with the new rule
-- ---------------------------------------------------------------------------
--
-- archive_active_now now requires a date, exactly as active_now does. With
-- the old expression a row holding a horizon and no date reported itself as
-- running while the job above refused to run, which is the specific kind of
-- disagreement this project keeps finding and removing.
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
                              'days_until_active', null, 'updated_at', null,
                              'scan_events_days', 0, 'archive_effective_from', null,
                              'archive_active_now', false, 'archive_days_until_active', null);
  end if;

  v_today := (now() at time zone r.tz)::date;

  return jsonb_build_object(
    'scan_logs_days', r.scan_logs_days,
    'effective_from', r.effective_from,
    'active_now', r.scan_logs_days > 0
                  and r.effective_from is not null
                  and v_today >= r.effective_from,
    'days_until_active', case
      when r.scan_logs_days = 0 or r.effective_from is null then null
      else greatest(0, r.effective_from - v_today)
    end,
    -- Identical shape to the two above.
    'scan_events_days', r.scan_events_days,
    'archive_effective_from', r.scan_events_effective_from,
    'archive_active_now', r.scan_events_days > 0
                          and r.scan_events_effective_from is not null
                          and v_today >= r.scan_events_effective_from,
    'archive_days_until_active', case
      when r.scan_events_days = 0 or r.scan_events_effective_from is null then null
      else greatest(0, r.scan_events_effective_from - v_today)
    end,
    'tz', r.tz,
    'today', v_today,
    'updated_at', r.updated_at
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_retention_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_retention_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_retention_settings() TO authenticated;

-- The preview follows the same change: an absent row means off, not 180.
CREATE OR REPLACE FUNCTION public.preview_scan_events_archive(p_older_than_days integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_set_days integer;
  v_days integer;
  v_cutoff timestamptz;
  v_rows bigint;
  v_oldest timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not permitted to preview archival';
  end if;

  select scan_events_days into v_set_days from public.retention_settings where id;

  if coalesce(v_set_days, 0) = 0 then
    return jsonb_build_object('archiving_off', true, 'cutoff', null,
                              'horizon_days', 0, 'would_move_rows', null,
                              'oldest_live_at', (select min(scanned_at) from public.scan_events));
  end if;

  v_days := greatest(30, v_set_days);
  v_days := greatest(v_days, coalesce(p_older_than_days, v_days));
  v_cutoff := now() - make_interval(days => v_days);

  select count(*) into v_rows from public.scan_events where scanned_at < v_cutoff;
  select min(scanned_at) into v_oldest from public.scan_events;

  return jsonb_build_object(
    'archiving_off', false,
    'cutoff', v_cutoff,
    'horizon_days', v_days,
    'would_move_rows', v_rows,
    'oldest_live_at', v_oldest
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.preview_scan_events_archive(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preview_scan_events_archive(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.preview_scan_events_archive(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- VERIFY (run through Supabase/local/Invoke-Sql.ps1)
--
-- 1. Both halves now read the same way. scan_events_days 0,
--    archive_effective_from null, archive_active_now FALSE — the same three
--    values scan_logs_days had before you chose a horizon for it:
--
--      select jsonb_pretty(public.get_retention_settings());
--
-- 2. Neither job does anything until chosen:
--
--      select * from public.archive_old_scan_events();   -- 0, null
--      select * from public.trim_employee_scan_logs();   -- 0, 0, null
--
-- 3. Choosing a horizon waits a day, on both sides:
--
--      begin;
--        select public.set_archive_days(30);
--        select (public.get_retention_settings()->>'archive_active_now')::boolean as should_be_false,
--               public.get_retention_settings()->>'archive_effective_from' as tomorrow;
--        select * from public.archive_old_scan_events();  -- 0, null
--      rollback;
--
-- 4. The floors still differ, as asked:
--
--      begin; select public.set_archive_days(30);   rollback;  -- allowed
--      begin; select public.set_retention_days(30); rollback;  -- ERROR
