import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachCachedPhoto, classifyCachedScan, codesAreNumeric, flushQueuedScans, groupQueuedScans,
  looksLikeCardCode, maxCodeLength, mergeLookupDelta, mergePhotoUpdates, expectedCodeLength,
  photoNeedsRefresh, readRejection,
} from '../JS/Core/offlineScanning.js';

const matchedRow = {
  proximity_code: 'CARD-1', card_active: true, employee_id: 'employee-1',
  employee_status: 'active', scan_count: 4, full_name: 'Ari',
  employee_code: 'E-1', department: 'Ops', remarks_log: [{ resolved: false }],
};

// A short read is a TRUNCATED read, not a stray keystroke. Measured against the
// live database 2026-10-08: 58 of 59 distinct "unknown card" codes were suffixes
// of registered cards (`037` of `0005204037`), i.e. real employees whose badge
// failed because the leading digits were lost before the input had focus.
//
// This roster mirrors the real shape: overwhelmingly one length, plus a single
// short outlier (there is one inactive 3-character test card in production).
const roster = [
  ...Array.from({ length: 8 }, (_, i) => ({ proximity_code: `000520403${i}` })),
  { proximity_code: '123' },
];

// Using the MINIMUM would make the threshold 3 and accept every truncation —
// which is exactly the bug this replaces. The mode ignores the outlier.
test('the expected length is the common one, not the shortest', () => {
  assert.equal(expectedCodeLength(roster), 10);
  assert.equal(expectedCodeLength([{ proximity_code: '  7654321  ' }]), 7); // trimmed
  assert.equal(expectedCodeLength([{ proximity_code: '' }, { proximity_code: null }, {}]), 0);
  assert.equal(expectedCodeLength([]), 0);
  assert.equal(expectedCodeLength(null), 0);
});

// Ties favour the longer length: accepting a short read loses a scan, which is
// the worse failure.
test('a tie in length counts resolves towards the longer code', () => {
  assert.equal(expectedCodeLength([{ proximity_code: '1234' }, { proximity_code: '123456' }]), 6);
});

test('a truncated read of a real card is rejected before it is sent', () => {
  for (const truncated of ['0', '37', '037', '9295', '215056', '00520403']) {
    assert.equal(looksLikeCardCode(truncated, roster), false);
  }
});

test('a full-length read is scanned, registered or not', () => {
  assert.equal(looksLikeCardCode('0005204037', roster), true); // registered
  assert.equal(looksLikeCardCode('0009999999', roster), true); // genuinely unknown card — must still alert
  assert.equal(looksLikeCardCode('  0005204037  ', roster), true); // trimmed first
});

// The one legitimately short card in production would otherwise be unusable.
test('an exact match on a known code is always accepted, however short', () => {
  assert.equal(looksLikeCardCode('123', roster), true);
  assert.equal(looksLikeCardCode('124', roster), false); // near miss is still a truncation
});

// A kiosk that has never synced must not silently swallow scans — that is worse
// than a noisy alert list.
test('an unknown roster fails open', () => {
  assert.equal(looksLikeCardCode('0', []), true);
  assert.equal(looksLikeCardCode('0', null), true);
  assert.equal(looksLikeCardCode('37', [{ proximity_code: '' }]), true);
});

test('empty input is never a scan, whatever the roster says', () => {
  assert.equal(looksLikeCardCode('', roster), false);
  assert.equal(looksLikeCardCode('   ', roster), false);
  assert.equal(looksLikeCardCode(null, []), false);
  assert.equal(looksLikeCardCode(undefined, []), false);
});

test('the bounds are read from the roster, not hardcoded', () => {
  assert.equal(maxCodeLength(roster), 10);
  assert.equal(maxCodeLength([]), 0);
  assert.equal(maxCodeLength(null), 0);
  assert.equal(maxCodeLength([{ proximity_code: '  1234  ' }]), 4); // trimmed

  assert.equal(codesAreNumeric(roster), true);
  assert.equal(codesAreNumeric([{ proximity_code: 'AB12' }]), false);
  assert.equal(codesAreNumeric([]), false); // nothing seen is not "all numeric"
  assert.equal(codesAreNumeric([{ proximity_code: '' }, {}]), false);
});

// The eight alerts that survived the truncation fix: 40-71 characters of one
// repeated digit, from a stuck key on the reader.
test('a read longer than any issued card is discarded', () => {
  assert.equal(looksLikeCardCode('2'.repeat(71), roster), false);
  assert.equal(looksLikeCardCode('00052040371', roster), false); // one digit too many
  assert.equal(readRejection('2'.repeat(71), roster), 'long');
});

// This is what makes the over-length rule safe where a length floor was not: a
// truncation is a SUFFIX, and a suffix is never longer than its card.
test('the over-length rule cannot hide a truncation', () => {
  for (const truncated of ['0', '37', '037', '9295', '215056', '00520403']) {
    assert.equal(readRejection(truncated, roster), 'short');
  }
});

test('a character no card uses means it did not come from a badge', () => {
  assert.equal(readRejection('00052O4O37', roster), 'charset'); // letter O for zero
  assert.equal(readRejection('0005204-37', roster), 'charset');
  // Relaxes on its own once an alphanumeric card is issued.
  const mixed = [...roster, { proximity_code: 'AB12345678' }];
  assert.equal(codesAreNumeric(mixed), false);
  assert.equal(readRejection('CD12345678', mixed), null);
});

test('a plausible unregistered card still goes through, so it still alerts', () => {
  // The security event this must never swallow: a real badge from another
  // system, of a shape a card could have.
  assert.equal(readRejection('0009999999', roster), null);
  assert.equal(looksLikeCardCode('0009999999', roster), true);
});

test('an over-long read on a never-synced kiosk still fails open', () => {
  assert.equal(readRejection('2'.repeat(71), []), null);
  assert.equal(readRejection('2'.repeat(71), null), null);
});

test('readRejection and looksLikeCardCode never disagree', () => {
  const cases = ['', '0', '037', '0005204037', '0009999999', '123', '2'.repeat(71), 'AB12'];
  for (const value of cases) {
    assert.equal(looksLikeCardCode(value, roster), readRejection(value, roster) === null, value);
  }
});

test('offline classification mirrors server result branches and direction alternation', () => {
  assert.equal(classifyCachedScan('missing', [matchedRow]).result, 'unmatched');
  assert.equal(classifyCachedScan('CARD-1', [{ ...matchedRow, card_active: false }]).result, 'inactive_card');
  assert.equal(classifyCachedScan('CARD-1', [{ ...matchedRow, employee_id: null }]).result, 'unassigned_card');
  assert.equal(classifyCachedScan('CARD-1', [{ ...matchedRow, employee_status: 'inactive' }]).result, 'inactive_employee');

  const first = classifyCachedScan('CARD-1', [matchedRow], new Map());
  const second = classifyCachedScan('CARD-1', [matchedRow], new Map([['employee-1', 1]]));
  assert.equal(first.direction, 'in');
  assert.equal(second.direction, 'out');
  assert.deepEqual(first.employee.remarks_log, [{ resolved: false }]);
});

// Phase 0 of the scan_logs trim plan (Supabase/migrations/
// 20261001040000_scan_logs_parity_counter.sql) moved get_scanner_offline_cache()'s
// scan_count field from jsonb_array_length(employees.scan_logs) to a durable
// counter (scan_parity_count) that a future trim of scan_logs never
// decreases. This file only ever sees whatever number lands in the
// scan_count field — it has no idea which source produced it — which is
// exactly the point: the client-side arithmetic needed zero changes when
// the server-side source changed. This case pins that by using a scan_count
// larger than the row's actual history, standing in for an employee whose
// scan_logs array has since been trimmed shorter than their true scan
// count.
test('direction parity uses whatever scan_count the cache reports, independent of any array length', () => {
  const trimmedButStillOdd = classifyCachedScan('CARD-1', [{ ...matchedRow, scan_count: 141 }], new Map());
  assert.equal(trimmedButStillOdd.direction, 'out'); // 141 is odd regardless of how many entries actually remain in scan_logs
  const trimmedButStillEven = classifyCachedScan('CARD-1', [{ ...matchedRow, scan_count: 140 }], new Map());
  assert.equal(trimmedButStillEven.direction, 'in');
});

test('photo sync replaces legacy snapshots, merges changes, and removes stale photos', () => {
  const fullSync = mergePhotoUpdates(null, {
    photos: [
      { employee_id: 'employee-1', photo_file_id: 'file-1', photo_thumb_b64: 'thumb-1' },
      { employee_id: 'employee-2', photo_file_id: 'file-2', photo_thumb_b64: 'thumb-2' },
    ],
    removed: [],
  });
  assert.deepEqual(fullSync, {
    byEmployeeId: { 'employee-1': 'thumb-1', 'employee-2': 'thumb-2' },
    fileIdsByEmployeeId: { 'employee-1': 'file-1', 'employee-2': 'file-2' },
  });

  const incremental = mergePhotoUpdates(fullSync, {
    photos: [{ employee_id: 'employee-1', photo_file_id: 'file-2', photo_thumb_b64: 'thumb-2' }],
    removed: ['employee-2'],
  });
  assert.deepEqual(incremental, {
    byEmployeeId: { 'employee-1': 'thumb-2' },
    fileIdsByEmployeeId: { 'employee-1': 'file-2' },
  });

  const legacy = mergePhotoUpdates({ byEmployeeId: { stale: 'old-thumb' } }, {
    photos: [{ employee_id: 'employee-3', photo_file_id: 'file-3', photo_thumb_b64: 'thumb-3' }],
    removed: [],
  });
  assert.deepEqual(legacy, {
    byEmployeeId: { 'employee-3': 'thumb-3' },
    fileIdsByEmployeeId: { 'employee-3': 'file-3' },
  });
});

test('queue replay preserves chronological order per card while allowing other cards to progress', async () => {
  const entries = [
    { id: 'b-2', proximity_code: 'B', scanned_at: '2026-09-22T00:00:03Z' },
    { id: 'a-2', proximity_code: 'A', scanned_at: '2026-09-22T00:00:02Z' },
    { id: 'a-1', proximity_code: 'A', scanned_at: '2026-09-22T00:00:01Z' },
  ];
  assert.deepEqual(groupQueuedScans(entries).map((group) => group.map((entry) => entry.id)), [['a-1', 'a-2'], ['b-2']]);

  const sent = [];
  const removed = [];
  const result = await flushQueuedScans({
    entries,
    concurrency: 2,
    send: async (entry) => { sent.push(entry.id); return null; },
    remove: async (id) => { removed.push(id); },
  });
  assert.equal(sent.indexOf('a-1') < sent.indexOf('a-2'), true);
  assert.deepEqual(removed.sort(), ['a-1', 'a-2', 'b-2']);
  assert.deepEqual(result, { synced: 3, remaining: 0 });
});

test('queue replay stops after an RPC failure and keeps unsynced entries', async () => {
  const entries = [
    { id: 'a-1', proximity_code: 'A', scanned_at: '2026-09-22T00:00:01Z' },
    { id: 'a-2', proximity_code: 'A', scanned_at: '2026-09-22T00:00:02Z' },
  ];
  const removed = [];
  const result = await flushQueuedScans({
    entries,
    send: async (entry) => entry.id === 'a-2' ? new Error('offline') : null,
    remove: async (id) => { removed.push(id); },
  });
  assert.deepEqual(removed, ['a-1']);
  assert.deepEqual(result, { synced: 1, remaining: 1 });
});

// scan_proximity_code_compact(p_include_photo => false) omits the thumbnail;
// the scanner puts the locally cached one back before rendering.
test('attachCachedPhoto restores a cached thumbnail without mutating or overriding', () => {
  const live = { result: 'matched', employee: { id: 'employee-1', full_name: 'Ari' } };
  const filled = attachCachedPhoto(live, { 'employee-1': 'thumb-1' });
  assert.equal(filled.employee.photo_thumb_b64, 'thumb-1');
  assert.equal(live.employee.photo_thumb_b64, undefined); // input untouched

  // a thumbnail the server did send is never overwritten by the cache
  const sent = { result: 'matched', employee: { id: 'employee-1', photo_thumb_b64: 'server' } };
  assert.equal(attachCachedPhoto(sent, { 'employee-1': 'cached' }), sent);

  // nothing to attach: same object back, safe for unconditional use
  assert.equal(attachCachedPhoto(live, {}), live);
  const unmatched = { result: 'unmatched', employee: null };
  assert.equal(attachCachedPhoto(unmatched, { 'employee-1': 'x' }), unmatched);
  assert.equal(attachCachedPhoto(null, {}), null);
});

test('photoNeedsRefresh flags new, replaced and legacy-cache photos but not photo-less employees', () => {
  const cache = { byEmployeeId: { e1: 't1' }, fileIdsByEmployeeId: { e1: 'f1' } };
  const scan = (employee) => ({ result: 'matched', employee });

  assert.equal(photoNeedsRefresh(scan({ id: 'e1', photo_file_id: 'f1' }), cache), false); // current
  assert.equal(photoNeedsRefresh(scan({ id: 'e1', photo_file_id: 'f2' }), cache), true);  // photo replaced
  assert.equal(photoNeedsRefresh(scan({ id: 'e2', photo_file_id: 'f9' }), cache), true);  // new hire, not cached
  assert.equal(photoNeedsRefresh(scan({ id: 'e3', photo_file_id: null }), cache), false); // never had a photo: nothing to sync
  assert.equal(photoNeedsRefresh(scan({ id: 'e1', photo_file_id: 'f1' }), { byEmployeeId: { e1: 't1' } }), true); // legacy cache without file ids
  assert.equal(photoNeedsRefresh({ result: 'unmatched', employee: null }, cache), false);
  assert.equal(photoNeedsRefresh(scan({ id: 'e1', photo_file_id: 'f1' }), null), true);
});

// get_scanner_offline_cache_delta() (Supabase/migrations/
// 20261005000000_incremental_scanner_cache_and_dashboard_pulse.sql) answers
// with either a full roster or only the employees updated since the cursor
// the kiosk sent back. These pin the merge rules the kiosk applies to that
// response — in particular that a `full` response REPLACES rather than
// overlays, which is what makes deletions work without a separate removed[]
// list the way the photo cache needs.
const lookupRow = (code, over = {}) => ({
  proximity_code: code, card_active: true, employee_id: `emp-${code}`,
  employee_status: 'active', scan_count: 2, full_name: `Name ${code}`,
  employee_code: `E-${code}`, department: 'Ops', remarks_log: [], ...over,
});

test('a full delta response replaces the cached roster outright', () => {
  const cached = [lookupRow('A'), lookupRow('B')];
  const merged = mergeLookupDelta(cached, { full: true, rows: [lookupRow('A')] });
  assert.deepEqual(merged.map((r) => r.proximity_code), ['A']); // B was deleted server-side — a full response is the only signal for that
});

test('an incremental response overlays only the rows it carries, in place', () => {
  const cached = [lookupRow('A'), lookupRow('B'), lookupRow('C')];
  const merged = mergeLookupDelta(cached, {
    full: false,
    rows: [lookupRow('B', { scan_count: 7, employee_status: 'inactive' })],
  });
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((r) => r.proximity_code), ['A', 'B', 'C']); // order preserved
  assert.equal(merged[1].scan_count, 7);
  assert.equal(merged[1].employee_status, 'inactive');
  assert.equal(merged[0].scan_count, 2); // untouched rows are the same objects' values, not re-fetched
});

test('an empty incremental response leaves the cache exactly as it was', () => {
  const cached = [lookupRow('A'), lookupRow('B')];
  assert.equal(mergeLookupDelta(cached, { full: false, rows: [] }), cached);
});

test('a delta row for a code the cache has never seen is appended, not dropped', () => {
  const merged = mergeLookupDelta([lookupRow('A')], { full: false, rows: [lookupRow('Z')] });
  assert.deepEqual(merged.map((r) => r.proximity_code), ['A', 'Z']);
});

test('merging into a missing or malformed cache degrades to whatever the server sent', () => {
  assert.deepEqual(mergeLookupDelta(undefined, { full: true, rows: [lookupRow('A')] }).length, 1);
  assert.deepEqual(mergeLookupDelta(undefined, { full: false, rows: [lookupRow('A')] }).length, 1);
  assert.deepEqual(mergeLookupDelta([lookupRow('A')], { full: true }), []);
});

// The merged rows still have to be exactly what classifyCachedScan() expects
// — the delta path is only a transport change, not a shape change.
test('rows that arrived through a delta still classify identically', () => {
  const merged = mergeLookupDelta(
    [lookupRow('CARD-9', { scan_count: 2 })],
    { full: false, rows: [lookupRow('CARD-9', { scan_count: 3 })] },
  );
  assert.equal(classifyCachedScan('CARD-9', merged).direction, 'out'); // 3 is odd
});

// The property the in-memory fallback depends on (see
// OfflineScanModel.fetchAndStorePhotoUpdates): when IndexedDB refuses the
// write, the merged value held in memory must still be usable as the NEXT
// sync's known-ids map. If it were not, every sync would send an empty map and
// the server would return all 729 thumbnails (~12 MB) every time — silently,
// every couple of minutes, forever.
test('a merged photo cache can serve as the next request’s known-ids map', () => {
  const merged = mergePhotoUpdates(null, {
    full: true,
    photos: [
      { employee_id: 'e1', photo_file_id: 'f1', photo_thumb_b64: 'AAAA' },
      { employee_id: 'e2', photo_file_id: 'f2', photo_thumb_b64: 'BBBB' },
      // An employee whose thumbnail exists but has no file id — the server
      // compares `known->>id IS DISTINCT FROM photo_file_id`, and null vs null
      // is NOT distinct, so this must not be re-sent either.
      { employee_id: 'e3', photo_file_id: null, photo_thumb_b64: 'CCCC' },
    ],
    removed: [],
  });

  // Every employee that has a thumbnail is represented in the id map, which is
  // the whole payload of the next request.
  assert.deepEqual(Object.keys(merged.fileIdsByEmployeeId).sort(), ['e1', 'e2', 'e3']);
  assert.equal(merged.fileIdsByEmployeeId.e3, null);

  // Feeding it back with nothing changed is a no-op, not a reset.
  const unchanged = mergePhotoUpdates(merged, { full: false, photos: [], removed: [] });
  assert.deepEqual(unchanged.byEmployeeId, merged.byEmployeeId);
  assert.deepEqual(unchanged.fileIdsByEmployeeId, merged.fileIdsByEmployeeId);

  // And a real change still applies on top of it.
  const replaced = mergePhotoUpdates(merged, {
    full: false,
    photos: [{ employee_id: 'e2', photo_file_id: 'f2-new', photo_thumb_b64: 'ZZZZ' }],
    removed: ['e1'],
  });
  assert.equal(replaced.byEmployeeId.e2, 'ZZZZ');
  assert.equal(replaced.fileIdsByEmployeeId.e2, 'f2-new');
  assert.equal('e1' in replaced.byEmployeeId, false);
  assert.equal('e1' in replaced.fileIdsByEmployeeId, false);
});
