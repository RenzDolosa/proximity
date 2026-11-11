// When does this database hit 500 MB?
//
// WHY THIS IS THE FEATURE, and not a cleanup job. Measured 2026-11-11: the
// database is 92 MB of 500. cron.job_run_details holds ZERO live rows,
// net._http_response holds eight, scan_events carries 100 dead tuples
// against 171,032 live and employees carries 95 against 814. There is
// nothing to reclaim — autovacuum is keeping up and the machine-generated
// tables are already bounded. Every "free up space" idea on the table that
// day was worth under 1.5 MB combined.
//
// What there IS, is a slope. The storage limit is the one Supabase quota
// that does NOT reset at the billing boundary, so the only question that
// matters is when the line crosses the ceiling — and nothing in the app
// answered it. A percentage does not: 18% looks comfortable whether it
// arrived over six weeks or six years.
//
// WHY THE SLOPE COMES FROM SCAN VOLUME rather than a stored history of
// sizes. A trend needs two measurements, so a history table would show
// nothing useful for days and would itself be a (tiny) table added to solve
// a storage problem. scan_events already records when it started and how
// many rows it holds, which is the same information with no new storage at
// all. It is the dominant term by a wide margin: 49 MB of the 92.
//
// WHAT THIS DELIBERATELY DOES NOT MODEL. employees.scan_logs grows until
// trim_employee_scan_logs() starts biting at 180 days and then plateaus, so
// including it would overstate the long run; photo thumbnails are flat.
// Both are named in the panel instead of being folded into a single number
// nobody can take apart. Same rule as the export progress label: a figure
// that cannot be stood behind is worse than no figure.

/** Supabase free plan. The RPC reports it too; this is the fallback. */
export const FREE_PLAN_LIMIT_BYTES = 524288000;

const DAY_MS = 86400000;

/**
 * Finite number, or null.
 *
 * THE NULLISH CHECK IS THE POINT. `Number(null)`, `Number('')` and
 * `Number([])` are all 0, and 0 is finite — so `Number.isFinite` alone
 * accepts "no value" as "zero". That is how an unknown runway became
 * "about 1 day left" and an unknown rate became severity `bad` in the first
 * draft of this file, and it is the same trap that ranked unknown
 * durations as "just arrived" on the occupancy board.
 */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Strictly positive, or null. */
function positive(value) {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

/**
 * Bytes added per day, derived from scan volume.
 *
 * @param {{bytes?: number, rows?: number, firstAt?: string, lastAt?: string}} scans
 * @returns {{bytesPerDay: number, bytesPerScan: number, scansPerDay: number, spanDays: number}|null}
 */
export function scanGrowthRate({ bytes, rows, firstAt, lastAt } = {}) {
  const totalBytes = positive(bytes);
  const totalRows = positive(rows);
  if (totalBytes === null || totalRows === null) return null;

  const from = firstAt ? new Date(firstAt).getTime() : NaN;
  const to = lastAt ? new Date(lastAt).getTime() : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;

  // A span under a day cannot support a per-day rate: one morning's scans
  // would extrapolate to an absurd slope. Reported as unknown instead.
  const spanDays = (to - from) / DAY_MS;
  if (!(spanDays >= 1)) return null;

  const bytesPerScan = totalBytes / totalRows;
  const scansPerDay = totalRows / spanDays;
  return { bytesPerDay: bytesPerScan * scansPerDay, bytesPerScan, scansPerDay, spanDays };
}

/**
 * How full, how fast, and when it runs out.
 *
 * `daysRemaining` and `fullOn` are null when the rate is unknown or not
 * growing — NOT Infinity, and not a far-future date. "We cannot say" has to
 * survive all the way to the UI rather than being rendered as a confident
 * year 9999.
 */
export function projectFull({ databaseBytes, limitBytes, bytesPerDay, now = Date.now() } = {}) {
  const used = positive(databaseBytes);
  const limit = positive(limitBytes) ?? FREE_PLAN_LIMIT_BYTES;
  const rate = positive(bytesPerDay);

  const pctUsed = used === null ? null : Math.min(100, Math.round((used / limit) * 1000) / 10);
  const remaining = used === null ? null : Math.max(0, limit - used);

  if (used === null || rate === null || remaining === null || remaining === 0) {
    return { pctUsed, bytesRemaining: remaining, bytesPerDay: rate, daysRemaining: null, fullOn: null };
  }

  const daysRemaining = Math.floor(remaining / rate);
  return {
    pctUsed,
    bytesRemaining: remaining,
    bytesPerDay: rate,
    daysRemaining,
    fullOn: new Date(now + daysRemaining * DAY_MS).toISOString(),
  };
}

/**
 * How much runway is left, in words.
 *
 * Deliberately coarse past a couple of months. The slope is derived from
 * seven weeks of one table; quoting "412 days" from that is a precision the
 * input does not carry, and a reader who sees a day count will plan against
 * it. Months, and only when the number is small enough to act on.
 */
export function runwayLabel(daysRemaining) {
  const d = num(daysRemaining);
  if (d === null || d < 0) return 'not enough history to project';
  // Floored at 1 for display, and the plural agrees with what is SHOWN
  // rather than with the raw value — otherwise zero days reads as "1 days".
  if (d < 30) {
    const shown = Math.max(1, Math.round(d));
    return `about ${shown} day${shown === 1 ? '' : 's'} left`;
  }
  if (d < 365) return `about ${Math.round(d / 30)} months left`;
  const years = Math.round((d / 365) * 10) / 10;
  return `about ${years} year${years === 1 ? '' : 's'} left`;
}

/**
 * Should this be shown as a problem?
 *
 * Under a year of runway is a planning horizon, not an incident: the one
 * lever that changes the slope (a retention horizon that actually deletes)
 * needs a decision about discarding audit history, and that wants months of
 * notice rather than a red banner the week it matters.
 */
export function growthSeverity(daysRemaining) {
  const d = num(daysRemaining);
  if (d === null) return 'unknown';
  if (d < 90) return 'bad';
  if (d < 365) return 'warn';
  return 'good';
}

/**
 * Tables worth naming, largest first.
 *
 * `schema` is carried through and shown because the three largest things
 * outside `public` were invisible to the old panel — it filtered
 * `nspname = 'public'`, so cron.job_run_details and net._http_response
 * could have grown without bound and never appeared. They had not, as it
 * turned out, which is a fact the panel should be able to establish rather
 * than one someone has to go and check by hand.
 */
export function topRelations(tables, limit = 8) {
  return (Array.isArray(tables) ? tables : [])
    .map((t) => ({
      schema: t?.schema || 'public',
      name: t?.name || '—',
      totalBytes: Number(t?.total_bytes) || 0,
      indexBytes: Number(t?.index_bytes) || 0,
      liveRows: Number(t?.live_rows) || 0,
      deadRows: Number(t?.dead_rows) || 0,
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, Math.max(1, Number(limit) || 8));
}

/**
 * Share of a relation's rows that are dead, as a percentage, or null when
 * there is nothing to divide by.
 *
 * Rows, not bytes, and labelled as such in the UI. Converting to bytes
 * means assuming dead tuples are the same width as live ones, which for a
 * table whose rows contain a growing jsonb array is exactly the assumption
 * most likely to be wrong.
 */
export function deadShare(relation) {
  const live = Number(relation?.liveRows) || 0;
  const dead = Number(relation?.deadRows) || 0;
  const total = live + dead;
  if (total <= 0) return null;
  return Math.round((dead / total) * 1000) / 10;
}
