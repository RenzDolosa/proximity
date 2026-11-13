// Why the offline queue stopped, and how often it is worth asking again.
//
// THE BUG THIS FIXES. flushQueuedScans() halts every worker on the first
// error and then throws that error away, so OfflineScanModel.flushQueue()
// could only ever report { synced, remaining }. StandaloneScanner therefore
// rendered
//
//     14 scans queued — will sync automatically
//
// unconditionally. An expired session, a revoked grant and a kiosk simply
// waiting for Wi-Fi all produced the same sentence, and the only one of the
// three that sentence is true for is the last. The count sits there not
// falling and the line underneath it says everything is fine.
//
// IT ALSO COST REQUESTS, WHICH IS THE PART THAT SHOWS UP ON A BILL.
// initOfflineSupport() retries on a 20-second interval and returns early
// only when the queue is EMPTY. A queue blocked by something a retry cannot
// fix therefore sent 180 failing requests an hour — each one an API-gateway
// log event, and for a permission failure a Postgres ERROR line as well —
// for as long as it stayed blocked, which for an expired session is until
// somebody notices.
//
// THE RETRY STAYS AUTOMATIC. A kiosk is operated with a card reader and no
// mouse; an operator cannot be asked to click Retry, and the earlier health
// drawer bug (hover opens it, because clicking steals focus from the reader
// input) is the standing reminder of what pointer affordances cost here.
// So this paces the existing automatic retry rather than replacing it with a
// button: 20s, 40s, 80s … up to ten minutes, which takes a stuck kiosk from
// 180 requests an hour to 6 and still recovers on its own the moment the
// cause clears. A reconnect, a tab becoming visible, or any successful scan
// resets the ladder immediately, so the common case — the network came back
// — is still handled in the first 20 seconds.

export const FIRST_RETRY_MS = 20 * 1000;
export const MAX_RETRY_MS = 10 * 60 * 1000;

/**
 * What stopped the flush, in terms an operator standing at a kiosk can act
 * on. The labels name the thing to do, not the thing that broke: "ask an
 * admin to sign this kiosk in again" beats "PGRST301".
 */
export function classifyFlushError(error) {
  if (!error) return { reason: 'none', label: '', retryable: true };

  const code = typeof error.code === 'string' ? error.code : '';
  const status = typeof error.status === 'number' ? error.status : null;
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';

  // Checked before the network test on purpose: a fetch that fails because
  // the session is gone can still surface a message mentioning "failed to".
  if (code === 'PGRST301' || status === 401 || /jwt|token (is )?expired|not authenticated/.test(message)) {
    return { reason: 'auth', label: 'this kiosk needs to sign in again', retryable: false };
  }
  if (code === '42501' || status === 403 || /permission denied|not permitted/.test(message)) {
    return { reason: 'permission', label: 'this kiosk is not permitted to post scans', retryable: false };
  }
  if (code === 'PGRST202' || code === '42883' || /could not find the function/.test(message)) {
    return { reason: 'missing', label: 'the server is missing a function this needs', retryable: false };
  }
  if (!code && status == null && /fetch|network|failed to/.test(message)) {
    return { reason: 'offline', label: 'waiting for the network', retryable: true };
  }
  if (status != null && status >= 500) {
    return { reason: 'server', label: 'the server is returning an error', retryable: true };
  }
  return { reason: 'unknown', label: 'the server refused the last scan', retryable: true };
}

/**
 * Delay before the next automatic attempt, doubling per consecutive failure
 * and capped.
 *
 * Number() is deliberately not used to read the count. Number(null) is 0 and
 * 0 is finite, so a nullish argument would sail through a Number.isFinite
 * check and be treated as "no failures yet" — which is how a blocked queue
 * would quietly go back to retrying every 20 seconds. Rejected by type.
 */
export function nextRetryDelayMs(consecutiveFailures) {
  const n = typeof consecutiveFailures === 'number' && Number.isFinite(consecutiveFailures)
    ? Math.max(0, Math.floor(consecutiveFailures))
    : 0;
  if (n <= 1) return FIRST_RETRY_MS;
  // 2 ** 30 ms is already far past the cap; clamp the exponent so a kiosk
  // left blocked for days cannot overflow into Infinity.
  const doublings = Math.min(n - 1, 20);
  return Math.min(FIRST_RETRY_MS * (2 ** doublings), MAX_RETRY_MS);
}

/** Seconds remaining, rounded up, for a human-facing countdown. */
export function secondsUntil(nextAttemptAt, now) {
  const at = typeof nextAttemptAt === 'number' && Number.isFinite(nextAttemptAt) ? nextAttemptAt : 0;
  const t = typeof now === 'number' && Number.isFinite(now) ? now : 0;
  return Math.max(0, Math.ceil((at - t) / 1000));
}

/**
 * The sentence under Recent Activity.
 *
 * Only ever promises an automatic sync when one is actually going to happen,
 * and says when. "Retrying in 40s" is falsifiable by standing there and
 * watching, which is the whole point — the old sentence was not.
 */
export function syncStatusText({ pending, online, blocked, secondsToRetry }) {
  const n = typeof pending === 'number' && Number.isFinite(pending) ? pending : 0;
  if (n <= 0) return '';
  const scans = `${n} scan${n === 1 ? '' : 's'}`;
  if (blocked) {
    const when = secondsToRetry > 0 ? ` Retrying in ${formatRetryGap(secondsToRetry)}.` : ' Retrying now.';
    return `${scans} queued — sync blocked: ${blocked}.${when}`;
  }
  if (online) return `Syncing ${n} offline ${n === 1 ? 'scan' : 'scans'}…`;
  return `${scans} queued — will sync automatically`;
}

function formatRetryGap(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

/**
 * Tracks consecutive failures and gates the next attempt.
 *
 * Clock injected rather than reading Date.now() inside, so the ladder can be
 * tested without waiting ten real minutes for the cap — the same shape
 * createUpdateGate() in Utils/appUpdate.js uses.
 */
export function createFlushGate({ now = () => Date.now() } = {}) {
  let failures = 0;
  let nextAttemptAt = 0;
  let block = null;

  return {
    /** False means "not yet" — the caller skips this tick without a request. */
    allow() {
      return now() >= nextAttemptAt;
    },
    recordSuccess() {
      failures = 0;
      nextAttemptAt = 0;
      block = null;
    },
    recordFailure(error) {
      failures += 1;
      const classified = classifyFlushError(error);
      block = classified.reason === 'none' ? null : classified;
      nextAttemptAt = now() + nextRetryDelayMs(failures);
      return classified;
    },
    /** A reconnect or a successful online scan is new information; start over. */
    reset() {
      failures = 0;
      nextAttemptAt = 0;
      block = null;
    },
    state() {
      return {
        failures,
        nextAttemptAt,
        // One failure is not yet a story worth telling an operator: a single
        // dropped request on a flaky link resolves itself 20 seconds later
        // and the old wording was right for exactly that case. The line only
        // changes once the queue has failed twice in a row.
        blocked: failures >= 2 && block ? block.label : null,
        reason: block ? block.reason : 'none',
        secondsToRetry: secondsUntil(nextAttemptAt, now()),
      };
    },
  };
}
