// Walking a large export in keyset pages, and the bookkeeping that makes it
// safe to do so.
//
// WHY PAGES AT ALL. One statement returning the whole scan history is a
// request whose duration grows with the data, and the Postgres statement
// timeout is a wall it eventually hits — which is exactly what happened on
// 2026-11-06. Pages of 10,000 never approach it, and the cost is one log
// event per page rather than one per export: ~20 KB against a 1 GB monthly
// allowance, where a single door scan already costs one event.
//
// WHY KEYSET AND NOT OFFSET. An OFFSET page re-walks and discards every row
// before it, so the last pages of a large export get slow enough to reach the
// same timeout from the other direction. A cursor over (scanned_at, id) costs
// the same on page 1 and page 500.
//
// This module is pure and knows nothing about Supabase, so the paging rules
// are tested rather than eyeballed.

export const EXPORT_PAGE_SIZE = 10000;

// A stop, not a silent truncation. get_all_scan_events() capped at 100,000
// rows and said nothing, so an org past that cap got an .xlsx that looked
// complete and was not. If this ceiling is ever reached the caller reports it
// instead — and SheetJS would struggle well before here anyway.
export const EXPORT_ROW_CEILING = 500000;

/**
 * The cursor for the next page: the last row of this one.
 *
 * Returns null for an empty page, which is the caller's signal to stop. Both
 * halves are required — a cursor on scanned_at alone would skip or repeat
 * every row sharing a timestamp with the page boundary.
 */
export function nextCursor(rows) {
  const last = Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null;
  if (!last || !last.id || !last.scanned_at) return null;
  return { afterScannedAt: last.scanned_at, afterId: last.id };
}

/**
 * A page shorter than requested means the end.
 *
 * A page of exactly pageSize is NOT the end — there may be nothing after it,
 * in which case the next request returns zero rows and stops there. One extra
 * empty request is the correct price for never truncating an export.
 */
export function isFinalPage(rows, pageSize = EXPORT_PAGE_SIZE) {
  return !Array.isArray(rows) || rows.length < pageSize;
}

/** Fresh accumulator. `seen` is what makes the dedupe below possible. */
export function newExportState() {
  return { rows: [], seen: new Set() };
}

/**
 * Append a page, dropping ids already collected.
 *
 * THE RACE THIS EXISTS FOR. archive_old_scan_events() runs daily at 03:00 UTC
 * and moves rows from scan_events into scan_events_archive. The export reads
 * BOTH tables, so a row moved mid-export can be read from one table on an
 * early page and the other on a later one. Reading both is also what stops
 * archival from making rows *disappear* from an in-flight export — the row
 * keeps its id and scanned_at, so the cursor never steps over it — but it
 * does mean a duplicate is possible, and a duplicate in a payroll export is
 * worse than a slow one.
 *
 * Mutates rather than returning a new array on purpose: at half a million
 * rows, copying the accumulator once per page is work and memory nobody
 * needs.
 *
 * @returns {number} how many rows were genuinely new
 */
export function appendPage(state, rows) {
  let added = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = row?.id;
    // A row with no id cannot be deduplicated, so it is kept rather than
    // dropped: losing a real scan is worse than a possible duplicate, and
    // this should not happen at all since id is a primary key.
    if (id && state.seen.has(id)) continue;
    if (id) state.seen.add(id);
    state.rows.push(row);
    added += 1;
  }
  return added;
}

/**
 * Progress text while pages are arriving.
 *
 * Deliberately no percentage and no total. Nothing knows how many rows the
 * export will have until it ends — a count query would be a whole extra
 * request to produce a number that is only used to animate a bar, and the
 * project's own rule is that a figure nobody can stand behind is worse than
 * no figure. Same reasoning as the health drawer refusing to invent a
 * denominator for cached photos.
 */
export function exportProgressLabel(fetched, page) {
  const n = Number(fetched);
  const rows = Number.isFinite(n) && n >= 0 ? n.toLocaleString() : '0';
  return `${rows} rows · page ${Math.max(1, Number(page) || 1)}`;
}

/** Has this export collected more than we are willing to build a file from? */
export function hitRowCeiling(state, ceiling = EXPORT_ROW_CEILING) {
  return (state?.rows?.length || 0) >= ceiling;
}
