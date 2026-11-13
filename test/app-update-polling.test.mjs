// Why a kiosk stayed on old code even after the deploy stamp was fixed.
//
// 2026-11-12 made sw.js's bytes change on every deploy. On 2026-11-13 a
// kiosk still showed BOTH About rows reading 5da157e while the origin had
// been serving 492bca4 for hours. Fetching the live files proved the server
// was right, so the gap was entirely on the client, and it was two separate
// defects stacked:
//
//   1. NOBODY EVER ASKED. The browser checks for a new Service Worker script
//      on NAVIGATION to an in-scope page. main.js calls register('/sw.js')
//      once, at boot, and a kiosk never navigates again. The bytes changed
//      and no one looked. registration.update() is the ask.
//
//   2. A BACKLOG COUNTED AS BUSY. kioskIsBusy() read `pendingScanCount > 0`,
//      which is the offline QUEUE DEPTH, not a scan in flight. One unsynced
//      scan made the kiosk permanently busy, so the update gate rescheduled
//      every 60 seconds forever and the 12-hour tab-age trigger — built
//      precisely to catch a stale kiosk — could never fire. The kiosks most
//      in need of new code were the ones guaranteed never to get it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SW_CHECK_MS, MIN_SW_CHECK_GAP_MS, shouldCheckForUpdate, initAppUpdates,
} from '../JS/Utils/appUpdate.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// initAppUpdates touches globals a Node process does not have. Install the
// smallest surface it actually reads, and hand back the recorded intervals
// so the polling can be driven without waiting half an hour.
function harness({ online = true, visibility = 'visible' } = {}) {
  const intervals = [];
  const listeners = new Map();
  const docListeners = new Map();
  const checks = [];
  // globalThis.navigator is an accessor with no setter in Node 20, so a
  // plain assignment throws. Swap the whole property descriptor and put the
  // original back afterwards.
  const saved = {
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    add: Object.getOwnPropertyDescriptor(globalThis, 'addEventListener'),
  };
  const put = (name, value) =>
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  const fakeNavigator = { onLine: online, serviceWorker: undefined };
  put('navigator', fakeNavigator);
  put('document', {
    visibilityState: visibility,
    querySelector: () => null,
    addEventListener: (n, fn) => docListeners.set(n, fn),
  });
  put('addEventListener', (n, fn) => listeners.set(n, fn));

  let clock = 1_000_000;
  const gate = initAppUpdates({
    loadedAt: clock,
    now: () => clock,
    reload: () => {},
    schedule: () => 1,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    checkForUpdate: () => { checks.push(clock); },
  });

  return {
    gate,
    checks,
    pollInterval: intervals.find((i) => i.ms === SW_CHECK_MS),
    intervals,
    fire: (name) => listeners.get(name)?.(),
    fireDoc: (name) => docListeners.get(name)?.(),
    advance: (ms) => { clock += ms; },
    setOnline: (v) => { fakeNavigator.onLine = v; },
    restore: () => {
      for (const [name, desc] of Object.entries(saved)) {
        const key = name === 'add' ? 'addEventListener' : name;
        if (desc) Object.defineProperty(globalThis, key, desc);
        else delete globalThis[key];
      }
    },
  };
}

// ---- the throttle ----

test('a first check is always allowed', () => {
  assert.equal(shouldCheckForUpdate(null, 1000), true);
  assert.equal(shouldCheckForUpdate(undefined, 1000), true);
});

// Number(null) is 0 and 0 is finite, so a nullish "last checked" coerced
// through Number would read as the epoch and let every event through —
// which is the opposite of a throttle. Fourth time this coercion has bitten.
test('a nullish timestamp is "never", not "the epoch"', () => {
  assert.equal(shouldCheckForUpdate(NaN, 1000), true);
  assert.equal(shouldCheckForUpdate('900', 1000), true, 'a string is not a timestamp');
});

test('checks inside the floor are refused, outside it allowed', () => {
  const t = 1_000_000;
  assert.equal(shouldCheckForUpdate(t, t + MIN_SW_CHECK_GAP_MS - 1), false);
  assert.equal(shouldCheckForUpdate(t, t + MIN_SW_CHECK_GAP_MS), true);
});

test('the poll is frequent enough to matter and rare enough to be free', () => {
  assert.ok(SW_CHECK_MS <= 60 * 60 * 1000, 'an hour between checks is too long for a deploy');
  assert.ok(SW_CHECK_MS >= 5 * 60 * 1000, 'more often than this is asking for nothing');
  assert.ok(MIN_SW_CHECK_GAP_MS < SW_CHECK_MS);
});

// ---- the poll ----

test('a kiosk asks once at boot rather than waiting out the first interval', () => {
  const h = harness();
  try {
    assert.equal(h.checks.length, 1,
      'a kiosk reopened after a week should not wait half an hour to find out it is behind');
  } finally { h.restore(); }
});

test('the poll is wired to an interval, so a tab that never navigates still asks', () => {
  const h = harness();
  try {
    assert.ok(h.pollInterval, `no interval registered at ${SW_CHECK_MS}ms`);
    h.advance(SW_CHECK_MS);
    h.pollInterval.fn();
    assert.equal(h.checks.length, 2);
  } finally { h.restore(); }
});

test('reconnecting and refocusing ask too, but not more often than the floor', () => {
  const h = harness();
  try {
    h.fire('online');
    h.fireDoc('visibilitychange');
    assert.equal(h.checks.length, 1, 'both were inside the floor after the boot check');
    h.advance(MIN_SW_CHECK_GAP_MS);
    h.fire('online');
    assert.equal(h.checks.length, 2);
    h.fireDoc('visibilitychange');
    assert.equal(h.checks.length, 2, 'the floor applies across sources, not per source');
  } finally { h.restore(); }
});

test('an offline kiosk does not ask', () => {
  const h = harness();
  try {
    h.setOnline(false);
    h.advance(MIN_SW_CHECK_GAP_MS);
    h.pollInterval.fn();
    assert.equal(h.checks.length, 1, 'a check with no network is a request spent on nothing');
  } finally { h.restore(); }
});

// The question is free; only the answer reloads. Gating the ASK on idle
// would reintroduce the whole bug in a new place.
test('asking is not gated on the page being idle', () => {
  const src = read('../JS/Utils/appUpdate.js');
  const from = src.indexOf('const poll = () =>');
  const to = src.indexOf('everyMs(poll, swCheckMs)', from);
  assert.ok(from !== -1 && to > from, 'could not isolate poll');
  const poll = src.slice(from, to);
  assert.ok(!/isBusy|busy\(\)/.test(poll),
    'update() asks whether a new worker exists; activation still goes through the gate');
});

test('a rejected check cannot break the tab', () => {
  const src = read('../JS/Utils/appUpdate.js');
  assert.match(src, /Promise\.resolve\(checkForUpdate\(\)\)\.catch\(\(\) => \{\}\)/);
});

// ---- a backlog is not busy ----

test('kioskIsBusy asks whether a scan is in flight, not whether one is queued', () => {
  const kiosk = read('../JS/Features/Scanner/StandaloneScanner.js');
  const from = kiosk.indexOf('function kioskIsBusy()');
  const to = kiosk.indexOf('\n}', from);
  assert.ok(from !== -1 && to > from, 'could not isolate kioskIsBusy');
  const fn = kiosk.slice(from, to);
  assert.match(fn, /scanInFlight/);
  assert.ok(!/pendingScanCount/.test(fn),
    'the queue depth is a backlog, not a scan — treating it as busy pinned kiosks on old code');
});

// The variable existed only to feed that check. Leaving it assigned would
// invite the same mistake back.
test('the queue-depth mirror is gone rather than left lying around', () => {
  const kiosk = read('../JS/Features/Scanner/StandaloneScanner.js');
  const code = kiosk.split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.ok(!/pendingScanCount/.test(code),
    'no live reference should remain; the comment explaining it may stay');
});

test('the real in-flight flag is still maintained by the scan path', () => {
  const kiosk = read('../JS/Features/Scanner/StandaloneScanner.js');
  assert.match(kiosk, /setScanInFlight\(true\)/);
  assert.match(kiosk, /setScanInFlight\(false\)/);
});

// Reloading with entries queued is safe, and the reason is server-side.
test('the safety of reloading mid-backlog rests on request-id idempotency', () => {
  const sql = read('../Supabase/migrations/20261106170000_absorb_duplicate_scan_replays.sql');
  assert.match(sql, /prior_scan_for_request/);
  const model = read('../JS/Models/OfflineScanModel.js');
  assert.match(model, /p_request_id: entry\.request_id \|\| null/,
    'a replay after a reload must resolve to the original answer, not a second row');
});
