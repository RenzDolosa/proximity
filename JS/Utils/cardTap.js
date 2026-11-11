// Telling a badge reader apart from a person typing.
//
// WHY THIS IS WORTH HAVING. A proximity card lands on the desk and the
// question is "whose is this?". Today that means reading ten digits off the
// card, opening Employee Manager and typing them in without a transposition.
// The reader already plugged into that machine is a keyboard wedge: it types
// the code and presses Enter. Catching that gives the answer in zero
// keystrokes and zero requests — the palette already ranks
// `active_proximity_code` as an exact match against the directory rows that
// are in memory anyway (see paletteSearch.js).
//
// WHY A SPEED TEST AND NOT A PREFIX. There is nothing in the keystrokes that
// says "reader": the characters are indistinguishable from typing. What
// differs is the CADENCE. A wedge types ten characters in roughly 100 ms —
// measured on this project in a different context, where 58 of 59 "unknown
// card" alerts turned out to be truncated reads precisely because a 200 ms
// poll could not keep up with one. A person cannot sustain 50 ms between
// keys for four characters, and does not finish with Enter while focus is on
// nothing.
//
// THE FAILURE MODE TO AVOID is swallowing real typing. Every guard here
// errs the same way: when in doubt, emit nothing and let the keystroke
// through. A missed card read costs one manual search. A stolen keystroke
// corrupts what someone was writing, and they will not know why.
//
// Pure and DOM-free. The caller decides whether the page is in a state where
// a read should be accepted at all (see acceptsCardTap below for the rule,
// and CommandPalette.js for where it is applied).

/** Below this, a burst is too short to tell from a person hitting keys. */
export const MIN_CARD_LENGTH = 4;

/**
 * Longest gap between two keystrokes that can still be one read.
 *
 * 50 ms. A wedge sits around 10 ms; the fastest sustained human typing is
 * about 120 ms between keys, and that is a touch typist on prose, not
 * someone entering digits. The gap between the two is wide enough that this
 * number does not need to be clever.
 */
export const MAX_GAP_MS = 50;

/** Longer than any card this project issues; a runaway buffer is discarded. */
export const MAX_CARD_LENGTH = 32;

/** Characters a card code is made of. Anything else ends the burst. */
const CARD_CHAR = /^[A-Za-z0-9-]$/;

export function emptyTapState() {
  return { buffer: '', lastAt: 0 };
}

/**
 * Feed one keydown.
 *
 * @param {{buffer: string, lastAt: number}} state
 * @param {{key: string, at: number}} event
 * @returns {{state: object, code: string|null}} `code` only on a completed read
 */
export function feedKey(state, { key, at } = {}) {
  const s = state || emptyTapState();
  const now = Number(at);
  const stamp = Number.isFinite(now) ? now : 0;

  if (key === 'Enter') {
    // Enter is the wedge's terminator. A buffer that reached the minimum
    // within the cadence is a read; anything else is discarded rather than
    // guessed at.
    const code = s.buffer.length >= MIN_CARD_LENGTH ? s.buffer : null;
    return { state: emptyTapState(), code };
  }

  // Escape abandons whatever was in flight, so a half-read followed by a
  // deliberate cancel cannot merge into the next one.
  if (key === 'Escape') return { state: emptyTapState(), code: null };

  // Modifiers, arrows, Tab, function keys: ignored WITHOUT resetting. A
  // wedge that emits a stray Shift between characters must not break the
  // read, and none of these can be part of a code anyway.
  if (typeof key !== 'string' || key.length !== 1) return { state: s, code: null };

  // A character a card cannot contain means this was never a read. Reset, so
  // typing "ab cd1234<Enter>" into nothing cannot produce "cd1234".
  if (!CARD_CHAR.test(key)) return { state: emptyTapState(), code: null };

  // THE CADENCE TEST. Too slow means a new burst starts here rather than
  // continuing the old one — which is what stops a person typing four
  // characters over four seconds from ever assembling a "code".
  const continues = s.buffer.length > 0 && stamp - s.lastAt <= MAX_GAP_MS;
  const buffer = (continues ? s.buffer : '') + key;

  if (buffer.length > MAX_CARD_LENGTH) return { state: emptyTapState(), code: null };
  return { state: { buffer, lastAt: stamp }, code: null };
}

/**
 * Is the page in a state where a card read should be intercepted at all?
 *
 * THE ONE RULE THAT MATTERS: never while something editable has focus. A
 * wedge fires into whatever is focused, and if that is a search box or a
 * form field then the operator is deliberately entering the code there —
 * stealing it would both break their input and open a dialog over it.
 *
 * Takes the element rather than reading document.activeElement so this stays
 * testable without a DOM.
 */
export function acceptsCardTap(activeElement, { paletteOpen = false, modalOpen = false } = {}) {
  if (paletteOpen || modalOpen) return false;
  const el = activeElement;
  if (!el) return true;
  const tag = String(el.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (el.isContentEditable) return false;
  return true;
}

/**
 * A burst worth acting on.
 *
 * Separate from feedKey so the length rule is stated once and can be
 * asserted directly. Trimmed because a wedge configured with a trailing Tab
 * or space is common enough to be worth tolerating.
 */
export function isCardRead(code) {
  const c = String(code ?? '').trim();
  return c.length >= MIN_CARD_LENGTH && c.length <= MAX_CARD_LENGTH && /^[A-Za-z0-9-]+$/.test(c);
}
