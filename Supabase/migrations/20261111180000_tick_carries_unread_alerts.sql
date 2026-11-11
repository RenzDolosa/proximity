-- The alerts badge was asking a question the Dashboard had just answered.
--
-- Two independent timers run on a screen left on the Dashboard:
--
--   get_dashboard_tick     every  60 s   = 1,440 requests/day
--   get_unread_alert_count every 600 s   =   144 requests/day
--
-- Log Ingestion bills one API-gateway line per request whatever the payload
-- weighs, so that second timer costs 144 lines a day per open tab to deliver
-- a single integer — on a screen that is already talking to the server every
-- minute. 20261021090000 merged the pulse and the roster for exactly this
-- reason and wrote the rationale down; the badge was simply missed, because
-- it lives in the sidebar rather than on the page.
--
-- One more key on the same object. Egress is unchanged for practical
-- purposes: an integer against a payload that already carries the whole
-- roster delta.
--
-- WHY THE CLIENT DOES NOT KEY THIS OFF THE ROUTE. Core/alertsBadge.js records
-- WHEN it was last handed a count and skips its own poll if that is more
-- recent than its interval -- it never learns who supplied it. A route check
-- (`appState.route === 'dashboard'`) would have to be edited again for a
-- second supplier, and would leave the badge frozen if the Dashboard stopped
-- ticking for any reason. The timestamp self-heals within one period.
--
-- SECURITY INVOKER, unchanged. get_unread_alert_count() does its own gating
-- and returns 0 for anyone who is not admin or manager, so merging it here
-- widens nothing: a caller who could already run the tick could already run
-- the count, and gets the same answer either way.
--
-- ADDITIVE AND BACKWARD COMPATIBLE. Same signature, same return type, one new
-- key. A browser running the previous bundle ignores it; a browser running
-- the new bundle against a project without this migration finds
-- `unread_alerts` undefined and leaves the badge polling exactly as it does
-- today. Either side can ship first.

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
  -- Still the pulse's own object merged with extra keys, rather than a
  -- hand-rebuilt shape: the client reads `stats` and `roster_version` from
  -- the same places whichever RPC answered, so the combined and the split
  -- paths cannot drift apart.
  SELECT public.get_dashboard_pulse(p_window_hours)
      || jsonb_build_object(
           'roster', public.get_onsite_roster_delta(p_since, p_stale_hours),
           'unread_alerts', public.get_unread_alert_count()
         );
$function$;

COMMENT ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) IS
  'One Dashboard refresh in one request: get_dashboard_pulse() merged with get_onsite_roster_delta() under "roster" and get_unread_alert_count() under "unread_alerts". Added 2026-10-21 and extended 2026-11-11, both times to cut API-gateway log events, which bill per request regardless of payload size. The badge count rides along so Core/alertsBadge.js can skip its own 10-minute poll while this is ticking.';

-- Restated rather than assumed. A CREATE OR REPLACE keeps the existing ACL,
-- so these describe the reachable surface rather than change it. Both REVOKE
-- FROM PUBLIC *and* FROM anon: Supabase's default privileges grant anon
-- EXECUTE directly, so revoking PUBLIC alone would leave this anonymously
-- callable.
REVOKE ALL ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_tick(integer, timestamptz, integer) TO service_role;

NOTIFY pgrst, 'reload schema';

-- VERIFY -------------------------------------------------------------------
--
-- auth.uid() is NULL in psql, so get_unread_alert_count() returns 0 and the
-- tick's own SECURITY INVOKER call sees no profile. Borrow an admin id for
-- one transaction to exercise the real path.
--
--   begin;
--     select set_config('request.jwt.claims',
--       json_build_object(
--         'sub', (select id from public.profiles where role = 'admin' limit 1),
--         'role', 'authenticated')::text, true);
--
--     -- 1. the new key is present and numeric
--     select public.get_dashboard_tick() -> 'unread_alerts';
--
--     -- 2. and it agrees with the function the badge used to call directly.
--     -- These must match, or the badge will show a different number
--     -- depending on which page happens to be open.
--     select (public.get_dashboard_tick() ->> 'unread_alerts')::bigint
--              = public.get_unread_alert_count() as agrees;
--     -- expect: t
--
--     -- 3. nothing the old client reads has moved
--     select public.get_dashboard_tick() ?& array['stats','roster_version','roster'];
--     -- expect: t
--   rollback;
--
-- Then, in a browser: open the Dashboard, leave it for a few minutes, and
-- confirm in the Settings request meter that get_unread_alert_count stops
-- appearing while get_dashboard_tick keeps ticking.
--
-- ROLLBACK -----------------------------------------------------------------
--
--   Re-apply 20261021090000. The client finds `unread_alerts` undefined and
--   the badge resumes its own poll on the next interval -- no redeploy
--   needed, because the suppression is driven by a timestamp that simply
--   stops being refreshed.
