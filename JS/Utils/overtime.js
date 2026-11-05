// Pure helpers for overtime and break time — no DOM, no Supabase.
//
// Same split as Utils/punctuality.js: the server decides, this formats. The
// overtime comparison happens in SQL (20261106090000) because expected_minutes
// is the single source of truth for a figure that reaches payroll, and because
// the server is the only place that knows a day was flagged for review and
// therefore has no final hours.
//
// Break time is the exception, and deliberately so — see breakSeconds().

/** Three states, mirroring PUNCTUALITY_STATE. */
export const OVERTIME_STATE = Object.freeze({
  UNCONFIGURED: 'unconfigured',
  NO_DATA: 'no-data',
  READY: 'ready',
});

/**
 * Which of the three the overtime strip should say.
 *
 * `expectedConfigured` is a separate flag from punctuality's
 * `rulesConfigured`, because the two halves of a shift are configured
 * independently: a rule can have a start time and no expected hours, which
 * means punctuality works and overtime cannot.
 */
export function overtimeState(summary) {
  if (!summary || summary.expectedConfigured !== true) return OVERTIME_STATE.UNCONFIGURED;
  if (measuredDays(summary) <= 0) return OVERTIME_STATE.NO_DATA;
  return OVERTIME_STATE.READY;
}

/**
 * Days that got an overtime figure at all.
 *
 * Total minus unmeasured, NOT overDays + shortDays: a day worked to exactly
 * the expected minute is measured and is neither, so adding the two would
 * undercount it and make the denominator disagree with the server's own
 * unmeasured_days.
 */
export function measuredDays(summary) {
  return Math.max(0, toCount(summary?.days) - toCount(summary?.unmeasuredDays));
}

/**
 * BREAK TIME COSTS NOTHING — not one extra column, nothing.
 *
 * first_in, last_out and worked_seconds are already on every report row.
 * Time on site minus time worked is break time, so this is arithmetic on
 * bytes already downloaded: no migration, no payload change, no request.
 * That is the entire reason it is computed here rather than in SQL, and the
 * only place in either feature where the browser derives a figure.
 *
 * Null when the day has no OUT — an open day has no end, so "time on site"
 * is not a quantity yet. Also null if the arithmetic goes negative, which
 * would mean last_out precedes first_in; that is the `anomaly` case, and a
 * negative break is not a thing to render.
 */
/**
 * Below this, a gap off site is not worth showing.
 *
 * Every row with more than one IN has some gap, and a five-minute one is a
 * delivery or a smoke break, not information. Thirty minutes is roughly where
 * it stops being noise and starts being a lunch somebody might ask about.
 * Shown, never acted on — nothing subtracts this from anyone's hours, because
 * worked_seconds already excludes it.
 */
export const BREAK_NOTICE_SECONDS = 30 * 60;

export function breakSeconds(row) {
  const inAt = Date.parse(row?.first_in);
  const outAt = Date.parse(row?.last_out);
  if (!Number.isFinite(inAt) || !Number.isFinite(outAt)) return null;

  const onSite = Math.floor((outAt - inAt) / 1000);
  const worked = Number(row?.worked_seconds);
  if (!Number.isFinite(worked) || worked < 0) return null;

  const gap = onSite - worked;
  return gap > 0 ? gap : null;
}

/**
 * Signed minutes -> a short phrase. Positive is over, negative is short.
 *
 * Null stays null so the caller renders nothing: the server returns null when
 * there is no expected figure OR when the day is flagged for review, and
 * printing "0m over" for either would assert something it declined to say.
 */
export function fmtOvertime(minutes) {
  if (minutes === null || minutes === undefined || minutes === '') return null;
  const mins = Number(minutes);
  if (!Number.isFinite(mins)) return null;
  if (mins === 0) return 'exactly expected';
  const magnitude = Math.abs(mins);
  const h = Math.floor(magnitude / 60);
  const m = magnitude % 60;
  const span = h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  return mins > 0 ? `${span} over` : `${span} short`;
}

/** Minutes -> "214h" / "45m", for the totals. Null/zero-safe. */
export function fmtHoursTotal(minutes) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return '0h';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

/**
 * Whether a row should carry the overtime marker.
 *
 * Reads the server's signed figure and nothing else. Deliberately does NOT
 * fall back to comparing worked_seconds against anything the client knows,
 * because the client does not know expected_minutes — and must not, or the
 * two would drift.
 */
export function isOver(row) {
  const mins = Number(row?.overtime_minutes);
  return Number.isFinite(mins) && mins > 0;
}

export function isShort(row) {
  const mins = Number(row?.overtime_minutes);
  return Number.isFinite(mins) && mins < 0;
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
