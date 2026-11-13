// The alert kinds raise_alert() actually produces, for the "only notify me
// about…" picker in Settings → Notifications.
//
// Its own module rather than a constant inside AlertChannelsModel.js: that
// file imports the Supabase client, which reaches for `window`, so anything
// importing it is unusable under Node and therefore untestable. A list of
// strings has no business being that hard to read.
//
// An empty value is NULL in alert_channels.kind, which the trigger and
// notify-alert both read as "every kind" — the right default for a
// three-scanner site. A per-kind row is for routing one kind somewhere else.
//
// THE BUG THIS LIST USED TO BE. Three of the five options offered here were
// strings no migration has ever passed to raise_alert():
//
//   unassigned_card    — a scan_events.result value, not an alert kind
//   inactive_card      — likewise
//   impossible_travel  — removed by 20261008140000, and the single remaining
//                        occurrence in the whole repository was this line
//
// An alert_channels row carrying one of those matches nothing, forever. It
// saves without complaint, the Notifications table renders it as configured,
// and the destination stays silent — which is indistinguishable from a site
// where nothing has gone wrong. Meanwhile five kinds that do fire could not
// be routed at all, including card_shared_between_sites, the only `critical`
// one, which is the signal that one badge is being used at two gates.
//
// test/alert-kinds.test.mjs reads the kinds back out of Supabase/migrations/
// and fails the build when this list and the database disagree, the same
// guard test/scan-sounds.test.mjs applies to the sound filenames. A list that
// has to be kept in sync by remembering is a list that drifts.
export const ALERT_KINDS = Object.freeze([
  { value: '', label: 'Every alert' },
  // Severity `critical` in raise_alert(), so these lead.
  { value: 'revoked_card_scan', label: 'Revoked card scanned' },
  { value: 'card_shared_between_sites', label: 'Card shared between sites' },
  // Severity `warning`.
  { value: 'scanner_went_silent', label: 'Scanner went silent' },
  { value: 'unknown_card_scan', label: 'Unrecognized card scanned' },
  { value: 'truncated_card_read', label: 'Truncated card read' },
  { value: 'inactive_employee_scan', label: 'Inactive employee scanned' },
  { value: 'after_hours_scan', label: 'After-hours scan' },
]);

// Kinds that raise_alert() can emit but that deliberately do not belong in
// the picker. Exported so the drift test can tell "we decided to leave this
// out" apart from "someone forgot to add it" — the distinction the old list
// had no way to express.
export const UNLISTED_ALERT_KINDS = Object.freeze([
  // Raised only by hand, from the SQL snippet in 20261110092000's header, to
  // prove Telegram wiring end to end. Routing a test kind to its own channel
  // is not a thing anyone wants; offering it invites a row that only ever
  // fires when an admin is already watching the result.
  'test_notification',
]);

/**
 * Label for a stored alert_channels.kind.
 *
 * Takes the unknown case seriously rather than echoing the raw string: a row
 * saved before this list was corrected holds something like
 * `impossible_travel`, and rendering that bare in the Notifications table
 * reads as a working rule with an unfamiliar name. It is the opposite — the
 * one row guaranteed to deliver nothing — so it says so.
 */
export function alertKindLabel(kind) {
  const value = kind == null ? '' : String(kind);
  const known = ALERT_KINDS.find((k) => k.value === value);
  if (known) return known.label;
  return `${value} — no longer raised, delivers nothing`;
}

/** True for a stored kind that can never match an alert. */
export function isDeadAlertKind(kind) {
  if (kind == null || kind === '') return false; // NULL is "every kind", not dead
  const value = String(kind);
  if (ALERT_KINDS.some((k) => k.value === value)) return false;
  return !UNLISTED_ALERT_KINDS.includes(value);
}
