import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NAV_GROUPS, GROUPED_ROUTES, visibleGroups, hiddenGroupIds,
  bottomNavRoutes, BOTTOM_NAV_LABEL,
} from '../JS/Core/navGroups.js';
import { isMobileWidth, MOBILE_MAX_WIDTH } from '../JS/Core/navDrawer.js';

const INDEX_HTML = readFileSync(fileURLToPath(new URL('../Public/index.html', import.meta.url)), 'utf8');

// The sidebar's markup and this module have to agree. A route added to one
// and not the other is silent: the button renders but sits outside every
// group, or a group references a route that no longer exists.
test('the groups cover the sidebar markup exactly', () => {
  const inMarkup = [...INDEX_HTML.matchAll(/nav\.rail|data-route="([a-z]+)"/g)]
    .map((m) => m[1])
    .filter(Boolean);
  assert.deepEqual([...new Set(inMarkup)].sort(), [...GROUPED_ROUTES].sort());
});

test('no route is listed in two groups', () => {
  assert.equal(new Set(GROUPED_ROUTES).size, GROUPED_ROUTES.length);
});

test('every group has a label and at least one route', () => {
  for (const group of NAV_GROUPS) {
    assert.ok(group.id, 'group needs an id');
    assert.ok(group.label, `${group.id} needs a label`);
    assert.ok(group.routes.length > 0, `${group.id} needs routes`);
  }
});

// Test Scan belongs next to the card you just issued, not next to the
// analytics page it merely sounds like.
test('Test Scan sits with the cards, not with the reports', () => {
  const manage = NAV_GROUPS.find((g) => g.id === 'manage');
  const reports = NAV_GROUPS.find((g) => g.id === 'reports');
  assert.ok(manage.routes.includes('scanner'));
  assert.ok(manage.routes.includes('proximity'));
  assert.ok(!reports.routes.includes('scanner'));
});

test('administration comes last, so Settings stays where muscle memory expects', () => {
  assert.equal(NAV_GROUPS[NAV_GROUPS.length - 1].id, 'admin');
});

test('an admin who can see everything hides no group', () => {
  assert.deepEqual(hiddenGroupIds(() => true), []);
  assert.equal(visibleGroups(() => true).length, NAV_GROUPS.length);
});

// The reason this is a pure function: a lone "Reports" heading over nothing
// reads as a bug, and that is exactly what a restricted account would see.
test('a group whose every route is hidden disappears', () => {
  const canSee = (route) => !['attendance', 'analytics'].includes(route);
  assert.deepEqual(hiddenGroupIds(canSee), ['reports']);
  assert.ok(!visibleGroups(canSee).some((g) => g.id === 'reports'));
});

test('a partly visible group stays, carrying only what is visible', () => {
  const canSee = (route) => route !== 'alerts';
  const monitor = visibleGroups(canSee).find((g) => g.id === 'monitor');
  assert.deepEqual(monitor.routes, ['dashboard']);
  assert.deepEqual(hiddenGroupIds(canSee), []);
});

// A scanner-only account: Test Scan and Settings, nothing else.
test('a scanner-only account keeps just the two groups it can use', () => {
  const canSee = (route) => ['scanner', 'settings'].includes(route);
  assert.deepEqual(visibleGroups(canSee).map((g) => g.id), ['manage', 'admin']);
  assert.deepEqual(hiddenGroupIds(canSee).sort(), ['monitor', 'reports']);
});

test('an account that can see nothing hides every group', () => {
  assert.deepEqual(hiddenGroupIds(() => false).sort(), NAV_GROUPS.map((g) => g.id).sort());
  assert.deepEqual(visibleGroups(() => false), []);
});

test('visibleGroups does not mutate the shared group model', () => {
  visibleGroups((route) => route === 'dashboard');
  assert.deepEqual(NAV_GROUPS.find((g) => g.id === 'monitor').routes, ['dashboard', 'alerts']);
});

// The phone tab bar. It must never offer a route the account cannot open,
// and must never collapse to one lonely tab for a restricted login.
test('an admin gets the three routes a phone is actually opened for', () => {
  assert.deepEqual(bottomNavRoutes(() => true), ['dashboard', 'directory', 'attendance']);
});

test('a scanner-only account still gets a usable bar, backfilled in order', () => {
  const canSee = (r) => ['scanner', 'settings'].includes(r);
  const tabs = bottomNavRoutes(canSee);
  assert.deepEqual(tabs, ['scanner', 'settings']);
  assert.ok(tabs.every(canSee), 'must never offer a route the account cannot open');
});

test('a manager without the Dashboard backfills rather than showing two tabs', () => {
  const canSee = (r) => r !== 'dashboard';
  const tabs = bottomNavRoutes(canSee);
  assert.equal(tabs.length, 3);
  assert.ok(tabs.includes('directory') && tabs.includes('attendance'));
  assert.ok(!tabs.includes('dashboard'));
});

test('an account that can see nothing gets an empty bar, not a broken one', () => {
  assert.deepEqual(bottomNavRoutes(() => false), []);
});

test('every route has a tab label short enough for a tab bar', () => {
  for (const route of GROUPED_ROUTES) {
    const label = BOTTOM_NAV_LABEL[route];
    assert.ok(label, `${route} needs a short label`);
    assert.ok(label.length <= 9, `${route}: "${label}" is too long for a tab`);
  }
});

test('the drawer breakpoint is inclusive at its own width', () => {
  assert.equal(isMobileWidth(MOBILE_MAX_WIDTH), true);
  assert.equal(isMobileWidth(MOBILE_MAX_WIDTH + 1), false);
  assert.equal(isMobileWidth(375), true);   // phone
  assert.equal(isMobileWidth(768), true);   // tablet portrait
  assert.equal(isMobileWidth(1280), false); // desktop
});

// Tables-as-cards is a CSS contract that six pages opt into by adding one
// class and some data-labels. If the CSS half is edited away, those pages
// silently go back to scrolling sideways on a phone with no error anywhere.
test('the card layout keeps the contract its tables rely on', () => {
  const css = readFileSync(fileURLToPath(new URL('../CSS/components.css', import.meta.url)), 'utf8');
  const block = css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.ok(block.includes('.table-as-cards tr{'), 'rows must become cards');
  assert.ok(block.includes('display:flex;flex-direction:column'), 'rows need flex so order: works');
  assert.ok(block.includes('content:attr(data-label)'), 'cells need their label injected');
  assert.ok(block.includes('.table-as-cards td.card-title'), 'a cell must be promotable to the title');
  assert.ok(block.includes('order:-1'), 'the promoted title must sort above its siblings');
});

test('every page that opts into cards also labels its cells', () => {
  const pages = [
    'Directory/DirectoryPage', 'Proximity/ProximityPage', 'Users/UsersPage',
    'Audit/AuditLogPage', 'Attendance/AttendancePage', 'Dashboard/DashboardPage',
  ];
  for (const page of pages) {
    const src = readFileSync(fileURLToPath(new URL(`../JS/Features/${page}.js`, import.meta.url)), 'utf8');
    assert.ok(src.includes('table-as-cards'), `${page} should opt in`);
    // Without labels the cards render as a column of bare values.
    assert.ok(/data-label="/.test(src), `${page} opted in but labels no cells`);
  }
});

// Before 2026-10-08 the only mobile rule hid two topbar labels, so a 375px
// phone gave 216px of nav and 159px of content.
test('the sidebar is a drawer below the breakpoint, not a column', () => {
  const css = readFileSync(fileURLToPath(new URL('../CSS/layout.css', import.meta.url)), 'utf8');
  const mobileBlock = css.slice(css.indexOf(`@media (max-width: ${MOBILE_MAX_WIDTH}px)`));
  assert.ok(mobileBlock.includes('position:fixed'), 'drawer must leave the flex row');
  assert.ok(mobileBlock.includes('translateX(-100%)'), 'drawer must start off-screen');
  assert.ok(css.includes('#shell.nav-open #sidebar'), 'drawer needs an open state');
});
