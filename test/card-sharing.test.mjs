import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Card-sharing detection is entirely SQL — a trigger on scan_events — so there
// is no pure function to unit-test. What these assert instead are the
// properties of that SQL the feature's safety depends on, source-level, in the
// same spirit as the CSS contract tests in nav-groups.test.mjs.

const sql = (name) => readFileSync(fileURLToPath(new URL(`../Supabase/migrations/${name}`, import.meta.url)), 'utf8');

// Strips `--` line comments. Needed because this migration deliberately
// DESCRIBES the patterns it avoids — its own comment explains why
// `scan_logs -> -2` is wrong, which made the first run of the array-position
// test below fail against its own rationale. Same trap as the re-export guard.
const code = (src) => src.split('\n').map((line) => {
  const at = line.indexOf('--');
  return at === -1 ? line : line.slice(0, at);
}).join('\n');

const MIGRATION = '20261104093000_card_sharing_signals.sql';
const triggerBody = () => {
  const src = code(sql(MIGRATION));
  return src.slice(src.indexOf('CREATE FUNCTION public.trg_detect_card_sharing'));
};

// THE most important assertion here. The detection runs in a trigger inside
// the scan's own transaction, so an uncaught exception in fraud detection
// would refuse a badge at a door. A missed alert is an inconvenience; a
// turnstile that stops working because of a bug in an analytics rule is an
// outage.
test('card-sharing detection can never roll back a scan', () => {
  const body = triggerBody();
  assert.ok(/exception\s+when others then/i.test(body),
    'the detection body must be wrapped in an exception guard');
  const guard = body.slice(body.search(/exception\s+when others then/i));
  assert.ok(!/raise\s/i.test(guard.slice(0, 200)),
    'the exception handler must not re-raise — a detection bug must not stop a turnstile');
});

test('card-sharing requires both sites to be configured', () => {
  const body = triggerBody();
  // An unset site must mean "no claim", not "a place of its own" — otherwise
  // two readers at one entrance alert on anyone walking past both.
  assert.ok(body.includes('if v_this_site is null then'), 'must bail when this scanner has no site');
  assert.ok(body.includes('if v_prev_site is null or v_prev_site = v_this_site then'),
    'must bail when the previous scanner has no site, or is the same site');
});

test('the predecessor scan is found by time, not by array position', () => {
  const body = triggerBody();
  // scan_logs stopped being append-only in 20261024090000: a backdated replay
  // is spliced in by scanned_at, so indexing from the end does not give this
  // scan's predecessor.
  assert.ok(!body.includes('-> -2'), 'must not index the array from the end');
  assert.ok(body.includes("order by (l.elem ->> 'scanned_at')::timestamptz desc"),
    'must order candidates by time');
  assert.ok(body.includes('is distinct from new.id::text'), 'must exclude the scan being inserted');
});

test('the dedupe key is stable whichever way the person travelled', () => {
  const src = code(sql(MIGRATION));
  // least/greatest makes A->B and B->A one key, so pacing between two readers
  // is one investigation rather than an alert per direction.
  assert.ok(src.includes('least(v_prev_site, v_this_site)')
         && src.includes('greatest(v_prev_site, v_this_site)'),
    'the dedupe key must order the site pair');
});

test('detection is a trigger on scan_events, not a scan-RPC edit', () => {
  const src = code(sql(MIGRATION));
  assert.ok(/CREATE TRIGGER \w+\s+AFTER INSERT ON public\.scan_events/i.test(src),
    'must attach to scan_events so every write path is covered');
});

// scan_proximity_code(), update_scanner() and get_scanners() are either
// live-only or documented in Supabase/README.md's 2026-10-05 entry as having
// been ahead of the committed copy. A CREATE OR REPLACE of any of them from
// this branch would silently revert whatever is actually running — in the case
// of scan_proximity_code(), the function that decides whether a door opens.
test('neither migration replaces a function this repo cannot see', () => {
  const src = code(sql(MIGRATION)) + code(sql('20261104090000_punctuality.sql'));
  for (const risky of [
    'FUNCTION public.scan_proximity_code(',
    'FUNCTION public.update_scanner(',
    'FUNCTION public.get_scanners(',
  ]) {
    assert.ok(!src.includes(`CREATE OR REPLACE ${risky}`), `must not replace ${risky}`);
    assert.ok(!src.includes(`CREATE ${risky}`), `must not define ${risky}`);
  }
});

// The travel-time resolver and the shift-rule resolver both lean on Postgres
// sorting false before true to prefer a specific row over the '*' fallback.
// Inverting it would make every pair silently use the default.
test('the travel-time resolver prefers a specific pair over the default', () => {
  const src = code(sql(MIGRATION));
  assert.ok(src.includes("ORDER BY (r.from_site = '*')"), 'specificity ordering must be present');
});
