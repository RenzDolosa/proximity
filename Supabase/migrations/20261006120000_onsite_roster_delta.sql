-- The Dashboard on-site roster, incrementally.
--
-- THE DEFECT THIS FIXES
--
-- 20261005000000 added `roster_version` to get_dashboard_pulse() so the
-- Dashboard's 30-second refresh could skip re-downloading the roster when
-- nothing in `employees` had changed. That version is
-- `md5(count(*) || max(updated_at))`.
--
-- Every matched scan runs `UPDATE public.employees SET scan_logs = ...,
-- scan_parity_count = ...` (trg_scan_events_append_log, see
-- 20261001040000_scan_logs_parity_counter.sql), and trg_employees_updated_at
-- fires BEFORE UPDATE and sets updated_at = now(). So max(updated_at) moves on
-- every single scan, which means roster_version is — in practice — a
-- "has anybody scanned in the last 30 seconds?" flag.
--
-- During a shift with active scanners the answer is almost always yes, so the
-- skip never fires and the FULL roster is downloaded every 30 seconds. The
-- optimization only works on a quiet night, which is precisely when egress
-- does not matter. Measured against the live project: ~0.025 GB/hour over an
-- 18-hour day is ~13.95 GB/month against a 5 GB Free-plan quota, and two open
-- Dashboard tabs at ~70 KB of roster every 30 seconds accounts for ~17 GB/month
-- of that on their own.
--
-- A version string cannot fix this, because the data genuinely did change: the
-- person who just scanned IN really is on the roster now. The only real fix is
-- to stop sending the ~500 rows that did NOT change.
--
-- WHAT THIS RETURNS
--
--   { full, cursor, stale_hours, rows[] }
--
-- `full` (p_since IS NULL): `rows` is the complete current roster, and the
--   client replaces its copy outright.
-- incremental: `rows` is every employee whose updated_at is past p_since —
--   including ones who have LEFT the roster — each carrying `on_roster`. The
--   client upserts where true and drops where false. That flag is what makes a
--   delta able to express removals at all; without it a "scanned OUT" event is
--   invisible, since the row simply stops matching the roster predicate.
--
-- Why a full sync filters to on-roster rows but an incremental one does not:
-- for a first sync, the ~500 employees who are not on site are pure waste —
-- worse than the function this replaces. For an incremental sync they are the
-- whole point, because that is where removals come from.
--
-- WHAT IS DELIBERATELY NOT RETURNED
--
-- `seconds_on_site` and `is_stale`, both of which get_onsite_roster() computes
-- server-side. They are pure functions of last_in_at and the stale window, so
-- sending them means the client must re-ask the server for numbers it could
-- have worked out itself — and it is exactly what forced the 5-minute
-- unconditional refetch in DashboardPage.js, since is_stale flips with the
-- passage of time and no data version can observe a clock. `stale_hours` is
-- returned instead, once, so the client's rule and the server's stay the same
-- rule. Side benefit: "Time on site" now ticks between polls instead of being
-- frozen at whatever the last response said.
--
-- `cursor` is lagged one minute behind now(), the same guard
-- get_scanner_offline_cache_delta() uses: a transaction that commits after
-- now() is read but before the client stores the cursor would otherwise be
-- skipped forever. One minute of deliberate overlap re-sends a handful of rows
-- and is the difference between eventually-consistent and silently-wrong.
--
-- The client still forces a periodic full resync (see DashboardPage.js) so that
-- anything a cursor cannot observe — a hard-DELETEd employee, a cursor left
-- stale by a suspended laptop — self-heals without anyone noticing it broke.

CREATE OR REPLACE FUNCTION public.get_onsite_roster_delta(
  p_since timestamptz DEFAULT NULL,
  p_stale_hours integer DEFAULT 16
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  -- Same clamp as get_onsite_roster(), so switching the client between the two
  -- cannot change what "stale" means.
  v_stale integer := greatest(least(coalesce(p_stale_hours, 16), 72), 1);
  v_full boolean := p_since IS NULL;
  v_cursor timestamptz := now() - interval '1 minute';
  v_rows jsonb;
BEGIN
  -- Matches get_onsite_roster()'s gate. SECURITY INVOKER, so `employees` is
  -- additionally read under the caller's own RLS (employees_select_scope);
  -- this check sits on top of that, not instead of it.
  IF NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'not permitted to read the on-site roster';
  END IF;

  WITH candidate AS (
    SELECT e.id,
           e.full_name,
           e.employee_code,
           e.department,
           e.status,
           -- The LAST scan_logs entry decides both membership and the IN time.
           -- jsonb negative subscripting (PG 11+) reads it without materializing
           -- the whole array, which matters: scan_logs is unbounded jsonb and
           -- this runs for every changed employee on every poll.
           e.scan_logs -> -1 AS last_log
      FROM public.employees e
     WHERE jsonb_typeof(e.scan_logs) = 'array'
       AND jsonb_array_length(e.scan_logs) > 0
       -- A full sync reads everyone; an incremental one only what moved. The
       -- employees_updated_at_idx index added in 20261005000000 is what makes
       -- the incremental case cheap.
       AND (v_full OR e.updated_at > p_since)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'full_name', c.full_name,
           'employee_code', c.employee_code,
           'department', c.department,
           'status', c.status,
           'last_in_at', c.last_log ->> 'scanned_at',
           'last_scanner_id', c.last_log ->> 'scanner_id',
           'on_roster', coalesce(c.last_log ->> 'direction', '') = 'in'
         ) ORDER BY (c.last_log ->> 'scanned_at')), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT * FROM candidate
       -- On a full sync, only the roster itself. On an incremental one,
       -- everything that changed, because an employee who just scanned OUT is
       -- how the client learns to remove them.
       WHERE NOT v_full OR coalesce(last_log ->> 'direction', '') = 'in'
       -- Same 10,000-row ceiling get_onsite_roster() applies. A roster past
       -- that is a data problem, not a page to render.
       LIMIT 10000
    ) c;

  RETURN jsonb_build_object(
    'full', v_full,
    'cursor', v_cursor,
    'stale_hours', v_stale,
    'rows', v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_onsite_roster_delta(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_onsite_roster_delta(timestamptz, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_onsite_roster_delta(timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_onsite_roster_delta(timestamptz, integer) TO service_role;

COMMENT ON FUNCTION public.get_onsite_roster_delta(timestamptz, integer) IS
  'Incremental on-site roster for the Dashboard. p_since NULL returns the full roster; otherwise returns every employee changed since p_since with an on_roster flag so the client can upsert or drop. Omits seconds_on_site/is_stale deliberately — both are clock-derived and are computed client-side from last_in_at + stale_hours. Replaces the full get_onsite_roster() download on every 30-second poll.';
