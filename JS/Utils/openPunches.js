// Rules for the open-day review queue. Pure — no DOM, no Supabase — because
// what these decide is whose hours change, and that is worth testing.

/** A row the reviewer may act on. Blocked rows are shown, never hidden. */
export function isClosable(row) {
  return !!row && !row.blocked_reason && !!row.proposed_out_at;
}

/**
 * Minutes the synthetic OUT adds to that day. Shown per row so a reviewer can
 * see an implausible one — a site whose last scan is hours after someone
 * left is the case this rule gets wrong, and it should be obvious rather
 * than buried in a total.
 */
export function addedMinutes(row) {
  const inAt = Date.parse(row?.open_in_at);
  const outAt = Date.parse(row?.proposed_out_at);
  if (!Number.isFinite(inAt) || !Number.isFinite(outAt) || outAt <= inAt) return null;
  return Math.round((outAt - inAt) / 60000);
}

// Beyond this the proposal is flagged for a second look. Not blocked — a
// genuine 14-hour day exists — but a site whose last scan is long after
// someone went home produces exactly this, and it is the failure mode of
// closing on site evidence rather than on a shift.
export const LONG_DAY_MINUTES = 12 * 60;

export function isImplausible(row) {
  const mins = addedMinutes(row);
  return mins !== null && mins > LONG_DAY_MINUTES;
}

/** Only ever send what the server can act on; it re-checks all of it anyway. */
export function toClosurePayload(rows) {
  return (rows || [])
    .filter(isClosable)
    .map((r) => ({ employee_id: r.employee_id, work_date: r.work_date }));
}

/**
 * Turns the RPC's per-row outcomes into one sentence. Every skip reason is
 * counted and named: "closed 41" while 6 silently did nothing is how a
 * reviewer comes to believe the queue is broken.
 */
export function summariseOutcomes(results) {
  const rows = Array.isArray(results) ? results : [];
  const closed = rows.filter((r) => r?.outcome === 'closed').length;
  const skipped = rows.length - closed;
  if (!rows.length) return 'Nothing to close.';

  const parts = [`Closed ${closed} day${closed === 1 ? '' : 's'}`];
  if (skipped) {
    const reasons = new Map();
    for (const r of rows) {
      if (r?.outcome === 'closed') continue;
      const why = String(r?.outcome || 'skipped').replace(/^skipped:\s*/, '');
      reasons.set(why, (reasons.get(why) || 0) + 1);
    }
    const detail = [...reasons.entries()].map(([why, n]) => `${n} ${why}`).join(', ');
    parts.push(`skipped ${skipped} (${detail})`);
  }
  return `${parts.join(' · ')}.`;
}
