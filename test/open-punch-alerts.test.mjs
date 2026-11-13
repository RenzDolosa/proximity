// Telling somebody when a punch never closes.
//
// 20261103120000 added get_open_punch_closures(), a review queue someone has
// to remember to open. Measured that day: 382 of 3,345 employee-days in one
// week carried open_punch, and nothing announced any of them.
//
// An open punch is not one bad row. Direction is parity over the employee's
// whole history, so a missing OUT puts every later scan one step out of
// phase — the next morning's arrival is stored as an OUT, and
// get_attendance_report() filters on `dir = 'in'`, so that day is dropped
// from the report entirely rather than under-counted. One missed tap-out can
// hide every subsequent day for that person.
//
// Nothing here is asserted about behaviour the database would have to run;
// these are structural guards on a migration that cannot be executed from
// Node. The VERIFY block at the foot of the migration is the part a human
// runs against the live project.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALERT_KINDS } from '../JS/Utils/alertKinds.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

// Comments stripped: this file explains at length why it floors the hours
// and why it does not unnest, and a raw search would match the prose.
const code = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => { const at = l.indexOf('--'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const raw = read('../Supabase/migrations/20261113120000_open_punch_alerts.sql');
const sql = code(raw);

const fnBody = (() => {
  const from = sql.search(/CREATE OR REPLACE FUNCTION public\.check_open_punches\(/i);
  const to = sql.indexOf('$function$;', from);
  assert.ok(from !== -1 && to > from, 'could not isolate check_open_punches');
  return sql.slice(from, to);
})();

// ---- the alert ----

test('the kind is routable from Settings', () => {
  assert.match(fnBody, /raise_alert\(\s*'open_punch'/);
  assert.ok(ALERT_KINDS.some((k) => k.value === 'open_punch'),
    'a kind that fires but cannot be routed is the bug alert-kinds.test.mjs exists for');
});

// Without a dedupe key this would re-alert the same stuck punch every hour
// until someone fixed it — which is both noise and, through the webhook,
// real outbound requests.
test('one alert per employee per day, not one per run', () => {
  assert.match(fnBody, /'open-punch:' \|\| r\.id::text \|\| ':'/);
  assert.match(fnBody, /1440/, 'the dedupe window must cover the rest of that day');
});

test('the alert carries enough to act on without a second query', () => {
  for (const key of ['employee_id', 'employee_code', 'full_name', 'department', 'scanner_id', 'in_at']) {
    assert.ok(fnBody.includes(`'${key}'`), `detail is missing ${key}`);
  }
});

// ---- what it costs ----

// The review queue unnests every employee's whole scan_logs with ordinality
// and a window function. Hourly, that would be a different proposition.
test('the check reads the last element, not the whole history', () => {
  assert.match(fnBody, /scan_logs -> -1 ->> 'direction'/);
  assert.ok(!/jsonb_array_elements/.test(fnBody),
    'unnesting every scan log hourly is what this deliberately avoids');
});

test('it runs in cron, so it costs no request and no gateway log line', () => {
  assert.match(sql, /cron\.schedule\(/);
  assert.match(sql, /'check-open-punches'/);
  assert.match(sql, /\$\$SELECT public\.check_open_punches\(12\)\$\$/);
  assert.ok(!/http|net\.http_post/i.test(fnBody),
    'delivery is alert_channels\' job, not this function\'s');
});

// Re-applying a migration that schedules a job must not leave two running.
test('the schedule is unscheduled first so re-applying cannot double it', () => {
  assert.match(sql, /cron\.unschedule\('check-open-punches'\)/);
  assert.ok(sql.indexOf('cron.unschedule') < sql.indexOf('cron.schedule'),
    'unscheduling after scheduling would remove the job it just created');
});

test('hourly, not every fifteen minutes', () => {
  const m = sql.match(/'(\S+ \S+ \S+ \S+ \S+)',\s*\n?\s*\$\$SELECT public\.check_open_punches/);
  assert.ok(m, 'could not read the cron expression');
  assert.match(m[1], /^\d+ \* \* \* \*$/,
    'a forgotten tap-out is not time-critical the way a dead scanner is');
});

// ---- the guards every function here carries ----

test('the two-caller permission split matches the other cron functions', () => {
  assert.match(fnBody, /if auth\.uid\(\) is not null and not public\.is_admin\(\) then/,
    'pg_cron has no auth context and must pass; a human must be an admin');
  assert.match(fnBody, /SECURITY DEFINER/);
  assert.match(fnBody, /SET search_path TO 'public'/);
});

test('execute is revoked from PUBLIC and anon, granted to authenticated', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.check_open_punches\(integer\) FROM PUBLIC;/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.check_open_punches\(integer\) FROM anon;/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.check_open_punches\(integer\) TO authenticated;/);
});

test('the schema cache is reloaded, or an on-demand run would 404', () => {
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/);
});

// A shorter window would fire for a normal lunch break. An alert that cries
// wolf is one people learn to ignore, which costs the real case.
test('the threshold has a floor, like the silence check', () => {
  assert.match(fnBody, /greatest\(4, coalesce\(p_hours, 12\)\)/);
});

test('only active employees are flagged', () => {
  assert.match(fnBody, /e\.status = 'active'/);
  assert.match(fnBody, /jsonb_array_length\(e\.scan_logs\) > 0/,
    'an employee who has never scanned has no last element to read');
});

// The repo convention: a migration states how to prove it worked.
test('the migration says how to verify it against the live project', () => {
  assert.match(raw, /-- VERIFY/);
  assert.match(raw, /cron\.job where jobname = 'check-open-punches'/);
});
