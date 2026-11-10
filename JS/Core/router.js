import { $, $$ } from '../Utils/dom.js';
import { appState } from './state.js';
import { setRoute as meterSetRoute } from './requestLog.js';
import { ROUTE_TITLES } from './navGroups.js';
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
import { renderExportTasks } from '../Features/Exports/ExportTasksPage.js';
import { renderMuster } from '../Features/Muster/MusterPage.js';

// Moved to Core/navGroups.js so the command palette can offer the same
// destinations without importing this module, which pulls in every feature
// page. One definition, two readers.
const titles = ROUTE_TITLES;

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
  // Pushed, not pulled: Core/state.js imports supabaseClient.js, which
  // imports the meter, so the meter reaching back for appState.route would
  // close an import cycle. Set before the render call below, so every request
  // that render triggers is attributed to the screen that triggered it.
  meterSetRoute(appState.route);
  if (appState.route === 'dashboard') renderDashboard();
  if (appState.route === 'muster') renderMuster();
  if (appState.route === 'alerts') renderAlerts();
  if (appState.route === 'directory') renderDirectory();
  if (appState.route === 'proximity') renderProximity();
  if (appState.route === 'scanner') renderTestScan();
  if (appState.route === 'analytics') renderAnalytics();
  if (appState.route === 'attendance') renderAttendance();
  if (appState.route === 'users') renderUsers();
  if (appState.route === 'settings') renderSettings();
  if (appState.route === 'exports') renderExportTasks();
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