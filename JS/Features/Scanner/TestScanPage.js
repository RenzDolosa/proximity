// In-shell "Test Scan" page. Same lookup logic and result UI as the real,
// door-facing standalone scanner, but calls test_scan_proximity_code()
// instead of scan_proximity_code() — nothing is written to scan_events, so
// a test scan never shows up in Recent Activity, an employee's scan_logs,
// or Employee Manager's "Scans" count. Use the "Open live scanner ↗" link
// to launch the real, logging scanner for a reader station.
import { $ } from '../../Utils/dom.js';
import { esc } from '../../Utils/format.js';
import { ScanEventsModel } from '../../Models/ScanEventsModel.js';
import { renderScanResult } from '../../Components/ScanResultCard.js';

export async function renderTestScan() {
  const content = $('#content');
  content.innerHTML = `
    <div class="test-scan-wrap">
      <div class="panel test-scan-panel">
        <div class="test-scan-note">Results here are not logged — nothing is written to Recent Activity, scan history, or Employee Manager.</div>
        <div class="ts-topbar">
          <input id="ts-code" type="password" class="mono" placeholder="Live Search — scan or type code…" autocomplete="off" autofocus />
        </div>
        <div class="ts-hero">
          <div class="ts-ring"><div class="ts-icon">▣</div></div>
          <div class="ts-label"><span class="dim">TAP</span><br/>YOUR CARD</div>
        </div>
        <div class="ts-result-wrap" id="ts-result"></div>
      </div>
      <div style="text-align:center;margin-top:18px;">
        <a href="#" id="ts-open-live" class="emp-meta">Open live scanner (logs to Recent Activity) ↗</a>
      </div>
    </div>
  `;
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
  let autoSubmitTimer = null;
  let scanBusy = false;
  const doScan = async () => {
    if (scanBusy) return; // a scan is already in flight — the debounce timer below can otherwise double-fire while awaiting the previous one
    const proximity_code = codeInput.value.trim();
    if (!proximity_code) return;
    scanBusy = true;
    clearTimeout(autoSubmitTimer);
    const { data, error } = await ScanEventsModel.testScan(proximity_code);
    const resultWrap = $('#ts-result');
    if (error) {
      resultWrap.innerHTML = `<div class="result-card unmatched"><strong style="color:var(--bad)">Scan failed</strong><div class="emp-meta">${esc(error.message)}</div></div>`;
    } else {
      resultWrap.innerHTML = renderScanResult(data);
    }
    codeInput.value = '';
    codeInput.focus();
    scanBusy = false;
  };
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });
  // See StandaloneScanner.js — most badge readers just "type" the code
  // with no trailing Enter, so auto-submit a short pause after the last
  // keystroke instead of waiting on one. Manual Enter above still submits
  // instantly.
  const AUTO_SUBMIT_DELAY_MS = 300;
  codeInput.addEventListener('input', () => {
    clearTimeout(autoSubmitTimer);
    if (!codeInput.value.trim()) return;
    autoSubmitTimer = setTimeout(doScan, AUTO_SUBMIT_DELAY_MS);
  });
  $('#ts-open-live').addEventListener('click', (e) => {
    e.preventDefault();
    window.open(location.pathname + '?scanner=1', '_blank', 'noopener');
  });
}
