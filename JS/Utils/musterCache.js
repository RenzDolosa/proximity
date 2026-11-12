// Keeps the last on-site roster on the device so the muster list works with
// no network.
//
// This is the whole point of the feature. A fire, a power cut or a severed
// line is often WHY the building is being evacuated, so a roster that needs
// the server is a roster that is absent exactly when it is needed. Nothing
// here fetches: it piggybacks on the snapshot the Dashboard has already
// downloaded, so it costs no request, no egress and no log event.
//
// localStorage rather than IndexedDB, unlike the kiosk's offline caches: this
// is one small object written a few times an hour and read once in an
// emergency, and a synchronous read needs no await on a page someone is
// opening while walking. Measured on the live roster — 361 people — at about
// 40 KB against a ~5 MB budget.
//
// It holds names, codes and departments. That is the same class of data the
// kiosk already stores locally (see OfflineScanModel), on a device that is
// already signed in to the app — but it is why clear() runs on sign-out.
const KEY = 'proximity.muster.snapshot';

// THE ROLL CALL ITSELF, which until now lived only in a module-scope Set.
//
// Assembly mode was already persisted — one localStorage write per toggle,
// three lines below where `accounted` was declared. The ticks were not, so a
// refresh, a crash, or the service worker activating mid-evacuation lost
// every one of them. On a phone, outdoors, 212 names in, the only recovery
// was to start again while people stood in a car park.
//
// Two rules keep a stored roll call from becoming a lie:
//
//   1. It EXPIRES. An evacuation is minutes to hours. A tick still sitting
//      here tomorrow describes a different headcount, and showing it would
//      be worse than showing none.
//   2. It is PRUNED to the people actually on the current sheet — see
//      pruneAccounted(). Refresh replaces the snapshot, and an id that is no
//      longer on it must not keep counting toward a site's total.
const ACCOUNTED_KEY = 'proximity.muster.accounted';

/** Past this, a stored roll call is a different day's and is discarded. */
export const ACCOUNTED_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const UNLISTED_KEY = 'proximity.muster.unlisted';

/** Only the fields the muster sheet renders, so the stored copy stays small. */
export function toSnapshotRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    employee_code: r.employee_code,
    department: r.department,
    last_in_at: r.last_in_at,
    last_scanner_id: r.last_scanner_id,
    status: r.status,
  }));
}

export function saveSnapshot(rows, nowIso = new Date().toISOString()) {
  try {
    const payload = { saved_at: nowIso, rows: toSnapshotRows(rows) };
    localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch {
    // A full or disabled store must never break the Dashboard that called
    // this. The muster page then says it has no snapshot, which is true.
    return false;
  }
}

export function readSnapshot() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    return { savedAt: parsed.saved_at || null, rows: parsed.rows };
  } catch {
    return null; // corrupt entry reads as "no snapshot", not as a crash
  }
}

export function clearSnapshot() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clean up */ }
}

// ---- the roll call ----

/** @param {Iterable<string>} ids */
export function saveAccounted(ids, nowIso = new Date().toISOString()) {
  try {
    localStorage.setItem(ACCOUNTED_KEY, JSON.stringify({ saved_at: nowIso, ids: [...ids] }));
    return true;
  } catch {
    // A full store must not break a headcount in progress. The ticks stay in
    // memory for this session; only their survival across a reload is lost.
    return false;
  }
}

/**
 * The stored roll call, or an empty Set.
 *
 * Returns a Set rather than an array because that is what the caller holds
 * and compares against — handing back an array would put the conversion at
 * every call site, and one of them would forget.
 */
export function readAccounted(nowMs = Date.now()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNTED_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.ids)) return new Set();
    const at = Date.parse(parsed.saved_at);
    // A missing or unparseable timestamp is treated as expired, not as
    // "fresh forever": Date.parse(undefined) is NaN, and a NaN comparison is
    // false in both directions, so this has to be explicit.
    if (!Number.isFinite(at) || nowMs - at > ACCOUNTED_MAX_AGE_MS || nowMs < at) return new Set();
    return new Set(parsed.ids.filter((id) => typeof id === 'string' && id));
  } catch {
    return new Set();
  }
}

export function clearAccounted() {
  try { localStorage.removeItem(ACCOUNTED_KEY); } catch { /* nothing to clean up */ }
}

// ---- people who are present and not on the sheet ----

/**
 * The sheet is exactly the snapshot, and two kinds of person can never be on
 * it: anyone who tapped in after it was taken, and anyone who has no card at
 * all — a contractor, a visitor, a delivery driver. At an assembly point
 * those are precisely the people a marshal needs written down, and without
 * this the record is a note on somebody's phone that nobody collates.
 *
 * Free text on purpose. "contractor — 2 men" is a real thing to record at a
 * fire door and no dropdown of employees can express it.
 */
export function saveUnlisted(entries, nowIso = new Date().toISOString()) {
  try {
    localStorage.setItem(UNLISTED_KEY, JSON.stringify({ saved_at: nowIso, entries: [...entries] }));
    return true;
  } catch {
    return false;
  }
}

/** @returns {Array<{id: string, label: string}>} */
export function readUnlisted(nowMs = Date.now()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(UNLISTED_KEY) || 'null');
    if (!parsed || !Array.isArray(parsed.entries)) return [];
    const at = Date.parse(parsed.saved_at);
    // Same expiry as the ticks, and for the same reason: these belong to one
    // headcount. Keeping them would put yesterday's visitors on today's list.
    if (!Number.isFinite(at) || nowMs - at > ACCOUNTED_MAX_AGE_MS || nowMs < at) return [];
    return parsed.entries
      .filter((e) => e && typeof e.id === 'string' && typeof e.label === 'string' && e.label.trim())
      .map((e) => ({ id: e.id, label: e.label }));
  } catch {
    return [];
  }
}

export function clearUnlisted() {
  try { localStorage.removeItem(UNLISTED_KEY); } catch { /* nothing to clean up */ }
}
