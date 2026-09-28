import test from 'node:test';
import assert from 'node:assert/strict';
import * as access from '../JS/Core/accessControl.js';
import * as att from '../JS/Utils/attendance.js';

test('attendance is admin/manager only, regardless of access scope', () => {
  assert.equal(access.canViewAttendance({ role: 'admin', access_scope: 'scanner' }), true);
  assert.equal(access.canViewAttendance({ role: 'manager', access_scope: 'scanner' }), true);
  // Viewers see employee data via scope, but attendance mirrors get_all_scan_events()'s gate.
  assert.equal(access.canViewAttendance({ role: 'viewer', access_scope: 'all' }), false);
  assert.equal(access.canViewAttendance({ role: 'viewer', access_scope: 'employee_manager' }), false);
  assert.equal(access.canViewAttendance(null), false);
});

test('status precedence: anomaly beats open beats complete', () => {
  assert.equal(att.attendanceStatus({ anomaly: true, open_punch: true }), 'anomaly');
  assert.equal(att.attendanceStatus({ anomaly: false, open_punch: true }), 'open');
  assert.equal(att.attendanceStatus({ anomaly: false, open_punch: false }), 'complete');
  assert.equal(att.attendanceStatus({}), 'complete');
});

test('fmtDuration', () => {
  assert.equal(att.fmtDuration(0), '0m');
  assert.equal(att.fmtDuration(39), '<1m');
  assert.equal(att.fmtDuration(60), '1m');
  assert.equal(att.fmtDuration(3600), '1h 00m');
  assert.equal(att.fmtDuration(5400), '1h 30m');
  assert.equal(att.fmtDuration(30833), '8h 33m');
  assert.equal(att.fmtDuration(-5), '—');
  assert.equal(att.fmtDuration(NaN), '—');
});

test('toDecimalHours rounds to 2dp and blanks invalid input', () => {
  assert.equal(att.toDecimalHours(5400), 1.5);
  assert.equal(att.toDecimalHours(30833), 8.56);
  assert.equal(att.toDecimalHours(-1), '');
  assert.equal(att.toDecimalHours(NaN), '');
});

test('range validation mirrors the RPC cap (31 days inclusive)', () => {
  assert.equal(att.daysInRange('2026-09-01', '2026-09-01'), 1);
  assert.equal(att.daysInRange('2026-09-01', '2026-10-01'), 31);
  assert.equal(att.validateRange('2026-09-01', '2026-10-01'), null);
  assert.match(att.validateRange('2026-09-01', '2026-10-02'), /31 days or less/);
  assert.match(att.validateRange('2026-09-05', '2026-09-01'), /not be before/);
  assert.match(att.validateRange('', '2026-09-01'), /both/);
  // A range spanning a DST change must not be miscounted by an hour's drift.
  assert.equal(att.daysInRange('2026-03-01', '2026-03-31'), 31);
  assert.equal(att.daysInRange('2026-10-25', '2026-11-02'), 9);
});

test('localDateString / defaultRange use the local calendar day and cover 7 days', () => {
  const d = new Date(2026, 8, 5, 0, 30); // 5 Sep 2026, 00:30 local
  assert.equal(att.localDateString(d), '2026-09-05');
  assert.deepEqual(att.defaultRange(d), { from: '2026-08-30', to: '2026-09-05' });
  assert.equal(att.daysInRange(att.defaultRange(d).from, att.defaultRange(d).to), 7);
});

const rows = [
  { employee_id: 'a', full_name: 'Ana Cruz', employee_code: 'E-001', department: 'Ops', worked_seconds: 3600, open_punch: false, anomaly: false },
  { employee_id: 'a', full_name: 'Ana Cruz', employee_code: 'E-001', department: 'Ops', worked_seconds: 1800, open_punch: true, anomaly: false },
  { employee_id: 'b', full_name: 'Ben Diaz', employee_code: 'E-002', department: 'Admin', worked_seconds: 0, open_punch: false, anomaly: true },
  { employee_id: 'c', full_name: 'Cy Tan', employee_code: 'X-9', department: null, worked_seconds: 60, open_punch: false, anomaly: false },
];

test('filterRows: name/code search, department, status, combined', () => {
  assert.equal(att.filterRows(rows, {}).length, 4);
  assert.equal(att.filterRows(rows, { query: '  ana ' }).length, 2);
  assert.equal(att.filterRows(rows, { query: 'e-002' }).length, 1);
  assert.equal(att.filterRows(rows, { department: 'Ops' }).length, 2);
  assert.equal(att.filterRows(rows, { status: 'open' }).length, 1);
  assert.equal(att.filterRows(rows, { status: 'anomaly', department: 'Admin' }).length, 1);
  assert.equal(att.filterRows(rows, { query: 'zzz' }).length, 0);
  // A null department must not crash the exact-match filter.
  assert.equal(att.filterRows(rows, { department: 'Ops', query: 'cy' }).length, 0);
});

test('summarize counts distinct employees and totals', () => {
  assert.deepEqual(att.summarize(rows), { employees: 3, days: 4, workedSeconds: 5460, open: 1, anomalies: 1 });
  assert.deepEqual(att.summarize([]), { employees: 0, days: 0, workedSeconds: 0, open: 0, anomalies: 0 });
});
