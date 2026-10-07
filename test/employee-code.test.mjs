import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identityKey, isResigned, currentCodeHolder, currentNameHolder, buildIdentityIndex,
} from '../JS/Utils/employeeCode.js';
import {
  EMPLOYEE_STATUSES, RELEASES_EMPLOYEE_CODE, releasesEmployeeCode,
  employeeStatusLabel, employeeStatusOptionsHTML,
} from '../JS/Utils/employeeStatus.js';

// Codes are recycled when staff leave, so uniqueness applies to CURRENT
// employees only — mirroring employees_employee_code_current_key, the partial
// unique index that enforces it. These tests pin the "current" part, because
// getting it wrong is silent in both directions: too strict and the XLSX import
// drops a re-hire with no message, too loose and two current employees share a
// code, which merges their scans.

const emp = (id, code, name, status = 'active') =>
  ({ id, employee_code: code, full_name: name, status });

const roster = [
  emp('1', 'E-100', 'Ana Cruz'),
  emp('2', 'E-200', 'Ben Lim', 'inactive'),
  emp('3', 'E-300', 'Cy Diaz', 'suspended'),
  emp('4', 'E-400', 'Maria Santos', 'resigned'),
];

test('only resigned counts as terminal — inactive and suspended still hold their code', () => {
  assert.equal(isResigned(roster[0]), false);
  assert.equal(isResigned(roster[1]), false); // inactive
  assert.equal(isResigned(roster[2]), false); // suspended
  assert.equal(isResigned(roster[3]), true);
});

// The rule the status pickers explain and the rule the import/modal enforce must
// be the same rule — they read one constant, and this pins that they agree.
test('the status that frees a code is defined once and matches what the pickers say', () => {
  assert.equal(RELEASES_EMPLOYEE_CODE, 'resigned');
  assert.equal(releasesEmployeeCode('resigned'), true);
  for (const held of ['active', 'inactive', 'suspended', '', null, undefined]) {
    assert.equal(releasesEmployeeCode(held), false);
    assert.equal(isResigned({ status: held }), false);
  }
  // Every status is offered, and the one that frees a code says so where it is
  // chosen rather than only in a doc.
  assert.equal(EMPLOYEE_STATUSES.length, 4);
  for (const s of EMPLOYEE_STATUSES) assert.ok(employeeStatusLabel(s).length > 0);
  assert.match(employeeStatusLabel(RELEASES_EMPLOYEE_CODE), /frees/i);
  assert.match(employeeStatusLabel('inactive'), /keeps/i);
  assert.match(employeeStatusLabel('suspended'), /keeps/i);
});

test('the options markup selects the current status and escapes nothing unexpected', () => {
  const html = employeeStatusOptionsHTML('suspended');
  assert.equal((html.match(/<option /g) || []).length, 4);
  assert.match(html, /value="suspended" selected/);
  assert.equal(/value="active" selected/.test(html), false);
  // An unknown status simply selects nothing rather than throwing or inventing
  // an option — a row saved before a status was retired must still open.
  assert.equal(/ selected/.test(employeeStatusOptionsHTML('retired-long-ago')), false);
});

test('comparison ignores case and surrounding whitespace', () => {
  assert.equal(identityKey('  E-100 '), 'e-100');
  assert.equal(identityKey(null), '');
  assert.equal(identityKey(undefined), '');
  assert.equal(identityKey(42), '42');
});

test('a code held by a current employee is taken, whatever their status', () => {
  assert.equal(currentCodeHolder(roster, 'E-100').id, '1');
  assert.equal(currentCodeHolder(roster, ' e-200 ').id, '2'); // inactive still holds it
  assert.equal(currentCodeHolder(roster, 'E-300').id, '3');   // suspended too
});

// The whole point of the change: this used to report "taken" and the import
// silently skipped the new hire.
test('a code whose only holder resigned is free to reuse', () => {
  assert.equal(currentCodeHolder(roster, 'E-400'), null);
  assert.equal(currentCodeHolder(roster, 'E-999'), null);
});

test('an employee does not collide with their own existing row', () => {
  assert.equal(currentCodeHolder(roster, 'E-100', '1'), null);
  assert.equal(currentCodeHolder(roster, 'E-100', '2').id, '1');
});

test('an empty code is never a collision', () => {
  assert.equal(currentCodeHolder(roster, ''), null);
  assert.equal(currentCodeHolder(roster, '   '), null);
  assert.equal(currentCodeHolder(roster, null), null);
});

// Re-hiring the same person is the common case now that codes are recycled, so
// a resigned person's name must not block their own return.
test('a resigned employee does not block a re-hire of the same name', () => {
  assert.equal(currentNameHolder(roster, 'Maria Santos'), null);
  assert.equal(currentNameHolder(roster, 'ana cruz').id, '1');
});

test('the index agrees with the one-off lookups', () => {
  const { codes, names, resignedCodes } = buildIdentityIndex(roster);
  assert.deepEqual([...codes.keys()].sort(), ['e-100', 'e-200', 'e-300']);
  assert.equal(codes.has('e-400'), false);
  assert.deepEqual([...names.keys()].sort(), ['ana cruz', 'ben lim', 'cy diaz']);
  // Resigned codes are tracked separately so the import can report a reuse
  // rather than pass it through silently — a typo that happens to match a
  // former employee's code would otherwise look like a normal insert.
  assert.equal(resignedCodes.get('e-400').full_name, 'Maria Santos');
});

// A code can be held by a resigned employee AND a current one: the resigned row
// keeps its code, and somebody current was issued the same code afterwards.
// "Taken" has to win, or the import would offer it for reuse a second time.
test('a code held by both a current and a resigned employee is taken', () => {
  const overlap = [emp('4', 'E-400', 'Maria Santos', 'resigned'), emp('5', 'E-400', 'New Hire')];
  assert.equal(currentCodeHolder(overlap, 'E-400').id, '5');
  const { codes, resignedCodes } = buildIdentityIndex(overlap);
  assert.equal(codes.get('e-400').id, '5');
  assert.equal(resignedCodes.has('e-400'), true);
});

test('an empty or missing roster collides with nothing', () => {
  for (const empty of [[], null, undefined]) {
    assert.equal(currentCodeHolder(empty, 'E-100'), null);
    assert.equal(currentNameHolder(empty, 'Ana Cruz'), null);
  }
  const { codes, names, resignedCodes } = buildIdentityIndex(null);
  assert.equal(codes.size + names.size + resignedCodes.size, 0);
});
