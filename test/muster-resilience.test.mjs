// A roll call that survives a reload, and people who are present but not on
// the sheet.
//
// THE ASYMMETRY THIS FIXES. Assembly mode was written to localStorage on
// every toggle. `let accounted = new Set()` three lines above it was memory
// only — so a refresh, a crash, or the service worker activating
// mid-evacuation lost every tick, on a phone, outdoors, with people standing
// in a car park.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  pruneAccounted, addUnlisted, removeUnlisted, unlistedId,
} from '../JS/Utils/muster.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../JS/${p}`, import.meta.url)), 'utf8');
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const page = code(read('Features/Muster/MusterPage.js'));
const cache = code(read('Utils/musterCache.js'));

// ---- pruning ----
//
// Refresh replaces the snapshot mid-headcount. A tick for someone who has
// since tapped out would keep counting toward a site total that no longer
// includes them — "41 of 40", or a site reading complete when it is not.

test('ticks survive a refresh for people still on the sheet', () => {
  const kept = pruneAccounted(new Set(['a', 'b']), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.deepEqual([...kept].sort(), ['a', 'b'],
    'a marshal pressing Refresh wants a newer list, not their work discarded');
});

test('a tick for someone no longer listed is dropped', () => {
  const kept = pruneAccounted(new Set(['a', 'gone']), [{ id: 'a' }]);
  assert.deepEqual([...kept], ['a']);
});

test('pruning survives missing and malformed input', () => {
  assert.equal(pruneAccounted(null, null).size, 0);
  assert.equal(pruneAccounted(new Set(['a']), 'nope').size, 0);
  assert.equal(pruneAccounted(new Set(['a']), [null, {}, { id: '' }]).size, 0);
});

// ---- people added at the assembly point ----

test('a typed-in person gets an id that cannot collide with an employee', () => {
  const [entry] = addUnlisted([], 'Maria Santos');
  assert.match(entry.id, /^unlisted:/,
    'anything reading the roll call must be able to tell the two apart');
  assert.equal(entry.label, 'Maria Santos');
});

// Two contractors can legitimately be written down identically, and the
// second must not silently tick the first.
test('two identical entries are two people', () => {
  let list = addUnlisted([], 'contractor');
  list = addUnlisted(list, 'contractor');
  assert.equal(list.length, 2);
  assert.notEqual(list[0].id, list[1].id);
});

test('ids are unique even within the same millisecond', () => {
  const ids = new Set();
  let n = 0;
  for (let i = 0; i < 200; i += 1) ids.add(unlistedId(() => (n += 0.0037) % 1));
  assert.ok(ids.size > 150, `expected near-unique ids, got ${ids.size} of 200`);
});

// A blank row in a document someone will later read as a record of who was
// outside is worse than no row.
test('blank and whitespace entries are refused', () => {
  for (const bad of ['', '   ', null, undefined]) {
    assert.deepEqual(addUnlisted([], bad), [], `"${bad}" must not be added`);
  }
});

test('a pasted essay is capped rather than stored whole', () => {
  const [entry] = addUnlisted([], 'x'.repeat(500));
  assert.equal(entry.label.length, 80);
});

test('removing one leaves the rest', () => {
  let list = addUnlisted(addUnlisted([], 'a'), 'b');
  list = removeUnlisted(list, list[0].id);
  assert.equal(list.length, 1);
  assert.equal(list[0].label, 'b');
  assert.deepEqual(removeUnlisted(null, 'x'), []);
});

// ---- storage ----

test('the roll call and the typed-in list are persisted, and expire', () => {
  assert.match(cache, /export function saveAccounted/);
  assert.match(cache, /export function readAccounted/);
  assert.match(cache, /export function saveUnlisted/);
  assert.match(cache, /export function readUnlisted/);
  assert.match(cache, /ACCOUNTED_MAX_AGE_MS = 12 \* 60 \* 60 \* 1000/,
    'an evacuation is minutes to hours; a tick still here tomorrow describes '
    + 'a different headcount');
});

// Date.parse(undefined) is NaN, and every comparison against NaN is false —
// so a missing timestamp would sail through an age check written the obvious
// way and read as fresh forever.
// Bounded to each function. An unbounded slice ran past readAccounted into
// readUnlisted, which carries the same guard — so deleting the guard from
// readAccounted left this passing against its neighbour's source. Caught by
// sabotaging exactly that line.
test('a missing or future timestamp reads as expired, not as fresh', () => {
  const between = (from, to) => {
    const a = cache.indexOf(from);
    const b = cache.indexOf(to, a + 1);
    assert.ok(a !== -1 && b !== -1 && b > a, `could not isolate ${from}`);
    return cache.slice(a, b);
  };
  for (const [fn, end] of [
    ['export function readAccounted', 'export function clearAccounted'],
    ['export function readUnlisted', 'export function clearUnlisted'],
  ]) {
    const body = between(fn, end);
    assert.match(body, /!Number\.isFinite\(at\)/, `${fn} must reject an unparseable timestamp`);
    assert.match(body, /nowMs < at/, `${fn} must reject a clock that moved backwards`);
  }
});

// ---- the page ----

test('the roll call is restored on mount, not started empty', () => {
  assert.match(page, /let accounted = readAccounted\(\)/,
    'a bare new Set() is what lost every tick on reload');
  assert.match(page, /let unlisted = readUnlisted\(\)/);
});

// Written on every tick rather than on a timer or on unload: the events this
// page exists for are exactly the ones that give no warning.
test('a tick is written immediately', () => {
  const handler = page.slice(page.indexOf("input[data-person]"));
  const save = handler.indexOf('saveAccounted(accounted)');
  const paint = handler.indexOf('paintCounts()');
  assert.ok(save !== -1 && save < paint, 'persist before repainting, not after');
});

test('Reset clears everything a headcount accumulated', () => {
  const reset = page.slice(page.indexOf("$('#mu-reset')"), page.indexOf("$('#mu-print')"));
  assert.match(reset, /clearAccounted\(\)/);
  assert.match(reset, /clearUnlisted\(\)/,
    '"Reset ticks" leaving typed-in people behind is a half-reset');
});

// Site totals are measured against the snapshot. Quietly adding people to a
// denominator the snapshot never contained is how "all accounted for" stops
// meaning anything.
test('typed-in people get their own panel, not a site', () => {
  assert.match(page, /function unlistedHTML\(\)/);
  assert.match(page, /class="panel muster-site muster-unlisted"/);
  const groups = page.slice(page.indexOf('allGroups = groupForMuster(all)'));
  assert.ok(!/groupForMuster\(\[\.\.\.all, \.\.\.unlisted\]\)/.test(groups),
    'unlisted people must never enter a site grouping');
});

// The grid is the whole point of the page; pruning against the roster alone
// would discard every tick for someone typed in.
test('pruning counts typed-in people as still present', () => {
  assert.match(page, /pruneAccounted\(accounted, \[\.\.\.all, \.\.\.unlisted\]\)/);
});

// paintCounts() runs on a tick without a full repaint, to protect scroll
// position mid-headcount — so the typed-in panel's own count has to be
// updated there too or it sits stale.
test('the typed-in count keeps current on a tick', () => {
  const counts = page.slice(page.indexOf('function paintCounts'));
  assert.match(counts, /data-unlisted-count/);
});

// The add affordance is most needed exactly when the search finds nobody.
test('the add affordance survives an empty result', () => {
  const paint = page.slice(page.indexOf('function paint()'), page.indexOf('function addRowHTML'));
  assert.match(paint, /const extras = addRowHTML\(q\) \+ unlistedHTML\(\)/);
  assert.ok(paint.indexOf('extras') < paint.indexOf('empty-state'),
    'the empty state must render the extras too, not instead of them');
});
