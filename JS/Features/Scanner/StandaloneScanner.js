import { $ } from '../../Utils/dom.js';
import { esc } from '../../Utils/format.js';
import { supabase } from '../../Core/supabaseClient.js';
import { appState, canViewScanner } from '../../Core/state.js';
import { ScanEventsModel } from '../../Models/ScanEventsModel.js';
import { renderScanResult } from '../../Components/ScanResultCard.js';
import { loadScanFeed, prependPendingRow, prependScanEvent } from '../../Components/ScanFeed.js';
import { PROXIMITY_LOGO_SVG } from '../../Components/ProximityLogo.js';
import { photoDataUri } from '../../Utils/image.js';
import { loadScanSounds, playScanSound, scanSoundsLoaded, initAudioUnlock } from '../../Utils/scanSounds.js';
import { OfflineScanModel, STALE_AFTER_MS } from '../../Models/OfflineScanModel.js';
import { readRejection } from '../../Core/offlineScanning.js';
import { registerBusyCheck } from '../../Utils/appUpdate.js';

// Module-level, not per-render: renderStandaloneScanner() only actually
// runs once per kiosk tab in practice, but guarding here means a second
// call (if that ever changes) can't stack a second setInterval or a
// second pair of online/offline listeners.
let offlineSupportInited = false;
// Set the first (real) time initOfflineSupport runs; returned to any
// re-entrant call after that (see the guard at the top of the function)
// so doScan() always has a real flushIfPending to call, never undefined.
let flushIfPendingShared = async () => {};
let focusWatchdogTimer = null;
// The cached lookup rows, kept here so looksLikeCardCode() can run on every
// auto-submit without an IndexedDB read per keystroke. Refreshed alongside the
// cache itself; an empty array simply means the check fails open.
let cachedLookupRows = [];
// Last known offline-queue depth, kept in sync by renderOfflineStatus() so
// kioskIsBusy() can stay synchronous.
let pendingScanCount = 0;

// A kiosk must never be reloaded mid-read. The reader types a whole badge in
// ~100ms, so a non-empty input is an in-progress scan, not idle UI.
function kioskIsBusy() {
  const input = document.querySelector('#ss-code');
  if (!input) return false;
  return input.disabled || input.value.length > 0 || pendingScanCount > 0
    || Boolean(document.querySelector('.overlay'));
}

// The badge reader is a keyboard: if #ss-code is not focused, a scan types into
// nothing and is silently lost. A blur listener alone is not enough, because the
// ways focus goes missing on a kiosk mostly do not end in a blur on this input.
//
// Reported 2026-10-06: connecting over Chrome Remote Desktop leaves the input
// unfocused. CRD takes OS focus, changes the remote display resolution, and can
// route through a lock/unlock — none of which the page sees as a blur it can act
// on. Losing *window* focus does not even change document.activeElement, so the
// old `activeElement === body` check was false exactly when it needed to fire.
//
// Hence a watchdog rather than an event list: poll, and reclaim focus whenever
// nothing meaningful holds it. Still never steals focus from a control the
// operator is actually using (Sign out) or from an open dialog.
//
// BUT POLLING ALONE CANNOT BE THE ANSWER, which the data proved on 2026-10-08:
// 58 of 59 "unknown card" alerts were truncated reads of real cards. A reader
// types ten digits in roughly 100ms, so ANY poll interval loses whole reads —
// at 1000ms it lost all ten digits, and even 200ms would lose most of them.
// Those were employees whose badge silently did not work.
//
// So the primary mechanism is not the poll: it is capturing the keystrokes
// themselves (see adoptStrayKeystroke). A character typed while the input is
// unfocused still reaches `document`, so it can be redirected into the input
// rather than lost. The poll remains only as a backstop for the non-typing case
// — an operator glancing at the kiosk and seeing the caret in the right place.
const FOCUS_WATCHDOG_MS = 400;

function canReclaimFocus(input) {
  if (!document.body.contains(input) || input.disabled) return false;
  if (document.querySelector('.overlay')) return false;
  const active = document.activeElement;
  return !active || active === input || active === document.body || active === document.documentElement;
}

// True only when a scan typed right now would actually land in the box.
// `document.hasFocus()` is the part that matters and the part a page cannot
// fix: if the browser WINDOW is unfocused, input.focus() moves the caret but
// the keyboard still goes somewhere else entirely. That is the state a Chrome
// Remote Desktop reconnect leaves behind, and why the 2026-10-08 watchdog did
// not close the issue — it was reporting success while the window was deaf.
function scanInputIsLive(input) {
  return Boolean(input) && document.activeElement === input && document.hasFocus();
}

// Paints the out-of-focus warning. Separated from reclaiming so the state is
// shown honestly even in the case nothing can be done about from script.
function paintFocusState(input) {
  const wrap = document.querySelector('#standalone-scanner');
  const note = document.querySelector('#ss-focus-note');
  if (!wrap) return;
  // A dialog legitimately owns focus; that is not a broken scanner.
  const dialogOpen = Boolean(document.querySelector('.overlay'));
  const lost = !dialogOpen && !scanInputIsLive(input);
  wrap.classList.toggle('ss-unfocused', lost);
  if (note) note.hidden = !lost;
}

function reclaimFocus(input) {
  if (canReclaimFocus(input) && document.activeElement !== input) input.focus();
  paintFocusState(input);
}

// Redirects a keystroke that landed on the document into the scan input, so a
// read that begins before focus arrives is recovered instead of truncated.
//
// Capture phase, and preventDefault + manual append rather than just focusing:
// focusing mid-keydown does not reliably deliver THIS character to the newly
// focused element, and in some browsers delivers it twice. Appending explicitly
// is deterministic. The synthetic `input` event is required — the auto-submit
// debounce listens for it, and without it a recovered read would sit in the box
// forever.
//
// Deliberately narrow: single printable characters only, no modifier combos, and
// nothing at all while a dialog is open or the operator is using a control. A
// stray single keypress is harmless — it lands in the box, auto-submit fires,
// and looksLikeCardCode() rejects it as a partial read.
function adoptStrayKeystroke(input, e) {
  if (document.activeElement === input) return;
  if (e.key == null || e.key.length !== 1) return;      // Tab, Shift, arrows, F-keys
  if (e.ctrlKey || e.altKey || e.metaKey) return;       // a shortcut, not a card
  if (!canReclaimFocus(input)) return;
  e.preventDefault();
  input.focus();
  input.value += e.key;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// The document/window listeners below are never removed, so they must be bound
// at most once. A second keydown handler would append every character twice,
// turning a correct read into a corrupt one — worse than the truncation this
// exists to fix. The input itself is re-looked-up through `currentCodeInput`
// rather than captured, so a re-render still reaches the live element.
let focusListenersBound = false;
let currentCodeInput = null;

function startFocusWatchdog(input) {
  currentCodeInput = input;
  clearInterval(focusWatchdogTimer);
  const reclaim = () => { if (currentCodeInput) reclaimFocus(currentCodeInput); };
  focusWatchdogTimer = setInterval(reclaim, FOCUS_WATCHDOG_MS);
  input.addEventListener('blur', () => setTimeout(reclaim, 50));

  if (focusListenersBound) return;
  focusListenersBound = true;
  // The one that actually prevents truncated reads.
  document.addEventListener('keydown', (e) => {
    if (currentCodeInput) adoptStrayKeystroke(currentCodeInput, e);
  }, true);
  // Immediate paths, so a returning operator does not wait out a poll.
  window.addEventListener('focus', reclaim);
  window.addEventListener('resize', reclaim);   // CRD resizes the remote display on connect
  window.addEventListener('pageshow', reclaim);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reclaim(); });
  // `blur` on the WINDOW is the Chrome Remote Desktop case: the page keeps
  // document.activeElement pointing at the input while the keyboard goes
  // elsewhere, so nothing else here would notice. Repaint rather than try to
  // reclaim — script cannot take OS focus back.
  window.addEventListener('blur', () => paintFocusState(currentCodeInput));
  // Recovery that needs no aim: a click anywhere on the kiosk puts the caret
  // back. Previously the operator had to find and hit the input itself.
  // Capture phase so it still runs when the click lands on the background
  // logo, and it never fights a real control — reclaimFocus()'s own
  // canReclaimFocus() declines while a dialog or another field is active.
  document.addEventListener('pointerdown', (e) => {
    if (!currentCodeInput) return;
    if (e.target.closest('button, a, select, textarea, input, .overlay')) return;
    // After the browser has finished its own focus handling for this click.
    setTimeout(reclaim, 0);
  }, true);
}

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
    <div class="ss-bg-logo" aria-hidden="true"><div class="ss-ring">${PROXIMITY_LOGO_SVG}</div></div>
    <div class="ss-focus-note" id="ss-focus-note" role="status" hidden>⚠ Scanner not listening — click anywhere on this screen, then scan again</div>
    <div class="ss-photo-stage" id="ss-photo-stage" aria-hidden="true"></div>
    <div class="ss-header">
      <div class="ss-operator" style="display: flex; align-items: center;">Operator: <strong class="mono" style="margin: 0 8px 0 8px;">${esc(operatorName)}</strong><div class="ss-offline-status" id="ss-offline-status"></div></div>
      <button class="ghost" id="ss-signout">Sign out</button>
    </div>
    <div class="ss-layout">
      <div class="ss-result-wrap" id="ss-result"></div>
      <div class="ss-main">
        <div class="ss-topbar">
          <!-- type="text" + .masked-code-input (see scanner.css), NOT
               type="password": a real password field is exactly what made
               Chrome offer autofill suggestions and "Update password?"
               prompts here — Chrome deliberately ignores autocomplete="off"
               on type="password" specifically, which is why that attribute
               alone never fixed it. -->
          <input id="ss-code" type="text" class="mono masked-code-input" placeholder="Live Search — scan or type code…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore autofocus />
        </div>
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
  const flushPendingQueue = initOfflineSupport(operatorName);
  const codeInput = $('#ss-code');
  // `autofocus` is unreliable on innerHTML-inserted markup, so focus explicitly.
  codeInput.focus();
  startFocusWatchdog(codeInput);
  const resultWrap = $('#ss-result');
  const photoStage = $('#ss-photo-stage');

  // Brief, non-blocking feedback for input the kiosk discarded without scanning.
  // Reuses the result area so the operator looks in the same place as always,
  // and clears itself rather than lingering in front of the next real scan.
  let hintTimer = null;
  const showTransientHint = (text) => {
    clearTimeout(hintTimer);
    resultWrap.classList.remove('fade-out');
    resultWrap.innerHTML = `<div class="result-card unmatched"><strong>${esc(text)}</strong></div>`;
    hintTimer = setTimeout(() => {
      if (resultWrap.querySelector('.result-card.unmatched')) resultWrap.innerHTML = '';
    }, 2000);
  };
  // The full-viewport match photo, so an operator can confirm the person from a
  // normal viewing distance. Shows the cached thumbnail instantly, then upgrades
  // to the sharper Drive photo once it loads.
  //
  // Purely additive by design: photoUrl only exists for an ONLINE scan and may
  // never load, in which case the thumbnail keeps showing — so this can never
  // regress the offline case photo_thumb_b64 exists to guarantee.
  const showHeroPhoto = (name, thumbB64, photoUrl) => {
    photoStage.innerHTML = `<img src="${photoDataUri(thumbB64)}" alt="${esc(name || '')}" />`;
    photoStage.classList.add('active');
    if (!photoUrl) return;
    const thumbImg = photoStage.querySelector('img');
    const hiRes = new Image();
    hiRes.onload = () => {
      // A newer scan may have replaced the stage while this was loading — only
      // swap if our own <img> is still on screen.
      if (photoStage.contains(thumbImg)) thumbImg.src = hiRes.src;
    };
    hiRes.src = photoUrl;
  };
  const resetHeroIcon = () => {
    if (!photoStage.classList.contains('active')) return; // nothing showing — avoid an unnecessary reflow on every non-photo scan
    photoStage.classList.remove('active');
    // Clear only after the fade finishes — emptying innerHTML now would cut it
    // short. 400ms matches .ss-photo-stage's transition in CSS/scanner.css.
    setTimeout(() => {
      if (!photoStage.classList.contains('active')) photoStage.innerHTML = '';
    }, 400);
  };
  let fadeTimer = null;
  let clearTimer = null;
  let autoSubmitTimer = null;
  let scanBusy = false;
  const RESULT_LIFETIME_MS = 10000;
  const FADE_DURATION_MS = 400;
  // Long enough not to false-trigger on a slow-but-working connection (a normal
  // round trip is well under 1s), short enough to beat the browser's own timeout.
  const ONLINE_SCAN_TIMEOUT_MS = 4000;
  const scheduleResultFade = () => {
    clearTimeout(fadeTimer);
    clearTimeout(clearTimer);
    fadeTimer = setTimeout(() => {
      resultWrap.classList.add('fade-out');
      clearTimer = setTimeout(() => {
        resultWrap.innerHTML = '';
        resultWrap.classList.remove('fade-out');
        resetHeroIcon();
      }, FADE_DURATION_MS);
    }, RESULT_LIFETIME_MS);
  };
  const doScan = async () => {
    if (scanBusy) return; // a scan is already in flight — the debounce timer below can otherwise double-fire while awaiting the previous one
    const proximity_code = codeInput.value.trim();
    if (!proximity_code) return;
    // Cannot be any card registered on this system — a partial read, a stray
    // keystroke, or a stuck key, each of which the 200ms auto-submit would
    // otherwise turn into a real unmatched scan and an alert. Discarded
    // locally: no request, no scan_event, no alert. See readRejection().
    const rejection = readRejection(proximity_code, cachedLookupRows);
    if (rejection) {
      clearTimeout(autoSubmitTimer);
      codeInput.value = '';
      showTransientHint(rejection === 'short'
        ? 'Partial read — please scan again'
        : 'Invalid read — check the reader, then scan again');
      return;
    }
    scanBusy = true;
    clearTimeout(autoSubmitTimer);
    // Lock the input before the round-trip: a card read landing mid-request would
    // otherwise append onto the field instead of counting as its own scan.
    codeInput.disabled = true;
    let data, error;
    let offlineHandled = false;
    if (navigator.onLine) {
      // navigator.onLine only reports whether a network interface is up, not
      // whether Supabase is reachable — it stays true on a dead router or behind
      // a captive portal. supabase.rpc() has no timeout of its own and hangs
      // until the OS TCP/DNS timeout, tens of seconds, in front of the offline
      // fallback below. Racing a local timeout bounds that; a timeout is handled
      // exactly like any other network failure.
      const scanPromise = ScanEventsModel.scan(proximity_code, operatorName);
      const timeout = new Promise((resolve) => {
        setTimeout(() => resolve({ data: null, error: { message: 'timed out', timedOut: true } }), ONLINE_SCAN_TIMEOUT_MS);
      });
      ({ data, error } = await Promise.race([scanPromise, timeout]));
      // Swallow the still-in-flight request's eventual rejection; we have already
      // committed to the offline path for this attempt.
      if (error?.timedOut) scanPromise.catch(() => {});
    }
    if (!navigator.onLine || error?.timedOut || OfflineScanModel.isNetworkError(error)) {
      // Offline, or the request never reached the network. A real error FROM
      // Supabase is not this case and still surfaces as a failed scan below.
      const meta = await OfflineScanModel.getCacheMeta();
      const bumps = await OfflineScanModel.pendingBumps(meta.rows);
      data = OfflineScanModel.classify(proximity_code, meta.rows, bumps);
      error = null;
      offlineHandled = true;
      await OfflineScanModel.enqueue(proximity_code, operatorName).catch(() => {});
      renderOfflineStatus();
    }
    // Online results arrive without photo_thumb_b64 (see ScanEventsModel.scan());
    // put the locally cached thumbnail back before anything renders. Offline
    // results already got theirs from getCacheMeta()'s merge.
    if (!offlineHandled && !error && data) data = await OfflineScanModel.withCachedPhoto(data);
    clearTimeout(fadeTimer);
    clearTimeout(clearTimer);
    resultWrap.classList.remove('fade-out');
    if (error) {
      resultWrap.innerHTML = `<div class="result-card unmatched"><strong style="color:var(--bad)">Scan failed</strong><div class="emp-meta">${esc(error.message)}</div></div>`;
      resetHeroIcon();
    } else {
      resultWrap.innerHTML = renderScanResult(data) + (offlineHandled
        ? `<div class="emp-meta" style="margin-top:6px;">⚠ Offline — recorded locally, will sync automatically</div>`
        : '');
      playScanSound(data);
      if (data.result === 'matched' && data.employee?.photo_thumb_b64) {
        showHeroPhoto(data.employee.full_name, data.employee.photo_thumb_b64, data.employee.photo_url);
      } else {
        resetHeroIcon(); // e.g. an unmatched scan right after a matched one — don't leave the previous person's photo up
      }
    }
    scheduleResultFade();
    codeInput.value = '';
    // A flat cooldown AFTER the response guarantees a minimum gap between scans
    // however fast the round trip was — otherwise a card still sitting on the
    // reader bounces a second read.
    setTimeout(() => {
      codeInput.disabled = false;
      codeInput.focus();
      scanBusy = false;
    }, POST_SCAN_COOLDOWN_MS);
    // An offline scan is not in scan_events yet, so a feed reload would show
    // nothing for it. Show an optimistic row; the real reload after the queue
    // syncs replaces it with the authoritative entry.
    if (offlineHandled) {
      prependPendingRow('ss-feed', data, 10);
    } else {
      // A plain loadScanFeed() here used to wholesale-replace the feed
      // with whatever's authoritative in scan_events RIGHT NOW — which
      // is fine when the offline queue is already empty, but if this
      // online scan happens while there's STILL an un-synced backlog
      // (very possible in the first moments after reconnecting, before
      // the periodic/on-'online' flush has caught up), that reload wipes
      // out the visible "Queued — syncing…" rows for scans that are
      // still only in IndexedDB, not in scan_events yet — they vanish
      // from the feed even though the data itself is completely safe,
      // just not yet synced. Draining the queue first means the reload
      // that follows actually reflects everything, so nothing visibly
      // disappears without being replaced by its real counterpart.
      // flushPendingQueue (from initOfflineSupport below) already calls
      // loadScanFeed() itself when it syncs anything, so this only calls
      // it again separately in the empty-queue case.
      const pendingBefore = await OfflineScanModel.queueCount();
      if (pendingBefore > 0) {
        await flushPendingQueue();
      } else if (data.result === 'matched' && data.scan_id && data.scanned_at) {
        prependScanEvent('ss-feed', data, 10);
      } else {
        loadScanFeed('ss-feed', 10, operatorName);
      }
    }
  };
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doScan(); });
  const POST_SCAN_COOLDOWN_MS = 1000;
  // Badge readers are keyboard wedges that type the code with no trailing
  // Enter, so waiting on keydown alone leaves it sitting in the field.
  // Auto-submit once typing stops; a bouncing second read just resets the timer.
  const AUTO_SUBMIT_DELAY_MS = 200;
  codeInput.addEventListener('input', () => {
    clearTimeout(autoSubmitTimer);
    if (!codeInput.value.trim()) return;
    autoSubmitTimer = setTimeout(doScan, AUTO_SUBMIT_DELAY_MS);
  });
  loadScanFeed('ss-feed', 10, operatorName);
}

// Two views of the same state: the header pill (connectivity + cache staleness —
// "is this kiosk healthy") and a line under Recent Activity (queued/syncing
// count, next to the feed it affects). Called on mount, after every scan, and on
// every online/offline transition.
async function renderOfflineStatus() {
  const headerEl = $('#ss-offline-status');
  const syncEl = $('#ss-sync-status');
  if (!headerEl && !syncEl) return; // scanner tab may have been torn down (sign-out) mid-flight
  const [pending, meta] = await Promise.all([
    OfflineScanModel.queueCount(),
    OfflineScanModel.getCacheMeta(),
  ]);
  // Free ride: this already reads the cache, and it runs on mount, after every
  // scan, and on every connectivity change — so looksLikeCardCode() stays
  // current without a single extra IndexedDB read.
  cachedLookupRows = meta.rows || [];
  pendingScanCount = pending;
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

// One-time setup per kiosk tab: initial cache refresh, periodic refresh while
// online, and the online/offline wiring that flushes the queue on reconnect.
function initOfflineSupport(operatorName) {
  if (offlineSupportInited) { renderOfflineStatus(); return flushIfPendingShared; }
  offlineSupportInited = true;
  registerBusyCheck(kioskIsBusy);
  // Load the local thumbnails into memory now so the first scan's result card
  // and the feed don't wait on an IndexedDB read (see OfflineScanModel.getPhotoCache()).
  OfflineScanModel.getPhotoCache().catch(() => {});

  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  // Photos only change when an admin re-uploads one, so this polls far less
  // often than the lookup.
  const PHOTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
  // Shorter than REFRESH_INTERVAL_MS on purpose: this is the safety net for an
  // `online` event that never fires (captive portals, Wi-Fi roaming), so it must
  // catch up sooner than 5 minutes.
  const FLUSH_RETRY_INTERVAL_MS = 20 * 1000;
  // Floor between refreshes whatever triggered them. 'online',
  // 'visibilitychange' and the interval all route through flushAndRefresh(), so
  // without this a few quick Alt-Tabs each fired a full round trip — a cache ten
  // seconds old does not need refetching because the window regained focus.
  const MIN_REFRESH_GAP_MS = 30 * 1000;
  let lastRefreshAt = 0;
  // Same idea, longer floor, matching the photo cache's lower urgency.
  const MIN_PHOTO_REFRESH_GAP_MS = 5 * 60 * 1000;
  let lastPhotoRefreshAt = 0;

  const refreshIfOnline = async () => {
    if (!navigator.onLine) return;
    if (Date.now() - lastRefreshAt < MIN_REFRESH_GAP_MS) return;
    lastRefreshAt = Date.now();
    await OfflineScanModel.refreshCache().catch(() => {});
    // Retry path for a kiosk that first loaded offline: without this it stays
    // silent for the whole session.
    if (!scanSoundsLoaded()) await loadScanSounds().catch(() => {});
    renderOfflineStatus();
  };

  // Separate from refreshIfOnline, on a much longer interval. Deliberately does
  // not touch renderOfflineStatus(): the status pill reflects lookup-cache
  // staleness, and a stale photo cache should never warn about scanning.
  const refreshPhotosIfOnline = async () => {
    if (!navigator.onLine) return;
    if (Date.now() - lastPhotoRefreshAt < MIN_PHOTO_REFRESH_GAP_MS) return;
    lastPhotoRefreshAt = Date.now();
    await OfflineScanModel.refreshPhotoCache().catch(() => {});
  };

  // Cheap to call often: an empty queue costs one local IndexedDB count and no
  // network at all.
  const flushIfPending = async () => {
    if (!navigator.onLine) return;
    const pendingBefore = await OfflineScanModel.queueCount();
    if (pendingBefore === 0) return;
    const syncEl = $('#ss-sync-status');
    const { synced } = await OfflineScanModel.flushQueue((done, total) => {
      // Synchronous text update from numbers flushQueue already holds. A full
      // renderOfflineStatus() here would stack two IndexedDB reads onto every
      // synced scan, and only this line needs per-item updates.
      if (syncEl) syncEl.innerHTML = `<span class="emp-meta">Syncing ${done}/${total} offline scan${total === 1 ? '' : 's'}…</span>`;
    }).catch(() => ({ synced: 0 }));
    // The feed only shows scan_events rows, so newly written ones need an
    // explicit reload or they never appear until the next scan.
    if (synced > 0) loadScanFeed('ss-feed', 10, operatorName);
    renderOfflineStatus();
  };

  const flushAndRefresh = async () => {
    await flushIfPending();
    await refreshIfOnline();
    await refreshPhotosIfOnline();
  };

  window.addEventListener('online', flushAndRefresh);
  window.addEventListener('offline', renderOfflineStatus);
  // Alongside 'online', not instead of it: a tab backgrounded while offline and
  // foregrounded after reconnecting is where 'online' is most often missed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushAndRefresh();
  });

  // Paint the cached state first (no network wait), then try a real refresh.
  renderOfflineStatus();
  flushAndRefresh();
  // A periodic FLUSH, not just a refresh: otherwise a queue left behind by a
  // missed 'online' event sits there until someone reloads.
  setInterval(flushIfPending, FLUSH_RETRY_INTERVAL_MS);
  setInterval(refreshIfOnline, REFRESH_INTERVAL_MS);
  setInterval(refreshPhotosIfOnline, PHOTO_REFRESH_INTERVAL_MS);

  // Exposed so doScan() (in renderStandaloneScanner above) can drain the
  // queue before reloading the feed on an online scan — see its call site
  // for why. flushIfPendingShared covers the defensive re-entrant-call
  // branch at the top of this function; the direct return covers the
  // normal first-call path.
  flushIfPendingShared = flushIfPending;
  return flushIfPending;
}