// Log Ingestion is billed per EVENT, not per byte. Every HTTP request to
// PostgREST writes one API-gateway log line whether it returned 40 bytes or
// 5 MB, so none of the egress work — deltas, compact projections, dropped
// photo arrays — moved this number at all. The only lever is making fewer
// requests, which means these timers.
//
// Measured 2026-10-21: 0.204 GB of a 1 GB quota, 10 days into the cycle. The
// project dashboard's own 60-minute breakdown on 15 Oct was 749 events, 654 of
// them (87%) API Gateway. At ~1.3 kB an event that is ~20 MB/day.
//
// This reads the real constants out of the real source rather than restating
// them, so it cannot drift from what ships. It is a floor, not an equality:
// raising an interval further is always fine, lowering one has to be a
// deliberate edit to this file with a reason.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

// Constants here are written as `15 * 60 * 1000`, so the value has to be
// evaluated, not just parsed. Only digits, `*` and whitespace are accepted —
// anything else means the declaration changed shape and the test should fail
// loudly rather than quietly match something unintended.
function constMs(source, name) {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*([0-9*\\s]+?);`).exec(source);
  assert.ok(m, `could not find ${name} — if it was renamed, update this test`);
  return m[1].trim().split('*').reduce((acc, n) => acc * Number(n.trim()), 1);
}

const dashboard = read('JS', 'Features', 'Dashboard', 'DashboardPage.js');
const badge = read('JS', 'Core', 'alertsBadge.js');
const scanner = read('JS', 'Features', 'Scanner', 'StandaloneScanner.js');
const model = read('JS', 'Models', 'DashboardModel.js');

const MINUTE = 60 * 1000;

test('the polling intervals stay at or above their log-ingestion floors', () => {
  const floors = [
    // Largest single producer: runs all day on whatever screen has the
    // Dashboard open. 30s was 120 ticks/hour.
    ['Dashboard refresh', constMs(dashboard, 'REFRESH_MS'), MINUTE],
    // Runs on every open admin tab on every page, not just the Dashboard.
    ['Alerts badge poll', constMs(badge, 'POLL_MS'), 3 * MINUTE],
    // Three kiosks, 24/7. Only consulted when the kiosk is offline, and a
    // reconnect refreshes immediately rather than waiting for this.
    ['Kiosk lookup refresh', constMs(scanner, 'REFRESH_INTERVAL_MS'), 15 * MINUTE],
    // Thumbnails change only when an admin re-uploads a photo.
    ['Kiosk photo refresh', constMs(scanner, 'PHOTO_REFRESH_INTERVAL_MS'), 60 * MINUTE],
  ];
  for (const [label, actual, floor] of floors) {
    assert.ok(
      actual >= floor,
      `${label} is ${actual / MINUTE} min, below the ${floor / MINUTE} min floor. `
        + 'Every poll is one API-gateway log event against a 1 GB/month quota — '
        + 'see docs/EGRESS_BUDGET.md §4 before lowering this.',
    );
  }
});

test('the kiosk flush timer stays free of the network when idle', () => {
  // This one is deliberately frequent (20s) and that is only acceptable
  // because an empty queue costs a local IndexedDB count and no request. If
  // the early return ever goes, three kiosks start making 540 requests an
  // hour between them for nothing.
  assert.match(
    scanner,
    /const pendingBefore = await OfflineScanModel\.queueCount\(\);\s*\n\s*if \(pendingBefore === 0\) return;/,
    'flushIfPending() must still return before any network call when the queue is empty',
  );
});

test('one Dashboard refresh is one request', () => {
  // The whole point of get_dashboard_tick(): pulse() and rosterDelta() used to
  // be called back to back on every tick. They remain as the deploy-ordering
  // fallback, so their presence is expected — what must not come back is the
  // poll path calling them unconditionally.
  assert.match(model, /async tick\(/, 'DashboardModel.tick() is the combined call');
  assert.match(dashboard, /DashboardModel\.tick\(/, 'the page must use the combined call');
  assert.match(
    dashboard, /if \(!tickUnavailable\)/,
    'the split path must be reachable only once the combined call is known unavailable',
  );
});

// A reference deployment, so the headline number has something behind it:
// 3 kiosks + 2 open admin tabs, one of them showing the Dashboard.
function modelledRequestsPerHour() {
  const perHour = (ms) => 3600000 / ms;
  return {
    dashboardTicks: perHour(constMs(dashboard, 'REFRESH_MS')) * 1, // 1 request per tick now
    badgePolls: perHour(constMs(badge, 'POLL_MS')) * 2,
    kioskLookups: perHour(constMs(scanner, 'REFRESH_INTERVAL_MS')) * 3,
    kioskPhotos: perHour(constMs(scanner, 'PHOTO_REFRESH_INTERVAL_MS')) * 3,
  };
}

test('modelled polling stays well inside the 1 GB/month log quota', () => {
  const m = modelledRequestsPerHour();
  const polling = Object.values(m).reduce((a, b) => a + b, 0);
  // Scans are the irreducible floor — ~3,359/day measured, ~140/hour — and are
  // real work, not overhead. They are counted but never optimised away.
  const SCANS_PER_HOUR = 140;
  const MISC_PER_HOUR = 27; // auth token refresh, realtime, storage
  const EVENT_BYTES = 1300; // ~1.3 kB/event, derived from 654 events/hr ≈ 20 MB/day

  const perHour = polling + SCANS_PER_HOUR + MISC_PER_HOUR;
  const gbPerCycle = (perHour * 24 * 31 * EVENT_BYTES) / 1e9;

  // 115/hour as shipped on 2026-10-21, against 402 before it (Dashboard 120
  // ticks x 2 requests, badge 60 x 2 tabs, kiosks 12 x 3, photos 2 x 3). The
  // ceiling leaves room to add a modest poll without a test edit, but not to
  // drift back toward the old cadences.
  assert.ok(
    polling <= 150,
    `modelled polling is ${polling.toFixed(0)} requests/hour; it was 402 before 2026-10-21 and 115 after`,
  );
  assert.ok(
    gbPerCycle <= 0.5,
    `modelled ${gbPerCycle.toFixed(3)} GB per 31-day cycle against a 1 GB quota — too close`,
  );
});
