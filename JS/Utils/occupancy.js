// Per-scanner occupancy for the Dashboard, derived from the roster the page
// already holds.
//
// COSTS NOTHING. DashboardPage keeps the roster in memory and refreshes it on
// its own 60s cycle; these are pure functions over that same array, so the
// board adds no request and no bytes. The moment it needs its own query it
// stops being worth having.
//
// Reuses the roster's own definition of who counts rather than inventing a
// second one: Utils/dashboard.js treats only ACTIVE employees as on site, and
// `is_stale` (an IN older than the stale window) as "possibly already left".
// A board that quietly counted differently from the headline above it would
// be worse than no board.

import { siteOf } from './muster.js';

const isActive = (r) => r?.status == null || r.status === 'active';

/**
 * One entry per scanner, in scanner order so the board lines up with Muster's
 * grid rather than reshuffling between the two screens.
 *
 * `live` is active and recently seen; `stale` is active with an old IN;
 * `other` is everyone else with a live IN — inactive or suspended employees
 * who are still, as far as any door knows, inside the building.
 */
export function occupancyByScanner(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const by = new Map();
  for (const r of list) {
    if (!r?.last_in_at) continue;
    const site = siteOf(r);
    if (!by.has(site)) by.set(site, { site, total: 0, live: 0, stale: 0, other: 0, longest: null });
    const g = by.get(site);
    g.total += 1;
    if (!isActive(r)) g.other += 1;
    else if (r.is_stale) g.stale += 1;
    else g.live += 1;
    if (longerThan(r, g.longest)) g.longest = r;
  }
  const groups = [...by.values()];
  const peak = groups.reduce((m, g) => Math.max(m, g.total), 0);
  // share is of the BUSIEST scanner, not of the whole site. Bars exist to
  // compare doors with each other; as a fraction of the total they would all
  // be short and indistinguishable the moment a fourth scanner appears.
  for (const g of groups) g.share = peak > 0 ? g.total / peak : 0;
  return groups.sort(byScannerName);
}

// seconds_on_site is null when last_in_at could not be parsed. Treat that as
// "unknown", never as zero — zero would read as "just arrived", which is a
// specific claim and the wrong one.
//
// Number() is not safe for this on its own: Number(null), Number('') and
// Number([]) are all 0, and 0 is finite. So the unknown rows sailed through
// the finite check and ranked as freshly-arrived. Rejected by type first.
export function seconds(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

function longerThan(row, current) {
  const a = seconds(row?.seconds_on_site);
  if (!Number.isFinite(a)) return false;
  const b = seconds(current?.seconds_on_site);
  return !Number.isFinite(b) || a > b;
}

// Local rather than importing scannerOrder: this sorts objects by a `site`
// field and that one sorts bare strings. Kept in step by a test.
function byScannerName(a, b) {
  return String(a.site).localeCompare(String(b.site), undefined, { numeric: true });
}

export function occupancyTotals(groups) {
  const list = Array.isArray(groups) ? groups : [];
  return {
    scanners: list.length,
    total: list.reduce((n, g) => n + g.total, 0),
    live: list.reduce((n, g) => n + g.live, 0),
    stale: list.reduce((n, g) => n + g.stale, 0),
    other: list.reduce((n, g) => n + g.other, 0),
  };
}

/**
 * The longest-standing IN across every scanner — the row most likely to be a
 * forgotten badge-out rather than a person still at their desk. Returns null
 * rather than a placeholder when nothing has a usable duration.
 */
export function longestOnSite(rows) {
  let best = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r?.last_in_at) continue;
    if (longerThan(r, best)) best = r;
  }
  return best;
}

// No duration formatter here on purpose. Utils/attendance.js already exports
// fmtDuration, and the Dashboard's own roster table — two inches below this
// board — renders "Time on site" with it. A second formatter would have put
// "3d 6h" in the board and "78h 00m" in the table on the same screen, which
// is a worse outcome than the slightly less compact string.
