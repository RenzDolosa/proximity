// Counts the requests this app makes, locally, and never tells anyone.
//
// WHY THIS EXISTS. Supabase bills Log Ingestion per EVENT: the API gateway
// writes one line per request whatever the payload weighs, so the number that
// matters is "how many calls", not "how many bytes". Nothing in the product
// reports that number back to you.
//
// A server-side answer was tried and abandoned. The `project-usage` Edge
// Function and the Egress / Cached Egress / Log Ingestion / Log Query tiles
// were removed on 2026-10-05 once the live project proved Supabase exposes no
// usage or billing API at all — every candidate path 404s while the token
// verifiably works (see SettingsPage.js and README.md's change log). So the
// only remaining place to count is here, in the client, before the request
// leaves. That costs nothing: a counter is not a network call.
//
// WHAT IT CANNOT SEE, stated up front because a usage number that overstates
// its own completeness is worse than no number:
//   - other devices. Each browser counts itself. Kiosks on other tablets are
//     invisible unless you read this panel on them too.
//   - Supabase's own internal traffic (Realtime heartbeats, background
//     workers, the SQL editor, pg_cron) which is billed but is not us.
//   - anything a different origin issues, including the standalone scanner
//     tab when it is opened as a separate app install.
// It tells you which of YOUR screens generates traffic. It does not reconcile
// against the invoice, and the panel says so.

export const METER_KEY = 'proximity.requestMeter.v1';
// Seven buckets is enough to see a weekday/weekend shape without the record
// growing without bound; localStorage is a hard ~5 MB per origin and this is
// not the only thing in it.
export const KEEP_DAYS = 7;
// A hard stop on distinct names. A bug that generated unique RPC names in a
// loop would otherwise grow this record until a write throws QuotaExceeded
// and takes an unrelated feature down with it.
export const MAX_KEYS_PER_DAY = 200;

// LOCAL days, not UTC. toISOString() was the obvious way to write this and it
// is wrong here twice over: for a site at UTC+8 the bucket would roll over at
// 08:00 local, mid-morning, splitting one shift across two "days"; and the
// per-minute rate below measures from LOCAL midnight, so a UTC key made the
// two disagree by exactly the timezone offset and the rate came out wrong.
export function dayKey(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function startOfLocalDay(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function emptyRecord() {
  return { days: {} };
}

/**
 * Adds one request to the tally. Pure: takes a record, returns a new one.
 *
 * `route` is the screen the call was made from, pushed in by the router
 * rather than read from appState — Core/state.js imports supabaseClient.js,
 * so a meter that reached back into state would close an import cycle.
 */
export function record(rec, { kind, name, route }, nowMs = Date.now()) {
  const base = rec && typeof rec === 'object' && rec.days ? rec : emptyRecord();
  const day = dayKey(nowMs);
  const label = `${kind === 'rpc' ? 'rpc' : 'rest'}:${String(name || 'unknown')}`;
  const where = String(route || 'unknown');

  const days = { ...base.days };
  const bucket = days[day] ? { ...days[day] } : { total: 0, byName: {}, byRoute: {} };
  bucket.total += 1;
  bucket.byName = bump(bucket.byName, label);
  bucket.byRoute = bump(bucket.byRoute, where);
  days[day] = bucket;

  return prune({ days }, nowMs);
}

// Over the cap, extra names collapse into one bucket rather than being
// dropped: a total that silently stops matching the sum of its parts is the
// kind of wrong a diagnostic must not be.
function bump(map, key) {
  const next = { ...map };
  if (next[key] === undefined && Object.keys(next).length >= MAX_KEYS_PER_DAY) {
    next['(other)'] = (next['(other)'] || 0) + 1;
    return next;
  }
  next[key] = (next[key] || 0) + 1;
  return next;
}

// Drops days strictly OLDER than the window, rather than keeping a fixed set
// of the last N dates. The set version discarded days NEWER than `nowMs`,
// which sounds impossible until a device's clock steps backwards (or a
// caller prunes with an old timestamp) and a day of real counts vanishes.
export function prune(rec, nowMs = Date.now()) {
  const cutoff = dayKey(nowMs - (KEEP_DAYS - 1) * 86400000);
  const days = {};
  for (const [d, v] of Object.entries(rec?.days || {})) if (d >= cutoff) days[d] = v;
  return { days };
}

const desc = (obj) => Object.entries(obj || {})
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

/**
 * What the panel renders. `projectedMonthly` extrapolates from TODAY ONLY and
 * is explicitly a rate, not a forecast — at 09:00 it is three hours of a
 * morning multiplied up, which is why the panel labels it "at today's rate so
 * far" rather than "this month".
 */
export function summarize(rec, nowMs = Date.now()) {
  const days = rec?.days || {};
  const today = days[dayKey(nowMs)] || { total: 0, byName: {}, byRoute: {} };

  const msIntoDay = Math.max(
    60000, // before the first minute is out, a rate is meaningless — floor it
    nowMs - startOfLocalDay(nowMs),
  );
  const perMinute = today.total / (msIntoDay / 60000);

  const history = Object.entries(days)
    .map(([day, v]) => ({ day, total: v.total }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return {
    today: today.total,
    perMinute,
    projectedDaily: Math.round(perMinute * 1440),
    projectedMonthly: Math.round(perMinute * 1440 * 30),
    byRoute: desc(today.byRoute),
    byName: desc(today.byName),
    history,
    days: history.length,
  };
}

// One log line per request, and a gateway line is roughly 1-2 KB. The range
// is deliberate: the exact size is not something the client can observe, and
// a single confident number here would be invented precision.
export const LOG_LINE_BYTES = Object.freeze({ low: 1024, high: 2048 });

export function estimateLogBytes(requests) {
  const n = Number.isFinite(requests) ? Math.max(0, requests) : 0;
  return { low: n * LOG_LINE_BYTES.low, high: n * LOG_LINE_BYTES.high };
}

/** Share of a monthly log-ingestion allowance, as a 0..1 fraction per bound. */
export function shareOfAllowance(requests, allowanceBytes = 1024 ** 3) {
  const { low, high } = estimateLogBytes(requests);
  const cap = allowanceBytes > 0 ? allowanceBytes : 1;
  return { low: low / cap, high: high / cap };
}
