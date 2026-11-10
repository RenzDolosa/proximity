// Utils/requestMeter.js — the counting rules behind Settings' Request volume
// panel.
//
// This replaces a SERVER-side answer that turned out not to exist: the
// project-usage Edge Function and its Egress / Log Ingestion tiles were
// removed on 2026-10-05 once every candidate Supabase usage path 404'd. So
// the thing under test is the only remaining way to know the number.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  dayKey, emptyRecord, record, prune, summarize,
  estimateLogBytes, shareOfAllowance, KEEP_DAYS, MAX_KEYS_PER_DAY, BACKGROUND_CALLS,
} from '../JS/Utils/requestMeter.js';

// LOCAL 06:00, built from parts rather than parsed from a Z-suffixed string.
// Buckets and the per-minute rate both key off local midnight, so a UTC
// fixture made every rate assertion depend on the machine's timezone — which
// is how the UTC-vs-local mismatch in dayKey() was found.
const T = new Date(2026, 10, 7, 6, 0, 0).getTime();
const add = (rec, over = {}, at = T) =>
  record(rec, { kind: 'rpc', name: 'get_scan_feed_compact', route: 'scanner', ...over }, at);

test('a request lands in today, by name and by screen', () => {
  const r = add(emptyRecord());
  const s = summarize(r, T);
  assert.equal(s.today, 1);
  assert.deepEqual(s.byRoute, [{ name: 'scanner', count: 1 }]);
  assert.deepEqual(s.byName, [{ name: 'rpc:get_scan_feed_compact', count: 1 }]);
});

test('rest and rpc calls of the same name stay distinct', () => {
  let r = add(emptyRecord(), { kind: 'rpc', name: 'employees' });
  r = add(r, { kind: 'rest', name: 'employees' });
  assert.deepEqual(summarize(r, T).byName, [
    { name: 'rest:employees', count: 1 },
    { name: 'rpc:employees', count: 1 },
  ]);
});

test('record does not mutate the record it is given', () => {
  const before = add(emptyRecord());
  const snapshot = JSON.stringify(before);
  add(before);
  assert.equal(JSON.stringify(before), snapshot,
    'a shared mutable record would double-count on any re-render');
});

// ---- timer-driven calls are not the open screen's fault ----
//
// The alerts badge polls every 180s and on every visibility change, wherever
// you are. Charged to the open screen it made Settings look like the most
// expensive page in the app: 46 of its 70 requests were this one call,
// collected because Settings is where you sit while reading the panel.
test('the alerts badge poll is attributed to background, not the open screen', () => {
  const r = add(emptyRecord(), { kind: 'rpc', name: 'get_unread_alert_count', route: 'settings' });
  assert.deepEqual(summarize(r, T).byRoute, [{ name: 'background', count: 1 }]);
});

test('a real screen call is still charged to that screen', () => {
  const r = add(emptyRecord(), { kind: 'rpc', name: 'get_slow_query_stats', route: 'settings' });
  assert.deepEqual(summarize(r, T).byRoute, [{ name: 'settings', count: 1 }]);
});

// loadProfile() (background, every auth event) and the Users page's list both
// arrive as `.from('profiles')`. The meter sees a table name, not a call
// site, so tagging it would trade a visible misattribution for a hidden one.
test('ambiguous names are left attributed to the screen, not guessed at', () => {
  assert.ok(!BACKGROUND_CALLS.has('profiles'),
    'the meter cannot tell loadProfile() from the Users page list');
  const r = add(emptyRecord(), { kind: 'rest', name: 'profiles', route: 'users' });
  assert.deepEqual(summarize(r, T).byRoute, [{ name: 'users', count: 1 }]);
});

test('the by-call breakdown is unaffected by the re-attribution', () => {
  const r = add(emptyRecord(), { kind: 'rpc', name: 'get_unread_alert_count', route: 'settings' });
  assert.deepEqual(summarize(r, T).byName, [{ name: 'rpc:get_unread_alert_count', count: 1 }],
    'only where it is charged changes, never what it was');
});

// ---- the projection, which is the number someone will act on ----

test("the monthly figure is a rate from today, not a month's total", () => {
  let r = emptyRecord();
  for (let i = 0; i < 360; i++) r = add(r); // 360 calls by 06:00 == 1/min
  const s = summarize(r, T);
  assert.equal(s.today, 360);
  assert.ok(Math.abs(s.perMinute - 1) < 0.01, `expected ~1/min, got ${s.perMinute}`);
  assert.equal(s.projectedDaily, 1440);
  assert.equal(s.projectedMonthly, 43200);
});

// A single call at 00:00:30 must not extrapolate to millions. The floor is
// what stops the first request of the day reading as a catastrophe.
test('a rate computed seconds into the day is floored, not infinite', () => {
  const midnight = new Date(2026, 10, 7, 0, 0, 5).getTime();
  const s = summarize(add(emptyRecord(), {}, midnight), midnight);
  assert.ok(Number.isFinite(s.projectedMonthly));
  assert.ok(s.projectedMonthly <= 43200,
    `one call must not project past one-per-minute, got ${s.projectedMonthly}`);
});

test('an empty record reports zero rather than NaN', () => {
  const s = summarize(emptyRecord(), T);
  assert.equal(s.today, 0);
  assert.equal(s.projectedMonthly, 0);
  assert.deepEqual(s.byRoute, []);
});

test('junk in storage is treated as no record, not thrown on', () => {
  for (const junk of [null, undefined, 'nope', 42, {}, { days: null }]) {
    assert.equal(summarize(junk, T).today, 0);
    assert.equal(record(junk, { kind: 'rpc', name: 'x', route: 'y' }, T).days[dayKey(T)].total, 1);
  }
});

// ---- the bill ----
//
// Log Ingestion bills EVENTS: one gateway line per request whatever the
// payload weighs. The range is deliberate — the client cannot observe the
// real line size, and one confident number would be invented precision.

test('log bytes are reported as a range, never a single figure', () => {
  const e = estimateLogBytes(1000);
  assert.equal(e.low, 1024 * 1000);
  assert.equal(e.high, 2048 * 1000);
  assert.ok(e.high > e.low, 'a single number here would be false precision');
});

test('the allowance share matches the back-of-envelope that prompted this', () => {
  // ~20 req/min sustained is what the Postgres log screenshots showed:
  // 20 * 60 * 24 * 30 = 864,000 requests a month.
  const s = shareOfAllowance(864000, 1024 ** 3);
  assert.ok(s.low > 0.8 && s.low < 0.9, `low bound ${s.low}`);
  assert.ok(s.high > 1.6, `high bound ${s.high} — at 2 KB a line this is over a 1 GB allowance`);
});

test('zero and nonsense request counts do not produce negative bytes', () => {
  for (const v of [0, -5, NaN, undefined, null]) {
    const e = estimateLogBytes(v);
    assert.equal(e.low, 0);
    assert.equal(e.high, 0);
  }
});

// ---- bounded storage ----

test('only the retention window is kept as days pass', () => {
  let r = emptyRecord();
  // Oldest first — the direction time actually runs.
  for (let i = 19; i >= 0; i--) r = add(r, {}, T - i * 86400000);
  assert.equal(Object.keys(r.days).length, KEEP_DAYS,
    'localStorage is ~5MB for the whole origin and this is not the only tenant');
  assert.ok(r.days[dayKey(T)], 'today must survive its own prune');
});

// The bug the test above was originally written badly enough to find. Prune
// used to keep a fixed set of "the last N dates from now", which discards
// days NEWER than `now` — impossible until a device's clock steps backwards,
// at which point a day of real counts disappears instead of being ignored.
test('a backwards clock step does not destroy newer days', () => {
  let r = add(emptyRecord(), {}, T);
  r = add(r, {}, T - 3600000); // an hour earlier than the last write
  assert.ok(r.days[dayKey(T)], 'the newer day must still be there');
  assert.equal(Object.keys(prune(r, T - 86400000).days).length >= 1, true);
});

test('prune keeps today and drops what fell out of the window', () => {
  const old = { days: { '2020-01-01': { total: 9, byName: {}, byRoute: {} } } };
  assert.deepEqual(prune(old, T).days, {});
  assert.ok(prune(add(emptyRecord()), T).days[dayKey(T)]);
});

// A bug generating unique names in a loop must not grow the record until a
// write throws and takes an unrelated feature down with it.
test('distinct names are capped, and the overflow still counts', () => {
  let r = emptyRecord();
  for (let i = 0; i < MAX_KEYS_PER_DAY + 50; i++) r = add(r, { name: `fn_${i}` });
  const day = r.days[dayKey(T)];
  assert.ok(Object.keys(day.byName).length <= MAX_KEYS_PER_DAY + 1,
    'the cap must hold, plus the single (other) bucket');
  assert.ok(day.byName['(other)'] >= 50, 'overflow must be collected, not discarded');
  const summed = Object.values(day.byName).reduce((a, b) => a + b, 0);
  assert.equal(summed, day.total,
    'a total that stops matching the sum of its parts is the wrong kind of wrong');
});

// ---- it must never become a network call ----

test('the meter is pure and reaches for nothing', () => {
  // Block comments stripped as well as line ones: the JSDoc on record()
  // explains the import cycle and so contains the word "supabase".
  const src = readFileSync(fileURLToPath(new URL('../JS/Utils/requestMeter.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); }).join('\n');
  assert.ok(!/\bimport\b|\bfetch\b|supabase|localStorage|document\.|window\./.test(src),
    'a usage meter that costs a request defeats itself');
});

// Core/state.js imports supabaseClient.js, which imports the meter's storage
// half. If that half reached back for appState.route the cycle would close,
// so the router pushes the route in instead. This pins the arrangement.
test('the storage half never imports app state', () => {
  const src = readFileSync(fileURLToPath(new URL('../JS/Core/requestLog.js', import.meta.url)), 'utf8');
  assert.ok(!/from '\.\/state\.js'/.test(src),
    'state.js already imports supabaseClient.js — importing it back is a cycle');
  assert.match(src, /export function setRoute/, 'the route has to be pushed in');
});

test('the client is instrumented, and the router pushes the route', () => {
  const client = readFileSync(fileURLToPath(new URL('../JS/Core/supabaseClient.js', import.meta.url)), 'utf8');
  assert.match(client, /instrument\(/, 'the single shared client is where counting has to happen');
  const router = readFileSync(fileURLToPath(new URL('../JS/Core/router.js', import.meta.url)), 'utf8');
  assert.match(router, /meterSetRoute\(appState\.route\)/);
  assert.ok(router.indexOf('meterSetRoute(appState.route)') < router.indexOf("=== 'dashboard'"),
    'the route must be set BEFORE the render that issues the requests');
});
