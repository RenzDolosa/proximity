// What the badge reader actually sent — read from the browser's own keyboard
// events, so this makes no request and needs no server support.
//
// WHY THIS EXISTS. Two migrations in this repo are about readers sending the
// wrong thing: 20261008000000 found 58 of 59 unknown-card codes were SUFFIXES
// of real cards (a reader's leading digits going nowhere), and 20261008140000
// found stuck keys emitting 40-71 characters of one repeated digit. Both ship
// alerts. Neither gives anyone standing at the reader a way to see what it
// actually transmitted.
//
// The decision rules are NOT duplicated here. readRejection() in
// Core/offlineScanning.js is the single source of truth for whether a read is
// usable, and it is already unit-tested; this module explains a read and adds
// the timing the kiosk never needed to look at.
import { readRejection, expectedCodeLength, maxCodeLength, codesAreNumeric } from '../Core/offlineScanning.js';

// Above this, consecutive characters were almost certainly typed by a human
// rather than emitted by a wedge reader. Real readers sit in single-digit to
// low-tens of milliseconds; a fast typist is 80ms+ between keys.
export const HUMAN_TYPING_GAP_MS = 80;

/**
 * Turn raw keystroke timestamps into something sayable.
 *
 * `events` is [{ key, at }] in arrival order. Gaps are between consecutive
 * CHARACTER keys — Enter is recorded but excluded from the timing, because a
 * reader that sends a terminator sends it after a pause and would skew the
 * maximum.
 */
export function summariseKeystrokes(events) {
  const list = Array.isArray(events) ? events : [];
  const chars = list.filter((e) => e && typeof e.key === 'string' && e.key.length === 1);
  const sawEnter = list.some((e) => e?.key === 'Enter');

  const gaps = [];
  for (let i = 1; i < chars.length; i += 1) {
    const gap = Number(chars[i].at) - Number(chars[i - 1].at);
    if (Number.isFinite(gap) && gap >= 0) gaps.push(gap);
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length
    ? (sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2))
    : null;

  return {
    characters: chars.length,
    sawEnter,
    minGapMs: sorted.length ? sorted[0] : null,
    maxGapMs: sorted.length ? sorted[sorted.length - 1] : null,
    medianGapMs: median,
    // Null rather than 0 for a single character: one keystroke has no span,
    // and 0 would read as "arrived instantly" which is a different claim.
    spanMs: chars.length > 1
      ? Number(chars[chars.length - 1].at) - Number(chars[0].at)
      : null,
    // A wedge reader's whole point is that it is faster than hands. This is
    // advisory — a very slow reader exists — so it is reported, not enforced.
    looksTyped: median !== null && median > HUMAN_TYPING_GAP_MS,
  };
}

/**
 * The registered card this read is the tail of, or null.
 *
 * Mirrors scan_proximity_code()'s own truncation test (`right(code, len) =
 * read`) rather than a substring search: a truncation drops LEADING
 * characters, so only a suffix match is evidence of one. A middle match would
 * be a coincidence.
 */
export function suffixOfCard(code, rows) {
  const value = String(code ?? '').trim();
  if (!value) return null;
  for (const row of rows || []) {
    const full = String(row?.proximity_code ?? '').trim();
    if (full && full !== value && full.endsWith(value)) return full;
  }
  return null;
}

// Why a read is unusable, in the operator's words. Keyed by readRejection()'s
// own return values so the two can never drift apart.
export const REJECTION_LABEL = Object.freeze({
  empty: 'Nothing was sent',
  short: 'Too few characters — the reader dropped some',
  long: 'Too many characters — likely a stuck key on the reader',
  charset: 'Contains characters no issued card uses',
});

/**
 * A full explanation of one read.
 *
 * `rows` is the offline lookup cache. With no cache this still reports the
 * timing and the literal read, and says the card facts are unknown rather
 * than inventing an expected length — the same fail-open posture
 * readRejection() takes.
 */
export function diagnoseRead({ code, keystrokes, rows } = {}) {
  const value = String(code ?? '').trim();
  const haveRoster = Array.isArray(rows) && rows.length > 0;
  const timing = summariseKeystrokes(keystrokes);
  const rejection = readRejection(value, haveRoster ? rows : []);

  const exact = haveRoster
    && rows.some((r) => String(r?.proximity_code ?? '').trim() === value);

  return {
    code: value,
    length: value.length,
    // Null, not 0, when there is no roster to compare against: 0 would render
    // as "cards are 0 characters", which is a statement rather than a gap.
    expectedLength: haveRoster ? expectedCodeLength(rows) || null : null,
    maxLength: haveRoster ? maxCodeLength(rows) || null : null,
    numericOnly: haveRoster ? codesAreNumeric(rows) : null,
    allDigits: value.length > 0 && /^[0-9]+$/.test(value),
    // The single most useful line when a reader is dropping digits: it names
    // the card the employee was actually holding.
    truncatedOf: rejection === 'short' || !exact ? suffixOfCard(value, rows) : null,
    exactMatch: exact,
    rejection,
    rejectionLabel: rejection ? REJECTION_LABEL[rejection] || 'Unusable read' : null,
    rosterKnown: haveRoster,
    timing,
  };
}

/**
 * One short sentence for the top of the panel.
 *
 * Deliberately says "could not be checked" rather than "looks fine" when
 * there is no roster — a kiosk that has never synced knows nothing about card
 * shape, and claiming otherwise is how a broken reader passes a test.
 */
export function readHeadline(diag) {
  if (!diag || !diag.code) return 'Nothing was sent';
  if (diag.rejection) return diag.rejectionLabel;
  if (!diag.rosterKnown) return 'Read captured — no cached cards to check it against';
  if (diag.exactMatch) return 'Complete read, matches an issued card';
  if (diag.truncatedOf) return 'Partial read — the reader dropped leading characters';
  return 'Complete read, but no issued card matches it';
}
