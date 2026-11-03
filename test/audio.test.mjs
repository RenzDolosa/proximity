import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, downmixToMono, pickSmallerSound, SOUND_TARGET, MIN_SAVING_RATIO } from '../JS/Utils/audio.js';

// shrinkSoundFile() itself needs AudioContext and so cannot run here — same
// split as image.js, whose fileToWebp() is likewise browser-only while its
// decision rules are tested. What is pinned below is everything that decides
// WHAT gets uploaded, which is the part that can corrupt a sound.

test('the encoder produces a header the players already agree on', () => {
  // Must match the five bundled tones byte-for-byte in format, because the
  // same <audio> path plays both: PCM, mono, 16-bit.
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), SOUND_TARGET.sampleRate);
  const b = Buffer.from(wav);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WAVE');
  assert.equal(b.readUInt16LE(20), 1, 'format must be PCM');
  assert.equal(b.readUInt16LE(22), 1, 'must be mono');
  assert.equal(b.readUInt32LE(24), SOUND_TARGET.sampleRate);
  assert.equal(b.readUInt16LE(34), 16, 'must be 16-bit');
  // Declared sizes have to match reality or players read past the end.
  assert.equal(b.readUInt32LE(40), 3 * 2, 'data chunk size');
  assert.equal(b.readUInt32LE(4), 36 + 3 * 2, 'RIFF size');
  assert.equal(b.length, 44 + 3 * 2);
});

test('samples outside the valid range clamp instead of wrapping', () => {
  // Decoded audio can sit slightly past ±1. Letting that overflow turns the
  // loudest moment of a clip into a crack, which is worse than clipping it.
  const b = Buffer.from(encodeWav(new Float32Array([2, -2, 1, -1]), 22050));
  assert.equal(b.readInt16LE(44), 32767);
  assert.equal(b.readInt16LE(46), -32768);
  assert.equal(b.readInt16LE(48), 32767);
  assert.equal(b.readInt16LE(50), -32768);
});

test('an empty clip still produces a valid, playable file', () => {
  const b = Buffer.from(encodeWav(new Float32Array(0), 22050));
  assert.equal(b.length, 44);
  assert.equal(b.readUInt32LE(40), 0);
});

test('stereo is averaged, not half-discarded', () => {
  // Dropping all but the first channel would silence a clip whose tone is
  // panned hard right — which is exactly how some sound-library files ship.
  const left = new Float32Array([0, 0, 0]);
  const right = new Float32Array([1, 1, 1]);
  assert.deepEqual([...downmixToMono([left, right])], [0.5, 0.5, 0.5]);
  // A mono source passes through untouched.
  assert.deepEqual([...downmixToMono([new Float32Array([0.25, -0.25])])], [0.25, -0.25]);
  // Ragged channel lengths use the shorter one rather than reading undefined.
  assert.equal(downmixToMono([new Float32Array(4), new Float32Array(2)]).length, 2);
  assert.equal(downmixToMono([]).length, 0);
  assert.equal(downmixToMono(null).length, 0);
});

test('a re-encode that is not meaningfully smaller is discarded', () => {
  // An already-compressed upload (a small mp3) decodes to PCM several times
  // its own size, so "bigger" is the common case here, not the rare one.
  assert.equal(pickSmallerSound(50_000, 400_000).useCandidate, false);
  assert.equal(pickSmallerSound(50_000, 50_000).useCandidate, false);
  // Just under the threshold is not worth the quality loss.
  assert.equal(pickSmallerSound(100_000, 100_000 * (1 - MIN_SAVING_RATIO) + 1).useCandidate, false);
});

test('a real saving is taken and reported exactly', () => {
  const r = pickSmallerSound(860_000, 132_000);
  assert.equal(r.useCandidate, true);
  assert.equal(r.before, 860_000);
  assert.equal(r.after, 132_000);
  assert.equal(r.saved, 728_000);
});

test('missing or nonsense sizes never claim a saving', () => {
  for (const [a, b] of [[0, 100], [100, 0], [null, null], [undefined, 5], ['x', 'y']]) {
    const r = pickSmallerSound(a, b);
    assert.equal(r.useCandidate, false);
    assert.equal(r.saved, 0);
  }
});
