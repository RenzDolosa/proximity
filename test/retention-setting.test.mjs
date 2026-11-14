// Retention as a setting: off by default, and never acting on the day it
// was changed.
//
// THE REQUIREMENT. "Default is 0, user set to 90 Days, the data older than
// 90 Days will be deleted the next day, not on the day it was set." Two
// guarantees, and the second is the one with teeth: choosing a horizon makes
// data deletable, and the grace period means the job that would act on a
// typo has not run yet.
//
// BEHAVIOUR CHANGE THIS LOCKS IN: the cron schedule used to pass a hardcoded
// 180. It now passes nothing and reads the setting, which starts at 0. So
// after this migration the system deletes nothing until somebody chooses a
// horizon. That is what was asked for, and it is the safe direction, but it
// is not a no-op.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// From Utils, not Models: RetentionModel imports the Supabase client, which
// reaches for `window` and cannot be loaded under Node. Same split as
// Utils/alertKinds.js.
import {
  RETENTION_OFF, RETENTION_MIN_DAYS, RETENTION_MAX_DAYS, RETENTION_CHOICES,
  isValidRetentionDays, retentionSummary,
} from '../JS/Utils/retention.js';

const dir = fileURLToPath(new URL('../Supabase/migrations/', import.meta.url));
const read = (p) => readFileSync(dir + p, 'utf8');
const strip = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => { const at = l.indexOf('--'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const raw = read('20261113160000_configurable_retention_with_grace.sql');
const sql = strip(raw);
const body = (name) => {
  const from = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i'));
  assert.ok(from !== -1, `could not find ${name}`);
  const to = sql.indexOf('$function$;', from);
  return sql.slice(from, to);
};
const trim = body('trim_employee_scan_logs');
const setter = body('set_retention_days');
const getter = body('get_retention_settings');

// ---- default is off ----

test('the stored default is 0, and 0 means delete nothing', () => {
  assert.match(sql, /scan_logs_days integer NOT NULL DEFAULT 0/);
  assert.match(sql, /VALUES \(true, 0, NULL\)/, 'the single row is seeded off');
  assert.match(trim, /if coalesce\(v_set_days, 0\) = 0 then\s*\n\s*return query select 0, 0, null::timestamptz;/,
    'off must short-circuit before any cutoff is computed');
});

test('the schedule no longer hardcodes a horizon over the setting', () => {
  assert.match(sql, /\$\$SELECT public\.trim_employee_scan_logs\(\)\$\$/);
  assert.ok(!/\$\$SELECT public\.trim_employee_scan_logs\(180\)\$\$/.test(sql),
    'an argument on the schedule would override the stored horizon on every run');
  assert.match(sql, /cron\.unschedule\('trim-employee-scan-logs'\)/);
  assert.ok(sql.indexOf('cron.unschedule') < sql.indexOf('cron.schedule'),
    'unschedule first, or re-applying leaves two jobs');
});

// ---- the grace period ----

test('a change takes effect the NEXT local day, never the same day', () => {
  assert.match(setter, /\(\(now\(\) at time zone v_tz\)::date \+ 1\)/,
    'tomorrow, in the configured zone');
  assert.match(trim, /\(now\(\) at time zone coalesce\(v_tz, 'Asia\/Manila'\)\)::date < v_from/,
    'the job must refuse while today is before effective_from');
});

test('the effective date is computed server-side, not accepted from a caller', () => {
  assert.match(setter, /set_retention_days\(p_days integer\)/,
    'the only parameter is the horizon — a caller that could pass a date could pass today');
  assert.ok(!/p_effective|p_from|p_date/.test(setter));
});

test('every change resets the clock, including raising the horizon', () => {
  // The effective date has exactly two branches — off, or tomorrow. There is
  // no third for "unchanged" or "raised", so the grace cannot be conditional
  // on which way the number moved. One rule, no exception to remember;
  // waiting a day to delete LESS costs nothing.
  //
  // Asserted on the expression rather than by searching for `if v_days <`,
  // which the first draft did and which matched the range validation above.
  assert.match(setter, /v_from := case when v_days = 0 then null\s*\n\s*else \(\(now\(\) at time zone v_tz\)::date \+ 1\) end;/);
  assert.ok(!/select scan_logs_days[^;]*into v_old|v_previous|v_was/.test(setter),
    'the setter never reads the old horizon, so it cannot branch on the direction');
});

test('turning retention off clears the effective date rather than leaving it set', () => {
  assert.match(setter, /case when v_days = 0 then null/);
});

// ---- the floor ----

test('below the floor is refused, not silently raised', () => {
  assert.match(setter, /raise exception 'retention must be 0 \(off\) or between 90 and 3650 days'/);
  assert.match(sql, /CHECK \(scan_logs_days = 0 OR \(scan_logs_days >= 90 AND scan_logs_days <= 3650\)\)/,
    'the floor belongs in the data, not only in the setter');
});

test('a manual override can only keep MORE, never less', () => {
  assert.match(trim, /greatest\(v_set_days, coalesce\(p_older_than_days, v_set_days\)\)/,
    'an admin running this by hand must not reach past the configured horizon');
});

// ---- the archive is deliberately untouched ----

test('archiving is not gated behind the setting', () => {
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).map(read).join('\n');
  assert.match(all, /\$\$SELECT public\.archive_old_scan_events\(180\)\$\$/,
    'the archive MOVES rows and loses nothing; gating it would only let someone '
    + 'switch off the thing keeping the live table small');
  assert.ok(!/archive_old_scan_events[\s\S]{0,400}retention_settings/.test(sql));
});

// ---- the table ----

test('exactly one settings row can exist', () => {
  assert.match(sql, /id boolean PRIMARY KEY DEFAULT true CHECK \(id\)/);
});

test('the table is RLS-on with no policies, reached only through the functions', () => {
  assert.match(sql, /ALTER TABLE public\.retention_settings ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.retention_settings FROM authenticated;/);
  assert.ok(!/CREATE POLICY[^;]*retention_settings/i.test(sql));
});

test('reading and writing are admin-only', () => {
  assert.match(getter, /if not public\.is_admin\(\) then/);
  assert.match(setter, /if not public\.is_admin\(\) then/);
});

test('changing the rule that governs deletion is attributed', () => {
  assert.match(setter, /log_audit_event\(\s*\n?\s*'retention_changed'/,
    'one row per human action, not a trigger on anything');
});

test('the schema cache is reloaded', () => {
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/);
});

test('the migration says how to prove the grace period without waiting a day', () => {
  assert.match(raw, /-- VERIFY/);
  assert.match(raw, /should_be_false/);
  assert.match(raw, /rollback;/);
});

// ---- what the admin is told ----

test('the three states are worded differently', () => {
  const off = retentionSummary({ scan_logs_days: 0 });
  const pending = retentionSummary({ scan_logs_days: 90, active_now: false, days_until_active: 1, effective_from: '2026-11-14' });
  const active = retentionSummary({ scan_logs_days: 90, active_now: true });
  assert.match(off, /is ever deleted/i);
  assert.match(pending, /Takes effect/);
  assert.match(pending, /2026-11-14/, 'the date is the whole point of the pending state');
  assert.match(active, /removed daily/);
  assert.notEqual(off, pending);
  assert.notEqual(pending, active);
});

test('an unknown setting says so rather than guessing', () => {
  assert.match(retentionSummary(null), /unknown/i);
  assert.match(retentionSummary({}), /unknown/i);
});

// 0 is a MEANINGFUL value here — it is "off" — so the usual Number(null) === 0
// trap would turn "no answer" into "retention disabled", which reads as a
// deliberate choice nobody made.
test('a nullish horizon is not mistaken for off', () => {
  assert.equal(isValidRetentionDays(null), false);
  assert.equal(isValidRetentionDays(undefined), false);
  assert.equal(isValidRetentionDays(NaN), false);
  assert.equal(isValidRetentionDays('90'), false, 'a string is not a count');
  assert.equal(isValidRetentionDays(0), true, 'but a real 0 is valid — it is off');
});

test('the client refuses the same values the server does', () => {
  assert.equal(isValidRetentionDays(RETENTION_OFF), true);
  assert.equal(isValidRetentionDays(RETENTION_MIN_DAYS), true);
  assert.equal(isValidRetentionDays(RETENTION_MAX_DAYS), true);
  assert.equal(isValidRetentionDays(30), false);
  assert.equal(isValidRetentionDays(89), false);
  assert.equal(isValidRetentionDays(RETENTION_MAX_DAYS + 1), false);
  assert.equal(isValidRetentionDays(90.5), false);
});

test('every offered choice is one the server will accept', () => {
  for (const c of RETENTION_CHOICES) {
    assert.ok(isValidRetentionDays(c.value), `the picker offers ${c.value}, which would be refused`);
  }
  assert.equal(RETENTION_CHOICES[0].value, 0, 'off leads the list, because it is the default');
});

// ---- the panel ----

test('the panel loads the setting with the counts, but never the preview', () => {
  const page = readFileSync(fileURLToPath(new URL('../JS/Features/Settings/SettingsPage.js', import.meta.url)), 'utf8');
  const from = page.indexOf('async function loadTrimStatus');
  const to = page.indexOf('async function saveRetention', from);
  assert.ok(from !== -1 && to > from, 'could not isolate loadTrimStatus');
  const fn = page.slice(from, to);
  assert.match(fn, /RetentionModel\.get\(\)/);
  assert.ok(!/RetentionModel\.preview\(/.test(fn),
    'the preview unnests every scan_logs array — it must not run on panel open');
});

// The first version of this panel rendered the picker as `settings ? … : ''`,
// so a failed read — exactly what happens before the migration is applied —
// removed the control with no explanation. An admin cannot tell a setting
// that silently does not exist from one that was never built.
test('a failed retention read explains itself instead of hiding the control', () => {
  const page = readFileSync(fileURLToPath(new URL('../JS/Features/Settings/SettingsPage.js', import.meta.url)), 'utf8');
  assert.match(page, /retentionError/, 'the failure has to be kept, not just the success');
  // Bounded to the retention block. An unbounded lazy match runs on into the
  // trimPreview ternary below it, which legitimately ends in `: ''` — the
  // same mistake the readAccounted and applyUpdateNow guards made earlier.
  const from = page.indexOf('${r ? `');
  const to = page.indexOf('${trimPreview ?', from);
  assert.ok(from !== -1 && to > from, 'could not isolate the retention block');
  // The positive assertion is the whole test: this sentence lives only in
  // the false branch, so if that branch ever goes back to '' it disappears
  // and this fails. A separate "no empty branch" regex was tried first and
  // kept matching the trimPreview ternary underneath.
  assert.match(page.slice(from, to), /Retention control unavailable/,
    'the false branch must say why, not render nothing');
});

test('a changed setting discards a preview computed against the old one', () => {
  const page = readFileSync(fileURLToPath(new URL('../JS/Features/Settings/SettingsPage.js', import.meta.url)), 'utf8');
  const from = page.indexOf('async function saveRetention');
  const to = page.indexOf('async function loadTrimPreview', from);
  assert.match(page.slice(from, to), /trimPreview = null/);
});
