// What the Service Worker is actually doing for this page, and what that
// means for the person reading it.
//
// THE BUG THIS FIXES, seen 2026-11-13. The About panel rendered
//
//     Service worker   not registered
//     [ up to date ]
//
// at the same time. Two statements that cannot both be true, produced by:
//
//     const behind = Boolean(worker && worker !== tabBuild);
//
// A null worker makes `behind` false, and the badge falls through to "up to
// date" — a confident claim made in precisely the state where the panel
// knows nothing. Same shape as Number(null) === 0: an absent value treated
// as a passing one.
//
// AND "not registered" WAS WRONG ANYWAY. It was rendered whenever
// navigator.serviceWorker.controller was null, which conflates three states:
//
//   - there really is no registration;
//   - there is one, but it is not controlling THIS page — which is the
//     normal, documented result of a force-reload (Ctrl+Shift+R), and
//     exactly what had just been done;
//   - it is controlling and simply has not answered the postMessage yet.
//
// Only the first deserves the word "registered". The second matters on its
// own terms: an uncontrolled page has no cached app shell, so a kiosk in
// that state does not degrade to offline scanning — it fails to load at all.
// getRegistration() tells them apart and reads browser state, so it costs no
// request.

export const WORKER = Object.freeze({
  UNKNOWN: 'unknown',
  UNSUPPORTED: 'unsupported',
  NONE: 'none',
  NOT_CONTROLLING: 'not_controlling',
  ASKING: 'asking',
  READY: 'ready',
});

/**
 * One place that decides what the About panel and the kiosk drawer both say.
 *
 * The rule it exists to enforce: "up to date" is reachable from exactly one
 * state — controlling, answered, and matching. Everything else is either a
 * warning or an admission, never a green badge.
 */
export function describeWorker({
  state = WORKER.UNKNOWN,
  workerBuild = null,
  tabBuild = null,
  pending = false,
  isDev = false,
} = {}) {
  const offline = state === WORKER.READY || state === WORKER.ASKING;

  if (state === WORKER.UNSUPPORTED) {
    return {
      value: 'unsupported', badge: 'no offline support', tone: 'bad', offline: false,
      detail: 'this browser cannot cache the app, so it will not load without a network',
    };
  }
  if (state === WORKER.NONE) {
    return {
      value: 'not registered', badge: 'no offline support', tone: 'bad', offline: false,
      detail: 'nothing is caching the app — a dropped network takes this page down',
    };
  }
  if (state === WORKER.NOT_CONTROLLING) {
    return {
      value: 'not controlling', badge: 'offline support off', tone: 'warn', offline: false,
      // Named because it is the common cause and the fix is one keystroke.
      detail: 'a force-reload bypasses the worker — plain reload to restore offline support',
    };
  }
  if (state === WORKER.UNKNOWN || state === WORKER.ASKING || !workerBuild) {
    return {
      value: state === WORKER.UNKNOWN ? 'checking…' : 'asking…',
      badge: 'checking', tone: 'warn', offline,
      detail: null,
    };
  }

  const behind = Boolean(tabBuild && workerBuild !== tabBuild);
  if (pending || behind) {
    return {
      value: workerBuild, badge: 'update waiting', tone: 'warn', offline: true,
      detail: behind ? 'the live worker is a different build than this tab' : null,
    };
  }
  if (isDev) return { value: workerBuild, badge: 'dev build', tone: 'unknown', offline: true, detail: null };
  return { value: workerBuild, badge: 'up to date', tone: 'good', offline: true, detail: null };
}

/**
 * Ask the browser what it has, without asking the network anything.
 *
 * getRegistration() resolves to undefined when there is none; `controller`
 * is null on a page the worker is not controlling. Both are local reads.
 */
export async function probeWorkerState(nav = globalThis.navigator) {
  const sw = nav?.serviceWorker;
  if (!sw) return WORKER.UNSUPPORTED;
  let reg = null;
  try {
    reg = await sw.getRegistration();
  } catch {
    // A SecurityError here (an insecure context, a sandboxed frame) is the
    // same practical answer as having none: nothing is caching this page.
    return WORKER.NONE;
  }
  if (!reg) return WORKER.NONE;
  if (!sw.controller) return WORKER.NOT_CONTROLLING;
  return WORKER.ASKING;
}
