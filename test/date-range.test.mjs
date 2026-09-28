import test from 'node:test';
import assert from 'node:assert/strict';
import { orderDateRange, wireDateRangeOrdering } from '../JS/Utils/dateRange.js';

test('an inverted range is swapped into chronological order', () => {
  // The reported case: from 28/09/2026, then to 21/09/2026.
  assert.deepEqual(orderDateRange('2026-09-28', '2026-09-21'), ['2026-09-21', '2026-09-28']);
  assert.deepEqual(orderDateRange('2027-01-01', '2026-12-31'), ['2026-12-31', '2027-01-01']); // across a year
});

test('valid, same-day and partially empty ranges are left alone', () => {
  assert.deepEqual(orderDateRange('2026-09-21', '2026-09-28'), ['2026-09-21', '2026-09-28']);
  assert.deepEqual(orderDateRange('2026-09-21', '2026-09-21'), ['2026-09-21', '2026-09-21']);
  assert.deepEqual(orderDateRange('2026-09-28', ''), ['2026-09-28', '']);
  assert.deepEqual(orderDateRange('', '2026-09-21'), ['', '2026-09-21']);
  assert.deepEqual(orderDateRange('', ''), ['', '']);
});

// Minimal stand-ins for two <input type="date"> elements.
function fakeInput(value) {
  const handlers = [];
  return { value, addEventListener: (_t, fn) => handlers.push(fn), fire() { handlers.forEach((fn) => fn()); } };
}

test('picking "to" before "from" swaps both inputs and calls back once', () => {
  const from = fakeInput('2026-09-28');
  const to = fakeInput('');
  let calls = 0;
  wireDateRangeOrdering(from, to, () => { calls++; });
  to.value = '2026-09-21'; to.fire();
  assert.equal(from.value, '2026-09-21');
  assert.equal(to.value, '2026-09-28');
  assert.equal(calls, 1);
});

test('picking "from" after "to" swaps too, and a valid pick changes nothing', () => {
  const from = fakeInput('');
  const to = fakeInput('2026-09-21');
  wireDateRangeOrdering(from, to);
  from.value = '2026-09-28'; from.fire();
  assert.equal(from.value, '2026-09-21');
  assert.equal(to.value, '2026-09-28');
  from.value = '2026-09-22'; from.fire();
  assert.equal(from.value, '2026-09-22');
  assert.equal(to.value, '2026-09-28');
});

test('missing elements are ignored rather than throwing', () => {
  assert.doesNotThrow(() => wireDateRangeOrdering(null, fakeInput('')));
});
