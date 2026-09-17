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
import { supabase } from '../Core/supabaseClient.js';
import { idbGetCache, idbSetCache, idbEnqueue, idbGetQueue, idbRemoveFromQueue, idbCountQueue } from '../Utils/idb.js';
import { photoSrc } from '../Utils/format.js';

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
// initials. This runs once per page session (see `prefetched` below), not
// on every refreshCache() call — refetching 700+ photos on every refresh
// would be wasteful, and cache-first-with-refresh already keeps each one
// reasonably fresh once it's in the cache at all.
let prefetched = false;
const PREFETCH_CONCURRENCY = 6; // a handful of workers, not 700+ requests at once — see below

async function prefetchPhotos(rows) {
  if (prefetched) return;
  prefetched = true;
  const urls = [...new Set((rows || []).map((r) => photoSrc(r.photo_url, r.updated_at)).filter(Boolean))];
  if (!urls.length) return;
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      try {
        // no-cors: this is a cross-origin (Drive) request and the response
        // is never read here — the point is purely to make the Service
        // Worker's fetch listener see and cache it (sw.js's
        // cacheFirstWithRefresh explicitly handles the resulting opaque
        // response). A default 'cors'-mode fetch to Drive's thumbnail
        // endpoint would just fail outright — that endpoint sends no CORS
        // headers, since it's designed for <img> tag consumption, not
        // page-script fetch().
        await fetch(url, { mode: 'no-cors' });
      } catch {
        // best-effort — one employee with no photo, or a request that
        // fails because we're ALSO offline right now, never blocks the
        // rest of the roster from prefetching.
      }
    }
  };
  // Bounded concurrency: unbounded would mean 700+ simultaneous requests
  // on a page load, which is both rude to Drive's API and a poor use of a
  // kiosk device's bandwidth/CPU for a background task nobody's actively
  // waiting on. A handful of workers pulling from a shared index keeps
  // this moving without flooding the network.
  await Promise.all(Array.from({ length: Math.min(PREFETCH_CONCURRENCY, urls.length) }, worker));
}

export const OfflineScanModel = {
  isNetworkError,

  async refreshCache() {
    const { data, error } = await supabase.rpc('get_scanner_offline_cache');
    if (error) return { error };
    await idbSetCache({ rows: data, syncedAt: new Date().toISOString() });
    prefetchPhotos(data); // best-effort, doesn't block the caller on it
    return { data: true };
  },

  async getCacheMeta() {
    const cache = await idbGetCache().catch(() => null);
    if (!cache) return { rows: [], syncedAt: null, ageMs: Infinity };
    return { rows: cache.rows, syncedAt: cache.syncedAt, ageMs: Date.now() - new Date(cache.syncedAt).getTime() };
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
    const row = rows.find((r) => r.proximity_code === proximityCode);
    if (!row) return { result: 'unmatched', employee: null, offline: true };
    if (!row.card_active) return { result: 'inactive_card', employee: null, offline: true };
    if (!row.employee_id) return { result: 'unassigned_card', employee: null, offline: true };
    if (row.employee_status !== 'active') return { result: 'inactive_employee', employee: null, offline: true };
    const bump = pendingBumps.get(row.employee_id) || 0;
    const direction = (row.scan_count + bump) % 2 === 0 ? 'in' : 'out';
    return {
      result: 'matched',
      direction,
      offline: true,
      // photo_url/updated_at ride along in get_scanner_offline_cache()'s
      // row already (see Supabase/README.md) — passing them through here
      // is what lets ScanResultCard's avatarHTML() show the real photo
      // offline instead of falling back to the bundled default avatar.
      employee: { full_name: row.full_name, employee_code: row.employee_code, department: row.department, position: row.position, photo_url: row.photo_url, updated_at: row.updated_at },
    };
  },

  async enqueue(proximity_code, scanner_id) {
    return idbEnqueue({ proximity_code, scanner_id, scanned_at: new Date().toISOString() });
  },

  async queueCount() {
    return idbCountQueue().catch(() => 0);
  },

  // Replays the queue strictly in FIFO order, one RPC call at a time
  // (never Promise.all): direction is derived server-side from
  // scan_logs's length at the moment each call actually runs, so two
  // calls for the same employee racing in parallel could both read the
  // same "before" count and both come back `in`. Stops at the first
  // failure (still offline, or a real server error) and leaves the rest
  // queued — retried whole on the next 'online' event or periodic
  // attempt, never partially skipped, so ordering is never disturbed.
  async flushQueue(onProgress) {
    const entries = (await idbGetQueue().catch(() => []))
      .sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at));
    let synced = 0;
    for (const entry of entries) {
      const { error } = await supabase.rpc('scan_proximity_code', {
        p_proximity_code: entry.proximity_code,
        p_scanner_id: entry.scanner_id,
        p_scanned_at: entry.scanned_at,
        p_offline: true,
      });
      if (error) break;
      await idbRemoveFromQueue(entry.id).catch(() => {});
      synced++;
      onProgress?.(synced, entries.length);
    }
    return { synced, remaining: entries.length - synced };
  },
};