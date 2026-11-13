// "Service worker: not registered" next to a green "up to date".
//
// Both rendered at once, on 2026-11-13, from this:
//
//     const behind = Boolean(worker && worker !== tabBuild);
//     const status = pending || behind ? 'update waiting' : ... 'up to date';
//
// A null worker makes `behind` false, so an unknown state fell through to
// the reassuring branch. Same shape as Number(null) === 0: absence treated
// as a pass. The panel exists to answer "am I running current code" and it
// answered yes while saying it had no idea.
//
// "not registered" was also the wrong words. It was printed whenever
// `controller` was null, which covers three different situations — and the
// one that had actually happened was a force-reload, which bypasses the
// worker by design and leaves a perfectly healthy registration uncontrolled.
//
// The second half matters more than the version display: an uncontrolled
// page has no cached app shell, so it does not fall back to offline mode
// when the network drops. It fails to load.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORKER, describeWorker, probeWorkerState } from '../JS/Utils/workerState.js';
import { healthRows, HEALTH } from '../JS/Utils/scannerHealth.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// ---- the rule ----

// The assertion that would have caught the shipped bug, stated as the rule
// rather than as one example of it.
test('only one state in the whole space can say "up to date"', () => {
  const green = [];
  for (const state of Object.values(WORKER)) {
    for (const workerBuild of [null, '57476db', '492bca4']) {
      for (const pending of [true, false]) {
        const d = describeWorker({ state, workerBuild, tabBuild: '57476db', pending });
        if (d.badge === 'up to date') green.push({ state, workerBuild, pending });
      }
    }
  }
  assert.deepEqual(green, [{ state: WORKER.READY, workerBuild: '57476db', pending: false }],
    'up to date must require controlling, answered, matching, and nothing held');
});

test('an unknown worker is never green', () => {
  for (const state of [WORKER.UNKNOWN, WORKER.UNSUPPORTED, WORKER.NONE, WORKER.NOT_CONTROLLING, WORKER.ASKING]) {
    const d = describeWorker({ state, tabBuild: '57476db' });
    assert.notEqual(d.badge, 'up to date', `${state} claimed to be up to date`);
    assert.notEqual(d.tone, 'good', `${state} rendered as good`);
  }
});

// ---- the three states that used to be one ----

test('the screenshot case reads as not controlling, not as unregistered', () => {
  const d = describeWorker({ state: WORKER.NOT_CONTROLLING, tabBuild: '57476db' });
  assert.equal(d.value, 'not controlling');
  assert.equal(d.offline, false);
  assert.match(d.detail, /force-reload/, 'the cause and its one-keystroke fix belong in the row');
});

test('genuinely unregistered is worse than uncontrolled, and says so', () => {
  const none = describeWorker({ state: WORKER.NONE, tabBuild: '57476db' });
  const un = describeWorker({ state: WORKER.NOT_CONTROLLING, tabBuild: '57476db' });
  assert.equal(none.value, 'not registered');
  assert.equal(none.tone, 'bad');
  assert.equal(un.tone, 'warn', 'uncontrolled recovers on the next plain reload; unregistered does not');
});

test('controlling but unanswered is a question, not an answer', () => {
  const d = describeWorker({ state: WORKER.ASKING, tabBuild: '57476db' });
  assert.equal(d.value, 'asking…');
  assert.equal(d.offline, true, 'the shell is cached even before the version reply arrives');
});

// ---- the comparison that still has to work ----

test('a worker on a different build is an update waiting', () => {
  const d = describeWorker({ state: WORKER.READY, workerBuild: '492bca4', tabBuild: '57476db' });
  assert.equal(d.badge, 'update waiting');
  assert.match(d.detail, /different build/);
});

test('a held reload shows as waiting even when the builds agree', () => {
  const d = describeWorker({ state: WORKER.READY, workerBuild: '57476db', tabBuild: '57476db', pending: true });
  assert.equal(d.badge, 'update waiting');
});

test('a dev checkout is labelled, not called up to date', () => {
  const d = describeWorker({ state: WORKER.READY, workerBuild: 'dev', tabBuild: 'dev', isDev: true });
  assert.equal(d.badge, 'dev build');
});

test('no arguments at all does not throw or claim anything', () => {
  const d = describeWorker();
  assert.equal(d.badge, 'checking');
  assert.equal(d.offline, false);
});

// ---- the probe ----

test('the probe reads browser state and never the network', async () => {
  assert.equal(await probeWorkerState(undefined), WORKER.UNSUPPORTED);
  assert.equal(await probeWorkerState({}), WORKER.UNSUPPORTED);
  assert.equal(
    await probeWorkerState({ serviceWorker: { getRegistration: async () => undefined } }),
    WORKER.NONE,
  );
  assert.equal(
    await probeWorkerState({ serviceWorker: { getRegistration: async () => ({}), controller: null } }),
    WORKER.NOT_CONTROLLING,
    'a registration with no controller is the force-reload case',
  );
  assert.equal(
    await probeWorkerState({ serviceWorker: { getRegistration: async () => ({}), controller: {} } }),
    WORKER.ASKING,
  );
});

test('a thrown getRegistration is the same practical answer as none', async () => {
  const nav = { serviceWorker: { getRegistration: async () => { throw new Error('SecurityError'); } } };
  assert.equal(await probeWorkerState(nav), WORKER.NONE);
});

test('the probe does not fetch', () => {
  const src = read('../JS/Utils/workerState.js');
  assert.ok(!/fetch\(|supabase|XMLHttpRequest/.test(src),
    'this panel is supposed to cost nothing');
});

// ---- the kiosk drawer ----

const shellRow = (state) => healthRows({ online: true, queued: 0, ...state }).find((r) => r.key === 'shell');

// The serious half. Everything else in that drawer assumes the worker is
// serving the app shell when the network drops; nothing checked whether it
// was, and the App version row read GOOD regardless.
test('a kiosk with no offline support says so in red', () => {
  const row = shellRow({ offlineShell: false });
  assert.equal(row.state, HEALTH.BAD);
  assert.equal(row.value, 'off');
  assert.match(row.detail, /will not load without a network/);
});

test('a working shell is good and quiet', () => {
  const row = shellRow({ offlineShell: true });
  assert.equal(row.state, HEALTH.GOOD);
  assert.equal(row.value, 'on');
  assert.equal(row.detail, null);
});

// Tri-state on purpose: not-yet-known must not render as either answer.
test('an unprobed shell is unknown, and an unasked one is absent', () => {
  assert.equal(shellRow({ offlineShell: null }).state, HEALTH.UNKNOWN);
  assert.equal(shellRow({ offlineShell: null }).value, 'checking…');
  assert.equal(shellRow({}), undefined, 'no row at all when nobody asked');
});

test('the kiosk probes once at mount and again when the worker changes', () => {
  const kiosk = read('../JS/Features/Scanner/StandaloneScanner.js');
  assert.match(kiosk, /refreshOfflineShellState\(\)\.then\(renderOfflineStatus\)/);
  assert.match(kiosk, /addEventListener\?\.\('controllerchange'/);
  assert.match(kiosk, /offlineShell: offlineShellReady/);
});

// ---- the About panel ----

test('About re-asks instead of caching the first answer forever', () => {
  const settings = read('../JS/Features/Settings/SettingsPage.js');
  assert.match(settings, /addEventListener\?\.\('controllerchange'/,
    'a worker activating while Settings is open must invalidate the cached build');
  assert.match(settings, /WORKER_REPLY_TIMEOUT_MS/,
    'a postMessage with no reply needs a deadline, or the panel waits forever');
  assert.ok(!/if \(!sw\?\.controller \|\| workerBuild !== null\) return;/.test(settings),
    'the old guard asked exactly once per page load and never again');
});

test('About shows offline support as its own row, not folded into the version', () => {
  const settings = read('../JS/Features/Settings/SettingsPage.js');
  assert.match(settings, /<span>Offline support<\/span>/);
});
