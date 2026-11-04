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
