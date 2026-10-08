import test from 'node:test';
import assert from 'node:assert/strict';
import { truncation, truncationNotice, POSTGREST_MAX_ROWS } from '../JS/Utils/rowCap.js';
import { toSummary, attendanceTruncationNotice, summarize } from '../JS/Utils/attendance.js';

// The defect this guards: a page showing "1-500 of 1000" was reporting the
// cap it hit, not the size of its data. Measured 2026-10-08, one week of
// Attendance really held 3,385 employee-days.

test('a complete list is not truncated', () => {
  const t = truncation(755, 755);
  assert.equal(t.truncated, false);
  assert.equal(t.missing, 0);
  assert.equal(truncationNotice(t), null);
});

test('a capped list reports what is missing', () => {
  const t = truncation(POSTGREST_MAX_ROWS, 3385);
  assert.deepEqual(t, { truncated: true, fetched: 1000, total: 3385, missing: 2385 });
});

test('an unknown total is never reported as fewer rows than we hold', () => {
  // A failed count must degrade to "no notice", never to a negative or a
  // notice claiming rows are missing when none are.
  for (const bad of [null, undefined, 0, NaN, -5, 'nonsense']) {
    const t = truncation(500, bad);
    assert.equal(t.total, 500, String(bad));
    assert.equal(t.truncated, false, String(bad));
    assert.equal(t.missing, 0, String(bad));
  }
});

test('garbage in the fetched count floors at zero', () => {
  assert.equal(truncation(-10, 100).fetched, 0);
  assert.equal(truncation(null, 100).fetched, 0);
});

test('the notice names the unit and the gap', () => {
  const msg = truncationNotice(truncation(1000, 3385), { noun: 'employee-days' });
  assert.match(msg, /1,000/);
  assert.match(msg, /3,385/);
  assert.match(msg, /2,385/);
  assert.match(msg, /employee-days/);
});

// "Most recent" is a promise the ordering has to keep — 20261008160000 flips
// get_attendance_report() to newest-first for exactly this reason.
test('the notice says the missing rows are the older ones', () => {
  const msg = truncationNotice(truncation(1000, 3385), { noun: 'rows' });
  assert.match(msg, /most recent/);
  assert.match(msg, /older/);
});

test('no notice when nothing is missing, whatever the wording', () => {
  assert.equal(truncationNotice(truncation(10, 10), { noun: 'rows' }), null);
  assert.equal(truncationNotice(null), null);
  assert.equal(attendanceTruncationNotice(truncation(10, 10)), null);
});

test('the attendance wording points at the fix', () => {
  const msg = attendanceTruncationNotice(truncation(1000, 3385));
  assert.match(msg, /employee-days/);
  assert.match(msg, /narrow the dates/i);
  assert.match(msg, /totals above cover the whole range/i);
});

test('the summary row maps onto the stat cards', () => {
  const row = { row_count: 3385, employees: 594, worked_seconds: 43315680, open_punches: 11, anomalies: 87 };
  assert.deepEqual(toSummary(row), {
    days: 3385, employees: 594, workedSeconds: 43315680, open: 11, anomalies: 87,
  });
  // PostgREST hands a SETOF back as an array.
  assert.deepEqual(toSummary([row]), toSummary(row));
});

test('a missing or empty summary reads as zeroes, not NaN', () => {
  for (const empty of [null, undefined, [], {}]) {
    const s = toSummary(empty);
    assert.deepEqual(s, { days: 0, employees: 0, workedSeconds: 0, open: 0, anomalies: 0 });
    assert.ok(Object.values(s).every(Number.isFinite), String(empty));
  }
});

// bigint columns arrive as strings over PostgREST once they exceed 2^53 in
// the driver's view; worked_seconds across a month of 600 staff gets large.
test('bigint columns arriving as strings still become numbers', () => {
  const s = toSummary({ row_count: '3385', worked_seconds: '43315680', employees: '594' });
  assert.equal(s.days, 3385);
  assert.equal(s.workedSeconds, 43315680);
  assert.equal(s.employees, 594);
});

// The old client-side path is kept as the fallback for a failed summary, so
// it has to stay correct — understated when truncated, never wrong in shape.
test('the client-side fallback still summarises the rows it holds', () => {
  const rows = [
    { employee_id: 'a', worked_seconds: 3600, open_punch: false, anomaly: false },
    { employee_id: 'a', worked_seconds: 1800, open_punch: true, anomaly: false },
    { employee_id: 'b', worked_seconds: 0, open_punch: false, anomaly: true },
  ];
  assert.deepEqual(summarize(rows), {
    employees: 2, days: 3, workedSeconds: 5400, open: 1, anomalies: 1,
  });
});

test('the fallback understates a truncated range, which is why the summary exists', () => {
  const truncated = Array.from({ length: 1000 }, (_, i) => ({
    employee_id: `e${i % 594}`, worked_seconds: 3600, open_punch: false, anomaly: false,
  }));
  const derived = summarize(truncated);
  const real = toSummary({ row_count: 3385, employees: 594, worked_seconds: 12031200 });
  assert.equal(derived.days, 1000);
  assert.ok(derived.days < real.days, 'this gap is the bug the summary RPC closes');
});
