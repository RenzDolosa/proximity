// The retention horizon's vocabulary and wording, with no Supabase client
// anywhere near it.
//
// Its own module for the same reason Utils/alertKinds.js is: Models/
// RetentionModel.js imports the Supabase client, which reaches for `window`,
// so anything importing it is unusable under Node and therefore untestable.
// The three-state wording below is exactly the part worth testing.
//
// THE THREE STATES ARE NOT TWO. "Off" is not "waiting to start", and a
// horizon that is set but has not reached its effective date is not the same
// as one that is running. A panel that said "90 days" for all three would be
// lying in two of them — and the middle one is the whole point of the grace
// period, so it is the one that must never be invisible.

export const RETENTION_OFF = 0;

// The server rejects anything else below this rather than silently flooring
// it: 30 is a specific intention, and storing 90 instead would be a worse
// answer than an error. 90 is the window get_scanner_performance_stats() and
// get_scanner_scan_details() can still ask for.
export const RETENTION_MIN_DAYS = 90;
export const RETENTION_MAX_DAYS = 3650;

/** Offered in the picker. Free text would invite 30, which is refused. */
export const RETENTION_CHOICES = Object.freeze([
  { value: 0, label: 'Off — keep everything' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '1 year' },
  { value: 730, label: '2 years' },
  { value: 1095, label: '3 years' },
]);

/**
 * Valid values only, so the form can refuse before the server has to.
 *
 * Typed rather than coerced, and for a sharper reason than usual here:
 * Number(null) is 0, and 0 is a MEANINGFUL value in this module — it is
 * "off". So the usual coercion would turn "no answer" into "retention
 * disabled", which reads as a deliberate choice nobody made.
 */
export function isValidRetentionDays(days) {
  if (typeof days !== 'number' || !Number.isFinite(days)) return false;
  if (!Number.isInteger(days)) return false;
  return days === RETENTION_OFF || (days >= RETENTION_MIN_DAYS && days <= RETENTION_MAX_DAYS);
}

/** What to tell an admin about the current setting, in one sentence. */
export function retentionSummary(s) {
  const days = Number(s?.scan_logs_days);
  if (!s || !Number.isFinite(days)) return 'Retention setting unknown.';
  if (days === RETENTION_OFF) return 'Off — no scan history is ever deleted.';
  if (s.active_now) return `Active: history older than ${days} days is removed daily.`;
  const left = Number(s.days_until_active);
  const when = s.effective_from ? ` on ${s.effective_from}` : '';
  return Number.isFinite(left) && left > 0
    ? `Set to ${days} days. Takes effect${when} — nothing is removed until then.`
    : `Set to ${days} days. Takes effect${when}.`;
}
