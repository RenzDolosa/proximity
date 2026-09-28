// Pure helpers for the Scanner Analytics drill-down (see
// Components/ScanDetailsModal.js). No DOM, no state — unit-tested in
// test/scan-details.test.mjs.
//
// FILTERS is the client-side twin of get_scanner_scan_details()'s closed
// p_filter list in Supabase/migrations/20260928080000_scanner_analytics_drilldown.sql.
// Keep the two in step: the RPC raises on anything not in its list.
export const FILTERS = {
  all: 'All scans',
  matched: 'Matched scans',
  unmatched: 'Unmatched scans',
  inactive_card: 'Inactive card scans',
  inactive_employee: 'Inactive employee scans',
  unassigned_card: 'Unassigned card scans',
  offline: 'Scans captured offline',
};

// Human label for a scan_events.result value. Unknown values fall back to
// the raw string rather than hiding a result the UI hasn't heard of yet.
export const RESULT_LABEL = {
  matched: 'Matched',
  unmatched: 'Unmatched',
  inactive_card: 'Inactive card',
  inactive_employee: 'Inactive employee',
  unassigned_card: 'Unassigned card',
};
export const resultLabel = (result) => RESULT_LABEL[result] || result || '—';

export const isKnownFilter = (filter) => Object.prototype.hasOwnProperty.call(FILTERS, filter);

// A card showing 0 has nothing behind it, so it isn't a drill-down target.
export const canDrillDown = (count) => Number.isFinite(Number(count)) && Number(count) > 0;

export function detailsTitle({ filter = 'all', scannerId = null } = {}) {
  const base = isKnownFilter(filter) ? FILTERS[filter] : FILTERS.all;
  return scannerId ? `${base} — ${scannerId}` : base;
}

// "Showing 500 of 2,214" style caption; empty when everything is shown.
export function capNotice(shown, total) {
  if (!Number.isFinite(total) || total <= shown) return '';
  return `Showing the most recent ${shown} of ${total}. Narrow the date range or pick a scanner to see others.`;
}
