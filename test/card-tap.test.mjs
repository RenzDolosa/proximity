// Utils/cardTap.js — telling a badge reader apart from a person typing.
//
// The failure mode that matters is swallowing real typing, not missing a
// read: a missed read costs one manual search, a stolen keystroke corrupts
// what someone was writing and they will not know why. Most of these tests
// are about the second thing.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_CARD_LENGTH, MAX_GAP_MS, MAX_CARD_LENGTH,
  emptyTapState, feedKey, acceptsCardTap, isCardRead,
} from '../JS/Utils/cardTap.js';

/**
 * Type a string at a fixed cadence and return every emitted code.
 * `gap` in ms between keystrokes — 10 is a wedge, 150 is a person.
 */
function type(text, { gap = 10, start = 1000, state = emptyTapState() } = {}) {
  let s = state;
  const codes = [];
  let at = start;
  for (const key of text) {
    const r = feedKey(s, { key, at });
    s = r.state;
    if (r.code !== null) codes.push(r.code);
    at += gap;
  }
  return { state: s, codes, at };
}

// ---- the happy path ----

test('a wedge burst terminated by Enter is a read', () => {
  const { codes } = type('0004182\n'.replace('\n', ''), { gap: 10 });
  assert.deepEqual(codes, [], 'nothing until Enter');
  const { code } = feedKey(type('0004182', { gap: 10 }).state, { key: 'Enter', at: 2000 });
  assert.equal(code, '0004182');
});

test('letters and hyphens are part of a code', () => {
  const after = type('PRX-00099', { gap: 10 }).state;
  assert.equal(feedKey(after, { key: 'Enter', at: 9999 }).code, 'PRX-00099');
});

// ---- the guards that protect real typing ----

// A person cannot sustain 50 ms between keys, and this is the guard doing
// the actual work. Everything else is a backstop.
test('a person typing the same characters is never a read', () => {
  const after = type('0004182', { gap: 150 }).state;
  assert.equal(feedKey(after, { key: 'Enter', at: 99999 }).code, null,
    'typed slowly, this must not assemble into a code');
});

test('a slow keystroke starts a new burst rather than extending the old one', () => {
  let s = type('12', { gap: 10, start: 0 }).state;
  assert.equal(s.buffer, '12');
  // One slow key: the burst restarts from here.
  s = feedKey(s, { key: '3', at: 5000 }).state;
  assert.equal(s.buffer, '3');
  s = type('456', { gap: 10, start: 5010, state: s }).state;
  assert.equal(s.buffer, '3456');
});

test('a burst shorter than the minimum is discarded', () => {
  const after = type('123', { gap: 10 }).state;
  assert.equal(feedKey(after, { key: 'Enter', at: 2000 }).code, null);
  assert.equal(MIN_CARD_LENGTH, 4);
});

// "ab cd1234<Enter>" typed into nothing must not yield "cd1234".
test('a character no card contains abandons the burst', () => {
  let s = emptyTapState();
  s = type('ab', { gap: 10, state: s }).state;
  s = feedKey(s, { key: ' ', at: 1030 }).state;
  assert.equal(s.buffer, '');
  s = type('cd12', { gap: 10, start: 1040, state: s }).state;
  assert.equal(feedKey(s, { key: 'Enter', at: 1100 }).code, 'cd12',
    'the new burst is its own read — the point is that "ab" is not in it');
});

test('Escape abandons a read in flight', () => {
  let s = type('00041', { gap: 10 }).state;
  s = feedKey(s, { key: 'Escape', at: 1100 }).state;
  assert.equal(s.buffer, '');
  assert.equal(feedKey(s, { key: 'Enter', at: 1110 }).code, null);
});

// A wedge emitting a stray Shift mid-read must not break it.
test('modifier and navigation keys pass through without resetting', () => {
  let s = type('000', { gap: 10, start: 0 }).state;
  for (const key of ['Shift', 'Control', 'Alt', 'Tab', 'ArrowLeft', 'F5']) {
    s = feedKey(s, { key, at: 30 }).state;
  }
  assert.equal(s.buffer, '000', 'the buffer survived');
  s = type('4182', { gap: 10, start: 35, state: s }).state;
  assert.equal(feedKey(s, { key: 'Enter', at: 100 }).code, '0004182');
});

test('a runaway buffer is discarded rather than grown forever', () => {
  const long = 'A'.repeat(MAX_CARD_LENGTH + 1);
  const s = type(long, { gap: 5 }).state;
  assert.equal(s.buffer, '', 'past the ceiling the burst is abandoned');
});

test('malformed input does not throw', () => {
  for (const ev of [undefined, {}, { key: null, at: NaN }, { key: 7, at: 'x' }]) {
    const r = feedKey(emptyTapState(), ev);
    assert.equal(r.code, null);
    assert.ok(r.state);
  }
  assert.ok(feedKey(null, { key: 'a', at: 1 }).state, 'a missing state is replaced, not dereferenced');
});

// Two reads in a row must not merge, even back to back.
test('a completed read leaves no residue for the next one', () => {
  let s = type('11112', { gap: 10, start: 0 }).state;
  const first = feedKey(s, { key: 'Enter', at: 60 });
  assert.equal(first.code, '11112');
  s = first.state;
  s = type('2222', { gap: 10, start: 70, state: s }).state;
  assert.equal(feedKey(s, { key: 'Enter', at: 120 }).code, '2222');
});

// ---- when the page will accept one ----
//
// THE ONE RULE THAT MATTERS. A wedge fires into whatever is focused; if that
// is a search box then the operator is deliberately entering the code there.

test('never while something editable has focus', () => {
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea']) {
    assert.equal(acceptsCardTap({ tagName }), false, `${tagName} must keep its keystrokes`);
  }
  assert.equal(acceptsCardTap({ tagName: 'DIV', isContentEditable: true }), false);
});

test('accepted when focus is nowhere in particular', () => {
  assert.equal(acceptsCardTap(null), true);
  assert.equal(acceptsCardTap({ tagName: 'BODY' }), true);
  assert.equal(acceptsCardTap({ tagName: 'BUTTON' }), true);
});

// The palette's own input is focused when it is open, so this is belt and
// braces — but a modal over the top is a deliberate interaction that must
// not have a dialog opened on top of it.
test('never while the palette or a modal is open', () => {
  assert.equal(acceptsCardTap(null, { paletteOpen: true }), false);
  assert.equal(acceptsCardTap(null, { modalOpen: true }), false);
});

// ---- the shape test ----

test('isCardRead agrees with the length rules', () => {
  assert.equal(isCardRead('0004182'), true);
  assert.equal(isCardRead('  0004182  '), true, 'a trailing Tab or space is common');
  assert.equal(isCardRead('123'), false);
  assert.equal(isCardRead('A'.repeat(MAX_CARD_LENGTH + 1)), false);
  assert.equal(isCardRead('has space'), false);
  for (const bad of [null, undefined, '', 42]) assert.equal(isCardRead(bad), false);
});

test('the cadence ceiling is well under human typing', () => {
  assert.ok(MAX_GAP_MS <= 60,
    'the fastest sustained human typing is around 120 ms between keys; this '
    + 'must sit clearly below that or real typing starts being intercepted');
});
