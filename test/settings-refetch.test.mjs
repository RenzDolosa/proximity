// Settings refetched everything on every visit.
//
// Found by the Request volume panel added in the same branch, on its first
// real session: 20 of 41 requests came from Settings alone, because opening
// it reran the whole group's loaders each time.
//
// The lazy-load guard already existed — `const started = new Set()` — but it
// was declared INSIDE renderSettings(), so it was rebuilt on every render and
// only ever de-duplicated within a single visit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isFresh, markFetched, invalidate, invalidateAll } from '../JS/Utils/freshness.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const settings = read('../JS/Features/Settings/SettingsPage.js');
const scanners = read('../JS/Components/ScannersPanel.js');
const directory = read('../JS/Features/Directory/DirectoryPage.js');

// Comments stripped: the replacement quotes the old line to explain what it
// replaced, which would otherwise satisfy this check against itself.
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

test('the per-render Set is gone, replaced by a window that outlives a visit', () => {
  assert.ok(!/const started = new Set\(\)/.test(code(settings)),
    'a local Set is rebuilt on every render and cannot suppress anything across visits');
  assert.match(settings, /isFresh\(key, SETTINGS_MAX_AGE_MS\)/);
});

// Was: compare SETTINGS_MAX_AGE_MS against DIRECTORY_MAX_AGE_MS and require
// the two literals to match. That enforced the right rule the weak way --
// two constants kept equal by a test and a comment. There is now one
// constant, so the rule is enforced by construction and this asserts the
// stronger thing: nobody declares a second.
test('"how stale may a screen be" has exactly one answer in this app', () => {
  assert.match(settings, /SETTINGS_MAX_AGE_MS = PAGE_MAX_AGE_MS/,
    'Settings must read the shared window, not restate it');
  assert.ok(!/DIRECTORY_MAX_AGE_MS\s*=\s*\d/.test(directory),
    'Employee Manager must not declare its own window either');

  const pages = readdirSync(fileURLToPath(new URL('../JS/Features/', import.meta.url)), { recursive: true })
    .filter((f) => String(f).endsWith('.js'));
  for (const rel of pages) {
    const src = code(readFileSync(fileURLToPath(new URL(`../JS/Features/${rel}`, import.meta.url)), 'utf8'));
    const own = src.match(/const \w*MAX_AGE_MS\s*=\s*(\d[^;]*);/);
    assert.equal(own, null,
      `${rel} declares its own staleness window (${own?.[1]?.trim()}) instead of importing PAGE_MAX_AGE_MS`);
  }
});

// `pending` and the toggle listener can both reach the same group inside one
// render. Marking after the await would let both past the check first.
test('the key is marked before the await, not after', () => {
  const body = settings.slice(settings.indexOf('const openGroup'), settings.indexOf('const pending'));
  assert.ok(body.indexOf('markFetched(key)') < body.indexOf('await Promise.all'),
    'marking afterwards lets two concurrent opens both fetch');
});

test('a thrown load clears the key instead of locking in the failure', () => {
  const body = settings.slice(settings.indexOf('const openGroup'), settings.indexOf('const pending'));
  assert.match(body, /catch \(e\)[\s\S]*invalidate\(key\)[\s\S]*throw e/,
    'a failure that looks fresh cannot be retried except by waiting out the window');
});

// ---- the regression this nearly shipped ----
//
// Settings rebuilds its markup on every visit. mountScannersPanel() binds the
// panel's listeners to that fresh markup AND fetched the list in the same
// call, so gating the whole thing on freshness would have rendered a scanner
// panel whose Refresh button did nothing.
test('mounting is separated from fetching, and mounting always runs', () => {
  assert.match(settings, /const groupMounts = \{/);
  const mounts = settings.slice(settings.indexOf('const groupMounts'), settings.indexOf('const groupLoaders'));
  assert.match(mounts, /mountScannersPanel\(\{ maxAgeMs: SETTINGS_MAX_AGE_MS \}\)/);
  const loaders = settings.slice(settings.indexOf('const groupLoaders'), settings.indexOf('const openGroup'));
  assert.ok(!/mountScannersPanel/.test(loaders),
    'the mount must not sit behind the freshness check that skips fetches');
  const open = settings.slice(settings.indexOf('const openGroup'), settings.indexOf('const pending'));
  assert.ok(open.indexOf('groupMounts[id]') < open.indexOf('isFresh('),
    'mounts are collected before the freshness check, so they run either way');
});

test('the scanners panel binds its listener before deciding to fetch', () => {
  const mount = scanners.slice(scanners.indexOf('export async function mountScannersPanel'));
  const body = mount.slice(0, mount.indexOf('\n}'));
  assert.ok(body.indexOf("addEventListener") < body.indexOf('isFresh('),
    'returning early before the bind leaves a panel that renders and does nothing');
  assert.match(body, /if \(loaded\) paint\(\)/, 'it must repaint from what it already holds');
});

// addEventListener passes the event as the first argument, which would land
// in this function's options bag and be read as { maxAgeMs: undefined }.
test('the refresh button cannot pass a DOM event in as options', () => {
  assert.match(scanners, /addEventListener\('click', \(\) => load\(\)\)/,
    'a bare `load` reference would receive the click event as its argument');
});

test('a failed scanner list does not start a window', () => {
  const load = scanners.slice(scanners.indexOf('async function load()'));
  const body = load.slice(0, load.indexOf('\n}'));
  assert.ok(body.indexOf('if (error)') < body.indexOf('markFetched'),
    'marking before the error check would suppress the retry of a failure');
});

// ---- the other half of the same bug ----
//
// Seven panels already repainted from module state on render. Shifts and
// travel did not — they painted only from inside their own loaders, which was
// invisible while every visit refetched and would have left both stuck on
// "Loading…" the moment a window skipped the fetch.
test('every admin panel repaints from state on render, not only on fetch', () => {
  for (const paint of [
    'paintQueryStats', 'paintThumbStats', 'paintUsage', 'paintArchiveStatus',
    'paintTrimStatus', 'paintSilenceStatus', 'paintSiteRules', 'paintShiftRules',
  ]) {
    const calls = [...settings.matchAll(new RegExp(`${paint}\\(\\)`, 'g'))].length;
    assert.ok(calls >= 2, `${paint} is only ever called from its loader`);
  }
  const render = settings.slice(settings.indexOf('if (isAdmin()) {'), settings.indexOf('const groupMounts'));
  assert.match(render, /\n\s*paintSiteRules\(\);/, 'travel must repaint on render');
  assert.match(render, /\n\s*paintShiftRules\(\);/, 'shifts must repaint on render');
});

// ---- the window itself ----

test('a window suppresses a refetch and expires on time', () => {
  invalidateAll();
  const now = 1_000_000;
  assert.equal(isFresh('settings:data', 60000, now), false, 'first visit must fetch');
  markFetched('settings:data', now);
  assert.equal(isFresh('settings:data', 60000, now + 59_000), true, 'a revisit inside the window must not');
  assert.equal(isFresh('settings:data', 60000, now + 61_000), false, 'and must again once it expires');
  invalidate('settings:data');
  assert.equal(isFresh('settings:data', 60000, now + 1000), false, 'an explicit invalidate wins immediately');
});

// The panels' own Refresh buttons call their loader directly rather than
// going through openGroup(), so an explicit refresh is never suppressed.
test('explicit refresh buttons bypass the window entirely', () => {
  for (const [btn, loader] of [
    ["$('#us-refresh')", 'loadUsage'],
    ["$('#qs-refresh')", 'loadQueryStats'],
    ["$('#th-refresh')", 'loadThumbStats'],
  ]) {
    const at = settings.indexOf(btn);
    assert.notEqual(at, -1, `${btn} not found`);
    const handler = settings.slice(at, at + 220);
    assert.ok(handler.includes(loader), `${btn} must call ${loader} directly`);
    assert.ok(!handler.includes('openGroup'), `${btn} must not route through the windowed path`);
  }
});
