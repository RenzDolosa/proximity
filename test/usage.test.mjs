import test from 'node:test';
import assert from 'node:assert/strict';
import {
  averagePerDay, daysElapsed, daysInCycle, fmtPercent, fmtUsageBytes,
  fmtUsageCount, projectedCycleTotal, summarizeMetric, usageState,
} from '../JS/Utils/usage.js';

// A 30-day cycle, queried 10 days in — the shape the Settings panel actually
// renders against.
const START = '2026-09-11T00:00:00Z';
const END = '2026-10-11T00:00:00Z';
const DAY10 = Date.parse('2026-09-21T00:00:00Z');

test('days elapsed and cycle length are measured, not assumed to be calendar days', () => {
  assert.equal(daysElapsed(START, DAY10), 10);
  assert.equal(daysInCycle(START, END), 30);
  // A cycle that began mid-day is 1.5 days in, not 2.
  assert.equal(daysElapsed(START, Date.parse('2026-09-12T12:00:00Z')), 1.5);
});

// Dividing by a near-zero window in the first minutes of a cycle would project
// an absurd total and paint everything red for no reason.
test('a brand-new cycle floors the divisor instead of projecting infinity', () => {
  const oneMinuteIn = Date.parse('2026-09-11T00:01:00Z');
  const perDay = averagePerDay(1e6, START, oneMinuteIn);
  assert.ok(Number.isFinite(perDay));
  assert.ok(perDay <= 1e6 * 24, 'floored at one hour, so at most 24x the value');
});

test('unusable windows yield null rather than a confident zero', () => {
  assert.equal(daysElapsed('not-a-date', DAY10), null);
  assert.equal(daysElapsed(START, Date.parse('2026-09-10T00:00:00Z')), null); // before the start
  assert.equal(daysInCycle(END, START), null); // reversed
  assert.equal(averagePerDay(NaN, START, DAY10), null);
  assert.equal(projectedCycleTotal(100, START, 'nope', DAY10), null);
});

test('average per day and projection follow the elapsed window', () => {
  // 5 GB spent in 10 days = 0.5 GB/day -> 15 GB across a 30-day cycle.
  assert.equal(averagePerDay(5e9, START, DAY10), 5e8);
  assert.equal(projectedCycleTotal(5e9, START, END, DAY10), 1.5e10);
});

// The point of the panel: a metric under its limit today can still be on
// course to blow the cycle, and that is what should be flagged.
test('state is judged on the projection, not on usage so far', () => {
  const limit = 5e9;
  // 2 GB on day 10 of 30 is only 40% used, but projects to 6 GB — over.
  const projected = projectedCycleTotal(2e9, START, END, DAY10);
  assert.equal(fmtPercent(2e9, limit), 40);
  assert.equal(usageState(projected, limit), 'over');

  // 1.4 GB on day 10 projects to 4.2 GB = 84% -> warn, not over.
  assert.equal(usageState(projectedCycleTotal(1.4e9, START, END, DAY10), limit), 'warn');
  // 1 GB on day 10 projects to 3 GB = 60% -> fine.
  assert.equal(usageState(projectedCycleTotal(1e9, START, END, DAY10), limit), 'ok');
});

test('an unknown limit or projection is not a warning', () => {
  assert.equal(usageState(null, 5e9), 'ok');
  assert.equal(usageState(1e12, null), 'ok');
  assert.equal(usageState(1e12, 0), 'ok');
  assert.equal(fmtPercent(1, 0), null);
});

// Decimal units on purpose — these numbers sit next to Supabase's own billing
// page, which reports GB decimally. Binary units would look like a bug.
test('bytes are formatted decimally to match the billing page', () => {
  assert.equal(fmtUsageBytes(7.978e9), '7.98 GB');
  assert.equal(fmtUsageBytes(5e9), '5.00 GB');
  assert.equal(fmtUsageBytes(1.5e6), '1.50 MB');
  assert.equal(fmtUsageBytes(999), '999 B');
  assert.equal(fmtUsageBytes(1000), '1.00 KB');
  assert.equal(fmtUsageBytes(12.345e9), '12.3 GB'); // >=10 drops to one decimal
  assert.equal(fmtUsageBytes(null), '—');
  assert.equal(fmtUsageBytes(-1), '—');
});

test('counts are rendered as counts, not as bytes', () => {
  assert.equal(fmtUsageCount(18531), '18,531');
  assert.equal(fmtUsageCount(undefined), '—');
});

test('summarizeMetric derives every field one row needs', () => {
  const row = summarizeMetric(
    { key: 'egress', label: 'Egress', value: 2e9, limit: 5e9, unit: 'bytes' },
    START, END, DAY10,
  );
  assert.equal(row.label, 'Egress');
  assert.equal(row.percent, 40);
  assert.equal(row.projectedPercent, 120);
  assert.equal(row.state, 'over');
  assert.equal(row.valueText, '2.00 GB');
  assert.equal(row.limitText, '5.00 GB');
  assert.equal(row.perDayText, '200 MB');
  assert.equal(row.projectedText, '6.00 GB');
});

// A metric the Management API did not return must render as "—" rather than
// as a confident zero, which would read as "no egress" when it means "unknown".
test('a missing metric degrades to dashes, never to zero', () => {
  const row = summarizeMetric({ key: 'log_query', label: 'Log Query', unit: 'bytes' }, START, END, DAY10);
  assert.equal(row.value, null);
  assert.equal(row.valueText, '—');
  assert.equal(row.perDayText, '—');
  assert.equal(row.projectedText, '—');
  assert.equal(row.state, 'ok');
  assert.equal(row.percent, null);
});

test('a limitless metric reports usage without inventing a ceiling', () => {
  const row = summarizeMetric({ key: 'db_size', label: 'Database size', value: 5e7, unit: 'bytes' }, START, END, DAY10);
  assert.equal(row.limit, null);
  assert.equal(row.limitText, null);
  assert.equal(row.percent, null);
  assert.equal(row.state, 'ok');
  assert.equal(row.valueText, '50.0 MB');
});
