// Option A — silence hours, alert channels, and the notify-alert push.
//
// The SQL cannot be executed here (no local Postgres this project can
// authenticate to), so these are structural guards on the migration text plus
// real tests of the JS. They are chosen for the claims that would be
// expensive to get wrong: a feature that silently stops alerting, a table of
// chat ids that turns out to be readable, and a trigger that can abort an
// INSERT.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// From Utils, not the model: AlertChannelsModel imports the Supabase client,
// which reaches for `window` and cannot be loaded under Node.
import { ALERT_KINDS } from '../JS/Utils/alertKinds.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('--'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

// Scoped to ONE function body. Searching a whole migration is how the first
// draft of these tests fooled itself three times: scanner_silence_active_now
// has its own `for r in` loop, the pg_net guard mentions net.http_post in a
// to_regproc check, and index-of across the file found all of them.
const fnBody = (sql, name) => {
  const at = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i'));
  if (at === -1) return '';
  const rest = sql.slice(at);
  const end = rest.indexOf('$function$;');
  return strip(end === -1 ? rest : rest.slice(0, end));
};

// JS/TS line comments, so a comment ABOUT a thing cannot satisfy a test
// looking for the thing.
const tsCode = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const silence = read('../Supabase/migrations/20261110090000_scanner_silence_active_hours.sql');
const channels = read('../Supabase/migrations/20261110091000_alert_channels.sql');
const webhook = read('../Supabase/migrations/20261110092000_notify_alert_webhook.sql');
const fn = read('../Supabase/functions/notify-alert/index.ts');

// ---- the failure that would be invisible ----
//
// shift_rules had zero rows on 2026-11-07, and the union of an empty set is
// empty. Taken literally the gate would switch silence alerting off
// completely — including for a scanner that dies at noon — and look exactly
// like "no scanners are silent".

test('an empty shift_rules falls back instead of disabling alerting', () => {
  const body = strip(silence);
  assert.match(body, /if v_any then\s*\n\s*return false;/,
    'rules that exist and do not cover now must mean inactive');
  assert.match(body, /p_default_from time DEFAULT '07:00'/);
  assert.match(body, /p_default_to time DEFAULT '20:00'/);
  const after = body.slice(body.indexOf('if v_any then'));
  assert.match(after, /return v_local >= p_default_from/,
    'with no usable rules the default window has to apply');
});

// ends_at is nullable and opt-in (20261106090000). A rule that only knows
// when the shift starts cannot bound a window; guessing one would invent a
// schedule nobody entered.
test('a shift rule with no end time contributes no window', () => {
  assert.match(strip(silence), /where starts_at is not null\s*\n\s*and ends_at is not null/);
});

test('a night shift is treated as a union, not as the gap between its ends', () => {
  const body = strip(silence);
  assert.match(body, /if v_open <= v_close then/, 'needs the non-wrapping branch');
  assert.match(body, /v_local >= v_open or v_local <= v_close/,
    'the wrapping branch must be a union — the gap is the hours nobody works');
});

// pg_cron is scheduled against check_scanner_silence(...). Adding an optional
// parameter creates a SECOND overload rather than replacing this one, and a
// no-argument call then fails as ambiguous — the cron job stops silently.
test('check_scanner_silence keeps its exact signature', () => {
  assert.match(silence, /CREATE OR REPLACE FUNCTION public\.check_scanner_silence\(p_silence_minutes integer DEFAULT 60\)/);
  const defs = [...silence.matchAll(/CREATE OR REPLACE FUNCTION public\.check_scanner_silence\(/g)];
  assert.equal(defs.length, 1, 'a second overload would break pg_cron');
});

test('the gate is evaluated once per run, not once per scanner', () => {
  const body = fnBody(silence, 'check_scanner_silence');
  const gate = body.indexOf('scanner_silence_active_now()');
  const loop = body.indexOf('for r in');
  assert.ok(gate !== -1, 'the gate has to be in check_scanner_silence, not only defined nearby');
  assert.ok(loop !== -1 && gate < loop,
    'inside the loop it would cost one call per scanner for an answer that cannot differ');
  assert.equal([...body.matchAll(/scanner_silence_active_now\(/g)].length, 1);
});

// An admin pressing "Check now" at 22:00 should be told nothing was flagged,
// not handed an exception that reads like a bug.
test('being outside the window returns zero rather than raising', () => {
  const body = strip(silence);
  const at = body.indexOf('if not public.scanner_silence_active_now()');
  const branch = body.slice(at, at + 160);
  assert.match(branch, /return query select 0;/);
  assert.ok(!/raise exception/i.test(branch));
});

test('the status RPC explains why nothing fired', () => {
  assert.match(silence, /'alerting_active_now', public\.scanner_silence_active_now\(\)/);
  assert.match(silence, /'window_source'/);
  for (const key of ['silence_minutes', 'total_scanners', 'enabled_scanners', 'silent_now', 'last_run']) {
    assert.ok(silence.includes(`'${key}'`), `${key} dropped — the change must be additive`);
  }
});

// ---- chat ids are credentials ----

test('alert_channels is revoked from both client roles, not just RLS-gated', () => {
  assert.match(channels, /REVOKE ALL ON TABLE public\.alert_channels FROM anon/);
  assert.match(channels, /REVOKE ALL ON TABLE public\.alert_channels FROM authenticated/,
    'Supabase default privileges grant DML on every new table; RLS would be the only line left');
  assert.match(channels, /ALTER TABLE public\.alert_channels ENABLE ROW LEVEL SECURITY/);
});

test('every new function is admin-gated and withheld from anon', () => {
  for (const f of ['get_alert_channels()', 'set_alert_channel(text, text, text, boolean, uuid)', 'delete_alert_channel(uuid)']) {
    assert.ok(channels.includes(`REVOKE ALL ON FUNCTION public.${f} FROM anon`), `${f} not revoked from anon`);
    assert.ok(channels.includes(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated`), `${f} not granted`);
  }
  const count = (re) => [...channels.matchAll(re)].length;
  assert.equal(count(/if not public\.is_admin\(\) then/g), 3, 'all three RPCs gate on is_admin()');
  assert.equal(count(/SET search_path TO 'public'/g), 3, 'definer functions must pin search_path');
});

test('the audit trail records the change without copying the target into it', () => {
  assert.match(channels, /log_audit_event\(\s*\n?\s*'alert_channel_set'/);
  assert.match(channels, /log_audit_event\(\s*\n?\s*'alert_channel_deleted'/);
  const setBody = channels.slice(channels.indexOf("'alert_channel_set'"), channels.indexOf("'alert_channel_set'") + 320);
  assert.ok(!/v_target|p_target/.test(setBody),
    'audit_log is readable by every admin — the chat id is the half worth not copying');
});

// ---- the trigger must never cost an alert ----

test('a failed notification cannot abort the alert INSERT', () => {
  const body = strip(webhook);
  assert.match(body, /exception when others then[\s\S]{0,200}return new;/,
    'a broken Telegram config would otherwise stop alerts being recorded at all');
});

// Rule 5: gate any added work behind a cheap condition. With no destinations
// configured this must cost an index probe and nothing else.
test('the trigger short-circuits before touching Vault or the network', () => {
  const body = fnBody(webhook, 'trg_notify_alert');
  const guard = body.indexOf('if not exists (');
  assert.notEqual(guard, -1, 'there must be a cheap early return');
  assert.ok(guard < body.indexOf('vault.decrypted_secrets'), 'Vault is read after the guard');
  assert.ok(guard < body.indexOf('net.http_post'), 'the HTTP call is made after the guard');
  assert.match(body.slice(guard, guard + 220), /return new;/,
    'the guard has to actually return, not merely branch');
});

test('no secret is written into the migration', () => {
  for (const src of [webhook, channels, silence]) {
    assert.ok(!/bot[0-9]{6,}:/i.test(src), 'a Telegram token must never reach the repo');
    assert.ok(!/create_secret\(\s*'[^']{16,}'\s*,/.test(strip(src)),
      'secrets are created by hand, not by a migration');
  }
  assert.match(webhook, /decrypted_secret into v_url/, 'the URL comes from Vault at call time');
});

test('the trigger fires on INSERT only', () => {
  assert.match(webhook, /AFTER INSERT ON public\.alerts/);
  assert.ok(!/AFTER INSERT OR UPDATE/.test(webhook),
    'an UPDATE would re-notify an alert that was merely acknowledged');
});

// ---- the Edge Function ----

test('the success path prints nothing', () => {
  const body = fn.slice(fn.indexOf('Deno.serve'));
  const logs = [...body.matchAll(/console\.(log|info|warn|error)/g)].map((m) => m[1]);
  assert.ok(!logs.includes('log') && !logs.includes('info'),
    'every line is a function_edge_logs row against a 1 GB budget');
  assert.ok(logs.includes('error'), 'failures still have to be findable');
});

// A 5xx makes pg_net retry, which re-delivers to the channels that already
// succeeded. 207 says "some of this worked" and stops there.
test('a partial failure is 207, not a 5xx', () => {
  assert.match(fn, /sent > 0 \? 207 : 502/);
});

test('the request body cannot choose its own destination', () => {
  assert.match(fn, /alert_channels\?select=id,kind,channel,target&enabled=eq\.true/,
    'targets are read server-side, or a leaked secret becomes an open relay');
  const handler = fn.slice(fn.indexOf('Deno.serve'));
  assert.ok(!/alert\.target|alert\.chat/.test(handler), 'nothing may be taken from the payload as a target');
});

test('a wrong shared secret is rejected without writing a log line', () => {
  const at = fn.indexOf('secretMatches(req.headers');
  const branch = fn.slice(at, at + 260);
  assert.match(branch, /403/);
  assert.ok(!/console\./.test(branch),
    'logging here lets an unauthenticated caller inflate the log bill at will');
});

test('the chat id never reaches a log line', () => {
  for (const m of fn.matchAll(/console\.error\(([^;]*)\)/g)) {
    assert.ok(!/\.target|chatId/.test(m[1]),
      `a console line carries the delivery target: ${m[1].slice(0, 80)}`);
  }
});

// Scanner labels are user-supplied. Markdown parse_mode would let a stray
// underscore either mangle the message or make Telegram reject it outright.
test('messages are sent as plain text', () => {
  assert.ok(!/parse_mode/.test(tsCode(fn)),
    'a scanner label is user-supplied; a stray underscore would mangle the message or be rejected outright');
});

// ---- the badge, which is the other half of the cost story ----

test('the alert badge poll was widened now that push exists', () => {
  const badge = read('../JS/Core/alertsBadge.js');
  assert.match(badge, /const POLL_MS = 600000;/);
  assert.match(badge, /visibilitychange/, 'it must still catch up instantly on focus');
});

test('the kind picker offers a real NULL, not a literal', () => {
  assert.equal(ALERT_KINDS[0].value, '', 'the empty value is what maps to "every kind"');
  const model = read('../JS/Models/AlertChannelsModel.js');
  assert.ok(!/\.from\('alert_channels'\)/.test(model),
    'the table is revoked from the client role — RPCs only');
});
