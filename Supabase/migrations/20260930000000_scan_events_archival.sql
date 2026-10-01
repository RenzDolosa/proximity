-- Scan-data archival/retention: scan_events is a high-write, append-only
-- table with no natural cap (10,368 rows and counting after 3 days live —
-- see README.md's change log). This does not delete history: it moves
-- rows older than the retention window into scan_events_archive, a
-- separate table with the same shape, on a daily pg_cron schedule.
--
-- Why archive instead of delete: this is an access-control audit trail.
-- An admin's "Export all scan logs" (get_all_scan_events()) needs to keep
-- working for old date ranges, and there is no feature in this app that
-- benefits from old scan rows being gone forever rather than just out of
-- the hot table.
--
-- Why 180 days is safe as a default: every OTHER function that reads
-- scan_events by a caller-supplied window clamps that window well under
-- 180 days — get_scanner_performance_stats() and
-- get_scanner_scan_details() both clamp p_days to a max of 90,
-- get_attendance_report() clamps its date range to 31 days — so at the
-- default retention, archiving can never remove a row any of those three
-- could still be asked for. Only get_all_scan_events() (the raw admin
-- export, with no day cap by design) can reach past the retention window,
-- which is why it's the one function below that's updated to read both
-- tables. scan_proximity_code() (the insert path) never reads scan_events
-- at all — direction comes from employees.scan_logs, which this migration
-- does not touch — so live scanning is entirely unaffected either way.
--
-- Deliberately NOT touched in this pass: employees.scan_logs (also
-- unbounded jsonb, also on the roadmap) and employees.remarks_log (39
-- entries total right now — not a real growth problem yet). scan_logs
-- backs get_attendance_report() and get_onsite_roster() (direction is
-- derived from it, not from scan_events), so trimming it safely needs its
-- own careful pass rather than being folded into this one.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE TABLE public.scan_events_archive (
  id uuid PRIMARY KEY,
  proximity_code text NOT NULL,
  -- No foreign keys here, unlike scan_events (which has ON DELETE CASCADE
  -- to both employees and proximity_cards): this table exists specifically
  -- to survive its parent rows. Cascading the same way the live table does
  -- would mean hard-deleting an employee erases their archived history too,
  -- defeating the point of an audit trail.
  employee_id uuid,
  proximity_card_id uuid,
  scanner_id text NOT NULL,
  result text NOT NULL CHECK (result = ANY (ARRAY['matched','unmatched','inactive_card','inactive_employee','unassigned_card'])),
  scanned_at timestamptz NOT NULL,
  raw_payload jsonb,
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_scan_events_archive_scanned_at ON public.scan_events_archive (scanned_at DESC);
CREATE INDEX idx_scan_events_archive_employee ON public.scan_events_archive (employee_id);
COMMENT ON TABLE public.scan_events_archive IS 'Rows moved out of scan_events by archive_old_scan_events() once past the retention window (default 180 days). Same visibility tier as scan_events; written only by that function, never directly by client code.';

ALTER TABLE public.scan_events_archive ENABLE ROW LEVEL SECURITY;
-- Same read boundary as the live table (scan_events_select_scope). No
-- INSERT/UPDATE/DELETE policy at all: only archive_old_scan_events()
-- (SECURITY DEFINER, owned by the migration role) ever writes here, which
-- bypasses RLS the same way every other write path in this schema does.
CREATE POLICY scan_events_archive_select_scope ON public.scan_events_archive
  FOR SELECT TO authenticated USING (is_admin() OR can_view_scanner());

CREATE OR REPLACE FUNCTION public.archive_old_scan_events(p_older_than_days integer DEFAULT 180)
RETURNS TABLE(archived_count integer, cutoff timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  -- Floored at 90 so neither a bad argument from the admin-triggered path
  -- nor a future edit to the cron schedule's hardcoded value can shrink
  -- the window below what get_scanner_performance_stats()/
  -- get_scanner_scan_details() might still ask for (both cap at 90 days).
  v_days integer := greatest(90, coalesce(p_older_than_days, 180));
  v_cutoff timestamptz := now() - make_interval(days => v_days);
  v_count integer;
begin
  -- Callable two ways: by pg_cron's scheduled job below (no PostgREST
  -- request, so auth.uid() — which reads request.jwt.claims — is null;
  -- there is no caller to check, so this simply proceeds), and by an admin
  -- from Settings for an on-demand run (a real request, so auth.uid() is
  -- set and must belong to an admin). Anyone else calling this via REST
  -- gets refused, same as every other admin-only RPC in this schema.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to run scan archival';
  end if;

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

REVOKE ALL ON FUNCTION public.archive_old_scan_events(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_old_scan_events(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_old_scan_events(integer) TO authenticated;

-- Read-only status for the Settings panel: current live/archive counts,
-- how old the oldest live row is, and (best-effort — see the exception
-- handler) the scheduled job's own last-run record from pg_cron's own
-- history table, so an admin can see it's actually running without
-- needing database access.
CREATE OR REPLACE FUNCTION public.get_scan_archive_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_live_count bigint;
  v_oldest_live timestamptz;
  v_archive_count bigint;
  v_last_archived_at timestamptz;
  v_last_run jsonb;
begin
  if not public.is_admin() then
    raise exception 'not permitted to view scan archive status';
  end if;

  select count(*), min(scanned_at) into v_live_count, v_oldest_live from public.scan_events;
  select count(*), max(archived_at) into v_archive_count, v_last_archived_at from public.scan_events_archive;

  -- Best-effort: cron.job_run_details is pg_cron's own history table, not
  -- something this app controls the shape or availability of, so a
  -- failure here (e.g. a future pg_cron version renaming a column) must
  -- not take down the rest of this status readout.
  begin
    select jsonb_build_object('status', jrd.status, 'started_at', jrd.start_time,
                               'ended_at', jrd.end_time, 'message', jrd.return_message)
    into v_last_run
    from cron.job_run_details jrd
    join cron.job j on j.jobid = jrd.jobid
    where j.jobname = 'archive-old-scan-events'
    order by jrd.start_time desc
    limit 1;
  exception when others then
    v_last_run := null;
  end;

  return jsonb_build_object(
    'live_count', v_live_count,
    'oldest_live_scanned_at', v_oldest_live,
    'archive_count', v_archive_count,
    'last_archived_at', v_last_archived_at,
    'last_run', v_last_run
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.get_scan_archive_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scan_archive_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_scan_archive_status() TO authenticated;

-- get_all_scan_events() is the one function whose whole point is an
-- arbitrary historical date-range export, so it's the one place that
-- needs to read scan_events_archive too — otherwise archiving would make
-- old rows silently vanish from an admin's own export feature. Argument
-- types are unchanged from the existing function, so this is a true
-- CREATE OR REPLACE (see README.md's CREATE OR REPLACE gotcha note) —
-- not a new overload left orphaned alongside the old one.
CREATE OR REPLACE FUNCTION public.get_all_scan_events(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS TABLE(scanned_at timestamptz, employee_name text, department text, proximity_code text, scanner_id text, result text, direction text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- Required here specifically: several of this function's own OUT
-- parameters above (proximity_code, scanner_id, result, scanned_at) share
-- a name with a column in the UNION ALL subquery below, which PL/pgSQL
-- otherwise reports as an ambiguous column reference. Same pragma, same
-- reason, as get_attendance_report()'s own #variable_conflict line.
begin
  if not public.is_admin_or_manager() then
    raise exception 'not permitted to export scan history';
  end if;

  return query
    select se.scanned_at, e.full_name, e.department, se.proximity_code,
           se.scanner_id, se.result,
           (
             select elem->>'direction'
             from jsonb_array_elements(e.scan_logs) as elem
             where elem->>'scan_id' = se.id::text
             limit 1
           ) as direction
    from (
      select id, proximity_code, employee_id, scanner_id, result, scanned_at from public.scan_events
      union all
      select id, proximity_code, employee_id, scanner_id, result, scanned_at from public.scan_events_archive
    ) se
    left join public.employees e on e.id = se.employee_id
    where (p_from is null or se.scanned_at >= p_from)
      and (p_to is null or se.scanned_at <= p_to)
    order by se.scanned_at desc
    limit 100000;
end;
$function$;

-- Idempotent scheduling: re-running this migration must not create a
-- second, duplicate daily job alongside the first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive-old-scan-events') THEN
    PERFORM cron.unschedule('archive-old-scan-events');
  END IF;
END $$;

SELECT cron.schedule(
  'archive-old-scan-events',
  '0 3 * * *', -- daily at 03:00 UTC, off-peak for a system whose employees are presumably not scanning in at that hour
  $$SELECT public.archive_old_scan_events(180)$$
);
