// Guards on the PowerShell scripts in Supabase/local/.
//
// There is no PowerShell in CI and no database to point one at, so these are
// source assertions like every other tooling guard here. What they protect is
// specific: five connection bugs that each cost a real session against the
// live project, and which used to live in one script's body where a second
// script would inevitably grow its own slightly-different copy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const COMMON = read('Supabase/local/_PsqlCommon.ps1');
const APPLY = read('Supabase/local/Apply-Migration.ps1');
const QUERY = read('Supabase/local/Invoke-Sql.ps1');

// Comments stripped, and load-bearing for the same reason it is in
// scan-log-export.test.mjs: Invoke-Sql.ps1 explains at length why it does NOT
// use `2>&1` and does NOT use `SET LOCAL`. Matching the raw file finds those
// explanations and reports the mistake as present. Block comments first, then
// to end of line — neither script puts a '#' inside a string literal, and
// test/psql-tooling.test.mjs would have to change if one ever did.
const code = (src) => src
  .replace(/<#[\s\S]*?#>/g, '')
  .split('\n')
  .map((line) => {
    const at = line.indexOf('#');
    return at === -1 ? line : line.slice(0, at);
  })
  .join('\n');

const QUERY_CODE = code(QUERY);

const CALLERS = [
  ['Apply-Migration.ps1', APPLY],
  ['Invoke-Sql.ps1', QUERY],
];

// ---- one copy of the guards, not two ----

test('both scripts dot-source the shared connection module', () => {
  for (const [name, src] of CALLERS) {
    assert.ok(/\.\s*\(Join-Path \$PSScriptRoot '_PsqlCommon\.ps1'\)/.test(src),
      `${name} must dot-source _PsqlCommon.ps1 rather than carry its own copy`);
  }
});

// The failure this prevents is not a crash. It is one script being fixed and
// the other keeping the old behaviour, which is exactly how the '@' in the
// password trap would come back for whoever uses the other entry point.
test('neither caller redefines a shared function', () => {
  for (const fn of ['Find-Psql', 'Test-HostReachable', 'Resolve-PsqlTarget', 'Set-PsqlEncoding']) {
    assert.ok(new RegExp(`function ${fn}`).test(COMMON), `${fn} must be defined in _PsqlCommon.ps1`);
    for (const [name, src] of CALLERS) {
      assert.ok(!new RegExp(`function ${fn}`).test(src),
        `${name} defines its own ${fn} — that is the drift this module exists to stop`);
    }
  }
});

// Each of these was written after a specific failure against the live
// project. Dropping one looks harmless in a diff and is not.
test('the shared module keeps all five connection guards', () => {
  assert.ok(/ProgramFiles\\PostgreSQL/.test(COMMON),
    '1: psql is installed but not on PATH on this machine');
  assert.ok(/PGPASSWORD.*empty, so psql would prompt and hang/s.test(COMMON),
    '2: an empty PowerShell variable connects to localhost in silence');
  assert.ok(/Matches\(\$ConnectionString, '@'\)\)\.Count -gt 1/.test(COMMON),
    "3: a password containing '@' is read as part of the hostname");
  assert.ok(/Resolve-DnsName \$HostName -Type AAAA/.test(COMMON),
    '4: db.<ref>.supabase.co is IPv6-only and fails like a typo');
  assert.ok(/PGCLIENTENCODING = 'UTF8'/.test(COMMON),
    '5: a multi-byte character in a comment aborts the transaction');
});

// Nothing is interpolated into a connection URL on the PG* path, which is the
// whole reason that path is preferred for a password with punctuation in it.
test('the PG* path passes no connection argument at all', () => {
  const block = COMMON.slice(COMMON.indexOf('function Resolve-PsqlTarget'));
  assert.ok(/Args\s*=\s*@\(\)/.test(block),
    'an empty argument array is what makes libpq read PGHOST/PGPASSWORD itself');
});

// A password fragment printed to a terminal ends up in whatever the operator
// pastes for help, which is how one got exposed on 2026-11-04.
test('no script prints a password or a whole connection string', () => {
  for (const [name, src] of [['_PsqlCommon.ps1', COMMON], ...CALLERS]) {
    for (const line of src.split('\n')) {
      if (!/^\s*Write-(Host|Warning|Output)/.test(line)) continue;
      assert.ok(!/\$env:PGPASSWORD|\$ConnectionString/.test(line),
        `${name} echoes a secret: ${line.trim().slice(0, 70)}`);
    }
  }
});

// ---- Invoke-Sql.ps1: a verification tool pointed at production ----

test('queries are read-only unless -Write is passed', () => {
  assert.ok(/\$readOnly = if \(\$Write\) \{ 'off' \} else \{ 'on' \}/.test(QUERY),
    'the default must be read-only, so an UPDATE with a mistyped WHERE fails '
    + 'rather than runs');
  assert.ok(/set default_transaction_read_only = \$readOnly/.test(QUERY),
    'the setting has to reach the session, not just the variable');
  assert.ok(/\[switch\] \$Write/.test(QUERY), '-Write must be a switch, defaulting off');
});

test('every session gets a statement timeout', () => {
  assert.ok(/set statement_timeout = \$TimeoutMs/.test(QUERY));
  const dflt = Number((QUERY.match(/\[int\] \$TimeoutMs = (\d+)/) || [])[1]);
  assert.ok(Number.isFinite(dflt) && dflt > 0 && dflt <= 60000,
    `a verification query should not be allowed to run for minutes; got ${dflt}`);
});

// A plain SET (not SET LOCAL) persists for the session, which is what makes
// the read-only guard apply to the statement that follows it. Separate -c
// options run in order in ONE session; separate psql invocations would not.
test('the guards and the query run in the same session', () => {
  const setup = QUERY_CODE.indexOf("'-c', $setup");
  const sql = QUERY_CODE.indexOf("'-c', $Sql");
  assert.ok(setup !== -1 && sql !== -1, 'expected both to be -c arguments');
  assert.ok(setup < sql, 'the read-only and timeout SETs must precede the query');
  assert.ok(!/SET LOCAL/i.test(QUERY_CODE),
    'SET LOCAL would expire with the setup statement and leave the query unguarded');
});

// In Windows PowerShell 5.1, redirecting a native command's stderr wraps each
// line in an ErrorRecord and sets $? to false even on exit code 0 — every
// successful query would look like a failure.
test('psql output is captured without 2>&1', () => {
  assert.ok(/\$raw = & \$psql @psqlArgs/.test(QUERY_CODE));
  assert.ok(!/2>&1/.test(QUERY_CODE),
    'NativeCommandError: 2>&1 on a native command makes exit code 0 read as failure');
});

// The point of the footer is that a careless `select * from scan_events` is
// obvious immediately rather than at the end of the month.
test('the cost of a query is reported, not assumed', () => {
  assert.ok(/GetByteCount/.test(QUERY), 'output size must be measured');
  assert.ok(/log ingestion: 0 events/.test(QUERY),
    'the one number this cannot move should say so explicitly');
  assert.ok(/Write-Warning[^\n]*egress/i.test(QUERY),
    'a large result set must warn, since that is the only way this costs money');
});

// THE BUG THIS PINS, found 2026-11-12. Past one second psql appends a
// human-readable form to its timing line:
//
//   Time: 12.345 ms
//   Time: 1392.202 ms (00:01.392)
//
// The original pattern ended in `ms\s*$`, so it matched the first and not
// the second — the only timings it ever captured were the FAST ones. A
// query that ran 1,392 ms had its timing stripped from the body, dropped
// from the footer as "n/a", and never compared against the 200 ms
// threshold. The one case the warning exists for was the one it could not
// see.
//
// The pattern is lifted out of the script and run here, so this exercises
// the real thing rather than asserting on its source. .NET and JS agree on
// every construct in it.
test('a timing over one second is still captured', () => {
  const pattern = (QUERY.match(/\$line -match '([^']+)'\) \{ \$timings/) || [])[1];
  assert.ok(pattern, 'could not find the timing pattern in Invoke-Sql.ps1');
  const re = new RegExp(pattern);

  assert.equal('Time: 12.345 ms'.match(re)?.[1], '12.345', 'the sub-second form');
  assert.equal('Time: 1392.202 ms (00:01.392)'.match(re)?.[1], '1392.202',
    'the form psql uses past one second — this is the one that regressed');
  assert.equal('Time: 60000.000 ms (01:00.000)'.match(re)?.[1], '60000.000');

  // Still a timing line and nothing else: a result row that happens to
  // mention a duration must stay in the body.
  assert.equal(re.test(' some_column | Time to live'), false);
});

// A captured timing is only useful if it reaches the threshold check.
test('the slowest timing is what gets compared against 200 ms', () => {
  assert.match(QUERY, /Measure-Object -Maximum/);
  assert.match(QUERY, /\$slowest -gt 200/);
});

// THE CROSS-FILE GUARD. 20261017090000 raised log_min_duration_statement to
// 1000 ms on anon, authenticated and service_role — the roles live traffic
// runs as. It deliberately did NOT touch postgres, which is the role psql
// connects as, and which an earlier session had set to 200. So 200 is the
// right threshold for this script, and it is only right for as long as that
// stays true.
test('the Postgres-log threshold matches the role psql actually connects as', () => {
  const mig = read('Supabase/migrations/20261017090000_raise_log_min_duration_statement.sql');
  const raised = [...mig.matchAll(/ALTER ROLE (\w+)\s+SET log_min_duration_statement = (\d+)/gi)]
    .map(([, role, ms]) => [role, Number(ms)]);
  assert.ok(raised.length >= 3, 'expected the three impersonated roles');
  for (const [role, ms] of raised) {
    assert.notEqual(role, 'postgres',
      'postgres was raised too — Invoke-Sql.ps1 still warns at 200 ms and would '
      + `now be wrong (it is ${ms} there)`);
  }
  assert.ok(/-gt 200\)/.test(QUERY) && /200 ms log_min_duration_statement/.test(QUERY),
    'the warning threshold must be the 200 ms still set on the postgres role');
});
