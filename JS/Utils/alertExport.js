// Alerts, shaped for a spreadsheet.
//
// WHY THIS COSTS NOTHING. AlertsPage already holds the rows it is showing —
// paint() renders them and rowsCache keeps them for a nav-away and back. The
// export reads that same array. No request, no bytes, no log line, and
// nothing new on the server. The same approach as every other export in this
// app except "Export all scan logs", which pages the database and is the
// only one recorded in the export ledger.
//
// THE COROLLARY, WHICH THE BUTTON HAS TO SAY OUT LOUD: an export of what is
// loaded is an export of at most get_alerts()' page — 100 rows by default.
// With 422 alerts on the project that is the newest quarter of them. A
// download silently holding a fraction of the table would be exactly the
// kind of quiet wrongness this app keeps finding, so the count goes in the
// filename and the caller is told what it got.
//
// Its own module rather than living in AlertsPage: these are pure functions
// over plain objects, so they can be tested under Node, and the page file
// imports the Supabase client.

// Keys promoted out of `detail` into real columns. Chosen because they are
// what somebody filters or pivots on, and because they recur across kinds:
// scanner_id and proximity_code come from the scan-path alerts,
// employee_code/full_name/department from open_punch and
// inactive_employee_scan. Anything not listed still ships, in `details`.
const PROMOTED = Object.freeze([
  ['employee_code', 'Employee code'],
  ['full_name', 'Employee'],
  ['department', 'Department'],
  ['scanner_id', 'Scanner'],
  ['proximity_code', 'Card code'],
]);

export const ALERT_EXPORT_COLUMNS = Object.freeze([
  { key: 'when', label: 'When' },
  { key: 'severity', label: 'Severity' },
  { key: 'kind', label: 'Type' },
  { key: 'message', label: 'Message' },
  ...PROMOTED.map(([key, label]) => ({ key, label, text: true })),
  { key: 'status', label: 'Status' },
  { key: 'acknowledged_at', label: 'Acknowledged at' },
  { key: 'acknowledged_by', label: 'Acknowledged by' },
  { key: 'details', label: 'Details' },
]);

// employee_code and proximity_code are `text: true` because they are digit
// strings — 4304, 5567, 0005204037 — and Excel will happily reinterpret
// those as numbers and drop the leading zeros. Same convention as every
// other export here; see Utils/xlsxExport.js.

const str = (v) => (v == null ? '' : String(v));

/**
 * The leftover detail keys, as one readable cell.
 *
 * Deliberately not JSON: a spreadsheet cell holding `{"hours":12,...}` is
 * worse to read than `hours: 12 · in at: 2026-11-18T11:28:45Z`, and the
 * promoted keys are removed so they do not appear twice.
 */
export function detailRest(detail, promoted = PROMOTED.map(([k]) => k)) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return '';
  return Object.entries(detail)
    .filter(([k, v]) => !promoted.includes(k) && v != null && v !== '')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' · ');
}

/**
 * One export row per alert.
 *
 * `fmt` is injected so the sheet carries the same timestamps the table does
 * — a download that disagreed with the screen about when something happened
 * would be its own small bug. Defaults to the raw ISO value, which is what a
 * test wants and what a spreadsheet can still sort.
 */
export function alertExportRows(alerts, { fmt = (v) => str(v), kindLabel = (k) => str(k) } = {}) {
  return (Array.isArray(alerts) ? alerts : []).map((a) => {
    const detail = a?.detail && typeof a.detail === 'object' && !Array.isArray(a.detail) ? a.detail : {};
    const row = {
      when: fmt(a?.created_at),
      severity: str(a?.severity),
      kind: kindLabel(a?.kind),
      message: str(a?.message),
      // Acknowledged or not is the thing people filter on, so it is its own
      // word rather than something to infer from an empty timestamp cell.
      status: a?.acknowledged_at ? 'Acknowledged' : 'Unread',
      acknowledged_at: a?.acknowledged_at ? fmt(a.acknowledged_at) : '',
      acknowledged_by: str(a?.acknowledged_by_name),
      details: detailRest(detail),
    };
    for (const [key] of PROMOTED) row[key] = str(detail[key]);
    return row;
  });
}

/**
 * Filename, carrying the row count and whether acknowledged rows are in it.
 *
 * The count is in the name on purpose. This exports what is loaded, which is
 * one page of get_alerts(), and a file called `alerts-2026-11-19.xlsx`
 * holding 100 of 422 rows invites exactly the wrong conclusion.
 */
export function alertExportFilename(count, { showAcked = false, stamp = '' } = {}) {
  const n = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  const scope = showAcked ? 'all' : 'unread';
  return `alerts-${scope}-${n}${stamp ? `-${stamp}` : ''}`;
}
