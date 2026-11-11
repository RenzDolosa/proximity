// The export ledger and the paging that feeds it (20261106150000).
//
// Utils/exportChunking.js is pure, so the paging rules are exercised for
// real. The table, its RLS and the RPC gates are source assertions, same as
// every other migration guard in this project.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_PAGE_SIZE, EXPORT_ROW_CEILING, newExportState, appendPage,
  nextCursor, isFinalPage, readPage, exportProgressLabel, hitRowCeiling,
} from '../JS/Utils/exportChunking.js';
import { canViewExportTasks } from '../JS/Core/accessControl.js';

import { GROUPED_ROUTES, BOTTOM_NAV_LABEL } from '../JS/Core/navGroups.js';

// Read from source rather than imported: ExportTasksModel pulls in
// Core/supabaseClient.js and Pagination pulls in Utils/dom.js, both of which
// touch `window` at import time and throw in Node. Same reason the scanner
// health tests read StandaloneScanner.js as text.
const js = (p) => readFileSync(fileURLToPath(new URL(`../JS/${p}`, import.meta.url)), 'utf8');
// A regex literal, not new RegExp(`...\s...`): inside a template literal
// `\s` is just the character s, so the constructed pattern silently matches
// nothing and the constant reads as NaN.
const EXPORT_TASKS_MAX_PAGE_SIZE = Number(
  js('Models/ExportTasksModel.js').match(/EXPORT_TASKS_MAX_PAGE_SIZE = (\d+)/)[1],
);
const PAGE_SIZES = JSON.parse(js('Components/Pagination.js').match(/PAGE_SIZES = (\[[^\]]*\])/)[1]);

const row = (id, scanned_at) => ({ id, scanned_at });

// ---- the cursor ----

test('the cursor is the last row of the page', () => {
  const c = nextCursor([row('a', '2026-11-06T10:00:00Z'), row('b', '2026-11-06T09:00:00Z')]);
  assert.deepEqual(c, { afterScannedAt: '2026-11-06T09:00:00Z', afterId: 'b' });
});

test('an empty page yields no cursor, which is the signal to stop', () => {
  assert.equal(nextCursor([]), null);
  assert.equal(nextCursor(null), null);
});

// A cursor missing either half would skip or repeat every row sharing the
// boundary timestamp, so a malformed row must stop the walk rather than
// produce a cursor that silently loses data.
test('a row without both halves produces no cursor at all', () => {
  assert.equal(nextCursor([{ id: 'a' }]), null);
  assert.equal(nextCursor([{ scanned_at: '2026-11-06T10:00:00Z' }]), null);
});

// ---- when to stop ----

test('a short page is the last one', () => {
  assert.equal(isFinalPage(new Array(9999).fill(row('x', 'y')), 10000), true);
});

// Not the end: there may be nothing after it, and the next request returning
// zero rows is what proves that. One extra empty request is the price of
// never truncating an export.
test('a full page is not assumed to be the last one', () => {
  assert.equal(isFinalPage(new Array(10000).fill(row('x', 'y')), 10000), false);
});

test('a missing page reads as the end rather than throwing', () => {
  assert.equal(isFinalPage(null, 10), true);
  assert.equal(isFinalPage(undefined, 10), true);
});

// ---- the 1,000-row cap, and why the page size must come from the server ----
//
// Reported 2026-11-11 as "the scan log export is missing rows". Every export
// held exactly 1,000: PostgREST's db-max-rows truncated each page after the
// function's own LIMIT, the loop compared 1,000 against the 10,000 it had
// ASKED for, and `1000 < 10000` read as end-of-data. One page, then stop.
//
// isFinalPage() was never wrong. It was fed a number the server had no part
// in choosing. These tests pin the correction: compare against what the
// response says, and when the response cannot say, only an empty page ends
// the walk.

test('a truncated page is no longer mistaken for the last one', () => {
  // The exact failing case: asked for 10,000, server honoured 1,000.
  const page = new Array(1000).fill(row('x', 'y'));
  assert.equal(isFinalPage(page, EXPORT_PAGE_SIZE), true,
    'this is the assumption that broke — kept here so the fix below is '
    + 'visibly doing something');
  assert.equal(readPage({ limit: 1000, rows: page }, EXPORT_PAGE_SIZE).final, false,
    'against the limit the server reports, a full page is a full page');
});

test('a short page is still the end when the server sets the size', () => {
  const page = new Array(999).fill(row('x', 'y'));
  assert.equal(readPage({ limit: 1000, rows: page }, EXPORT_PAGE_SIZE).final, true);
});

test('an empty page ends the walk whatever the limit says', () => {
  assert.equal(readPage({ limit: 10000, rows: [] }, EXPORT_PAGE_SIZE).final, true);
});

test('the rows come back untouched', () => {
  const rows = [row('a', '3'), row('b', '2')];
  assert.deepEqual(readPage({ limit: 10000, rows }, EXPORT_PAGE_SIZE).rows, rows);
});

// A bare array means the RETURNS TABLE version is still live — the frontend
// shipped before 20261111120000 was applied. The real cap is unknowable from
// here, so the only safe stop condition is an empty page. Costs one extra
// request; cannot truncate.
test('against the old set-returning RPC, only an empty page stops the walk', () => {
  assert.equal(readPage(new Array(1000).fill(row('x', 'y')), EXPORT_PAGE_SIZE).final, false);
  // Even a page far shorter than any plausible cap keeps going, because
  // "short" and "capped" are indistinguishable without the server's number.
  assert.equal(readPage([row('a', '1')], EXPORT_PAGE_SIZE).final, false);
  assert.equal(readPage([], EXPORT_PAGE_SIZE).final, true);
});

test('a missing or malformed response reads as the end rather than throwing', () => {
  assert.deepEqual(readPage(null, EXPORT_PAGE_SIZE), { rows: [], final: true });
  assert.deepEqual(readPage(undefined, EXPORT_PAGE_SIZE), { rows: [], final: true });
  assert.deepEqual(readPage({ limit: 10000 }, EXPORT_PAGE_SIZE), { rows: [], final: true });
});

// Number(null) and Number('') are both 0, and 0 is finite. A limit that fell
// through as 0 would make `rows.length < 0` false for every page — or, with
// the comparison the other way round, make every page short and stop the
// export on page one, which is the bug all over again.
test('a limit of zero or null falls back to what was asked for', () => {
  const full = new Array(EXPORT_PAGE_SIZE).fill(row('x', 'y'));
  for (const limit of [0, null, '', undefined, -1, 'lots']) {
    assert.equal(readPage({ limit, rows: full }, EXPORT_PAGE_SIZE).final, false,
      `limit ${JSON.stringify(limit)} must not end the walk on a full page`);
  }
  assert.equal(readPage({ limit: null, rows: [row('a', '1')] }, EXPORT_PAGE_SIZE).final, true);
});

// The walk itself, not just the predicate. Four pages of 1,000 against a
// client that asked for 10,000 — the production shape — must yield 3,500
// rows, not 1,000.
test('the export walks every page of a capped server', () => {
  const all = Array.from({ length: 3500 }, (_, i) => row(`id-${i}`, `t-${i}`));
  const state = newExportState();
  let at = 0;
  for (;;) {
    const page = all.slice(at, at + 1000);
    at += page.length;
    const { rows, final } = readPage({ limit: 1000, rows: page }, EXPORT_PAGE_SIZE);
    appendPage(state, rows);
    if (final) break;
    assert.ok(nextCursor(rows), 'a full page must yield a cursor');
  }
  assert.equal(state.rows.length, 3500);
});

// A source assertion: the pure helpers above can be right while the one place
// that matters still compares against its own page size.
test('the export loop uses the server-reported size, not its own', () => {
  const src = js('Components/ExportScanLogsModal.js');
  assert.ok(/const \{ rows, final \} = readPage\(/.test(src),
    'fetchAllScanLogs must take `final` from readPage');
  assert.ok(!/isFinalPage\(/.test(src),
    'comparing against EXPORT_PAGE_SIZE in the loop is what capped every '
    + 'export at 1,000 rows');
});

// Correct is not the same as cheap. Against the old set-returning RPC, asking
// for 10,000 means the database computes 9,000 rows a page that PostgREST
// throws away — ten times the work, with the cursor advancing only by what
// arrives. The walk is right either way; this keeps it from being wasteful
// while the migration is outstanding.
test('the loop stops over-asking once it sees the uncapped shape', () => {
  const src = js('Components/ExportScanLogsModal.js');
  assert.ok(/if \(Array\.isArray\(data\)\) limit = POSTGREST_MAX_ROWS;/.test(src),
    'a bare array means the old RPC is still live and the page size is 1,000 '
    + 'whatever we ask for');
  assert.ok(/limit: limit|from, to, cursor, limit,/.test(src),
    'the adjusted limit must be the one actually sent on the next request');
});

// ---- the dedupe ----

test('pages accumulate in order', () => {
  const s = newExportState();
  assert.equal(appendPage(s, [row('a', '3'), row('b', '2')]), 2);
  assert.equal(appendPage(s, [row('c', '1')]), 1);
  assert.deepEqual(s.rows.map((r) => r.id), ['a', 'b', 'c']);
});

// THE RACE THIS EXISTS FOR. archive_old_scan_events() runs at 03:00 UTC and
// moves rows from scan_events to scan_events_archive. The export reads both,
// so a row moved mid-export can be read from one table on an early page and
// the other on a later one. A duplicate in a payroll export is worse than a
// slow one.
test('a row that moved to the archive mid-export is not exported twice', () => {
  const s = newExportState();
  appendPage(s, [row('a', '3'), row('b', '2')]);
  const added = appendPage(s, [row('b', '2'), row('c', '1')]);
  assert.equal(added, 1, 'only c was new');
  assert.deepEqual(s.rows.map((r) => r.id), ['a', 'b', 'c']);
});

// Losing a real scan is worse than a possible duplicate, and id is a primary
// key so this should never happen at all.
test('a row with no id is kept rather than dropped', () => {
  const s = newExportState();
  assert.equal(appendPage(s, [{ scanned_at: '1' }, { scanned_at: '2' }]), 2);
  assert.equal(s.rows.length, 2);
});

test('a missing page adds nothing and does not throw', () => {
  const s = newExportState();
  assert.equal(appendPage(s, null), 0);
  assert.equal(appendPage(s, undefined), 0);
  assert.equal(s.rows.length, 0);
});

// ---- the ceiling ----

test('the ceiling is a stop, and it is above the old silent cap', () => {
  assert.ok(EXPORT_ROW_CEILING > 100000,
    'get_all_scan_events truncated at 100,000 without saying so — the '
    + 'replacement must not stop sooner than the thing it replaced');
  const s = newExportState();
  s.rows = new Array(EXPORT_ROW_CEILING).fill(row('x', 'y'));
  assert.equal(hitRowCeiling(s), true);
});

test('a normal export is nowhere near the ceiling', () => {
  const s = newExportState();
  s.rows = new Array(EXPORT_PAGE_SIZE).fill(row('x', 'y'));
  assert.equal(hitRowCeiling(s), false);
});

test('an empty state has not hit the ceiling', () => {
  assert.equal(hitRowCeiling(newExportState()), false);
  assert.equal(hitRowCeiling(null), false);
});

// ---- progress ----
//
// No percentage and no total: nothing knows how many rows the export has
// until it ends, and a count query would be a whole extra request to produce
// a number that only animates a bar. Same rule as the health drawer refusing
// to invent a denominator.
test('progress states what was fetched, and claims no total', () => {
  const label = exportProgressLabel(12345, 2);
  assert.ok(label.includes('12,345'), 'the row count is the real figure');
  assert.ok(!label.includes('%'), 'a percentage would require a total nobody has');
  assert.ok(!label.includes('of'), 'no denominator');
});

test('progress survives a missing count', () => {
  assert.ok(exportProgressLabel(undefined, undefined).startsWith('0 rows'));
  assert.ok(exportProgressLabel(null, 0).includes('page 1'));
});

// ---- who can see it ----

test('exporting and seeing the export ledger are the same permission', () => {
  assert.equal(canViewExportTasks({ role: 'admin' }), true);
  assert.equal(canViewExportTasks({ role: 'manager' }), true);
  assert.equal(canViewExportTasks({ role: 'viewer' }), false);
  assert.equal(canViewExportTasks(null), false);
});

test('the route is in the sidebar and has a phone label', () => {
  assert.ok(GROUPED_ROUTES.includes('exports'), 'a route absent from navGroups is unreachable');
  assert.ok(BOTTOM_NAV_LABEL.exports, 'every route needs a short label for the bottom bar');
});

// ---- the table and its scoping ----

const MIGRATION = readFileSync(
  fileURLToPath(new URL('../Supabase/migrations/20261106150000_export_tasks.sql', import.meta.url)),
  'utf8',
);
const sql = MIGRATION.split('\n').map((l) => {
  const at = l.indexOf('--');
  return at === -1 ? l : l.slice(0, at);
}).join('\n');

// The CREATE TABLE body. A helper rather than two copies of indexOf('CREATE
// TABLE public.export_tasks'): adding IF NOT EXISTS moved that string, and
// sql.slice(-1, n) quietly returns the wrong text instead of throwing.
const tableBody = () => {
  const at = sql.search(/CREATE TABLE (IF NOT EXISTS )?public\.export_tasks/i);
  assert.notEqual(at, -1, 'the export_tasks table must be created');
  return sql.slice(at, sql.indexOf(');', at));
};
// THE RULE THAT WAS ASKED FOR, and the reason it is a policy rather than
// only a filter inside the function everyone currently happens to call.
test('an admin sees every task, everyone else sees only their own', () => {
  assert.ok(/CREATE POLICY export_tasks_select_scope[\s\S]*?USING \(public\.is_admin\(\) OR user_id = auth\.uid\(\)\)/i.test(sql),
    'the scope must be an RLS policy on the table, not just a WHERE clause');
  const fn = sql.slice(sql.indexOf('FUNCTION public.get_export_tasks'));
  assert.ok(/v_admin or t\.user_id = auth\.uid\(\)/i.test(fn),
    'and the listing RPC must apply the same scope');
});

// These migrations are applied by hand in the SQL Editor, where a statement
// failing halfway leaves the earlier ones committed. Re-running then died on
// 42P07 "already exists" and had to be hand-edited to continue — twice, on
// 20261104090000 and 20261104093000. Every creating statement here must be
// safe to run a second time.
test('the migration can be run again after a partial apply', () => {
  const creates = sql.match(/^CREATE (TABLE|INDEX|POLICY)[^\n]*/gim) || [];
  assert.ok(creates.length >= 4, `expected the table, two indexes and a policy, found ${creates.length}`);
  for (const stmt of creates) {
    if (/^CREATE POLICY/i.test(stmt)) {
      // A policy has no IF NOT EXISTS, so it needs an explicit drop first.
      const name = stmt.match(/CREATE POLICY (\w+)/i)[1];
      assert.ok(new RegExp(`DROP POLICY IF EXISTS ${name}`, 'i').test(sql),
        `${name} must be dropped if present before being created`);
      continue;
    }
    assert.ok(/IF NOT EXISTS/i.test(stmt),
      `not re-runnable, will fail with 42P07 on a retry: ${stmt.slice(0, 60)}`);
  }
  // The four functions are the other half of the same property.
  const fns = sql.match(/^CREATE (OR REPLACE )?FUNCTION[^\n]*/gim) || [];
  assert.equal(fns.length, 4, 'expected four functions');
  for (const fn of fns) {
    assert.ok(/OR REPLACE/i.test(fn), `${fn.slice(0, 50)} would fail with 42723 on a retry`);
  }
});

// A client that could UPDATE its own rows could rewrite the ledger, which
// would make it worthless as a record.
test('the ledger cannot be rewritten from the client', () => {
  assert.ok(/ENABLE ROW LEVEL SECURITY/i.test(sql), 'RLS must be on');
  assert.ok(!/FOR (INSERT|UPDATE|DELETE)/i.test(sql),
    'there must be no INSERT/UPDATE/DELETE policy — the SECURITY DEFINER '
    + 'writers are the only way in');
});

// A ledger of who exported personal attendance data must outlive the account
// that did it; a cascading FK would erase exactly the rows an investigation
// wants. Same shape as audit_log.actor_id/actor_name.
test('deleting a user does not erase their export history', () => {
  const table = tableBody();
  assert.ok(/user_id uuid/i.test(table) && /operator_name text/i.test(table),
    'the operator name must be snapshotted alongside the id');
  assert.ok(!/REFERENCES/i.test(table),
    'no foreign key on user_id, or deleting a profile cascades the ledger away');
});

test('both writers and the listing are gated', () => {
  for (const fn of ['start_export_task', 'get_export_tasks', 'get_scan_events_page']) {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}`));
    assert.ok(/is_admin_or_manager\(\)/.test(body.slice(0, 2000)),
      `${fn} must refuse an account that cannot export`);
  }
});

// Not is_admin_or_manager(): an admin has no business closing someone else's
// export, and a settled row must not be reopened or re-counted.
test('only the owner can settle their own running task', () => {
  const fn = sql.slice(sql.indexOf('FUNCTION public.finish_export_task'), sql.indexOf('FUNCTION public.get_export_tasks'));
  assert.ok(/user_id = auth\.uid\(\)/.test(fn), 'scoped to the caller');
  assert.ok(/status = 'running'/.test(fn), 'and to a task that has not already settled');
});

// CAUGHT IN A BROWSER, not by reading. The RPC originally clamped p_limit to
// 200 while the page-size selector offered 500: the client asked for 500, got
// 200, then computed the next page's offset as 500 and stepped straight over
// the 300 in between. Silently, in a table whose whole job is to be a
// complete record.
test('the listing clamp is not below the largest page size the UI offers', () => {
  const fn = sql.slice(sql.indexOf('FUNCTION public.get_export_tasks'));
  const clamp = Number((fn.match(/least\(coalesce\(p_limit,\s*\d+\),\s*(\d+)\)/i) || [])[1]);
  assert.ok(Number.isFinite(clamp), 'the listing must clamp p_limit at all');
  assert.equal(clamp, EXPORT_TASKS_MAX_PAGE_SIZE,
    'the model mirrors this number; they must agree');
  assert.ok(clamp >= Math.max(...PAGE_SIZES),
    `the selector offers ${Math.max(...PAGE_SIZES)} rows and the server returns `
    + `at most ${clamp} — every row in between is skipped by the next page`);
});

test('the listing carries its own total, rather than a second count request', () => {
  const fn = sql.slice(sql.indexOf('FUNCTION public.get_export_tasks'));
  assert.ok(/count\(\*\) over \(\)/i.test(fn),
    'a separate count RPC would be an extra request and an extra log event '
    + 'for one bigint');
});

test('every new RPC is revoked from anon and granted to authenticated', () => {
  for (const fn of ['start_export_task', 'finish_export_task', 'get_export_tasks', 'get_scan_events_page']) {
    assert.ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM anon`, 'i').test(sql),
      `${fn} is not revoked from anon — REVOKE FROM PUBLIC does not cover it on this project`);
    assert.ok(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`, 'i').test(sql),
      `${fn} is not granted to authenticated`);
  }
});

// No Storage bucket, no files, no stored copy of anyone's scan history. The
// whole reason the page says "Re-run" instead of "Download".
test('the ledger stores no exported data and no files', () => {
  assert.ok(!/storage\./i.test(sql) && !/create bucket/i.test(sql),
    'storing files would mean Storage, and every download from Storage is '
    + 'billed egress');
  const table = tableBody();
  assert.ok(!/bytea|file_path|storage_path|content/i.test(table),
    'the table records that an export happened, not what was in it');
});
