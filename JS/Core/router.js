import { $, $$ } from '../Utils/dom.js';
import { appState } from './state.js';
import { renderDirectory } from '../Features/Directory/DirectoryPage.js';
import { renderProximity } from '../Features/Proximity/ProximityPage.js';
import { renderTestScan } from '../Features/Scanner/TestScanPage.js';
import { renderUsers } from '../Features/Users/UsersPage.js';

const titles = {
  directory: ['Employee Manager', 'View and edit the employee directory'],
  proximity: ['Proximity Cards', 'Issue and revoke proximity IDs, linked to employees'],
  scanner: ['Test Scan', 'Try a proximity ID against the live directory — results here are not logged'],
  users: ['Users & Roles', 'Manage login accounts and permission tiers'],
};

export function render() {
  // Keep the hash in sync even when the route changed programmatically
  // (e.g. showShell() bouncing an account off a route it can't view) so a
  // reload always lands back on whatever's actually on screen.
  if (location.hash.replace('#', '') !== appState.route) {
    history.replaceState(null, '', `#${appState.route}`);
  }
  $$('nav.rail button[data-route]').forEach((b) => b.classList.toggle('active', b.dataset.route === appState.route));
  const [title, sub] = titles[appState.route];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  if (appState.route === 'directory') renderDirectory();
  if (appState.route === 'proximity') renderProximity();
  if (appState.route === 'scanner') renderTestScan();
  if (appState.route === 'users') renderUsers();
}

export function initRouter() {
  $$('nav.rail button[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      appState.route = btn.dataset.route;
      render();
    });
  });
}
