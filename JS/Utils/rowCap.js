// Telling the difference between "this is all of it" and "this is the first
// page of it", for any table whose server response is capped.
//
// PostgREST enforces `db-max-rows` (1000 on this project) on every response,
// independent of whatever LIMIT the function itself declares. A capped list
// is indistinguishable from a complete one unless something fetches the real
// total separately — so a page that shows "1–500 of 1000" is reporting the
// cap it hit, not the size of the data.
//
// Measured 2026-10-08: the Attendance report for one week really contained
// **3,385** employee-days. The page received 1,000, showed "1–500 of 1000",
// and derived every headline figure from that slice. Nothing anywhere said so.
//
// Fetching the rest would cost egress; fetching a scalar count does not. That
// is the trade this module exists to express — be honest about the cap rather
// than quietly paying to hide it.
export const POSTGREST_MAX_ROWS = 1000;

/** What a page holds versus what exists. `total` can never be below `fetched`. */
export function truncation(fetchedRows, totalRows) {
  const fetched = Math.max(0, Number(fetchedRows) || 0);
  const total = Math.max(fetched, Number(totalRows) || 0);
  return { truncated: total > fetched, fetched, total, missing: total - fetched };
}

/**
 * One sentence for the top of a truncated table, or null when nothing is
 * missing. `noun` is the plural unit being counted ("employee-days").
 *
 * "Most recent" is only honest when the query orders newest first — see
 * 20261008160000, which flipped the Attendance report for exactly this
 * reason: under the old ascending order the rows the cap dropped were the
 * newest ones, which are the ones anyone was looking for.
 */
export function truncationNotice(t, { noun = 'rows', hint = '' } = {}) {
  if (!t?.truncated) return null;
  const n = (x) => x.toLocaleString();
  return `Showing the ${n(t.fetched)} most recent of ${n(t.total)} ${noun} — `
    + `${n(t.missing)} older ${noun} are not loaded.${hint ? ` ${hint}` : ''}`;
}
