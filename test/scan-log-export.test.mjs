// Guards on get_all_scan_events(), the "Export all scan logs" RPC.
//
// It timed out in production with `canceling statement due to statement
// timeout` because the direction lookup was a correlated subquery that
// re-expanded an employee's whole scan_logs array once per exported row —
// quadratic in how much each person scans. 20261106140000 rewrote it.
//
// These are source assertions, like the rest of this project's migration
// tests: there is no local Postgres in CI, so what can be checked is that the
// shape which caused the timeout has not come back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = new URL('../Supabase/migrations/', import.meta.url);
const read = (name) => readFileSync(fileURLToPath(new URL(name, DIR)), 'utf8');

// Same comment stripper as migration-conventions.test.mjs, and load-bearing
// here for a specific reason: 20261106140000's header comment QUOTES the old
// correlated subquery verbatim, to explain what was wrong with it. Matching
// against the raw file would find that quotation and report the bug as still
// present. The exact false positive that bit the comment-stripping checks on
// 2026-11-06.
const code = (src) => src.split('\n').map((line) => {
  const at = line.indexOf('--');
  return at === -1 ? line : line.slice(0, at);
}).join('\n');

const FIX = '20261106140000_scan_log_export_performance.sql';
const PREVIOUS = '20260930000000_scan_events_archival.sql';

// The function as the newest migration defining it leaves it. Taking the LAST
// definition rather than assuming the fix is last means this test keeps
// working when a later migration touches the function again — and fails
// honestly if that later one reintroduces the old shape.
function latestDefinition(name = 'get_all_scan_events') {
  const files = readdirSync(fileURLToPath(DIR)).filter((f) => f.endsWith('.sql')).sort();
  let found = null;
  for (const f of files) {
    const sql = code(read(f));
    const at = sql.search(new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i'));
    if (at === -1) continue;
    const body = sql.slice(at);
    const end = body.indexOf('$function$;');
    found = { file: f, body: end === -1 ? body : body.slice(0, end) };
  }
  return found;
}

test('the export RPC is still defined, and by the migration that fixed it', () => {
  const def = latestDefinition();
  assert.ok(def, 'get_all_scan_events has no definition at all');
  assert.equal(def.file, FIX, 'a later migration redefined it — re-read these guards against that one');
});

// THE BUG. One correlated expansion of scan_logs per exported row is what
// made the work grow with the square of how much each employee scans.
test('direction is not resolved by a per-row scan_logs expansion', () => {
  const { body } = latestDefinition();
  assert.ok(!/elem\s*->>\s*'scan_id'\s*=\s*\w+\.id::text/i.test(body),
    'the correlated scan_id lookup is back: that is the quadratic shape that '
    + 'produced `canceling statement due to statement timeout`');
  assert.ok(/left join\s+directions/i.test(body),
    'directions must be a set joined once, not a subquery evaluated per row');
});

// The old subquery read `e.scan_logs` — that row's OWN employee's array.
// Keying the replacement on scan_id alone would let another employee's entry
// win and flip an IN to an OUT. Vanishingly unlikely, since a scan_id is a
// scan_events primary key logged against exactly one employee, but this
// rewrite claims IDENTICAL results and "unlikely" is not identical.
test('direction is still resolved from the scanning employee, not globally', () => {
  const { body } = latestDefinition();
  assert.ok(/d\.employee_id\s*=\s*c\.employee_id/i.test(body),
    'the directions join must be keyed on employee as well as scan_id');
  assert.ok(/distinct on \(e\.id,/i.test(body),
    'and deduplicated per employee, matching the old subquery per-row limit 1');
});

// Order matters more than presence here. Applying the cap AFTER the direction
// lookup — which is what the old version did — means the expensive part still
// runs over all of history and only the output is trimmed.
test('the row cap is applied before directions are looked up', () => {
  const { body } = latestDefinition();
  const limit = body.search(/limit\s+100000/i);
  const join = body.search(/left join\s+directions/i);
  assert.ok(limit !== -1 && join !== -1, 'expected both a cap and a directions join');
  assert.ok(limit < join,
    'the 100,000 cap must come first, or the direction lookup still runs '
    + 'across every row in all of history');
});

// Without MATERIALIZED, a CTE referenced twice may be inlined into both
// references, so the top-N over the union runs again to feed the direction
// lookup — quietly restoring most of the cost.
test('the capped set is computed once, not inlined into both references', () => {
  const { body } = latestDefinition();
  assert.ok(/with\s+capped\s+as\s+materialized/i.test(body),
    'capped must be MATERIALIZED: it is referenced twice and must not be recomputed');
});

// Filtering after the append cannot use either table's scanned_at index.
test('the date range filters inside each union branch, not after it', () => {
  const { body } = latestDefinition();
  const branches = body.split(/union all/i);
  assert.equal(branches.length, 2, 'expected exactly the live table and the archive');
  for (const [i, branch] of branches.entries()) {
    assert.ok(/p_from is null or .*scanned_at >= p_from/is.test(branch),
      `branch ${i + 1} does not filter on p_from, so its scanned_at index cannot be used`);
    assert.ok(/p_to is null or .*scanned_at <= p_to/is.test(branch),
      `branch ${i + 1} does not filter on p_to`);
  }
});

// The archive is the whole reason "All dates" was the slowest possible input:
// its rows outlive the scan_logs entries they point at.
test('the archive is still read, so old exports do not silently lose rows', () => {
  const { body } = latestDefinition();
  assert.ok(/public\.scan_events_archive/.test(body),
    'dropping the archive would make an all-dates export fast by returning less');
});

test('the admin gate survived the rewrite', () => {
  const { body } = latestDefinition();
  assert.ok(/is_admin_or_manager\(\)/.test(body),
    'a full-org export of personal scan history must stay gated');
});

// A changed signature would need DROP then CREATE, and would leave the old
// overload behind for anything still calling it. Unchanged means the client
// needs no change at all — which is the claim the migration header makes.
test('the signature is byte-identical to the version being replaced', () => {
  const signature = (src) => {
    const sql = code(src);
    const at = sql.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_all_scan_events/i);
    const head = sql.slice(at, sql.indexOf('LANGUAGE plpgsql', at));
    return head.replace(/\s+/g, ' ').trim();
  };
  assert.equal(signature(read(FIX)), signature(read(PREVIOUS)),
    'arguments or RETURNS TABLE changed — this can no longer be a CREATE OR '
    + 'REPLACE, and the client contract moved with it');
  assert.ok(!/DROP\s+FUNCTION[^;]*get_all_scan_events/i.test(code(read(FIX))),
    'no DROP should be needed when the signature is unchanged');
});

// ---- the paged replacement (20261106150000) ----
//
// Fixing the quadratic lookup made the single statement finish. It did not
// remove the other failure mode: one statement whose duration grows with the
// data will reach the statement timeout again eventually. Pages do.

test('the client exports in pages, not one statement', () => {
  const model = readFileSync(
    fileURLToPath(new URL('../JS/Models/ScanEventsModel.js', import.meta.url)), 'utf8',
  );
  assert.ok(/rpc\('get_scan_events_page'/.test(model),
    'the export must go through the paged RPC');
  assert.ok(!/rpc\('get_all_scan_events'/.test(model),
    'the single-shot RPC capped at 100,000 rows WITHOUT saying so, which is '
    + 'worse than timing out because it looks like success');
  assert.ok(/p_from:.*p_to:/s.test(model),
    'the date range stays server-side — a client-side filter would ship rows '
    + 'only to discard them');
});

// OFFSET re-walks and discards every row before the page, so page 500 costs
// 500 times page 1 and the end of a large export reaches the same timeout
// from the other direction.
test('paging is keyset, never offset', () => {
  const { body } = latestDefinition('get_scan_events_page');
  assert.ok(/p_after_scanned_at/.test(body) && /p_after_id/.test(body),
    'the cursor needs both halves of (scanned_at, id)');
  assert.ok(/\(\s*\w+\.scanned_at,\s*\w+\.id\s*\)\s*<\s*\(\s*p_after_scanned_at,\s*p_after_id\s*\)/i.test(body),
    'the row-wise tuple comparison is what lets the planner use the '
    + 'scanned_at index as a starting position');
  assert.ok(!/\boffset\b/i.test(body), 'no OFFSET anywhere in the paged path');
});

// Two scans sharing a timestamp could straddle a page boundary in an unstable
// order and be silently dropped or duplicated between pages.
test('the page order breaks ties on id', () => {
  const { body } = latestDefinition('get_scan_events_page');
  // Line-scoped. A `[^;]*` tail runs straight past the first clause into the
  // second — the CTEs between them contain no semicolon — and reports one
  // giant match where there are two.
  const orders = body.match(/order by\s+\w+\.scanned_at\s+desc[^\r\n]*/gi) || [];
  assert.ok(orders.length >= 2, 'both the capped set and the final select must order');
  for (const clause of orders) {
    assert.ok(/id desc/i.test(clause),
      `ordering by scanned_at alone is not a total order: ${clause.trim().slice(0, 60)}`);
  }
});

test('a client cannot ask for a page big enough to time out', () => {
  const { body } = latestDefinition('get_scan_events_page');
  assert.ok(/least\(coalesce\(p_limit[^)]*\),\s*\d+\)/i.test(body),
    'p_limit must be clamped server-side, or the cap is advisory');
});

test('the paged function returns the id its own cursor needs', () => {
  const { body } = latestDefinition('get_scan_events_page');
  assert.ok(/select\s+c\.id,/i.test(body),
    'without id in the output the client cannot build the next cursor — which '
    + 'is why this is a new function rather than a changed one');
});

// ---- the 1,000-row cap (20261111120000) ----
//
// THE BUG. PostgREST enforces db-max-rows (1000 here, set deliberately) on
// every response, after the function's own LIMIT and without supabase-js
// surfacing anything. A set-returning RPC asked for 10,000 therefore handed
// back 1,000, the client read `1000 < 10000` as "short page = end of data",
// and five consecutive exports finished after one page. Returning a single
// jsonb value is what puts the page size back under this function's control:
// db-max-rows counts ROWS, and one jsonb value is one row.

test('the paged export returns one jsonb value, not a set', () => {
  const { body } = latestDefinition('get_scan_events_page');
  const head = body.slice(0, body.indexOf('LANGUAGE plpgsql'));
  assert.ok(/RETURNS\s+jsonb/i.test(head),
    'RETURNS TABLE / SETOF puts this back under PostgREST db-max-rows, which '
    + 'silently truncates every page to 1,000 rows');
  assert.ok(!/RETURNS\s+TABLE/i.test(head), 'the set-returning shape is the capped one');
});

// The client must compare a page's length against the size the SERVER used.
// Comparing against the size it asked for is the exact assumption db-max-rows
// invalidated.
test('the page reports the limit it actually applied', () => {
  const { body } = latestDefinition('get_scan_events_page');
  assert.ok(/jsonb_build_object\(\s*'limit',\s*v_limit/i.test(body),
    "the response must carry the server's own page size, not just the rows");
  assert.ok(/'rows',\s*coalesce\(/i.test(body),
    'jsonb_agg over zero rows is NULL, not [] — an uncoalesced last page '
    + 'reaches the client as a malformed response rather than an empty one');
});

// The cursor is built from the LAST element of the array. An ORDER BY on the
// outer select orders the single aggregated row, which is a no-op, so the
// array would come back in join order and the next page would start from an
// arbitrary row — skipping everything in between, silently.
test('the aggregate orders inside itself, so the cursor means something', () => {
  const { body } = latestDefinition('get_scan_events_page');
  // `[^)]*` is not enough: the aggregate's own argument is `to_jsonb(p)`, so
  // a negated-paren class stops at the inner close and never reaches the
  // ORDER BY. The inner call is matched explicitly instead.
  assert.ok(
    /jsonb_agg\(\s*to_jsonb\([^)]*\)\s*order by\s*\w+\.scanned_at\s+desc\s*,\s*\w+\.id\s+desc\s*\)/i
      .test(body),
    'the ORDER BY must be inside jsonb_agg, not on the select that wraps it');
});

// A return type cannot change under CREATE OR REPLACE ("cannot change return
// type of existing function"). Without the DROP the migration fails outright;
// with a DROP but a changed argument list it would leave a stale overload.
test('the row-cap migration drops the set-returning version first', () => {
  const sql = code(read('20261111120000_scan_log_export_row_cap.sql'));
  const drop = sql.search(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.get_scan_events_page/i);
  const create = sql.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_scan_events_page/i);
  assert.ok(drop !== -1, 'a return type change needs an explicit DROP');
  assert.ok(create > drop, 'the DROP must come first');
  // Same five arguments, so nothing that resolved to the old function becomes
  // ambiguous against a leftover overload.
  const args = (src) => (src.match(/get_scan_events_page\(([^)]*)\)/) || [])[1]
    ?.replace(/\s+/g, ' ').trim();
  assert.equal(args(sql), 'timestamptz, timestamptz, timestamptz, uuid, integer');
});

// The DROP takes the ACL with it, so the grants are not optional boilerplate
// here the way they are after a true CREATE OR REPLACE.
test('the grants are restated after the drop', () => {
  const sql = code(read('20261111120000_scan_log_export_row_cap.sql'));
  assert.ok(/REVOKE ALL ON FUNCTION public\.get_scan_events_page[^;]*FROM PUBLIC/i.test(sql),
    'a dropped function loses its ACL and falls back to EXECUTE for PUBLIC');
  assert.ok(/REVOKE ALL ON FUNCTION public\.get_scan_events_page[^;]*FROM anon/i.test(sql));
  assert.ok(/GRANT EXECUTE ON FUNCTION public\.get_scan_events_page[^;]*TO authenticated/i.test(sql));
});

// The two export functions resolve direction the same way, and must not
// drift. This is the test that stops a future edit from "fixing" one and
// leaving the other quadratic.
test('neither export function resolves direction per row', () => {
  for (const name of ['get_all_scan_events', 'get_scan_events_page']) {
    const { body } = latestDefinition(name);
    assert.ok(!/elem\s*->>\s*'scan_id'\s*=\s*\w+\.id::text/i.test(body),
      `${name} has the correlated lookup back`);
    assert.ok(/left join\s+directions/i.test(body), `${name} must join a directions set`);
    assert.ok(/with\s+capped\s+as\s+materialized/i.test(body),
      `${name} must materialise its capped set`);
  }
});

// get_scan_feed() still uses the correlated subquery and that is FINE: it is
// hard-capped at a handful of rows, so the array is walked a bounded number
// of times. Listed explicitly so the next reader knows it was considered
// rather than missed — and so this test fails if that cap ever grows.
test('the one remaining correlated direction lookup is a bounded one', () => {
  const baseline = code(read('20260922072224_production_schema_baseline.sql'));
  const at = baseline.search(/FUNCTION public\.get_scan_feed\(/i);
  const head = baseline.slice(at, at + 200);
  const defaultLimit = Number((head.match(/p_limit integer DEFAULT (\d+)/i) || [])[1]);
  assert.ok(Number.isFinite(defaultLimit) && defaultLimit <= 100,
    'get_scan_feed keeps the per-row scan_logs expansion, which is only safe '
    + `because it returns a handful of rows; its default limit is now ${defaultLimit}`);
});
