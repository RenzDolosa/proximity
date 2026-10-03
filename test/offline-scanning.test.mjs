import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCachedScan, flushQueuedScans, groupQueuedScans, mergePhotoUpdates } from '../JS/Core/offlineScanning.js';

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
