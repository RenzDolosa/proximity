// Utils/importPreview.js — what a bulk import will do, worked out before
// anything is sent.
//
// WHAT IT REPLACES. ImportModal's preview was the row count — "412 rows
// ready to import" — and the conflicts arrived afterwards as `skippedCount`
// in the result summary. The only way to learn that 24 codes were already
// issued was to issue the other 388 first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  previewImport, importableCount, previewSamples, SAMPLE_LIMIT,
} from '../JS/Utils/importPreview.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../JS/${p}`, import.meta.url)), 'utf8');
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const rows = (...codes) => codes.map((proximity_code) => ({ proximity_code }));
const run = (records, existing = [], validate) =>
  previewImport({ records, key: 'proximity_code', existing, validate });

// ---- the four buckets ----

test('a clean file is all new', () => {
  const r = run(rows('A1', 'A2', 'A3'));
  assert.equal(r.total, 3);
  assert.equal(r.fresh.length, 3);
  assert.equal(importableCount(r), 3);
});

test('codes already issued are separated from new ones', () => {
  const r = run(rows('A1', 'A2'), ['A2']);
  assert.deepEqual(r.fresh.map((f) => f.value), ['A1']);
  assert.deepEqual(r.alreadyExists.map((f) => f.value), ['A2']);
});

// A spreadsheet does not reliably preserve the case a card was issued in.
test('matching ignores case and surrounding whitespace', () => {
  const r = run(rows(' prx-1 '), ['PRX-1']);
  assert.equal(r.alreadyExists.length, 1);
  assert.equal(r.fresh.length, 0);
});

test('a code repeated inside the file is caught before it is sent twice', () => {
  const r = run(rows('A1', 'A1'));
  assert.equal(r.fresh.length, 1, 'the first occurrence is still importable');
  assert.equal(r.duplicateInFile.length, 1);
});

test('a blank key cannot be imported', () => {
  const r = run([{ proximity_code: '   ' }, {}]);
  assert.equal(r.malformed.length, 2);
  assert.match(r.malformed[0].reason, /blank/);
});

test('a caller-supplied rule can reject a row', () => {
  const r = run(rows('OK-1', 'nope'), [], (v) => (v.startsWith('OK') ? null : 'must start with OK'));
  assert.equal(r.fresh.length, 1);
  assert.equal(r.malformed[0].reason, 'must start with OK');
});

// ORDER MATTERS. Reporting a blank code as both malformed and a duplicate of
// the other blank code is technically true and useless.
test('each row is counted once, under the first category it meets', () => {
  const r = run([{ proximity_code: '' }, { proximity_code: '' }]);
  assert.equal(r.malformed.length, 2);
  assert.equal(r.duplicateInFile.length, 0);

  // Already-exists loses to duplicate-in-file: the second copy's problem is
  // the file, which is the one the operator can fix before re-importing.
  const r2 = run(rows('A1', 'A1'), ['A1']);
  assert.equal(r2.alreadyExists.length, 1);
  assert.equal(r2.duplicateInFile.length, 1);
  assert.equal(r2.fresh.length, 0);
});

// Off-by-one here sends someone to the wrong row of a 412-line file.
test('line numbers match what the operator sees in their spreadsheet', () => {
  const r = run(rows('A1', 'A2'));
  assert.equal(r.fresh[0].line, 2, 'row 1 of the data is line 2 of the file, after the header');
  assert.equal(r.fresh[1].line, 3);
});

test('malformed input produces an empty report rather than throwing', () => {
  for (const bad of [undefined, null, 'nope', 42]) {
    const r = previewImport({ records: bad, key: 'proximity_code' });
    assert.equal(r.total, 0);
    assert.equal(importableCount(r), 0);
  }
  assert.equal(importableCount(null), 0);
  assert.equal(importableCount({}), 0);
});

// ---- what gets shown ----
//
// A 412-row file with 400 problems does not need 400 lines on screen; it
// needs the first few and a count. The full detail still arrives in the
// result summary after the import runs.

test('samples are capped', () => {
  const many = rows(...Array.from({ length: 40 }, (_, i) => `DUP`));
  const s = previewSamples(run(many));
  assert.equal(s.duplicateInFile.length, SAMPLE_LIMIT);
  assert.ok(SAMPLE_LIMIT <= 10);
});

test('samples survive a missing report', () => {
  const s = previewSamples(null);
  assert.deepEqual(s, { malformed: [], duplicateInFile: [], alreadyExists: [] });
});

// ---- the wiring ----

const modal = code(read('Components/ImportModal.js'));
const prox = code(read('Features/Proximity/ProximityPage.js'));

// Employee Manager has no single key to check a row against, so it passes no
// preview and must keep the behaviour it has always had.
test('a caller with nothing to compare against keeps the old row count', () => {
  assert.match(modal, /if \(!preview\) \{/);
  // Not /rows? ready to import/: the source pluralises with a template
  // expression — `row${...} ready to import` — so the literal "row" and the
  // literal " ready" are never adjacent in the file.
  assert.match(modal, /ready to import/);
});

// A button that promises a number the preview did not show is how people
// stop trusting the preview.
test('the button says how many rows it will actually create', () => {
  assert.match(modal, /const willCreate = importableCount\(report\)/);
  assert.match(modal, /Import \$\{willCreate\.toLocaleString\(\)\}/);
  assert.match(modal, /runBtn\.disabled = willCreate === 0/);
  assert.match(modal, /'Nothing to import'/);
});

// The whole reason this is free: the page already holds every issued card to
// draw the table the import button sits on.
test('Proximity Cards previews against the cache it already has', () => {
  assert.match(prox, /preview: \{[\s\S]*?existing: cardsCache\.map\(\(c\) => c\.proximity_code\)/);
  assert.match(prox, /key: 'proximity_code'/);
  // One onImport, not two — an object literal with a repeated key silently
  // keeps the last one, so a stray duplicate is invisible at runtime.
  // Anchored on the title and bounded by length rather than by a closing
  // string: `reloadProximity));` also ends the openCardModal line ABOVE this
  // block, which made the slice run backwards and match nothing.
  const start = prox.indexOf("title: 'Import proximity cards'");
  assert.ok(start !== -1);
  const block = prox.slice(start, start + 900);
  assert.equal((block.match(/onImport:/g) || []).length, 1);
});
