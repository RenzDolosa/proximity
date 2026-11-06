import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  summariseKeystrokes, suffixOfCard, diagnoseRead, readHeadline, HUMAN_TYPING_GAP_MS,
} from '../JS/Utils/readerDiagnostics.js';
import {
  SOURCE, toBatchRow, batchTotals, addToBatch, inconsistentCodes, toCsvRow, BATCH_CSV_COLUMNS,
} from '../JS/Utils/commissioning.js';
import {
  healthRows, overallHealth, fmtAge, HEALTH, CACHE_STALE_AFTER_MS,
} from '../JS/Utils/scannerHealth.js';

// A 10-digit roster, matching the shape measured on 2026-10-08 (761 of 762
// cards exactly 10 digits, one 3-character test card).
const ROSTER = [
  { proximity_code: '0005204037', card_active: true, employee_id: 'e1', employee_status: 'active', scan_count: 0, full_name: 'Rosa Santos', employee_code: '3042' },
  { proximity_code: '0005669295', card_active: true, employee_id: 'e2', employee_status: 'active', scan_count: 1, full_name: 'Jay Cruz', employee_code: '3043' },
  { proximity_code: '0005215056', card_active: false, employee_id: 'e3', employee_status: 'active', scan_count: 0 },
  { proximity_code: '777', card_active: true, employee_id: 'e4', employee_status: 'active', scan_count: 0 },
];

const wedge = (code, gapMs = 8) => [...code].map((key, i) => ({ key, at: i * gapMs }));

// ---- keystroke timing ----

test('a wedge reader reads as fast and evenly spaced', () => {
  const t = summariseKeystrokes(wedge('0005204037', 8));
  assert.equal(t.characters, 10);
  assert.equal(t.minGapMs, 8);
  assert.equal(t.maxGapMs, 8);
  assert.equal(t.medianGapMs, 8);
  assert.equal(t.spanMs, 72);
  assert.equal(t.looksTyped, false);
  assert.equal(t.sawEnter, false);
});

test('hand typing is flagged as such', () => {
  const t = summariseKeystrokes(wedge('0005204037', 180));
  assert.equal(t.looksTyped, true);
  assert.ok(t.medianGapMs > HUMAN_TYPING_GAP_MS);
});

// Enter arrives after a deliberate pause, so including it would skew the
// maximum gap and make every terminator-sending reader look slow.
test('a trailing Enter is noticed but excluded from the timing', () => {
  const events = [...wedge('777', 5), { key: 'Enter', at: 900 }];
  const t = summariseKeystrokes(events);
  assert.equal(t.sawEnter, true);
  assert.equal(t.characters, 3);
  assert.equal(t.maxGapMs, 5, 'Enter must not become the slowest gap');
});

test('a single character has no span and no gaps', () => {
  const t = summariseKeystrokes([{ key: '7', at: 10 }]);
  assert.equal(t.characters, 1);
  assert.equal(t.spanMs, null, '0 would read as "arrived instantly", a different claim');
  assert.equal(t.medianGapMs, null);
  assert.equal(t.looksTyped, false);
});

test('malformed keystroke input never throws', () => {
  for (const bad of [null, undefined, [], [null], [{}], 'nope']) {
    const t = summariseKeystrokes(bad);
    assert.equal(t.characters, 0, JSON.stringify(bad));
  }
});

// ---- truncation ----

// Mirrors scan_proximity_code()'s own `right(code, len) = read` test: a
// truncation drops LEADING characters, so only a suffix is evidence.
test('a dropped-leading-digits read is traced back to its card', () => {
  assert.equal(suffixOfCard('037', ROSTER), '0005204037');
  assert.equal(suffixOfCard('9295', ROSTER), '0005669295');
  assert.equal(suffixOfCard('215056', ROSTER), '0005215056');
});

test('a middle match is not a truncation', () => {
  assert.equal(suffixOfCard('5204', ROSTER), null);
});

test('a complete card is not a truncation of itself', () => {
  assert.equal(suffixOfCard('0005204037', ROSTER), null);
});

// ---- the whole diagnosis ----

test('a good read is reported as complete and matching', () => {
  const d = diagnoseRead({ code: '0005204037', keystrokes: wedge('0005204037'), rows: ROSTER });
  assert.equal(d.rejection, null);
  assert.equal(d.exactMatch, true);
  assert.equal(d.expectedLength, 10);
  assert.equal(d.allDigits, true);
  assert.equal(readHeadline(d), 'Complete read, matches an issued card');
});

test('a truncated read names the card the reader dropped digits from', () => {
  const d = diagnoseRead({ code: '037', keystrokes: wedge('037'), rows: ROSTER });
  assert.equal(d.rejection, 'short');
  assert.equal(d.truncatedOf, '0005204037');
  assert.equal(d.length, 3);
  assert.equal(d.expectedLength, 10);
  assert.equal(readHeadline(d), 'Too few characters — the reader dropped some');
});

// 40-71 characters of one repeated digit, as measured on 2026-10-08.
test('a stuck key reads as too long, not as a partial read', () => {
  const stuck = '9'.repeat(55);
  const d = diagnoseRead({ code: stuck, keystrokes: wedge(stuck, 2), rows: ROSTER });
  assert.equal(d.rejection, 'long');
  assert.equal(readHeadline(d), 'Too many characters — likely a stuck key on the reader');
});

test('a letter in a digits-only estate is a charset fault', () => {
  const d = diagnoseRead({ code: '00052040AB', keystrokes: wedge('00052040AB'), rows: ROSTER });
  assert.equal(d.rejection, 'charset');
  assert.equal(d.allDigits, false);
  assert.equal(d.numericOnly, true);
});

// The 3-character test card is why readRejection() has an exact-match escape
// hatch; the diagnosis must honour it rather than calling it truncated.
test('a legitimately short registered card still reads as complete', () => {
  const d = diagnoseRead({ code: '777', keystrokes: wedge('777'), rows: ROSTER });
  assert.equal(d.rejection, null);
  assert.equal(d.exactMatch, true);
});

// A kiosk that has never synced knows nothing about card shape. Claiming a
// read "looks fine" there is how a broken reader passes a test.
test('with no cached cards, nothing is claimed about shape', () => {
  const d = diagnoseRead({ code: '037', keystrokes: wedge('037'), rows: [] });
  assert.equal(d.rosterKnown, false);
  assert.equal(d.expectedLength, null, 'null, not 0 — 0 would read as "cards are 0 characters"');
  assert.equal(d.maxLength, null);
  assert.equal(d.rejection, null, 'readRejection fails open with no roster');
  assert.equal(readHeadline(d), 'Read captured — no cached cards to check it against');
});

test('an empty read says so rather than throwing', () => {
  assert.equal(readHeadline(diagnoseRead({ code: '', keystrokes: [], rows: ROSTER })), 'Nothing was sent');
  assert.equal(readHeadline(diagnoseRead()), 'Nothing was sent');
  assert.equal(readHeadline(null), 'Nothing was sent');
});

// ---- commissioning batch ----

test('only a matched scan counts as a pass', () => {
  assert.equal(toBatchRow({ code: '1', result: 'matched' }).outcome, 'pass');
  for (const result of ['unmatched', 'inactive_card', 'unassigned_card', 'inactive_employee']) {
    assert.equal(toBatchRow({ code: '1', result }).outcome, 'fail', result);
  }
});

// One loose cable must not mark a whole stack of good cards bad.
test('a reader fault is its own outcome, not a card failure', () => {
  const row = toBatchRow({ code: '037', rejection: 'short' });
  assert.equal(row.outcome, 'reader');
  assert.equal(row.result, 'short');
  const totals = batchTotals([row]);
  assert.equal(totals.failed, 0);
  assert.equal(totals.readerFaults, 1);
});

test('totals count passes, failures, faults and the cache share', () => {
  const rows = [
    toBatchRow({ code: 'a', result: 'matched', source: SOURCE.CACHE }),
    toBatchRow({ code: 'b', result: 'matched', source: SOURCE.SERVER }),
    toBatchRow({ code: 'c', result: 'unassigned_card', source: SOURCE.CACHE }),
    toBatchRow({ code: 'd', rejection: 'long', source: SOURCE.CACHE }),
  ];
  assert.deepEqual(batchTotals(rows), {
    total: 4, passed: 2, failed: 1, readerFaults: 1, fromCache: 3,
  });
  assert.deepEqual(batchTotals(null), { total: 0, passed: 0, failed: 0, readerFaults: 0, fromCache: 0 });
});

// A card that reads correctly four times out of five is a FAILING READER.
// Deduplicating the list would erase exactly that.
test('the same card scanned twice keeps both rows, and is flagged if they differ', () => {
  let rows = [];
  rows = addToBatch(rows, toBatchRow({ code: '0005204037', result: 'matched' }));
  rows = addToBatch(rows, toBatchRow({ code: '0005204037', rejection: 'short' }));
  rows = addToBatch(rows, toBatchRow({ code: '0005669295', result: 'matched' }));
  assert.equal(rows.length, 3);
  assert.deepEqual(inconsistentCodes(rows), ['0005204037']);
});

test('a consistently passing card is not flagged', () => {
  const rows = [
    toBatchRow({ code: 'x', result: 'matched' }),
    toBatchRow({ code: 'x', result: 'matched' }),
  ];
  assert.deepEqual(inconsistentCodes(rows), []);
});

test('newest scan is first on screen', () => {
  const rows = addToBatch([toBatchRow({ code: 'old' })], toBatchRow({ code: 'new' }));
  assert.equal(rows[0].code, 'new');
});

test('every CSV column has a value, including for a reader fault', () => {
  const row = toCsvRow(toBatchRow({ code: '037', rejection: 'short', at: 0 }));
  for (const col of BATCH_CSV_COLUMNS) {
    assert.ok(col in row, `${col} missing`);
    assert.notEqual(row[col], undefined, `${col} undefined`);
  }
  assert.equal(row.code, '037');
  assert.equal(row.outcome, 'reader');
});

// ---- scanner health ----

test('the stale threshold agrees with the scanner model', () => {
  // Read from source rather than imported: OfflineScanModel pulls in
  // supabaseClient, which touches `window` and cannot load under Node. The
  // duplication is deliberate — scannerHealth.js must stay free of browser
  // code — and this is what stops the drawer quietly disagreeing with the
  // stale warning sitting next to it in the header.
  const model = readFileSync(
    fileURLToPath(new URL('../JS/Models/OfflineScanModel.js', import.meta.url)), 'utf8',
  );
  const m = model.match(/STALE_AFTER_MS\s*=\s*([^;]+);/);
  assert.ok(m, 'STALE_AFTER_MS not found in OfflineScanModel.js');
  // eslint-disable-next-line no-eval -- a numeric literal expression from our own source
  assert.equal(CACHE_STALE_AFTER_MS, eval(m[1]));
});

test('a healthy kiosk reports good across the board', () => {
  const rows = healthRows({
    online: true, lastRequestFailed: false, queued: 0,
    cacheRows: 727, cacheSyncedAt: '2026-11-06T00:00:00Z', cacheAgeMs: 2 * 3600 * 1000,
    photosCached: 727, audioUnlocked: true, soundsLoaded: true,
    scannerId: 'Krus4K',
  });
  assert.equal(overallHealth(rows), HEALTH.GOOD);
});

// THE BUG THIS EXISTS FOR. The row read "776 of 835" and implied 59 failed
// downloads. 835 is the CARD count; the offline cache row carries no photo
// field at all, so the kiosk cannot know how many photos should exist — an
// employee with no photo on file looks identical to one whose photo has not
// downloaded. Settings reported exactly 776 thumbnails in existence, so the
// cache was complete while the drawer sent someone hunting for nothing.
test('cached photos are reported without an invented denominator', () => {
  const rows = healthRows({
    online: true, queued: 0, cacheRows: 835, cacheSyncedAt: 'x', cacheAgeMs: 0,
    photosCached: 776, audioUnlocked: true, soundsLoaded: true, scannerId: 'k',
  });
  const photos = rows.find((r) => r.key === 'photos');
  assert.equal(photos.value, '776');
  assert.doesNotMatch(photos.value, /835|of /, 'must not compare against the card count');
  assert.equal(photos.state, HEALTH.GOOD, 'fewer photos than cards is not a fault');
});

// Zero is the one thing that IS knowable here: nothing downloaded means every
// offline scan falls back to initials.
test('no cached photos at all is still worth flagging', () => {
  const rows = healthRows({
    online: true, queued: 0, cacheRows: 835, cacheSyncedAt: 'x', cacheAgeMs: 0,
    photosCached: 0, audioUnlocked: true, soundsLoaded: true, scannerId: 'k',
  });
  assert.equal(rows.find((r) => r.key === 'photos').state, HEALTH.WARN);
});

test('an unknown photo count says so rather than showing zero', () => {
  const rows = healthRows({ online: true, queued: 0, cacheRows: 835, cacheSyncedAt: 'x', cacheAgeMs: 0 });
  const photos = rows.find((r) => r.key === 'photos');
  assert.equal(photos.value, 'unknown');
  assert.equal(photos.state, HEALTH.UNKNOWN);
});

// The merge sets photo_thumb_b64 from the photo cache, and that can be an
// explicit null meaning "this employee has no photo" — how a removed photo
// propagates. `!== undefined` counted those as cached and reported
// thumbnails the kiosk cannot draw.
test('the kiosk counts real thumbnails, not explicit nulls', () => {
  const scanner = readFileSync(
    fileURLToPath(new URL('../JS/Features/Scanner/StandaloneScanner.js', import.meta.url)), 'utf8',
  );
  const line = scanner.match(/photosCached:[^\n]*/)?.[0] || '';
  assert.ok(/Boolean\(r\.photo_thumb_b64\)/.test(line),
    'must count truthy thumbnails');
  assert.ok(!/!==\s*undefined/.test(line),
    'an explicit null is "no photo", not "cached"');
});

// The failure that looks like nothing is wrong.
test('audio that was never unlocked is a warning, never good', () => {
  const rows = healthRows({
    online: true, queued: 0, cacheRows: 1, cacheSyncedAt: 'x', cacheAgeMs: 0,
    photosCached: 1, audioUnlocked: false, soundsLoaded: true, scannerId: 'k',
  });
  const audio = rows.find((r) => r.key === 'audio');
  assert.equal(audio.state, HEALTH.WARN);
  assert.match(audio.value, /tap/);
  assert.equal(overallHealth(rows), HEALTH.WARN);
});

test('a kiosk that never synced is bad, not merely stale', () => {
  const rows = healthRows({ online: true, queued: 0, cacheSyncedAt: null, scannerId: 'k' });
  const cache = rows.find((r) => r.key === 'cache');
  assert.equal(cache.state, HEALTH.BAD);
  assert.equal(cache.value, 'never synced');
  assert.equal(overallHealth(rows), HEALTH.BAD);
});

test('a stale cache warns but does not read as broken', () => {
  const rows = healthRows({
    online: true, queued: 0, cacheRows: 10, cacheSyncedAt: 'x',
    cacheAgeMs: CACHE_STALE_AFTER_MS + 1, photosCached: 10,
    audioUnlocked: true, soundsLoaded: true, scannerId: 'k',
  });
  assert.equal(rows.find((r) => r.key === 'cache').state, HEALTH.WARN);
});

// navigator.onLine said "online" while scans were queueing beside it; the
// last request's real outcome is what decides this.
test('reachable-but-failing is distinguished from offline', () => {
  const offline = healthRows({ online: false, queued: 3 });
  assert.equal(offline.find((r) => r.key === 'connection').value, 'offline');
  assert.equal(offline.find((r) => r.key === 'connection').state, HEALTH.BAD);

  const failing = healthRows({ online: true, lastRequestFailed: true, queued: 3 });
  assert.equal(failing.find((r) => r.key === 'connection').value, 'unreachable');
  assert.equal(failing.find((r) => r.key === 'connection').state, HEALTH.WARN);
});

// A queue is the offline design working, not a fault.
test('queued scans warn rather than erroring', () => {
  const rows = healthRows({ online: true, queued: 5, cacheSyncedAt: 'x', cacheAgeMs: 0, scannerId: 'k' });
  assert.equal(rows.find((r) => r.key === 'queue').state, HEALTH.WARN);
  assert.equal(rows.find((r) => r.key === 'queue').value, '5');
});

// The drawer costs no request, so it never looks up the site — and must not
// print "no site set", which is a claim it has not earned.
test('an unchecked site is not reported as unset', () => {
  const unchecked = healthRows({ scannerId: 'Krus4K' }).find((r) => r.key === 'identity');
  assert.equal(unchecked.value, 'Krus4K');
  assert.doesNotMatch(unchecked.value, /no site/);
  assert.equal(unchecked.state, HEALTH.GOOD);

  const known = healthRows({ scannerId: 'Krus4K', site: null }).find((r) => r.key === 'identity');
  assert.equal(known.value, 'Krus4K · no site set');
  assert.equal(known.state, HEALTH.WARN);

  const set = healthRows({ scannerId: 'Krus4K', site: 'Krus' }).find((r) => r.key === 'identity');
  assert.equal(set.value, 'Krus4K · Krus');
  assert.equal(set.state, HEALTH.GOOD);
});

test('missing input degrades to unknown rather than throwing', () => {
  const rows = healthRows();
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.label && r.value));
  assert.equal(healthRows({}).length, 6);
  assert.equal(overallHealth(null), HEALTH.UNKNOWN);
});

test('cache age reads in the largest sensible unit', () => {
  assert.equal(fmtAge(0), 'just synced');
  assert.equal(fmtAge(45 * 1000), 'just synced');
  assert.equal(fmtAge(5 * 60 * 1000), '5m old');
  assert.equal(fmtAge(3 * 3600 * 1000), '3h old');
  assert.equal(fmtAge(72 * 3600 * 1000), '3d old');
  assert.equal(fmtAge(null), 'age unknown');
  assert.equal(fmtAge(-1), 'age unknown');
  assert.equal(fmtAge(Infinity), 'age unknown');
});

// ---- source invariants ----

const src = (p) => readFileSync(fileURLToPath(new URL(`../JS/${p}`, import.meta.url)), 'utf8');

// The whole premise of both Test Scan features is that they cost less, not
// more. A fetch or an .rpc( in the diagnostics path would quietly undo that.
test('reader diagnostics never reach the network', () => {
  const body = src('Utils/readerDiagnostics.js');
  assert.ok(!/\bfetch\(|\.rpc\(|supabase/.test(body),
    'diagnostics must be pure browser code');
});

test('the commissioning helpers never reach the network', () => {
  const body = src('Utils/commissioning.js');
  assert.ok(!/\bfetch\(|\.rpc\(|supabase/.test(body));
});

test('the health drawer never reaches the network', () => {
  const body = src('Utils/scannerHealth.js');
  assert.ok(!/\bfetch\(|\.rpc\(|supabase/.test(body));
});

// Commissioning syncs at most once, and only when nothing is cached. A sync
// per scan would make the mode cost MORE than the server path it replaces.
test('commissioning mode syncs the cache at most once', () => {
  const page = src('Features/Scanner/TestScanPage.js');
  const refreshes = page.match(/OfflineScanModel\.refreshCache\(/g) || [];
  assert.equal(refreshes.length, 1, 'exactly one sync call site');
  const ensure = page.slice(page.indexOf('async function ensureCache'));
  assert.ok(ensure.indexOf('if (meta?.rows?.length)') < ensure.indexOf('refreshCache'),
    'an existing cache must short-circuit before any sync');
});

// THE REGRESSION THIS EXISTS FOR. The first version of the health panel
// toggled on click, and clicking a button focuses it — which is exactly what
// canReclaimFocus() refuses to recover from, since activeElement was then
// neither the input nor the body. The focus watchdog correctly reported
// "Scanner not listening" and the reader stopped working until the operator
// clicked the box again. A diagnostic must not break what it diagnoses.
test('opening the health panel cannot steal focus from the scan input', () => {
  const scanner = src('Features/Scanner/StandaloneScanner.js');
  const fn = scanner.slice(scanner.indexOf('function wireHealthPanel'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));

  assert.ok(/addEventListener\('pointerdown'/.test(body),
    'the button must intercept pointerdown');
  assert.ok(/pointerdown[\s\S]{0,120}preventDefault\(\)/.test(body),
    'pointerdown must preventDefault, or the browser focuses the button');
  assert.ok(/reclaimFocus\(/.test(body),
    'the scan input must be handed back after any interaction');
});

test('the health panel opens on hover, not only on click', () => {
  const scanner = src('Features/Scanner/StandaloneScanner.js');
  const fn = scanner.slice(scanner.indexOf('function wireHealthPanel'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.ok(/addEventListener\('mouseenter'/.test(body), 'needs hover-to-open');
  assert.ok(/addEventListener\('mouseleave'/.test(body), 'needs hover-to-close');
  // A phone has no hover at all, so click must remain a way in.
  assert.ok(/addEventListener\('click'/.test(body), 'touch devices need click as well');
});

// Opening a panel that reflows the page moves the scan box under the
// operator's hands. It is anchored to its button instead.
test('the health panel is anchored, not placed in the header flow', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../CSS/scanner.css', import.meta.url)), 'utf8',
  );
  const block = css.slice(css.indexOf('.ss-health-wrap'));
  assert.ok(/\.ss-health-wrap\{[^}]*position:relative/.test(block),
    'the wrapper must establish a positioning context');
  assert.ok(/\.ss-health\{[^}]*position:absolute/.test(block),
    'the panel must be out of flow so opening it shifts nothing');
});

// A z-index on the dropdown itself cannot fix this, which is what made it
// confusing: the panel lives INSIDE .ss-header's stacking context, so its 40
// only ever competed with the header's own children. .ss-header and
// .ss-layout were both at 1, and .ss-layout comes later in the DOM, so the
// Recent activity panel painted over the health values.
test('the header outranks the layout, so its dropdown can be seen', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../CSS/scanner.css', import.meta.url)), 'utf8',
  );
  const zOf = (selector) => {
    const m = css.match(new RegExp(`\\${selector}\\{[^}]*z-index:(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const header = zOf('.ss-header');
  const layout = zOf('.ss-layout');
  assert.ok(header !== null && layout !== null, 'both need an explicit z-index');
  assert.ok(header > layout,
    `.ss-header (${header}) must stack above .ss-layout (${layout}), or anything `
    + 'hanging off the header is painted over by the feed panel');
});

test('the health panel keeps an opaque fallback behind its translucent one', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../CSS/scanner.css', import.meta.url)), 'utf8',
  );
  const block = css.slice(css.indexOf('.ss-health{'), css.indexOf('.ss-health[hidden]'));
  assert.ok(/background:var\(--surface\);/.test(block),
    'an opaque declaration must come first as the floor');
  assert.ok(/background:color-mix\(/.test(block),
    'the translucent declaration must follow it');
  assert.ok(block.indexOf('background:var(--surface);') < block.indexOf('background:color-mix('),
    'the fallback must come BEFORE the enhancement or it overrides it');
});

test('the cached path uses the same classifier the live kiosk uses offline', () => {
  const page = src('Features/Scanner/TestScanPage.js');
  assert.ok(page.includes('classifyCachedScan('),
    'rehearsing the offline path means using its own classifier, not a lookalike');
});

// ---- commissioning is the default (2026-11-06) ----
//
// Reported from testing: the mode had to be ticked by hand, so the expensive
// path ran whenever nobody remembered. The server path is one request AND one
// log event per scan, and almost every card tried here is already cached, so
// the old default paid per card to re-fetch what the browser already had.

test('commissioning mode is on without anyone ticking it', () => {
  const page = src('Features/Scanner/TestScanPage.js');
  assert.ok(/^let commissioning = true;$/m.test(page),
    'the cheap path must be the one you land on, not the one you opt into');
});

test('the toggle shows the state it is actually in', () => {
  const page = src('Features/Scanner/TestScanPage.js');
  const input = page.match(/<input type="checkbox" id="ts-commission"[^>]*>/)[0];
  assert.ok(/\$\{commissioning \? 'checked' : ''\}/.test(input),
    'a hardcoded attribute desyncs from the module-scope variable, which '
    + 'survives navigating away and back');
});

// The hazard the default introduces, and the reason this is the longest guard
// in the file. classifyCachedScan() against an empty roster returns
// "unmatched" — indistinguishable from "this browser never synced". Before
// the flip you only got here by ticking a box; now a good card could be
// reported bad on a browser that has no cache.
test('an empty roster is never classified as a card result', () => {
  const page = src('Features/Scanner/TestScanPage.js');
  const fn = page.slice(page.indexOf('async function scanFromCache'),
    page.indexOf('async function verifyOnServer'));
  const guard = fn.indexOf('if (!cacheRows.length)');
  // The CALL, not a mention: the guard's own comment explains itself by
  // naming classifyCachedScan(), and matching the bare name finds the comment
  // first and passes for the wrong reason. Same false positive the
  // migration-convention tests hit on 2026-11-06.
  const classify = fn.indexOf('const data = classifyCachedScan(');
  assert.ok(guard !== -1, 'the cached path must check it has a roster at all');
  assert.ok(guard < classify,
    'the empty-roster guard must come BEFORE the classifier, or a good card '
    + 'reads as unmatched on a browser that has simply never synced');
});

test('a browser that cannot sync is told so, not fed a verdict', () => {
  const page = src('Features/Scanner/TestScanPage.js');
  const fn = page.slice(page.indexOf('async function scanFromCache'),
    page.indexOf('async function verifyOnServer'));
  assert.ok(/No cached cards/.test(fn), 'the dead end must be named on screen');
  assert.ok(fn.indexOf('ts-cache-fallback') < fn.indexOf('const data = classifyCachedScan('),
    'and must offer the single server check as a button — opted into, not '
    + 'spent automatically');
});

// The flag, not just the call. Retrying the roster on every scan would make
// the default cost MORE than the server path it replaces, which is the one
// thing it must never do.
test('a failed sync is attempted once per visit, not once per scan', () => {
  const page = src('Features/Scanner/TestScanPage.js');
  assert.ok(/let cacheSyncAttempted = false;/.test(page), 'the guard must exist');
  const fn = page.slice(page.indexOf('async function scanFromCache'),
    page.indexOf('async function verifyOnServer'));
  assert.ok(/if \(!cacheRows\.length && !cacheSyncAttempted\)/.test(fn),
    'the sync must be gated on the flag as well as on the roster being empty');
  assert.ok(fn.indexOf('cacheSyncAttempted = true;') < fn.indexOf('await ensureCache()'),
    'set before awaiting, or two scans in flight both trigger a sync');
  assert.ok(/cacheSyncAttempted = false;/.test(page.slice(page.indexOf('export async function renderTestScan'))),
    'a fresh visit is a fair retry — the network may have come back');
});

test('the page no longer promises a live lookup it does not do by default', () => {
  const router = readFileSync(
    fileURLToPath(new URL('../JS/Core/router.js', import.meta.url)), 'utf8',
  );
  const line = router.split('\n').find((l) => l.trim().startsWith('scanner:'));
  assert.ok(!/live directory/.test(line),
    'the default answer comes from the offline cache, so the subtitle must '
    + 'not claim the live directory');
});
