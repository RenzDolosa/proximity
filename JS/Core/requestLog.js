// The stateful half of the request meter: storage, the current route, and the
// instrumentation that wraps the Supabase client. All counting RULES live in
// Utils/requestMeter.js, which is pure and tested; this file is the plumbing.
//
// Imports only the pure module, never Core/state.js — state.js imports
// supabaseClient.js, and supabaseClient.js imports this, so reaching back for
// appState.route would close an import cycle. The router pushes the route in
// instead.
import {
  METER_KEY, emptyRecord, record, prune, summarize,
} from '../Utils/requestMeter.js';

let mem = null;      // the record, read once and kept in memory
let route = 'boot';  // requests made before the first render are real too
let dirty = false;
let flushTimer = null;

function load() {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(METER_KEY);
    mem = raw ? prune(JSON.parse(raw)) : emptyRecord();
  } catch {
    // Corrupt or unreadable storage must never break the app for the sake of
    // a diagnostic. Start fresh and carry on.
    mem = emptyRecord();
  }
  return mem;
}

// Buffered, not written per call. A burst of scans would otherwise do a
// synchronous JSON.stringify + localStorage write on the hot path of the one
// screen whose latency actually matters.
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 5000);
}

export function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!dirty || !mem) return;
  try {
    localStorage.setItem(METER_KEY, JSON.stringify(mem));
    dirty = false;
  } catch {
    // QuotaExceeded. Drop everything but today rather than wedging in a state
    // where no further write can ever succeed.
    try {
      mem = prune(mem, Date.now());
      localStorage.setItem(METER_KEY, JSON.stringify({ days: { ...pickToday(mem) } }));
      dirty = false;
    } catch { /* give up quietly; counting continues in memory */ }
  }
}

function pickToday(rec) {
  const keys = Object.keys(rec?.days || {}).sort();
  const last = keys[keys.length - 1];
  return last ? { [last]: rec.days[last] } : {};
}

export function setRoute(next) {
  route = String(next || 'unknown');
}

export function count(kind, name) {
  mem = record(load(), { kind, name, route });
  scheduleFlush();
}

export function readSummary(nowMs = Date.now()) {
  return summarize(load(), nowMs);
}

export function resetMeter() {
  mem = emptyRecord();
  dirty = true;
  flush();
}

/**
 * Wraps the three ways this app reaches Supabase over HTTP. Methods are
 * replaced on the instance rather than hidden behind a Proxy on the whole
 * client: the SDK reads its own internals constantly, and a Proxy that has to
 * be transparent to all of that is a much larger promise than this needs.
 *
 * Counted when the call is MADE, not when it resolves. For `.from()` that
 * means a builder that is constructed and never awaited would be counted
 * without a request being sent. Nothing in this codebase does that — every
 * `.from()` is returned straight into an `await` — but it is the assumption
 * this number rests on.
 *
 * Realtime channels are deliberately not counted: a subscription is one
 * socket, not a request per message, so folding it into a per-request tally
 * would misrepresent both.
 */
export function instrument(client) {
  if (!client || client.__meterInstalled) return client;

  const rpc = client.rpc.bind(client);
  client.rpc = (fn, args, opts) => { count('rpc', fn); return rpc(fn, args, opts); };

  const from = client.from.bind(client);
  client.from = (table) => { count('rest', table); return from(table); };

  if (client.functions?.invoke) {
    const fns = client.functions;
    const invoke = fns.invoke.bind(fns);
    fns.invoke = (name, opts) => { count('fn', name); return invoke(name, opts); };
  }

  // A tab closed mid-interval would otherwise lose up to the flush window.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);

  client.__meterInstalled = true;
  return client;
}
