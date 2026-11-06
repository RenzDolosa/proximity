// Guards on employee_directory.total_scans (20261106180000).
//
// Opening Employee Manager de-TOASTed and JSON-parsed every employee's whole
// scan_logs array to produce one integer per row — measured at 1,859.992 ms
// in the Postgres log, in the same minute as a burst of scan timeouts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = new URL('../Supabase/migrations/', import.meta.url);
const migration = readFileSync(
  fileURLToPath(new URL('20261106180000_directory_scan_count_without_detoast.sql', DIR)), 'utf8',
);
const strip = (src) => src.split('\n').map((l) => {
  const at = l.indexOf('--');
  return at === -1 ? l : l.slice(0, at);
}).join('\n');

// The newest definition wins, so this keeps testing the live shape if a later
// migration touches the view — and fails honestly if that one regresses.
function latestView() {
  const files = readdirSync(fileURLToPath(DIR)).filter((f) => f.endsWith('.sql')).sort();
  let found = null;
  for (const f of files) {
    const sql = strip(readFileSync(fileURLToPath(new URL(f, DIR)), 'utf8'));
    const at = sql.search(/CREATE (OR REPLACE )?VIEW public\.employee_directory/i);
    if (at === -1) continue;
    const body = sql.slice(at);
    const end = body.indexOf(';');
    found = { file: f, body: end === -1 ? body : body.slice(0, end) };
  }
  return found;
}

test('the view is defined, by the migration that de-TOASTed it', () => {
  const v = latestView();
  assert.ok(v, 'employee_directory has no definition');
  assert.equal(v.file, '20261106180000_directory_scan_count_without_detoast.sql',
    'a later migration redefined the view — re-read these guards against it');
});

// THE FIX. Reading the LENGTH of a TOASTed jsonb array costs a full fetch,
// decompress and parse; scan_parity_count is a fixed-width integer in the
// heap tuple.
test('total_scans reads a stored count, never the array', () => {
  const { body } = latestView();
  const line = body.split('\n').find((l) => /AS total_scans/i.test(l));
  assert.ok(line, 'total_scans must still exist — the client selects it');
  assert.ok(/scan_logs_count/.test(line), 'total_scans must come from the stored count');
  assert.ok(!/jsonb_array_length/.test(line),
    'reading the array length is the 1.9-second query this migration removes');
});

// THE MEASUREMENT THAT KILLED THE FIRST DRAFT. scan_parity_count already
// existed and held the same number — except for one employee of 814, because
// it only ever increments: delete_employee_scan_log() does not decrement it,
// and trim_employee_scan_logs() leaves it alone since it carries IN/OUT
// parity. It means "scans ever recorded" where this column means "entries
// still in the log", and the view's number labels the button that OPENS that
// log. Once the data passes 180 days and trimming starts, they diverge for
// everyone, permanently.
test('the parity counter is not reused as a log length', () => {
  assert.ok(!/scan_parity_count/.test(latestView().body),
    'scan_parity_count counts scans ever, not entries retained — it would '
    + 'overstate the list the number labels');
});

// Three functions write scan_logs — trg_append_scan_log(),
// delete_employee_scan_log() and trim_employee_scan_logs() — and all three do
// it with a plain UPDATE, so one BEFORE trigger catches every writer,
// including any future one nobody has written yet.
test('the stored count is maintained by a trigger on the column itself', () => {
  assert.ok(/BEFORE INSERT OR UPDATE OF scan_logs ON public\.employees/i.test(migration),
    'must fire on any write to scan_logs, by any writer');
  assert.ok(!/BEFORE INSERT OR UPDATE ON public\.employees/i.test(migration),
    'a bare UPDATE trigger would re-read the array when a name or photo '
    + 'changes, to recompute a number that cannot have changed');
  assert.ok(/new\.scan_logs_count := coalesce\(jsonb_array_length\(new\.scan_logs\)/.test(migration),
    'BEFORE, so the value lands in the same tuple rather than a second write');
});

test('the column is backfilled, and only then made non-null', () => {
  const trigger = migration.indexOf('CREATE TRIGGER');
  // Line-ending agnostic: this file is checked out CRLF on Windows, and an
  // anchor written with \n silently returns -1 there.
  const backfill = migration.search(/UPDATE public\.employees\s+SET scan_logs_count/);
  const notNull = migration.indexOf('SET NOT NULL');
  assert.ok(trigger !== -1 && backfill !== -1 && notNull !== -1, 'all three steps must exist');
  assert.ok(trigger < backfill,
    'the trigger must exist first, or a scan landing mid-backfill is fixed and '
    + 'then re-broken');
  assert.ok(backfill < notNull, 'NOT NULL before the backfill fails on every existing row');
});

// ADD COLUMN with a default or a STORED generated expression rewrites the
// table under ACCESS EXCLUSIVE — every scan would block for the duration, on
// a table whose TOAST holds ~9 MB.
test('adding the column does not rewrite the table', () => {
  const add = migration.match(/ALTER TABLE public\.employees ADD COLUMN[^;]*/i)[0];
  assert.ok(/IF NOT EXISTS/i.test(add), 'must be re-runnable');
  assert.ok(!/DEFAULT|GENERATED/i.test(add),
    'a default or generated expression on ADD COLUMN takes ACCESS EXCLUSIVE '
    + 'and rewrites the table, blocking every scan');
});

// CREATE OR REPLACE VIEW requires identical column names, order and types.
// Anything else needs DROP, which would take the grants with it.
test('the column list is unchanged from the baseline view', () => {
  const baseline = strip(readFileSync(
    fileURLToPath(new URL('20260922072224_production_schema_baseline.sql', DIR)), 'utf8',
  ));
  const at = baseline.search(/CREATE VIEW public\.employee_directory/i);
  const old = baseline.slice(at, baseline.indexOf(';', at));
  const columns = (src) => (src.match(/AS [a-z_]+|e\.[a-z_"]+|pc\.[a-z_]+/gi) || [])
    .filter((c) => /^AS /i.test(c)).map((c) => c.slice(3).toLowerCase());
  assert.deepEqual(columns(latestView().body), columns(old),
    'aliased columns changed — CREATE OR REPLACE VIEW would reject this, and '
    + 'a DROP would take the view grants with it');
  assert.ok(!/DROP VIEW/i.test(latestView().body), 'no DROP should be needed');
});

// Losing security_invoker would silently turn this into a definer-rights view
// and hand restricted roles rows their RLS forbids. The README records this
// exact trap.
test('the view still runs under the invoker RLS', () => {
  assert.ok(/WITH \(security_invoker = true\)/i.test(latestView().body),
    'security_invoker must be restated, not assumed to survive');
});

// Not selected by the client, so an unselected view column costs nothing —
// but that is only true while the client stays explicit about its columns.
test('the client never asks for the columns that still read the arrays', () => {
  const model = readFileSync(
    fileURLToPath(new URL('../JS/Models/EmployeesModel.js', import.meta.url)), 'utf8',
  );
  const list = model.slice(model.indexOf('const DIRECTORY_COLUMNS'), model.indexOf(".join(',')"));
  assert.ok(/'total_scans'/.test(list), 'total_scans is rendered and must be selected');
  for (const expensive of ['last_scan', 'total_remarks']) {
    assert.ok(!new RegExp(`'${expensive}'`).test(list),
      `${expensive} reads a jsonb array per row and nothing renders it`);
  }
  assert.ok(!/select\('\*'\)|\.select\(\)/.test(model),
    "a bare select('*') on this view would pull last_scan and pay the cost the "
    + 'migration just removed');
});
