-- Proactive "scanner went silent" alerting — see
-- scanner-silence-alerts-plan.md (repo root, deleted once this shipped;
-- check git history for it if you need the original design rationale)
-- for the full plan this implements.
--
-- Reconciliation note: check_scanner_silence(), get_scanner_silence_status(),
-- and the check-scanner-silence cron job were already live on this project
-- before this migration file existed — built directly against the
-- database with no corresponding commit. This migration is written to
-- reproduce that live state exactly, with one real bug fixed in the
-- process (found by verifying the live behavior against the actual
-- schema rather than trusting it matched the plan): both functions
-- originally filtered on `last_seen_at is not null`, intended to exclude
-- a scanner that "was provisioned but never scanned". That condition can
-- never be true — public.scanners.last_seen_at is NOT NULL with a
-- DEFAULT of now(), and scan_proximity_code() is the ONLY code path that
-- ever creates a scanners row:
--   insert into public.scanners (scanner_id) values (p_scanner_id)
--   on conflict (scanner_id) do update set last_seen_at = now();
-- A row cannot exist without a real scan having already happened to
-- create it, so there is no "registered but never scanned" state
-- reachable in this schema. The check was always vacuously true and
-- never excluded anything; removed rather than left in place, since dead
-- code implying a safeguard that doesn't actually do anything is worse
-- for the next reader than no comment at all.
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

-- Status read for Settings' "Scanner silence alerts" panel — same
-- shape/pattern as get_scan_archive_status() / get_scan_logs_trim_status().
-- Same never-null fix as above.
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
  v_last_run jsonb;
begin
  if not public.is_admin() then
    raise exception 'not permitted to view scanner silence status';
  end if;

  select count(*) into v_total from public.scanners;
  select count(*) into v_enabled from public.scanners where is_enabled;
  select count(*) into v_silent
  from public.scanners
  where is_enabled = true
    and last_seen_at <= now() - make_interval(mins => v_minutes);

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
    'last_run', v_last_run
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_scanner_silence_status(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_silence_status(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scanner_silence_status(integer) TO authenticated;

-- Schedule — already live under this name/cadence; recreated
-- idempotently so this migration is a true, reproducible statement of
-- what's deployed. Every 15 minutes, NOT daily like the archive/trim
-- jobs: a scanner outage is time-sensitive (someone should find out
-- within the hour, not the next morning) in a way overnight housekeeping
-- is not.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-scanner-silence') THEN
    PERFORM cron.unschedule('check-scanner-silence');
  END IF;
END $$;

SELECT cron.schedule(
  'check-scanner-silence',
  '*/15 * * * *',
  $$SELECT public.check_scanner_silence(60)$$
);
