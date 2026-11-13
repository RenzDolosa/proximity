// The offline scan queue's ceiling, and the kiosk saying when it matters.
//
// WHAT WAS WRONG. idbEnqueue() was a bare `store.add(entry)` with nothing
// bounding the store, so a kiosk that could not reach the server grew its
// queue forever. The realistic failure is not the bytes — an entry is four
// short strings — it is that nothing anywhere said "this kiosk has 900
// unsent scans", so the condition was invisible until someone happened to
// open the health drawer.
//
// The cap is a backstop. The warning is the feature.
//
// IndexedDB does not exist under Node, so the behaviour of the cursor walk
// itself is asserted against the source. Everything that could be made pure
// — the thresholds, and what the health row says about them — is tested as
// values, which is why QUEUE_WARN_AT is duplicated into scannerHealth.js
// rather than imported through a module that touches `indexedDB`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { QUEUE_WARN_AT, QUEUE_MAX } from '../JS/Utils/idb.js';
import { healthRows, HEALTH, QUEUE_WARN_AT as HEALTH_WARN_AT } from '../JS/Utils/scannerHealth.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const idb = read('../JS/Utils/idb.js');
const model = read('../JS/Models/OfflineScanModel.js');

const queueRow = (state) => healthRows({ online: true, queued: 0, ...state }).find((r) => r.key === 'queue');

// ---- the thresholds ----

test('the two copies of the warning threshold agree', () => {
  assert.equal(QUEUE_WARN_AT, HEALTH_WARN_AT,
    'scannerHealth.js duplicates this so it can run under Node — the copies must not drift');
});

test('the warning comes long before the ceiling', () => {
  assert.ok(QUEUE_WARN_AT > 0);
  assert.ok(QUEUE_MAX > QUEUE_WARN_AT * 10,
    'a ceiling close to the warning would start dropping scans almost as soon as it complained');
});

// ---- the cap itself ----

test('enqueue trims before it adds, so the store cannot exceed the ceiling', () => {
  const from = idb.indexOf('export async function idbEnqueue');
  assert.ok(from !== -1);
  const fn = idb.slice(from);
  assert.match(fn, /idbTrimQueue\(QUEUE_MAX - 1\)/,
    'trimming to QUEUE_MAX would leave room for exactly one over the line after the add');
  assert.ok(fn.indexOf('idbTrimQueue') < fn.indexOf('s.add(entry)'),
    'trimming after the add means the store briefly exceeds its own ceiling');
});

test('a failed trim never blocks the scan being recorded', () => {
  assert.match(idb, /idbTrimQueue\(QUEUE_MAX - 1\)\.catch\(\(\) => 0\)/,
    'losing the trim is survivable; losing the scan at the door is not');
});

// The deletes are only durable when the transaction commits. Resolving on
// the last cursor step would report a count that could still be rolled back.
test('the trim resolves on the transaction, not on the cursor', () => {
  const from = idb.indexOf('export async function idbTrimQueue');
  const to = idb.indexOf('export async function idbEnqueue', from);
  assert.ok(from !== -1 && to > from, 'could not isolate idbTrimQueue');
  const fn = idb.slice(from, to);
  assert.match(fn, /tx\.oncomplete = \(\) => resolve\(dropped\)/);
  assert.match(fn, /tx\.onabort/, 'an aborted transaction must reject rather than hang');
  assert.ok(!/req\.onsuccess = \(\) => resolve/.test(fn));
});

// Cursor order is the autoIncrement key, i.e. insertion order. Deliberately
// not scanned_at: that field can be malformed on a row written by an older
// client, and the trim must not depend on parsing it.
test('oldest goes first, by key order rather than by timestamp', () => {
  const from = idb.indexOf('export async function idbTrimQueue');
  const to = idb.indexOf('export async function idbEnqueue', from);
  const fn = idb.slice(from, to);
  assert.match(fn, /openCursor\(\)/);
  assert.ok(!/scanned_at/.test(fn), 'the trim must not depend on a parseable timestamp');
});

test('the drop count reaches the caller instead of being swallowed', () => {
  assert.match(idb, /return \{ id, dropped \}/);
  assert.match(model, /droppedScans \+= result\?\.dropped \|\| 0/);
  assert.match(model, /droppedScanCount\(\)/);
});

// ---- what the kiosk says ----

test('a queue below the threshold is the design working, not a fault', () => {
  const row = queueRow({ queued: 12 });
  assert.equal(row.state, HEALTH.WARN);
  assert.equal(row.value, '12');
  assert.equal(row.detail, null, 'twelve queued scans is a kiosk that was briefly offline');
});

test('an empty queue is good and says nothing extra', () => {
  const row = queueRow({ queued: 0 });
  assert.equal(row.state, HEALTH.GOOD);
  assert.equal(row.detail, null);
});

test('a deep queue explains itself', () => {
  const row = queueRow({ queued: QUEUE_WARN_AT });
  assert.match(row.detail || '', /has not reached the server/);
  assert.equal(row.state, HEALTH.WARN, 'deep but still draining is not yet a fault');
});

test('a blocked sync is a fault, and names the cause', () => {
  const row = queueRow({ queued: 4, syncBlocked: 'this kiosk needs to sign in again' });
  assert.equal(row.state, HEALTH.BAD);
  assert.match(row.value, /not syncing/);
  assert.equal(row.detail, 'this kiosk needs to sign in again');
});

// Everything else in this drawer describes a kiosk that is behind. This one
// describes a kiosk that has lost something, which is a different sentence.
test('dropped scans are reported as lost, not as a bigger number', () => {
  const row = queueRow({ queued: QUEUE_MAX, droppedScans: 37 });
  assert.equal(row.state, HEALTH.BAD);
  assert.match(row.value, /37 dropped/);
});

// Number(null) is 0 and 0 is finite — so a nullish count would assert "none
// were dropped", which is the one claim this row must not make unearned.
test('an unknown drop count never reads as zero dropped', () => {
  for (const bad of [null, undefined, NaN, 'lots']) {
    const row = queueRow({ queued: 5, droppedScans: bad });
    assert.ok(!/dropped/.test(row.value), `droppedScans=${String(bad)} should not claim anything`);
  }
});

test('an unknown queue depth is still unknown', () => {
  const row = queueRow({ queued: undefined });
  assert.equal(row.state, HEALTH.UNKNOWN);
  assert.equal(row.value, 'unknown');
});
