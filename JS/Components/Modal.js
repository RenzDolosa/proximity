// Every dialog in the app (Employee, Proximity Card, User, Reset Password,
// Scan Log) is built on this single scaffold, so they all share the exact
// same overlay/.modal DOM structure, sizing, and close behavior. Feature
// modals only ever provide their own inner markup + wiring.

/**
 * Create and mount a modal.
 * @param {string} innerHTML - markup rendered inside the `.modal` container
 *   (typically an `<h3>`, one or more `.field`s, and an `.actions` row).
 * @param {{ maxWidth?: string }} [options]
 * @returns {HTMLElement} the mounted `.overlay` element — pass it to
 *   `closeModal` when the user cancels/saves, and use `$('selector', overlay)`
 *   to scope lookups to this modal instance.
 */
let activeOverlay = null;
let activeCleanup = null;

export function openModal(innerHTML, { maxWidth } = {}) {
  // Only one modal at a time, app-wide. Several openers (EmployeeModal in
  // particular) do an async prefetch before rendering, so a rapid double
  // or triple click on the triggering button used to fire that many
  // concurrent openModal() calls and stack that many overlays. Tearing
  // down any existing overlay first means the DOM never has more than one,
  // no matter how many opens are in flight.
  if (activeOverlay) teardownActive();

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const style = maxWidth ? ` style="max-width:${maxWidth};"` : '';
  overlay.innerHTML = `<div class="modal"${style}>${innerHTML}</div>`;
  document.body.appendChild(overlay);
  activeOverlay = overlay;
  return overlay;
}

export function closeModal(overlay) {
  overlay.remove();
  if (activeOverlay === overlay) teardownActive();
}

function teardownActive() {
  if (activeCleanup) {
    try { activeCleanup(); } catch { /* best-effort */ }
    activeCleanup = null;
  }
  activeOverlay = null;
}

// For modals that hold onto a live resource for as long as they're open —
// ScanLogModal's Realtime subscription, so far — register a cleanup here
// right after opening it. It's guaranteed to run exactly once, whenever
// this modal closes, including when a newer modal's openModal() tears
// this one down first (a plain close-button handler alone would miss
// that path).
export function onModalClose(fn) {
  activeCleanup = fn;
}

let openSeq = 0;

// For modals that await something (a prefetch) before their first
// openModal() call — EmployeeModal, ScanLogModal, RemarksModal. Grab a
// token before the awaits; if a newer open has started by the time they
// resolve (another rapid click, possibly on a different row), bail out
// instead of rendering a stale modal that then gets torn down anyway by
// openModal()'s single-overlay guard — without this, whichever fetch
// happens to resolve last wins, which isn't necessarily the last thing
// the user clicked.
export function startModalOpen() {
  return ++openSeq;
}

export function isStaleModalOpen(token) {
  return token !== openSeq;
}

export function showModalError(overlay, selector, message) {
  const el = overlay.querySelector(selector);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}
