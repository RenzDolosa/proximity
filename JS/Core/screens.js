// The app has exactly three top-level "screens" (#auth-screen, #shell,
// #standalone-scanner) and only one is ever visible at a time. This module
// owns that switch so main.js's auth-state handler stays a one-liner.
import { $ } from '../Utils/dom.js';
import { appState, isAdmin, canViewEmployeeManager, canViewScanner, canViewSettings } from './state.js';
import { render } from './router.js';

export function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#shell').classList.add('hidden');
  $('#standalone-scanner').classList.add('hidden');
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

export function showShell() {
  $('#auth-screen').classList.add('hidden');
  $('#standalone-scanner').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  $('#who-name').textContent = appState.profile?.full_name || appState.session.user.email;
  $('#who-role').textContent = appState.profile?.role || '—';
  $('#nav-users').classList.toggle('hidden', !isAdmin());
  $('#nav-settings').classList.toggle('hidden', !canViewSettings());
  $('#nav-audit').classList.toggle('hidden', !isAdmin());
  $('button[data-route="directory"]').classList.toggle('hidden', !canViewEmployeeManager());
  $('button[data-route="proximity"]').classList.toggle('hidden', !canViewEmployeeManager());
  $('button[data-route="scanner"]').classList.toggle('hidden', !canViewScanner());
  // land on the first route this account is actually allowed to see
  if (appState.route === 'directory' && !canViewEmployeeManager()) appState.route = canViewScanner() ? 'scanner' : (canViewSettings() ? 'settings' : (isAdmin() ? 'audit' : 'users'));
  if (appState.route === 'scanner' && !canViewScanner()) appState.route = canViewEmployeeManager() ? 'directory' : (canViewSettings() ? 'settings' : (isAdmin() ? 'audit' : 'users'));
  if (appState.route === 'settings' && !canViewSettings()) appState.route = canViewEmployeeManager() ? 'directory' : (canViewScanner() ? 'scanner' : (isAdmin() ? 'audit' : 'users'));
  if (appState.route === 'audit' && !isAdmin()) appState.route = canViewEmployeeManager() ? 'directory' : (canViewScanner() ? 'scanner' : (canViewSettings() ? 'settings' : 'users'));
  render();
}

// showStandaloneScanner is wired up in Features/Scanner/StandaloneScanner.js
// and re-exported here to avoid a circular import between screens.js and
// the Scanner feature (which itself needs showAuth-style sign-out wiring).
export { showStandaloneScanner } from '../Features/Scanner/StandaloneScanner.js';