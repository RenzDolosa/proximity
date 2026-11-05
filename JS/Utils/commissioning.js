// Commissioning a reader: scan a stack of cards, get a pass/fail list.
//
// WHY THIS LOWERS COST RATHER THAN RAISING IT. Today every Test Scan is its
// own test_scan_proximity_code_compact request, so checking 50 cards is 50
// requests and 50 log events. Resolving from the offline cache instead makes
// it one sync and then nothing — and it is the only way to exercise the
// offline path before trusting it at a door.
//
// THE TRADE, stated plainly because it decides whether a result can be
// believed: a cache answers from the roster as it was at the last sync. A card
// revoked five minutes ago still reads as valid here. That is why every row
// records which source answered it, and why the UI keeps a per-card
// verify-against-server escape hatch.

export const SOURCE = Object.freeze({ CACHE: 'cache', SERVER: 'server' });

// Scan results that mean the card is usable at a door. Mirrors the vocabulary
// in scan_proximity_code(): anything else is a real finding, not a pass.
const PASSING = new Set(['matched']);

// Reader faults, as opposed to card problems. Separated because they are
// somebody else's job to fix: a truncated read is a reader to re-seat, an
// unassigned card is a record to update.
const READER_FAULTS = new Set(['short', 'long', 'charset']);

/**
 * One row for the batch list.
 *
 * `rejection` comes from readRejection() when the read never reached a lookup
 * at all — those are reader faults and are deliberately NOT counted as card
 * failures, or a single loose cable would mark a whole stack of good cards bad.
 */
export function toBatchRow({ code, result, employee, source, rejection = null, at = Date.now() } = {}) {
  const outcome = rejection
    ? 'reader'
    : (PASSING.has(result) ? 'pass' : 'fail');
  return {
    code: String(code ?? '').trim(),
    outcome,
    result: rejection || result || 'unknown',
    name: employee?.full_name || null,
    employeeCode: employee?.employee_code || null,
    source: source || SOURCE.CACHE,
    at,
  };
}

/** Pass / fail / reader-fault counts, plus how many were answered from cache. */
export function batchTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return {
    total: list.length,
    passed: list.filter((r) => r?.outcome === 'pass').length,
    failed: list.filter((r) => r?.outcome === 'fail').length,
    readerFaults: list.filter((r) => r?.outcome === 'reader').length,
    fromCache: list.filter((r) => r?.source === SOURCE.CACHE).length,
  };
}

/**
 * Newest first, and the same card scanned twice keeps BOTH rows.
 *
 * Deduplicating would hide the thing commissioning exists to find: a card that
 * reads correctly four times out of five is a failing reader, and collapsing
 * it to one "pass" would erase that entirely.
 */
export function addToBatch(rows, row) {
  return [row, ...(Array.isArray(rows) ? rows : [])];
}

/**
 * A card that did not read the same way every time.
 *
 * This is the real output of a commissioning run — not the pass count, which
 * a flaky reader can still reach.
 */
export function inconsistentCodes(rows) {
  const byCode = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = row?.code;
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, new Set());
    byCode.get(code).add(row.outcome);
  }
  return [...byCode.entries()]
    .filter(([, outcomes]) => outcomes.size > 1)
    .map(([code]) => code)
    .sort();
}

/** Columns for the CSV export, in the order a reader of the file wants them. */
export const BATCH_CSV_COLUMNS = Object.freeze([
  'scanned_at', 'code', 'outcome', 'result', 'employee', 'employee_code', 'answered_by',
]);

/** One batch row -> the flat shape BATCH_CSV_COLUMNS describes. */
export function toCsvRow(row) {
  return {
    scanned_at: new Date(row?.at ?? Date.now()).toISOString(),
    code: row?.code ?? '',
    outcome: row?.outcome ?? '',
    result: row?.result ?? '',
    employee: row?.name ?? '',
    employee_code: row?.employeeCode ?? '',
    answered_by: row?.source ?? '',
  };
}
