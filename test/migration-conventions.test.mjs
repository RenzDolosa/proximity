import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// A migration that adds or changes a function has to tell PostgREST to reload
// its schema cache. PostgREST answers an unknown function from that in-memory
// cache WITHOUT touching the database — that is the same mechanism this
// project relies on elsewhere to make a dropped RPC cost nothing (see
// Supabase/README.md on PGRST202). The consequence is that a newly created RPC
// stays invisible, returning PGRST202, until the cache happens to refresh.
//
// This guard exists because 20261104090000 and 20261104093000 were both
// written without it, adding eight RPCs that would have 404'd after a
// successful apply — the kind of failure that looks like a broken migration
// rather than a missing one-line NOTIFY.

const DIR = fileURLToPath(new URL('../Supabase/migrations/', import.meta.url));

// When the convention started. Everything before this predates it, and those
// migrations are long applied — adding NOTIFY to them retroactively would be
// churn with no effect, since the cache they needed to reload reloaded years
// of requests ago.
const CONVENTION_FROM = '20261015120000';

// Migrations at or after CONVENTION_FROM that create functions and still have
// no NOTIFY. Both are already applied, so the missing reload is moot for them
// now; they are listed rather than fixed so this test can be strict about new
// ones. Delete an entry only if its migration gains a NOTIFY.
const KNOWN_MISSING_NOTIFY = new Set([
  '20261023070023', // idempotent scanner retries
  '20261024090000', // IN/OUT ordering by scanned_at
]);

const migrations = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => ({
    name,
    version: name.slice(0, 14),
    sql: readFileSync(new URL(name, new URL('../Supabase/migrations/', import.meta.url)), 'utf8'),
  }));

// Strips `--` line comments, so a migration that merely DISCUSSES NOTIFY in a
// header comment cannot satisfy the check. (The two migrations this guard was
// written for now both explain the rule in a comment immediately above the
// real statement, which would otherwise make the comment alone pass.)
const code = (src) => src.split('\n').map((line) => {
  const at = line.indexOf('--');
  return at === -1 ? line : line.slice(0, at);
}).join('\n');

const createsFunction = (sql) => /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql);
const notifiesPostgrest = (sql) => /NOTIFY\s+pgrst\s*,\s*'reload (schema|config)'/i.test(sql);

test('the migrations directory is actually being read', () => {
  // Guards against a glob that matches nothing quietly "passing".
  assert.ok(migrations.length > 20, `expected many migrations, found ${migrations.length}`);
  assert.ok(migrations.some((m) => createsFunction(code(m.sql))), 'none of them create a function?');
});

test('a migration that changes a function reloads the PostgREST schema cache', () => {
  const offenders = migrations
    .filter((m) => m.version >= CONVENTION_FROM)
    .filter((m) => createsFunction(code(m.sql)))
    .filter((m) => !notifiesPostgrest(code(m.sql)))
    .map((m) => m.version)
    .filter((version) => !KNOWN_MISSING_NOTIFY.has(version));

  assert.deepEqual(offenders, [],
    'This migration creates a function but never tells PostgREST to reload. '
      + "Add `NOTIFY pgrst, 'reload schema';` at the end, or the new RPCs return "
      + 'PGRST202 until the cache refreshes on its own.');
});

// Without this, an allowlist entry outlives the fix and the next reader cannot
// tell real debt from historical noise. Same staleness rule as
// schema-drift.test.mjs's allowlists.
test('the notify allowlist contains no entries that have since been fixed', () => {
  const fixed = [...KNOWN_MISSING_NOTIFY].filter((version) => {
    const m = migrations.find((x) => x.version === version);
    return m && notifiesPostgrest(code(m.sql));
  });
  assert.deepEqual(fixed, [],
    'This migration now HAS a NOTIFY — remove it from KNOWN_MISSING_NOTIFY.');
});

test('every allowlisted version names a migration that exists', () => {
  const missing = [...KNOWN_MISSING_NOTIFY]
    .filter((version) => !migrations.some((m) => m.version === version));
  assert.deepEqual(missing, [], 'allowlist names a migration that is not in the directory');
});

// Proves the checker works independently of what the directory happens to
// contain today — a regex that matched nothing would otherwise "pass".
test('the notify check catches a migration that forgets it', () => {
  const forgets = `CREATE FUNCTION public.thing() RETURNS void LANGUAGE sql AS $function$ SELECT 1; $function$;`;
  assert.ok(createsFunction(forgets));
  assert.ok(!notifiesPostgrest(forgets));

  const remembers = `${forgets}\nNOTIFY pgrst, 'reload schema';`;
  assert.ok(notifiesPostgrest(remembers));

  // A comment mentioning the statement must not count as having it.
  const onlyTalksAboutIt = `${forgets}\n-- remember NOTIFY pgrst, 'reload schema' next time`;
  assert.ok(!notifiesPostgrest(code(onlyTalksAboutIt)));
});
