// Turns "the repo's migrations have drifted from the live database" from a
// paragraph in Supabase/README.md into something CI can actually hold.
//
// Why this matters more than it used to: every plan on the table — running
// PostgreSQL locally per site, integration-testing the RPCs, building a sync
// engine — starts with "build the schema from Supabase/migrations/". Today
// that doesn't produce a working database, and nothing in the pipeline says
// so. `.github/AI_REVIEW.md` only reviews what's in a PR diff, and explicitly
// notes that schema applied straight to the project via MCP bypasses it
// entirely; that's exactly how the objects below came to exist with no file.
//
// This is a ratchet, not a gate: the drift that exists today is listed
// explicitly in KNOWN_* below and tolerated, so `npm test` stays green while
// it's paid down. What it blocks is *new* drift — a new RPC called from the
// client, or a new migration depending on something no migration creates,
// fails here immediately. The allowlists are also checked for staleness, so
// reconciling an object forces its entry to be deleted rather than quietly
// rotting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'Supabase', 'migrations');

// Database objects the client calls that no migration in this repo creates.
// Every one of these is live on the Supabase project and documented in
// Supabase/README.md's change log as "backend shipped, no migration file" —
// see its 2026-09-28 entries. Delete an entry the moment its migration lands.
const KNOWN_MISSING_FUNCTIONS = new Set([
  'acknowledge_alert',
  'acknowledge_all_alerts',
  'get_alerts',
  'get_dashboard_stats',
  'get_onsite_roster',
  'get_scanner_performance_stats',
  'get_scanners',
  'get_unread_alert_count',
  'update_scanner',
]);

// Objects that *existing migrations themselves* depend on but no migration
// creates. These are the hard blocker: applying this repo's migrations in
// order to an empty PostgreSQL fails, it does not merely end up incomplete.
// 20261002000000_scanner_silence_alerts.sql calls raise_alert() and
// reads/writes both tables.
const KNOWN_MISSING_DEPENDENCIES = new Set([
  'alerts',
  'scanners',
  'raise_alert',
]);

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function readAll(files) {
  return files.map((f) => readFileSync(f, 'utf8')).join('\n');
}

const clientSource = readAll(walk(join(ROOT, 'JS')).filter((f) => f.endsWith('.js')));
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const migrationSource = readAll(migrationFiles.map((f) => join(MIGRATIONS_DIR, f)));

const matchAll = (source, re, group = 1) =>
  new Set([...source.matchAll(re)].map((m) => m[group].toLowerCase()));

const calledRpcs = matchAll(clientSource, /\.rpc\(\s*'([a-z0-9_]+)'/gi);
const usedRelations = matchAll(clientSource, /\.from\(\s*'([a-z0-9_]+)'/gi);
const definedFunctions = matchAll(migrationSource, /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)/gi);
const definedRelations = matchAll(migrationSource, /create\s+(?:table|view)\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi);

const missing = (used, defined, allowed) =>
  [...used].filter((name) => !defined.has(name) && !allowed.has(name)).sort();

const staleAllowlistEntries = (allowed, defined) =>
  [...allowed].filter((name) => defined.has(name)).sort();

test('every RPC the client calls is defined by a migration, or explicitly known-missing', () => {
  assert.deepEqual(
    missing(calledRpcs, definedFunctions, KNOWN_MISSING_FUNCTIONS),
    [],
    'A new RPC is called from JS/ with no CREATE FUNCTION in Supabase/migrations/. '
      + 'Add the migration (preferred), or add it to KNOWN_MISSING_FUNCTIONS with a note in '
      + "Supabase/README.md's change log explaining why it is live-only.",
  );
});

test('every table/view the client reads is defined by a migration', () => {
  assert.deepEqual(
    missing(usedRelations, definedRelations, new Set()),
    [],
    'A table or view is read via .from() with no CREATE TABLE/VIEW in Supabase/migrations/.',
  );
});

// The reason a fresh `psql -f` of this directory cannot currently succeed.
// Scoped to objects referenced with an explicit `public.` schema qualifier,
// which is what the migrations use for cross-object references — this is a
// drift tripwire, not a SQL parser.
test('migrations do not depend on database objects no migration creates', () => {
  const referenced = new Set([
    ...matchAll(migrationSource, /\bfrom\s+public\.([a-z0-9_]+)/gi),
    ...matchAll(migrationSource, /\bjoin\s+public\.([a-z0-9_]+)/gi),
    ...matchAll(migrationSource, /\bupdate\s+public\.([a-z0-9_]+)/gi),
    ...matchAll(migrationSource, /\binsert\s+into\s+public\.([a-z0-9_]+)/gi),
    ...matchAll(migrationSource, /\bperform\s+public\.([a-z0-9_]+)\s*\(/gi),
  ]);
  const defined = new Set([...definedFunctions, ...definedRelations]);
  assert.deepEqual(
    missing(referenced, defined, KNOWN_MISSING_DEPENDENCIES),
    [],
    'A migration references a public.<object> that no migration in this directory creates, '
      + 'so applying these files to an empty database would fail.',
  );
});

// Without this, an allowlist entry survives the migration that fixed it and
// the next reader can no longer tell real debt from historical noise.
test('the drift allowlists contain no entries that have since been reconciled', () => {
  assert.deepEqual(
    staleAllowlistEntries(KNOWN_MISSING_FUNCTIONS, definedFunctions), [],
    'This function now HAS a migration — remove it from KNOWN_MISSING_FUNCTIONS.',
  );
  assert.deepEqual(
    staleAllowlistEntries(KNOWN_MISSING_DEPENDENCIES, new Set([...definedFunctions, ...definedRelations])), [],
    'This dependency now HAS a migration — remove it from KNOWN_MISSING_DEPENDENCIES.',
  );
});

// Guards the guard: if the extraction regexes ever stop matching (a refactor
// to a helper wrapper, a different quoting style), every assertion above
// would pass vacuously against an empty set and the ratchet would be silently
// off. These floors are well below current counts.
test('the drift scan actually found the objects it is meant to be checking', () => {
  assert.ok(calledRpcs.size >= 25, `expected to find RPC calls in JS/, found ${calledRpcs.size}`);
  assert.ok(definedFunctions.size >= 30, `expected to find functions in migrations, found ${definedFunctions.size}`);
  assert.ok(definedRelations.size >= 5, `expected to find tables/views in migrations, found ${definedRelations.size}`);
});

// ---------------------------------------------------------------------------
// Revoking EXECUTE is a schema change, not a config tweak
//
// The bug this exists for, 2026-10-08 to 2026-10-15: EXECUTE on
// get_scanner_offline_cache() was revoked from `authenticated` to stop a stale
// kiosk tab calling it. get_scanner_offline_cache_compact() is SECURITY
// INVOKER and its body called that function — and an inner call in a SECURITY
// INVOKER function has its EXECUTE checked against the *calling* role. So the
// revoke silently broke the kiosks' whole-roster fallback, and the migration's
// own header asserted the opposite.
//
// It cost nothing in production only because the fallback is reached solely
// when the delta RPC is missing. A guard is worth more than that luck: a
// SECURITY DEFINER wrapper does not privilege the wrapper's own inner calls,
// which is unintuitive enough to be worth a test rather than a comment.
//
// Final-state semantics, applied in filename order: a later GRANT undoes a
// REVOKE, a DROP removes the function from both sets, and CREATE OR REPLACE
// replaces a body. So fixing the problem — by re-granting, by dropping the
// function, or by rewriting the caller — makes this pass, and nothing else
// does.
export function invokerCallsRevoked(filesInOrder) {
  const bodies = new Map();        // name -> { body, definer }
  const revoked = new Set();       // EXECUTE taken from authenticated/anon

  const FUNCTION_RE =
    /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\([\s\S]*?\)\s*(returns[\s\S]*?)\bas\s+(\$[a-z_]*\$)([\s\S]*?)\3/gi;
  const REVOKE_RE = /revoke\s+[\s\S]*?\s+on\s+function\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s*from\s+(authenticated|anon)\b/gi;
  const GRANT_RE = /grant\s+execute\s+on\s+function\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s*to\s+(authenticated|anon)\b/gi;
  const DROP_RE = /drop\s+function\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)/gi;

  for (const sql of filesInOrder) {
    for (const [, name, header, , body] of sql.matchAll(FUNCTION_RE)) {
      // No SECURITY clause means SECURITY INVOKER — Postgres' default, and
      // the case most likely to be overlooked.
      bodies.set(name.toLowerCase(), { body, definer: /security\s+definer/i.test(header) });
    }
    for (const [, name] of sql.matchAll(REVOKE_RE)) revoked.add(name.toLowerCase());
    for (const [, name] of sql.matchAll(GRANT_RE)) revoked.delete(name.toLowerCase());
    for (const [, name] of sql.matchAll(DROP_RE)) {
      bodies.delete(name.toLowerCase());
      revoked.delete(name.toLowerCase());
    }
  }

  const findings = [];
  for (const [caller, { body, definer }] of bodies) {
    if (definer) continue;
    for (const target of revoked) {
      if (caller === target) continue;
      if (new RegExp(`\\bpublic\\.${target}\\s*\\(`, 'i').test(body)) {
        findings.push(`${caller}() is SECURITY INVOKER and calls public.${target}(), whose EXECUTE is revoked`);
      }
    }
  }
  return findings.sort();
}

test('the revoke check catches the shape of the 2026-10-08 bug', () => {
  // Proves the checker works independently of what the repo happens to
  // contain today — otherwise a parser that matched nothing would "pass".
  const broken = [
    `CREATE FUNCTION public.inner_fn() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $function$ SELECT '[]'::jsonb; $function$;`,
    `CREATE FUNCTION public.wrapper() RETURNS jsonb LANGUAGE sql AS $function$ SELECT public.inner_fn(); $function$;`,
    `REVOKE ALL ON FUNCTION public.inner_fn() FROM authenticated;`,
  ];
  assert.deepEqual(invokerCallsRevoked(broken), [
    'wrapper() is SECURITY INVOKER and calls public.inner_fn(), whose EXECUTE is revoked',
  ]);

  // A SECURITY DEFINER wrapper is fine: its body runs as the owner.
  const definerWrapper = [...broken];
  definerWrapper[1] = `CREATE FUNCTION public.wrapper() RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $function$ SELECT public.inner_fn(); $function$;`;
  assert.deepEqual(invokerCallsRevoked(definerWrapper), []);

  // And each of the three real ways out clears it.
  assert.deepEqual(invokerCallsRevoked([...broken, 'GRANT EXECUTE ON FUNCTION public.inner_fn() TO authenticated;']), []);
  assert.deepEqual(invokerCallsRevoked([...broken, 'DROP FUNCTION IF EXISTS public.inner_fn();']), []);
  assert.deepEqual(
    invokerCallsRevoked([...broken, `CREATE OR REPLACE FUNCTION public.wrapper() RETURNS jsonb LANGUAGE sql AS $function$ SELECT '[]'::jsonb; $function$;`]),
    [],
  );
});

test('no SECURITY INVOKER function calls one whose EXECUTE has been revoked', () => {
  const sources = migrationFiles.map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  assert.deepEqual(
    invokerCallsRevoked(sources), [],
    'A SECURITY INVOKER function calls a function whose EXECUTE was revoked from authenticated/anon. '
      + "An inner call in a SECURITY INVOKER function is checked against the CALLER's role, so this "
      + 'raises "permission denied" for every browser caller. Either make the caller SECURITY '
      + 'DEFINER, re-grant, drop the revoked function, or rewrite the caller not to use it.',
  );
});
