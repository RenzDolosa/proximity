// The one guarantee both retention jobs have to make: nothing inside the
// window is ever removed.
//
// THE DEFECT THIS PINS. trim_employee_scan_logs() kept entries matching
//
//     (elem->>'scanned_at')::timestamptz >= v_cutoff
//
// and wrote the result back over the array. That is a whitelist of what to
// KEEP, which is not the same rule as a blacklist of what to DELETE, and the
// difference is every entry the predicate cannot evaluate:
//
//   - a missing scanned_at makes the comparison NULL, which is not TRUE, so
//     the entry fell out of the aggregate and was DELETED — at any age,
//     including one written a minute earlier;
//   - a malformed scanned_at raised on the cast and aborted the whole run,
//     invisibly, because the status panel's last_run reads
//     cron.job_run_details and that table holds zero live rows.
//
// Neither had fired: trg_append_scan_log() always writes scanned_at, and the
// job has never deleted anything because the oldest data is ~7 weeks old.
// The first real run processes 180 days in one unattended pass, which is
// precisely when an entry from an older trigger would turn up.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../Supabase/migrations/', import.meta.url));
const read = (p) => readFileSync(dir + p, 'utf8');

const strip = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => { const at = l.indexOf('--'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const fix = strip(read('20261113140000_retention_deletes_only_provably_old.sql'));
const archive = strip(read('20260930000000_scan_events_archival.sql'));

const body = (sql, name) => {
  const from = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i'));
  assert.ok(from !== -1, `could not find ${name}`);
  const to = sql.indexOf('$function$;', from);
  assert.ok(to > from, `could not isolate ${name}`);
  return sql.slice(from, to);
};

const trim = body(fix, 'trim_employee_scan_logs');
const preview = body(fix, 'preview_scan_logs_trim');
const archiveFn = body(archive, 'archive_old_scan_events');

// ---- the rule ----

test('an undatable entry is kept, not deleted', () => {
  assert.match(trim, /coalesce\(public\.try_timestamptz\(elem->>'scanned_at'\) >= v_cutoff, true\)/,
    'the coalesce to TRUE is the fix — without it a NULL comparison drops the entry');
});

test('the raw cast that could abort a run is gone', () => {
  assert.ok(!/\(elem->>'scanned_at'\)::timestamptz/.test(trim),
    'a malformed timestamp must return null, not raise and roll back the whole trim');
  assert.match(trim, /public\.try_timestamptz\(/);
});

test('the safe cast really does swallow both failure modes', () => {
  const helper = body(fix, 'try_timestamptz');
  assert.match(helper, /STRICT/, 'a NULL argument must short-circuit to NULL');
  assert.match(helper, /exception when others then\s*\n\s*return null;/,
    'malformed input must return null rather than propagate');
});

// ---- the window ----

test('both jobs floor the horizon at 90 days', () => {
  for (const [name, fn] of [['trim', trim], ['archive', archiveFn]]) {
    assert.match(fn, /greatest\(90, coalesce\(p_older_than_days, 180\)\)/,
      `${name} must not allow a caller to bring the cutoff inside three months`);
  }
});

test('the cutoff is always in the past, by construction', () => {
  for (const [name, fn] of [['trim', trim], ['archive', archiveFn]]) {
    assert.match(fn, /v_cutoff timestamptz := now\(\) - make_interval\(days => v_days\)/,
      `${name} must subtract, so no arithmetic slip can push the cutoff forward`);
  }
});

// scan_events.scanned_at is `timestamptz NOT NULL DEFAULT now()`, a real
// column, so neither failure mode above is reachable here. Pinned so that
// stays true if the predicate is ever rewritten.
test('the archive compares strictly older, against a NOT NULL column', () => {
  assert.match(archiveFn, /WHERE scanned_at < v_cutoff/);
  const baseline = read('20260922072224_production_schema_baseline.sql');
  assert.match(baseline, /scanned_at timestamp with time zone DEFAULT now\(\) NOT NULL/);
});

test('the archive moves rows rather than destroying them', () => {
  assert.match(archiveFn, /DELETE FROM public\.scan_events/);
  assert.match(archiveFn, /INSERT INTO public\.scan_events_archive/);
  assert.ok(archiveFn.indexOf('DELETE FROM') < archiveFn.indexOf('INSERT INTO'),
    'the DELETE ... RETURNING feeds the INSERT; both are one statement');
});

// ---- order ----

// get_attendance_report() reads this array with ordinality and derives
// direction from lead() over that order, so a reshuffled array mislabels
// IN/OUT until the next append re-sorts it.
test('the rewritten array keeps its order', () => {
  assert.match(trim, /jsonb_agg\(elem order by ord\)/,
    'ORDER BY must be inside the aggregate, not applied to the surrounding query');
  assert.match(trim, /jsonb_array_elements\(e\.scan_logs\) with ordinality/);
});

// ---- the evidence ----

test('the preview reports what the next run would remove', () => {
  for (const key of ['would_remove_entries', 'would_affect_employees', 'undated_entries', 'cutoff', 'horizon_days', 'newest_removed_at']) {
    assert.ok(preview.includes(`'${key}'`), `preview is missing ${key}`);
  }
});

test('the preview uses the same cutoff rule as the trim it predicts', () => {
  assert.match(preview, /greatest\(90, coalesce\(p_older_than_days, 180\)\)/);
  assert.match(preview, /at_ts is not null and at_ts < v_cutoff/,
    'strictly older AND datable — the exact complement of what the trim keeps');
});

test('undated entries are counted separately from removable ones', () => {
  assert.match(preview, /count\(\*\) filter \(where at_ts is null\)/,
    'they are a data-quality finding, not a retention outcome');
});

// THE REGRESSION A TEST CAUGHT WHILE THIS WAS BEING WRITTEN. The first draft
// folded these counts into get_scan_logs_trim_status(), which 20261107130000
// had deliberately rewritten to read the scan_logs_count counter rather than
// de-TOAST the array — three jsonb_array_length calls over 814 employees
// measured 1852 ms. The preview has to unnest, so it has to be its own
// function, called on a press.
test('the cheap status function is left alone', () => {
  // Scoped to definition and removal, not to any mention: the preview's own
  // COMMENT ON names it, which is documentation rather than a redefinition.
  assert.ok(!/(CREATE OR REPLACE|CREATE|DROP)\s+FUNCTION[^;]*get_scan_logs_trim_status/i.test(fix),
    'the status panel paints on open and must stay off the TOASTed array');
});

test('the preview is admin-only and explicitly on-demand', () => {
  assert.match(preview, /if not public\.is_admin\(\) then/);
  const anyMigration = readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .map((f) => read(f)).join('\n');
  assert.ok(!/cron\.schedule\([^)]*preview_scan_logs_trim/s.test(anyMigration),
    'nothing may put this on a timer');
});

// ---- the usual guards ----

test('the trim keeps its signature, so cron and the client are untouched', () => {
  assert.match(trim, /trim_employee_scan_logs\(p_older_than_days integer DEFAULT 180\)/);
  assert.match(trim, /RETURNS TABLE\(employees_trimmed integer, entries_removed integer, cutoff timestamptz\)/);
  const anyMigration = readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .map((f) => read(f)).join('\n');
  assert.match(anyMigration, /\$\$SELECT public\.trim_employee_scan_logs\(180\)\$\$/,
    'the cron job calls it by this exact signature');
});

test('execute is revoked from PUBLIC and anon on every new function', () => {
  for (const sig of ['try_timestamptz\\(text\\)', 'trim_employee_scan_logs\\(integer\\)', 'preview_scan_logs_trim\\(integer\\)']) {
    assert.match(fix, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC;`));
    assert.match(fix, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM anon;`));
    assert.match(fix, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated;`));
  }
});

test('the schema cache is reloaded', () => {
  assert.match(fix, /NOTIFY pgrst, 'reload schema';/);
});

test('the migration says how to prove the guarantee against live data', () => {
  const raw = read('20261113140000_retention_deletes_only_provably_old.sql');
  assert.match(raw, /-- VERIFY/);
  assert.match(raw, /newest_removed/);
  assert.match(raw, /should_also_be_null/);
});
