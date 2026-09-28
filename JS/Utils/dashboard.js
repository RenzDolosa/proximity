// Pure helpers for the Dashboard, Alerts and Scanner-registry screens —
// no DOM, no Supabase, so the rules for "who counts as on site", "what
// colour is this alert" and "what does the bell say" are unit-tested
// (test/dashboard.test.mjs) instead of buried in page code.

// Roster rows come from get_onsite_roster(): one row per employee whose
// LAST scan was an IN, whatever their status. is_stale marks an IN older
// than the stale window (a forgotten badge-out). To agree with
// get_dashboard_stats() (on_site_count / stale_in_count both require
// status = 'active'), only ACTIVE employees count as "on site" or "possibly
// left"; an inactive/suspended employee with a last IN still appears in the
// 'all' view, carrying a status badge, but never inflates the headline.
const isActive = (r) => r.status == null || r.status === 'active';
const isLive = (r) => isActive(r) && !r.is_stale;
const isStaleIn = (r) => isActive(r) && !!r.is_stale;

export function summarizeRoster(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const live = list.filter(isLive);
  const byDept = new Map();
  for (const r of live) {
    const d = r.department || 'Unassigned';
    byDept.set(d, (byDept.get(d) || 0) + 1);
  }
  return {
    total: list.length,
    live: live.length,
    stale: list.filter(isStaleIn).length,
    byDepartment: [...byDept.entries()]
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department)),
  };
}

// view: 'live' (default) | 'stale' (active, old IN) | 'all' (everyone,
// including non-active employees).
export function filterRoster(rows, { query = '', department = '', view = 'live' } = {}) {
  const q = query.trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (view === 'live' && !isLive(r)) return false;
    if (view === 'stale' && !isStaleIn(r)) return false;
    if (department && (r.department || '') !== department) return false;
    if (!q) return true;
    return `${r.full_name || ''} ${r.employee_code || ''}`.toLowerCase().includes(q);
  });
}

// Reuses the existing .badge result classes: red = act on it, amber =
// look at it, green = informational.
const SEVERITY_BADGE = { critical: 'inactive_card', warning: 'unassigned_card', info: 'matched' };
export function severityBadgeClass(severity) {
  return SEVERITY_BADGE[severity] || 'unassigned_card';
}

export function alertKindLabel(kind) {
  const s = String(kind || 'alert').replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Counts above 9 collapse so the sidebar badge never changes width.
export function fmtBadgeCount(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  return n > 9 ? '9+' : String(n);
}

// A scanner counts as online if it was seen inside the window (matches the
// 10-minute rule get_dashboard_stats() uses for scanners_online).
export function scannerState(scanner, now = Date.now(), onlineWindowMs = 10 * 60 * 1000) {
  if (!scanner || scanner.is_enabled === false) return 'disabled';
  const seen = Date.parse(scanner.last_seen_at);
  if (!Number.isFinite(seen)) return 'never';
  return now - seen <= onlineWindowMs ? 'online' : 'offline';
}

export const SCANNER_STATE_LABEL = { online: 'Online', offline: 'Offline', disabled: 'Disabled', never: 'Never seen' };
const SCANNER_STATE_BADGE = { online: 'matched', offline: 'unassigned_card', disabled: 'inactive_card', never: 'unassigned_card' };
export function scannerStateBadgeClass(state) {
  return SCANNER_STATE_BADGE[state] || 'unassigned_card';
}
