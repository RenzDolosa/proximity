// The app has exactly three top-level "screens" (#auth-screen, #shell,
// #standalone-scanner) and only one is ever visible at a time. This module
// owns that switch so main.js's auth-state handler stays a one-liner.
import { $, $$ } from '../Utils/dom.js';
import { appState, isAdmin, canViewEmployeeManager, canViewScanner } from './state.js';
import { render } from './router.js';

export function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#shell').classList.add('hidden');
  $('#standalone-scanner').classList.add('hidden');
}

export function showShell() {
  $('#auth-screen').classList.add('hidden');
  $('#standalone-scanner').classList.add('hidden');
  $('#shell').classList.remove('hidden');
  $('#who-name').textContent = appState.profile?.full_name || appState.session.user.email;
  $('#who-role').textContent = appState.profile?.role || '—';
  $('#nav-users').classList.toggle('hidden', !isAdmin());
  $('button[data-route="directory"]').classList.toggle('hidden', !canViewEmployeeManager());
  $('button[data-route="proximity"]').classList.toggle('hidden', !canViewEmployeeManager());
  $('button[data-route="scanner"]').classList.toggle('hidden', !canViewScanner());
  // land on the first route this account is actually allowed to see
  if (appState.route === 'directory' && !canViewEmployeeManager()) appState.route = canViewScanner() ? 'scanner' : 'users';
  if (appState.route === 'scanner' && !canViewScanner()) appState.route = canViewEmployeeManager() ? 'directory' : 'users';
  $$('nav.rail button[data-route]').forEach((b) => b.classList.toggle('active', b.dataset.route === appState.route));
  render();
}

// showStandaloneScanner is wired up in Features/Scanner/StandaloneScanner.js
// and re-exported here to avoid a circular import between screens.js and
// the Scanner feature (which itself needs showAuth-style sign-out wiring).
export { showStandaloneScanner } from '../Features/Scanner/StandaloneScanner.js';
