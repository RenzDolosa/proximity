import { $ } from '../../Utils/dom.js';
import { esc } from '../../Utils/format.js';
import { supabase } from '../../Core/supabaseClient.js';
import { appState, canViewScanner } from '../../Core/state.js';
import { ScanEventsModel } from '../../Models/ScanEventsModel.js';
import { renderScanResult } from '../../Components/ScanResultCard.js';
import { loadScanFeed, prependPendingRow } from '../../Components/ScanFeed.js';
import { PROXIMITY_LOGO_SVG } from '../../Components/ProximityLogo.js';
import { loadScanSounds, playScanSound, scanSoundsLoaded, initAudioUnlock } from '../../Utils/scanSounds.js';
import { OfflineScanModel, STALE_AFTER_MS } from '../../Models/OfflineScanModel.js';

// Module-level, not per-render: renderStandaloneScanner() only actually
// runs once per kiosk tab in practice, but guarding here means a second
// call (if that ever changes) can't stack a second setInterval or a
// second pair of online/offline listeners.
let offlineSupportInited = false;

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
      <div class="ss-offline-status" id="ss-offline-status"></div>
      <button class="ghost" id="ss-signout">Sign out</button>
    </div>
    <div class="ss-layout">
      <div class="ss-main">
        <div class="ss-topbar">
          <input id="ss-code" type="password" class="mono" placeholder="Live Search — scan or type code…" autocomplete="off" autofocus />
        </div>
        <div class="ss-hero">
          <div class="ss-ring"><div class="ss-icon">${PROXIMITY_LOGO_SVG}</div></div>
        </div>
        <div class="ss-result-wrap" id="ss-result"></div>
      </div>
      <div class="ss-feed-col">
        <div class="panel ss-feed-panel">
          <div class="ss-feed-title">Recent activity</div>
          <div id="ss-feed">Loading…</div>
        </div>
        <div class="ss-sync-status" id="ss-sync-status"></div>
      </div>
    </div>
  `;
  $('#ss-signout').addEventListener('click', async () => { await supabase.auth.signOut(); });
  // Loaded once per kiosk session, not per-scan — see Utils/scanSounds.js.
  // A stray unhandled rejection here (e.g. offline on load) shouldn't
  // block the scanner from working; scans just stay silent until a retry.
  loadScanSounds().catch(() => {});
  initAudioUnlock();
  initOfflineSupport(operatorName);
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
    let data, error;
    let offlineHandled = false;
    if (navigator.onLine) {
      ({ data, error } = await ScanEventsModel.scan(proximity_code, operatorName));
    }
    if (!navigator.onLine || OfflineScanModel.isNetworkError(error)) {
      // Either genuinely offline, or the request itself failed to reach
      // the network (as opposed to reaching Supabase and getting a real
      // error back, which still surfaces as a failed scan below). Fall
      // back to the local cache and queue the raw attempt for later.
      const meta = await OfflineScanModel.getCacheMeta();
      const bumps = await OfflineScanModel.pendingBumps(meta.rows);
      data = OfflineScanModel.classify(proximity_code, meta.rows, bumps);
      error = null;
      offlineHandled = true;
      await OfflineScanModel.enqueue(proximity_code, operatorName).catch(() => {});
      renderOfflineStatus();
      // No opportunistic photo fetch needed here anymore — classify()'s
      // employee object already carries photo_thumb_b64 straight from the
      // offline cache (see OfflineScanModel.js), rendered by
      // ScanResultCard.js with no network request at all. The live-retry
      // fetch that used to live here (for the case where "offline" really
      // meant Supabase-specifically-down, Drive-still-reachable) is dead
      // code once there's nothing left to prefetch or race.
    }
    clearTimeout(fadeTimer);
    clearTimeout(clearTimer);
    resultWrap.classList.remove('fade-out');
    if (error) {
      resultWrap.innerHTML = `<div class="result-card unmatched"><strong style="color:var(--bad)">Scan failed</strong><div class="emp-meta">${esc(error.message)}</div></div>`;
    } else {
      resultWrap.innerHTML = renderScanResult(data) + (offlineHandled
        ? `<div class="emp-meta" style="margin-top:6px;">⚠ Offline — recorded locally, will sync automatically</div>`
        : '');
      playScanSound(data);
    }
    scheduleResultFade();
    codeInput.value = '';
    // Post-submit cooldown, on top of the input already being disabled
    // during the request itself: a fast response (a few hundred ms) would
    // otherwise reopen the input almost immediately, which is long enough
    // for a physical card that's still sitting on the reader to bounce a
    // second read. Holding it disabled for a flat 1s after the response
    // comes back guarantees a minimum gap between scans regardless of how
    // quick the network round-trip was.
    setTimeout(() => {
      codeInput.disabled = false;
      codeInput.focus();
      scanBusy = false;
    }, POST_SCAN_COOLDOWN_MS);
    // An offline-handled scan was never inserted into scan_events, so a
    // real loadScanFeed() reload right now would just fail (or silently
    // show nothing new for it) — but the operator still needs to see that
    // the scan happened, so it gets a local optimistic row instead. The
    // real feed reload still happens later, once the queue actually syncs
    // (see flushIfPending in initOfflineSupport below), which replaces
    // this placeholder with the authoritative synced entry.
    if (offlineHandled) {
      prependPendingRow('ss-feed', data, operatorName, 10);
    } else {
      loadScanFeed('ss-feed', 10, operatorName);
    }
  };
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });
  const POST_SCAN_COOLDOWN_MS = 1000;
  // Most badge readers act as a keyboard wedge that just "types" the code
  // character-by-character with no trailing Enter — so waiting for a
  // keydown Enter alone leaves the code just sitting in the field after a
  // tap. Instead, auto-submit after a pause once typing stops. 2s also
  // doubles as an additional pre-submit "input blocked" window: a second
  // stray/bouncing tap landing within it just resets this same timer
  // rather than triggering a second scan. Manual Enter (above) still
  // submits instantly without waiting for the pause.
  const AUTO_SUBMIT_DELAY_MS = 200;
  codeInput.addEventListener('input', () => {
    clearTimeout(autoSubmitTimer);
    if (!codeInput.value.trim()) return;
    autoSubmitTimer = setTimeout(doScan, AUTO_SUBMIT_DELAY_MS);
  });
  loadScanFeed('ss-feed', 10, operatorName);
}

// Renders two things from the same underlying state, in two different
// spots in the layout: the header pill (connectivity + lookup-cache
// staleness — operator-facing "is this kiosk healthy" info that belongs
// near the top) and a small status line under Recent Activity, bottom
// right (the queued/syncing count — belongs next to the feed it affects,
// not competing with the header for attention). Called on mount, after
// every scan (queue count can change), and on every online/offline
// transition.
async function renderOfflineStatus() {
  const headerEl = $('#ss-offline-status');
  const syncEl = $('#ss-sync-status');
  if (!headerEl && !syncEl) return; // scanner tab may have been torn down (sign-out) mid-flight
  const [pending, meta] = await Promise.all([
    OfflineScanModel.queueCount(),
    OfflineScanModel.getCacheMeta(),
  ]);
  const stale = meta.ageMs > STALE_AFTER_MS;

  if (headerEl) {
    const parts = [];
    if (navigator.onLine) {
      parts.push(`<span class="badge active">● Online</span>`);
    } else {
      parts.push(`<span class="badge suspended">◌ Offline</span>`);
    }
    if (meta.syncedAt && stale) {
      parts.push(`<span class="emp-meta" style="color:var(--bad)">⚠ Offline data last synced ${esc(fmtAge(meta.ageMs))} ago — may be out of date</span>`);
    } else if (!meta.syncedAt) {
      parts.push(`<span class="emp-meta" style="color:var(--bad)">⚠ No offline data cached yet — scans will fail if the network drops</span>`);
    }
    headerEl.innerHTML = parts.join(' ');
  }

  if (syncEl) {
    if (pending > 0) {
      syncEl.innerHTML = navigator.onLine
        ? `<span class="emp-meta">Syncing ${pending} offline scan${pending === 1 ? '' : 's'}…</span>`
        : `<span class="emp-meta">${pending} scan${pending === 1 ? '' : 's'} queued — will sync automatically</span>`;
    } else {
      syncEl.innerHTML = '';
    }
  }
}

function fmtAge(ms) {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return 'less than an hour';
  if (hours === 1) return '1 hour';
  if (hours < 48) return `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
}

// One-time setup per kiosk tab: initial cache refresh + status paint,
// periodic refresh while online (so the lookup doesn't just sit there
// aging even on a kiosk that's never explicitly reloaded), and the
// online/offline wiring that flushes the queue the instant connectivity
// comes back.
function initOfflineSupport(operatorName) {
  if (offlineSupportInited) { renderOfflineStatus(); return; }
  offlineSupportInited = true;

  const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 min — cheap single RPC call, keeps the cache fresh through a normal shift without waiting on a reload
  // Deliberately shorter than REFRESH_INTERVAL_MS: this is the safety net
  // for a missed/never-fired `online` event (flaky on some OS/browser/
  // network combos — captive portals, Wi-Fi roaming, some mobile browsers
  // in particular), so it needs to catch up sooner than "once per 5 min"
  // would leave a kiosk sitting unsynced.
  const FLUSH_RETRY_INTERVAL_MS = 20 * 1000;

  const refreshIfOnline = async () => {
    if (!navigator.onLine) return;
    await OfflineScanModel.refreshCache().catch(() => {});
    // loadScanSounds() is normally a once-per-mount call (see
    // renderStandaloneScanner), but a kiosk that first loaded while
    // offline (or whose very first list() call raced a flaky connection)
    // never got a working sound map and, before this, had no way to
    // retry — it just stayed silent for the rest of the session.
    if (!scanSoundsLoaded()) await loadScanSounds().catch(() => {});
    renderOfflineStatus();
  };

  // Cheap to call often: when the queue is empty this is just a local
  // IndexedDB count read, no network round-trip at all. Only actually
  // calls the sync RPC when there's something to send.
  const flushIfPending = async () => {
    if (!navigator.onLine) return;
    const pendingBefore = await OfflineScanModel.queueCount();
    if (pendingBefore === 0) return;
    const { synced } = await OfflineScanModel.flushQueue(() => renderOfflineStatus()).catch(() => ({ synced: 0 }));
    // Recent Activity only shows what's actually in scan_events — an
    // offline-queued scan was never inserted there, so a sync that just
    // wrote rows for the first time needs an explicit reload here or
    // those scans never appear until something else happens to refresh
    // the feed (e.g. the next manual scan, or a reload).
    if (synced > 0) loadScanFeed('ss-feed', 10, operatorName);
    renderOfflineStatus();
  };

  const flushAndRefresh = async () => {
    await flushIfPending();
    await refreshIfOnline();
  };

  window.addEventListener('online', flushAndRefresh);
  window.addEventListener('offline', renderOfflineStatus);
  // Extra resync trigger alongside the 'online' event, not a replacement
  // for it: a kiosk tab backgrounded while offline and brought back to
  // the foreground after connectivity actually returned is exactly the
  // case where 'online' is most likely to have been missed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushAndRefresh();
  });

  // Kick things off: paint whatever's already cached immediately (no
  // network wait), then try a real refresh/flush if we're online right
  // now — covers both "tab was open offline and just reconnected" and
  // "tab just loaded, already online".
  renderOfflineStatus();
  flushAndRefresh();
  // Periodic *flush* attempt (not just a cache refresh) — the actual fix
  // for "came back online but nothing resynced automatically": before,
  // this interval only ever called refreshIfOnline(), so a queue left
  // behind by a missed 'online' event could sit there indefinitely with
  // no other path back to syncing short of a manual reload.
  setInterval(flushIfPending, FLUSH_RETRY_INTERVAL_MS);
  setInterval(refreshIfOnline, REFRESH_INTERVAL_MS);
}