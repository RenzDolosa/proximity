import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base64ByteLength,
  pickSmallerThumb,
  sniffImageMimeFromBase64,
  photoDataUri,
  OFFLINE_THUMB_TARGET,
} from '../JS/Utils/image.js';

// Only the pure half of Utils/image.js is covered here. The encoders
// (fileToWebp / fileToOfflineThumbWebp / recompressThumbBase64) all go
// through <canvas>, which Node has no implementation of, so the decisions
// AROUND the encoder were factored out into pickSmallerThumb() /
// base64ByteLength() specifically so they could be pinned here instead of
// only ever being exercised by hand in a browser.

// 4 base64 chars encode exactly 3 bytes. The recompressor's entire
// before/after accounting rests on this, over hundreds of rows, so an
// off-by-a-few here would silently misreport every saving the Settings
// panel claims.
test('decoded byte length is computed from base64 length, not by decoding', () => {
  assert.equal(base64ByteLength('A'.repeat(400)), 300);
  assert.equal(base64ByteLength('A'.repeat(4)), 3);
  assert.equal(base64ByteLength(''), 0);
});

// Padding encodes no bytes, and PostgREST/JSON transport can reintroduce
// line breaks into a long base64 string — neither may be counted as data.
test('padding and line breaks do not count as bytes', () => {
  assert.equal(base64ByteLength('QUJD'), 3);      // "ABC", unpadded
  assert.equal(base64ByteLength('QUI='), 2);      // "AB", one pad char
  assert.equal(base64ByteLength('QQ=='), 1);      // "A", two pad chars
  assert.equal(base64ByteLength('QUJD\nQUJD'), 6);
});

test('unusable input measures as zero rather than throwing', () => {
  assert.equal(base64ByteLength(null), 0);
  assert.equal(base64ByteLength(undefined), 0);
  assert.equal(base64ByteLength(12345), 0);
});

// The core safety property of the Settings action: running it must never
// leave a row worse than it found it. Re-encoding is not monotonically
// shrinking — a row already below the target gets scaled back UP to the
// target dimension and can come back bigger.
test('a re-encode that came back larger is discarded', () => {
  const original = 'A'.repeat(400);   // 300 bytes
  const bigger = 'A'.repeat(800);     // 600 bytes
  const result = pickSmallerThumb(original, bigger);
  assert.equal(result.base64, original);
  assert.equal(result.changed, false);
  assert.equal(result.saved, 0);
  // `after` reports the bytes actually KEPT, not the bytes the encoder
  // produced — otherwise the panel's running total would credit a saving
  // against a row it did not change.
  assert.equal(result.after, 300);
});

// Re-encoding a lossy image costs a generation of quality. A marginal win
// is not worth paying that, nor the UPDATE's own cost (every rewritten row
// shows up in the next scanner lookup-cache delta), which is also what
// makes the action safely re-runnable: a second pass finds nothing left to
// gain and writes nothing.
test('a saving under 10% is not worth a generation of quality loss', () => {
  const original = 'A'.repeat(400);              // 300 bytes
  assert.equal(pickSmallerThumb(original, 'A'.repeat(396)).changed, false); // 297 bytes, 1%
  assert.equal(pickSmallerThumb(original, 'A'.repeat(360)).changed, false); // 270 bytes, exactly 10% — boundary is exclusive
  assert.equal(pickSmallerThumb(original, 'A'.repeat(359)).changed, true);  // 269 bytes, just over
});

test('a real saving is taken and reported exactly', () => {
  const original = 'A'.repeat(400);  // 300 bytes
  const smaller = 'A'.repeat(200);   // 150 bytes
  const result = pickSmallerThumb(original, smaller);
  assert.equal(result.base64, smaller);
  assert.equal(result.changed, true);
  assert.equal(result.before, 300);
  assert.equal(result.after, 150);
  assert.equal(result.saved, 150);
});

// A failed encode that returned nothing must not be mistaken for a
// spectacular saving and written over a real photo.
test('an empty re-encode never replaces a real thumbnail', () => {
  const original = 'A'.repeat(400);
  for (const empty of ['', null, undefined]) {
    const result = pickSmallerThumb(original, empty);
    assert.equal(result.base64, original);
    assert.equal(result.changed, false);
  }
});

// recompressThumbBase64() feeds the sniffed mime straight into the Blob it
// hands to the decoder, so a wrong sniff here means the browser is asked to
// decode webp bytes labelled as jpeg. WEBP is the case that needs the
// offset form — its marker sits at byte 8 of the RIFF container, not at 0.
test('a webp container is recognised from its marker at offset 8', () => {
  const riff = Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.from([0, 0, 0, 0]),       // container size, irrelevant here
    Buffer.from('WEBP', 'ascii'),
    Buffer.alloc(16),
  ]).toString('base64');
  assert.equal(sniffImageMimeFromBase64(riff), 'image/webp');
  assert.ok(photoDataUri(riff).startsWith('data:image/webp;base64,'));
});

test('pre-webp thumbnails are still recognised by their own signatures', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]).toString('base64');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]).toString('base64');
  assert.equal(sniffImageMimeFromBase64(png), 'image/png');
  assert.equal(sniffImageMimeFromBase64(jpeg), 'image/jpeg');
});

// The Settings panel states this target in its own copy and passes the
// byte threshold to get_offline_thumb_stats / get_thumbs_to_recompress, so
// the three stay in step only as long as there is one source for it.
test('the offline thumbnail target is a single frozen source of truth', () => {
  assert.equal(Object.isFrozen(OFFLINE_THUMB_TARGET), true);
  assert.ok(OFFLINE_THUMB_TARGET.maxDimension > 0);
  assert.ok(OFFLINE_THUMB_TARGET.quality > 0 && OFFLINE_THUMB_TARGET.quality < 1);
  // Must exceed what the encoder typically produces, or the panel would
  // keep re-reading rows it then declines to change.
  assert.ok(OFFLINE_THUMB_TARGET.overTargetStoredBytes >= 4096);
});
