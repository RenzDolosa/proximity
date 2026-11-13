-- Tell somebody when a punch never closes.
--
-- WHY THIS IS WORTH AN ALERT RATHER THAN A REPORT. 20261103120000 added
-- get_open_punch_closures(), a review queue an admin has to remember to
-- open. Measured on the live project that day: 382 of 3,345 employee-days in
-- a one-week window carried open_punch. Nothing announces them.
--
-- And an open punch is not one bad row. Direction is parity over an
-- employee's whole history (employees.scan_parity_count, 20261001040000), so
-- a missing OUT leaves that employee one step out of phase for EVERY scan
-- after it — the next morning's arrival is stored as an OUT.
-- get_attendance_report() builds its days with `where s.dir = 'in'`, so a day
-- whose first scan is mislabelled OUT is not under-counted, it is dropped
-- from the report entirely. One missed tap-out can hide every subsequent day
-- for that person, silently, until someone queries payroll and finds a gap.
--
-- Catching it the same evening is worth far more than catching it in a
-- monthly review, and the machinery to do that already exists: raise_alert()
-- with a dedupe key, and alert_channels delivering to Telegram.
--
-- COST. Runs inside pg_cron, server-side. No PostgREST request, so no API
-- gateway log line and no egress. The scan below is a single pass over
-- public.employees (814 rows) reading the LAST element of each scan_logs
-- array — not a jsonb_array_elements unnest of the whole history, which is
-- what the review queue does and what would make this expensive hourly.
-- cron.job_run_details measured zero live rows on 2026-11-11, so the
-- schedule itself adds no durable storage either.

-- ---------------------------------------------------------------------------
-- 1. The check
-- ---------------------------------------------------------------------------
--
-- WHY THE LAST ELEMENT IS ENOUGH. 20261024090000 made trg_append_scan_log()
-- re-sort scan_logs by scanned_at and re-derive direction on every append, so
-- the final element is always the most recent scan and its `direction` is
-- authoritative. An employee whose latest scan is an IN is, by definition,
-- currently inside as far as the system knows. The review queue's
-- `next_dir is distinct from 'out'` test finds historical open punches too;
-- this only needs the one that is still open right now, which is the only
-- one anybody can still do something about.
CREATE OR REPLACE FUNCTION public.check_open_punches(p_hours integer DEFAULT 12)
RETURNS TABLE(employees_flagged integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  -- Floored at 4. Anything shorter would fire for a normal lunch-time
  -- half-shift, and an alert that cries wolf is one people learn to ignore —
  -- the same reasoning as check_scanner_silence()'s 15-minute floor.
  v_hours integer := greatest(4, coalesce(p_hours, 12));
  v_count integer := 0;
  r record;
begin
  -- Same two-caller permission split as check_scanner_silence() and the
  -- archive/trim jobs: pg_cron has no request behind it (auth.uid() is null,
  -- proceed); an admin running it on demand is a real request and must be
  -- an admin.
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'not permitted to check open punches';
  end if;

  for r in
    select e.id,
           e.full_name,
           e.employee_code,
           e.department,
           (e.scan_logs -> -1 ->> 'scanned_at')::timestamptz as in_at,
           e.scan_logs -> -1 ->> 'scanner_id' as scanner_id
      from public.employees e
     where e.status = 'active'
       and jsonb_array_length(e.scan_logs) > 0
       and e.scan_logs -> -1 ->> 'direction' = 'in'
       and (e.scan_logs -> -1 ->> 'scanned_at')::timestamptz
             <= now() - make_interval(hours => v_hours)
  loop
    perform public.raise_alert(
      'open_punch', 'warning',
      coalesce(r.full_name, r.employee_code, 'An employee')
        || ' scanned in ' || v_hours || '+ hours ago and has not scanned out',
      jsonb_build_object(
        'employee_id', r.id,
        'employee_code', r.employee_code,
        'full_name', r.full_name,
        'department', r.department,
        'scanner_id', r.scanner_id,
        'in_at', r.in_at,
        'hours', v_hours
      ),
      -- Keyed on the employee AND the day of the open IN, so one person
      -- gets one alert per stuck punch rather than one per hourly run. The
      -- 1440-minute window covers the rest of that day; a punch still open
      -- tomorrow is genuinely new information and should say so again.
      'open-punch:' || r.id::text || ':' || (r.in_at at time zone 'Asia/Manila')::date::text,
      1440
    );
    v_count := v_count + 1;
  end loop;

  return query select v_count;
end;
$function$;

COMMENT ON FUNCTION public.check_open_punches(integer) IS
  'Raises an open_punch alert for every active employee whose most recent scan is an IN older than p_hours (floor 4, default 12). Deduped per employee per day. Called hourly by pg_cron; an admin may also run it on demand.';

REVOKE ALL ON FUNCTION public.check_open_punches(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_open_punches(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_open_punches(integer) TO authenticated;

-- PostgREST caches the schema in memory. pg_cron reaches this function
-- directly and would not care, but an admin running it on demand goes
-- through PostgREST and would get PGRST202 until the cache happened to
-- refresh on its own.
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 2. The schedule
-- ---------------------------------------------------------------------------
--
-- Hourly, not every 15 minutes like the silence check. A forgotten tap-out
-- is not time-critical the way a dead scanner is — nobody is going to act on
-- it within the quarter hour — and the dedupe window means a finer schedule
-- would produce identical output at four times the cost.
--
-- Unscheduled first so re-applying this migration cannot leave two jobs
-- racing, the same guard 20261110090000 uses.
SELECT cron.unschedule('check-open-punches')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-open-punches');

SELECT cron.schedule(
  'check-open-punches',
  '20 * * * *', -- hourly at :20, away from the :00 and :15 the other jobs use
  $$SELECT public.check_open_punches(12)$$
);

-- VERIFY (run in psql via Supabase/local/Invoke-Sql.ps1; read-only)
--
-- Who would be flagged right now, without raising anything:
--
--   select e.full_name,
--          (e.scan_logs -> -1 ->> 'scanned_at')::timestamptz as in_at,
--          round(extract(epoch from (now() - (e.scan_logs -> -1 ->> 'scanned_at')::timestamptz)) / 3600, 1) as hours_open
--     from public.employees e
--    where e.status = 'active'
--      and jsonb_array_length(e.scan_logs) > 0
--      and e.scan_logs -> -1 ->> 'direction' = 'in'
--      and (e.scan_logs -> -1 ->> 'scanned_at')::timestamptz <= now() - interval '12 hours'
--    order by in_at;
--
-- Confirm the job is scheduled exactly once:
--
--   select jobname, schedule, active from cron.job where jobname = 'check-open-punches';
