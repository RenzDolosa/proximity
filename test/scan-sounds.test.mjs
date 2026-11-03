import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// From the pure module, not Models/ScanSoundsModel.js or Utils/scanSounds.js:
// both of those import the Supabase client, which needs `window`.
import { SOUND_KEYS, SOUND_LABELS, keyForResult, hasUnresolvedRemarks } from '../JS/Utils/scanSoundKeys.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('an employee with an unresolved remark gets its own sound, not the IN/OUT one', () => {
  const withRemark = {
    result: 'matched', direction: 'in',
    employee: { remarks_log: [{ remark: 'Left early twice' }] },
  };
  assert.equal(keyForResult(withRemark), 'matched_remarks');
  // ...and it wins for OUT too. Only one clip can play per scan, and the
  // remark is the fact worth interrupting someone for.
  assert.equal(keyForResult({ ...withRemark, direction: 'out' }), 'matched_remarks');
});

test('a clean matched scan still sounds the direction', () => {
  const clean = { result: 'matched', employee: { remarks_log: [] } };
  assert.equal(keyForResult({ ...clean, direction: 'in' }), 'matched_in');
  assert.equal(keyForResult({ ...clean, direction: 'out' }), 'matched_out');
  // No employee object at all (an older payload shape) must not throw or
  // silently become the remark sound.
  assert.equal(keyForResult({ result: 'matched', direction: 'in' }), 'matched_in');
});

test('only a matched scan can take the remark sound', () => {
  // An inactive card held by someone with remarks is still a revoked card:
  // the outcome the operator must act on is the card, not the note.
  const remarks = { remarks_log: [{ remark: 'x' }] };
  assert.equal(keyForResult({ result: 'inactive_card', employee: remarks }), 'card_revoked');
  assert.equal(keyForResult({ result: 'unmatched', employee: remarks }), 'unmatched');
  assert.equal(keyForResult({ result: 'unassigned_card', employee: remarks }), 'unassigned_card');
  assert.equal(keyForResult({ result: 'inactive_employee', employee: remarks }), null);
});

test('remarks reaching the scanner are already unresolved-only', () => {
  // Both producers (the compact RPC server-side, and the offline cache fed by
  // the delta) strip resolved entries before this point, so a non-empty array
  // IS the signal. This pins that contract rather than re-filtering here.
  assert.equal(hasUnresolvedRemarks({ employee: { remarks_log: [{}] } }), true);
  for (const empty of [[], null, undefined, 'nope', {}]) {
    assert.equal(hasUnresolvedRemarks({ employee: { remarks_log: empty } }), false);
  }
  assert.equal(hasUnresolvedRemarks({}), false);
  assert.equal(hasUnresolvedRemarks(null), false);
});

test('every sound key has a label, a bundled tone, and a precache entry', () => {
  // Three lists have to agree: SOUND_KEYS, Utils/scanSounds.js's
  // FALLBACK_SOUND_PATHS, and sw.js's FALLBACK_SOUND_URLS. Drift between them
  // is invisible until a kiosk is silent for one outcome, offline, in front
  // of a queue of people.
  const soundsJs = readFileSync(join(ROOT, 'JS', 'Utils', 'scanSounds.js'), 'utf8');
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');

  for (const [key, path] of Object.entries(SOUND_KEYS)) {
    assert.ok(SOUND_LABELS[key], `${key} has no label`);

    const file = join(ROOT, 'Public', 'Assets', 'Sounds', `${path}.wav`);
    assert.ok(existsSync(file), `missing bundled tone for ${key}: ${path}.wav`);
    assert.ok(statSync(file).size > 1000, `${path}.wav looks empty`);

    assert.ok(
      soundsJs.includes(`${key}: '/Public/Assets/Sounds/${path}.wav'`),
      `${key} missing from FALLBACK_SOUND_PATHS`,
    );
    assert.ok(
      sw.includes(`'/Public/Assets/Sounds/${path}.wav'`),
      `${path}.wav missing from sw.js FALLBACK_SOUND_URLS — it will not be precached`,
    );
  }
});

test('the bundled tones are the format the others are', () => {
  // A stereo or 48kHz file would still play, but these are generated assets
  // and a mismatch means one was produced by a different route than the rest.
  for (const path of Object.values(SOUND_KEYS)) {
    const b = readFileSync(join(ROOT, 'Public', 'Assets', 'Sounds', `${path}.wav`));
    assert.equal(b.toString('ascii', 0, 4), 'RIFF', `${path}: not RIFF`);
    assert.equal(b.toString('ascii', 8, 12), 'WAVE', `${path}: not WAVE`);
    assert.equal(b.readUInt16LE(20), 1, `${path}: not PCM`);
    assert.equal(b.readUInt16LE(22), 1, `${path}: not mono`);
    assert.equal(b.readUInt32LE(24), 44100, `${path}: not 44100Hz`);
    assert.equal(b.readUInt16LE(34), 16, `${path}: not 16-bit`);
  }
});
