import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUpdateGate, isBusy, isTabStale, registerBusyCheck, TAB_MAX_AGE_MS,
} from '../JS/Utils/appUpdate.js';

// What this guards: a kiosk tab left open for three weeks kept calling
// get_scanner_offline_photos() — 95 calls/day, 5.8 MB each, ~13 GB/month on a
// 5 GB quota. The gate reloads such a tab, but it must never reload one that is
// mid-scan, so both directions matter equally.

test('a tab is stale once it reaches the max age, not before', () => {
  assert.equal(isTabStale(0, TAB_MAX_AGE_MS - 1, TAB_MAX_AGE_MS), false);
  assert.equal(isTabStale(0, TAB_MAX_AGE_MS, TAB_MAX_AGE_MS), true);
  assert.equal(isTabStale(1000, 1000 + TAB_MAX_AGE_MS, TAB_MAX_AGE_MS), true);
});

test('no registered checks means idle', () => {
  assert.equal(isBusy(new Set()), false);
});

test('any check returning true means busy', () => {
  assert.equal(isBusy(new Set([() => false, () => true])), true);
  assert.equal(isBusy(new Set([() => false, () => false])), false);
});

test('a check that throws counts as busy', () => {
  // We cannot know what it was guarding, so the safe answer is "do not reload".
  assert.equal(isBusy(new Set([() => { throw new Error('boom'); }])), true);
});

test('registerBusyCheck returns a working unregister', () => {
  const off = registerBusyCheck(() => true);
  assert.equal(isBusy(), true);
  off();
  assert.equal(isBusy(), false);
});

function harness({ busy = false } = {}) {
  const calls = { reload: 0, scheduled: [] };
  let isBusyNow = busy;
  const gate = createUpdateGate({
    reload: () => { calls.reload += 1; },
    isBusy: () => isBusyNow,
    schedule: (fn, ms) => { calls.scheduled.push({ fn, ms }); return calls.scheduled.length; },
    retryMs: 1000,
  });
  return { gate, calls, setBusy: (v) => { isBusyNow = v; } };
}

test('an idle page reloads immediately', () => {
  const { gate, calls } = harness();
  assert.equal(gate.request(), true);
  assert.equal(calls.reload, 1);
  assert.equal(gate.pending, false);
});

test('a busy page does not reload, and retries later', () => {
  const { gate, calls, setBusy } = harness({ busy: true });
  assert.equal(gate.request(), false);
  assert.equal(calls.reload, 0);
  assert.equal(gate.pending, true);
  assert.equal(calls.scheduled.length, 1);
  assert.equal(calls.scheduled[0].ms, 1000);

  setBusy(false);
  calls.scheduled[0].fn();
  assert.equal(calls.reload, 1);
  assert.equal(gate.pending, false);
});

test('repeat requests while busy do not stack retry timers', () => {
  const { gate, calls } = harness({ busy: true });
  gate.request();
  gate.request();
  gate.request();
  assert.equal(calls.scheduled.length, 1);
});

test('a retry that is still busy schedules exactly one more', () => {
  const { gate, calls } = harness({ busy: true });
  gate.request();
  calls.scheduled[0].fn();
  assert.equal(calls.reload, 0);
  assert.equal(calls.scheduled.length, 2);
});

test('attempt() does nothing when no reload was requested', () => {
  const { gate, calls } = harness();
  assert.equal(gate.attempt(), false);
  assert.equal(calls.reload, 0);
  assert.equal(calls.scheduled.length, 0);
});

test('the gate reloads once, not once per request', () => {
  const { gate, calls, setBusy } = harness({ busy: true });
  gate.request();
  gate.request();
  setBusy(false);
  calls.scheduled[0].fn();
  assert.equal(calls.reload, 1);
  // Already reloaded: a later timer firing must not reload a second time.
  assert.equal(gate.attempt(), false);
  assert.equal(calls.reload, 1);
});

test('an open dialog counts as busy, so an admin mid-edit is never reloaded', async () => {
  const { aDialogIsOpen } = await import('../JS/Utils/appUpdate.js');
  const original = globalThis.document;

  globalThis.document = { querySelector: (sel) => (sel === '.overlay' ? {} : null) };
  assert.equal(aDialogIsOpen(), true);

  globalThis.document = { querySelector: () => null };
  assert.equal(aDialogIsOpen(), false);

  // Node has no document at all; the check must not throw there.
  globalThis.document = undefined;
  assert.equal(aDialogIsOpen(), false);

  globalThis.document = original;
});
