// Utils/scanHeatmap.js — thirty days of one employee's attendance, derived
// from the scan_logs array ScanLogModal has already downloaded.
//
// Pure, so every rule here is exercised for real rather than asserted
// against source text.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEATMAP_DAYS, MIN_DAYS_FOR_MEDIAN, ODD_HOUR_TOLERANCE_MIN, DAY_STATE,
  dayKey, minutesOfDay, fmtMinutes, median, recentDayKeys, buildHeatmap,
  intensity, dayLabel,
} from '../JS/Utils/scanHeatmap.js';

// Local time throughout, because that is what the feature works in. Built
// from local components so these tests do not depend on the runner's zone.
const at = (dayOffsetFromToday, hh, mm = 0) => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + dayOffsetFromToday, hh, mm).toISOString();
};
const scan = (iso, direction, extra = {}) => ({
  scan_id: `${iso}-${direction}`, scanned_at: iso, direction, result: 'matched', ...extra,
});
/** A closed day: in at 07:00, out at 17:00, `offset` days ago. */
const closedDay = (offset, inH = 7, outH = 17) => [
  scan(at(-offset, inH), 'in'), scan(at(-offset, outH), 'out'),
];

// ---- day keys ----

test('a day key is local, not UTC', () => {
  // 23:30 local must stay on its own local date. Computed from components,
  // so this fails in exactly the timezones where a UTC key would be wrong.
  const late = new Date(2026, 10, 11, 23, 30);
  assert.equal(dayKey(late.toISOString()), '2026-11-11');
});

test('an unparseable timestamp yields no key rather than "Invalid Date"', () => {
  for (const bad of [null, undefined, '', 'not a date', {}]) {
    assert.equal(dayKey(bad), null);
  }
});

// A fixed 86_400_000 ms step repeats or skips a local day across a DST
// boundary, which would silently duplicate a cell twice a year.
test('the window is thirty distinct consecutive local days', () => {
  const keys = recentDayKeys(HEATMAP_DAYS);
  assert.equal(keys.length, 30);
  assert.equal(new Set(keys).size, 30, 'a repeated day means DST arithmetic');
  const sorted = [...keys].sort();
  assert.deepEqual(keys, sorted, 'oldest first');
  assert.equal(keys[29], new Date().toLocaleDateString('en-CA'), 'the window ends today');
});

test('a nonsense day count falls back rather than producing an empty grid', () => {
  for (const bad of [0, -5, NaN, null, 'ten']) {
    assert.ok(recentDayKeys(bad).length >= 1, `${bad} produced no days`);
  }
});

// ---- minutes and formatting ----

test('minutes are counted from local midnight', () => {
  assert.equal(minutesOfDay(new Date(2026, 10, 11, 6, 45).toISOString()), 405);
  assert.equal(minutesOfDay('nope'), null);
});

test('minutes format back to a clock, and nonsense formats to nothing', () => {
  assert.equal(fmtMinutes(405), '06:45');
  assert.equal(fmtMinutes(0), '00:00');
  for (const bad of [null, undefined, NaN, 'x']) assert.equal(fmtMinutes(bad), null);
});

// ---- median ----

test('the median averages the two middles on an even count', () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
});

// One 03:00 callout would drag a mean far enough to make a week of ordinary
// mornings look late. That is the whole reason this is not an average.
test('one outlier does not move the median the way it moves a mean', () => {
  const ordinary = [420, 425, 430, 435, 440];
  const withCallout = [...ordinary, 180];
  assert.equal(median(ordinary), 430);
  assert.equal(median(withCallout), 427.5);
  const mean = withCallout.reduce((a, b) => a + b) / withCallout.length;
  assert.ok(mean < 400, 'the mean really is dragged, so this test is meaningful');
});

test('a median of nothing is null, not zero', () => {
  assert.equal(median([]), null);
  assert.equal(median([null, undefined, NaN]), null);
});

// ---- the grid ----

test('an empty log produces a full grid of empty days', () => {
  const { days, summary } = buildHeatmap([]);
  assert.equal(days.length, 30);
  assert.ok(days.every((d) => d.state === DAY_STATE.NONE && d.count === 0));
  assert.equal(summary.totalScans, 0);
  assert.equal(summary.daysWithScans, 0);
});

test('a missing or malformed log does not throw', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    assert.equal(buildHeatmap(bad).days.length, 30);
  }
});

test('a closed day is complete, and carries its own span', () => {
  const { days } = buildHeatmap(closedDay(3, 7, 17));
  const day = days.find((d) => d.count > 0);
  assert.equal(day.state, DAY_STATE.COMPLETE);
  assert.equal(fmtMinutes(day.firstIn), '07:00');
  assert.equal(fmtMinutes(day.lastOut), '17:00');
  assert.equal(day.minutes, 600);
});

test('an IN with no OUT is open', () => {
  const { days, summary } = buildHeatmap([scan(at(-2, 7), 'in')]);
  assert.equal(days.find((d) => d.count > 0).state, DAY_STATE.OPEN);
  assert.equal(summary.openDays, 1);
});

test('scans outside the window are not in the grid at all', () => {
  const { days, summary } = buildHeatmap([...closedDay(90), ...closedDay(2)]);
  assert.equal(summary.daysWithScans, 1, 'the 90-day-old day is outside the window');
  assert.equal(days.filter((d) => d.count > 0).length, 1);
});

test('order does not matter — the modal passes newest-first', () => {
  const entries = [...closedDay(1), ...closedDay(2), ...closedDay(3)];
  const forward = buildHeatmap(entries).days.map((d) => d.state);
  const reversed = buildHeatmap([...entries].reverse()).days.map((d) => d.state);
  assert.deepEqual(forward, reversed);
});

// ---- the outlier rule ----
//
// THE DESIGN DECISION THIS PINS. shift_rules is empty, and scanners have no
// department to key it by even when it is not — so there is no schedule to
// compare a day against. Comparing to a hardcoded 09:00-17:00 would flag an
// entire night shift as anomalous. The comparison is to this employee's own
// median instead.

test('a night shift is normal when it is this person\'s normal', () => {
  const nights = [];
  for (let i = 1; i <= 8; i += 1) nights.push(...closedDay(i, 22, 23));
  const { days, summary } = buildHeatmap(nights);
  assert.equal(summary.oddDays, 0, 'a consistent night shift must not be flagged');
  assert.ok(days.filter((d) => d.count > 0).every((d) => d.state === DAY_STATE.COMPLETE));
  assert.equal(summary.medianIn, '22:00');
});

test('a day far from this person\'s own median is odd', () => {
  const entries = [];
  for (let i = 1; i <= 8; i += 1) entries.push(...closedDay(i, 7, 17));
  entries.push(...closedDay(9, 2, 5)); // a 02:00 start against an 07:00 median
  const { summary } = buildHeatmap(entries);
  assert.equal(summary.oddDays, 1);
  assert.equal(summary.basis, 'self');
});

test('a deviation inside the tolerance is not odd', () => {
  const entries = [];
  for (let i = 1; i <= 8; i += 1) entries.push(...closedDay(i, 7, 17));
  entries.push(...closedDay(9, 8, 18)); // one hour out, tolerance is two
  assert.equal(buildHeatmap(entries).summary.oddDays, 0);
  assert.equal(ODD_HOUR_TOLERANCE_MIN, 120);
});

// Judging an outlier off two data points is worse than not judging one. The
// UI prints `basis`, so "0 odd days" is never shown as if it had looked.
test('too little history switches the outlier test off entirely', () => {
  const entries = [...closedDay(1, 7, 17), ...closedDay(2, 2, 5)];
  const { summary } = buildHeatmap(entries);
  assert.ok(MIN_DAYS_FOR_MEDIAN > 2);
  assert.equal(summary.basis, 'insufficient');
  assert.equal(summary.oddDays, 0);
  assert.equal(summary.medianIn, null, 'no median is reported when none was taken');
});

// An unclosed day has no last-OUT to contribute. Letting it in as a null
// would not merely skip it — it would shift which value sits in the middle.
test('the median is taken over closed days only', () => {
  const entries = [];
  for (let i = 1; i <= 6; i += 1) entries.push(...closedDay(i, 7, 17));
  for (let i = 7; i <= 12; i += 1) entries.push(scan(at(-i, 22), 'in'));
  const { summary } = buildHeatmap(entries);
  assert.equal(summary.closedDays, 6);
  assert.equal(summary.medianIn, '07:00', 'the six unclosed 22:00 arrivals must not move it');
  assert.equal(summary.openDays, 6);
});

// A missing OUT is a data problem someone has to fix; an odd hour is an
// observation. Same precedence rule as attendanceStatus().
test('an unclosed day that was also unusual reports as open', () => {
  const entries = [];
  for (let i = 1; i <= 8; i += 1) entries.push(...closedDay(i, 7, 17));
  entries.push(scan(at(-9, 2), 'in')); // unusual AND unclosed
  const { days, summary } = buildHeatmap(entries);
  const odd = days.find((d) => d.key === new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 9).toLocaleDateString('en-CA'));
  assert.equal(odd.state, DAY_STATE.OPEN);
  assert.equal(summary.openDays, 1);
  assert.equal(summary.oddDays, 0);
});

// ---- presentation helpers ----

test('intensity is banded, and nothing is never a band', () => {
  assert.equal(intensity(0), 0);
  assert.equal(intensity(2), 1);
  assert.equal(intensity(4), 2);
  assert.equal(intensity(20), 4);
  for (const bad of [null, undefined, NaN, -3, 'x']) assert.equal(intensity(bad), 0);
});

test('a label says what the day held, or that it held nothing', () => {
  const { days } = buildHeatmap(closedDay(1, 7, 17));
  const day = days.find((d) => d.count > 0);
  const label = dayLabel(day);
  assert.match(label, /07:00 → 17:00/);
  assert.match(label, /10h 00m/);
  assert.match(label, /2 scans/);
  assert.match(dayLabel(days[0]), /no scans/);
  assert.equal(dayLabel(null), '');
});

test('an unclosed day says so in its label rather than inventing an OUT', () => {
  const { days } = buildHeatmap([scan(at(-1, 7), 'in')]);
  assert.match(dayLabel(days.find((d) => d.count > 0)), /no OUT/);
});
