import { $, $$ } from '../Utils/dom.js';
import { appState } from './state.js';
import { renderDirectory } from '../Features/Directory/DirectoryPage.js';
import { renderProximity } from '../Features/Proximity/ProximityPage.js';
import { renderScanner } from '../Features/Scanner/ScannerPage.js';
import { renderUsers } from '../Features/Users/UsersPage.js';

const titles = {
  directory: ['Employee Manager', 'View and edit the employee directory'],
  proximity: ['Proximity Cards', 'Issue and revoke proximity IDs, linked to employees'],
  scanner: ['Proximity Scanner', 'Scan a proximity ID to identify an employee and log the event'],
  users: ['Users & Roles', 'Manage login accounts and permission tiers'],
};

export function render() {
  const [title, sub] = titles[appState.route];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  if (appState.route === 'directory') renderDirectory();
  if (appState.route === 'proximity') renderProximity();
  if (appState.route === 'scanner') renderScanner();
  if (appState.route === 'users') renderUsers();
}

export function initRouter() {
  $$('nav.rail button[data-route]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.route === 'scanner') {
        window.open(location.pathname + '?scanner=1', '_blank', 'noopener');
        return;
      }
      appState.route = btn.dataset.route;
      $$('nav.rail button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      render();
    });
  });
}
