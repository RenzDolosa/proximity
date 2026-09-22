import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCachedScan, flushQueuedScans, groupQueuedScans } from '../JS/Core/offlineScanning.js';

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
