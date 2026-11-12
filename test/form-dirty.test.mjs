// Utils/formDirty.js and the guard it feeds.
//
// openModal() closes on any click landing on the backdrop, and there was no
// dirty check anywhere in the app — so a click aimed at a field and landing
// an inch outside discarded a half-filled employee record silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fieldMap, isDirty } from '../JS/Utils/formDirty.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../JS/${p}`, import.meta.url)), 'utf8');
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const modal = code(read('Components/Modal.js'));
const guard = code(read('Components/unsavedGuard.js'));
const dirty = code(read('Utils/formDirty.js'));

// ---- the comparison ----

test('an untouched form is clean', () => {
  const before = fieldMap([['name', 'Tricia'], ['dept', 'QC']]);
  assert.equal(isDirty(before, [['name', 'Tricia'], ['dept', 'QC']]), false);
});

test('a changed value is dirty', () => {
  const before = fieldMap([['name', 'Tricia']]);
  assert.equal(isDirty(before, [['name', 'Tricia De Leon']]), true);
});

test('clearing a field is dirty', () => {
  assert.equal(isDirty(fieldMap([['name', 'Tricia']]), [['name', '']]), true);
});

// THE BUG THIS SHAPE EXISTS FOR. RemarksModal paints its textarea into the
// body once the remarks have loaded — after the snapshot. A whole-string
// comparison called that a change, so closing a dialog you had only looked
// at asked whether you wanted to discard your work.
test('a field that appears after the snapshot is clean while it is empty', () => {
  const before = fieldMap([['search', '']]);
  assert.equal(isDirty(before, [['search', ''], ['remark-input', '']]), false,
    'a control that did not exist yet is measured against an empty baseline');
});

test('…and dirty the moment it is typed into', () => {
  const before = fieldMap([['search', '']]);
  assert.equal(isDirty(before, [['search', ''], ['remark-input', 'card is damaged']]), true,
    'the late-rendered textarea is the MAIN input of that dialog — it must '
    + 'still be protected');
});

// A control that has since been removed cannot hold unsaved work.
test('a field that disappeared does not count as a change', () => {
  const before = fieldMap([['name', 'Tricia'], ['tmp', 'x']]);
  assert.equal(isDirty(before, [['name', 'Tricia']]), false);
});

test('missing and malformed input does not throw', () => {
  assert.equal(isDirty(null, null), false);
  assert.equal(isDirty(undefined, []), false);
  assert.equal(isDirty(fieldMap([]), [['a', 'x']]), true);
  assert.equal(isDirty([['a', 'x']], [['a', 'x']]), false, 'pairs are accepted, not only a Map');
});

// A checkbox's `value` is its payload, not its state: an untouched box and a
// ticked one both report "on" unless `checked` is read.
test('checkbox state is read, not its value attribute', () => {
  assert.match(dirty, /el\.type === 'checkbox' \|\| el\.type === 'radio'/);
  assert.match(dirty, /String\(el\.checked\)/);
});

// ---- the modal plumbing ----

// setModalLocked's own comment says it suppresses "Escape and
// backdrop-click". The backdrop handler never checked it, so a stray click
// during a running import closed the dialog while the import carried on in
// the background, taking its progress bar with it.
test('a locked modal can no longer be closed by the backdrop', () => {
  const handler = modal.slice(modal.indexOf("overlay.addEventListener('click'"), modal.indexOf('stack.push'));
  assert.match(handler, /if \(entry\.locked\) return;/);
});

test('the close guard is consulted before closing, and may be async', () => {
  const handler = modal.slice(modal.indexOf("overlay.addEventListener('click'"), modal.indexOf('stack.push'));
  assert.match(handler, /await entry\.guard\(\)/);
  assert.match(handler, /if \(!mayClose\) return;/);
  assert.match(modal, /export function setCloseGuard/);
});

// Clicking the backdrop again while being asked would stack a second
// identical question, and answering one leaves the other orphaned.
test('a second click while the question is open is ignored', () => {
  const handler = modal.slice(modal.indexOf("overlay.addEventListener('click'"), modal.indexOf('stack.push'));
  assert.match(handler, /if \(entry\.asking\) return;/);
  assert.match(handler, /entry\.asking = true/);
  assert.match(handler, /finally \{ entry\.asking = false; \}/,
    'a throwing guard must not wedge the dialog shut forever');
});

// Escape is a deliberate "get me out"; a backdrop click is usually a miss
// aimed at a field. Confirming on both would make every dialog sticky.
test('Escape is deliberately not guarded', () => {
  const esc = modal.slice(modal.indexOf("if (e.key !== 'Escape') return;"));
  const body = esc.slice(0, esc.indexOf('}'));
  assert.ok(!/guard/.test(body), 'Escape must stay instant');
});

// Modal.js importing ConfirmModal would be a cycle — ConfirmModal is built
// on Modal.js.
test('Modal.js stays ignorant of what the question is', () => {
  assert.ok(!/ConfirmModal/.test(modal));
  assert.match(guard, /from '\.\/ConfirmModal\.js'/);
  assert.match(guard, /from '\.\/Modal\.js'/);
});

// The common case is opening a dialog to look at something, and that must
// not acquire a confirmation step.
test('an untouched dialog closes with no question', () => {
  assert.match(guard, /if \(!changed\(\)\) return true;/);
});

test('the four form dialogs are guarded', () => {
  for (const f of ['EmployeeModal', 'UserModal', 'ProximityCardModal', 'RemarksModal']) {
    const src = code(read(`Components/${f}.js`));
    assert.match(src, /guardUnsaved\(overlay/, `${f} has editable fields and no guard`);
  }
});
