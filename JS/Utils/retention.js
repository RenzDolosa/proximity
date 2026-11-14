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

// The archive horizon's floor. Lower than the trim's, because the two jobs
// are limited by different callers — see ARCHIVE_MIN_DAYS' longer note below
// the summaries.
export const ARCHIVE_MIN_DAYS = 30;

// ONE list of horizons, offered by both panels, so the two dropdowns cannot
// look like different features. They previously differed — the trim started
// at 90 and the archive at 30 — which read as an inconsistency rather than
// as the constraint it actually is.
//
// The constraint is real and stays: a horizon below each job's floor is
// listed but DISABLED, carrying the reason. Hiding those rows made the lists
// differ silently; offering them live would hand back an error. Showing them
// greyed with "too short for Attendance" is the only version that explains
// itself at the moment of the decision.
const HORIZONS = Object.freeze([
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '1 year' },
  { value: 730, label: '2 years' },
  { value: 1095, label: '3 years' },
]);

/**
 * Picker rows for one job, with anything under its floor disabled and
 * labelled with why.
 */
function choicesFor(minDays, offLabel, tooShortReason) {
  return Object.freeze([
    { value: 0, label: offLabel, disabled: false },
    ...HORIZONS.map((h) => (h.value >= minDays
      ? { ...h, disabled: false }
      : { ...h, label: `${h.label} — ${tooShortReason}`, disabled: true })),
  ]);
}

/** Scan log trimming. Floor 90: get_attendance_report() reads 31-day ranges. */
export const RETENTION_CHOICES = choicesFor(
  RETENTION_MIN_DAYS, 'Off — keep everything', 'too short for Attendance',
);

/** Scan data archival. Floor 30, since the drilldown now reads the archive. */
export const ARCHIVE_CHOICES = choicesFor(
  ARCHIVE_MIN_DAYS, 'Off — keep everything live', 'too short for Analytics',
);

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

// WHY THE ARCHIVE FLOOR IS LOWER THAN THE TRIM'S 90, which is the one real
// difference left between the two panels and the reason the shorter rows are
// disabled rather than absent on the trim side: the trim's floor protects
// get_attendance_report()'s 31-day ranges from the job deleting the month
// being reported on, while this one only had to stay above Scanner
// Analytics' 90-day window — and since 20261114090000 taught
// get_scanner_scan_details() to read the archive, that constraint is gone.

/** Valid archive horizons. Separate from isValidRetentionDays: lower floor. */
export function isValidArchiveDays(days) {
  if (typeof days !== 'number' || !Number.isFinite(days)) return false;
  if (!Number.isInteger(days)) return false;
  return days === 0 || (days >= ARCHIVE_MIN_DAYS && days <= RETENTION_MAX_DAYS);
}

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
  if (days === 0) return 'Off — the live table keeps every scan, and will keep growing.';
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
