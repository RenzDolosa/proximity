import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILTERS, resultLabel, isKnownFilter, canDrillDown, detailsTitle, capNotice,
} from '../JS/Utils/scanDetails.js';

test('every filter the UI can send is one the RPC accepts', () => {
  // Mirror of the closed list in get_scanner_scan_details() — if this test
  // needs editing, the migration's list needs the same edit.
  const rpcList = ['all', 'matched', 'unmatched', 'inactive_card', 'inactive_employee', 'unassigned_card', 'offline'];
  assert.deepEqual(Object.keys(FILTERS).sort(), [...rpcList].sort());
  assert.equal(isKnownFilter('matched'), true);
  assert.equal(isKnownFilter('x; drop table employees'), false);
  assert.equal(isKnownFilter('toString'), false); // prototype keys are not filters
});

test('zero-count cards are not drill-down targets', () => {
  assert.equal(canDrillDown(0), false);
  assert.equal(canDrillDown('0'), false);
  assert.equal(canDrillDown(undefined), false);
  assert.equal(canDrillDown(NaN), false);
  assert.equal(canDrillDown(2), true);
  assert.equal(canDrillDown('80'), true);
});

test('titles name the filter and, when set, the scanner', () => {
  assert.equal(detailsTitle({ filter: 'offline' }), 'Scans captured offline');
  assert.equal(detailsTitle({ filter: 'all', scannerId: 'Krus3K - Scanner 1' }), 'All scans — Krus3K - Scanner 1');
  assert.equal(detailsTitle({ filter: 'nonsense' }), 'All scans');
  assert.equal(detailsTitle(), 'All scans');
});

test('result labels fall back to the raw value rather than hiding it', () => {
  assert.equal(resultLabel('inactive_employee'), 'Inactive employee');
  assert.equal(resultLabel('brand_new_result'), 'brand_new_result');
  assert.equal(resultLabel(null), '—');
});

test('cap notice only appears when rows were actually cut off', () => {
  assert.equal(capNotice(80, 80), '');
  assert.equal(capNotice(500, 500), '');
  assert.match(capNotice(500, 2215), /500 of 2215/);
  assert.equal(capNotice(5, NaN), '');
});
