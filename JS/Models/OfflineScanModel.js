// What keeps the standalone Scanner working through a network outage:
// - an IndexedDB copy of the card->employee lookup, refreshed incrementally
//   from get_scanner_offline_cache_delta() (cursor + roster digest in, changed
//   rows out) so a scan can be classified with the network down.
// - a queue of offline scan attempts, replayed strictly in order, one at a time.
//
// Thumbnails live in a SEPARATE cache fed by get_scanner_offline_photo_updates()
// on a much longer interval: the lookup must stay small and frequent, while
// photos are large and rarely change. getCacheMeta() merges the two by
// employee_id before classify() sees a row, so classify() just reads
// row.photo_thumb_b64 and never knows there were two sources.
//
// The RPC is always the source of truth for what gets written. classify() is
// immediate operator feedback only — it cannot see scans made on other kiosks
// since the last refresh, so its IN/OUT call can disagree with the server once
// synced. Accepted tradeoff for a kiosk that must work with no network.
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

// In-memory copy of the IndexedDB photo cache. The result card and the feed need
// thumbnails on every render, and re-reading a multi-megabyte structured clone
// each time would trade network cost for CPU cost.
let photoMemo = null;
// Bumped on every write so a read that started before the write cannot
// re-memoize the pre-write snapshot and serve stale thumbnails.
let photoGeneration = 0;
// employee_id -> photo_file_id already synced for this page session. Some
// employees have a photo_file_id but no stored thumbnail (generation failed at
// upload); without this, every scan of such a person re-triggers a sync that can
// never satisfy them.
const photoSyncAttempted = new Map();
// One photo sync at a time: the 30-minute timer and the missing-photo trigger
// would otherwise both read-modify-write the same IndexedDB record.
let photoRefreshInFlight = null;
let lastPhotoRefreshRequestAt = 0;
const PHOTO_REFRESH_REQUEST_GAP_MS = 2 * 60 * 1000;

// False once IndexedDB has refused to persist the photo cache. See the write
// handling at the bottom of fetchAndStorePhotoUpdates() for why this exists.
let photoCachePersistable = true;

async function fetchAndStorePhotoUpdates() {
  // An unreadable cache is recoverable: treat it as empty and carry on.
  let current = await idbGetPhotoCache().catch(() => null);

  // Guards a silent, unbounded egress leak: if the write below fails, nothing
  // persists, so the next sync sends an empty known-ids map and the server
  // returns all 729 thumbnails (~12 MB) again — repeating every 2 minutes with
  // no error anywhere. The in-memory fallback caps it at one full download per
  // page session, because the memo can still supply the known ids.
  if (!current && photoMemo) current = photoMemo;

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

  // Memoise BEFORE the write, and keep the merged value rather than nulling it:
  // that is what lets the fallback above ask for a delta when nothing persists.
  photoGeneration += 1;
  photoMemo = next;

  try {
    await idbSetPhotoCache({ ...next, syncedAt: new Date().toISOString() });
    if (!photoCachePersistable) {
      photoCachePersistable = true;
      console.info('Photo cache is writable again — thumbnails will survive a reload.');
    }
  } catch (err) {
    // Not fatal — the thumbnails are in memory and the scanner renders fine for
    // this session. Warn once per transition so a quietly failing kiosk is
    // discoverable from the console rather than from a billing page.
    if (photoCachePersistable) {
      photoCachePersistable = false;
      console.warn(
        'Could not persist the scanner photo cache to IndexedDB — thumbnails will be held in memory '
        + 'for this session only and re-downloaded once after each reload. Common causes: private '
        + 'browsing, a storage quota, or the browser clearing site data on exit.',
        err,
      );
    }
  }
  return { data: true };
}

export const OfflineScanModel = {
  isNetworkError,

  // Sends the previous refresh's cursor + roster digest and gets only what
  // changed. A full roster still comes down on a kiosk's first refresh and
  // whenever the digest mismatches (cards have no updated_at — see the
  // 20261005000000 migration for why those are two separate signals).
  //
  // Falls back once per session to the whole-roster RPC if the delta function
  // is not deployed yet: migrations are applied by hand here, so a client
  // deploy can land first, and without this that window is a kiosk whose cache
  // silently stops refreshing.
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

  // Sends only the known employee/photo ids and gets back changed thumbnails.
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

  // The scan RPC omits photo_thumb_b64, so put the cached thumbnail back onto a
  // matched result. When the server has a photo this kiosk lacks (new hire) or a
  // newer one, kicks off a throttled background sync so the NEXT scan has it.
  // Never throws or delays the result: a missing photo renders as initials.
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
    // Merge the two caches by employee_id once, here, so classify() and
    // everything else stays oblivious to the split. A row with no cached
    // thumbnail keeps undefined, which offlineAvatarHTML reads as "initials".
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

  // Replays per employee in chronological order, with different employees
  // running concurrently (bounded).
  //
  // Grouping is required, not an optimization: direction comes from scan_logs's
  // length at the moment each call runs, so two parallel calls for the SAME
  // employee could both read the same "before" count and both return `in`.
  // Across employees there is no shared server-side state, so parallelism is
  // safe — and necessary, or a 20-scan backlog costs 20 sequential round trips.
  //
  // A failure stops ALL groups via a shared flag: it usually means something is
  // broken right now (auth, connectivity), not that one employee's data is bad,
  // so continuing across parallel workers wastes calls. Unsynced entries stay
  // queued and are retried whole.
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
