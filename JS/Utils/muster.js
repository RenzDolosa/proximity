// Grouping and staleness rules for the evacuation muster list.
//
// Pure, and tested harder than most of this project, because the failure mode
// is not a wrong number on a screen — it is a person left inside a building
// because a list said they had gone.
//
// THE BIAS IS DELIBERATE: when it is unclear whether someone is inside, they
// are listed. A name on the sheet that walks up and says "I'm here" costs
// five seconds. A name missing from the sheet costs a search nobody starts.

/** Nobody is dropped for being stale — stale means UNKNOWN, not gone. */
export function isAccountable(row) {
  // An inactive or suspended employee with a live IN is still a body in the
  // building. Employment status is an HR question; evacuation is not.
  return !!row && !!row.last_in_at;
}

export const CERTAINTY = Object.freeze({
  likely: 'Scanned in recently',
  unsure: 'Last scan is old — check',
});

export function certainty(row) {
  return row?.is_stale ? 'unsure' : 'likely';
}

/** Falls back rather than inventing a site; an unlabelled group is still visible. */
export function siteOf(row) {
  const id = String(row?.last_scanner_id ?? '').trim();
  return id || 'Unknown scanner';
}

/**
 * Site -> departments -> people. Sites with the most people first, because
 * that is the sheet somebody needs handed to them first; within a site,
 * departments alphabetically so two printouts of the same roster match.
 */
export function groupForMuster(rows) {
  const bySite = new Map();
  for (const row of rows || []) {
    if (!isAccountable(row)) continue;
    const site = siteOf(row);
    if (!bySite.has(site)) bySite.set(site, new Map());
    const dept = String(row.department ?? '').trim() || 'No department';
    const byDept = bySite.get(site);
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept).push(row);
  }

  return [...bySite.entries()]
    .map(([site, byDept]) => {
      const departments = [...byDept.entries()]
        .map(([department, people]) => ({
          department,
          people: people.slice().sort(byName),
          count: people.length,
        }))
        .sort((a, b) => a.department.localeCompare(b.department));
      const count = departments.reduce((n, d) => n + d.count, 0);
      const unsure = departments.reduce(
        (n, d) => n + d.people.filter((p) => certainty(p) === 'unsure').length, 0);
      return { site, departments, count, unsure };
    })
    .sort((a, b) => b.count - a.count || a.site.localeCompare(b.site));
}

function byName(a, b) {
  return String(a.full_name ?? '').localeCompare(String(b.full_name ?? ''));
}

export function musterTotals(groups) {
  const list = groups || [];
  return {
    sites: list.length,
    people: list.reduce((n, g) => n + g.count, 0),
    unsure: list.reduce((n, g) => n + g.unsure, 0),
  };
}

// How old a cached roster is allowed to be before the page says so loudly.
// Not a cutoff — a stale list is far better than none during an evacuation,
// and the only wrong answer is showing it without saying how old it is.
export const SNAPSHOT_WARN_MS = 10 * 60 * 1000;

export function snapshotAge(savedAtIso, nowMs = Date.now()) {
  const at = Date.parse(savedAtIso);
  if (!Number.isFinite(at)) return { known: false, ms: null, stale: true, text: 'unknown age' };
  const ms = Math.max(0, nowMs - at);
  const mins = Math.floor(ms / 60000);
  const text = mins < 1 ? 'seconds ago'
    : mins < 60 ? `${mins} min ago`
    : `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  return { known: true, ms, stale: ms > SNAPSHOT_WARN_MS, text };
}
