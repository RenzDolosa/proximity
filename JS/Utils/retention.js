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

/**
 * The archive horizon's own choices. 0 is allowed and means "never archive",
 * which is a PERFORMANCE choice rather than a safety one — the live table
 * then grows without bound. That is why its default is 180 while trimming's
 * is 0: one relocates, the other destroys.
 */
export const ARCHIVE_CHOICES = Object.freeze([
  { value: 0, label: 'Never — keep everything live' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '1 year' },
  { value: 730, label: '2 years' },
]);

/**
 * What the archive horizon costs, said in terms of what the operator loses
 * sight of rather than what the database does.
 *
 * Deliberately worded away from retentionSummary(): archiving moves rows and
 * exports still read them, so "deleted" would be wrong and alarming. What it
 * really bounds is how far back Scanner Analytics and the Dashboard can see.
 */
export function archiveSummary(s) {
  const days = Number(s?.scan_events_days);
  if (!s || !Number.isFinite(days)) return 'Archive setting unknown.';
  if (days === 0) return 'Never archiving — the live table keeps every scan, and will keep growing.';
  const base = `Analytics and the Dashboard can look back ${days} days. Older scans move to the archive and stay in exports.`;
  if (s.archive_active_now) return base;
  const when = s.archive_effective_from ? ` on ${s.archive_effective_from}` : '';
  return `${base} New setting takes effect${when}.`;
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
