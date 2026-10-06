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

// ---- incremental roster (get_onsite_roster_delta) ----

// seconds_on_site and is_stale used to come from the server, which meant
// re-downloading the whole roster just to learn that a clock had advanced. Both
// are pure functions of last_in_at, so they belong here. Call at paint time, not
// merge time — the values differ on every repaint.
export function deriveRosterRow(row, nowMs = Date.now(), staleHours = 16) {
  const inAt = Date.parse(row?.last_in_at);
  if (!Number.isFinite(inAt)) {
    // Show the row, but claim nothing about duration: null renders as "—", while
    // 0 would read as "arrived just now", which is specific and wrong.
    return { ...row, seconds_on_site: null, is_stale: false };
  }
  const seconds = Math.max(0, Math.floor((nowMs - inAt) / 1000));
  return { ...row, seconds_on_site: seconds, is_stale: seconds > staleHours * 3600 };
}

export function deriveRoster(rows, nowMs = Date.now(), staleHours = 16) {
  return (Array.isArray(rows) ? rows : []).map((r) => deriveRosterRow(r, nowMs, staleHours));
}

// Applies one get_onsite_roster_delta() response to the roster already held.
//
// `full` replaces outright. An incremental delta carries every changed employee
// with an `on_roster` flag: true upserts, false removes. That flag is the whole
// mechanism for removals — someone who scans OUT does not arrive as a deleted
// row, they stop satisfying the roster predicate, which a cursor cannot observe.
//
// Sorted by last_in_at to match a full sync's order, so a row that arrived through
// a delta sits where a resync would have put it.
export function mergeRosterDelta(currentRows, delta) {
  const incoming = Array.isArray(delta?.rows) ? delta.rows : [];
  if (delta?.full) return incoming.slice().sort(byLastIn);

  const byId = new Map((Array.isArray(currentRows) ? currentRows : []).map((r) => [r.id, r]));
  for (const row of incoming) {
    if (row?.on_roster) byId.set(row.id, row);
    else byId.delete(row?.id);
  }
  return [...byId.values()].sort(byLastIn);
}

// Rows with no IN time sort last; a NaN comparison would leave the array in an
// arbitrary order instead.
function byLastIn(a, b) {
  const x = Date.parse(a?.last_in_at);
  const y = Date.parse(b?.last_in_at);
  if (!Number.isFinite(x)) return Number.isFinite(y) ? 1 : 0;
  if (!Number.isFinite(y)) return -1;
  return x - y;
}

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
