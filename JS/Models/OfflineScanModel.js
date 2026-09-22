// What keeps the standalone Scanner working through a real network
// outage:
// - a local IndexedDB copy of the card->employee lookup
//   (get_scanner_offline_cache()), refreshed opportunistically while
//   online, so a scan can still be classified with the network down
// - a queue of raw scan attempts made while offline, replayed strictly in
//   order (one at a time, never in parallel) once back online, through
//   the real scan_proximity_code() RPC
//
// The RPC is always the source of truth for what actually gets written —
// classify() below is shown to the operator in the moment as immediate
// feedback, but is provisional and never itself written anywhere. This
// matters because classify() can't see scans made on *other* kiosks (or
// via Test Scan) since this cache was last refreshed, so its IN/OUT call
// can occasionally disagree with what the server records once synced —
// an accepted tradeoff for a kiosk that needs to keep working with no
// network at all, not a bug to chase.
//
// No photo-prefetching machinery here anymore (there used to be a
// prefetchPhotos(), a Service Worker PHOTO_CACHE, and a live-retry-fetch
// on the rendered <img> — all deleted 2026-09-18). employees.photo_thumb_b64
// (a small base64 JPEG, produced server-side by upload-employee-photo at
// upload time) is what classify() below passes through — no network
// request, no race between "went offline" and "finished prefetching,"
// ever.
//
// UPDATED 2026-09-19: photo_thumb_b64 no longer rides along in
// get_scanner_offline_cache()'s own row. That RPC is refreshed every 5
// minutes (see StandaloneScanner.js) and is meant to stay a small, cheap,
// frequent lookup — card/employee status, nothing else — but embedding
// every employee's thumbnail in it coupled a payload that needs to stay
// small and frequent to one that will only grow and doesn't need
// refreshing nearly that often. Thumbnails now come from their own RPC,
// get_scanner_offline_photos() (sparse — only employees who actually
// have one), cached separately (idb.js's photoCache store) and on a much
// longer interval, since a photo only changes when someone re-uploads
// one. getCacheMeta() below merges the two caches back together by
// employee_id before handing rows to classify(), so classify() itself
// stays exactly as it was — still just reads row.photo_thumb_b64 off
// whatever row it's given, with no idea the photo came from a different
// cache/RPC than the rest of the row. See Supabase/README.md's matching
// change log entry for the full story.
import { supabase } from '../Core/supabaseClient.js';
import { idbGetCache, idbSetCache, idbEnqueue, idbGetQueue, idbRemoveFromQueue, idbCountQueue, idbGetPhotoCache, idbSetPhotoCache } from '../Utils/idb.js';
import { classifyCachedScan, flushQueuedScans } from '../Core/offlineScanning.js';

// Past this age, the cached lookup is old enough that a card revoked (or
// an employee deactivated/reactivated) since the last refresh could still
// scan against stale data. This is surfaced to the operator as a warning
// (see StandaloneScanner.js's status pill) — it does NOT block scanning.
// That's a deliberate fail-open default so the door still works when
// nobody's looked at the kiosk in a day; worth revisiting to fail-closed
// instead if this scanner is ever the *sole* access control for
// something higher-stakes than an attendance/activity log.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function isNetworkError(error) {
  if (!error) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = (error.message || '').toLowerCase();
  return msg.includes('fetch') || msg.includes('network') || msg.includes('failed to');
}

// Proactively warms the Service Worker's PHOTO_CACHE for every employee in
// the offline lookup, instead of only ever caching a photo the moment
// someone happens to scan that person while online — which meant, in
// practice, that most of a 700+-person roster's photos were never cached
// at all, and "offline" scans for anyone not recently seen fell back to
// initials. Runs at most once per page session (see `prefetched` below) —
// but that guard alone isn't enough: `prefetched` is a plain in-memory JS
// variable, so it resets on every page load, not just once ever. Without
// checking Cache Storage itself first, a reload used to restart the WHOLE
// roster's prefetch from zero every single time, discarding all progress
// from the last session even though PHOTO_CACHE (which IS persistent
// across reloads) already had most of it. For a large roster at
// PREFETCH_CONCURRENCY workers, that full burst takes real time to finish
// — long enough that going offline shortly after a fresh load (exactly
// the documented manual test: load online once, then flip to Offline)
// meant most employees genuinely hadn't been fetched yet, showing the
// bundled silhouette/initials instead of a real photo. Checking
// cache.match() before each fetch means a reload only has to catch up on
// what's actually missing or changed (new hires, photo swaps) — once one
// full pass has ever completed, every later load is near-instant.
//
// DELETED 2026-09-18. All of the above was ultimately working around one
// fundamental problem: a cross-origin no-cors fetch returns an opaque
// response with no inspectable status, so a rate-limited or transient
// failure among hundreds of concurrent Drive requests was indistinguishable
// from success and got cached as if it worked — which is exactly why
// photos were STILL inconsistently missing offline even with this entire
// prefetch system in place and working as designed. employees.photo_thumb_b64
// (see get_scanner_offline_cache() in Supabase/README.md) replaces all of
// it: a small thumbnail fetched server-side (real HTTP status, no CORS
// involved) once, at upload time, and stored directly on the row — every
// scan response already has it, online or offline, nothing to prefetch or
// race at all. classify() below just reads row.photo_thumb_b64 straight
// through.

export const OfflineScanModel = {
  isNetworkError,

  async refreshCache() {
    const { data, error } = await supabase.rpc('get_scanner_offline_cache');
    if (error) return { error };
    await idbSetCache({ rows: data, syncedAt: new Date().toISOString() });
    return { data: true };
  },

  // Separate from refreshCache() above on purpose — see this file's
  // top-of-file comment. Sparse response (only employees who actually
  // have a thumbnail), stored as a plain employee_id -> b64 map so
  // getCacheMeta()'s merge below is an O(1) lookup per row rather than a
  // find() per row.
  async refreshPhotoCache() {
    const { data, error } = await supabase.rpc('get_scanner_offline_photos');
    if (error) return { error };
    const byEmployeeId = Object.fromEntries((data || []).map((r) => [r.employee_id, r.photo_thumb_b64]));
    await idbSetPhotoCache({ byEmployeeId, syncedAt: new Date().toISOString() });
    return { data: true };
  },

  async getCacheMeta() {
    const [cache, photoCache] = await Promise.all([
      idbGetCache().catch(() => null),
      idbGetPhotoCache().catch(() => null),
    ]);
    if (!cache) return { rows: [], syncedAt: null, ageMs: Infinity };
    // Merge the two caches back together by employee_id here, once, so
    // classify() (and anything else that reads getCacheMeta().rows) can
    // stay oblivious to the split and just keep reading row.photo_thumb_b64
    // like it always did. A row with no cached thumbnail (never uploaded
    // one, or the photo cache hasn't been fetched yet this session)
    // simply keeps whatever it already had — undefined — which
    // offlineAvatarHTML() already treats as "show initials".
    const photosByEmployee = photoCache?.byEmployeeId || {};
    const rows = cache.rows.map((r) => (
      r.employee_id && photosByEmployee[r.employee_id] !== undefined
        ? { ...r, photo_thumb_b64: photosByEmployee[r.employee_id] }
        : r
    ));
    return { rows, syncedAt: cache.syncedAt, ageMs: Date.now() - new Date(cache.syncedAt).getTime() };
  },

  // employee_id -> count of this kiosk's own not-yet-synced queue entries
  // for that employee, so consecutive offline scans of the same person
  // keep toggling IN/OUT correctly before any of them have reached the
  // server (which is the only place scan_count itself gets updated).
  async pendingBumps(rows) {
    const queue = await idbGetQueue().catch(() => []);
    const bumps = new Map();
    for (const q of queue) {
      const row = rows.find((r) => r.proximity_code === q.proximity_code);
      if (row?.employee_id) bumps.set(row.employee_id, (bumps.get(row.employee_id) || 0) + 1);
    }
    return bumps;
  },

  // Pure, synchronous — mirrors scan_proximity_code()'s branching exactly
  // against the cached snapshot.
  classify(proximityCode, rows, pendingBumps) {
    return classifyCachedScan(proximityCode, rows, pendingBumps);
  },

  async enqueue(proximity_code, scanner_id) {
    return idbEnqueue({ proximity_code, scanner_id, scanned_at: new Date().toISOString() });
  },

  async queueCount() {
    return idbCountQueue().catch(() => 0);
  },

  // Replays the queue in per-employee chronological order, but different
  // employees' queues run CONCURRENTLY (bounded), not one global queue
  // processed one entry at a time. Why grouping is required, not
  // optional: direction is derived server-side from scan_logs's length
  // at the moment each call actually runs, so two calls for the SAME
  // employee racing in parallel could both read the same "before" count
  // and both come back `in` — so within one employee's own entries,
  // order is still strictly preserved (sequential, awaited). Why
  // parallelizing ACROSS employees is safe: they share no server-side
  // state at all, so there's no correctness reason to make one
  // employee's sync wait behind an unrelated one's. This is the actual
  // fix for "sync queue slow" reported after a longer outage — the old
  // global one-at-a-time loop meant a 20-scan backlog took 20 sequential
  // round trips no matter how unrelated those scans were to each other.
  // Still stops ALL groups on the first failure (a shared `stopped` flag,
  // checked before every call) rather than letting each group fail
  // independently — same original reasoning as the old code: a failure
  // usually means something is broken right now (auth, connectivity
  // flapped mid-flush), not that this one employee's data is bad, so
  // hammering the server across several parallel workers after that
  // point wastes calls rather than making progress. Whatever didn't sync
  // stays queued, retried whole on the next attempt, same as before.
  async flushQueue(onProgress) {
    const entries = await idbGetQueue().catch(() => []);
    return flushQueuedScans({
      entries,
      onProgress,
      send: async (entry) => {
        const { error } = await supabase.rpc('scan_proximity_code', {
        p_proximity_code: entry.proximity_code,
        p_scanner_id: entry.scanner_id,
        p_scanned_at: entry.scanned_at,
        p_offline: true,
        });
        return error;
      },
      remove: (id) => idbRemoveFromQueue(id).catch(() => {}),
    });
  },
};
