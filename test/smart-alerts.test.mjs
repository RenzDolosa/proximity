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
//
// `indexOf('//')` is NOT good enough here and cost a debugging round:
// it truncates `"https://chatapi.viber.com"` to `"https:` and chops
// `/^https?:\/\//i` into an unterminated regex. A comment is only recognised
// when the `//` starts a line or follows whitespace, which leaves `://`
// inside URLs and the escaped slashes inside regex literals alone.
const tsCode = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.search(/(?:^|\s)\/\//); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const silence = read('../Supabase/migrations/20261110090000_scanner_silence_active_hours.sql');
const channels = read('../Supabase/migrations/20261110091000_alert_channels.sql');
const webhook = read('../Supabase/migrations/20261110092000_notify_alert_webhook.sql');
const viber = read('../Supabase/migrations/20261110093000_viber_channel.sql');
const ntfyAdd = read('../Supabase/migrations/20261110094000_ntfy_channel.sql');
const ntfyDrop = read('../Supabase/migrations/20261110095000_drop_ntfy_channel.sql');
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

// ---- Viber ----
//
// The two things that make Viber different from Telegram, and the two ways
// this is easiest to get wrong.

// Viber answers HTTP 200 for an unsubscribed recipient, a bad token and a
// malformed id alike. `res.ok` is true for all of them; the real outcome is
// the `status` field in the body. Checking only the HTTP status would report
// every one of those as delivered.
test('a Viber send is judged on the body status, not the HTTP status', () => {
  const body = tsCode(fn);
  const at = body.indexOf('async function sendViber');
  assert.notEqual(at, -1);
  const send = body.slice(at, body.indexOf('Deno.serve'));
  assert.match(send, /body\?\.status !== 0/,
    'HTTP 200 with status 6 is a failure, and the commonest one');
  assert.ok(send.indexOf('res.ok') < send.indexOf('body?.status'),
    'both checks are needed, in that order');
  assert.match(send, /status === 6/, 'the unsubscribed case deserves a readable hint');
});

test('Viber is offered first and Telegram is kept as a fallback', () => {
  const page = read('../JS/Features/Settings/SettingsPage.js');
  const select = page.slice(page.indexOf('id="ac-channel"'), page.indexOf('id="ac-channel"') + 260);
  assert.ok(select.indexOf('value="viber"') < select.indexOf('value="telegram"'),
    'the first option is the default, and Viber is what was asked for');
  assert.match(tsCode(fn), /c\.channel === "viber"/);
  assert.match(tsCode(fn), /c\.channel === "telegram"/, 'removing a working transport buys nothing');
});

test('the channel constraint is rebuilt rather than altered in place', () => {
  assert.match(viber, /CHECK \(channel IN \('viber', 'telegram', 'email'\)\)/);
  assert.match(viber, /DROP CONSTRAINT IF EXISTS alert_channels_channel_check/,
    'a CHECK cannot be altered in place');
});

test('the subscriber list is as locked down as the channel list', () => {
  assert.match(viber, /REVOKE ALL ON TABLE public\.viber_subscribers FROM anon/);
  assert.match(viber, /REVOKE ALL ON TABLE public\.viber_subscribers FROM authenticated/);
  assert.match(viber, /ENABLE ROW LEVEL SECURITY/);
  assert.match(viber, /REVOKE ALL ON FUNCTION public\.get_viber_subscribers\(\) FROM anon/);
});

// delivered/seen arrive ~twice per message per recipient and carry nothing.
// They are the bulk of this function's traffic, so they have to be discarded
// before any database round trip.
test('delivery receipts are dropped before any database work', () => {
  const hook = tsCode(read('../Supabase/functions/viber-webhook/index.ts'));
  const handler = hook.slice(hook.indexOf('Deno.serve'));
  const receipts = handler.indexOf('"delivered"');
  assert.notEqual(receipts, -1);
  assert.ok(receipts < handler.indexOf('SUPABASE_SERVICE_ROLE_KEY'),
    'reading env for a receipt is already more work than a receipt deserves');
  assert.ok(receipts < handler.indexOf('upsertSubscriber'));
});

// Viber signs callbacks with HMAC-SHA256 of the RAW body. Re-serialising a
// parsed object produces different bytes and never verifies.
test('the webhook verifies the signature over the raw body', () => {
  const hook = tsCode(read('../Supabase/functions/viber-webhook/index.ts'));
  assert.match(hook, /const raw = await req\.text\(\)/);
  const handler = hook.slice(hook.indexOf('Deno.serve'));
  assert.ok(handler.indexOf('signatureValid') < handler.indexOf('JSON.parse(raw)'),
    'parse after verifying, never before');
  assert.match(hook, /name: "HMAC", hash: "SHA-256"/);
});

// A non-2xx makes Viber retry, and repeated failures make it unset the
// webhook — which silently ends subscriber discovery for good.
test('the webhook answers 200 even when its own work failed', () => {
  const hook = tsCode(read('../Supabase/functions/viber-webhook/index.ts'));
  const at = hook.indexOf('} catch (e) {');
  const branch = hook.slice(at, at + 260);
  assert.match(branch, /json\(\{ status: 0 \}\)/, 'Viber unsets a webhook that keeps failing');
  assert.ok(!/\b50\d\b/.test(branch));
});

test("Viber's own validation ping is answered, or the bot stays inert", () => {
  const hook = tsCode(read('../Supabase/functions/viber-webhook/index.ts'));
  assert.match(hook, /event === "webhook"/);
});

test('an unsubscribe flags the row rather than deleting it', () => {
  const hook = tsCode(read('../Supabase/functions/viber-webhook/index.ts'));
  const at = hook.indexOf('"unsubscribed"');
  assert.match(hook.slice(at, at + 260), /upsertSubscriber\([^)]*false\)/s,
    'a destination that vanishes from the picker looks like a bug');
  assert.ok(!/DELETE/i.test(hook.slice(at, at + 260)));
});

// ---- Telegram's 404 ----
//
// Cost a live debugging round. BotFather shows the token as `123456789:AAH…`
// while every URL in the docs reads `/bot<token>/`, so the prefix gets
// copied with it — building `/botbot123…`, which Telegram answers 404.
// A wrong CHAT id is 400 "chat not found" and an un-messaged bot is 403, so
// 404 is always the token and never the recipient.
test('a copied "bot" prefix is stripped from the token', () => {
  const code = tsCode(fn);
  assert.match(code, /function normalizeTelegramToken/);
  const at = code.indexOf('function normalizeTelegramToken');
  const body = code.slice(at, at + 220);
  assert.match(body, /\.trim\(\)/, 'a trailing newline from a paste also 404s');
  assert.match(body, /replace\(\/\^bot\/i, ""\)/);
  // A real token starts with the numeric bot id, so this can never eat part
  // of a valid one.
  assert.match(code, /sendTelegram\(rawToken: string/,
    'normalisation has to happen on the way in, not at each call site');
});

test('a telegram 404 says it is the token, not the chat', () => {
  const code = tsCode(fn);
  const at = code.indexOf('async function sendTelegram');
  const body = code.slice(at, code.indexOf('Deno.serve'));
  assert.match(body, /res\.status === 404/);
  assert.match(body, /bad bot token/,
    'without the hint, 404 reads as "the recipient does not exist"');
});

// ---- ntfy, withdrawn ----
//
// 20261110094000 widened the CHECK to accept it and was APPLIED to the live
// project before the decision was reversed, so 20261110095000 undoes it
// forward rather than the file being deleted. These guard the removal being
// complete in both directions: no code path left behind, and no drift
// between the repo and a database that really did accept 'ntfy' for an hour.

test('the revert narrows the constraint and is a forward migration', () => {
  assert.match(ntfyDrop, /CHECK \(channel IN \('viber', 'telegram', 'email'\)\)/);
  assert.match(ntfyAdd, /CHECK \(channel IN \('ntfy', 'viber', 'telegram', 'email'\)\)/,
    'the migration that introduced it stays in the repo — it is in the applied ledger');
});

// A tightened CHECK is validated against existing rows, so a saved ntfy
// destination would abort the ALTER rather than being dropped.
test('ntfy rows are deleted before the constraint is tightened', () => {
  const del = ntfyDrop.indexOf("WHERE channel = 'ntfy'");
  const alter = ntfyDrop.indexOf('ADD CONSTRAINT alert_channels_channel_check');
  assert.ok(del !== -1 && del < alter, 'the delete has to come first or the ALTER fails');
  assert.match(ntfyDrop, /RETURNING id, kind, enabled/,
    'an operator should see what was removed, not discover it later');
});

test('no ntfy code path survives anywhere', () => {
  const code = tsCode(fn);
  for (const token of ['sendNtfy', 'parseNtfyTarget', 'NTFY_PRIORITY', 'ntfy.sh']) {
    assert.ok(!code.includes(token), `notify-alert still references ${token}`);
  }
  const page = read('../JS/Features/Settings/SettingsPage.js');
  for (const token of ['generateTopic', 'TOPIC_ALPHABET', 'ac-generate', 'value="ntfy"']) {
    assert.ok(!page.includes(token), `SettingsPage still references ${token}`);
  }
});

test('the dropdown offers exactly Telegram and Viber', () => {
  const page = read('../JS/Features/Settings/SettingsPage.js');
  const select = page.slice(page.indexOf('id="ac-channel"'), page.indexOf('</select>'));
  const options = [...select.matchAll(/value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(options, ['viber', 'telegram']);
});

// Kept after ntfy went: a Viber id is re-pickable from the subscriber list
// and a Telegram id re-readable from getUpdates, so nothing is unrecoverable
// — but copying still beats reading digits off a mask and retyping them.
test('a masked destination is still copyable', () => {
  const page = read('../JS/Features/Settings/SettingsPage.js');
  const at = page.indexOf('function copyableMasked');
  const body = page.slice(at, at + 600);
  assert.match(body, /maskTarget\(v\)/, 'the visible text is masked');
  assert.match(body, /data-copy="\$\{esc\(v\)\}"/, 'the clipboard gets the real value');
  assert.match(body, /copyable-btn/,
    "reuses Components/Copyable.js's delegated listener rather than binding another");
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
