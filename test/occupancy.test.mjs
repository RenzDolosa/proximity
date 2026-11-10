// Utils/occupancy.js — the Dashboard's "On site by scanner" board.
//
// The board sits directly under the "On site" and "Possibly left" cards, so
// the thing most worth testing is that it counts the SAME way they do. A
// board that quietly disagreed with the number above it would be worse than
// no board.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  occupancyByScanner, occupancyTotals, longestOnSite, seconds,
} from '../JS/Utils/occupancy.js';
import { summarizeRoster, deriveRoster } from '../JS/Utils/dashboard.js';

const p = (over = {}) => ({
  id: 'p1', full_name: 'A-Jay Boncay', employee_code: '3522',
  last_in_at: '2026-11-07T01:00:00.000Z', last_scanner_id: 'Krus3K - Scanner 1',
  status: 'active', is_stale: false, seconds_on_site: 3600, ...over,
});

test('people are grouped by the door they came in by', () => {
  const g = occupancyByScanner([
    p({ id: 'a' }), p({ id: 'b' }),
    p({ id: 'c', last_scanner_id: 'Krus3K - Scanner 2' }),
  ]);
  assert.deepEqual(g.map((x) => [x.site, x.total]), [
    ['Krus3K - Scanner 1', 2], ['Krus3K - Scanner 2', 1],
  ]);
});

// THE ONE THAT MATTERS. Utils/dashboard.js counts only ACTIVE employees as
// on site, and splits them on is_stale. If this drifts, two numbers on the
// same screen disagree.
test('live and stale are split exactly as the cards above split them', () => {
  const rows = [
    p({ id: 'a' }),
    p({ id: 'b', is_stale: true }),
    p({ id: 'c', status: 'inactive' }),
    p({ id: 'd', status: 'suspended', is_stale: true }),
  ];
  const [g] = occupancyByScanner(rows);
  const sum = summarizeRoster(rows);
  assert.equal(g.live, sum.live, 'live must match the "On site" card');
  assert.equal(g.stale, sum.stale, 'stale must match the "Possibly left" card');
  assert.equal(g.other, 2, 'inactive and suspended are neither, but are still inside');
  assert.equal(g.live + g.stale + g.other, g.total, 'every row lands in exactly one bucket');
});

test('somebody with no IN at all is not standing anywhere', () => {
  const g = occupancyByScanner([p({ id: 'a' }), p({ id: 'b', last_in_at: null })]);
  assert.equal(occupancyTotals(g).total, 1);
});

test('a missing scanner id gets a group rather than vanishing', () => {
  const g = occupancyByScanner([p({ last_scanner_id: null })]);
  assert.equal(g[0].site, 'Unknown scanner',
    'the people hardest to locate must not be the ones silently dropped');
});

// ---- the bars ----

test('bars are relative to the busiest scanner, not to the total', () => {
  const g = occupancyByScanner([
    ...Array.from({ length: 8 }, (_, i) => p({ id: `a${i}` })),
    ...Array.from({ length: 2 }, (_, i) => p({ id: `b${i}`, last_scanner_id: 'Krus3K - Scanner 2' })),
  ]);
  assert.equal(g[0].share, 1, 'the busiest door is always full width');
  assert.equal(g[1].share, 0.25, '2 of 8, not 2 of 10');
});

test('an empty roster produces no groups and no division by zero', () => {
  for (const v of [[], null, undefined, 'nope']) {
    const g = occupancyByScanner(v);
    assert.deepEqual(g, []);
    assert.deepEqual(occupancyTotals(g), { scanners: 0, total: 0, live: 0, stale: 0, other: 0 });
  }
});

// ---- longest on site ----

test('the longest IN is the one most likely to be a forgotten badge-out', () => {
  const best = longestOnSite([
    p({ id: 'a', seconds_on_site: 3600 }),
    p({ id: 'b', seconds_on_site: 280800 }),
    p({ id: 'c', seconds_on_site: 7200 }),
  ]);
  assert.equal(best.id, 'b');
});

// deriveRosterRow() returns seconds_on_site: null when last_in_at cannot be
// parsed. Treating that as 0 would rank it as "just arrived" — a specific
// claim, and the wrong one.
test('an unknown duration never wins and never reads as zero', () => {
  const best = longestOnSite([
    p({ id: 'a', seconds_on_site: null }),
    p({ id: 'b', seconds_on_site: 60 }),
  ]);
  assert.equal(best.id, 'b');
  assert.equal(longestOnSite([p({ id: 'a', seconds_on_site: null })]), null,
    'nothing measurable means no claim, not a placeholder');
  assert.equal(longestOnSite([]), null);
});

// Number(null), Number('') and Number([]) are all 0, and 0 is finite — so a
// plain Number() coercion let unknown durations through as "just arrived".
// That is the bug behind the two failures this file caught on first run.
test('only a real number counts as a duration', () => {
  assert.equal(seconds(3600), 3600);
  assert.equal(seconds(0), 0);
  for (const v of [null, undefined, '', [], '3600', NaN, {}]) {
    assert.ok(Number.isNaN(seconds(v)), `${JSON.stringify(v)} must not read as a duration`);
  }
});

// This module deliberately exports no formatter — Utils/attendance.js owns
// fmtDuration and the Dashboard's own table uses it right below the board.
test('there is exactly one duration formatter in the app', () => {
  const src = readFileSync(fileURLToPath(new URL('../JS/Utils/occupancy.js', import.meta.url)), 'utf8');
  assert.ok(!/export function fmtDuration/.test(src),
    'a second formatter put "3d 6h" in the board and "78h 00m" in the table below it');
  const page = readFileSync(
    fileURLToPath(new URL('../JS/Features/Dashboard/DashboardPage.js', import.meta.url)), 'utf8');
  assert.match(page, /import \{ fmtDuration \} from '\.\.\/\.\.\/Utils\/attendance\.js'/);
});

// ---- it must stay free ----

test('the board costs no request', () => {
  const src = readFileSync(fileURLToPath(new URL('../JS/Utils/occupancy.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); }).join('\n');
  assert.ok(!/supabase|fetch\(|Model\./.test(src),
    'the moment this needs its own query it stops being worth having');
});

test('it reads the roster the Dashboard already holds, nothing new', () => {
  const page = readFileSync(
    fileURLToPath(new URL('../JS/Features/Dashboard/DashboardPage.js', import.meta.url)), 'utf8');
  assert.match(page, /occupancyHTML\(derived\)/,
    'it must be fed derivedRoster(), not a fetch of its own');
  const between = page.slice(page.indexOf('function occupancyHTML'), page.indexOf('function derivedRoster'));
  assert.ok(!/await|supabase|Model\./.test(between), 'occupancyHTML must not reach the network');
});

// siteOf() is shared with Muster so both screens name a door the same way.
test('scanner naming is shared with the muster list, not reimplemented', () => {
  const src = readFileSync(fileURLToPath(new URL('../JS/Utils/occupancy.js', import.meta.url)), 'utf8');
  assert.match(src, /import \{ siteOf \} from '\.\/muster\.js'/,
    'two definitions of "which scanner is this" would drift');
});

// The board's order has to agree with Muster's grid, or the same six doors
// appear in two different orders on two screens.
test('scanner order matches the muster grid for the live naming scheme', () => {
  const names = ['Krus3K - Scanner 3', 'Krus3K - Scanner 1', 'Krus3K - Scanner 10', 'Krus3K - Scanner 2'];
  const board = occupancyByScanner(names.map((n, i) => p({ id: `x${i}`, last_scanner_id: n })))
    .map((g) => g.site);
  assert.deepEqual(board, [
    'Krus3K - Scanner 1', 'Krus3K - Scanner 2', 'Krus3K - Scanner 3', 'Krus3K - Scanner 10',
  ], 'numeric collation, so Scanner 10 sorts after 9 rather than after 1');
});

// deriveRoster attaches seconds_on_site/is_stale at paint time; the board is
// fed its output, so it must survive that exact shape.
test('it works on deriveRoster output, which is what it is actually given', () => {
  const now = Date.parse('2026-11-07T12:00:00.000Z');
  const derived = deriveRoster([
    { id: 'a', full_name: 'X', last_in_at: '2026-11-07T11:00:00.000Z', last_scanner_id: 'S 1', status: 'active' },
    { id: 'b', full_name: 'Y', last_in_at: '2026-11-05T01:00:00.000Z', last_scanner_id: 'S 1', status: 'active' },
  ], now, 16);
  const [g] = occupancyByScanner(derived);
  assert.equal(g.total, 2);
  assert.equal(g.live, 1);
  assert.equal(g.stale, 1, 'a two-day-old IN is past the 16h stale window');
  assert.equal(longestOnSite(derived).id, 'b');
});
