// The freshness gate, applied to the seven list pages that did not have one,
// and the alerts badge no longer asking what the Dashboard just answered.
//
// WHY THESE PAGES AND NOT OTHERS. Dashboard, Employee Manager and Settings
// got a gate when Settings was measured at 20 of 41 requests in one session.
// Everything else kept refetching on every nav click, because the router
// calls each page's render function unconditionally. Attendance was the worst
// of them: `renderAttendance()` ended in a bare `await load()` and `load()`
// always fired report + summary.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isFresh, markFetched, invalidate, invalidateAll, PAGE_MAX_AGE_MS,
} from '../JS/Utils/freshness.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../JS/${p}`, import.meta.url)), 'utf8');
const code = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

// Every page the router can land on that fetches rows, with the key it uses.
const GATED = [
  ['Features/Attendance/AttendancePage.js', 'attendanceKey()'],
  ['Features/Analytics/AnalyticsPage.js', 'analyticsKey()'],
  ['Features/Audit/AuditLogPage.js', 'AUDIT_KEY'],
  ['Features/Exports/ExportTasksPage.js', 'exportsKey()'],
  ['Features/Proximity/ProximityPage.js', 'PROXIMITY_KEY'],
  ['Features/Users/UsersPage.js', 'USERS_KEY'],
  ['Features/Alerts/AlertsPage.js', 'alertsKey()'],
];

// ---- the shared window ----

test('there is one staleness window, and it is a minute', () => {
  assert.equal(PAGE_MAX_AGE_MS, 60 * 1000);
});

test('every gated page reads the shared window rather than its own', () => {
  for (const [file] of GATED) {
    const src = code(read(file));
    assert.match(src, /PAGE_MAX_AGE_MS/, `${file} must import the shared window`);
    assert.ok(!/const \w*MAX_AGE_MS\s*=\s*\d/.test(src),
      `${file} declares its own window — that is how the previous two drifted`);
  }
});

test('every gated page actually consults the gate and records a fetch', () => {
  for (const [file, key] of GATED) {
    const src = code(read(file));
    assert.ok(src.includes(`isFresh(${key}, PAGE_MAX_AGE_MS)`),
      `${file} imports the window but never checks it against ${key}`);
    assert.ok(src.includes(`markFetched(${key})`),
      `${file} never records a successful fetch, so the gate can never hit`);
  }
});

// A gate with no escape hatch is a bug report waiting to happen: someone who
// believes a list is behind must never be told to wait a minute.
test('the pages with a Refresh button force past the gate', () => {
  for (const file of ['Features/Alerts/AlertsPage.js', 'Features/Exports/ExportTasksPage.js']) {
    const src = code(read(file));
    assert.match(src, /load\(\{ force: true \}\)/,
      `${file} has a Refresh button that must bypass the cache`);
  }
});

// THE FAILURE THIS PREVENTS. With a gate in place, a mutation that re-renders
// without invalidating repaints the stale cache — so the edit saves and then
// appears not to have. Directory already solved this with reloadDirectory();
// the two pages that pass their render function as a modal callback need the
// same wrapper.
test('mutation callbacks invalidate instead of re-rendering straight', () => {
  const users = code(read('Features/Users/UsersPage.js'));
  assert.match(users, /function reloadUsers\(\)[\s\S]*invalidate\(USERS_KEY\)/);
  assert.ok(!/openUserModal\([^)]*,\s*renderUsers\)/.test(users),
    'a modal callback of renderUsers would repaint the stale cache');

  const prox = code(read('Features/Proximity/ProximityPage.js'));
  assert.match(prox, /function reloadProximity\(\)[\s\S]*invalidate\(PROXIMITY_KEY\)/);
  assert.ok(!/openCardModal\(renderProximity\)/.test(prox));
  assert.ok(!/\}, renderProximity\)\)/.test(prox));
});

// Acknowledging changes what BOTH toggle states answer, so one key is not
// enough — "show acknowledged" off and on are separate cached questions.
test('acknowledging an alert invalidates both toggle states', () => {
  const src = code(read('Features/Alerts/AlertsPage.js'));
  assert.match(src, /function invalidateAlerts\(\)[\s\S]*alerts:all[\s\S]*alerts:unread/);
  const acks = src.match(/invalidateAlerts\(\);/g) || [];
  assert.ok(acks.length >= 2, 'both the per-row acknowledge and Acknowledge all must invalidate');
});

// Marking a failed fetch would hold the error on screen for the whole window
// with no way to retry but waiting.
test('a failed load is not recorded as fresh', () => {
  const analytics = code(read('Features/Analytics/AnalyticsPage.js'));
  assert.match(analytics, /if \(!error\) markFetched\(analyticsKey\(\)\)/);

  const att = code(read('Features/Attendance/AttendancePage.js'));
  const body = att.slice(att.indexOf('async function load'));
  assert.ok(body.indexOf('rowsRes.error') < body.indexOf('markFetched(attendanceKey())'),
    'Attendance must mark only past its error return');
});

// The key carries the question. A filter or page change therefore misses
// naturally, with no invalidate() call to forget.
test('parameterised pages put the parameters in the key', () => {
  assert.match(code(read('Features/Attendance/AttendancePage.js')),
    /attendanceKey = \(\) => `attendance:\$\{JSON\.stringify\(currentQuery\(\)\)\}:\$\{page\}:\$\{pageSize\}`/);
  assert.match(code(read('Features/Analytics/AnalyticsPage.js')),
    /analyticsKey = \(\) => `analytics:\$\{selectedDays\}`/);
  assert.match(code(read('Features/Exports/ExportTasksPage.js')),
    /exportsKey = \(\) => `exports:\$\{page\}:\$\{pageSize\}`/);
});

// ---- the gate itself, exercised rather than asserted ----

test('a page revisited inside the window does not refetch', () => {
  invalidateAll();
  const key = 'attendance:{"from":"2026-11-01"}:1:50';
  assert.equal(isFresh(key, PAGE_MAX_AGE_MS), false, 'never fetched');
  markFetched(key);
  assert.equal(isFresh(key, PAGE_MAX_AGE_MS), true);
  invalidate(key);
  assert.equal(isFresh(key, PAGE_MAX_AGE_MS), false, 'a mutation must reopen it');
});

test('a different question is a different key, with no invalidate needed', () => {
  invalidateAll();
  markFetched('analytics:7');
  assert.equal(isFresh('analytics:7', PAGE_MAX_AGE_MS), true);
  assert.equal(isFresh('analytics:30', PAGE_MAX_AGE_MS), false);
});

// ---- the alerts badge ----

const badge = code(read('Core/alertsBadge.js'));

test('the badge can be painted from a count someone else fetched', () => {
  assert.match(badge, /export function setAlertsBadgeCount/);
  assert.match(badge, /suppliedAt = Date\.now\(\)/);
});

// 144 requests and 144 log lines a day, per tab, for an integer that was in
// the last Dashboard response.
test('the badge skips its own poll when a count arrived more recently', () => {
  assert.match(badge, /if \(recentlySupplied\(\)\) return;/);
  assert.match(badge, /now - suppliedAt < POLL_MS/);
  const visibility = badge.slice(badge.indexOf('visibilityHandler = ()'));
  assert.match(visibility, /recentlySupplied\(\)/,
    'the focus refresh must respect it too, or every Alt-Tab costs a request');
});

// A route check would need editing again for a second supplier, and would
// leave the badge frozen if the Dashboard stopped ticking.
test('suppression is a timestamp, not a route check', () => {
  assert.ok(!/appState\.route/.test(badge),
    'coupling this to the route makes a stalled Dashboard freeze the badge silently');
});

test('signing out clears the supplier timestamp', () => {
  const stop = badge.slice(badge.indexOf('export function stopAlertsBadge'));
  assert.match(stop, /suppliedAt = 0/,
    "the next account's first poll must not be suppressed by the previous one's count");
});

test('the dashboard feeds the badge only when the tick carries a count', () => {
  const dash = code(read('Features/Dashboard/DashboardPage.js'));
  assert.match(dash, /setAlertsBadgeCount\(t\.data\.unread_alerts\)/);
  assert.match(dash, /t\.data\?\.unread_alerts !== undefined/,
    'a project without the migration must leave the badge polling, not paint undefined');
});

// ---- the migration ----

const mig = readFileSync(fileURLToPath(
  new URL('../Supabase/migrations/20261111180000_tick_carries_unread_alerts.sql', import.meta.url),
), 'utf8').split('\n').map((l) => {
  const at = l.indexOf('--');
  return at === -1 ? l : l.slice(0, at);
}).join('\n');

test('the tick carries the unread count', () => {
  assert.match(mig, /'unread_alerts', public\.get_unread_alert_count\(\)/);
});

test('nothing the old client reads was moved', () => {
  assert.match(mig, /public\.get_dashboard_pulse\(p_window_hours\)/);
  assert.match(mig, /'roster', public\.get_onsite_roster_delta\(p_since, p_stale_hours\)/);
  assert.match(mig, /CREATE OR REPLACE FUNCTION public\.get_dashboard_tick/);
  assert.ok(!/DROP\s+FUNCTION[^;]*get_dashboard_tick/i.test(mig),
    'same signature and return type — no DROP, and either side can ship first');
});

// get_unread_alert_count() returns 0 for anyone who is not admin or manager,
// so merging it into an invoker-rights function widens nothing.
test('the tick stays SECURITY INVOKER', () => {
  assert.match(mig, /SECURITY INVOKER/);
  assert.ok(!/SECURITY DEFINER/.test(mig));
});
