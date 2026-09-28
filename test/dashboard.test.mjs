import test from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../JS/Utils/dashboard.js';
import * as access from '../JS/Core/accessControl.js';

const roster = [
  { full_name: 'Ana Cruz', employee_code: 'E001', department: 'Ops', is_stale: false },
  { full_name: 'Ben Lim', employee_code: 'E002', department: 'Ops', is_stale: false },
  { full_name: 'Cy Diaz', employee_code: 'E003', department: null, is_stale: false },
  { full_name: 'Di Reyes', employee_code: 'E004', department: 'HR', is_stale: true },
  { full_name: 'Ed Sy', employee_code: 'E005', department: 'HR', is_stale: false, status: 'inactive' },
];

test('summarizeRoster counts live vs stale and groups live by department', () => {
  const s = d.summarizeRoster(roster);
  assert.equal(s.total, 5);
  assert.equal(s.live, 3);
  assert.equal(s.stale, 1);
  assert.deepEqual(s.byDepartment, [
    { department: 'Ops', count: 2 },
    { department: 'Unassigned', count: 1 },
  ]);
});

test('inactive employees never count as on site or stale, but show under "all"', () => {
  const s = d.summarizeRoster(roster);
  assert.equal(s.live, 3);
  assert.equal(s.stale, 1);
  assert.ok(d.filterRoster(roster, { view: 'all' }).some((r) => r.employee_code === 'E005'));
  assert.ok(!d.filterRoster(roster).some((r) => r.employee_code === 'E005'));
});

test('summarizeRoster tolerates non-array input', () => {
  assert.deepEqual(d.summarizeRoster(null), { total: 0, live: 0, stale: 0, byDepartment: [] });
});

test('filterRoster: default view hides stale, stale view shows only stale', () => {
  assert.equal(d.filterRoster(roster).length, 3);
  assert.deepEqual(d.filterRoster(roster, { view: 'stale' }).map((r) => r.employee_code), ['E004']);
  assert.equal(d.filterRoster(roster, { view: 'all' }).length, 5);
});

test('filterRoster: query matches name or code, department is exact', () => {
  assert.deepEqual(d.filterRoster(roster, { query: ' ana ' }).map((r) => r.employee_code), ['E001']);
  assert.deepEqual(d.filterRoster(roster, { query: 'e002' }).map((r) => r.employee_code), ['E002']);
  assert.deepEqual(d.filterRoster(roster, { department: 'HR', view: 'all' }).map((r) => r.employee_code), ['E004', 'E005']);
});

test('severity, kind and badge helpers', () => {
  assert.equal(d.severityBadgeClass('critical'), 'inactive_card');
  assert.equal(d.severityBadgeClass('info'), 'matched');
  assert.equal(d.severityBadgeClass('???'), 'unassigned_card');
  assert.equal(d.alertKindLabel('unknown_card_scan'), 'Unknown card scan');
  assert.equal(d.alertKindLabel(undefined), 'Alert');
  assert.equal(d.fmtBadgeCount(0), '');
  assert.equal(d.fmtBadgeCount(-3), '');
  assert.equal(d.fmtBadgeCount(7), '7');
  assert.equal(d.fmtBadgeCount(10), '9+');
  assert.equal(d.fmtBadgeCount(NaN), '');
});

test('scannerState: disabled beats everything, 10-minute online window', () => {
  const now = Date.parse('2026-09-28T10:00:00Z');
  assert.equal(d.scannerState({ is_enabled: false, last_seen_at: '2026-09-28T09:59:00Z' }, now), 'disabled');
  assert.equal(d.scannerState({ is_enabled: true, last_seen_at: '2026-09-28T09:55:00Z' }, now), 'online');
  assert.equal(d.scannerState({ is_enabled: true, last_seen_at: '2026-09-28T09:49:00Z' }, now), 'offline');
  assert.equal(d.scannerState({ is_enabled: true, last_seen_at: null }, now), 'never');
  assert.equal(d.scannerState(null, now), 'disabled');
});

test('dashboard/alerts are admin+manager only; scanner registry edit is admin only', () => {
  const viewer = { role: 'viewer', access_scope: 'all' };
  const manager = { role: 'manager', access_scope: 'scanner' };
  const admin = { role: 'admin', access_scope: null };
  assert.equal(access.canViewDashboard(viewer), false);
  assert.equal(access.canViewAlerts(viewer), false);
  assert.equal(access.canViewDashboard(manager), true);
  assert.equal(access.canViewAlerts(admin), true);
  assert.equal(access.canViewScannerRegistry(manager), true);
  assert.equal(access.canViewScannerRegistry({ role: 'viewer', access_scope: 'employee_manager' }), false);
  assert.equal(access.canEditScannerRegistry(manager), false);
  assert.equal(access.canEditScannerRegistry(admin), true);
});
