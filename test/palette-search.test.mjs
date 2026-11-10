// Utils/paletteSearch.js — the ranking behind Ctrl/Cmd+K.
//
// With 814 people the failure mode is not "no results", it is "the right one
// is ninth". Most of these pin an ordering rather than a match.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { searchPalette, moveSelection, MAX_RESULTS } from '../JS/Utils/paletteSearch.js';
import { GROUPED_ROUTES, ROUTE_TITLES } from '../JS/Core/navGroups.js';

const emp = (over = {}) => ({
  id: 'e1', full_name: 'Anthony Albao', employee_code: '2400',
  department: 'Apparel', position: 'Operator', active_proximity_code: 'A400', ...over,
});
const find = (q, employees, routes = GROUPED_ROUTES) =>
  searchPalette({ query: q, employees, routes, titles: ROUTE_TITLES });

test('an empty query offers destinations, not arbitrary people', () => {
  const r = find('', [emp(), emp({ id: 'b', full_name: 'Zar Dela Cruz' })]);
  assert.ok(r.length > 0);
  assert.ok(r.every((x) => x.kind === 'route'),
    'eight of 814 names chosen by array order is noise, not a starting point');
});

test('an exact code beats a name that merely contains the digits', () => {
  const r = find('2400', [
    emp({ id: 'name', full_name: 'Marion 2400 De Jesus', employee_code: '9999' }),
    emp({ id: 'code', employee_code: '2400' }),
  ]);
  assert.equal(r[0].id, 'code');
});

test('a card code is searchable too, since that is what is printed on the badge', () => {
  const r = find('a400', [emp()]);
  assert.equal(r[0].id, 'e1');
});

test('a partial code ranks above a name match', () => {
  const r = find('24', [
    emp({ id: 'n', full_name: '24 Hour Guard', employee_code: '7777', active_proximity_code: 'Z1' }),
    emp({ id: 'c', employee_code: '2409', active_proximity_code: 'Z2' }),
  ]);
  assert.equal(r[0].id, 'c', 'typing digits means a badge number');
});

// "dela" should find "Zar Dela Cruz" without dragging in every name that
// happens to contain those letters mid-word.
test('a surname is found at a word boundary, not only at the start', () => {
  const r = find('dela', [
    emp({ id: 'z', full_name: 'Zar Dela Cruz' }),
    emp({ id: 'x', full_name: 'Abdelahi Suron' }),
  ]);
  assert.equal(r[0].id, 'z', 'a word-start match must outrank a mid-word one');
  assert.deepEqual(r.map((h) => h.id).sort(), ['x', 'z'], 'both still match');
});

test('search is case and whitespace insensitive', () => {
  for (const q of ['ANTHONY', '  anthony  ', 'AnThOnY']) {
    assert.equal(find(q, [emp()])[0]?.id, 'e1', `"${q}" should find them`);
  }
});

// Department and position match in bulk — a hundred equally-good hits is the
// same as none — so they must never outrank a name.
test('a department match never outranks a name match', () => {
  const r = find('apparel', [
    emp({ id: 'dept', full_name: 'Nobody Here', department: 'Apparel' }),
    emp({ id: 'name', full_name: 'Apparel Santos', department: 'Admin' }),
  ]);
  assert.equal(r[0].id, 'name');
});

// ---- routes ----

test('pages are findable by title and by their subtitle', () => {
  assert.equal(find('muster', [])[0].route, 'muster');
  assert.equal(find('assembly point', [])[0].route, 'muster',
    'the subtitle is where someone looks for words they half-remember');
});

// Twelve routes against 814 people: a tie that buried the route would mean
// the route never surfaced at all.
test('at equal rank a page comes before a person', () => {
  // Both match as a name/title prefix and nothing else — the card code is
  // deliberately unrelated, or it would win on a stronger band and this
  // would not be testing the tiebreak at all.
  const r = find('aler', [emp({
    id: 'p', full_name: 'Alerts Person', employee_code: '2400', active_proximity_code: 'Z400',
  })]);
  assert.equal(r[0].kind, 'route');
  assert.equal(r[0].route, 'alerts');
});

// Fallout of treating a card prefix as a strong signal, documented rather
// than papered over: one letter is enough to put every badge beginning with
// it above the pages. It is the right trade at two characters and up, which
// is what anyone searching a badge number actually types.
test('a single letter favours badge codes over pages', () => {
  const r = find('a', [emp({ id: 'card', active_proximity_code: 'A400' })]);
  assert.equal(r[0].id, 'card');
  assert.equal(r[0].kind, 'employee');
});

// THE SECURITY-SHAPED ONE. The palette is handed the routes the account can
// actually reach; it must not invent others from ROUTE_TITLES.
test('it can only offer routes it was given', () => {
  const r = searchPalette({
    query: 'audit', employees: [], routes: ['directory', 'scanner'], titles: ROUTE_TITLES,
  });
  assert.deepEqual(r, [], 'a scanner-only kiosk must never be offered the audit log');
  const all = searchPalette({ query: '', employees: [], routes: ['scanner'], titles: ROUTE_TITLES });
  assert.deepEqual(all.map((x) => x.route), ['scanner']);
});

test('the component reads visibility from the rail, not from permissions', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../JS/Components/CommandPalette.js', import.meta.url)), 'utf8');
  assert.match(src, /classList\.contains\('hidden'\)/,
    'Core/screens.js already decides this; a second opinion is how they drift');
  assert.ok(!/canView|isAdmin/.test(src),
    're-deriving permissions here is exactly the duplication screens.js avoids');
});

// ---- bounds and junk ----

test('results are capped', () => {
  const many = Array.from({ length: 200 }, (_, i) => emp({ id: `e${i}`, full_name: `Alpha ${i}` }));
  assert.equal(find('alpha', many).length, MAX_RESULTS);
});

test('no match returns empty rather than everything', () => {
  assert.deepEqual(find('zzzzzz', [emp()]), []);
});

test('missing or malformed rows are skipped, not thrown on', () => {
  const r = find('anthony', [null, undefined, {}, { full_name: null }, emp()]);
  assert.equal(r.length, 1);
  for (const v of [null, undefined, 'nope', 42]) {
    assert.doesNotThrow(() => searchPalette({ query: 'x', employees: v, routes: [], titles: {} }));
  }
  assert.doesNotThrow(() => searchPalette());
});

test('a row with no name still renders with a label', () => {
  const r = find('2400', [{ id: 'x', employee_code: '2400' }]);
  assert.equal(r[0].label, 'Unnamed', 'a blank row must not produce "undefined" on screen');
});

// ---- keyboard ----

test('selection wraps at both ends', () => {
  assert.equal(moveSelection(0, -1, 5), 4, 'up from the first goes to the last');
  assert.equal(moveSelection(4, 1, 5), 0, 'down from the last goes to the first');
  assert.equal(moveSelection(2, 1, 5), 3);
  assert.equal(moveSelection(0, -1, 0), 0, 'an empty list must not produce NaN');
});

// ---- the move that made this possible ----

test('route titles have one definition, shared by the router and the palette', () => {
  assert.deepEqual(Object.keys(ROUTE_TITLES).sort(), [...GROUPED_ROUTES].sort(),
    'a route in the nav with no title, or a title with no route, is drift');
  const router = readFileSync(fileURLToPath(new URL('../JS/Core/router.js', import.meta.url)), 'utf8');
  assert.match(router, /const titles = ROUTE_TITLES;/,
    'the router must read the shared map, not keep a second copy');
  assert.ok(!/dashboard: \['Dashboard'/.test(router), 'the old inline copy must be gone');
});

test('the palette costs no request', () => {
  const src = readFileSync(fileURLToPath(new URL('../JS/Utils/paletteSearch.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); }).join('\n');
  assert.ok(!/supabase|fetch\(|Model\./.test(src));
  const comp = readFileSync(
    fileURLToPath(new URL('../JS/Components/CommandPalette.js', import.meta.url)), 'utf8');
  assert.ok(!/supabase|Model\./.test(comp),
    'it searches the copy the grid already loaded, which is also why it works offline');
});
