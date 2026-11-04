import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isClosable, addedMinutes, isImplausible, toClosurePayload,
  summariseOutcomes, LONG_DAY_MINUTES,
} from '../JS/Utils/openPunches.js';

// These rules decide whose recorded hours change, and those hours reach pay.
// Everything below is about refusing to act on a row the server would reject,
// and about never reporting a write that did not happen.

const row = (over = {}) => ({
  employee_id: 'e1',
  work_date: '2026-10-24',
  open_in_at: '2026-10-24T00:43:00.000Z',
  proposed_out_at: '2026-10-24T09:19:00.000Z',
  blocked_reason: null,
  ...over,
});

test('a blocked row is never closable, whatever else it carries', () => {
  // The server blocks these too. Agreeing here is what stops the UI offering
  // a checkbox that silently does nothing when pressed.
  assert.equal(isClosable(row({ blocked_reason: 'still today' })), false);
  assert.equal(isClosable(row({ blocked_reason: 'no later scan at this scanner' })), false);
  assert.equal(isClosable(row({ proposed_out_at: null })), false);
  assert.equal(isClosable(row()), true);
  assert.equal(isClosable(null), false);
});

test('the added time is the gap the synthetic OUT creates', () => {
  assert.equal(addedMinutes(row()), 516); // 00:43 -> 09:19
  // An OUT at or before the IN is not a duration — the server will not
  // propose one, and the UI must not render a negative.
  assert.equal(addedMinutes(row({ proposed_out_at: '2026-10-24T00:43:00.000Z' })), null);
  assert.equal(addedMinutes(row({ proposed_out_at: '2026-10-23T23:00:00.000Z' })), null);
  assert.equal(addedMinutes(row({ proposed_out_at: null })), null);
  assert.equal(addedMinutes(row({ open_in_at: 'nonsense' })), null);
});

test('an implausibly long day is flagged but still closable', () => {
  // This is the failure mode of closing on site evidence: a scanner whose
  // last scan is hours after someone went home. Worth a human's eye, not
  // worth blocking — genuine long days exist.
  const long = row({ proposed_out_at: '2026-10-24T13:44:00.000Z' }); // 13h 1m
  assert.ok(addedMinutes(long) > LONG_DAY_MINUTES);
  assert.equal(isImplausible(long), true);
  assert.equal(isClosable(long), true, 'flagged, not blocked');

  assert.equal(isImplausible(row()), false);
  assert.equal(isImplausible(row({ proposed_out_at: null })), false);
});

test('the payload carries no timestamp, only what to re-derive from', () => {
  // A client-supplied closing time would be a way to write arbitrary hours
  // into payroll through a UI that looks reviewed. The server recomputes it.
  const payload = toClosurePayload([row(), row({ employee_id: 'e2' })]);
  assert.deepEqual(payload, [
    { employee_id: 'e1', work_date: '2026-10-24' },
    { employee_id: 'e2', work_date: '2026-10-24' },
  ]);
  for (const item of payload) {
    assert.deepEqual(Object.keys(item).sort(), ['employee_id', 'work_date']);
  }
});

test('blocked rows are dropped from the payload rather than sent to be refused', () => {
  const payload = toClosurePayload([
    row(),
    row({ employee_id: 'e2', blocked_reason: 'still today' }),
    row({ employee_id: 'e3', proposed_out_at: null }),
  ]);
  assert.deepEqual(payload.map((p) => p.employee_id), ['e1']);
  assert.deepEqual(toClosurePayload([]), []);
  assert.deepEqual(toClosurePayload(null), []);
});

test('every skip is counted and named, never just absent', () => {
  // "Closed 41" while 6 did nothing is how a reviewer comes to believe the
  // queue is broken — or worse, believes those days are fixed.
  const msg = summariseOutcomes([
    { outcome: 'closed' }, { outcome: 'closed' },
    { outcome: 'skipped: already closed' },
    { outcome: 'skipped: no longer open' },
    { outcome: 'skipped: already closed' },
  ]);
  assert.match(msg, /Closed 2 days/);
  assert.match(msg, /skipped 3/);
  assert.match(msg, /2 already closed/);
  assert.match(msg, /1 no longer open/);
});

test('the summary stays truthful at the edges', () => {
  assert.equal(summariseOutcomes([]), 'Nothing to close.');
  assert.equal(summariseOutcomes(null), 'Nothing to close.');
  assert.match(summariseOutcomes([{ outcome: 'closed' }]), /Closed 1 day\b/);
  // An unrecognised outcome is still reported, not swallowed.
  assert.match(summariseOutcomes([{ outcome: 'something new' }]), /1 something new/);
});
