// Sidebar structure, grouped by what someone came here to do rather than by
// the order features happened to be built in.
//
// The old rail was one flat list of eight plus a pinned pair at the bottom,
// which put Test Scan between Proximity Cards and Scanner Analytics — a tool
// wedged between a record and a report. Grouping costs four short labels and
// makes the list scannable: you look for the verb, not the feature name.
//
// Test Scan sits under Manage on purpose. It is the step straight after
// issuing a card ("does this one work?"), so it belongs next to Proximity
// Cards, not next to the analytics page it merely sounds like.
//
// Administration stays last, which keeps Settings and Audit Log roughly where
// muscle memory expects them without needing the old pinned-bottom rail.
export const NAV_GROUPS = Object.freeze([
  { id: 'monitor', label: 'Monitor', routes: ['dashboard', 'alerts'] },
  { id: 'manage', label: 'Manage', routes: ['directory', 'proximity', 'scanner'] },
  { id: 'reports', label: 'Reports', routes: ['attendance', 'analytics'] },
  { id: 'admin', label: 'Administration', routes: ['users', 'settings', 'audit'] },
].map((g) => Object.freeze({ ...g, routes: Object.freeze(g.routes) })));

// Every route in the sidebar, in display order. Used by the tests to assert
// the groups cover the router exactly — a route added to one and not the
// other is the failure this guards.
export const GROUPED_ROUTES = Object.freeze(NAV_GROUPS.flatMap((g) => [...g.routes]));

// Which groups still have something in them for this account.
//
// Access control hides individual buttons, so a VIEWER can empty a whole
// group — and a lone "Reports" heading above nothing reads as a bug. Pure, so
// the hiding rule is tested rather than eyeballed.
export function visibleGroups(isRouteVisible) {
  return NAV_GROUPS
    .map((group) => ({ ...group, routes: group.routes.filter((r) => isRouteVisible(r)) }))
    .filter((group) => group.routes.length > 0);
}

// Group ids that should be hidden, for the DOM half to toggle directly.
export function hiddenGroupIds(isRouteVisible) {
  const shown = new Set(visibleGroups(isRouteVisible).map((g) => g.id));
  return NAV_GROUPS.map((g) => g.id).filter((id) => !shown.has(id));
}
