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
// Two triggers, because they fail in different ways:
// - a new Service Worker activating, which means the app shell changed;
// - plain tab age, which also catches a deploy that never touched sw.js.
//   That second one is what would have caught the leak above.
//
// Reload is always gated on the page being idle, and what "idle" means belongs
// to the feature, not here: each one registers a predicate (see
// registerBusyCheck). Interrupting a scan to save bandwidth would be a bad
// trade.

export const TAB_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const BUSY_RETRY_MS = 60 * 1000;
const STALE_CHECK_MS = 5 * 60 * 1000;

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

  setInterval(() => {
    if (isTabStale(loadedAt, now(), maxAgeMs)) gate.request();
  }, STALE_CHECK_MS);

  liveGate = gate;
  return gate;
}
