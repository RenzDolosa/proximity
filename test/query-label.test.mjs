// describeQuery() — the Settings "Query performance" column that used to show
// nine identical rows.
//
// The panel renders into innerHTML, so roughly half of these are about what
// must NOT be classified rather than what must.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeQuery } from '../JS/Utils/queryLabel.js';
import { esc } from '../JS/Utils/format.js';

// Verbatim wrapper shapes PostgREST emits. The first is the one that appeared
// nine times in the 2026-11-07 screenshot.
const GET_RPC = 'WITH pgrst_source AS (SELECT pgrst_call.pgrst_scalar FROM '
  + '(SELECT "public"."get_scan_logs_trim_status"() pgrst_scalar) pgrst_call) '
  + "SELECT null::bigint AS total_result_set, 1 AS page_total, coalesce(json_agg(_postgrest_t), '[]') AS body";

const POST_RPC = 'WITH pgrst_payload AS (SELECT $1::json AS json_data), '
  + 'pgrst_body AS (SELECT json_data FROM pgrst_payload), '
  + 'pgrst_source AS (SELECT "public"."scan_proximity_code_compact"('
  + '"p_proximity_code" => $2, "p_scanner_id" => $3) pgrst_scalar FROM pgrst_body) '
  + 'SELECT null::bigint AS total_result_set';

const TABLE_READ = 'WITH pgrst_source AS (SELECT "public"."employee_directory".* '
  + 'FROM "public"."employee_directory" ORDER BY "full_name" ASC LIMIT $1) '
  + 'SELECT null::bigint AS total_result_set';

const TABLE_INSERT = 'WITH pgrst_payload AS (SELECT $1::json AS json_data), '
  + 'pgrst_source AS (INSERT INTO "public"."employees"("full_name", "email") '
  + 'SELECT "full_name", "email" FROM json_populate_recordset(null::"public"."employees", $2) '
  + 'RETURNING "public"."employees".*) SELECT null::bigint AS total_result_set';

test('the wrapper no longer swallows the RPC name', () => {
  const q = describeQuery(GET_RPC);
  assert.equal(q.kind, 'rpc');
  assert.equal(q.label, 'get_scan_logs_trim_status()');
});

// A POST'd RPC puts payload CTEs AHEAD of the call, so first-match would have
// picked up json_populate_recordset or a cast instead of the function.
test('an RPC with arguments resolves to the function, not the payload', () => {
  const q = describeQuery(POST_RPC);
  assert.equal(q.kind, 'rpc');
  assert.equal(q.label, 'scan_proximity_code_compact()');
});

test('a direct table read names the relation and the verb', () => {
  const q = describeQuery(TABLE_READ);
  assert.equal(q.kind, 'select');
  assert.equal(q.label, 'select employee_directory');
});

// RELATION is ordered, and the INSERT wrapper also contains `FROM
// json_populate_recordset(null::"public"."employees", …)`. Matching FROM
// first would label a write as a read.
test('a write is not reported as a read', () => {
  const q = describeQuery(TABLE_INSERT);
  assert.equal(q.kind, 'insert');
  assert.equal(q.label, 'insert employees');
});

test('the rows that looked identical now look different', () => {
  const labels = [GET_RPC, POST_RPC, TABLE_READ, TABLE_INSERT]
    .map((s) => describeQuery(s).label);
  assert.equal(new Set(labels).size, 4, 'the whole point was telling them apart');
  for (const l of labels) {
    assert.ok(!l.includes('pgrst_source'), `"${l}" still carries the wrapper`);
  }
});

// ---- what must not be classified ----
//
// A quoted Postgres identifier may legally contain '<', a quote or a newline,
// and pg_stat_statements records the text of FAILED statements too — so "it
// came from the database" is not a reason to trust it.

test('an identifier that is not identifier-shaped is never treated as a name', () => {
  const hostile = [
    'SELECT "public"."<script>alert(1)</script>"() FROM x',
    'SELECT "public"."a\\"onmouseover=\\"alert(1)"() FROM x',
    'SELECT "public"."drop\ntable"() FROM x',
    'SELECT "public"."employees<img src=x onerror=alert(1)>"() FROM x',
  ];
  for (const sql of hostile) {
    const q = describeQuery(sql);
    assert.equal(q.kind, 'raw', `classified a hostile identifier: ${sql}`);
    assert.equal(q.label, sql, 'the fallback must be the unmodified text, for esc() to handle');
  }
});

// The real guarantee. describeQuery escapes nothing by design; this asserts
// the caller's esc() neutralises every path, classified or not.
test('nothing describeQuery returns can open a tag or close an attribute', () => {
  const sql = 'SELECT "public"."<img onerror=x>"(\'</td><script>alert(1)</script>\') FROM "public"."a"';
  const q = describeQuery(sql);
  for (const part of [esc(q.label), esc(q.title)]) {
    assert.ok(!/[<>]/.test(part), 'an angle bracket survived escaping');
    assert.ok(!part.includes('"'), 'a bare quote would break out of title="…"');
  }
});

test('other schemas are left unrecognised', () => {
  for (const schema of ['auth', 'storage', 'cron', 'extensions', 'pg_catalog']) {
    const q = describeQuery(`SELECT "${schema}"."uid"() FROM x`);
    assert.equal(q.kind, 'raw', `${schema} should not be labelled as app code`);
  }
});

test("PostgREST's own scaffolding is not mistaken for a relation", () => {
  const q = describeQuery('WITH pgrst_source AS (SELECT 1) SELECT * FROM "public"."pgrst_source"');
  assert.equal(q.kind, 'raw');
});

// get_slow_query_stats() returns left(query, 500). PostgREST enumerates every
// selected column fully qualified, and employee_directory names fifteen of
// them — so the FROM clause falls past 500 characters and the one query most
// worth identifying was the only one still printing raw SQL in the panel.
test('a statement truncated before its FROM is still identified', () => {
  const cols = ['id', 'employee_code', 'full_name', 'department', 'position', 'email',
    'phone', 'photo_url', 'photo_file_id', 'status', 'active_proximity_code',
    'proximity_card_active', 'proximity_card_id', 'total_scans', 'open_remarks'];
  const full = 'WITH pgrst_source AS ( SELECT '
    + cols.map((c) => `"public"."employee_directory"."${c}"`).join(', ')
    + ' FROM "public"."employee_directory" ORDER BY "full_name" ASC )';
  assert.ok(full.indexOf('FROM "public"') > 500,
    'fixture must actually reproduce the truncation, or this proves nothing');

  const truncated = full.slice(0, 500);
  const q = describeQuery(truncated);
  assert.equal(q.kind, 'select');
  assert.equal(q.label, 'select employee_directory');
  assert.ok(!q.label.includes('pgrst_source'));
  // And the untruncated form must still resolve the same way.
  assert.equal(describeQuery(full).label, 'select employee_directory');
});

test('a qualified column reference does not override an explicit write verb', () => {
  const sql = 'WITH pgrst_source AS (INSERT INTO "public"."employees"("full_name") '
    + 'SELECT "public"."employees"."full_name" FROM x RETURNING "public"."employees".*)';
  assert.equal(describeQuery(sql).label, 'insert employees');
});

test('the truncation fallback still refuses junk identifiers and other schemas', () => {
  assert.equal(describeQuery('SELECT "auth"."users"."id" FROM').kind, 'raw');
  assert.equal(describeQuery('SELECT "public"."<img src=x>"."id" FROM').kind, 'raw');
});

test('empty and non-string input do not throw', () => {
  for (const v of [undefined, null, '', 0, {}, []]) {
    const q = describeQuery(v);
    assert.equal(q.kind, 'raw');
    assert.equal(typeof q.label, 'string');
    assert.equal(typeof q.title, 'string');
  }
});

// ---- exposure ----
//
// The panel is admin-only twice over (is_admin() inside get_slow_query_stats,
// and the panel is not rendered for non-admins), so this is about reducing
// what reaches the DOM rather than closing a hole.

test('a recognised row puts no SQL on the page at all', () => {
  for (const sql of [GET_RPC, POST_RPC, TABLE_READ, TABLE_INSERT]) {
    const q = describeQuery(sql);
    for (const part of [q.label, q.title]) {
      for (const leak of ['SELECT', 'WITH', '$1', 'json_agg', 'ORDER BY']) {
        assert.ok(!part.includes(leak),
          `"${part}" leaks ${leak}; a recognised row should carry a name and nothing else`);
      }
    }
    assert.ok(q.label.length < 80, 'a label should be readable at a glance');
  }
});

// Switching to names must not quietly become a way to show MORE. Every
// classified path has to be shorter than what the panel printed before.
test('classifying never increases what is rendered', () => {
  for (const sql of [GET_RPC, POST_RPC, TABLE_READ, TABLE_INSERT]) {
    const q = describeQuery(sql);
    assert.ok(q.label.length < sql.length && q.title.length < sql.length,
      'a label must be strictly smaller than the SQL it replaces');
  }
});

// ---- the module stays pure ----

test('queryLabel.js reaches for nothing outside itself', () => {
  // Comments stripped, or the security note at the top — which explains why
  // this feeds innerHTML — would fail the DOM check by talking about it.
  const src = readFileSync(fileURLToPath(new URL('../JS/Utils/queryLabel.js', import.meta.url)), 'utf8')
    .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); }).join('\n');
  assert.ok(!/\bimport\b/.test(src), 'a formatter with no imports is a formatter that can be trusted alone');
  assert.ok(!/innerHTML|document\.|window\./.test(src), 'this module must not touch the DOM');
});

// If the caller ever drops esc() around either half, the whitelist is the
// only thing left. Assert the call site still has it.
test('the Settings panel still escapes both halves', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../JS/Features/Settings/SettingsPage.js', import.meta.url)), 'utf8');
  assert.match(src, /title="\$\{esc\(q\.title\)\}">\$\{esc\(q\.label\)\}/,
    'describeQuery output must stay inside esc() on both the cell and the tooltip');
});
