-- The archive horizon becomes a setting too, and the two settings stay
-- separate on purpose.
--
-- WHY NOT ONE NUMBER. "Keep scan history for N days" sounds like one idea
-- and is two, because the two jobs remove different things from different
-- places and the cost of each is different:
--
--   archive_old_scan_events()  MOVES scan_events rows to scan_events_archive.
--     Nothing is lost. get_scan_events_page() unions both tables, so an
--     export over any date range is unaffected — verified in 20261111120000
--     lines 111-117. What the horizon actually controls is how far back
--     SCANNER ANALYTICS AND THE DASHBOARD can see, because
--     get_scanner_performance_stats(), get_scanner_scan_details() and the
--     scan feed read scan_events only. 20260930000000 says so in its own
--     words: get_all_scan_events() was "the one place that needs to read
--     scan_events_archive too".
--
--   trim_employee_scan_logs()  DELETES employees.scan_logs entries. They are
--     gone, and because direction lives only in that array, rebuilding one
--     means replaying parity. What it controls is how far back ATTENDANCE
--     can report.
--
-- Folding both into a single "90 days" would mean someone choosing a faster
-- live table silently truncated payroll history to 90 days. Two numbers,
-- worded for what each one costs.
--
-- WHY THE DEFAULTS DIFFER, which is the same reasoning stated the other way:
-- trimming defaults to 0 (off) because it destroys; archiving defaults to
-- 180 (its current behaviour, preserved) because it does not, and switching
-- it off would let the live table grow until the Dashboard slowed down.
--
-- COST: one more column read inside a job that already runs. No new request.

-- ---------------------------------------------------------------------------
-- 1. The second horizon
-- ---------------------------------------------------------------------------
--
-- Floor of 90 for the same reason the hardcoded one had it:
-- get_scanner_performance_stats() and get_scanner_scan_details() both cap at
-- 90 days and read the live table only, so a shorter horizon would empty the
-- far end of Scanner Analytics with nothing to say why. 0 means "never
-- archive", which is allowed but is a performance choice, not a safety one.
ALTER TABLE public.retention_settings
  ADD COLUMN IF NOT EXISTS scan_events_days integer NOT NULL DEFAULT 180;

ALTER TABLE public.retention_settings
  DROP CONSTRAINT IF EXISTS retention_settings_scan_events_days_check;
ALTER TABLE public.retention_settings
  ADD CONSTRAINT retention_settings_scan_events_days_check
  CHECK (scan_events_days = 0 OR (scan_events_days >= 90 AND scan_events_days <= 3650));

-- NULL means "no change pending": the 180 default is the behaviour that has
-- been running all along, so it needs no grace period to begin. A grace date
-- is only ever written by set_archive_days() below.
ALTER TABLE public.retention_settings
  ADD COLUMN IF NOT EXISTS scan_events_effective_from date;

COMMENT ON COLUMN public.retention_settings.scan_events_days IS
  'How many days of scans stay in the live scan_events table. 0 = never archive. Controls how far back Scanner Analytics and the Dashboard can see; exports read the archive too and are unaffected.';

-- ---------------------------------------------------------------------------
-- 2. Reading both
-- ---------------------------------------------------------------------------
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
                              'scan_events_days', 180, 'archive_effective_from', null,
                              'archive_active_now', true, 'archive_days_until_active', null);
  end if;

  v_today := (now() at time zone r.tz)::date;

  return jsonb_build_object(
    -- Trimming: destroys, so off is the default and the state matters.
    'scan_logs_days', r.scan_logs_days,
    'effective_from', r.effective_from,
    'active_now', r.scan_logs_days > 0
                  and r.effective_from is not null
                  and v_today >= r.effective_from,
    'days_until_active', case
      when r.scan_logs_days = 0 or r.effective_from is null then null
      else greatest(0, r.effective_from - v_today)
    end,
    -- Archiving: relocates. A NULL effective date means the stored value has
    -- been in force all along rather than waiting to start, which is why
    -- archive_active_now is true in that case and active_now is not.
    'scan_events_days', r.scan_events_days,
    'archive_effective_from', r.scan_events_effective_from,
    'archive_active_now', r.scan_events_days > 0
                          and (r.scan_events_effective_from is null
                               or v_today >= r.scan_events_effective_from),
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

-- ---------------------------------------------------------------------------
-- 3. Changing it
-- ---------------------------------------------------------------------------
--
-- The same grace period as the trim, and for a weaker reason that is still a
-- reason: archiving loses nothing, but choosing 90 when you meant 900 moves
-- a hundred thousand rows out of every analytics view, and a day to notice
-- costs nothing. The wording in the panel is what distinguishes reversible
-- from not — the mechanism is the same so there is one rule to learn.
CREATE OR REPLACE FUNCTION public.set_archive_days(p_days integer)
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

  if v_days <> 0 and (v_days < 90 or v_days > 3650) then
    raise exception 'archive horizon must be 0 (never archive) or between 90 and 3650 days';
  end if;

  select tz into v_tz from public.retention_settings where id;
  v_tz := coalesce(v_tz, 'Asia/Manila');
  v_from := case when v_days = 0 then null
                 else ((now() at time zone v_tz)::date + 1) end;

  update public.retention_settings
     set scan_events_days = v_days,
         scan_events_effective_from = v_from,
         updated_at = now(),
         updated_by = auth.uid()
   where id;

  perform public.log_audit_event(
    'archive_horizon_changed', 'retention_settings', 'retention',
    jsonb_build_object('scan_events_days', v_days, 'effective_from', v_from, 'tz', v_tz));

  return public.get_retention_settings();
end;
$function$;

REVOKE ALL ON FUNCTION public.set_archive_days(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_archive_days(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_archive_days(integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The job obeys it
-- ---------------------------------------------------------------------------
--
-- Signature and return type unchanged, so ScanArchiveModel.js and the panel
-- keep working. p_older_than_days is now an override that can only keep MORE
-- in the live table, matching the rule trim_employee_scan_logs() already
-- follows: the setting is a floor on what stays, never a suggestion.
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

  -- Never archive. Allowed, and a performance choice rather than a safety
  -- one: the live table then grows without bound and the Dashboard slows.
  if coalesce(v_set_days, 180) = 0 then
    return query select 0, null::timestamptz;
    return;
  end if;

  -- A pending change waits for its day, exactly as the trim does. A NULL
  -- effective date means the stored horizon has been in force all along and
  -- there is nothing to wait for.
  if v_from is not null
     and (now() at time zone coalesce(v_tz, 'Asia/Manila'))::date < v_from then
    return query select 0, null::timestamptz;
    return;
  end if;

  v_days := greatest(coalesce(v_set_days, 180), coalesce(p_older_than_days, coalesce(v_set_days, 180)));
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
  'Moves scan_events rows older than retention_settings.scan_events_days into scan_events_archive. Nothing is deleted: get_scan_events_page() unions both tables. The horizon controls how far back Scanner Analytics and the Dashboard can see, since those read the live table only. p_older_than_days can only widen what stays live.';

REVOKE ALL ON FUNCTION public.archive_old_scan_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_old_scan_events(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_old_scan_events(integer) TO authenticated;

-- The schedule must stop passing 180, for the same reason the trim's did:
-- with the override rule above, a hardcoded 180 against a stored 90 would
-- mean the 90 was never honoured.
SELECT cron.unschedule('archive-old-scan-events')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive-old-scan-events');

SELECT cron.schedule(
  'archive-old-scan-events',
  '0 3 * * *',
  $$SELECT public.archive_old_scan_events()$$
);

-- ---------------------------------------------------------------------------
-- 5. What the next archival run would move
-- ---------------------------------------------------------------------------
--
-- Cheap, unlike the trim's preview: one COUNT over idx_scan_events_scanned_at
-- rather than an unnest of every jsonb array. Still behind an explicit press,
-- for symmetry and because nothing should poll it.
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

  if coalesce(v_set_days, 180) = 0 then
    return jsonb_build_object('archiving_off', true, 'cutoff', null,
                              'horizon_days', 0, 'would_move_rows', null,
                              'oldest_live_at', (select min(scanned_at) from public.scan_events));
  end if;

  v_days := greatest(coalesce(v_set_days, 180), coalesce(p_older_than_days, coalesce(v_set_days, 180)));
  v_cutoff := now() - make_interval(days => v_days);

  -- Two statements rather than one count(*) filter(...): both of these use
  -- idx_scan_events_scanned_at, where a filtered aggregate would force a
  -- sequential scan over 183,000 rows to answer the same question.
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
-- 1. Current state: archiving on at 180 with no pending change, trimming as
--    you left it.
--
--      select jsonb_pretty(public.get_retention_settings());
--      -- scan_events_days 180, archive_effective_from null,
--      -- archive_active_now true
--
--      select jsonb_pretty(public.preview_scan_events_archive());
--      -- would_move_rows 0 while the oldest live row is inside 180 days
--
-- 2. The grace period on a change, without waiting a day:
--
--      begin;
--        select public.set_archive_days(90);
--        select public.get_retention_settings()->>'archive_effective_from' as tomorrow,
--               (public.get_retention_settings()->>'archive_active_now')::boolean as should_be_false;
--        select * from public.archive_old_scan_events();  -- expect 0, null
--      rollback;
--
-- 3. The floor is refused, and 0 is accepted as "never archive":
--
--      begin;
--        select public.set_archive_days(45);   -- expect: ERROR
--      rollback;
--      begin;
--        select public.set_archive_days(0);    -- allowed
--        select * from public.archive_old_scan_events();  -- expect 0, null
--      rollback;
--
-- 4. Both schedules now pass no argument:
--
--      select jobname, command from cron.job
--       where jobname in ('archive-old-scan-events', 'trim-employee-scan-logs');
