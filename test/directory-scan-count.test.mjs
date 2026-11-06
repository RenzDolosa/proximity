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
test('total_scans reads the counter column, never the array', () => {
  const { body } = latestView();
  const line = body.split('\n').find((l) => /AS total_scans/i.test(l));
  assert.ok(line, 'total_scans must still exist — the client selects it');
  assert.ok(/scan_parity_count/.test(line),
    'total_scans must come from the maintained counter');
  assert.ok(!/jsonb_array_length/.test(line),
    'reading the array length is the 1.9-second query this migration removes');
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
