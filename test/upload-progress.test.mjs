import test from 'node:test';
import assert from 'node:assert/strict';
// From the pure module: Utils/xhrUpload.js imports the Supabase client, which
// needs `window` and so cannot load in the Node test runner.
import { progressPercent } from '../JS/Utils/progress.js';

// What this guards: the bar was `width: 100%` with a shimmer whenever the
// length was unknown, which in any still frame looks exactly like a finished
// upload — reported as "the bar is full but the upload is not done". The fix
// is real byte progress where it exists, so the arithmetic that drives the
// width has to be right, and has to refuse to guess where it cannot be.

test('ordinary progress maps to a whole percentage', () => {
  assert.equal(progressPercent(0, 1000), 0);
  assert.equal(progressPercent(500, 1000), 50);
  assert.equal(progressPercent(1000, 1000), 100);
  assert.equal(progressPercent(333, 1000), 33);
});

test('an unknown total reports null rather than dividing by zero', () => {
  // A chunked response sends no Content-Length. Returning 0 or NaN here would
  // paint an empty bar that never moves, which reads as a stall; null is the
  // caller's signal to show the indeterminate style instead.
  for (const bad of [0, -1, null, undefined, NaN, 'nope']) {
    assert.equal(progressPercent(100, bad), null);
  }
});

test('nonsense loaded values never produce a bar', () => {
  for (const bad of [null, undefined, NaN, 'x', -5]) {
    assert.equal(progressPercent(bad, 1000), null);
  }
});

test('an overshoot clamps to 100 instead of overflowing the track', () => {
  // Some browsers report loaded > total once the final chunk is flushed.
  // Without the clamp the fill runs past the end of its rounded track.
  assert.equal(progressPercent(1200, 1000), 100);
});
