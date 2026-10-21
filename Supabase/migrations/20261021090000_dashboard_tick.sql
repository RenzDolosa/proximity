-- One request per Dashboard refresh instead of two.
--
-- This is a LOG INGESTION change, not an egress one. The two are optimised in
-- opposite directions and that is the whole point of this migration:
--
--   Egress        bills BYTES. The fix is smaller payloads -> deltas, compact
--                 projections, dropped photo arrays. All of that is done.
--   Log Ingestion bills EVENTS. Every HTTP request to PostgREST writes one
--                 API-gateway log line whether it returned 40 bytes or 5 MB.
--                 Shrinking a payload does nothing for it. The only lever is
--                 making FEWER REQUESTS.
--
-- Measured 2026-10-21: Log Ingestion at 0.204 GB of a 1 GB quota, 10 days into
-- the 11 Oct - 11 Nov cycle. The project dashboard's own 60-minute breakdown on
-- 15 Oct was 749 log events, of which 654 (87%) were API Gateway. Postgres was
-- 68. So the two Postgres fixes shipped on 15 and 17 Oct, worth having, were
-- never going to move this number much: the bill is request count, and the
-- single largest contributor is the Dashboard, which fires TWO requests on
-- every tick of its refresh timer.
--
-- get_dashboard_pulse() and get_onsite_roster_delta() are called back to back,
-- unconditionally, by DashboardPage.load(). Nothing about that needs two round
-- trips -- they are both STABLE, both SECURITY INVOKER, and neither depends on
-- the other's result. Combining them halves the Dashboard's request count at
-- every hour of the day, for an identical payload.
--
-- Why not use the roster_version the pulse already returns, to skip the roster
-- when nothing changed? Because it does not work here, and docs/EGRESS_BUDGET.md
-- already records why: every matched scan bumps employees.updated_at via
-- trg_employees_updated_at, so roster_version is really a "has anyone scanned in
-- the last 30 seconds?" flag. During a shift with three kiosks the answer is
-- always yes and the skip never fires. Combining the calls is unconditional and
-- needs no such bet.
--
-- SECURITY INVOKER, like both functions it wraps. Each inner function runs its
-- own gate (get_dashboard_stats: admin or Employee Manager scope;
-- get_onsite_roster_delta: the same gate as get_onsite_roster) under the
-- caller's own role, exactly as it does when called directly over PostgREST.
-- This wrapper therefore grants nothing new -- a caller who cannot execute
-- either one today cannot execute it through here either.
--
-- Note for anyone editing this later: a SECURITY INVOKER function's inner calls
-- have EXECUTE checked against the CALLER's role, not the function owner's.
-- That is exactly what broke get_scanner_offline_cache_compact() between 8 and
-- 15 Oct (see 20261015120000). test/schema-drift.test.mjs now fails the build if
-- a SECURITY INVOKER function calls one whose EXECUTE has been revoked.
CREATE OR REPLACE FUNCTION public.get_dashboard_tick(
  p_window_hours integer DEFAULT 16,
  p_since timestamptz DEFAULT NULL,
  p_stale_hours integer DEFAULT 16
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  -- Deliberately the pulse's own object merged with one new key, rather than a
  -- hand-rebuilt shape: the client reads `stats` and `roster_version` from the
  -- same places whichever RPC answered, so the combined and the split paths
  -- cannot drift apart.
  SELECT public.get_dashboard_pulse(p_window_hours)
      || jsonb_build_object(
           'roster', public.get_onsite_roster_delta(p_since, p_stale_hours)
         );
$function$;

COMMENT ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) IS
  'One Dashboard refresh in one request: get_dashboard_pulse() merged with get_onsite_roster_delta() under a "roster" key. Added 2026-10-21 to halve API-gateway log events, which bill per request regardless of payload size. Payload is byte-identical to the two calls it replaces, so egress is unchanged.';

-- Both REVOKE FROM PUBLIC *and* FROM anon: Supabase's default privileges grant
-- anon EXECUTE directly, so revoking PUBLIC alone would leave this anonymously
-- callable (see 20261003083312 for the last time that was missed).
REVOKE ALL ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
