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
export const ALERT_KINDS = Object.freeze([
  { value: '', label: 'Every alert' },
  { value: 'scanner_went_silent', label: 'Scanner went silent' },
  { value: 'unassigned_card', label: 'Unassigned card scanned' },
  { value: 'inactive_card', label: 'Inactive card scanned' },
  { value: 'after_hours_scan', label: 'After-hours scan' },
  { value: 'impossible_travel', label: 'Impossible travel' },
]);
