import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCachedPhoto, classifyCachedScan, flushQueuedScans, groupQueuedScans, mergeLookupDelta, mergePhotoUpdates, photoNeedsRefresh } from '../JS/Core/offlineScanning.js';

const matchedRow = {
  proximity_code: 'CARD-1', card_active: true, employee_id: 'employee-1',
  employee_status: 'active', scan_count: 4, full_name: 'Ari',
  employee_code: 'E-1', department: 'Ops', remarks_log: [{ resolved: false }],
};

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
