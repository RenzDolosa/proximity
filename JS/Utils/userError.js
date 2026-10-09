// Turns a raw database or network error into something safe to show.
//
// Postgres and PostgREST write errors for the person who wrote the query:
// they name tables, columns, functions, constraints and sometimes the failing
// values. Rendering one in the UI does two bad things at once — it tells
// anyone who can make the app fail what the schema looks like, and it tells
// the person actually using the app nothing they can act on.
//
//   relation "public.employees" does not exist
//   duplicate key value violates unique constraint "employees_employee_code_current_key"
//   new row for relation "profiles" violates check constraint "profiles_role_check"
//
// So nothing here passes the original text through. Every branch returns a
// sentence written in advance; anything unrecognised falls back to a generic
// one. The raw error still goes to the console for whoever is debugging.
//
// This is defence in depth, not the boundary — RLS and the RPCs' own checks
// are what actually stop a caller reading what they should not. This stops
// the app describing its own internals while they do it.

const RULES = [
  // Permission — deliberately vague about what exists.
  [/not permitted|permission denied|insufficient.privilege|\b42501\b|\bPGRST301\b/i,
    "You don't have access to this."],
  // Auth / session
  [/\bJWT\b|jwt expired|invalid token|\b401\b|not authenticated|session.*expired/i,
    'Your session has expired. Please sign in again.'],
  // Connectivity — the one case where the user can actually do something.
  [/failed to fetch|networkerror|network request failed|\boffline\b|err_internet/i,
    "Can't reach the server. Check your connection and try again."],
  [/timed? ?out|\betimedout\b|\b504\b|\b408\b/i,
    'That took too long to respond. Please try again.'],
  // Quota / rate limiting
  [/\b429\b|too many requests|rate limit/i,
    'Too many requests at once. Wait a moment and try again.'],
  [/\b402\b|quota|over.?limit|exceeded.*usage/i,
    'This service is temporarily unavailable. Please try again later.'],
  // Validation the RPCs raise on purpose — these are already user-facing and
  // name no schema, but they are listed so their wording is owned here.
  [/date range too large/i, 'Choose a shorter date range (31 days or less).'],
  [/to date must not be before/i, 'The end date is before the start date.'],
  [/from and to dates are required/i, 'Choose both a start and an end date.'],
  [/unknown time ?zone/i, "Your device's time zone wasn't recognised."],
  // Constraint violations — say what it means, never which constraint.
  [/duplicate key|unique constraint|\b23505\b/i,
    'That value is already in use. Try a different one.'],
  [/foreign key|\b23503\b/i,
    "That record is still linked to something else and can't be changed yet."],
  [/check constraint|\b23514\b|invalid input|\b22P02\b/i,
    "That doesn't look right. Check the values and try again."],
  [/not.null|\b23502\b/i, 'Something required is missing. Fill in every field and try again.'],
  // Deploy-ordering: the client is ahead of the database.
  [/\bPGRST202\b|could not find the function|does not exist/i,
    'This feature isn’t available yet. Please try again later.'],
  // File upload limits are worth being specific about.
  [/payload too large|\b413\b|file too large|exceeds.*size/i,
    'That file is too large. Choose a smaller one.'],
];

export const GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * A safe, actionable sentence for `err`. Never returns the original text.
 * Pass `fallback` when the calling screen can say something more useful than
 * the generic line.
 */
export function friendlyError(err, fallback = GENERIC_ERROR) {
  const probe = [
    err?.message, err?.details, err?.hint, err?.code,
    typeof err === 'string' ? err : '',
  ].filter(Boolean).join(' ');
  if (!probe) return fallback;
  for (const [pattern, message] of RULES) {
    if (pattern.test(probe)) return message;
  }
  return fallback;
}

/**
 * Same mapping, plus the raw error to the console so a developer can still
 * diagnose it. Use this at the point a message is about to reach the screen.
 */
export function reportError(err, context, fallback = GENERIC_ERROR) {
  if (err) console.error(`[${context}]`, err);
  return friendlyError(err, fallback);
}
