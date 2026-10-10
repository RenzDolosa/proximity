import { $, $$ } from '../Utils/dom.js';
import { appState } from './state.js';
import { renderDashboard } from '../Features/Dashboard/DashboardPage.js';
import { renderAlerts } from '../Features/Alerts/AlertsPage.js';
import { renderDirectory } from '../Features/Directory/DirectoryPage.js';
import { renderProximity } from '../Features/Proximity/ProximityPage.js';
import { renderTestScan } from '../Features/Scanner/TestScanPage.js';
import { renderAnalytics } from '../Features/Analytics/AnalyticsPage.js';
import { renderAttendance } from '../Features/Attendance/AttendancePage.js';
import { renderUsers } from '../Features/Users/UsersPage.js';
import { renderSettings } from '../Features/Settings/SettingsPage.js';
import { renderAuditLog } from '../Features/Audit/AuditLogPage.js';

const titles = {
  dashboard: ['Dashboard', 'Who is on site right now, plus scanner and card health'],
  alerts: ['Alerts', 'Server-raised warnings — acknowledge them once handled'],
  directory: ['Employee Manager', 'View and edit the employee directory'],
  proximity: ['Proximity Cards', 'Issue and revoke proximity IDs, linked to employees'],
  scanner: ['Test Scan', 'Try a proximity ID against the live directory — results here are not logged'],
  analytics: ['Scanner Analytics', 'Scan activity, match rates, and per-scanner health over time'],
  attendance: ['Attendance', 'Daily first IN, last OUT, and time on site per employee'],
  users: ['Users & Roles', 'Manage login accounts and permission tiers'],
  settings: ['Settings', 'App-wide configuration'],
  audit: ['Audit Log', 'Who did what — destructive and permission-changing actions only'],
};

export function render() {
  // Keep the hash in sync even when the route changed programmatically
  // (e.g. showShell() bouncing an account off a route it can't view) so a
  // reload always lands back on whatever's actually on screen.
  if (location.hash.replace('#', '') !== appState.route) {
    history.replaceState(null, '', `#${appState.route}`);
  }
  $$('nav.rail button[data-route], #bottom-nav button[data-route]')
    .forEach((b) => b.classList.toggle('active', b.dataset.route === appState.route));
  const [title, sub] = titles[appState.route];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  if (appState.route === 'dashboard') renderDashboard();
  if (appState.route === 'alerts') renderAlerts();
  if (appState.route === 'directory') renderDirectory();
  if (appState.route === 'proximity') renderProximity();
  if (appState.route === 'scanner') renderTestScan();
  if (appState.route === 'analytics') renderAnalytics();
  if (appState.route === 'attendance') renderAttendance();
  if (appState.route === 'users') renderUsers();
  if (appState.route === 'settings') renderSettings();
  if (appState.route === 'audit') renderAuditLog();
}

export function initRouter() {
  $$('nav.rail button[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.route = btn.dataset.route;
      render();
    });
  });
}