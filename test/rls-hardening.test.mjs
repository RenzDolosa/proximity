// The 2026-11-06 RLS audit, and the two findings 20261106190000 fixes.
//
// Both were invisible to the existing suite: access-control.test.mjs tested
// the shapes that exist in production and never the one the DEFAULT produces,
// and nothing tested table grants at all.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canViewEmployeeManager, canViewScanner, canViewSettings, canViewScannerRegistry,
} from '../JS/Core/accessControl.js';

const sql = readFileSync(
  fileURLToPath(new URL('../Supabase/migrations/20261106190000_tighten_anon_grants_and_scope_reads.sql', import.meta.url)),
  'utf8',
).split('\n').map((l) => {
  const at = l.indexOf('--');
  return at === -1 ? l : l.slice(0, at);
}).join('\n');

const body = (fn) => {
  const at = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)`, 'i'));
  assert.notEqual(at, -1, `${fn} must be redefined`);
  const b = sql.slice(at);
  const e = b.indexOf('$function$;');
  return e === -1 ? b : b.slice(0, e);
};

// ---- finding 2: the account the DEFAULT creates ----
//
// profiles.access_scope DEFAULTs to 'all' and handle_new_auth_user() sets
// role='viewer' without touching scope. So this is not a hypothetical shape —
// it is what the next signup produces.
const NEW_SIGNUP = { role: 'viewer', access_scope: 'all' };

test('a default new account can read nothing', () => {
  assert.equal(canViewEmployeeManager(NEW_SIGNUP), false,
    'would expose employees: email, phone, photo_thumb_b64, scan_logs');
  assert.equal(canViewScanner(NEW_SIGNUP), false,
    'would expose every scan_event and scan_events_archive row');
  assert.equal(canViewSettings(NEW_SIGNUP), false);
  assert.equal(canViewScannerRegistry(NEW_SIGNUP), false);
});

// THE REGRESSION GUARD THAT MATTERS. Each of these is a real account in
// production as of the audit, and the fix must not move any of them. A
// security change that locks out five managers is an outage.
const LIVE = [
  { name: 'admin/all', p: { role: 'admin', access_scope: 'all' }, emp: true, scan: true, set: true },
  { name: 'manager/all', p: { role: 'manager', access_scope: 'all' }, emp: true, scan: true, set: true },
  { name: 'viewer/scanner', p: { role: 'viewer', access_scope: 'scanner' }, emp: false, scan: true, set: true },
];

for (const { name, p, emp, scan, set } of LIVE) {
  test(`${name} is unchanged by the hardening`, () => {
    assert.equal(canViewEmployeeManager(p), emp);
    assert.equal(canViewScanner(p), scan);
    assert.equal(canViewSettings(p), set);
  });
}

// An explicit narrow scope is the grant working as intended and must keep
// working on its own, at any role — otherwise the only way to provision a
// kiosk would be to make it a manager.
test('an explicit scope still grants without a role', () => {
  assert.equal(canViewScanner({ role: 'viewer', access_scope: 'scanner' }), true);
  assert.equal(canViewEmployeeManager({ role: 'viewer', access_scope: 'employee_manager' }), true);
});

test('a scanner kiosk still cannot read the employee directory', () => {
  assert.equal(canViewEmployeeManager({ role: 'viewer', access_scope: 'scanner' }), false,
    'the kiosk credential is the most physically exposed one in the system');
});

test('missing or malformed profiles are denied, not defaulted open', () => {
  for (const p of [null, undefined, {}, { role: 'viewer' }, { access_scope: null }]) {
    assert.equal(canViewEmployeeManager(p), false);
    assert.equal(canViewScanner(p), false);
    assert.equal(canViewSettings(p), false);
  }
});

// ---- the client must not drift from the database ----
//
// The UI was already STRICTER than the database in places, which is how the
// hole stayed invisible: the screens looked right while PostgREST answered
// anyway.
test('no SQL helper grants on a bare catch-all scope', () => {
  for (const fn of ['can_view_employee_manager', 'can_view_scanner', 'can_view_settings']) {
    const b = body(fn);
    assert.ok(!/access_scope in \('all'/i.test(b) && !/access_scope = 'all'(?!\s*\))/i.test(b.replace(/role = 'manager' and access_scope = 'all'/gi, '')),
      `${fn} still grants on access_scope 'all' alone — that is the DEFAULT`);
  }
});

test('the catch-all requires a role in every helper that accepts it', () => {
  for (const fn of ['can_view_scanner', 'can_view_settings']) {
    const b = body(fn);
    if (!/'all'/.test(b)) continue;
    assert.ok(/role = 'manager' and access_scope = 'all'/i.test(b),
      `${fn} mentions 'all' without pairing it to a role`);
  }
});

test('the helpers keep their definer context and pinned search_path', () => {
  for (const fn of ['can_view_employee_manager', 'can_view_scanner', 'can_view_settings']) {
    const b = body(fn);
    assert.ok(/SECURITY DEFINER/i.test(b), `${fn} must stay SECURITY DEFINER`);
    assert.ok(/SET search_path TO 'public'/i.test(b), `${fn} must pin search_path`);
    assert.ok(/LANGUAGE sql/i.test(b) && /STABLE/i.test(b), `${fn} signature must be unchanged`);
  }
});

// ---- finding 1: anon ----

test('anon is stripped of everything in schema public', () => {
  for (const kind of ['TABLES', 'SEQUENCES', 'FUNCTIONS']) {
    assert.ok(new RegExp(`REVOKE ALL ON ALL ${kind} IN SCHEMA public FROM anon`, 'i').test(sql),
      `anon keeps ${kind.toLowerCase()} privileges`);
  }
});

// export_tasks appeared in the anon grant list despite 20261106150000
// granting nothing — Supabase's default privileges re-apply ALL to anon for
// every new table. Without this the fix decays with the next migration.
test('future tables do not re-grant to anon', () => {
  assert.ok(/ALTER DEFAULT PRIVILEGES IN SCHEMA public\s+REVOKE ALL ON TABLES FROM anon/i.test(sql),
    'the default privilege is what put anon on export_tasks in the first place');
});

// RLS does not apply to TRUNCATE. TRIGGER lets a grantee attach code to the
// table. PostgREST issues neither, so they are pure liability.
test('the verbs RLS cannot govern are removed from authenticated', () => {
  const m = sql.match(/REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM authenticated/i);
  assert.ok(m, 'TRUNCATE ignores RLS entirely and must not be held by a client role');
  assert.ok(/ALTER DEFAULT PRIVILEGES[\s\S]{0,120}REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM authenticated/i.test(sql),
    'and must not come back on the next table');
});

// ---- authenticated keeps only what PostgREST reaches ----
//
// Unblocked by measuring prosecdef on all ten live-only functions (all true)
// and confirming no SECURITY INVOKER function touches any table below. The
// prize is scan_events: 150,504 rows of movement history that any logged-in
// account could otherwise pull in one request.

const REVOKED_FROM_AUTHENTICATED = [
  'public.scan_events', 'public.scan_events_archive', 'public.audit_log',
  'public.export_tasks', 'public.alerts', 'public.scanners',
  'public.shift_rules', 'public.site_travel_rules',
  'public.proximity_card_directory', 'public.unassigned_active_proximity_cards',
];

test('every RPC-only relation is revoked from authenticated', () => {
  for (const rel of REVOKED_FROM_AUTHENTICATED) {
    assert.ok(sql.includes(`'${rel}'`), `${rel} must lose its direct grant`);
  }
  assert.ok(/REVOKE ALL ON TABLE %s FROM authenticated/.test(sql),
    'the revoke must actually be executed, not just listed');
});

// alerts and scanners exist only in the live database — no migration here
// creates them. A plain REVOKE naming them aborts the whole file anywhere
// they are absent.
test('the revoke tolerates relations this repo does not create', () => {
  assert.ok(/to_regclass\(v_rel\) IS NOT NULL/i.test(sql),
    'alerts and scanners are in schema-drift KNOWN_MISSING_DEPENDENCIES');
});

// BaseModel builds `.from(table)` with a VARIABLE, so insert and delete are
// reachable on all three createModel tables whether or not a caller uses
// them today. A grep for .from('profiles') sees only select and update.
test('the four reachable relations keep exactly the verbs the client can issue', () => {
  for (const t of ['employees', 'proximity_cards', 'profiles']) {
    assert.ok(new RegExp(`GRANT SELECT, INSERT, UPDATE, DELETE ON public\\.${t} TO authenticated`).test(sql),
      `${t} is wrapped by createModel(), which exposes all four verbs`);
  }
  assert.ok(/GRANT SELECT ON public\.employee_directory TO authenticated/.test(sql),
    'the grid view is read-only');
  assert.ok(!/GRANT[^\n]*TRUNCATE/i.test(sql), 'no re-grant may reintroduce TRUNCATE');
});

// security_invoker = true, so the view is only readable if the caller can
// read both tables it joins.
test('the view keeps the underlying grants it needs', () => {
  const viewAt = sql.indexOf('GRANT SELECT ON public.employee_directory');
  for (const t of ['employees', 'proximity_cards']) {
    assert.ok(sql.indexOf(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${t}`) < viewAt,
      `employee_directory is security_invoker and joins ${t}`);
  }
});

// The client reaches exactly four relations. If a fifth ever appears, this
// migration's grant list is wrong and the app breaks on deploy, not in CI.
test('no client code reaches a relation this migration revokes', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  const root = fileURLToPath(new URL('../JS', import.meta.url));
  const js = walk(root).filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(f, 'utf8')).join('\n');
  const reached = new Set([...js.matchAll(/\.from\(\s*['"`]([a-z_]+)['"`]/g)].map((m) => m[1]));
  for (const rel of REVOKED_FROM_AUTHENTICATED) {
    const bare = rel.replace('public.', '');
    assert.ok(!reached.has(bare),
      `${bare} is reached by .from() but this migration revokes it — that is an outage`);
  }
  assert.deepEqual([...reached].sort(),
    ['employee_directory', 'employees', 'profiles', 'proximity_cards'],
    'the set of directly-reached relations changed; revisit the grant list');
});
