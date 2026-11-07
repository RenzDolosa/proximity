import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAccountable, certainty, siteOf, groupForMuster, musterTotals,
  snapshotAge, SNAPSHOT_WARN_MS, scannerOrder,
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

// REPLACED "sites are ordered by how many people are in them" (2026-11-07).
//
// That rule had a real argument — the biggest sheet is the one somebody needs
// handed to them first — but it assumed a single scrolling column, where
// position meant priority. MusterPage now lays sites out three across, so
// every site is on screen at once and position means LOCATION instead: a
// marshal should find the same scanner in the same cell at every drill.
// Headcount order moves a scanner the moment headcounts shift.
//
// Worth knowing: the old test would still pass against the new code, because
// its fixtures were named 'Big' and 'Small' and B sorts before S. It asserted
// an order the code no longer produces and agreed anyway.
test('sites fill the grid in scanner order, not headcount order', () => {
  // Scanner 3 is deliberately the busiest: under the old rule it took cell 1.
  const rows = [
    p({ id: 'a', last_scanner_id: 'Krus3K - Scanner 3' }),
    p({ id: 'b', last_scanner_id: 'Krus3K - Scanner 3' }),
    p({ id: 'c', last_scanner_id: 'Krus3K - Scanner 3' }),
    p({ id: 'd', last_scanner_id: 'Krus3K - Scanner 1' }),
    p({ id: 'e', last_scanner_id: 'Krus3K - Scanner 2' }),
  ];
  const groups = groupForMuster(rows);
  assert.deepEqual(groups.map((g) => g.site),
    ['Krus3K - Scanner 1', 'Krus3K - Scanner 2', 'Krus3K - Scanner 3']);
  // Counts ascending is the proof: headcount is not what decides position.
  assert.deepEqual(groups.map((g) => g.count), [1, 1, 3]);
});

test('scanner 10 sorts after scanner 9, not between 1 and 2', () => {
  const sites = ['S 10', 'S 2', 'S 1', 'S 9'];
  assert.deepEqual(sites.slice().sort(scannerOrder), ['S 1', 'S 2', 'S 9', 'S 10'],
    'a string sort would read 10 as "1","0" and put it second');
});

// Two buildings that each have a Scanner 1 must not interleave — a marshal
// reading the left column should be reading one site, not alternating.
test('scanners stay grouped by the site they belong to', () => {
  const sites = ['Beta - Scanner 1', 'Alpha - Scanner 2', 'Beta - Scanner 2', 'Alpha - Scanner 1'];
  assert.deepEqual(sites.slice().sort(scannerOrder),
    ['Alpha - Scanner 1', 'Alpha - Scanner 2', 'Beta - Scanner 1', 'Beta - Scanner 2']);
});

// siteOf() falls back to 'Unknown scanner' for a row with no scanner id, and
// those people are exactly the ones most at risk of being missed. Cell 1 is
// where the eye lands, and it belongs to a real scanner.
test('"Unknown scanner" never takes the first cell', () => {
  const sites = ['Unknown scanner', 'Krus3K - Scanner 2', 'Krus3K - Scanner 1'];
  assert.deepEqual(sites.slice().sort(scannerOrder),
    ['Krus3K - Scanner 1', 'Krus3K - Scanner 2', 'Unknown scanner']);
});

test('ordering is total and stable for junk input', () => {
  for (const pair of [[null, 'S 1'], [undefined, null], ['', 'S 1'], ['S 1', 'S 1']]) {
    const [a, b] = pair;
    assert.equal(typeof scannerOrder(a, b), 'number');
    // `| 0` because Math.sign(0) is 0 and -Math.sign(0) is -0, and strict
    // equality uses Object.is, under which those two are not equal.
    assert.equal(Math.sign(scannerOrder(a, b)) | 0, -Math.sign(scannerOrder(b, a)) | 0,
      'an inconsistent comparator makes Array.sort order undefined');
  }
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
