// Guards on 20261107130000 — two Settings-page defects found by reading the
// Postgres log, not by anyone reporting them.
//
// Neither was reachable by the existing suite: nothing tested a function's
// search_path against the schema its dependencies actually live in, and
// get_scan_logs_trim_status() had no test of any kind.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = new URL('../Supabase/migrations/', import.meta.url);
const files = readdirSync(fileURLToPath(DIR)).filter((f) => f.endsWith('.sql')).sort();

const strip = (src) => src.split('\n').map((l) => {
  const at = l.indexOf('--');
  return at === -1 ? l : l.slice(0, at);
}).join('\n');

const read = (f) => strip(readFileSync(fileURLToPath(new URL(f, DIR)), 'utf8'));
const migration = read('20261107130000_settings_panel_repairs.sql');

// The newest definition wins. These read the whole migration directory rather
// than one file so they keep describing the live database if a later file
// touches either function, and fail honestly if that one regresses.
function latestFunction(name) {
  let found = null;
  for (const f of files) {
    const sql = read(f);
    const at = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i'));
    if (at === -1) continue;
    const body = sql.slice(at);
    const end = body.indexOf('$function$;');
    found = { file: f, body: end === -1 ? body : body.slice(0, end) };
  }
  return found;
}

function latestSearchPath(name) {
  let found = null;
  for (const f of files) {
    const sql = read(f);
    const re = new RegExp(`ALTER FUNCTION public\\.${name}\\([^)]*\\)\\s*SET search_path TO ([^;]+);`, 'i');
    const m = sql.match(re);
    if (m) found = { file: f, path: m[1].replace(/\s+/g, ' ').trim() };
    // A later CREATE OR REPLACE would carry its own SET and override the ALTER.
    const fn = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i'));
    if (fn !== -1) {
      const body = sql.slice(fn, fn + 400);
      const inline = body.match(/SET search_path TO ([^\n]+)/i);
      if (inline) found = { file: f, path: inline[1].replace(/\s+/g, ' ').trim() };
    }
  }
  return found;
}

// ---- 1. the 42P01 ----
//
// pg_stat_statements is created `WITH SCHEMA extensions` by the baseline, and
// a function-level SET search_path REPLACES the session's rather than
// extending it. Pinning to 'public' alone makes an unqualified reference to
// the view unresolvable from inside the function — while the identical query
// succeeds in the SQL Editor, which is how this shipped.

test('the baseline really does put the extension outside public', () => {
  const baseline = read('20260922072224_production_schema_baseline.sql');
  assert.match(baseline, /CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions/i,
    'if the extension moved to public this whole fix is addressing the wrong cause');
});

for (const fn of ['get_slow_query_stats', 'reset_slow_query_stats']) {
  test(`${fn} can see the schema its dependency lives in`, () => {
    const sp = latestSearchPath(fn);
    assert.ok(sp, `${fn} has no search_path setting at all`);
    assert.match(sp.path, /extensions/,
      `${fn} pins a search_path without 'extensions' — every call raises 42P01`);
    assert.match(sp.path, /public/,
      `${fn} must keep 'public': its body calls public.is_admin() unqualified`);
  });
}

// Both functions reference the extension by bare name, which is the reason
// the search_path matters at all. If a later migration schema-qualifies them
// the ALTERs become redundant — worth knowing, not worth failing over, so
// this asserts the pairing rather than either half alone.
test('the unqualified references the search_path exists to serve are still there', () => {
  const baseline = read('20260922072224_production_schema_baseline.sql');
  assert.match(baseline, /\n\s*from pg_stat_statements\b/i,
    'get_slow_query_stats no longer reads the view unqualified');
  assert.match(baseline, /perform pg_stat_statements_reset\(\)/i,
    'reset_slow_query_stats no longer calls the function unqualified');
});

// The one failure mode the ALTERs cannot fix. A missing extension would
// otherwise surface as the same 42P01 after a "successful" migration.
test('a missing extension aborts the migration instead of shipping quietly', () => {
  assert.match(migration, /SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'/i);
  assert.match(migration, /RAISE EXCEPTION/i,
    'absence must abort, not warn — a notice scrolls past in the apply output');
});

// ---- 2. the 1.85s status readout ----

test('the trim status reads the counter, not the TOASTed array', () => {
  const fn = latestFunction('get_scan_logs_trim_status');
  assert.ok(fn, 'get_scan_logs_trim_status has no definition');
  assert.equal(fn.file, '20261107130000_settings_panel_repairs.sql',
    'a later migration redefined it — re-read these guards against that one');
  assert.ok(!/jsonb_array_length\s*\(\s*scan_logs\s*\)/i.test(fn.body),
    'reading any part of a TOASTed jsonb fetches, decompresses and parses all '
    + 'of it; three such calls over 814 employees measured 1852 ms');
  for (const agg of [/sum\(scan_logs_count\)/i, /where scan_logs_count > 0/i, /max\(scan_logs_count\)/i]) {
    assert.match(fn.body, agg, 'all three aggregates must come off the counter column');
  }
});

// The counter is only trustworthy because something keeps it in step. If that
// trigger is ever dropped this function starts reporting stale numbers with
// no error anywhere — so the guard belongs with the consumer, not just with
// the migration that created it.
test('the counter this now depends on is still trigger-maintained', () => {
  const source = read('20261106180000_directory_scan_count_without_detoast.sql');
  assert.match(source, /CREATE TRIGGER trg_employees_sync_scan_logs_count/i,
    'scan_logs_count has no trigger keeping it current');
  assert.match(source, /BEFORE INSERT OR UPDATE OF scan_logs ON public\.employees/i,
    'the trigger must fire on the column it mirrors');
  assert.match(source, /EXECUTE FUNCTION public\.trg_sync_scan_logs_count\(\)/i,
    'the trigger must still be wired to the function that computes the count');
});

test('the readout keeps the exact shape the Settings panel renders', () => {
  const fn = latestFunction('get_scan_logs_trim_status');
  for (const key of ['total_entries', 'employees_with_entries',
    'max_entries_for_one_employee', 'last_run']) {
    assert.ok(fn.body.includes(`'${key}'`), `${key} dropped from the response`);
  }
  assert.match(fn.body, /RETURNS jsonb/i, 'CREATE OR REPLACE requires an identical signature');
  assert.match(fn.body, /if not public\.is_admin\(\)/i,
    'the admin gate must survive the rewrite');
  assert.match(fn.body, /SECURITY DEFINER/i);
  assert.match(fn.body, /STABLE/i);
});

// pg_cron's own history table is not something this app controls the shape
// of, and a failure reading it must not take down the counts above it.
test('the cron lookup stays best-effort', () => {
  const fn = latestFunction('get_scan_logs_trim_status');
  assert.match(fn.body, /exception when others then\s*\n?\s*v_last_run := null/i,
    'a pg_cron schema change would otherwise break the whole panel');
});
