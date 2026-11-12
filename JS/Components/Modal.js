// Every dialog in the app (Employee, Proximity Card, User, Reset Password,
// Scan Log, Revoke Card, etc.) is built on this single scaffold, so they
// all share the exact same overlay/.modal DOM structure, sizing, and close
// behavior. Feature modals only ever provide their own inner markup + wiring.
//
// Modals can legitimately stack — e.g. a confirm dialog opened while an
// edit form is still open underneath it. Each openModal() call pushes a
// new layer on top rather than replacing whatever's already open; closing
// one (via its own button, Escape, or a click on its backdrop) only ever
// removes that single layer and reveals whatever was beneath it.

/** @type {{ overlay: HTMLElement, cleanup: (() => void) | null, locked: boolean, guard: (() => boolean|Promise<boolean>) | null, asking: boolean }[]} */
const stack = [];

/**
 * Create and mount a modal as the new topmost layer.
 * @param {string} innerHTML - markup rendered inside the `.modal` container
 *   (typically an `<h3>`, one or more `.field`s, and an `.actions` row).
 * @param {{ maxWidth?: string }} [options]
 * @returns {HTMLElement} the mounted `.overlay` element — pass it to
 *   `closeModal` when the user cancels/saves, and use `$('selector', overlay)`
 *   to scope lookups to this modal instance.
 */
export function openModal(innerHTML, { maxWidth } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const style = maxWidth ? ` style="max-width:${maxWidth};"` : '';
  overlay.innerHTML = `<div class="modal"${style}>${innerHTML}</div>`;
  document.body.appendChild(overlay);

  // A click that both starts and ends directly on the backdrop (not
  // bubbled up from something inside .modal) closes just this layer.
  overlay.addEventListener('click', async (e) => {
    if (e.target !== overlay) return;
    const entry = stack.find((x) => x.overlay === overlay);
    if (!entry) { overlay.remove(); return; }

    // LOCKED WAS ONLY EVER HONOURED BY ESCAPE. setModalLocked's own comment
    // says it suppresses "Escape and backdrop-click", and this handler never
    // checked it — so a stray click during a running import closed the
    // dialog while the import carried on in the background, taking its
    // progress bar with it.
    if (entry.locked) return;

    if (entry.guard) {
      // A confirm is already open over this layer. Without this, clicking
      // the backdrop again while being asked stacks a second identical
      // question, and answering one leaves the other orphaned.
      if (entry.asking) return;
      entry.asking = true;
      let mayClose = false;
      try { mayClose = await entry.guard(); } catch { mayClose = false; } finally { entry.asking = false; }
      if (!mayClose) return;
    }
    closeModal(overlay);
  });

  stack.push({ overlay, cleanup: null, locked: false, guard: null, asking: false });
  return overlay;
}

export function closeModal(overlay) {
  const idx = stack.findIndex((entry) => entry.overlay === overlay);
  if (idx === -1) { overlay.remove(); return; } // already closed, or never tracked
  const [entry] = stack.splice(idx, 1);
  entry.overlay.remove();
  if (entry.cleanup) {
    try { entry.cleanup(); } catch { /* best-effort */ }
  }
}

// Escape closes only the topmost layer. If another modal is open beneath
// it, that one is left open and revealed — never a "close everything" jump.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (top && !top.locked) closeModal(top.overlay);
});

// A handful of flows shouldn't be dismissible mid-flight — e.g. a bulk
// delete or import that's actively running, with no visible Cancel action
// once started. Locking suppresses Escape and backdrop-click for that one
// layer (its own explicit buttons, if any, still work) until unlocked.
export function setModalLocked(overlay, locked) {
  const entry = stack.find((e) => e.overlay === overlay);
  if (entry) entry.locked = locked;
}

/**
 * Ask before a backdrop click throws work away.
 *
 * The guard returns true to allow the close, false to keep the dialog open,
 * and may be async so it can put a question on screen first. Modal.js
 * deliberately does not know what the question is — importing ConfirmModal
 * here would make a cycle, since ConfirmModal is built on this file. See
 * Components/unsavedGuard.js for the one everything uses.
 *
 * ESCAPE IS NOT GUARDED, and that is the intended difference. Escape is a
 * deliberate "get me out of here"; a backdrop click is usually a miss aimed
 * at a field. Confirming on both would make every dialog feel sticky in
 * exchange for catching a keystroke nobody presses by accident.
 */
export function setCloseGuard(overlay, guard) {
  const entry = stack.find((e) => e.overlay === overlay);
  if (entry) entry.guard = typeof guard === 'function' ? guard : null;
}

// For modals that hold onto a live resource for as long as they're open —
// ScanLogModal's Realtime subscription, so far. Registers cleanup against
// whichever modal is currently topmost, so call this immediately after
// that modal's own openModal(), before anything else can open on top of
// it. Guaranteed to run exactly once, whenever this specific layer closes
// — including via Escape or a backdrop click, not just its own button.
export function onModalClose(fn) {
  const entry = stack[stack.length - 1];
  if (entry) entry.cleanup = fn;
}

let openSeq = 0;

// For modals that await something (a prefetch) before their first
// openModal() call — EmployeeModal, ScanLogModal, RemarksModal. Grab a
// token before the awaits; if a newer open has started by the time they
// resolve (another rapid click, possibly on a different row), bail out
// instead of rendering a stale modal — without this, whichever fetch
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
