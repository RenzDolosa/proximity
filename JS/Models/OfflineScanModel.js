// What keeps the standalone Scanner working through a real network
// outage:
// - a local IndexedDB copy of the card->employee lookup
//   (get_scanner_offline_cache_delta()), refreshed opportunistically while
//   online, so a scan can still be classified with the network down.
//   UPDATED 2026-10-05: that refresh is incremental. It used to re-download
//   the entire card roster every 5 minutes per kiosk (~430 KB a call, ~3.7 GB
//   a billing cycle per kiosk) regardless of whether anything had changed;
//   it now sends back the previous response's cursor + roster digest and
//   receives only the employees updated since. See the migration
//   20261005000000_incremental_scanner_cache_and_dashboard_pulse.sql for
//   why card-roster changes need a digest rather than a timestamp cursor.
// - a queue of raw scan attempts made while offline, replayed strictly in
//   order (one at a time, never in parallel) once back online, through
//   the compact wrapper over the real scan_proximity_code() RPC
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
// refreshing nearly that often. Thumbnails now come from
// get_scanner_offline_photo_updates(), cached separately (idb.js's
// photoCache store) and refreshed on a much longer interval, since a photo
// only changes when someone re-uploads one. The RPC accepts known file IDs
// and returns only changed thumbnails or removed-photo IDs. getCacheMeta()
// below merges the caches by
// employee_id before handing rows to classify(), so classify() itself
// stays exactly as it was — still just reads row.photo_thumb_b64 off
// whatever row it's given, with no idea the photo came from a different
// cache/RPC than the rest of the row. See Supabase/README.md's matching
// change log entry for the full story.
import { supabase } from '../Core/supabaseClient.js';
import { idbGetCache, idbSetCache, idbEnqueue, idbGetQueue, idbRemoveFromQueue, idbCountQueue, idbGetPhotoCache, idbSetPhotoCache } from '../Utils/idb.js';
import { attachCachedPhoto, classifyCachedScan, flushQueuedScans, mergeLookupDelta, mergePhotoUpdates, photoNeedsRefresh } from '../Core/offlineScanning.js';

// Past this age, the cached lookup is old enough that a card revoked (or
// an employee deactivated/reactivated) since the last refresh could still
// scan against stale data. This is surfaced to the operator as a warning
// (see StandaloneScanner.js's status pill) — it does NOT block scanning.
// That's a deliberate fail-open default so the door still works when
// nobody's looked at the kiosk in a day; worth revisiting to fail-closed
// instead if this scanner is ever the *sole* access control for
// something higher-stakes than an attendance/activity log.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

// Set once if get_scanner_offline_cache_delta() isn't on the project yet, so
// a kiosk running a client that's ahead of the database doesn't pay a failed
// round trip before every fallback refresh. See refreshCache() below.
let lookupDeltaUnavailable = false;

// PostgREST answers an unknown RPC with PGRST202 ("Could not find the
// function ... in the schema cache"), which is specifically a
// not-deployed-yet signal rather than a failure worth retrying. The message
// check is a fallback for older gateway versions that didn't set the code.
function isMissingFunctionError(error) {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function/i.test(error.message || '');
}

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

// In-memory copy of the IndexedDB photo cache. The scan result card and the
// Recent Activity feed both need thumbnails on every render; re-reading a
// multi-megabyte structured clone out of IndexedDB each time would trade
// network cost for CPU cost. Invalidated whenever refreshPhotoCache() writes.
let photoMemo = null;
// Bumped on every photo-cache write so a getPhotoCache() read that started
// before the write can't re-memoize the pre-write snapshot after the memo was
// invalidated (it would then serve stale thumbnails until the next sync).
let photoGeneration = 0;
// employee_id -> photo_file_id we've already triggered an on-demand sync for
// this page session. Some employees legitimately have a photo_file_id but no
// stored thumbnail (thumbnail generation failed at upload), and a sync can
// never satisfy them — without this, every scan of such a person would
// re-trigger the sync.
const photoSyncAttempted = new Map();
// One photo sync at a time: the 30-minute timer and the "this scanned
// employee's photo is missing/stale" trigger below can otherwise overlap and
// both read-modify-write the same IndexedDB record.
let photoRefreshInFlight = null;
let lastPhotoRefreshRequestAt = 0;
const PHOTO_REFRESH_REQUEST_GAP_MS = 2 * 60 * 1000;

async function fetchAndStorePhotoUpdates() {
  const current = await idbGetPhotoCache();
  const { data, error } = await supabase.rpc('get_scanner_offline_photo_updates', {
    p_known_photo_ids: current?.fileIdsByEmployeeId || {},
  });
  if (error) return { error };
  if (!data || !Array.isArray(data.photos) || !Array.isArray(data.removed)) {
    return { error: new Error('Unexpected response from get_scanner_offline_photo_updates') };
  }
  if (
    data.photos.some((photo) => (
      !photo
      || typeof photo.employee_id !== 'string'
      || typeof photo.photo_thumb_b64 !== 'string'
      || (photo.photo_file_id !== null && typeof photo.photo_file_id !== 'string')
    ))
    || data.removed.some((employeeId) => typeof employeeId !== 'string')
  ) {
    return { error: new Error('Invalid photo update data from get_scanner_offline_photo_updates') };
  }
  const next = mergePhotoUpdates(current, data);
  await idbSetPhotoCache({ ...next, syncedAt: new Date().toISOString() });
  photoGeneration += 1;
  photoMemo = null;
  return { data: true };
}

export const OfflineScanModel = {
  isNetworkError,

  // Incremental by default (get_scanner_offline_cache_delta): sends back the
  // cursor and roster digest from the previous refresh and gets only the
  // employees who changed since. The whole roster still comes down on the
  // first refresh of a kiosk, and whenever the card roster itself changed
  // (digest mismatch) — see the migration's header comment for why those are
  // two separate signals.
  //
  // Falls back, once per page session, to the previous whole-roster RPC if
  // the delta function isn't on the project yet. This repo does not
  // auto-deploy migrations, so a client deploy can legitimately land first;
  // without the fallback that window is a kiosk whose lookup cache silently
  // stops refreshing, which is exactly the failure offline scanning exists
  // to prevent.
  async refreshCache() {
    if (!lookupDeltaUnavailable) {
      const cached = await idbGetCache().catch(() => null);
      const { data, error } = await supabase.rpc('get_scanner_offline_cache_delta', {
        p_since: cached?.cursor || null,
        p_known_digest: cached?.digest || null,
      });
      if (!error && data && Array.isArray(data.rows)) {
        await idbSetCache({
          rows: mergeLookupDelta(cached?.rows, data),
          syncedAt: new Date().toISOString(),
          cursor: data.cursor || null,
          digest: data.digest || null,
        });
        return { data: true };
      }
      // A missing function is a deploy-ordering problem, not a transient
      // one, so stop retrying it for the rest of this session. Anything else
      // (offline, permission, a genuine server error) is reported as-is so
      // the caller's normal error handling still sees it.
      if (!isMissingFunctionError(error)) return { error: error || new Error('Unexpected response from get_scanner_offline_cache_delta') };
      lookupDeltaUnavailable = true;
    }
    const { data, error } = await supabase.rpc('get_scanner_offline_cache_compact');
    if (error) return { error };
    await idbSetCache({ rows: data, syncedAt: new Date().toISOString() });
    return { data: true };
  },

  // Separate from refreshCache() above on purpose — see this file's
  // top-of-file comment. Sends only the known employee/photo ids and gets
  // back thumbnails that changed since the previous refresh.
  async refreshPhotoCache() {
    if (!photoRefreshInFlight) {
      photoRefreshInFlight = fetchAndStorePhotoUpdates().finally(() => { photoRefreshInFlight = null; });
    }
    return photoRefreshInFlight;
  },

  // { byEmployeeId, fileIdsByEmployeeId } — the locally synced thumbnails.
  // Memoized (see photoMemo above); an unreadable IndexedDB yields an empty
  // cache without memoizing the failure, so the next call retries the read.
  async getPhotoCache() {
    if (photoMemo) return photoMemo;
    const generation = photoGeneration;
    try {
      const stored = await idbGetPhotoCache();
      const loaded = {
        byEmployeeId: stored?.byEmployeeId || {},
        fileIdsByEmployeeId: stored?.fileIdsByEmployeeId || {},
      };
      if (generation === photoGeneration) photoMemo = loaded;
      return loaded;
    } catch {
      return { byEmployeeId: {}, fileIdsByEmployeeId: {} };
    }
  },

  // The live scan RPC no longer carries photo_thumb_b64 (scan_proximity_code_
  // compact(p_include_photo => false)). This puts the locally cached
  // thumbnail back onto a matched result so ScanResultCard / the hero photo
  // render exactly as before, and — when the server has a photo this kiosk
  // doesn't (new hire) or a newer one (replaced) — kicks off the incremental
  // photo sync in the background, throttled, so the NEXT scan of that person
  // has it. Never throws and never delays the result: a missing photo just
  // renders as initials.
  async withCachedPhoto(data) {
    if (data?.result !== 'matched' || !data.employee) return data;
    const cache = await OfflineScanModel.getPhotoCache();
    const { id, photo_file_id: fileId } = data.employee;
    if (photoNeedsRefresh(data, cache) && photoSyncAttempted.get(id) !== fileId
        && OfflineScanModel.requestPhotoRefresh()) {
      photoSyncAttempted.set(id, fileId);
    }
    return attachCachedPhoto(data, cache.byEmployeeId);
  },

  // Returns true only when a sync was actually started (online and outside
  // the throttle window), so callers can tell a skipped request from a real one.
  requestPhotoRefresh() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    const now = Date.now();
    if (now - lastPhotoRefreshRequestAt < PHOTO_REFRESH_REQUEST_GAP_MS) return false;
    lastPhotoRefreshRequestAt = now;
    OfflineScanModel.refreshPhotoCache().catch(() => {});
    return true;
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
        const { error } = await supabase.rpc('scan_proximity_code_compact', {
        p_proximity_code: entry.proximity_code,
        p_scanner_id: entry.scanner_id,
        p_scanned_at: entry.scanned_at,
        p_offline: true,
        // The replay ignores the response body, so never download thumbnails
        // for a backlog of queued scans.
        p_include_photo: false,
        });
        return error;
      },
      remove: (id) => idbRemoveFromQueue(id).catch(() => {}),
    });
  },
};
