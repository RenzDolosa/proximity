// Exporting the Alerts list.
//
// WHAT MAKES IT FREE. AlertsPage already holds the rows it is showing —
// paint() renders them and rowsCache keeps them across a nav-away. The
// export reads that same array, so it costs no request, no bytes and no log
// line. Every export in this app works that way except "Export all scan
// logs", which pages the database and is the only one in the export ledger.
//
// WHAT THAT COSTS INSTEAD, and the thing these tests mostly guard: an export
// of what is loaded is an export of one get_alerts() page — 100 rows by
// default, against 422 alerts on the live project. A file called
// `alerts-2026-11-19.xlsx` holding the newest quarter of the table invites
// precisely the wrong conclusion, so the count is in the filename and in the
// toast.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALERT_EXPORT_COLUMNS, alertExportRows, alertExportFilename, detailRest,
} from '../JS/Utils/alertExport.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const page = read('../JS/Features/Alerts/AlertsPage.js');

// A real row, shaped like the ones in the screenshot.
const openPunch = {
  id: 'a1',
  created_at: '2026-11-19T02:20:00Z',
  severity: 'warning',
  kind: 'open_punch',
  message: 'Wennelyn Enilog scanned in 12+ hours ago and has not scanned out',
  detail: {
    hours: 12,
    in_at: '2026-11-17T13:53:12.700092+00:00',
    full_name: 'Wennelyn Enilog',
    department: 'Qrt',
    scanner_id: 'Krus3K - Scanner 1',
    employee_id: 'a5682f1e-eb1b-4fe4-855a-f4d6ba89011a',
    employee_code: '5567',
  },
  acknowledged_at: '2026-11-19T03:00:00Z',
  acknowledged_by_name: 'Zar Dela Cruz',
};

// ---- the shape ----

test('every column maps to a key the rows actually carry', () => {
  const [row] = alertExportRows([openPunch]);
  for (const c of ALERT_EXPORT_COLUMNS) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, c.key), `no row key for column ${c.key}`);
  }
});

test('the filterable fields are promoted out of detail into real columns', () => {
  const [row] = alertExportRows([openPunch]);
  assert.equal(row.employee_code, '5567');
  assert.equal(row.full_name, 'Wennelyn Enilog');
  assert.equal(row.department, 'Qrt');
  assert.equal(row.scanner_id, 'Krus3K - Scanner 1');
});

// Excel reads 5567 and 0005204037 as numbers and drops leading zeros. Same
// convention every other export here follows.
test('code columns are forced to text so Excel cannot renumber them', () => {
  for (const key of ['employee_code', 'proximity_code']) {
    const col = ALERT_EXPORT_COLUMNS.find((c) => c.key === key);
    assert.ok(col, `missing column ${key}`);
    assert.equal(col.text, true, `${key} must be text, or leading zeros are lost`);
  }
});

test('promoted keys do not also appear in the details cell', () => {
  const [row] = alertExportRows([openPunch]);
  assert.ok(!/employee_code|full_name|department|scanner_id/.test(row.details),
    'a value in two columns is a value somebody will filter on twice');
  assert.match(row.details, /hours: 12/);
  assert.match(row.details, /in at:/, 'underscores are readable as spaces in a cell');
});

test('acknowledged state is a word, not an empty timestamp to infer from', () => {
  const [acked] = alertExportRows([openPunch]);
  assert.equal(acked.status, 'Acknowledged');
  assert.equal(acked.acknowledged_by, 'Zar Dela Cruz');
  const [unread] = alertExportRows([{ ...openPunch, acknowledged_at: null, acknowledged_by_name: null }]);
  assert.equal(unread.status, 'Unread');
  assert.equal(unread.acknowledged_at, '');
  assert.equal(unread.acknowledged_by, '');
});

// The sheet must agree with the screen about when something happened.
test('timestamps are formatted by the same function the table uses', () => {
  const [row] = alertExportRows([openPunch], { fmt: () => 'Nov 19, 10:20 AM' });
  assert.equal(row.when, 'Nov 19, 10:20 AM');
  assert.equal(row.acknowledged_at, 'Nov 19, 10:20 AM');
});

test('the kind is exported as its label, not its raw string', () => {
  const [row] = alertExportRows([openPunch], { kindLabel: (k) => (k === 'open_punch' ? 'Open punch' : k) });
  assert.equal(row.kind, 'Open punch');
});

// ---- not throwing on anything the server might send ----

test('a missing or malformed detail produces empty cells, not a crash', () => {
  for (const detail of [null, undefined, 'a string', 42, []]) {
    const [row] = alertExportRows([{ ...openPunch, detail }]);
    assert.equal(row.details, '');
    assert.equal(row.employee_code, '');
  }
});

test('nullish and non-array input yields no rows rather than throwing', () => {
  for (const input of [null, undefined, 'rows', 7, {}]) {
    assert.deepEqual(alertExportRows(input), []);
  }
});

test('null values inside detail are dropped rather than printed as "null"', () => {
  assert.equal(detailRest({ a: null, b: undefined, c: '', d: 1 }), 'd: 1');
});

test('a nested object in detail is still legible in one cell', () => {
  assert.match(detailRest({ nested: { x: 1 } }), /nested: \{"x":1\}/);
});

// ---- the filename says what is in the file ----

test('the row count and scope are in the filename', () => {
  assert.equal(alertExportFilename(100, { showAcked: false, stamp: '2026-11-19' }),
    'alerts-unread-100-2026-11-19');
  assert.equal(alertExportFilename(42, { showAcked: true, stamp: '2026-11-19' }),
    'alerts-all-42-2026-11-19');
});

// Number(null) is 0 and 0 is finite — but here 0 is also a meaningful count,
// so the guard is on type rather than on value.
test('a nonsense count becomes 0, never NaN or undefined in a filename', () => {
  for (const bad of [null, undefined, NaN, '100', -5]) {
    assert.match(alertExportFilename(bad), /^alerts-unread-0/, `count ${String(bad)} leaked into the name`);
  }
});

// ---- the wiring ----

test('the export reads the loaded rows and makes no request', () => {
  const from = page.indexOf('function exportLoaded');
  const to = page.indexOf('async function ackAll', from);
  assert.ok(from !== -1 && to > from, 'could not isolate exportLoaded');
  const fn = page.slice(from, to);
  assert.match(fn, /alertExportRows\(rowsCache/, 'it must export what paint() already rendered');
  assert.ok(!/AlertsModel|supabase|await /.test(fn),
    'fetching here would turn a free export into a request and a log line');
});

// A file holding 100 of 422 alerts without saying so is worse than no export.
test('the operator is told the export is only what is loaded', () => {
  const from = page.indexOf('function exportLoaded');
  const to = page.indexOf('async function ackAll', from);
  assert.match(page.slice(from, to), /loaded on this page/);
});

test('the button cannot offer a download of nothing', () => {
  assert.match(page, /exportBtn\.disabled = rows\.length === 0/);
  assert.match(page, /id="al-export" disabled/, 'it starts disabled, before the first load');
});

// This one is NOT in the export ledger, deliberately: start+finish would be
// two requests and two log events, which is the cost this export exists to
// avoid. Only ExportScanLogsModal, which pages the database, is recorded.
test('no export task is recorded for a client-side export', () => {
  assert.ok(!/ExportTasksModel/.test(page),
    'a ledger entry would cost two requests for an export that otherwise costs none');
  const modal = read('../JS/Components/ExportScanLogsModal.js');
  assert.match(modal, /ExportTasksModel\.start/, 'the heavy export is still recorded');
});
