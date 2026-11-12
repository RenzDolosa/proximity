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

// Scanner 1 left, 2 middle, 3 right, 4 under 1 — the grid MusterPage lays
// these out in.
//
// This REPLACED "most people first", which had a real argument behind it: the
// biggest sheet is the one somebody needs handed to them first. That argument
// was about a single scrolling column, where position meant priority. In a
// grid every site is on screen at once, and what matters instead is that a
// marshal finds the same scanner in the same cell at every drill — headcount
// order moves a scanner the moment headcounts shift, so it is never twice in
// the same place.
//
// Sorts on the PREFIX before the number, so scanners stay grouped by the site
// they belong to ("Alpha - Scanner 2" before "Beta - Scanner 1") rather than
// interleaving two buildings that both happen to have a Scanner 1.
const TRAILING_NUMBER = /^(.*?)(\d+)\s*$/;

export function scannerOrder(a, b) {
  const pa = TRAILING_NUMBER.exec(String(a ?? ''));
  const pb = TRAILING_NUMBER.exec(String(b ?? ''));
  const prefix = (String(pa ? pa[1] : a ?? '').trim())
    .localeCompare(String(pb ? pb[1] : b ?? '').trim(), undefined, { numeric: true });
  if (prefix) return prefix;
  // A name with no trailing number sorts after the numbered ones rather than
  // landing at position zero — "Unknown scanner" must never take cell 1.
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  if (pa && pb) {
    const n = Number(pa[2]) - Number(pb[2]);
    if (n) return n;
  }
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/**
 * Site -> departments -> people, in scanner order (see scannerOrder above);
 * within a site, departments alphabetically so two printouts of the same
 * roster match.
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
    .sort((a, b) => scannerOrder(a.site, b.site));
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

/**
 * Drop ticks for people no longer on the sheet.
 *
 * Refresh replaces the snapshot while a headcount is running. Someone who
 * has since tapped out is off the list, and a tick they still carry would
 * keep counting toward a site total that no longer includes them — a site
 * reading "41 of 40 accounted for", or worse, reading complete when it is
 * not. Ticks for people who ARE still listed survive, because a marshal who
 * presses Refresh is asking for a newer list, not for their work to be
 * thrown away.
 *
 * @param {Set<string>|Iterable<string>} accounted
 * @param {Array<{id?: string}>} rows the roster the sheet is about to render
 * @returns {Set<string>}
 */
export function pruneAccounted(accounted, rows) {
  const live = new Set((Array.isArray(rows) ? rows : []).map((r) => r?.id).filter(Boolean));
  const kept = new Set();
  for (const id of accounted || []) if (live.has(id)) kept.add(id);
  return kept;
}

/**
 * An id for someone typed in at the assembly point.
 *
 * Prefixed so it can never collide with an employee id, and so anything
 * reading the roll call can tell the two apart without a second list.
 * Random rather than derived from the label: two contractors can legitimately
 * be written down the same way, and the second must not silently tick the
 * first.
 */
export function unlistedId(rand = Math.random) {
  return `unlisted:${Date.now().toString(36)}-${Math.floor(rand() * 1e6).toString(36)}`;
}

/**
 * Add a typed-in person, or return the list unchanged.
 *
 * Trimmed, length-capped, and empties rejected — a marshal hitting Enter on
 * an empty box must not add a blank row to a document someone will later
 * read as a record of who was outside.
 */
export function addUnlisted(entries, label, makeId = unlistedId) {
  const list = Array.isArray(entries) ? entries : [];
  const text = String(label ?? '').trim().slice(0, 80);
  if (!text) return list;
  return [...list, { id: makeId(), label: text }];
}

export function removeUnlisted(entries, id) {
  return (Array.isArray(entries) ? entries : []).filter((e) => e?.id !== id);
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
