-- Finish retiring the two superseded scanner RPCs, and fix what revoking them
-- quietly broke.
--
-- Background: 20261008120000 revoked EXECUTE on get_scanner_offline_cache()
-- and get_scanner_offline_photos() from anon/authenticated, to stop a stale
-- kiosk tab pulling 5.8 MB a call. That worked — egress from that tab went
-- from ~630 MB/day to a few hundred kB of error bodies. The tab is still
-- running (one machine has two tabs; only one of them was reloaded), and as of
-- 2026-10-15 it is still calling both functions roughly 28 times an hour.
--
-- Two things are wrong with leaving it there.
--
-- 1. THE FALLBACK IS BROKEN. get_scanner_offline_cache_compact() is
--    SECURITY INVOKER and its body calls get_scanner_offline_cache()
--    (20261003025504, line 92). EXECUTE on an inner call in a SECURITY INVOKER
--    function is checked against the *calling* role — `authenticated` — which
--    is exactly the grant 20261008120000 revoked. So _compact() now raises
--    `permission denied for function get_scanner_offline_cache` for every
--    browser caller. 20261008120000's header claims "the live replacements are
--    untouched ... get_scanner_offline_cache_compact() -- the delta's
--    fallback"; that claim was wrong.
--
--    Latent, not an outage: OfflineScanModel.refreshCache() only reaches
--    _compact() when get_scanner_offline_cache_delta() is *missing*, which it
--    isn't. But that path exists for the case where a client deploy lands
--    before its migration, i.e. a recovery window — precisely when a dead
--    safety net costs the most.
--
-- 2. REVOKE STILL COSTS A LOG EVENT PER CALL. With the function present but
--    EXECUTE revoked, PostgREST finds it in its schema cache, builds the
--    statement and sends it; Postgres parses, binds, fails the permission
--    check and writes an ERROR line carrying the whole `WITH pgrst_source AS
--    (...)` query text. ~670 of those a day is log ingestion bought for
--    nothing. Once the function is *absent*, PostgREST answers 404 PGRST202
--    straight from its schema cache with no database round-trip, so Postgres
--    logs nothing at all. The API Gateway still logs the request either way —
--    only closing the tab removes that.
--
-- Egress is unchanged by this migration: a 404 body is the same order of size
-- as the 403 it replaces. This is a log-ingestion and correctness change.

-- 1. Break _compact()'s dependency before dropping what it depends on.
--
-- Delegating to the delta rather than re-inlining the old body is deliberate:
-- the two have to agree field-for-field (JS/Core/offlineScanning.js reads
-- `scan_count` for its IN/OUT parity arithmetic), and the surest way to keep
-- them agreeing is to have one producer. _delta(NULL, NULL) takes its v_full
-- branch, so this returns the whole roster, which is what a fallback means.
--
-- Shape check, done by hand against 20261005000000 and 20261001040000: same
-- eleven fields in both, and _delta already filters remarks_log to unresolved
-- entries exactly as _compact did. The only behavioural difference is that
-- _delta is SECURITY DEFINER with its own is_admin()/can_view_scanner() gate —
-- the same gate _cache() ran — so the caller still cannot use this to read
-- employees it has no scanner permission for.
CREATE OR REPLACE FUNCTION public.get_scanner_offline_cache_compact()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(public.get_scanner_offline_cache_delta(NULL, NULL) -> 'rows', '[]'::jsonb);
$function$;

COMMENT ON FUNCTION public.get_scanner_offline_cache_compact() IS
  'Whole-roster fallback for get_scanner_offline_cache_delta(), used only when the delta function is not deployed yet. Delegates to the delta so the two can never disagree on row shape. Rewritten 2026-10-15: it previously called get_scanner_offline_cache(), whose EXECUTE was revoked on 2026-10-08, which left this raising permission denied.';

-- 2. Now the superseded pair can go.
--
-- 20261008120000 said to drop these "once a full billing cycle has confirmed
-- nothing legitimate calls them". Seven days in, the evidence is better than a
-- clean cycle would have been: every call since the revoke has come from one
-- identified stale tab, and the only in-schema caller was the _compact()
-- dependency rewritten above.
--
-- RUN THIS FIRST. plpgsql bodies are opaque to PostgreSQL's dependency
-- tracking, so these DROPs will succeed even if something still calls them and
-- the breakage only appears at runtime. The repo cannot answer this on its own:
-- several live functions have no migration file (see KNOWN_MISSING_FUNCTIONS in
-- test/schema-drift.test.mjs), so grepping Supabase/migrations/ is not proof.
-- Expect exactly one row, get_scanner_offline_cache_compact, and only until the
-- CREATE OR REPLACE above has been applied:
--
--   select p.proname
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and (p.prosrc like '%get_scanner_offline_cache()%'
--        or p.prosrc like '%get_scanner_offline_photos()%');
--
-- The definitions remain in migration history if they are ever needed again.
DROP FUNCTION IF EXISTS public.get_scanner_offline_cache();
DROP FUNCTION IF EXISTS public.get_scanner_offline_photos();

-- PostgREST answers "no such function" from its in-memory schema cache, so it
-- has to be told the schema changed — otherwise it keeps sending the statement
-- to Postgres and keeps generating the very log lines this is removing.
NOTIFY pgrst, 'reload schema';
