// Guards on the idempotent-replay path (20261106170000).
//
// Production logs filled with `23505 duplicate key value violates unique
// constraint "scan_events_request_id_key"` — in bursts, from a kiosk working
// correctly. 20261023070023 guaranteed a replay did not take EFFECT; it did
// not make asking twice safe, so every replay raised an uncaught error that
// Postgres wrote to the log.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDuplicateScanRequestError } from '../JS/Core/offlineScanning.js';

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const strip = (src) => src.split('\n').map((l) => {
  const at = l.indexOf('--');
  return at === -1 ? l : l.slice(0, at);
}).join('\n');

const sql = strip(read('../Supabase/migrations/20261106170000_absorb_duplicate_scan_replays.sql'));
// Anchored on CREATE, not on the bare word FUNCTION: these files also carry
// DROP FUNCTION, COMMENT ON FUNCTION, REVOKE ... ON FUNCTION and GRANT ... ON
// FUNCTION lines for the same name, and indexOf happily returns whichever
// comes first.
const defAt = (src, name) => {
  const at = src.search(new RegExp(`CREATE (OR REPLACE )?FUNCTION public\\.${name}\\s*\\(`, 'i'));
  assert.notEqual(at, -1, `${name} must be defined`);
  return at;
};
const fn = (name) => {
  const body = sql.slice(defAt(sql, name));
  const end = body.indexOf('$function$;');
  return end === -1 ? body : body.slice(0, end);
};

// THE FIX. Looking before inserting is what keeps the INSERT from ever
// colliding; an exception handler alone would still log every replay.
test('a replay is answered before the insert, not after it fails', () => {
  const body = fn('scan_proximity_code_compact');
  const lookup = body.indexOf('prior_scan_for_request(p_request_id)');
  const scan = body.indexOf('public.scan_proximity_code(');
  assert.ok(lookup !== -1 && scan !== -1, 'expected both the lookup and the scan call');
  assert.ok(lookup < scan,
    'the lookup must come FIRST — reacting to the unique violation instead '
    + 'leaves Postgres logging an ERROR for every replay');
});

// The race the lookup cannot close: the original request was still in flight
// when this one checked. Plausible here, since the 4s client timeout is what
// creates the replay in the first place.
test('a concurrent collision still returns the original, never an error', () => {
  const body = fn('scan_proximity_code_compact');
  assert.ok(/EXCEPTION WHEN unique_violation/i.test(body), 'the race needs a handler');
  const handler = body.slice(body.search(/EXCEPTION WHEN unique_violation/i));
  assert.ok(/prior_scan_for_request/.test(handler),
    'the handler must resolve to the original response');
  assert.ok(/RAISE;/.test(handler),
    'a unique violation it cannot explain is a real fault and must re-raise');
});

// Recomputing would give the OPPOSITE answer: direction comes from scan_logs's
// length, and the first call already incremented it.
test('the replay reports the original direction, not a recomputed one', () => {
  const body = fn('prior_scan_for_request');
  assert.ok(/l\.elem ->> 'scan_id' = v_scan\.id::text/.test(body),
    'direction must be read back from the scan_logs entry this scan wrote');
  assert.ok(!/scan_count|% 2/.test(body), 'nothing here may recompute parity');
});

test('the replay reports the original timestamp, not the replay time', () => {
  const body = fn('scan_proximity_code_compact');
  assert.ok(/v_scanned_at := coalesce\(\(v_result ->> 'scanned_at'\)::timestamptz/.test(body),
    'a replay is a re-reading of a past event, not a new one');
});

// A kiosk account cannot SELECT public.employees directly, so an
// invoker-rights lookup would find nothing, fall through to the INSERT, and
// raise the very error this migration removes.
test('the lookup runs as definer while the scan path stays invoker', () => {
  assert.ok(/SECURITY DEFINER/.test(fn('prior_scan_for_request')),
    'an invoker-rights lookup returns nothing for a kiosk account');
  assert.ok(/SECURITY INVOKER/.test(fn('scan_proximity_code_compact')),
    'the scan path must NOT quietly gain definer rights');
});

test('the definer lookup is gated the same way scan_events itself is', () => {
  const body = fn('prior_scan_for_request');
  assert.ok(/is_admin\(\) or public\.can_view_scanner\(\)/i.test(body),
    'must match the scan_events SELECT policy, so it exposes nothing new');
  assert.ok(/if p_request_id is null then/i.test(body),
    'a null request_id must short-circuit rather than scanning the table');
});

// Changing the signature would need DROP then CREATE and would strand the
// deployed client on an old overload.
test('the signature is unchanged from the version it replaces', () => {
  const previous = strip(read('../Supabase/migrations/20261023070023_idempotent_scanner_retries.sql'));
  const head = (src) => {
    const at = defAt(src, 'scan_proximity_code_compact');
    return src.slice(at, src.indexOf('AS $function$', at))
      .replace(/^CREATE (OR REPLACE )?/i, '')
      .replace(/\s+/g, ' ').trim();
  };
  assert.equal(head(sql), head(previous),
    'arguments, RETURNS, volatility or security changed');
  assert.ok(!/DROP\s+FUNCTION[^;]*scan_proximity_code_compact/i.test(sql),
    'no DROP should be needed');
});

// scan_proximity_code()'s live body is ahead of this repo, so replacing it
// from here would overwrite a definition nobody can read.
test('the underlying scan function is left alone', () => {
  assert.ok(!/CREATE\s+(OR REPLACE\s+)?FUNCTION public\.scan_proximity_code\s*\(/i.test(sql),
    'only the compact wrapper may be redefined here');
});

// The client-side handling predates this and must stay: the server can still
// re-raise an unexplainable violation, and a kiosk tab may be running older
// code than the database.
test('the client still treats a duplicate request as success', () => {
  assert.equal(isDuplicateScanRequestError({ code: '23505', message: 'duplicate key value violates unique constraint "scan_events_request_id_key"' }), true);
  assert.equal(isDuplicateScanRequestError({ code: '23505', message: 'violates unique constraint "employees_pkey"' }), false,
    'an unrelated unique violation is a real failure and must not be swallowed');
  assert.equal(isDuplicateScanRequestError({ code: '23503', message: 'scan_events_request_id_key' }), false);
  assert.equal(isDuplicateScanRequestError(null), false);
});

test('a replay is marked, so the count stays visible to a caller', () => {
  assert.ok(/'duplicate', true/.test(fn('prior_scan_for_request')),
    'after this change the log no longer reports replays; the response is the '
    + 'only thing left that can');
});
