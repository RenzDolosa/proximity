import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRosterDelta, deriveRoster, deriveRosterRow, summarizeRoster } from '../JS/Utils/dashboard.js';

// get_onsite_roster_delta + the client half of it. This is the fix for the
// single largest egress consumer in the project: the Dashboard was
// re-downloading the whole on-site roster every 30 seconds per open tab,
// because `roster_version` changes on every matched scan (the scan_logs trigger
// bumps employees.updated_at) and so could never report "nothing changed"
// during a working shift.
//
// Everything below is the part that has to be right for a delta to be
// trustworthy. A merge bug here does not look like a crash — it looks like the
// Dashboard quietly disagreeing with reality for ten minutes until the next
// full resync papers over it.

const HOUR = 3600 * 1000;
const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const at = (hoursAgo) => new Date(NOW - hoursAgo * HOUR).toISOString();

const row = (id, overrides = {}) => ({
  id,
  full_name: `Employee ${id}`,
  employee_code: `E${id}`,
  department: 'Ops',
  status: 'active',
  last_in_at: at(1),
  last_scanner_id: 'gate-1',
  on_roster: true,
  ...overrides,
});

test('a full sync replaces the roster rather than merging into it', () => {
  const current = [row('a'), row('b')];
  const merged = mergeRosterDelta(current, { full: true, rows: [row('c')] });
  assert.deepEqual(merged.map((r) => r.id), ['c']);
});

test('an incremental delta upserts the rows it carries and leaves the rest alone', () => {
  const current = [row('a', { last_in_at: at(3) }), row('b', { last_in_at: at(2) })];
  const merged = mergeRosterDelta(current, {
    full: false,
    rows: [row('b', { last_in_at: at(2), department: 'HR' }), row('c', { last_in_at: at(1) })],
  });
  assert.deepEqual(merged.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(merged.find((r) => r.id === 'b').department, 'HR'); // updated in place
  assert.equal(merged.find((r) => r.id === 'a').department, 'Ops'); // untouched
});

// The whole reason the RPC returns changed employees who are NOT on the roster.
// Someone who scans OUT does not arrive as a "deleted" row — they simply stop
// satisfying the roster predicate, which a timestamp cursor can never observe.
// Without on_roster:false they would stay on the Dashboard until the next full
// resync, i.e. the page would claim people are on site who have gone home.
test('on_roster false removes someone who has scanned out', () => {
  const current = [row('a'), row('b')];
  const merged = mergeRosterDelta(current, {
    full: false,
    rows: [row('a', { on_roster: false })],
  });
  assert.deepEqual(merged.map((r) => r.id), ['b']);
});

test('removing someone the client never had is not an error', () => {
  const merged = mergeRosterDelta([row('a')], { full: false, rows: [row('zz', { on_roster: false })] });
  assert.deepEqual(merged.map((r) => r.id), ['a']);
});

// The one-minute cursor lag deliberately re-sends rows the client already has,
// so the same row arriving twice must be idempotent rather than duplicated.
test('the cursor overlap re-sending a row does not duplicate it', () => {
  const d = { full: false, rows: [row('a')] };
  const once = mergeRosterDelta([row('a')], d);
  const twice = mergeRosterDelta(once, d);
  assert.equal(once.length, 1);
  assert.deepEqual(twice, once);
});

// Full-sync order is oldest IN first (what the table expects). A row that
// arrives through a delta has to land where a full resync would have put it,
// or the table's order would depend on sync history rather than on the data.
test('merged rows sort oldest IN first, matching a full sync', () => {
  const merged = mergeRosterDelta(
    [row('a', { last_in_at: at(1) }), row('c', { last_in_at: at(3) })],
    { full: false, rows: [row('b', { last_in_at: at(2) })] },
  );
  assert.deepEqual(merged.map((r) => r.id), ['c', 'b', 'a']);
});

test('a malformed or empty delta leaves the roster untouched', () => {
  const current = [row('a')];
  assert.deepEqual(mergeRosterDelta(current, { full: false, rows: [] }), current);
  assert.deepEqual(mergeRosterDelta(current, {}), current);
  assert.deepEqual(mergeRosterDelta(current, null), current);
  assert.deepEqual(mergeRosterDelta(null, null), []);
});

// ---- the clock-derived fields ----

// These used to come from the server, which is what forced an unconditional
// refetch every 5 minutes: is_stale flips with nothing but the passage of time,
// and no data version can observe a clock. Deriving them removes that refetch
// entirely.
test('seconds on site is measured from last_in_at, not sent by the server', () => {
  const r = deriveRosterRow(row('a', { last_in_at: at(2) }), NOW, 16);
  assert.equal(r.seconds_on_site, 2 * 3600);
  assert.equal(r.is_stale, false);
});

test('is_stale flips purely with the clock, at the window the server named', () => {
  const justUnder = deriveRosterRow(row('a', { last_in_at: at(15.9) }), NOW, 16);
  const justOver = deriveRosterRow(row('a', { last_in_at: at(16.1) }), NOW, 16);
  assert.equal(justUnder.is_stale, false);
  assert.equal(justOver.is_stale, true);
  // A different window from the server means a different answer for the same
  // row — which is the point of returning stale_hours instead of hard-coding it.
  assert.equal(deriveRosterRow(row('a', { last_in_at: at(15.9) }), NOW, 8).is_stale, true);
});

// A server-computed is_stale arriving on the legacy get_onsite_roster path must
// not win over the derived one, or the two code paths would disagree about who
// has gone home.
test('a stale flag sent by the server is recomputed, not trusted', () => {
  const r = deriveRosterRow(row('a', { last_in_at: at(1), is_stale: true }), NOW, 16);
  assert.equal(r.is_stale, false);
});

test('a clock skewed into the future reads as zero, never negative', () => {
  const r = deriveRosterRow(row('a', { last_in_at: at(-1) }), NOW, 16);
  assert.equal(r.seconds_on_site, 0);
});

// "—" is the truth for a row with no usable IN time; 0 would read as "arrived
// just now", which is a specific and wrong claim.
test('an unparseable IN time yields no duration rather than zero', () => {
  for (const bad of [null, undefined, '', 'not-a-date']) {
    const r = deriveRosterRow(row('a', { last_in_at: bad }), NOW, 16);
    assert.equal(r.seconds_on_site, null);
    assert.equal(r.is_stale, false);
  }
});

test('deriving a roster leaves the stored rows unmutated', () => {
  const stored = [row('a', { last_in_at: at(2) })];
  const derived = deriveRoster(stored, NOW, 16);
  assert.equal(derived[0].seconds_on_site, 2 * 3600);
  assert.equal('seconds_on_site' in stored[0], false);
});

// The headline "On site" / "Possibly left" split reads is_stale, so it only
// agrees with the table if both run over the same derived rows.
test('the headline counts follow the derived flags', () => {
  const rows = deriveRoster([
    row('a', { last_in_at: at(1) }),
    row('b', { last_in_at: at(20) }),
    row('c', { last_in_at: at(1), status: 'inactive' }),
  ], NOW, 16);
  const s = summarizeRoster(rows);
  assert.equal(s.live, 1);   // a
  assert.equal(s.stale, 1);  // b, old IN
  assert.equal(s.total, 3);  // c counted in total but never in a headline
});
