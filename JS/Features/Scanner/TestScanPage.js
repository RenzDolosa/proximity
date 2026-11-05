// In-shell "Test Scan" page. Same lookup logic and result UI as the real,
// door-facing standalone scanner, but nothing is written to scan_events — a
// test scan never shows up in Recent Activity, an employee's scan_logs, or
// Employee Manager's "Scans" count. Use the "Open live scanner ↗" link to
// launch the real, logging scanner for a reader station.
//
// TWO THINGS BEYOND A BARE TEST SCAN, both added 2026-11-06:
//
// 1. READER DIAGNOSTICS. Two migrations here are about readers sending the
//    wrong thing (20261008000000's truncations, 20261008140000's stuck keys),
//    and both ship alerts — but nothing told the person standing at the reader
//    what it actually transmitted. The keystrokes are already arriving in this
//    browser; Utils/readerDiagnostics.js just reads them. No request.
//
// 2. COMMISSIONING MODE. Every test scan is otherwise its own
//    test_scan_proximity_code_compact request, so checking a stack of 50 cards
//    costs 50 requests and 50 log events. Resolving from the offline cache
//    instead costs one sync and then nothing — and it is the only way to
//    rehearse the offline path before trusting it at a door.
import { $, $$ } from '../../Utils/dom.js';
import { esc } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { ScanEventsModel } from '../../Models/ScanEventsModel.js';
import { OfflineScanModel } from '../../Models/OfflineScanModel.js';
import { classifyCachedScan, readRejection } from '../../Core/offlineScanning.js';
import { renderScanResult } from '../../Components/ScanResultCard.js';
import { PROXIMITY_LOGO_SVG } from '../../Components/ProximityLogo.js';
import { loadScanSounds, playScanSound, initAudioUnlock } from '../../Utils/scanSounds.js';
import { diagnoseRead, readHeadline } from '../../Utils/readerDiagnostics.js';
import {
  SOURCE, toBatchRow, batchTotals, addToBatch, inconsistentCodes,
  BATCH_CSV_COLUMNS, toCsvRow,
} from '../../Utils/commissioning.js';
import { exportXlsx, todayStamp } from '../../Utils/xlsxExport.js';
import { reportError } from '../../Utils/userError.js';

const POST_SCAN_COOLDOWN_MS = 1000; // see StandaloneScanner.js
// See StandaloneScanner.js — most badge readers just "type" the code with no
// trailing Enter, so auto-submit after a pause once typing stops. Manual
// Enter still submits instantly.
const AUTO_SUBMIT_DELAY_MS = 200;

// Commissioning resolves locally, so the only thing a cooldown protects
// against is the operator's own double-tap. A stack of cards goes much faster
// than once a second.
const CACHE_SCAN_COOLDOWN_MS = 250;

let commissioning = false;
let cacheRows = [];
let cacheMeta = null;
let batch = [];

export async function renderTestScan() {
  const content = $('#content');
  content.innerHTML = `
    <div class="test-scan-wrap">
      <div class="panel test-scan-panel">
        <div class="test-scan-note">Results here are not logged — nothing is written to Recent Activity, scan history, or Employee Manager.</div>
        <div class="ts-topbar">
          <!-- Same type="text" + .masked-code-input fix as StandaloneScanner.js
               — see its comment for why this replaced type="password". -->
          <input id="ts-code" type="text" class="mono masked-code-input" placeholder="Live Search — scan or type code…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore autofocus />
        </div>
        <div class="ts-mode">
          <label class="ts-mode-toggle">
            <input type="checkbox" id="ts-commission" />
            <span>Commissioning mode</span>
          </label>
          <span class="emp-meta" id="ts-mode-note"></span>
        </div>
        <div class="ts-hero">
          <div class="ts-ring"><div class="ts-icon">${PROXIMITY_LOGO_SVG}</div></div>
        </div>
        <div class="ts-result-wrap" id="ts-result"></div>
        <div id="ts-diag"></div>
        <div id="ts-batch"></div>
      </div>
      <div style="text-align:center;margin-top:18px;">
        <a href="#" id="ts-open-live" class="emp-meta">Open live scanner (logs to Recent Activity) ↗</a>
      </div>
    </div>
  `;
  // Loaded once per page visit, not per-scan — see Utils/scanSounds.js.
  loadScanSounds().catch(() => {});
  initAudioUnlock();

  // Read whatever is already in IndexedDB — an existing cache, never a sync.
  // This costs no request and makes the diagnostics useful in BOTH modes:
  // without it, "8 characters (cards are 10)" would only ever appear in
  // commissioning mode, which is the mode you are least likely to be in when
  // a reader starts misbehaving.
  OfflineScanModel.getCacheMeta()
    .then((meta) => {
      cacheRows = meta?.rows || [];
      cacheMeta = meta || null;
      paintModeNote();
    })
    .catch(() => {});

  paintModeNote();
  paintBatch();

  const codeInput = $('#ts-code');
  // See StandaloneScanner.js — autofocus via the HTML attribute isn't
  // reliable when the markup is inserted through innerHTML, so it's set
  // explicitly here too. Same reasoning for the blur/refocus safety net:
  // this is a kiosk-style input a badge reader "types" into, so it should
  // stay ready for the next scan without the operator needing to click
  // back into it — mirrors StandaloneScanner.js so Test Scan behaves the
  // same way testers will see at the real door.
  codeInput.focus();
  codeInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement === document.body) codeInput.focus();
    }, 50);
  });

  // ---- keystroke capture (reader diagnostics) ----
  //
  // Recorded on keydown rather than `input`, because `input` cannot see a
  // terminator: a reader that sends Enter produces no input event for it, and
  // "did the reader send Enter" is one of the things worth knowing. Reset
  // whenever the field is empty, so the buffer always describes one read.
  let keystrokes = [];
  codeInput.addEventListener('keydown', (e) => {
    if (!codeInput.value) keystrokes = [];
    keystrokes.push({ key: e.key, at: performance.now() });
  });

  let autoSubmitTimer = null;
  let scanBusy = false;

  const doScan = async () => {
    if (scanBusy) return; // a scan is already in flight — the debounce timer below can otherwise double-fire while awaiting the previous one
    const proximity_code = codeInput.value.trim();
    if (!proximity_code) return;
    scanBusy = true;
    clearTimeout(autoSubmitTimer);
    // Lock the input the instant a scan starts — see StandaloneScanner.js.
    codeInput.disabled = true;

    // Captured before the field is cleared, and before any await: the
    // diagnosis describes THIS read, and a reader can start the next one
    // while a server round-trip is still in flight.
    const diag = diagnoseRead({ code: proximity_code, keystrokes, rows: cacheRows });
    keystrokes = [];

    await (commissioning ? scanFromCache(proximity_code, diag) : scanOnServer(proximity_code));
    paintDiagnostics(diag);

    codeInput.value = '';
    // Post-submit cooldown — see StandaloneScanner.js for why this is
    // separate from the input being disabled during the request itself.
    setTimeout(() => {
      codeInput.disabled = false;
      codeInput.focus();
      scanBusy = false;
    }, commissioning ? CACHE_SCAN_COOLDOWN_MS : POST_SCAN_COOLDOWN_MS);
  };

  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });
  codeInput.addEventListener('input', () => {
    clearTimeout(autoSubmitTimer);
    if (!codeInput.value.trim()) return;
    autoSubmitTimer = setTimeout(doScan, AUTO_SUBMIT_DELAY_MS);
  });

  $('#ts-commission').addEventListener('change', async (e) => {
    commissioning = e.target.checked;
    paintModeNote();
    paintBatch();
    if (commissioning) await ensureCache();
    codeInput.focus();
  });

  $('#ts-open-live').addEventListener('click', (e) => {
    e.preventDefault();
    window.open(location.pathname + '?scanner=1', '_blank', 'noopener');
  });
}

// ---- the two resolution paths ----

async function scanOnServer(proximityCode) {
  const { data, error } = await ScanEventsModel.testScan(proximityCode);
  const resultWrap = $('#ts-result');
  if (!resultWrap) return;
  if (error) {
    resultWrap.innerHTML = `<div class="result-card unmatched"><strong style="color:var(--bad)">Scan failed</strong><div class="emp-meta">${esc(reportError(error, 'testScan'))}</div></div>`;
    return;
  }
  resultWrap.innerHTML = renderScanResult(data);
  playScanSound(data);
}

// Resolved entirely from IndexedDB. No request, and deliberately the SAME
// classifier the live kiosk uses offline, so this rehearses the real offline
// path rather than a lookalike.
async function scanFromCache(proximityCode, diag) {
  const resultWrap = $('#ts-result');

  // A read the kiosk would never send is a READER fault, not a card result,
  // and it is recorded as such — otherwise one loose cable marks a whole
  // stack of good cards bad.
  const rejection = readRejection(proximityCode, cacheRows);
  if (rejection) {
    if (resultWrap) {
      resultWrap.innerHTML = `<div class="result-card unmatched"><strong style="color:var(--warn)">${esc(diag.rejectionLabel || 'Unusable read')}</strong>
        <div class="emp-meta mono">${esc(proximityCode)}</div></div>`;
    }
    batch = addToBatch(batch, toBatchRow({ code: proximityCode, rejection, source: SOURCE.CACHE }));
    paintBatch();
    return;
  }

  const data = classifyCachedScan(proximityCode, cacheRows);
  if (resultWrap) resultWrap.innerHTML = renderScanResult(data);
  playScanSound(data);
  batch = addToBatch(batch, toBatchRow({
    code: proximityCode, result: data.result, employee: data.employee, source: SOURCE.CACHE,
  }));
  paintBatch();
}

// One card, checked against the server, from inside a commissioning run. The
// escape hatch for the mode's central limitation: a cache answers from the
// roster as it was at the last sync, so a card revoked since then still reads
// as valid here.
async function verifyOnServer(code) {
  const { data, error } = await ScanEventsModel.testScan(code);
  if (error) { toast(reportError(error, 'testScan'), 'error'); return; }
  batch = addToBatch(batch, toBatchRow({
    code, result: data?.result, employee: data?.employee, source: SOURCE.SERVER,
  }));
  paintBatch();
  toast(`${code} checked against the server.`);
}

// ---- cache ----

async function ensureCache() {
  const note = $('#ts-mode-note');
  if (note) note.textContent = 'Loading cached cards…';
  const meta = await OfflineScanModel.getCacheMeta().catch(() => null);
  if (meta?.rows?.length) {
    cacheRows = meta.rows;
    cacheMeta = meta;
    paintModeNote();
    return;
  }
  // The one request this mode makes, and only when there is nothing cached.
  // After it, a stack of any size costs nothing.
  const { error } = await OfflineScanModel.refreshCache();
  if (error) {
    cacheRows = [];
    if (note) note.textContent = "Couldn't load cached cards — commissioning needs them.";
    toast(reportError(error, 'testScan.cache', "Couldn't load the offline card cache."), 'error');
    return;
  }
  const fresh = await OfflineScanModel.getCacheMeta().catch(() => null);
  cacheRows = fresh?.rows || [];
  cacheMeta = fresh;
  paintModeNote();
}

// ---- painting ----

function paintModeNote() {
  const note = $('#ts-mode-note');
  if (!note) return;
  if (!commissioning) {
    note.textContent = 'Each scan is one request, checked against the server.';
    return;
  }
  // The age is stated, not just the count. A cache answers from the roster as
  // it was at the last sync, so how old it is IS the caveat — a reader of
  // "727 cached cards" with no age would reasonably assume it was current.
  const age = cacheMeta?.syncedAt ? fmtCacheAge(cacheMeta.ageMs) : null;
  note.innerHTML = cacheRows.length
    ? `Resolved from ${cacheRows.length.toLocaleString()} cached cards${age ? `, synced ${esc(age)}` : ''} — no requests. <strong>Cached data can be stale</strong>; use Verify on anything surprising.`
    : 'No cached cards yet.';
}

// Phrased as a point in time ("synced 2h ago") where Utils/scannerHealth.js's
// fmtAge phrases the same number as a property ("727 cards · 2h old"). Not
// shared, because each reads correctly only in its own sentence — and not
// worth coupling this page to a module about the other scanner to save six
// lines.
function fmtCacheAge(ms) {
  // Null before coercion: Number(null) is 0, which would render a missing age
  // as "just now" — see the same guard in Utils/scannerHealth.js#fmtAge.
  if (ms === null || ms === undefined || ms === '') return 'age unknown';
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return 'age unknown';
  const minutes = Math.floor(value / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function paintDiagnostics(diag) {
  const wrap = $('#ts-diag');
  if (!wrap || !diag) return;
  const t = diag.timing;
  const row = (label, value, tone) =>
    `<div class="ts-diag-row"><span>${esc(label)}</span><span class="mono${tone ? ` ${tone}` : ''}">${value}</span></div>`;

  const lengthTone = diag.expectedLength && diag.length !== diag.expectedLength ? 'punct-warn' : '';
  const lengthNote = diag.expectedLength && diag.length !== diag.expectedLength
    ? ` <span class="sub">(cards are ${diag.expectedLength})</span>` : '';

  wrap.innerHTML = `
    <details class="ts-diag" ${diag.rejection || diag.truncatedOf ? 'open' : ''}>
      <summary>
        <span>What the reader sent</span>
        <span class="emp-meta">${esc(readHeadline(diag))}</span>
      </summary>
      <div class="ts-diag-body">
        ${row('Characters', `${diag.length}${lengthNote}`, lengthTone)}
        ${row('Character set', diag.allDigits ? 'digits only'
            : (diag.numericOnly === true ? '<span class="punct-warn">contains non-digits</span>' : 'mixed'))}
        ${row('Keystroke gap', t.medianGapMs === null ? '—'
            : `${t.minGapMs}–${t.maxGapMs} ms (median ${t.medianGapMs})`,
            t.looksTyped ? 'punct-warn' : '')}
        ${row('Terminator', t.sawEnter ? 'Enter sent' : 'none — auto-submitted')}
        ${t.looksTyped ? `<div class="emp-meta" style="margin-top:6px;">Typed by hand, or a very slow reader — gaps over ${/* HUMAN_TYPING_GAP_MS */80}ms are unusual for a wedge reader.</div>` : ''}
        ${diag.truncatedOf ? `<div class="ts-diag-finding">
            This is the tail of card <span class="mono">${esc(diag.truncatedOf)}</span> — the reader dropped
            ${diag.truncatedOf.length - diag.length} leading character${diag.truncatedOf.length - diag.length === 1 ? '' : 's'}.
            That is the <span class="mono">truncated_card_read</span> alert's cause.
          </div>` : ''}
        ${!diag.rosterKnown ? `<div class="emp-meta" style="margin-top:6px;">No cached cards, so length and character set could not be checked against real cards.</div>` : ''}
      </div>
    </details>`;
}

function paintBatch() {
  const wrap = $('#ts-batch');
  if (!wrap) return;
  if (!commissioning || !batch.length) { wrap.innerHTML = ''; return; }

  const totals = batchTotals(batch);
  const flaky = inconsistentCodes(batch);
  const TONE = { pass: 'matched', fail: 'inactive_card', reader: 'unassigned_card' };

  wrap.innerHTML = `
    <div class="ts-batch">
      <div class="ts-batch-head">
        <strong>${totals.total.toLocaleString()} scanned</strong>
        <span class="emp-meta">${totals.passed} passed · ${totals.failed} failed · ${totals.readerFaults} reader fault${totals.readerFaults === 1 ? '' : 's'}</span>
        <span style="margin-left:auto;display:flex;gap:8px;">
          <button type="button" class="ghost" id="ts-batch-export">Export</button>
          <button type="button" class="ghost" id="ts-batch-clear">Clear</button>
        </span>
      </div>
      ${flaky.length ? `<div class="ts-diag-finding" style="margin:0 0 8px;">
          Read inconsistently: <span class="mono">${flaky.map(esc).join(', ')}</span>.
          A card that passes most of the time is a failing reader, not a passing card.
        </div>` : ''}
      <ul class="ts-batch-list">
        ${batch.slice(0, 50).map((r) => `
          <li>
            <span class="mono">${esc(r.code)}</span>
            <span class="badge ${TONE[r.outcome] || 'unassigned_card'}">${esc(r.result)}</span>
            <span class="emp-meta">${esc(r.name || '')}</span>
            ${r.source === SOURCE.SERVER ? '<span class="emp-meta">server</span>' : ''}
            <button type="button" class="ghost ts-verify" data-code="${esc(r.code)}">Verify</button>
          </li>`).join('')}
      </ul>
      ${batch.length > 50 ? `<div class="emp-meta">Showing the last 50 of ${batch.length}. Export includes all.</div>` : ''}
    </div>`;

  $('#ts-batch-export').addEventListener('click', exportBatch);
  $('#ts-batch-clear').addEventListener('click', () => { batch = []; paintBatch(); });
  $$('.ts-verify', wrap).forEach((btn) => {
    btn.addEventListener('click', () => verifyOnServer(btn.dataset.code));
  });
}

function exportBatch() {
  if (!batch.length) return;
  try {
    exportXlsx({
      filename: `commissioning-${todayStamp()}.xlsx`,
      sheetName: 'Commissioning',
      columns: BATCH_CSV_COLUMNS.map((key) => ({ key, label: key })),
      // Oldest first in the file: a commissioning run reads as a sequence,
      // even though the on-screen list is newest-first for the operator.
      rows: [...batch].reverse().map(toCsvRow),
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}
