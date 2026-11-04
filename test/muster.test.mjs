import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAccountable, certainty, siteOf, groupForMuster, musterTotals,
  snapshotAge, SNAPSHOT_WARN_MS,
} from '../JS/Utils/muster.js';
import { toSnapshotRows } from '../JS/Utils/musterCache.js';

// The failure mode here is not a wrong number on a screen. It is a person
// left inside a building because a list said they had gone. Every rule below
// is biased the same way: when it is unclear, the name stays on the sheet.

const p = (over = {}) => ({
  id: 'p1', full_name: 'A-Jay Boncay', employee_code: '3522',
  department: 'Kleenfant', last_in_at: '2026-11-03T00:43:00.000Z',
  last_scanner_id: 'Krus4K - Scanner 2', status: 'active', is_stale: false,
  ...over,
});

test('nobody is dropped for being stale, inactive or suspended', () => {
  // A stale IN means UNKNOWN, not gone. An inactive employee standing in the
  // building is still a body to find. Employment status is an HR question;
  // evacuation is not.
  assert.equal(isAccountable(p({ is_stale: true })), true);
  assert.equal(isAccountable(p({ status: 'inactive' })), true);
  assert.equal(isAccountable(p({ status: 'suspended' })), true);
  // Only someone with no IN at all is genuinely not on the list.
  assert.equal(isAccountable(p({ last_in_at: null })), false);
  assert.equal(isAccountable(null), false);
});

test('an uncertain row is marked, not hidden', () => {
  assert.equal(certainty(p({ is_stale: true })), 'unsure');
  assert.equal(certainty(p()), 'likely');
  const groups = groupForMuster([p({ is_stale: true }), p({ id: 'p2' })]);
  assert.equal(groups[0].count, 2, 'both are counted');
  assert.equal(groups[0].unsure, 1, 'and the uncertain one is flagged');
});

test('a missing scanner or department still gets a group', () => {
  // A row that cannot be filed must not vanish into a group nobody prints.
  assert.equal(siteOf(p({ last_scanner_id: null })), 'Unknown scanner');
  assert.equal(siteOf(p({ last_scanner_id: '   ' })), 'Unknown scanner');
  const groups = groupForMuster([p({ last_scanner_id: null, department: '' })]);
  assert.equal(groups[0].site, 'Unknown scanner');
  assert.equal(groups[0].departments[0].department, 'No department');
  assert.equal(groups[0].count, 1);
});

test('sites are ordered by how many people are in them', () => {
  // The biggest sheet is the one somebody needs handed to them first.
  const rows = [
    p({ id: 'a', last_scanner_id: 'Small' }),
    p({ id: 'b', last_scanner_id: 'Big' }),
    p({ id: 'c', last_scanner_id: 'Big' }),
    p({ id: 'd', last_scanner_id: 'Big' }),
  ];
  assert.deepEqual(groupForMuster(rows).map((g) => g.site), ['Big', 'Small']);
});

test('people are sorted by name so two printouts match', () => {
  const rows = [
    p({ id: '1', full_name: 'Zar Dela Cruz' }),
    p({ id: '2', full_name: 'Abdhulah Saro' }),
    p({ id: '3', full_name: 'Fe Damgo' }),
  ];
  const people = groupForMuster(rows)[0].departments[0].people;
  assert.deepEqual(people.map((x) => x.full_name), ['Abdhulah Saro', 'Fe Damgo', 'Zar Dela Cruz']);
});

test('totals count every person exactly once across sites', () => {
  const rows = [
    p({ id: 'a', last_scanner_id: 'S1', department: 'X' }),
    p({ id: 'b', last_scanner_id: 'S1', department: 'Y', is_stale: true }),
    p({ id: 'c', last_scanner_id: 'S2', department: 'X' }),
  ];
  const totals = musterTotals(groupForMuster(rows));
  assert.deepEqual(totals, { sites: 2, people: 3, unsure: 1 });
  assert.deepEqual(musterTotals([]), { sites: 0, people: 0, unsure: 0 });
  assert.deepEqual(musterTotals(null), { sites: 0, people: 0, unsure: 0 });
});

test('the snapshot age is always stated, even when it cannot be read', () => {
  // Showing a stale list is right during an evacuation. Showing one without
  // saying how old it is, is not.
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);
  assert.equal(snapshotAge(new Date(now - 30_000).toISOString(), now).text, 'seconds ago');
  assert.equal(snapshotAge(new Date(now - 5 * 60_000).toISOString(), now).text, '5 min ago');
  assert.equal(snapshotAge(new Date(now - 90 * 60_000).toISOString(), now).text, '1h 30m ago');

  assert.equal(snapshotAge(new Date(now - SNAPSHOT_WARN_MS - 1000).toISOString(), now).stale, true);
  assert.equal(snapshotAge(new Date(now - 60_000).toISOString(), now).stale, false);

  const unknown = snapshotAge(null, now);
  assert.equal(unknown.known, false);
  assert.equal(unknown.stale, true, 'an unreadable age must read as stale, never as fresh');
});

test('the stored snapshot keeps what the sheet needs and nothing more', () => {
  const rows = toSnapshotRows([{ ...p(), seconds_on_site: 9999, on_roster: true, secret: 'x' }]);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    'department', 'employee_code', 'full_name', 'id',
    'last_in_at', 'last_scanner_id', 'status',
  ]);
  assert.deepEqual(toSnapshotRows(null), []);
});
