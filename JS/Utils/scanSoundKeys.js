// Which sound a scan outcome maps to, and the catalogue of sounds itself.
//
// Pure and separate from Utils/scanSounds.js and Models/ScanSoundsModel.js
// because both of those reach the Supabase client, which needs a browser —
// same split as Utils/scanTone.js and for the same reason. The rule below
// decides what an operator hears, which is worth testing: picking the wrong
// clip is worse than silence, because it reports an outcome that did not
// happen.

// UI-facing key -> Storage object path (extension-less, see ScanSoundsModel).
export const SOUND_KEYS = {
  matched_in: 'matched-in',
  matched_out: 'matched-out',
  matched_remarks: 'matched-remarks',
  card_revoked: 'card-revoked',
  unmatched: 'unmatched',
  unassigned_card: 'unassigned-card',
};

export const SOUND_LABELS = {
  matched_in: 'Matched / Success — IN scan',
  matched_out: 'Matched / Success — OUT scan',
  matched_remarks: 'Matched, but has an unresolved remark',
  card_revoked: 'Card revoked scan',
  unmatched: 'Unknown proximity ID scan',
  unassigned_card: 'Unassigned card scan',
};

// Every path that produces a scan result already filters remarks_log down to
// UNRESOLVED entries before it reaches here — the compact RPC drops
// `resolved: true` server-side, and the offline cache is fed by the delta,
// which does the same. So a non-empty array means "someone needs to look at
// this person", and nothing here has to re-check `resolved`.
export function hasUnresolvedRemarks(data) {
  return Array.isArray(data?.employee?.remarks_log) && data.employee.remarks_log.length > 0;
}

export function keyForResult(data) {
  if (data?.result === 'matched') {
    // Takes precedence over IN/OUT because only one clip can play per scan,
    // and of the two facts — which direction, and "this person has an open
    // remark" — the second is the one worth interrupting someone for. The
    // direction is still on the result card and in the feed.
    if (hasUnresolvedRemarks(data)) return 'matched_remarks';
    return data.direction === 'out' ? 'matched_out' : 'matched_in';
  }
  if (data?.result === 'inactive_card') return 'card_revoked';
  if (data?.result === 'unmatched') return 'unmatched';
  if (data?.result === 'unassigned_card') return 'unassigned_card';
  // inactive_employee stays silent rather than borrowing an unrelated clip
  // that would misrepresent the result.
  return null;
}
