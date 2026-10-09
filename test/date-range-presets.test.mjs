import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate, rangeFromPreset, formatDisplayDate, formatRangeLabel, normaliseRange, RANGE_PRESETS,
} from '../JS/Utils/dateRangePresets.js';

// A fixed local noon, so these never depend on the machine's clock and never
// land near a midnight boundary.
const TODAY = new Date(2026, 9, 9, 12, 0, 0); // 9 Oct 2026, local

test('dates are local, not UTC', () => {
  // 23:30 local on the 9th is already the 10th in UTC east of Greenwich.
  // toISOString() would report the wrong day for exactly this case.
  assert.equal(localDate(new Date(2026, 9, 9, 23, 30)), '2026-10-09');
  assert.equal(localDate(new Date(2026, 0, 1, 0, 30)), '2026-01-01');
});

test('last 7 days includes today, so it spans 9 days back to 3 Oct', () => {
  assert.deepEqual(rangeFromPreset('7', TODAY), { from: '2026-10-03', to: '2026-10-09' });
});

test('every preset resolves to a range with from <= to', () => {
  for (const p of RANGE_PRESETS) {
    const r = rangeFromPreset(p.id, TODAY);
    assert.ok(r, `${p.id} must resolve`);
    assert.ok(r.from <= r.to, `${p.id}: ${r.from} > ${r.to}`);
  }
});

test('today is a single day, this month starts on the 1st', () => {
  assert.deepEqual(rangeFromPreset('today', TODAY), { from: '2026-10-09', to: '2026-10-09' });
  assert.deepEqual(rangeFromPreset('month', TODAY), { from: '2026-10-01', to: '2026-10-09' });
});

test('30 days crosses the month boundary correctly', () => {
  assert.deepEqual(rangeFromPreset('30', TODAY), { from: '2026-09-10', to: '2026-10-09' });
});

test('an unknown preset resolves to null rather than a silent wrong range', () => {
  assert.equal(rangeFromPreset('last-decade', TODAY), null);
  assert.equal(rangeFromPreset('', TODAY), null);
  assert.equal(rangeFromPreset(undefined, TODAY), null);
});

test('the closed control reads differently for each kind of range', () => {
  assert.equal(formatRangeLabel('', ''), 'All dates');
  assert.equal(formatRangeLabel('', '', 'Pick dates'), 'Pick dates');
  assert.equal(formatRangeLabel('2026-10-09', '2026-10-09'), '09/10/2026');
  assert.equal(formatRangeLabel('2026-10-03', '2026-10-09'), '03/10/2026 – 09/10/2026');
  // Either side blank is meaningful to the export modal — "no lower bound".
  assert.equal(formatRangeLabel('2026-10-03', ''), 'From 03/10/2026');
  assert.equal(formatRangeLabel('', '2026-10-09'), 'Until 09/10/2026');
});

test('display dates are dd/mm/yyyy, matching the inputs beside them', () => {
  assert.equal(formatDisplayDate('2026-10-09'), '09/10/2026');
  assert.equal(formatDisplayDate(''), '');
  assert.equal(formatDisplayDate(null), '');
});

// The two-input toolbars swapped an inverted pair rather than refusing it.
// Refusing is never more useful than doing the obvious thing.
test('an inverted range is swapped, not rejected', () => {
  assert.deepEqual(normaliseRange('2026-10-09', '2026-10-03'), { from: '2026-10-03', to: '2026-10-09' });
  assert.deepEqual(normaliseRange('2026-10-03', '2026-10-09'), { from: '2026-10-03', to: '2026-10-09' });
});

test('a half-open range is left half-open, since blank means unbounded', () => {
  assert.deepEqual(normaliseRange('2026-10-03', ''), { from: '2026-10-03', to: '' });
  assert.deepEqual(normaliseRange('', '2026-10-09'), { from: '', to: '2026-10-09' });
  assert.deepEqual(normaliseRange('', ''), { from: '', to: '' });
  assert.deepEqual(normaliseRange(null, undefined), { from: '', to: '' });
});
