// What a kiosk would tell you if you asked it whether it is well.
//
// Every value here is ALREADY in the scanner's memory — renderOfflineStatus()
// reads the cache meta and the queue depth on mount, after every scan and on
// every connectivity change. This arranges what is already known; it fetches
// nothing.
//
// The row that earns the whole feature is "Scan sounds". Browsers refuse to
// play audio until a user gesture, so a kiosk that was opened and left alone
// plays silent scans and looks perfectly healthy. Nothing else in the UI says
// so.

export const HEALTH = Object.freeze({ GOOD: 'good', WARN: 'warn', BAD: 'bad', UNKNOWN: 'unknown' });

// Matches STALE_AFTER_MS in StandaloneScanner.js. Duplicated as a named
// export rather than imported so this module stays free of browser code and
// testable in Node; the test asserts they agree.
export const CACHE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Rows for the drawer, in the order they matter at 3am.
 *
 * Everything is defensive about absent input: a kiosk mid-teardown, or one
 * whose cache read failed, should still render a drawer that says "unknown"
 * rather than throwing inside a diagnostic.
 */
export function healthRows(state = {}) {
  const {
    online, lastRequestFailed, queued,
    cacheRows, cacheSyncedAt, cacheAgeMs,
    photosCached, audioUnlocked, soundsLoaded,
    scannerId, site, nowMs = Date.now(),
  } = state;

  const rows = [];

  // Connection first: it explains most of the rows under it.
  rows.push({
    key: 'connection',
    label: 'Connection',
    value: online === false ? 'offline' : (lastRequestFailed ? 'unreachable' : 'online'),
    // navigator.onLine said "online" while scans were queueing beside it,
    // which is why the last request's real outcome decides this and not the
    // flag. Same reasoning as Utils/connectionState.js.
    state: online === false ? HEALTH.BAD : (lastRequestFailed ? HEALTH.WARN : HEALTH.GOOD),
  });

  const n = Number(queued);
  rows.push({
    key: 'queue',
    label: 'Queued scans',
    value: Number.isFinite(n) ? String(n) : 'unknown',
    // A queue is not a fault — it is the offline design working. It only
    // matters if it is not draining, which the connection row above says.
    state: !Number.isFinite(n) ? HEALTH.UNKNOWN : (n === 0 ? HEALTH.GOOD : HEALTH.WARN),
  });

  const rowCount = Number(cacheRows);
  const age = Number(cacheAgeMs);
  rows.push({
    key: 'cache',
    label: 'Offline cards',
    value: !cacheSyncedAt
      ? 'never synced'
      : `${Number.isFinite(rowCount) ? rowCount.toLocaleString() : '?'} cards · ${fmtAge(age)}`,
    // Never synced is the dangerous one: this kiosk cannot work at all if the
    // network drops, and nothing else would tell you until it did.
    state: !cacheSyncedAt
      ? HEALTH.BAD
      : (Number.isFinite(age) && age > CACHE_STALE_AFTER_MS ? HEALTH.WARN : HEALTH.GOOD),
  });

  // NO DENOMINATOR, deliberately — this read "776 of 835" and meant nothing.
  //
  // 835 is the number of CARDS. The offline cache row (see
  // 20261005000000) carries proximity_code, card_active, employee_id,
  // full_name, employee_code, department, position, updated_at,
  // employee_status, scan_count and remarks_log — and no photo field at all.
  // Thumbnails arrive through a separate cache and are merged in afterwards.
  // So the kiosk knows how many photos it HAS and has no way to know how many
  // it SHOULD have: an employee with no photo on file is indistinguishable
  // from one whose photo has not downloaded.
  //
  // Against total cards the figure was guaranteed to look short. Unassigned
  // cards can never have a photo, and neither can an employee who simply has
  // none — Settings reported exactly 776 thumbnails in existence, so the
  // cache was COMPLETE while this row implied 59 failed downloads. A
  // diagnostic that invents a shortfall sends someone to fix nothing.
  //
  // Same rule as the site row below: state what was measured, not what was
  // inferred from a number that happened to be nearby.
  const photos = Number(photosCached);
  rows.push({
    key: 'photos',
    label: 'Cached photos',
    value: !Number.isFinite(photos) ? 'unknown' : photos.toLocaleString(),
    // Zero IS knowable and worth flagging: nothing downloaded means every
    // offline scan falls back to initials. Any non-zero count is reported
    // without judgement, because there is nothing to judge it against.
    state: !Number.isFinite(photos)
      ? HEALTH.UNKNOWN
      : (photos === 0 && rowCount > 0 ? HEALTH.WARN : HEALTH.GOOD),
  });

  rows.push({
    key: 'audio',
    label: 'Scan sounds',
    value: soundsLoaded === false
      ? 'none uploaded'
      : (audioUnlocked ? 'ready' : 'waiting for a tap'),
    // Not BAD: a silent kiosk still records scans correctly. But it is the
    // failure that looks like nothing is wrong, so it is never GOOD until a
    // gesture has actually unlocked playback.
    state: soundsLoaded === false
      ? HEALTH.UNKNOWN
      : (audioUnlocked ? HEALTH.GOOD : HEALTH.WARN),
  });

  // `site` has THREE meaningful values and the row says a different thing for
  // each: a string is the configured site, null means genuinely not set, and
  // undefined means nobody asked. The kiosk passes undefined, because looking
  // the site up costs a request (get_scanner_sites) and this drawer is
  // supposed to cost nothing — so it must not print "no site set", which is a
  // claim it has not earned and which would send someone to fix a setting
  // that may already be correct.
  const siteKnown = site !== undefined;
  rows.push({
    key: 'identity',
    label: 'This scanner',
    value: !scannerId
      ? 'unknown'
      : `${scannerId}${siteKnown ? (site ? ` · ${site}` : ' · no site set') : ''}`,
    // Only warn about a missing site when it was actually checked. Without a
    // site, card-sharing detection (20261104093000) cannot involve this
    // reader — configured-off rather than broken.
    state: !scannerId
      ? HEALTH.UNKNOWN
      : (!siteKnown ? HEALTH.GOOD : (site ? HEALTH.GOOD : HEALTH.WARN)),
  });

  return rows;
}

/** The worst state present, for the drawer's own handle. */
export function overallHealth(rows) {
  const states = (Array.isArray(rows) ? rows : []).map((r) => r?.state);
  if (states.includes(HEALTH.BAD)) return HEALTH.BAD;
  if (states.includes(HEALTH.WARN)) return HEALTH.WARN;
  if (states.length && states.every((s) => s === HEALTH.GOOD)) return HEALTH.GOOD;
  return HEALTH.UNKNOWN;
}

/**
 * Milliseconds -> "2h old". Null/absent -> "age unknown".
 *
 * The null check comes BEFORE the coercion on purpose: Number(null) is 0, and
 * Number.isFinite(0) is true, so a missing age would otherwise sail through
 * and render as "just synced" — a confident claim that the cache is fresh,
 * made at exactly the moment nothing is known about it. Same trap that put a
 * 0% progress bar on screen on 2026-11-03 and a 00:00 average arrival on
 * 2026-11-04.
 */
export function fmtAge(ms) {
  if (ms === null || ms === undefined || ms === '') return 'age unknown';
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return 'age unknown';
  const minutes = Math.floor(value / 60000);
  if (minutes < 1) return 'just synced';
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}
