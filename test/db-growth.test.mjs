// Utils/dbGrowth.js and the RPC behind it (20261111160000).
//
// WHY THIS FEATURE IS A PROJECTION AND NOT A CLEANUP JOB. Measured against
// production on 2026-11-11: 92 MB of 500, scan_events carrying 100 dead
// tuples against 171,032 live, employees 95 against 814,
// cron.job_run_details 728 kB with ZERO live rows and net._http_response
// 96 kB with eight. Nothing to reclaim; autovacuum is ahead and the
// machine-written tables are bounded. What exists is a slope, and no part
// of the app showed it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FREE_PLAN_LIMIT_BYTES, scanGrowthRate, projectFull, runwayLabel,
  growthSeverity, topRelations, deadShare,
} from '../JS/Utils/dbGrowth.js';

const MIG = '20261111160000_database_usage_growth.sql';
const sql = readFileSync(
  fileURLToPath(new URL(`../Supabase/migrations/${MIG}`, import.meta.url)), 'utf8',
);
const code = sql.split('\n').map((l) => {
  const at = l.indexOf('--');
  return at === -1 ? l : l.slice(0, at);
}).join('\n');

const MB = 1000 * 1000;
const DAY = 86400000;

// ---- the rate ----

test('the rate is bytes per scan times scans per day', () => {
  const r = scanGrowthRate({
    bytes: 1000 * 300, rows: 1000,
    firstAt: '2026-10-01T00:00:00Z', lastAt: '2026-10-11T00:00:00Z',
  });
  assert.equal(r.bytesPerScan, 300);
  assert.equal(r.scansPerDay, 100);
  assert.equal(r.bytesPerDay, 30000);
  assert.equal(r.spanDays, 10);
});

// One morning's scans extrapolated to a per-day figure is an absurd slope,
// and a confident wrong number is worse than an honest blank.
test('a span under a day cannot support a rate', () => {
  const r = scanGrowthRate({
    bytes: 3000, rows: 10,
    firstAt: '2026-11-11T06:00:00Z', lastAt: '2026-11-11T14:00:00Z',
  });
  assert.equal(r, null);
});

test('missing or malformed inputs produce no rate rather than a wrong one', () => {
  assert.equal(scanGrowthRate(), null);
  assert.equal(scanGrowthRate({}), null);
  assert.equal(scanGrowthRate({ bytes: 100, rows: 0, firstAt: '2026-10-01', lastAt: '2026-11-01' }), null);
  assert.equal(scanGrowthRate({ bytes: 0, rows: 10, firstAt: '2026-10-01', lastAt: '2026-11-01' }), null);
  assert.equal(scanGrowthRate({ bytes: 100, rows: 10, firstAt: 'nope', lastAt: '2026-11-01' }), null);
  // Number(null) is 0 and 0 is finite — the trap that put unknown durations
  // at the top of the occupancy board. positive() is what catches it.
  assert.equal(scanGrowthRate({ bytes: null, rows: null, firstAt: null, lastAt: null }), null);
});

// ---- the projection ----

test('a known rate gives a day count and a date', () => {
  const now = Date.parse('2026-11-11T00:00:00Z');
  const p = projectFull({
    databaseBytes: 92 * MB, limitBytes: 500 * MB, bytesPerDay: 1 * MB, now,
  });
  assert.equal(p.daysRemaining, 408);
  assert.equal(p.pctUsed, 18.4);
  assert.equal(p.fullOn, new Date(now + 408 * DAY).toISOString());
});

// "We cannot say" has to survive all the way to the UI. Infinity renders as
// "Infinity days", and a far-future date reads as a real forecast.
test('an unknown or flat rate yields null, never Infinity or a far date', () => {
  for (const bytesPerDay of [undefined, null, 0, -5, NaN, 'lots']) {
    const p = projectFull({ databaseBytes: 92 * MB, limitBytes: 500 * MB, bytesPerDay });
    assert.equal(p.daysRemaining, null, `rate ${bytesPerDay} produced a day count`);
    assert.equal(p.fullOn, null);
    assert.equal(p.pctUsed, 18.4, 'the size it can measure is still reported');
  }
});

test('a full database reports no runway rather than a negative one', () => {
  const p = projectFull({ databaseBytes: 600 * MB, limitBytes: 500 * MB, bytesPerDay: MB });
  assert.equal(p.bytesRemaining, 0);
  assert.equal(p.daysRemaining, null);
  assert.equal(p.pctUsed, 100, 'clamped, not 120');
});

test('the free-plan ceiling is the fallback when none is reported', () => {
  assert.equal(FREE_PLAN_LIMIT_BYTES, 524288000);
  const p = projectFull({ databaseBytes: FREE_PLAN_LIMIT_BYTES / 2, bytesPerDay: MB });
  assert.equal(p.pctUsed, 50);
});

// ---- how it is said ----
//
// The slope is derived from seven weeks of one table. Quoting "412 days"
// from that is a precision the input does not carry, and a reader who sees
// a day count will plan against it.

test('runway is coarse past a couple of months', () => {
  assert.match(runwayLabel(5), /5 days/);
  assert.match(runwayLabel(1), /1 day\b/);
  assert.match(runwayLabel(120), /4 months/);
  assert.match(runwayLabel(408), /1\.1 years/);
  assert.ok(!/\d{3}/.test(runwayLabel(408)), 'no three-digit day count should reach the reader');
});

test('no runway reads as a stated absence', () => {
  for (const bad of [null, undefined, NaN, -1, 'x']) {
    assert.match(runwayLabel(bad), /not enough history/);
  }
});

// Under a year is a planning horizon, not an incident: the one lever that
// changes the slope needs a decision about discarding audit history, and
// that wants months of notice rather than a red banner.
test('severity gives notice rather than alarm', () => {
  assert.equal(growthSeverity(30), 'bad');
  assert.equal(growthSeverity(200), 'warn');
  assert.equal(growthSeverity(408), 'good');
  assert.equal(growthSeverity(null), 'unknown');
});

// ---- relations ----

test('relations are normalised, sorted and capped', () => {
  const rows = topRelations([
    { schema: 'public', name: 'small', total_bytes: 10 },
    { schema: 'cron', name: 'job_run_details', total_bytes: 728000, live_rows: 0, dead_rows: 0 },
    { schema: 'public', name: 'scan_events', total_bytes: 49000000, live_rows: 171032, dead_rows: 100 },
  ], 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'scan_events');
  assert.equal(rows[1].schema, 'cron');
});

test('a missing schema falls back to public rather than rendering undefined', () => {
  // A client talking to a project still on 20261005120000 gets rows with no
  // schema key at all. It must degrade, not print "undefined.employees".
  const [row] = topRelations([{ name: 'employees', total_bytes: 26000000 }]);
  assert.equal(row.schema, 'public');
  assert.equal(row.name, 'employees');
});

test('garbage in the table list does not throw', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    assert.deepEqual(topRelations(bad), []);
  }
  const [row] = topRelations([null]);
  assert.equal(row.name, '—');
});

// Rows, not bytes: converting assumes dead tuples are as wide as live ones,
// which for a table whose rows hold a growing jsonb array is exactly the
// assumption most likely to be wrong.
test('dead share is a row ratio, and null when there is nothing to divide', () => {
  assert.equal(deadShare({ liveRows: 171032, deadRows: 100 }), 0.1);
  assert.equal(deadShare({ liveRows: 0, deadRows: 0 }), null);
  assert.equal(deadShare(null), null);
  assert.equal(deadShare({ liveRows: 1, deadRows: 1 }), 50);
});

// ---- the RPC ----

// THE GAP THIS CLOSES. 20261005120000 filtered `nspname = 'public'`, so the
// two relations most likely to grow unobserved — cron.job_run_details and
// net._http_response — could not appear in the panel at all. Establishing
// that they were fine took a hand-written catalog query.
test('the RPC is no longer blind to everything outside public', () => {
  assert.ok(!/nspname\s*=\s*'public'/.test(code),
    "filtering to `public` is what hid cron.job_run_details and net._http_response");
  assert.ok(/nspname NOT IN \('pg_catalog', 'information_schema', 'pg_toast'\)/i.test(code),
    'exclude only Postgres\'s own fixed overhead');
  assert.ok(/'schema', n\.nspname/.test(code),
    'the schema must be carried through or the rows are ambiguous');
});

// pg_total_relation_size already folds a table's TOAST into its parent.
// Listing pg_toast separately would double-count employees, whose jsonb
// scan_logs is most of its 26 MB.
test('TOAST is excluded so employees is not counted twice', () => {
  assert.ok(/pg_toast/.test(code));
});

test('dead rows are reported alongside size, not merged into it', () => {
  assert.ok(/'dead_rows', coalesce\(s\.n_dead_tup, 0\)/.test(code));
  assert.ok(/pg_stat_all_tables/.test(code));
});

// reltuples is the planner's estimate and is -1 on a never-analysed
// relation, which would render in the UI as a row count of minus one.
test('a negative row estimate cannot reach the client', () => {
  assert.ok(/greatest\(coalesce\(s\.n_live_tup, c\.reltuples\)::bigint, 0\)/.test(code));
});

// The panel must not read the 171,032 rows it reports on.
test('the growth inputs are index probes, not a table scan', () => {
  assert.ok(/min\(scanned_at\)/.test(code) && /max\(scanned_at\)/.test(code));
  assert.ok(!/count\(\*\)\s*FROM public\.scan_events/i.test(code),
    'a count(*) over scan_events would make opening Settings read the whole table');
  assert.ok(/sum\(c\.reltuples\)/.test(code), 'row counts come from the catalog');
});

// Archival moves rows between the two tables. Counting only the live one
// would make the rate appear to drop the first time the archive job does
// something — which, on a 180-day horizon, is March 2027.
test('the rate spans both the live table and the archive', () => {
  const growth = code.slice(code.indexOf("'scan_bytes'"), code.indexOf("INTO v_growth"));
  assert.ok(/scan_events_archive/.test(growth), 'the archive must be in the rate');
  assert.ok(/least\(/.test(growth) && /greatest\(/.test(growth),
    'first and last scan span both tables');
});

test('the admin gate survived', () => {
  assert.ok(/IF NOT public\.is_admin\(\) THEN/.test(code));
});

// Same signature AND same return type, so a client deployed before this
// migration keeps working: database_bytes, database_limit_bytes, tables[]
// and measured_at all still mean what they did, and `growth` is additive.
test('this is a true CREATE OR REPLACE, so either side can ship first', () => {
  assert.ok(/CREATE OR REPLACE FUNCTION public\.get_database_usage\(\)/.test(code));
  assert.ok(/RETURNS jsonb/.test(code));
  assert.ok(!/DROP\s+FUNCTION[^;]*get_database_usage/i.test(code),
    'no DROP is needed when neither the arguments nor the return type move');
  for (const key of ['database_bytes', 'database_limit_bytes', "'tables'", "'measured_at'"]) {
    assert.ok(code.includes(key), `${key} must survive — the old client reads it`);
  }
});
