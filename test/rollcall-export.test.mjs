// The muster roll call as a record, and the page size that finally sticks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rollCallRows } from '../JS/Utils/muster.js';
import { PAGE_SIZES } from '../JS/Components/Pagination.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../JS/${p}`, import.meta.url)), 'utf8');
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const page = code(read('Features/Muster/MusterPage.js'));
const pagination = code(read('Components/Pagination.js'));

const groups = [{
  site: 'Scanner 1',
  departments: [{
    department: 'QC',
    people: [
      { id: 'a', full_name: 'Tricia De Leon', employee_code: '5585', last_in_at: '2026-11-12T01:02:00Z' },
      { id: 'b', full_name: 'Danilo Reyes', employee_code: '5586', last_in_at: '2026-11-12T01:04:00Z' },
    ],
  }],
}];

// ---- the sheet ----

test('every person on the sheet appears, with their state', () => {
  const rows = rollCallRows(groups, new Set(['a']));
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.full_name === 'Tricia De Leon').accounted, 'yes');
  assert.equal(rows.find((r) => r.full_name === 'Danilo Reyes').accounted, 'NOT ACCOUNTED');
});

// A roll call is read to find who is MISSING. Burying four names among three
// hundred ticked ones is the one layout that defeats the purpose.
test('not-accounted sorts first', () => {
  const rows = rollCallRows(groups, new Set(['a']));
  assert.equal(rows[0].accounted, 'NOT ACCOUNTED');
});

test('typed-in people come last, under their own label', () => {
  const rows = rollCallRows(groups, new Set(['a', 'unlisted:1']), [
    { id: 'unlisted:1', label: 'contractor — 2 men' },
  ]);
  const last = rows[rows.length - 1];
  assert.equal(last.full_name, 'contractor — 2 men');
  assert.equal(last.site, 'Added at the assembly point');
  assert.equal(last.source, 'added by marshal');
  assert.equal(last.accounted, 'yes');
});

test('an unticked typed-in person is reported as missing too', () => {
  const rows = rollCallRows([], new Set(), [{ id: 'u1', label: 'visitor' }]);
  assert.equal(rows[0].accounted, 'NOT ACCOUNTED');
});

test('an array of ids works as well as a Set', () => {
  assert.equal(rollCallRows(groups, ['a'])[1].accounted, 'yes');
});

test('malformed input produces no rows rather than throwing', () => {
  for (const bad of [null, undefined, 'nope', 42]) {
    assert.deepEqual(rollCallRows(bad, new Set()), []);
  }
  assert.deepEqual(rollCallRows([{ site: 'x' }], new Set()), [], 'a site with no departments');
});

// ---- the button ----

// A search left in the box must not quietly export a subset and have it read
// as the whole headcount.
test('the export is built from the unfiltered grouping', () => {
  assert.match(page, /rollCallRows\(allGroups, accounted, unlisted\)/);
  assert.ok(!/rollCallRows\(groups/.test(page),
    '`groups` is the filtered set — exporting it would understate the roster');
});

test('an all-digit employee code survives Excel', () => {
  const block = page.slice(page.indexOf('function exportRollCall'));
  assert.match(block, /key: 'employee_code', label: 'Employee code', text: true/);
});

test('the export says how many are still missing', () => {
  const block = page.slice(page.indexOf('function exportRollCall'));
  assert.match(block, /not accounted for/);
  assert.match(block, /Nothing to export yet/, 'a device with no roster must say so, not emit an empty file');
});

// ---- the page size ----

test('a remembered size must be one the control can display', () => {
  assert.match(pagination, /PAGE_SIZES\.includes\(stored\) \? stored : fallback/,
    'a stale or hand-edited key would otherwise leave the select showing nothing');
  assert.match(pagination, /export function readPageSize/);
});

test('nothing is stored unless the table asked to be remembered', () => {
  assert.match(pagination, /if \(storeAs\) writePageSize\(storeAs, next\)/);
});

// 100 rows is right for scanning a week of attendance and wrong for the
// audit log, so one key each rather than one shared setting.
test('every paginated table remembers its own size', () => {
  const tables = [
    ['Features/Dashboard/DashboardPage.js', 'dashboard'],
    ['Features/Audit/AuditLogPage.js', 'audit'],
    ['Features/Attendance/AttendancePage.js', 'attendance'],
    ['Features/Users/UsersPage.js', 'users'],
    ['Features/Directory/DirectoryPage.js', 'directory'],
    ['Features/Proximity/ProximityPage.js', 'proximity'],
  ];
  const names = new Set();
  for (const [file, name] of tables) {
    const src = code(read(file));
    assert.match(src, new RegExp(`readPageSize\\('${name}'`), `${file} must restore its size`);
    assert.match(src, new RegExp(`storeAs: '${name}'`), `${file} must store it`);
    assert.equal(names.has(name), false, `${name} is used by two tables`);
    names.add(name);
  }
  assert.equal(names.size, 6);
});

test('the defaults each table falls back to are offered by the control', () => {
  for (const file of ['Features/Users/UsersPage.js', 'Features/Attendance/AttendancePage.js']) {
    const fallback = Number(code(read(file)).match(/readPageSize\('\w+', (\d+)\)/)[1]);
    assert.ok(PAGE_SIZES.includes(fallback), `${file} falls back to ${fallback}, which is not selectable`);
  }
});
