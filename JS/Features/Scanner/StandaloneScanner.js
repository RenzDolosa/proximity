import { $ } from '../../Utils/dom.js';
import { esc } from '../../Utils/format.js';
import { supabase } from '../../Core/supabaseClient.js';
import { appState, canViewScanner } from '../../Core/state.js';
import { ScanEventsModel } from '../../Models/ScanEventsModel.js';
import { renderScanResult } from '../../Components/ScanResultCard.js';
import { loadScanFeed, prependPendingRow } from '../../Components/ScanFeed.js';
import { PROXIMITY_LOGO_SVG } from '../../Components/ProximityLogo.js';
import { photoDataUri } from '../../Utils/image.js';
import { loadScanSounds, playScanSound, scanSoundsLoaded, initAudioUnlock } from '../../Utils/scanSounds.js';
import { OfflineScanModel, STALE_AFTER_MS } from '../../Models/OfflineScanModel.js';

// Module-level, not per-render: renderStandaloneScanner() only actually
// runs once per kiosk tab in practice, but guarding here means a second
// call (if that ever changes) can't stack a second setInterval or a
// second pair of online/offline listeners.
let offlineSupportInited = false;
// Set the first (real) time initOfflineSupport runs; returned to any
// re-entrant call after that (see the guard at the top of the function)
// so doScan() always has a real flushIfPending to call, never undefined.
let flushIfPendingShared = async () => {};

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
  const photoStage = $('#ss-photo-stage');
  // Swapped in for a matched scan with a photo on file: fills the fixed,
  // full-viewport .ss-photo-stage (see CSS/scanner.css) rather than the
  // small .ss-icon hero ring — the point is a security/reception operator
  // being able to visually confirm the person from a normal viewing
  // distance, which a badge-sized crop can't really do, and doing it as
  // its own viewport-sized layer means it's not bounded by .ss-main's
  // grid column width the way growing .ss-icon itself would be.
  //
  // Shows photo_thumb_b64 immediately (already on data.employee for
  // every scan result, online or offline — see ScanResultCard.js's
  // header comment), then progressively upgrades to photoUrl's full
  // 512px Drive photo once that's actually loaded, via a plain <img>
  // preload (ordinary HTTP caching, no fetch()/blob needed). Two
  // different jobs for two different sources, deliberately: thumb_b64 is
  // always present and instant (that's the whole reason it exists — see
  // the 2026-09-18 change log) but a 96px thumbnail sized for a 44-64px
  // avatar reads as visibly blurry blown up to fill this much bigger
  // stage; photoUrl is only ever present for an ONLINE scan
  // (scan_proximity_code()'s to_jsonb(employees) response includes the
  // full row — the offline lookup cache deliberately dropped photo_url
  // as dead weight once nothing else read it, see this file's own change
  // log) and sharp, but not guaranteed to load at all. Upgrading is
  // purely additive: if photoUrl never loads — offline, Drive
  // unreachable, slow network — the thumbnail just keeps showing, so
  // there's no way this can regress the offline case photo_thumb_b64
  // exists to guarantee. photoDataUri() sniffs the real image format
  // from the bytes instead of assuming JPEG — Drive's /thumbnail
  // endpoint (what produced this base64 server-side) returns either PNG
  // or JPEG depending on the source photo, and a mislabeled data: URI
  // decodes as visual static rather than the real photo (see
  // Utils/image.js's header comment for the root-cause writeup).
  const showHeroPhoto = (name, thumbB64, photoUrl) => {
    photoStage.innerHTML = `<img src="${photoDataUri(thumbB64)}" alt="${esc(name || '')}" />`;
    photoStage.classList.add('active');
    if (!photoUrl) return;
    const thumbImg = photoStage.querySelector('img'); // the ONE just created above, captured now — see the guard in onload below for why
    const hiRes = new Image();
    hiRes.onload = () => {
      // A newer scan (or this same result fading out and a fresh one
      // landing) could have already replaced photoStage's content by the
      // time a slow image finishes loading — only swap if OUR <img> is
      // still the one actually on screen, never onto whatever's there now.
      if (photoStage.contains(thumbImg)) thumbImg.src = hiRes.src;
    };
    hiRes.src = photoUrl;
  };
  const resetHeroIcon = () => {
    if (!photoStage.classList.contains('active')) return; // nothing showing — avoid an unnecessary reflow on every non-photo scan
    photoStage.classList.remove('active');
    // Clear the <img> only after the CSS opacity/transform transition
    // finishes, not immediately — emptying innerHTML right away would cut
    // the fade-out short (the browser has nothing left to fade). 400ms
    // matches .ss-photo-stage's transition duration in CSS/scanner.css.
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
  // See the comment at its use in doScan() below for the full reasoning.
  // Generous enough not to false-trigger on a genuinely slow-but-working
  // connection (a normal RPC round trip is well under 1s), short enough
  // that a dead connection doesn't leave the operator staring at nothing
  // for anywhere near as long as a native browser timeout would.
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
      // navigator.onLine reports whether the device has ANY active
      // network interface, not whether the internet — or Supabase
      // specifically — is actually reachable right now. It's common for
      // it to still read `true` for a while after a connection has
      // genuinely died (Wi-Fi still associated to a dead router, a
      // captive portal, etc.), and a plain `supabase.rpc()` call has no
      // timeout of its own — it hangs until the browser's native
      // TCP/DNS timeout, which can be tens of seconds. That hang used to
      // sit directly in front of the offline fallback below, reported
      // as "scan slow to render result" right as connectivity dropped.
      // Racing it against a short local timeout bounds the worst case to
      // ONLINE_SCAN_TIMEOUT_MS regardless of what the OS network stack
      // decides to do; a timeout is treated exactly like any other
      // network failure below and falls through to the same offline path.
      const scanPromise = ScanEventsModel.scan(proximity_code, operatorName);
      const timeout = new Promise((resolve) => {
        setTimeout(() => resolve({ data: null, error: { message: 'timed out', timedOut: true } }), ONLINE_SCAN_TIMEOUT_MS);
      });
      ({ data, error } = await Promise.race([scanPromise, timeout]));
      if (error?.timedOut) {
        // The real request is still in flight — let it resolve/reject in
        // the background rather than leaving an unhandled rejection, but
        // don't wait for it or act on whatever it eventually returns;
        // we've already committed to the offline path for this attempt.
        scanPromise.catch(() => {});
      }
    }
    if (!navigator.onLine || error?.timedOut || OfflineScanModel.isNetworkError(error)) {
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
      } else {
        loadScanFeed('ss-feed', 10, operatorName);
      }
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
  if (offlineSupportInited) { renderOfflineStatus(); return flushIfPendingShared; }
  offlineSupportInited = true;

  const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 min — cheap single RPC call, keeps the cache fresh through a normal shift without waiting on a reload
  // A photo only changes when someone re-uploads one (rare, admin-driven)
  // — nowhere near as time-sensitive as card/employee status, so this
  // polls far less often than REFRESH_INTERVAL_MS. See
  // OfflineScanModel.refreshPhotoCache() / Supabase/README.md's change
  // log entry on splitting this out of get_scanner_offline_cache().
  const PHOTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min
  // Deliberately shorter than REFRESH_INTERVAL_MS: this is the safety net
  // for a missed/never-fired `online` event (flaky on some OS/browser/
  // network combos — captive portals, Wi-Fi roaming, some mobile browsers
  // in particular), so it needs to catch up sooner than "once per 5 min"
  // would leave a kiosk sitting unsynced.
  const FLUSH_RETRY_INTERVAL_MS = 20 * 1000;
  // Floor between two cache refreshes, independent of what triggered them.
  // 'online', 'visibilitychange' (Alt-Tab back in), and the 5-min interval
  // all call refreshIfOnline() through the same flushAndRefresh() path —
  // without this, a few quick Alt-Tabs in a row each fired a full
  // get_scanner_offline_cache() round trip (the entire roster) back to
  // back, which is exactly the kind of redundant network churn that made
  // the kiosk feel sluggish for no benefit: a cache that's 10 seconds old
  // doesn't need re-fetching just because the window regained focus.
  const MIN_REFRESH_GAP_MS = 30 * 1000;
  let lastRefreshAt = 0;
  // Same reasoning as MIN_REFRESH_GAP_MS above, just a longer floor to
  // match PHOTO_REFRESH_INTERVAL_MS's much lower urgency.
  const MIN_PHOTO_REFRESH_GAP_MS = 5 * 60 * 1000;
  let lastPhotoRefreshAt = 0;

  const refreshIfOnline = async () => {
    if (!navigator.onLine) return;
    if (Date.now() - lastRefreshAt < MIN_REFRESH_GAP_MS) return;
    lastRefreshAt = Date.now();
    await OfflineScanModel.refreshCache().catch(() => {});
    // loadScanSounds() is normally a once-per-mount call (see
    // renderStandaloneScanner), but a kiosk that first loaded while
    // offline (or whose very first list() call raced a flaky connection)
    // never got a working sound map and, before this, had no way to
    // retry — it just stayed silent for the rest of the session.
    if (!scanSoundsLoaded()) await loadScanSounds().catch(() => {});
    renderOfflineStatus();
  };

  // Deliberately separate from refreshIfOnline above, on its own much
  // longer interval — see PHOTO_REFRESH_INTERVAL_MS. Doesn't touch
  // renderOfflineStatus(): the status pill only reflects the lookup
  // cache's staleness, and a stale-ish photo cache isn't something that
  // should ever block or warn about scanning the way a stale card/
  // employee lookup would.
  const refreshPhotosIfOnline = async () => {
    if (!navigator.onLine) return;
    if (Date.now() - lastPhotoRefreshAt < MIN_PHOTO_REFRESH_GAP_MS) return;
    lastPhotoRefreshAt = Date.now();
    await OfflineScanModel.refreshPhotoCache().catch(() => {});
  };

  // Cheap to call often: when the queue is empty this is just a local
  // IndexedDB count read, no network round-trip at all. Only actually
  // calls the sync RPC when there's something to send.
  const flushIfPending = async () => {
    if (!navigator.onLine) return;
    const pendingBefore = await OfflineScanModel.queueCount();
    if (pendingBefore === 0) return;
    const syncEl = $('#ss-sync-status');
    const { synced } = await OfflineScanModel.flushQueue((done, total) => {
      // Cheap, synchronous text update from the numbers flushQueue already
      // has in hand — no IndexedDB round trip per item. This used to call
      // the full renderOfflineStatus() (2 IDB reads + rebuilding the
      // header pill) after EVERY single synced scan, which for a queue
      // built up over a longer outage meant dozens of redundant reads
      // stacked directly on top of the sync RPC calls themselves,
      // visibly slowing the whole flush down for no benefit — the header
      // pill doesn't need per-item updates, only this line does.
      if (syncEl) syncEl.innerHTML = `<span class="emp-meta">Syncing ${done}/${total} offline scan${total === 1 ? '' : 's'}…</span>`;
    }).catch(() => ({ synced: 0 }));
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
    await refreshPhotosIfOnline();
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
  setInterval(refreshPhotosIfOnline, PHOTO_REFRESH_INTERVAL_MS);

  // Exposed so doScan() (in renderStandaloneScanner above) can drain the
  // queue before reloading the feed on an online scan — see its call site
  // for why. flushIfPendingShared covers the defensive re-entrant-call
  // branch at the top of this function; the direct return covers the
  // normal first-call path.
  flushIfPendingShared = flushIfPending;
  return flushIfPending;
}