// What a bulk import will actually do, worked out before anything is sent.
//
// WHAT IT REPLACES. ImportModal's preview was the row count — "412 rows
// ready to import" — and the conflicts arrived afterwards, in the summary
// toast, as `skippedCount`. So the only way to find out that 24 of those
// codes were already issued was to issue the other 388 first.
//
// COSTS NOTHING, which is the reason it is possible at all. Proximity Cards
// already holds every issued card in `cardsCache` to draw the table the
// import button sits on — 836 rows on this project. The answer is on the
// client; it was simply never asked for.
//
// Pure and DOM-free: the classification is the part worth testing, and the
// modal just renders what comes back.

/** Longest list of example rows worth putting in front of someone. */
export const SAMPLE_LIMIT = 5;

const norm = (v) => String(v ?? '').trim();

/**
 * Classify each parsed row against what already exists.
 *
 * ORDER MATTERS, and it is the order a reader expects to be told about:
 *
 *   malformed        the key is blank or fails `validate`
 *   duplicateInFile  this key appeared earlier in the SAME file
 *   alreadyExists    the key is already in the system
 *   fresh            everything else
 *
 * A row is counted once, under the first category it meets. Reporting a
 * blank code as both malformed and a duplicate of the other blank code is
 * technically true and useless.
 *
 * @param {object} o
 * @param {Array<object>} o.records parsed CSV rows
 * @param {string} o.key which column carries the identity
 * @param {Iterable<string>} [o.existing] keys already in the system
 * @param {(value: string, row: object) => string|null} [o.validate]
 *   returns a reason the row cannot be imported, or null
 */
export function previewImport({ records, key, existing = [], validate } = {}) {
  const rows = Array.isArray(records) ? records : [];
  // Normalised on the way in, so "PRX-1" in the file matches " prx-1 " in
  // the system. Case-insensitive because a card code typed in a spreadsheet
  // is not reliably the case it was issued in.
  const have = new Set();
  for (const v of existing || []) {
    const s = norm(v).toLowerCase();
    if (s) have.add(s);
  }

  const seen = new Set();
  const out = { total: rows.length, fresh: [], duplicateInFile: [], alreadyExists: [], malformed: [] };

  rows.forEach((row, i) => {
    // 1-indexed, and +1 again for the header line, so the number shown
    // matches what the operator sees in their spreadsheet. Off-by-one here
    // sends someone to the wrong row of a 412-line file.
    const line = i + 2;
    const raw = norm(row?.[key]);
    const lower = raw.toLowerCase();

    const reason = !raw
      ? `${key} is blank`
      : (typeof validate === 'function' ? validate(raw, row) : null);
    if (reason) { out.malformed.push({ line, value: raw, reason }); return; }

    if (seen.has(lower)) { out.duplicateInFile.push({ line, value: raw }); return; }
    seen.add(lower);

    if (have.has(lower)) { out.alreadyExists.push({ line, value: raw }); return; }
    out.fresh.push({ line, value: raw });
  });

  return out;
}

/**
 * How many rows the import will actually create.
 *
 * Exported separately because it is what the confirm button says, and a
 * button that promises a number the preview did not show is how people stop
 * trusting the preview.
 */
export function importableCount(preview) {
  return preview?.fresh?.length || 0;
}

/**
 * The lines worth naming, newest concern first.
 *
 * Deliberately capped: a 412-row file with 400 problems does not need 400
 * lines of explanation on screen, it needs the first few and a count. The
 * full detail still arrives in the result summary after the import runs.
 */
export function previewSamples(preview, limit = SAMPLE_LIMIT) {
  const n = Math.max(1, Number(limit) || SAMPLE_LIMIT);
  return {
    malformed: (preview?.malformed || []).slice(0, n),
    duplicateInFile: (preview?.duplicateInFile || []).slice(0, n),
    alreadyExists: (preview?.alreadyExists || []).slice(0, n),
  };
}
