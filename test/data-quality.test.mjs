// Utils/dataQuality.js — the Employee Manager scorecard.
//
// Two things carry the weight here: the counts have to be right on 814 real
// records, and the panel must not claim a check it cannot actually perform.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CHECKS, scoreDirectory, duplicateCodes, matchesCheck, SEVERITY_BADGE,
} from '../JS/Utils/dataQuality.js';

// Mirrors DIRECTORY_COLUMNS in EmployeesModel.js — the shape the page really
// holds, not a convenient subset.
const e = (over = {}) => ({
  id: 'e1', employee_code: '2301', full_name: 'Aldrin Alvaro',
  department: 'Apparel', position: 'Operator', email: 'a@x.test', phone: '0917',
  photo_url: 'https://drive/x', photo_file_id: 'f1', status: 'active',
  active_proximity_code: 'A1', proximity_card_active: true,
  proximity_card_id: 'c1', total_scans: 12, open_remarks: 0, ...over,
});

const countOf = (rows, id) => scoreDirectory(rows).issues.find((i) => i.id === id).count;

test('a clean record trips nothing', () => {
  const { issues, clean, total } = scoreDirectory([e()]);
  assert.equal(total, 1);
  assert.equal(clean, 1);
  assert.deepEqual(issues.filter((i) => i.count).map((i) => i.id), []);
});

// THE ONE WITH A PHYSICAL CONSEQUENCE. Everything else on the list is a tidy-
// up; this is a card that still opens a door for somebody who has left.
test('a leaver holding a live card is found, and ranked worst', () => {
  const rows = [e({ status: 'resigned', proximity_card_active: true })];
  assert.equal(countOf(rows, 'live_card_inactive_employee'), 1);
  const order = CHECKS.map((c) => c.id);
  assert.equal(order[0], 'live_card_inactive_employee',
    'the panel renders CHECKS in order, so severity has to be the order');
  assert.equal(CHECKS[0].severity, 'bad');
});

test('every employee status that is not active counts as inactive', () => {
  for (const status of ['inactive', 'suspended', 'resigned']) {
    assert.equal(countOf([e({ status, proximity_card_active: true })], 'live_card_inactive_employee'), 1,
      `${status} must not slip through`);
  }
  assert.equal(countOf([e({ status: 'active', proximity_card_active: true })], 'live_card_inactive_employee'), 0);
});

// A missing status is the DEFAULT-active case, same reading Utils/dashboard.js
// takes. Treating null as inactive would flag most of the roster.
test('a missing status reads as active, not as a leaver', () => {
  assert.equal(countOf([e({ status: null, proximity_card_active: true })], 'live_card_inactive_employee'), 0);
  assert.equal(countOf([e({ status: null, proximity_card_active: false })], 'active_employee_dead_card'), 1);
});

test('an active employee with a dead card is the mirror case', () => {
  assert.equal(countOf([e({ proximity_card_active: false })], 'active_employee_dead_card'), 1);
  assert.equal(countOf([e({ status: 'resigned', proximity_card_active: false })], 'active_employee_dead_card'), 0,
    'a leaver with a dead card is correct, not a problem');
});

// ---- duplicates ----

test('duplicate codes are matched case- and space-insensitively', () => {
  const rows = [
    e({ id: 'a', employee_code: 'A-101' }),
    e({ id: 'b', employee_code: ' a-101 ' }),
    e({ id: 'c', employee_code: 'A-102' }),
  ];
  assert.deepEqual([...duplicateCodes(rows)], ['a-101']);
  assert.equal(countOf(rows, 'duplicate_code'), 2, 'both sides of a duplicate are flagged');
});

// Otherwise every blank-coded record is "a duplicate" of every other, which
// buries the real collisions under noise.
test('blank codes are not duplicates of each other', () => {
  const rows = [e({ id: 'a', employee_code: '' }), e({ id: 'b', employee_code: null }),
    e({ id: 'c', employee_code: '   ' })];
  assert.equal(duplicateCodes(rows).size, 0);
  assert.equal(countOf(rows, 'duplicate_code'), 0);
});

// ---- blanks ----

test('null, empty and whitespace all read as blank', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(countOf([e({ photo_url: v })], 'no_photo'), 1);
    assert.equal(countOf([e({ department: v })], 'no_department'), 1);
  }
});

test('contact is missing only when BOTH email and phone are', () => {
  assert.equal(countOf([e({ email: '', phone: '' })], 'no_contact'), 1);
  assert.equal(countOf([e({ email: '', phone: '0917' })], 'no_contact'), 0);
  assert.equal(countOf([e({ email: 'a@x.test', phone: null })], 'no_contact'), 0);
});

test('never scanned counts only active people', () => {
  assert.equal(countOf([e({ total_scans: 0 })], 'never_scanned'), 1);
  assert.equal(countOf([e({ total_scans: null })], 'never_scanned'), 1);
  assert.equal(countOf([e({ total_scans: 0, status: 'resigned' })], 'never_scanned'), 0,
    'a leaver who never scanned is not an outstanding problem');
});

// ---- the headline ----

test('a record with several problems is one unclean record, not several', () => {
  // Distinct codes on purpose: the fixture's default code is shared, and the
  // duplicate check caught that before this assertion ever ran.
  const rows = [
    e({ id: 'bad', employee_code: '1', photo_url: null, department: '', email: '', phone: '' }),
    e({ id: 'ok', employee_code: '2' }),
  ];
  const { clean, total, issues } = scoreDirectory(rows);
  assert.equal(total, 2);
  assert.equal(clean, 1, 'the headline answers "how many records need a human"');
  const chipSum = issues.reduce((n, i) => n + i.count, 0);
  assert.equal(chipSum, 3, 'the chips deliberately sum higher — the panel says so');
});

test('an empty or junk directory scores zero rather than throwing', () => {
  for (const v of [[], null, undefined, 'nope']) {
    const s = scoreDirectory(v);
    assert.equal(s.total, 0);
    assert.equal(s.clean, 0);
    assert.equal(s.issues.length, CHECKS.length);
  }
});

// ---- the filter the chips drive ----

test('clicking a chip filters to exactly the rows it counted', () => {
  const rows = [
    e({ id: 'a', photo_url: null }),
    e({ id: 'b' }),
    e({ id: 'c', photo_url: '' }),
  ];
  const matched = rows.filter((r) => matchesCheck(r, 'no_photo', rows)).map((r) => r.id);
  assert.deepEqual(matched, ['a', 'c']);
  assert.equal(matched.length, countOf(rows, 'no_photo'),
    'the chip count and the filtered grid must never disagree');
});

test('the duplicate filter needs the whole set and still works through matchesCheck', () => {
  const rows = [e({ id: 'a', employee_code: 'X' }), e({ id: 'b', employee_code: 'x' }), e({ id: 'c', employee_code: 'Y' })];
  assert.deepEqual(rows.filter((r) => matchesCheck(r, 'duplicate_code', rows)).map((r) => r.id), ['a', 'b']);
});

test('an unknown check id filters nothing out rather than everything', () => {
  assert.equal(matchesCheck(e(), 'not_a_check', [e()]), true,
    'a stale id in state must not blank the grid');
});

test('every check has a badge class the stylesheet actually defines', () => {
  const css = readFileSync(fileURLToPath(new URL('../CSS/components.css', import.meta.url)), 'utf8');
  for (const c of CHECKS) {
    const cls = SEVERITY_BADGE[c.severity];
    assert.ok(cls, `${c.id} has severity "${c.severity}" with no badge class`);
    assert.ok(css.includes(`.badge.${cls}`), `.badge.${cls} is not defined in components.css`);
  }
});

// ---- cost, and the limit of what it can claim ----

test('the scorecard costs no request', () => {
  const src = readFileSync(fileURLToPath(new URL('../JS/Utils/dataQuality.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); }).join('\n');
  assert.ok(!/supabase|fetch\(|Model\./.test(src));
});

// employee_directory is `employees JOIN proximity_cards ON pc.id =
// e.proximity_card_id` — an INNER join, so an employee with no card is not in
// the payload at all. Claiming "active employee with no card" would be a
// number that is always zero for the wrong reason.
test('the uncomputable check is absent from the list and disclosed in the UI', () => {
  assert.ok(!CHECKS.some((c) => /no.?card|card.?missing|unissued/i.test(c.id + c.label)),
    'this grid cannot see employees without a card — do not claim to count them');
  const page = readFileSync(
    fileURLToPath(new URL('../JS/Features/Directory/DirectoryPage.js', import.meta.url)), 'utf8');
  assert.match(page, /no card at all are not visible here/i,
    'the blind spot has to be stated on screen, not just in a comment');
});

// Both narrow the same grid; leaving both on produces an empty table with no
// single control to switch off to explain it.
test('the quality filter and the unresolved toggle are mutually exclusive', () => {
  const page = readFileSync(
    fileURLToPath(new URL('../JS/Features/Directory/DirectoryPage.js', import.meta.url)), 'utf8');
  assert.match(page, /if \(unresolvedOnly\) qualityFilter = null;/);
  assert.match(page, /if \(qualityFilter\) unresolvedOnly = false;/);
});
