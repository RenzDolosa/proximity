// Thirty days of one employee's attendance, from the array the scan log
// modal has already downloaded.
//
// COSTS NOTHING. openScanLogModal() fetches employees.scan_logs in full to
// list it — some employees carry 1,000+ entries — and then paints at most
// RENDER_CAP of them. This reads the same array that is already in memory.
// No RPC, no column, no migration: a thirty-cell grid is the cheapest
// feature in this app by a wide margin.
//
// WHAT A DAY'S COLOUR MEANS, and why "odd hours" is defined the way it is.
// There is no schedule to compare against: shift_rules is empty, and
// scanners have no department to key it by even when it is not. Inventing
// 09:00-17:00 would flag an entire night shift as anomalous. So the
// comparison is against THIS EMPLOYEE'S OWN median first-IN and last-OUT —
// self-referential, needs no configuration, and is correct for a night
// shift without being told one exists. When there is not enough history to
// take a median the outlier test is switched off entirely rather than run
// on two data points; `basis` says which happened and the UI prints it.
//
// Entry shape, from the trigger in 20261024090000:
//   { scan_id, proximity_code, scanner_id, scanned_at, result, direction,
//     offline }
// `direction` alternates in/out by parity and is re-derived on a backdated
// arrival, so it is authoritative — this never tries to re-pair scans
// itself.

export const HEATMAP_DAYS = 30;

/** Days needed before a median is worth taking. Below this, no outliers. */
export const MIN_DAYS_FOR_MEDIAN = 5;

/** How far from this employee's own median counts as an odd hour. */
export const ODD_HOUR_TOLERANCE_MIN = 120;

export const DAY_STATE = Object.freeze({
  NONE: 'none',
  COMPLETE: 'complete',
  OPEN: 'open',
  ODD: 'odd',
});

/**
 * Local YYYY-MM-DD.
 *
 * en-CA because it is the one common locale whose short date is already
 * ISO-ordered, so these sort as strings. LOCAL, not UTC: it has to line up
 * with what fmtTime() shows the reader and with ScanLogModal's own
 * localDateKey(), or a 23:00 scan lands in tomorrow's cell for anyone east
 * of Greenwich. Same bug class as requestMeter's dayKey().
 */
export function dayKey(value) {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-CA') : null;
}

/** Minutes since local midnight, or null for anything unparseable. */
export function minutesOfDay(value) {
  const d = toDate(value);
  return d ? d.getHours() * 60 + d.getMinutes() : null;
}

/**
 * A real Date, or null.
 *
 * The nullish guard is load-bearing and not defensive clutter: `new
 * Date(null)` is the EPOCH, not an invalid date, because null numifies to 0.
 * Without it a scan_logs entry with a null scanned_at lands in a
 * 1970-01-01 bucket that silently never matches any cell. Same family as
 * `Number(null) === 0` being finite, which put unknown durations at the top
 * of the occupancy board in November.
 */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'HH:MM' from minutes-since-midnight. */
export function fmtMinutes(mins) {
  if (!Number.isFinite(mins)) return null;
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Middle value, averaging the two middles on an even count.
 *
 * Median rather than mean on purpose: one 03:00 callout would drag a mean
 * far enough to make a week of ordinary mornings look late.
 */
export function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** The last `days` local dates ending today, oldest first. */
export function recentDayKeys(days = HEATMAP_DAYS, now = Date.now()) {
  const n = Math.max(1, Math.floor(Number(days)) || HEATMAP_DAYS);
  const end = new Date(now);
  const keys = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    // Date arithmetic rather than subtracting 86_400_000 ms: a DST boundary
    // makes a local day 23 or 25 hours long, and the fixed-millisecond form
    // silently repeats or skips a day twice a year.
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    keys.push(d.toLocaleDateString('en-CA'));
  }
  return keys;
}

/**
 * Group raw scan_logs entries by local day.
 *
 * Order-independent: the array arrives newest-first from the modal and in
 * scanned_at order from the database, and this must not care which.
 */
function groupByDay(logs) {
  const byDay = new Map();
  for (const entry of Array.isArray(logs) ? logs : []) {
    const key = dayKey(entry?.scanned_at);
    if (!key) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(entry);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at));
  }
  return byDay;
}

/** First IN and last OUT of one day's entries, in minutes since midnight. */
function bounds(entries) {
  let firstIn = null;
  let lastOut = null;
  for (const e of entries) {
    const mins = minutesOfDay(e?.scanned_at);
    if (mins === null) continue;
    if (e?.direction === 'in') { if (firstIn === null) firstIn = mins; }
    else if (e?.direction === 'out') lastOut = mins;
  }
  return { firstIn, lastOut };
}

/**
 * Thirty days of buckets plus a summary.
 *
 * @param {Array} logs raw `employees.scan_logs`
 * @param {{days?: number, now?: number, tolerance?: number}} [opts]
 */
export function buildHeatmap(logs, { days = HEATMAP_DAYS, now = Date.now(), tolerance = ODD_HOUR_TOLERANCE_MIN } = {}) {
  const byDay = groupByDay(logs);
  const keys = recentDayKeys(days, now);

  const raw = keys.map((key) => {
    const entries = byDay.get(key) || [];
    const { firstIn, lastOut } = bounds(entries);
    return { key, count: entries.length, firstIn, lastOut };
  });

  // The median is taken over CLOSED days only. An unclosed day has no
  // last-OUT to contribute, and letting it contribute a null would not
  // merely skip it — it would shift which value sits in the middle.
  const closed = raw.filter((d) => d.firstIn !== null && d.lastOut !== null);
  const enough = closed.length >= MIN_DAYS_FOR_MEDIAN;
  const medianIn = enough ? median(closed.map((d) => d.firstIn)) : null;
  const medianOut = enough ? median(closed.map((d) => d.lastOut)) : null;

  const tol = Number.isFinite(tolerance) ? tolerance : ODD_HOUR_TOLERANCE_MIN;
  const isOdd = (d) => {
    if (!enough || d.count === 0) return false;
    const inOff = d.firstIn !== null && medianIn !== null && Math.abs(d.firstIn - medianIn) > tol;
    const outOff = d.lastOut !== null && medianOut !== null && Math.abs(d.lastOut - medianOut) > tol;
    return inOff || outOff;
  };

  const out = raw.map((d) => {
    let state = DAY_STATE.NONE;
    if (d.count > 0) {
      // Precedence, and it matters: an unclosed day whose arrival was also
      // unusual is reported as OPEN. A missing OUT is a data problem someone
      // has to fix; an odd hour is an observation. The actionable one wins,
      // same precedence rule as attendanceStatus().
      if (d.firstIn !== null && d.lastOut === null) state = DAY_STATE.OPEN;
      else if (isOdd(d)) state = DAY_STATE.ODD;
      else state = DAY_STATE.COMPLETE;
    }
    const minutes = d.firstIn !== null && d.lastOut !== null && d.lastOut > d.firstIn
      ? d.lastOut - d.firstIn
      : null;
    return { ...d, state, minutes };
  });

  return {
    days: out,
    summary: {
      totalScans: out.reduce((n, d) => n + d.count, 0),
      daysWithScans: out.filter((d) => d.count > 0).length,
      openDays: out.filter((d) => d.state === DAY_STATE.OPEN).length,
      oddDays: out.filter((d) => d.state === DAY_STATE.ODD).length,
      medianIn: fmtMinutes(medianIn),
      medianOut: fmtMinutes(medianOut),
      // 'self' means outliers were judged against this employee's own
      // median. 'insufficient' means they were not judged at all — which the
      // UI must say, rather than showing zero outliers as if it had looked.
      basis: enough ? 'self' : 'insufficient',
      closedDays: closed.length,
    },
  };
}

/**
 * Four intensity steps for a day's scan count, for the CSS class suffix.
 *
 * Buckets rather than a continuous scale: at 30 cells the eye reads bands,
 * not gradients, and a continuous ramp makes two adjacent ordinary days look
 * meaningfully different when they are not.
 */
export function intensity(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 8) return 3;
  return 4;
}

/** One cell's tooltip. Plain text — the caller escapes it. */
export function dayLabel(day, { fmtDate = (k) => k } = {}) {
  if (!day) return '';
  const when = fmtDate(day.key);
  if (!day.count) return `${when} — no scans`;
  const inAt = fmtMinutes(day.firstIn);
  const outAt = fmtMinutes(day.lastOut);
  const span = inAt && outAt ? `${inAt} → ${outAt}`
    : inAt ? `${inAt} → no OUT`
    : 'no IN recorded';
  const hours = Number.isFinite(day.minutes)
    ? ` · ${Math.floor(day.minutes / 60)}h ${String(day.minutes % 60).padStart(2, '0')}m`
    : '';
  return `${when} — ${span}${hours} · ${day.count} scan${day.count === 1 ? '' : 's'}`;
}
