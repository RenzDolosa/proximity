-- Phase 1 of the employees.scan_logs trim plan (scan-logs-trim-plan.md).
-- Requires Phase 0 (20261001040000_scan_logs_parity_counter.sql) to already
-- be live and verified — this job shrinks scan_logs, and without Phase 0's
-- durable scan_parity_count, shrinking it would silently flip IN/OUT
-- direction for every active employee. Phase 0 shipped and was verified
-- (continuity for a fresh employee, an existing employee, and
-- get_scanner_offline_cache()'s scan_count) before this file was written.
--
-- Why no archive table, unlike scan_events_archive: every scan_logs entry
-- carries a scan_id pointing back to a real scan_events row (now possibly
-- in scan_events_archive since 2026-09-30). Trimming old entries out of
-- scan_logs loses no data that isn't already durably stored elsewhere — it
-- is a derived cache, not a second source of truth — so this can be a
-- plain DELETE-the-old-elements job. employees.remarks_log is explicitly
-- NOT touched here: a remark has no other copy anywhere, so trimming it for
-- real would need its own archive table, which is a different piece of
-- work (see scan-logs-trim-plan.md's "Explicitly out of scope" section).
--
-- Floor of 90 days, same reasoning as archive_old_scan_events(): nothing
-- in this app ever asks scan_logs for more than that (get_attendance_report
-- caps at 31 days), and matching scan_events_archive's own 180-day default
-- means "how far back can I see history" means the same thing everywhere
-- in the app, not a different number per feature.

CREATE OR REPLACE FUNCTION public.trim_employee_scan_logs(p_older_than_days integer DEFAULT 180)
RETURNS TABLE(employees_trimmed integer, entries_removed integer, cutoff timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  -- Same floor, and the same two callers (pg_cron with no auth context, or
  -- an admin on demand from Settings), as archive_old_scan_events().
  v_days integer := greatest(90, coalesce(p_older_than_days, 180));
  v_cutoff timestamptz := now() - make_interval(days => v_days);
  v_employees_trimmed integer;
  v_entries_removed integer;
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to run scan-log trimming';
  end if;

  with candidates as (
    -- Scoped to employees who actually have at least one entry — most of
    -- 729 employees average 17 entries total, so this scan is cheap, but
    -- there is no reason to touch a row with an empty array.
    select e.id,
           jsonb_array_length(e.scan_logs) as old_len,
           (select coalesce(jsonb_agg(elem), '[]'::jsonb)
            from jsonb_array_elements(e.scan_logs) as elem
            where (elem->>'scanned_at')::timestamptz >= v_cutoff) as new_logs
    from public.employees e
    where jsonb_array_length(e.scan_logs) > 0
  ),
  to_trim as (
    -- Only rows that actually shrink get written — an employee whose
    -- oldest entry is already newer than the cutoff is left untouched
    -- rather than rewritten to its own identical value.
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

REVOKE ALL ON FUNCTION public.trim_employee_scan_logs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trim_employee_scan_logs(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.trim_employee_scan_logs(integer) TO authenticated;

-- Read-only status for the Settings panel: total scan_logs entries across
-- every employee (a sense of scale, not a space-reclamation gauge — as of
-- this migration, 729 employees, 12,792 entries total, max 137 on one
-- employee, well under anything worth worrying about today) plus the
-- scheduled job's own last-run record, same best-effort pattern as
-- get_scan_archive_status() (pg_cron's history table is not this app's to
-- control the shape of, so a failure reading it must not take down the
-- rest of this status readout).
CREATE OR REPLACE FUNCTION public.get_scan_logs_trim_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_total_entries bigint;
  v_employees_with_entries bigint;
  v_max_entries integer;
  v_last_run jsonb;
begin
  if not public.is_admin() then
    raise exception 'not permitted to view scan-log trim status';
  end if;

  select coalesce(sum(jsonb_array_length(scan_logs)), 0),
         count(*) filter (where jsonb_array_length(scan_logs) > 0),
         coalesce(max(jsonb_array_length(scan_logs)), 0)
  into v_total_entries, v_employees_with_entries, v_max_entries
  from public.employees;

  begin
    select jsonb_build_object('status', jrd.status, 'started_at', jrd.start_time,
                               'ended_at', jrd.end_time, 'message', jrd.return_message)
    into v_last_run
    from cron.job_run_details jrd
    join cron.job j on j.jobid = jrd.jobid
    where j.jobname = 'trim-employee-scan-logs'
    order by jrd.start_time desc
    limit 1;
  exception when others then
    v_last_run := null;
  end;

  return jsonb_build_object(
    'total_entries', v_total_entries,
    'employees_with_entries', v_employees_with_entries,
    'max_entries_for_one_employee', v_max_entries,
    'last_run', v_last_run
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_scan_logs_trim_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scan_logs_trim_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scan_logs_trim_status() TO authenticated;

-- Idempotent re-run guard, same convention as the archival job's schedule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'trim-employee-scan-logs') THEN
    PERFORM cron.unschedule('trim-employee-scan-logs');
  END IF;
END $$;

SELECT cron.schedule(
  'trim-employee-scan-logs',
  '10 3 * * *', -- daily at 03:10 UTC — same off-peak window as archive-old-scan-events, offset 10 minutes so the two jobs don't start in the same instant
  $$SELECT public.trim_employee_scan_logs(180)$$
);
