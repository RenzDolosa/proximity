// The deploy stamp, and the two things that read it.
//
// THE BUG THIS BRANCH FIXES. A Service Worker is reinstalled only when its
// own FILE BYTES change. sw.js carried a hand-bumped `const VERSION = 'v2'`
// that last moved in 8d9e02f, with 79 commits touching JS/CSS afterwards —
// so for two months the browser saw no new worker, `activate` never ran, and
// the `app-updated` message never reached a tab. appUpdate.js's header says
// there are "two triggers, because they fail in different ways"; only one
// has ever fired, and a kiosk could serve up to twelve hours of stale code
// after a deploy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILD, isDevBuild, shortBuild } from '../JS/Core/buildInfo.js';

const root = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const sw = root('sw.js');
const workflow = root('.github/workflows/deploy-cloudflare.yml');
const buildInfo = root('JS/Core/buildInfo.js');
const appUpdate = root('JS/Utils/appUpdate.js');
const health = root('JS/Utils/scannerHealth.js');
const kiosk = root('JS/Features/Scanner/StandaloneScanner.js');
const settings = root('JS/Features/Settings/SettingsPage.js');

// ---- the stamp ----

// Both files must carry the SAME placeholder the workflow rewrites. A
// mismatch means one gets stamped and the other does not, and "which build
// is this?" then has two answers.
test('both stamped files start from the same placeholder', () => {
  assert.match(sw, /^const VERSION = 'dev';$/m);
  assert.match(buildInfo, /^export const BUILD = 'dev';$/m);
  assert.equal(BUILD, 'dev', 'the checked-in value is the placeholder');
});

test('the workflow rewrites both, with one value', () => {
  assert.match(workflow, /BUILD="\$\{GITHUB_SHA\}"/);
  assert.match(workflow, /sed -i "s\|\^const VERSION = 'dev';\|const VERSION = '\$\{BUILD\}';\|" sw\.js/);
  assert.match(workflow, /sed -i "s\|\^export const BUILD = 'dev';\|export const BUILD = '\$\{BUILD\}';\|" JS\/Core\/buildInfo\.js/);
});

// A sed that silently matched nothing would restore exactly the bug this
// step exists for, and would look identical from the outside.
test('an unstamped build fails the deploy rather than shipping', () => {
  const step = workflow.slice(workflow.indexOf('Stamp the build'), workflow.indexOf('npm run deploy'));
  assert.match(step, /grep -q "\^const VERSION = '\$\{BUILD\}';" sw\.js/);
  assert.match(step, /grep -q "\^export const BUILD = '\$\{BUILD\}';" JS\/Core\/buildInfo\.js/);
  assert.match(step, /set -e/, 'without set -e a failed grep would not fail the step');
});

test('the stamp runs before the deploy, not after', () => {
  assert.ok(workflow.indexOf('Stamp the build') < workflow.indexOf('npm run deploy'));
});

// It looks like a constant somebody forgot to maintain — which is exactly
// what VERSION looked like for two months.
test('both files warn against "fixing" the placeholder back', () => {
  assert.match(sw, /do not hand-edit/i);
  assert.match(buildInfo, /DO NOT "FIX" THIS BACK/i);
});

// ---- reading it ----

test('a checkout reports itself as dev, not as a real build', () => {
  assert.equal(isDevBuild(), true);
  assert.equal(shortBuild(), 'dev');
  assert.equal(isDevBuild('4f96538abc'), false);
});

test('a stamped SHA is shortened for a human comparing it to GitHub', () => {
  assert.equal(shortBuild('4f965387c0d1e2f3a4b5'), '4f96538');
  assert.equal(shortBuild(''), 'dev', 'an empty stamp is not a build');
  assert.equal(shortBuild(null), 'dev');
});

// ---- surfacing it ----

// createUpdateGate already tracked `pending` and already waited for idle.
// Nothing read the bit, so an operator at a kiosk running yesterday's code
// had no way to know and no way to let the update through.
test('the pending state is readable, and applying still goes through the gate', () => {
  assert.match(appUpdate, /export function updatePending\(\)/);
  assert.match(appUpdate, /export function applyUpdateNow\(\)/);
  // Bounded to the function. An unbounded slice runs on into
  // initAppUpdates(), which legitimately holds `reload = () =>
  // window.location.reload()` as the gate's own injected default — so the
  // check below would fail against a line it was never about. Same mistake
  // the readAccounted guard made in the muster branch.
  const from = appUpdate.indexOf('export function applyUpdateNow');
  const to = appUpdate.indexOf('export function initAppUpdates', from);
  assert.ok(from !== -1 && to > from, 'could not isolate applyUpdateNow');
  const apply = appUpdate.slice(from, to);
  assert.match(apply, /liveGate\?\.attempt\(\)/,
    'applying must not call reload() directly — the gate is what refuses mid-scan');
  assert.ok(!/location\.reload/.test(apply),
    'a direct reload here would ignore an in-flight scan or an open dialog');
});

test('the kiosk shows the build and warns when an update is held', () => {
  assert.match(health, /key: 'build'/);
  assert.match(health, /updatePending \? 'update waiting'/);
  assert.match(kiosk, /buildLabel: shortBuild\(\)/);
  assert.match(kiosk, /updatePending: updatePending\(\)/);
});

// A button that looks ignored is worse than no button.
test('a refused apply says why rather than doing nothing visible', () => {
  assert.match(kiosk, /if \(!applyUpdateNow\(\)\) toast\(/);
  assert.match(settings, /if \(!applyUpdateNow\(\)\) toast\(/);
});

// The tab holds whatever it booted with; the worker is what is live. A
// difference between them is the signal, and it does not depend on having
// caught the activation message.
//
// The comparison moved into Utils/workerState.js on 2026-11-13 — it had to
// be shared with the kiosk drawer, and the inline version silently rendered
// "up to date" whenever the worker was unknown. This test follows it there
// rather than being deleted: the round trip it guards is unchanged.
test('Settings compares the tab build against the live worker', () => {
  assert.match(settings, /describeWorker\(\{/);
  assert.match(settings, /workerBuild: workerBuild \? shortBuild\(workerBuild\) : null/);
  assert.match(settings, /postMessage\(\{ type: 'which-version' \}\)/);
  assert.match(sw, /event\.data\?\.type !== 'which-version'/);
  assert.match(sw, /type: 'sw-version', version: VERSION/);
  const state = readFileSync(fileURLToPath(new URL('../JS/Utils/workerState.js', import.meta.url)), 'utf8');
  assert.match(state, /const behind = Boolean\(tabBuild && workerBuild !== tabBuild\)/);
});

// Asking the worker is a postMessage inside the browser. If this ever
// becomes a fetch, the panel stops being free.
test('asking which build is running costs no request', () => {
  const about = settings.slice(settings.indexOf('function askWorkerBuild'), settings.indexOf('async function loadShiftRules'));
  assert.ok(!/supabase|fetch\(/.test(about), 'the About panel must not reach the network');
});
