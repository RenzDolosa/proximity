-- Stop the superseded full-payload scanner RPCs from being callable.
--
-- Measured 2026-10-08, 24 hours of edge_logs: a single kiosk tab was calling
--   get_scanner_offline_photos()  95 calls  × 5,823 kB  ≈ 542 MB/day
--   get_scanner_offline_cache()  482 calls                 (full card lookup)
-- flat around the clock, including 00:00-05:00 when no scan happens. That is
-- ~13 GB/month against a 5 GB quota, and it accounts for essentially the whole
-- 9.958 GB the billing cycle actually recorded.
--
-- Neither function has had a caller since 2026-09-19, when the payload was
-- split into get_scanner_offline_cache_compact() + get_scanner_offline_photos()
-- and then again on 2026-10-05 into the delta pair. The calls came from a tab
-- opened before that split and never reloaded — a loaded page never re-fetches
-- its own JS. JS/Utils/appUpdate.js now makes such a tab reload itself; this
-- migration is the backstop, so a tab that somehow survives that cannot put the
-- project back over quota.
--
-- REVOKE rather than DROP, deliberately: revoking removes the egress today
-- while leaving the definitions in place as a rollback path. A stale tab now
-- gets 403 instead of 5.8 MB, shows its "offline data out of date" pill, and
-- keeps scanning from IndexedDB. Drop them once a full billing cycle has
-- confirmed nothing legitimate calls them.
--
-- The live replacements are untouched:
--   get_scanner_offline_cache_delta(timestamptz, text)
--   get_scanner_offline_cache_compact()        -- the delta's fallback
--   get_scanner_offline_photo_updates(jsonb)

REVOKE ALL ON FUNCTION public.get_scanner_offline_cache() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_offline_cache() FROM anon;
REVOKE ALL ON FUNCTION public.get_scanner_offline_cache() FROM authenticated;

REVOKE ALL ON FUNCTION public.get_scanner_offline_photos() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_scanner_offline_photos() FROM anon;
REVOKE ALL ON FUNCTION public.get_scanner_offline_photos() FROM authenticated;

-- service_role keeps EXECUTE: it bypasses RLS anyway, is never used by a
-- browser, and leaving it is what makes this reversible from the SQL editor.
COMMENT ON FUNCTION public.get_scanner_offline_cache() IS
  'SUPERSEDED 2026-09-19 by get_scanner_offline_cache_compact(). EXECUTE revoked 2026-10-08 — a stale kiosk tab was calling it 482x/day.';
COMMENT ON FUNCTION public.get_scanner_offline_photos() IS
  'SUPERSEDED 2026-09-19 by get_scanner_offline_photo_updates(jsonb). EXECUTE revoked 2026-10-08 — a stale kiosk tab was calling it 95x/day at 5.8 MB a call, ~13 GB/month.';
