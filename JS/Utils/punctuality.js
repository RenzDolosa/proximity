// Pure helpers for the punctuality panel — no DOM, no Supabase, so the rules
// that decide what "84% on time" means live somewhere unit-testable.
//
// Classification itself happens in SQL (20261104090000): the server compares
// each day's first IN against the shift rule for that employee's department
// and hands back `late` plus `first_in_offset_minutes`. Nothing here decides
// whether someone was late — these functions only format and aggregate what
// the server already judged. That split is deliberate: the shift times are the
// single source of truth for a figure that reaches HR, and duplicating the
// comparison in the browser would be a second place for it to drift.

// Why this is not just `onTime + late > 0`: a range with no rows also gives
// zero, and the panel has to tell "nobody has set a shift time" apart from
// "this filter matched nothing". Only the server knows the former, which is
// why get_attendance_summary() returns rules_configured explicitly.
export const PUNCTUALITY_STATE = Object.freeze({
  UNCONFIGURED: 'unconfigured',
  NO_DATA: 'no-data',
  READY: 'ready',
});

/**
 * Which of the three things the panel should say.
 *
 * `unconfigured` wins over `no-data`: if no shift rule exists then no number
 * in this panel can mean anything, and saying "0% on time" would be a
 * fabrication rather than an empty state.
 */
export function punctualityState(summary) {
  if (!summary || summary.rulesConfigured !== true) return PUNCTUALITY_STATE.UNCONFIGURED;
  if (classifiedDays(summary) <= 0) return PUNCTUALITY_STATE.NO_DATA;
  return PUNCTUALITY_STATE.READY;
}

/** Days the rules could actually judge — the only honest denominator. */
export function classifiedDays(summary) {
  return toCount(summary?.onTime) + toCount(summary?.lateDays);
}

/**
 * On-time share as a whole percent, or null when there is nothing to divide by.
 *
 * Returns null rather than 0 for an empty set. A displayed 0% reads as "every
 * single person was late", which is a very different claim from "we have
 * nothing to show you".
 */
export function onTimeRate(summary) {
  const total = classifiedDays(summary);
  if (total <= 0) return null;
  return Math.round((toCount(summary?.onTime) / total) * 100);
}

/**
 * Seconds past local midnight -> "7:12". Null/absent -> null.
 *
 * Guards against the Number(null) === 0 trap: a missing average must not
 * render as a confident "0:00", which is a real clock time.
 */
export function fmtClock(secondsPastMidnight) {
  if (secondsPastMidnight === null || secondsPastMidnight === undefined || secondsPastMidnight === '') return null;
  const secs = Number(secondsPastMidnight);
  if (!Number.isFinite(secs) || secs < 0) return null;
  // A mean of clock times can land a hair under 86400 after rounding; wrap
  // rather than printing "24:00".
  const total = Math.round(secs) % 86400;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * A row's signed offset from its shift start -> a short human phrase.
 *
 * null (no rule, or an arrival too far from the shift start to judge — see the
 * migration's 12-hour guard) returns null so the caller renders nothing at
 * all. Rendering "on time" for an unjudged day would assert something the
 * server explicitly declined to.
 */
export function fmtOffset(minutes) {
  if (minutes === null || minutes === undefined || minutes === '') return null;
  const mins = Number(minutes);
  if (!Number.isFinite(mins)) return null;
  if (mins === 0) return 'on the minute';
  const magnitude = Math.abs(mins);
  const h = Math.floor(magnitude / 60);
  const m = magnitude % 60;
  const span = h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  return mins > 0 ? `${span} late` : `${span} early`;
}

/**
 * Whether a row should carry the late marker.
 *
 * Reads the server's `late` boolean and nothing else. Deliberately does NOT
 * fall back to `first_in_offset_minutes > 0`, because "late" means "past the
 * shift start AND past the grace period", and the grace value never reaches
 * the browser. Inferring it from the offset would quietly ignore grace.
 */
export function isLate(row) {
  return row?.late === true;
}

// 'late' is deliberately absent from the status vocabulary in
// Utils/attendance.js: a day can be both late and an anomaly, and collapsing
// punctuality into the existing complete/open/anomaly status would make those
// mutually exclusive when they are not. Lateness is a separate axis and gets a
// separate marker.
export const LATE_BADGE_CLASS = 'inactive_card';

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
