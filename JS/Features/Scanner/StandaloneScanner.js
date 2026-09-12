import { $ } from '../../Utils/dom.js';
import { esc } from '../../Utils/format.js';
import { supabase } from '../../Core/supabaseClient.js';
import { appState, canViewScanner } from '../../Core/state.js';
import { ScanEventsModel } from '../../Models/ScanEventsModel.js';
import { renderScanResult } from '../../Components/ScanResultCard.js';
import { loadScanFeed } from '../../Components/ScanFeed.js';

export function showStandaloneScanner() {
  $('#auth-screen').classList.add('hidden');
  $('#shell').classList.add('hidden');
  const wrap = $('#standalone-scanner');
  wrap.classList.remove('hidden');
  if (!canViewScanner()) {
    wrap.innerHTML = `
      <div class="empty-state" style="margin:80px auto;max-width:420px;"><strong>No scanner access</strong>Your account doesn't have permission to use the scanner.</div>
      <div style="text-align:center;margin-top:16px;"><button class="ghost" id="ss-noaccess-signout">Sign out</button></div>
    `;
    $('#ss-noaccess-signout').addEventListener('click', async () => { await supabase.auth.signOut(); });
    return;
  }
  renderStandaloneScanner();
}

function renderStandaloneScanner() {
  const wrap = $('#standalone-scanner');
  const operatorName = appState.profile?.full_name || appState.session.user.email;
  wrap.innerHTML = `
    <div class="ss-header">
      <div class="ss-operator">Operator: <strong class="mono">${esc(operatorName)}</strong></div>
      <button class="ghost" id="ss-signout">Sign out</button>
    </div>
    <div class="ss-layout">
      <div class="ss-main">
        <div class="ss-topbar">
          <input id="ss-code" type="password" class="mono" placeholder="Live Search — scan or type code…" autocomplete="off" autofocus />
        </div>
        <div class="ss-hero">
          <div class="ss-ring"><div class="ss-icon">▣</div></div>
          <div class="ss-label"><span class="dim">TAP</span><br/>YOUR CARD</div>
        </div>
        <div class="ss-result-wrap" id="ss-result"></div>
      </div>
      <div class="ss-feed-col">
        <div class="panel ss-feed-panel">
          <div class="ss-feed-title">Recent activity</div>
          <div id="ss-feed">Loading…</div>
        </div>
      </div>
    </div>
  `;
  $('#ss-signout').addEventListener('click', async () => { await supabase.auth.signOut(); });
  const codeInput = $('#ss-code');
  // The HTML `autofocus` attribute isn't reliably honored when markup is
  // inserted via innerHTML (as opposed to during initial page parsing) —
  // that's the "autofocus not working" bug. Focusing it explicitly here
  // is deterministic. This is a kiosk input a badge reader "types" into,
  // so it also refocuses itself if focus ever lands on the page background
  // (e.g. a stray click) — but not if the operator deliberately focused
  // something else, like the Sign out button.
  codeInput.focus();
  codeInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement === document.body) codeInput.focus();
    }, 50);
  });
  const resultWrap = $('#ss-result');
  let fadeTimer = null;
  let clearTimer = null;
  let autoSubmitTimer = null;
  let scanBusy = false;
  const RESULT_LIFETIME_MS = 10000;
  const FADE_DURATION_MS = 400;
  const scheduleResultFade = () => {
    clearTimeout(fadeTimer);
    clearTimeout(clearTimer);
    fadeTimer = setTimeout(() => {
      resultWrap.classList.add('fade-out');
      clearTimer = setTimeout(() => {
        resultWrap.innerHTML = '';
        resultWrap.classList.remove('fade-out');
      }, FADE_DURATION_MS);
    }, RESULT_LIFETIME_MS);
  };
  const doScan = async () => {
    if (scanBusy) return; // a scan is already in flight — the debounce timer below can otherwise double-fire while awaiting the previous one
    const proximity_code = codeInput.value.trim();
    if (!proximity_code) return;
    scanBusy = true;
    clearTimeout(autoSubmitTimer);
    // Lock the input the instant a scan starts, before the network
    // round-trip — a tap that lands mid-request would otherwise append
    // onto whatever's left in the field (or onto nothing, invisibly, if
    // it's already been cleared) instead of being read as its own scan.
    codeInput.disabled = true;
    const { data, error } = await ScanEventsModel.scan(proximity_code, operatorName);
    clearTimeout(fadeTimer);
    clearTimeout(clearTimer);
    resultWrap.classList.remove('fade-out');
    if (error) {
      resultWrap.innerHTML = `<div class="result-card unmatched"><strong style="color:var(--bad)">Scan failed</strong><div class="emp-meta">${esc(error.message)}</div></div>`;
    } else {
      resultWrap.innerHTML = renderScanResult(data);
    }
    scheduleResultFade();
    codeInput.value = '';
    codeInput.disabled = false;
    codeInput.focus();
    scanBusy = false;
    // Only this operator's own scans, per kiosk — see get_scan_feed's
    // p_scanner_id filter.
    loadScanFeed('ss-feed', 10, operatorName);
  };
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });
  // Most badge readers act as a keyboard wedge that just "types" the code
  // character-by-character with no trailing Enter — so waiting for a
  // keydown Enter alone leaves the code just sitting in the field after a
  // tap. Instead, auto-submit a short pause after the last keystroke: a
  // reader's burst of characters arrives in a few milliseconds, so a
  // 300ms gap with no further typing means the read is done. Manual Enter
  // (above) still submits instantly without waiting for that pause.
  const AUTO_SUBMIT_DELAY_MS = 300;
  codeInput.addEventListener('input', () => {
    clearTimeout(autoSubmitTimer);
    if (!codeInput.value.trim()) return;
    autoSubmitTimer = setTimeout(doScan, AUTO_SUBMIT_DELAY_MS);
  });
  loadScanFeed('ss-feed', 10, operatorName);
}
