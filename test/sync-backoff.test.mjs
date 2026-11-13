// The kiosk's offline queue: why it stopped, and how often it asks again.
//
// TWO BUGS HERE, one visible and one on the bill.
//
// VISIBLE: flushQueuedScans() halted every worker on the first error and
// discarded the error, so the scanner rendered "N scans queued — will sync
// automatically" whether that was true or not. An expired session and a
// kiosk waiting for Wi-Fi produced the same reassuring sentence.
//
// ON THE BILL: initOfflineSupport() retries every 20 seconds and returned
// early only when the queue was EMPTY. A queue blocked by something a retry
// cannot fix therefore sent 180 failing requests an hour, each an API-gateway
// log event, until somebody noticed. The ladder here takes that to 6/hour at
// the ceiling while keeping the retry automatic — a kiosk operator has a card
// reader and no mouse, and must never be asked to click Retry.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FIRST_RETRY_MS, MAX_RETRY_MS, classifyFlushError, nextRetryDelayMs,
  secondsUntil, syncStatusText, createFlushGate,
} from '../JS/Utils/syncBackoff.js';
import { flushQueuedScans } from '../JS/Core/offlineScanning.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// ---- the error that used to be thrown away ----

test('a stopped flush reports why, not just how far it got', async () => {
  const boom = { code: 'PGRST301', message: 'JWT expired' };
  const result = await flushQueuedScans({
    entries: [{ id: 1, proximity_code: 'A', scanned_at: '2026-11-13T01:00:00Z' }],
    send: async () => boom,
    remove: async () => {},
  });
  assert.equal(result.synced, 0);
  assert.equal(result.remaining, 1);
  assert.equal(result.error, boom);
});

test('a clean run reports no error rather than leaving the field absent', async () => {
  const empty = await flushQueuedScans({ entries: [], send: async () => null, remove: async () => {} });
  assert.deepEqual(empty, { synced: 0, remaining: 0, error: null });
});

// Workers run concurrently, so the last error is whatever happened to land
// afterwards — often a second symptom of the same cause.
test('the first error is kept, not the last', async () => {
  const first = { code: '42501', message: 'permission denied for function scan_proximity_code' };
  const second = { message: 'aborted' };
  let calls = 0;
  const result = await flushQueuedScans({
    entries: [
      { id: 1, proximity_code: 'A', scanned_at: '2026-11-13T01:00:00Z' },
      { id: 2, proximity_code: 'B', scanned_at: '2026-11-13T01:00:01Z' },
    ],
    send: async () => { calls += 1; return calls === 1 ? first : second; },
    remove: async () => {},
    concurrency: 1,
  });
  assert.equal(result.error, first);
});

// A send() that throws is the same failure as one that returns an error, and
// used to vanish into a bare `catch {}`.
test('a thrown send still produces a reason', async () => {
  const result = await flushQueuedScans({
    entries: [{ id: 1, proximity_code: 'A', scanned_at: '2026-11-13T01:00:00Z' }],
    send: async () => { throw new TypeError('Failed to fetch'); },
    remove: async () => {},
  });
  assert.equal(result.error?.message, 'Failed to fetch');
  assert.equal(classifyFlushError(result.error).reason, 'offline');
});

// ---- classification ----

test('the reasons an operator can act on are told apart', () => {
  assert.equal(classifyFlushError({ code: 'PGRST301', message: 'JWT expired' }).reason, 'auth');
  assert.equal(classifyFlushError({ status: 401, message: 'Unauthorized' }).reason, 'auth');
  assert.equal(classifyFlushError({ code: '42501', message: 'permission denied' }).reason, 'permission');
  assert.equal(classifyFlushError({ code: 'PGRST202', message: 'Could not find the function' }).reason, 'missing');
  assert.equal(classifyFlushError({ message: 'NetworkError when attempting to fetch' }).reason, 'offline');
  assert.equal(classifyFlushError({ status: 503, message: 'upstream' }).reason, 'server');
  assert.equal(classifyFlushError({ code: '23514', message: 'check constraint' }).reason, 'unknown');
  assert.equal(classifyFlushError(null).reason, 'none');
});

// An auth failure can surface a message mentioning "failed to", which would
// match the network test if the order were wrong — and "waiting for the
// network" is exactly the wrong thing to tell someone whose session expired.
test('an expired session is not mistaken for a network drop', () => {
  const c = classifyFlushError({ code: 'PGRST301', message: 'Failed to refresh token: JWT expired' });
  assert.equal(c.reason, 'auth');
  assert.equal(c.retryable, false);
});

test('labels say what to do, not what the code was', () => {
  for (const err of [{ code: 'PGRST301' }, { code: '42501' }, { code: 'PGRST202' }]) {
    const { label } = classifyFlushError(err);
    assert.ok(label.length > 0);
    assert.ok(!/PGRST|4250|undefined/.test(label), `"${label}" leaks an error code at an operator`);
  }
});

// ---- the ladder ----

test('the delay doubles and then stops', () => {
  assert.equal(nextRetryDelayMs(0), FIRST_RETRY_MS);
  assert.equal(nextRetryDelayMs(1), FIRST_RETRY_MS);
  assert.equal(nextRetryDelayMs(2), FIRST_RETRY_MS * 2);
  assert.equal(nextRetryDelayMs(3), FIRST_RETRY_MS * 4);
  assert.equal(nextRetryDelayMs(99), MAX_RETRY_MS);
  assert.ok(Number.isFinite(nextRetryDelayMs(100000)), 'a kiosk blocked for days must not overflow');
});

// Number(null) is 0 and 0 is finite, so a nullish count would read as "no
// failures yet" and quietly restore the 20-second hammer. Third time this
// exact coercion has caused a bug in this repo.
test('a nullish failure count does not reset the ladder', () => {
  assert.equal(nextRetryDelayMs(null), FIRST_RETRY_MS);
  assert.equal(nextRetryDelayMs(undefined), FIRST_RETRY_MS);
  assert.equal(nextRetryDelayMs('8'), FIRST_RETRY_MS, 'a string is not a count');
  assert.equal(nextRetryDelayMs(NaN), FIRST_RETRY_MS);
});

test('the ceiling really is six requests an hour, not sixty', () => {
  assert.ok(MAX_RETRY_MS >= 10 * 60 * 1000);
  assert.equal(Math.floor((60 * 60 * 1000) / MAX_RETRY_MS), 6);
});

// ---- the gate ----

test('a blocked queue stops asking, and recovers on its own', () => {
  let t = 1_000_000;
  const gate = createFlushGate({ now: () => t });

  assert.equal(gate.allow(), true, 'nothing has failed yet');

  gate.recordFailure({ code: 'PGRST301', message: 'JWT expired' });
  assert.equal(gate.allow(), false, 'the very next 20s tick must not send a request');

  t += FIRST_RETRY_MS;
  assert.equal(gate.allow(), true);

  gate.recordFailure({ code: 'PGRST301', message: 'JWT expired' });
  t += FIRST_RETRY_MS;
  assert.equal(gate.allow(), false, 'the second failure doubles the wait');
  t += FIRST_RETRY_MS;
  assert.equal(gate.allow(), true);

  gate.recordSuccess();
  assert.equal(gate.allow(), true);
  assert.equal(gate.state().blocked, null, 'a success clears the message too');
});

// One dropped request on a flaky link resolves itself on the next tick, and
// the old wording was right for exactly that case. Crying wolf at a kiosk is
// how operators learn to ignore the line.
test('one failure is not yet worth alarming anyone about', () => {
  const gate = createFlushGate({ now: () => 0 });
  gate.recordFailure({ message: 'NetworkError when attempting to fetch' });
  assert.equal(gate.state().blocked, null, 'still just "will sync automatically"');
  gate.recordFailure({ message: 'NetworkError when attempting to fetch' });
  assert.ok(gate.state().blocked, 'twice in a row is a story');
});

test('a reconnect clears the ladder so recovery is not delayed by it', () => {
  let t = 0;
  const gate = createFlushGate({ now: () => t });
  for (let i = 0; i < 8; i += 1) gate.recordFailure({ status: 500, message: 'boom' });
  assert.equal(gate.allow(), false);
  gate.reset();
  assert.equal(gate.allow(), true, 'the backoff was about conditions that have since changed');
  assert.equal(gate.state().failures, 0);
});

test('the countdown never goes negative or invents a number', () => {
  assert.equal(secondsUntil(5000, 1000), 4);
  assert.equal(secondsUntil(1000, 5000), 0);
  assert.equal(secondsUntil(null, 1000), 0);
  assert.equal(secondsUntil(undefined, undefined), 0);
});

// ---- what the operator reads ----

test('the promise is only made when it is true', () => {
  assert.equal(syncStatusText({ pending: 0, online: true }), '', 'an empty queue says nothing');
  assert.equal(
    syncStatusText({ pending: 3, online: false, blocked: null }),
    '3 scans queued — will sync automatically',
  );
  assert.equal(
    syncStatusText({ pending: 1, online: true, blocked: null }),
    'Syncing 1 offline scan…',
  );
  const blocked = syncStatusText({
    pending: 14, online: true, blocked: 'this kiosk needs to sign in again', secondsToRetry: 40,
  });
  assert.match(blocked, /14 scans queued/);
  assert.match(blocked, /sign in again/);
  assert.match(blocked, /Retrying in 40s/);
  assert.ok(!/will sync automatically/.test(blocked),
    'the whole bug was saying this while it was not happening');
});

test('a long wait reads in minutes, and a due retry says so', () => {
  assert.match(syncStatusText({ pending: 2, online: true, blocked: 'x', secondsToRetry: 600 }), /Retrying in 10 min/);
  assert.match(syncStatusText({ pending: 2, online: true, blocked: 'x', secondsToRetry: 0 }), /Retrying now/);
});

test('a nullish pending count renders nothing rather than "0 scans"', () => {
  assert.equal(syncStatusText({ pending: null, online: true }), '');
  assert.equal(syncStatusText({ pending: undefined, online: false }), '');
});

// ---- the wiring ----

test('the scanner checks the gate before spending a request', () => {
  const kiosk = read('../JS/Features/Scanner/StandaloneScanner.js');
  const from = kiosk.indexOf('const flushIfPending = async () =>');
  const to = kiosk.indexOf('const flushAndRefresh', from);
  assert.ok(from !== -1 && to > from, 'could not isolate flushIfPending');
  const fn = kiosk.slice(from, to);
  assert.match(fn, /if \(!flushGate\.allow\(\)\) \{ renderOfflineStatus\(\); return; \}/);
  assert.ok(fn.indexOf('flushGate.allow') < fn.indexOf('OfflineScanModel.flushQueue'),
    'the check is worthless after the request it was meant to avoid');
  assert.match(fn, /if \(error && synced === 0\) flushGate\.recordFailure\(error\)/,
    'a flush that moved rows is progress, not a strike');
});

test('the retry stays automatic — no button was added to the kiosk', () => {
  const kiosk = read('../JS/Features/Scanner/StandaloneScanner.js');
  assert.ok(!/id="ss-retry-sync"|Retry<\/button>/.test(kiosk),
    'a kiosk is operated with a card reader and no mouse; the retry must not need a click');
  assert.match(kiosk, /setInterval\(flushIfPending, FLUSH_RETRY_INTERVAL_MS\)/,
    'the automatic tick is still what drives recovery');
  assert.match(kiosk, /flushGate\.reset\(\);\s*\n\s*await flushAndRefresh\(\)/,
    'reconnecting must clear the ladder rather than waiting it out');
});
