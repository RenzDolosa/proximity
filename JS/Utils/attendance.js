// Pure helpers for the Attendance page — no DOM, no Supabase, so the
// rules that decide what a row *means* (complete / still clocked in /
// suspicious) live somewhere unit-testable instead of inline in a page.
//
// The rows come from get_attendance_report(); see Supabase/README.md for
// how a row is built (IN/OUT pairing from employees.scan_logs' own
// sequence, day = the IN's date in the requested time zone).

// Mirrors the RPC's own cap ("date range too large (max 31 days)") so the
// page can refuse a bad range instantly instead of round-tripping to be
// told no. The server check is still the real one.
export const MAX_RANGE_DAYS = 31;

/** 'anomaly' beats 'open' beats 'complete' — an anomaly is the one a human must look at. */
export function attendanceStatus(row) {
  if (row.anomaly) return 'anomaly';
  if (row.open_punch) return 'open';
  return 'complete';
}

export const STATUS_LABEL = {
  complete: 'Complete',
  open: 'No OUT yet',
  anomaly: 'Check times',
};

/** 5400 -> "1h 30m"; under a minute -> "<1m"; null/negative -> "—". */
export function fmtDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return seconds > 0 ? '<1m' : '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Decimal hours rounded to 2dp — for the spreadsheet's numeric column. */
export function toDecimalHours(seconds) {
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round((seconds / 3600) * 100) / 100 : '';
}

/**
 * Inclusive day count between two 'YYYY-MM-DD' strings, or NaN if either is
 * missing/invalid. Uses UTC math on purpose: local-time Date arithmetic is
 * off by an hour across a DST change and would miscount a range.
 */
export function daysInRange(from, to) {
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(f) || Number.isNaN(t)) return NaN;
  return Math.round((t - f) / 86400000) + 1;
}

/** Returns an error message for an unusable range, or null when it's fine. */
export function validateRange(from, to) {
  const n = daysInRange(from, to);
  if (Number.isNaN(n)) return 'Pick both a from and a to date.';
  if (n < 1) return 'The to date must not be before the from date.';
  if (n > MAX_RANGE_DAYS) return `Pick a range of ${MAX_RANGE_DAYS} days or less.`;
  return null;
}

/** 'YYYY-MM-DD' for `d` in the *local* calendar (not UTC — toISOString would shift the day). */
export function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Default report window: the last 7 days including today. */
export function defaultRange(today = new Date()) {
  const start = new Date(today);
  start.setDate(start.getDate() - 6);
  return { from: localDateString(start), to: localDateString(today) };
}

/** get_attendance_summary()'s single row -> the shape the stat cards read. */
export function toSummary(row) {
  const r = Array.isArray(row) ? row[0] : row;
  return {
    days: Number(r?.row_count) || 0,
    employees: Number(r?.employees) || 0,
    workedSeconds: Number(r?.worked_seconds) || 0,
    open: Number(r?.open_punches) || 0,
    anomalies: Number(r?.anomalies) || 0,
  };
}

// filterRows() and summarize() lived here until 2026-10-09. Both moved into
// SQL (20261009000000): filtering one downloaded page would have filtered the
// page rather than the report, and totals derived from a page describe the
// page. The server now answers both for the whole filtered set.
