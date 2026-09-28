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

/** Case-insensitive filter over name/code, plus an exact department match ('' = all). */
export function filterRows(rows, { query = '', department = '', status = '' } = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (department && (r.department || '') !== department) return false;
    if (status && attendanceStatus(r) !== status) return false;
    if (!q) return true;
    return (r.full_name || '').toLowerCase().includes(q) || (r.employee_code || '').toLowerCase().includes(q);
  });
}

/** Headline numbers for the rows currently shown. */
export function summarize(rows) {
  const people = new Set();
  let workedSeconds = 0, open = 0, anomalies = 0;
  for (const r of rows) {
    people.add(r.employee_id);
    workedSeconds += Number(r.worked_seconds) || 0;
    const s = attendanceStatus(r);
    if (s === 'open') open++;
    if (s === 'anomaly') anomalies++;
  }
  return { employees: people.size, days: rows.length, workedSeconds, open, anomalies };
}
