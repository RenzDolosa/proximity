// Pure helpers for the Settings → Usage panel. No DOM, no Supabase, so the
// arithmetic that decides "are we going to blow the quota this cycle" is
// unit-tested (test/usage.test.mjs) rather than buried in page code.
//
// Context for why this panel exists at all: the organization went over its
// Free-plan egress quota and the dashboard's own figure is a CUMULATIVE
// counter for the billing cycle — it only ever goes up, and it resets at the
// cycle boundary. That makes it almost useless for answering the only
// question that matters after a fix ships, which is "has the RATE changed".
// Average-per-day and the projected cycle total answer that; the raw total
// does not. See docs/SUPABASE_QUOTA_DECISION.md.

// Whole days elapsed since the cycle started, floored at 1 so the first few
// hours of a new cycle can't divide by ~0 and project a fantasy number. Uses
// elapsed time rather than calendar days: a cycle that began mid-day is
// 1.5 days in, not 2.
export function daysElapsed(periodStart, now = Date.now()) {
  const start = Date.parse(periodStart);
  if (!Number.isFinite(start)) return null;
  const ms = now - start;
  if (ms <= 0) return null;
  return Math.max(ms / 86400000, 1 / 24); // floor at one hour, not one day
}

export function daysInCycle(periodStart, periodEnd) {
  const a = Date.parse(periodStart);
  const b = Date.parse(periodEnd);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  return (b - a) / 86400000;
}

// value / days elapsed. Null (rather than 0) when the window is unknown, so
// the UI can say "—" instead of claiming a real average of zero.
export function averagePerDay(value, periodStart, now = Date.now()) {
  if (!Number.isFinite(value)) return null;
  const days = daysElapsed(periodStart, now);
  if (days === null) return null;
  return value / days;
}

// Where this metric lands at the cycle boundary if the current rate holds.
// This is the number that actually predicts a quota breach — a metric at 60%
// of its limit on day 3 of 30 is in far more trouble than one at 90% on day 29.
export function projectedCycleTotal(value, periodStart, periodEnd, now = Date.now()) {
  const perDay = averagePerDay(value, periodStart, now);
  const total = daysInCycle(periodStart, periodEnd);
  if (perDay === null || total === null) return null;
  return perDay * total;
}

// 'ok' | 'warn' | 'over'. Deliberately judged on the PROJECTION, not on usage
// so far: the whole point is to raise the alarm while there is still cycle
// left to act in. Anything with no limit (or no usable projection) is 'ok' —
// an unknown is not a warning.
export function usageState(projected, limit) {
  if (!Number.isFinite(projected) || !Number.isFinite(limit) || limit <= 0) return 'ok';
  const ratio = projected / limit;
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}

// Decimal (1000) units, NOT the binary units Utils/format.js's fmtBytes uses.
// Deliberate: this panel's numbers are read side by side with Supabase's own
// billing page, which reports GB decimally. Showing 7.4 GiB next to their
// 7.978 GB would look like a bug in one of the two.
export function fmtUsageBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  // Roughly three significant figures. A flat toFixed(1) renders "200.0 MB",
  // where the decimal is pure noise, while a flat toFixed(2) loses nothing but
  // reads badly at the top of a unit. Scaling the precision keeps the column
  // aligned in width without printing digits that carry no information.
  const decimals = v < 10 ? 2 : v < 100 ? 1 : 0;
  return `${v.toFixed(decimals)} ${units[i]}`;
}

// Counts (log events, invocations) rather than bytes.
export function fmtUsageCount(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  return Math.round(n).toLocaleString();
}

export function fmtPercent(value, limit) {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.round((value / limit) * 100);
}

// One row's worth of derived numbers, so the renderer stays a renderer.
// `unit` picks the formatter: 'bytes' or 'count'.
export function summarizeMetric(metric, periodStart, periodEnd, now = Date.now()) {
  const value = Number.isFinite(metric?.value) ? metric.value : null;
  const limit = Number.isFinite(metric?.limit) ? metric.limit : null;
  const projected = value === null ? null : projectedCycleTotal(value, periodStart, periodEnd, now);
  const fmt = metric?.unit === 'count' ? fmtUsageCount : fmtUsageBytes;
  return {
    key: metric?.key ?? null,
    label: metric?.label ?? metric?.key ?? 'Unknown',
    value,
    limit,
    perDay: value === null ? null : averagePerDay(value, periodStart, now),
    projected,
    percent: fmtPercent(value, limit),
    projectedPercent: fmtPercent(projected, limit),
    state: usageState(projected, limit),
    valueText: fmt(value),
    limitText: limit === null ? null : fmt(limit),
    perDayText: value === null ? '—' : fmt(averagePerDay(value, periodStart, now)),
    projectedText: fmt(projected),
  };
}
