// Keeps a long-lived tab from running indefinitely old code.
//
// A kiosk is opened once and left running for weeks. A loaded page never
// re-fetches its own JS modules, so it keeps executing whatever version it
// booted with until something reloads it. On 2026-10-08 one such tab was still
// calling get_scanner_offline_photos() — the pre-2026-09-19 full-thumbnail RPC
// that no current code path can produce — 95 times a day at 5.7 MB a call.
// ~13 GB/month, more than twice the entire egress quota, from a tab nobody had
// touched since before the RPC was split.
//
// Three triggers, because they fail in different ways:
// - a new Service Worker activating, which means the app shell changed;
// - plain tab age, which also catches a deploy that never touched sw.js.
//   That second one is what would have caught the leak above;
// - asking the browser to look, which is what makes the first one possible
//   at all. See below.
//
// Reload is always gated on the page being idle, and what "idle" means belongs
// to the feature, not here: each one registers a predicate (see
// registerBusyCheck). Interrupting a scan to save bandwidth would be a bad
// trade.
//
// WHY THE THIRD TRIGGER HAD TO EXIST (2026-11-13). The deploy stamp shipped
// on 2026-11-12 made sw.js's bytes change on every deploy, which was the
// first half of the problem. The second half only became visible afterwards:
// a kiosk sat with BOTH About rows reading 5da157e while the origin had been
// serving 492bca4 for hours.
//
// The browser checks for a new Service Worker script on NAVIGATION to an
// in-scope page. main.js calls register('/sw.js') exactly once, at boot. A
// kiosk is a single page opened once and left running for weeks — it never
// navigates again, so after that first load nothing ever asks. The bytes
// changed and no one looked.
//
// registration.update() is that ask. It is a conditional GET for one ~8 kB
// file against the CDN, answered 304 when nothing has changed — it does not
// touch Supabase, so it costs no egress and no log ingestion there.

export const TAB_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const BUSY_RETRY_MS = 60 * 1000;
const STALE_CHECK_MS = 5 * 60 * 1000;

// Half-hourly. A deploy is a human event a few times a week, so this is
// already far more often than it needs to be; the point is that the gap is
// bounded by something other than "when someone reloads the kiosk".
export const SW_CHECK_MS = 30 * 60 * 1000;

// Floor between checks whatever asked for one. 'online' and
// 'visibilitychange' both route here, and a few quick Alt-Tabs should not
// each cost a request. Same pattern as MIN_REFRESH_GAP_MS in the kiosk.
export const MIN_SW_CHECK_GAP_MS = 5 * 60 * 1000;

/** Pure, so the throttle is testable without a clock or a browser. */
export function shouldCheckForUpdate(lastCheckAt, now, minGapMs = MIN_SW_CHECK_GAP_MS) {
  // Typed, not coerced: Number(null) is 0, which would read as "last checked
  // at the epoch" and let every single event through. Never checked yet is
  // the one case that must always pass, so it is handled explicitly.
  if (typeof lastCheckAt !== 'number' || !Number.isFinite(lastCheckAt)) return true;
  return now - lastCheckAt >= minGapMs;
}

// Asks the browser to re-fetch sw.js. A rejection is nothing to act on: the
// next tick asks again, and a kiosk that cannot reach the CDN has a larger
// problem that the connection pill is already showing.
async function askBrowserForNewWorker() {
  const reg = await globalThis.navigator?.serviceWorker?.getRegistration?.();
  await reg?.update?.();
}

const busyChecks = new Set();

export function registerBusyCheck(check) {
  busyChecks.add(check);
  return () => busyChecks.delete(check);
}

// A predicate that throws has told us nothing, so assume busy rather than
// reload over the top of whatever it was guarding.
export function isBusy(checks = busyChecks) {
  for (const check of checks) {
    try {
      if (check()) return true;
    } catch {
      return true;
    }
  }
  return false;
}

export function isTabStale(loadedAt, now, maxAgeMs = TAB_MAX_AGE_MS) {
  return now - loadedAt >= maxAgeMs;
}

// Registered for every page, not just the kiosk: Components/Modal.js gives
// every dialog this class, so one check covers an admin halfway through an
// employee edit or an import.
export function aDialogIsOpen() {
  return Boolean(globalThis.document?.querySelector?.('.overlay'));
}

// Holds the "a reload is wanted" bit until the page is idle, retrying on a
// timer. One pending timer at a time, so repeat requests cannot stack them.
export function createUpdateGate({ reload, isBusy: busy, schedule, retryMs = BUSY_RETRY_MS }) {
  let pending = false;
  let timer = null;

  const attempt = () => {
    if (!pending) return false;
    if (busy()) {
      if (timer === null) {
        timer = schedule(() => {
          timer = null;
          attempt();
        }, retryMs);
      }
      return false;
    }
    pending = false;
    reload();
    return true;
  };

  return {
    request() {
      pending = true;
      return attempt();
    },
    attempt,
    get pending() {
      return pending;
    },
  };
}

// The gate from the one real initAppUpdates() call, so anything that wants
// to SHOW the pending state can read it without threading the object through
// half the app. initAppUpdates already returned the gate; nothing held it.
let liveGate = null;

/** Is a reload waiting for this page to go idle? */
export function updatePending() {
  return Boolean(liveGate?.pending);
}

/**
 * Let a held update through now.
 *
 * Still routed via the gate rather than calling reload() directly: the
 * whole point of the gate is that a scan in flight or an open dialog is a
 * bad moment, and a button that ignored that would be a worse version of
 * the thing it is trying to improve. Returns whether it actually reloaded.
 */
export function applyUpdateNow() {
  return Boolean(liveGate?.attempt());
}

export function initAppUpdates({
  loadedAt = Date.now(),
  now = Date.now,
  reload = () => window.location.reload(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  maxAgeMs = TAB_MAX_AGE_MS,
  // Injected so the poll can be driven without a Service Worker, which Node
  // does not have and a test should not need.
  checkForUpdate = askBrowserForNewWorker,
  swCheckMs = SW_CHECK_MS,
  minCheckGapMs = MIN_SW_CHECK_GAP_MS,
  setInterval: everyMs = (fn, ms) => setInterval(fn, ms),
} = {}) {
  registerBusyCheck(aDialogIsOpen);
  const gate = createUpdateGate({ reload, isBusy: () => isBusy(), schedule });

  // A controller already present at boot means this page was loaded under a
  // Service Worker, so a later activation is an update rather than a first
  // install — only the former is a reason to reload.
  const hadController = Boolean(navigator.serviceWorker?.controller);
  navigator.serviceWorker?.addEventListener?.('message', (event) => {
    if (hadController && event.data?.type === 'app-updated') gate.request();
  });

  everyMs(() => {
    if (isTabStale(loadedAt, now(), maxAgeMs)) gate.request();
  }, STALE_CHECK_MS);

  // Deliberately NOT gated on isBusy(). This asks whether a new worker
  // exists; it does not reload anything. If one is found, activation posts
  // `app-updated`, which goes through the gate like every other trigger —
  // so a scan in flight still delays the reload, not the question.
  let lastCheckAt = null;
  const poll = () => {
    if (globalThis.navigator?.onLine === false) return;
    if (!shouldCheckForUpdate(lastCheckAt, now(), minCheckGapMs)) return;
    lastCheckAt = now();
    Promise.resolve(checkForUpdate()).catch(() => {});
  };

  everyMs(poll, swCheckMs);
  globalThis.addEventListener?.('online', poll);
  globalThis.document?.addEventListener?.('visibilitychange', () => {
    if (globalThis.document.visibilityState === 'visible') poll();
  });
  // Once at boot too: a kiosk reopened after a week should not wait half an
  // hour to discover it is seven deploys behind.
  poll();

  liveGate = gate;
  return gate;
}
