// The app has exactly three top-level "screens" (#auth-screen, #shell,
// #standalone-scanner) and only one is ever visible at a time. This module
// owns that switch so main.js's auth-state handler stays a one-liner.
import { $, $$ } from '../Utils/dom.js';
import { appState, isAdmin, canViewEmployeeManager, canViewScanner, canViewSettings, canViewAttendance, canViewDashboard, canViewAlerts } from './state.js';
import { render } from './router.js';
import { startAlertsBadge, stopAlertsBadge } from './alertsBadge.js';
import { hiddenGroupIds, bottomNavRoutes, BOTTOM_NAV_LABEL } from './navGroups.js';

export function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#shell').classList.add('hidden');
  $('#standalone-scanner').classList.add('hidden');
  stopAlertsBadge();
  // Signing out (or landing here with no session at all) previously left
  // whatever shell route hash was last in the URL untouched — e.g.
  // signing out from #users left the address bar reading .../#users while
  // the login screen was what actually showed. router.js's render() is
  // what normally keeps the hash in sync with appState.route, but it's
  // only ever called for the shell, never from here. Clearing it here,
  // once, fixes both the visible symptom and a subtler follow-on bug:
  // state.js seeds appState.route from location.hash exactly once, at
  // module load — so on a shared browser, a stale #users left over from
  // a previous session's sign-out could silently land the NEXT sign-in
  // (a different account, after a reload) straight on an admin-only page
  // instead of the default landing route. location.pathname + search is
  // kept as-is, notably including the standalone Scanner's own
  // `?scanner=1` query param — only the hash fragment is dropped.
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

// Reads the buttons' own .hidden state rather than re-deriving permissions,
// so there is exactly one place a route's visibility is decided (above) and
// this can never disagree with it. The grouping itself is in navGroups.js.
function paintNavGroups() {
  const routeVisible = (route) => {
    const btn = $(`nav.rail button[data-route="${route}"]`);
    return Boolean(btn) && !btn.classList.contains('hidden');
  };
  const hidden = new Set(hiddenGroupIds(routeVisible));
  $$('.rail-group').forEach((group) => {
    group.classList.toggle('hidden', hidden.has(group.dataset.navGroup));
  });
  paintBottomNav(routeVisible);
}

// The phone tab bar. Reuses each route's existing rail button for its icon
// and its route id, so there is exactly one place a route is defined and
// this cannot drift from the rail.
function paintBottomNav(routeVisible) {
  const bar = $('#bottom-nav');
  if (!bar) return;
  const routes = bottomNavRoutes(routeVisible);
  const tab = (route) => {
    const btn = $(`nav.rail button[data-route="${route}"]`);
    const icon = btn?.querySelector('.ic')?.textContent || '•';
    return `<button type="button" data-route="${route}">
      <span class="ic" aria-hidden="true">${icon}</span>
      <span class="bn-label">${BOTTOM_NAV_LABEL[route] || route}</span>
    </button>`;
  };
  bar.innerHTML = routes.map(tab).join('')
    // "More" opens the existing drawer rather than a second navigation
    // surface — one list of routes, two ways in.
    + `<button type="button" id="bn-more"><span class="ic" aria-hidden="true">☰</span><span class="bn-label">More</span></button>`;
  $$('button[data-route]', bar).forEach((b) => b.addEventListener('click', () => {
    appState.route = b.dataset.route;
    render();
  }));
  $('#bn-more', bar).addEventListener('click', () => $('#nav-toggle')?.click());
}

export function showShell() {
  $('#auth-screen').classList.add('hidden');
  $('#standalone-scanner').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  $('#who-name').textContent = appState.profile?.full_name || appState.session.user.email;
  $('#who-role').textContent = appState.profile?.role || '—';
  $('#nav-users').classList.toggle('hidden', !isAdmin());
  $('#nav-settings').classList.toggle('hidden', !canViewSettings());
  $('#nav-audit').classList.toggle('hidden', !isAdmin());
  $('button[data-route="dashboard"]').classList.toggle('hidden', !canViewDashboard());
  $('button[data-route="alerts"]').classList.toggle('hidden', !canViewAlerts());
  $('button[data-route="directory"]').classList.toggle('hidden', !canViewEmployeeManager());
  $('button[data-route="proximity"]').classList.toggle('hidden', !canViewEmployeeManager());
  $('button[data-route="scanner"]').classList.toggle('hidden', !canViewScanner());
  $('button[data-route="analytics"]').classList.toggle('hidden', !canViewScanner());
  $('button[data-route="attendance"]').classList.toggle('hidden', !canViewAttendance());
  paintNavGroups();
  // land on the first route this account is actually allowed to see
  if ((appState.route === 'dashboard' && !canViewDashboard()) || (appState.route === 'alerts' && !canViewAlerts())) appState.route = canViewEmployeeManager() ? 'directory' : (canViewScanner() ? 'scanner' : (canViewSettings() ? 'settings' : (isAdmin() ? 'audit' : 'users')));
  if (appState.route === 'directory' && !canViewEmployeeManager()) appState.route = canViewScanner() ? 'scanner' : (canViewSettings() ? 'settings' : (isAdmin() ? 'audit' : 'users'));
  if (appState.route === 'scanner' && !canViewScanner()) appState.route = canViewEmployeeManager() ? 'directory' : (canViewSettings() ? 'settings' : (isAdmin() ? 'audit' : 'users'));
  if (appState.route === 'analytics' && !canViewScanner()) appState.route = canViewEmployeeManager() ? 'directory' : (canViewSettings() ? 'settings' : (isAdmin() ? 'audit' : 'users'));
  if (appState.route === 'attendance' && !canViewAttendance()) appState.route = canViewEmployeeManager() ? 'directory' : (canViewScanner() ? 'scanner' : (canViewSettings() ? 'settings' : (isAdmin() ? 'audit' : 'users')));
  if (appState.route === 'settings' && !canViewSettings()) appState.route = canViewEmployeeManager() ? 'directory' : (canViewScanner() ? 'scanner' : (isAdmin() ? 'audit' : 'users'));
  if (appState.route === 'audit' && !isAdmin()) appState.route = canViewEmployeeManager() ? 'directory' : (canViewScanner() ? 'scanner' : (canViewSettings() ? 'settings' : 'users'));
  render();
  startAlertsBadge();
}

// showStandaloneScanner is wired up in Features/Scanner/StandaloneScanner.js
// and re-exported here to avoid a circular import between screens.js and
// the Scanner feature (which itself needs showAuth-style sign-out wiring).
export { showStandaloneScanner } from '../Features/Scanner/StandaloneScanner.js';