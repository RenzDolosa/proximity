// The logic behind the combined date-range control, kept DOM-free so the
// arithmetic is unit-tested rather than eyeballed through a popover.
//
// All dates are 'YYYY-MM-DD' in the LOCAL calendar — the same convention
// Utils/attendance.js uses, and for the same reason: toISOString() would shift
// the day for anyone west of UTC, so a range picked on the 9th could query the
// 8th.

/** 'YYYY-MM-DD' for `d` in the local calendar. */
export function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function shiftDays(from, days) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

// Offered in every picker. "Last 7 days" counts today as one of the seven,
// which is what someone asking for a week of attendance means.
export const RANGE_PRESETS = Object.freeze([
  { id: 'today', label: 'Today' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
  { id: 'month', label: 'This month' },
]);

/** A preset id -> { from, to }, or null for an unknown id. */
export function rangeFromPreset(preset, today = new Date()) {
  const to = localDate(today);
  switch (preset) {
    case 'today': return { from: to, to };
    case '7': return { from: localDate(shiftDays(today, -6)), to };
    case '30': return { from: localDate(shiftDays(today, -29)), to };
    case 'month': return { from: localDate(new Date(today.getFullYear(), today.getMonth(), 1)), to };
    default: return null;
  }
}

/** dd/mm/yyyy, matching the date inputs' own display format. */
export function formatDisplayDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = String(ymd).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(ymd);
}

/**
 * What the closed control reads. `emptyLabel` covers the case both sides are
 * blank, which several callers treat as "no bound" rather than as invalid.
 */
export function formatRangeLabel(from, to, emptyLabel = 'All dates') {
  if (!from && !to) return emptyLabel;
  if (from && !to) return `From ${formatDisplayDate(from)}`;
  if (!from && to) return `Until ${formatDisplayDate(to)}`;
  if (from === to) return formatDisplayDate(from);
  return `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
}

/**
 * Normalises what the two inputs hold into the range that should be applied.
 * Swaps an inverted pair rather than rejecting it — the old two-input toolbars
 * did the same (Utils/dateRange.js), and refusing is never more useful than
 * doing the obvious thing.
 */
export function normaliseRange(from, to) {
  const a = from || '';
  const b = to || '';
  if (a && b && a > b) return { from: b, to: a };
  return { from: a, to: b };
}
