// Every dialog in the app (Employee, Proximity Card, User, Reset Password,
// Scan Log) is built on this single scaffold, so they all share the exact
// same overlay/.modal DOM structure, sizing, and close behavior. Feature
// modals only ever provide their own inner markup + wiring.
//
// Modals can stack (e.g. opening Scan Log from within an Edit Employee
// flow isn't done today, but Import can be opened while another dialog is
// still around in some flows) — a simple open stack means Esc and a
// backdrop click each only ever close the TOPMOST layer, never everything
// at once.
const modalStack = [];

function handleGlobalKeydown(e) {
  if (e.key !== 'Escape') return;
  const top = modalStack[modalStack.length - 1];
  if (top) closeModal(top);
}

/**
 * Create and mount a modal.
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

  modalStack.push(overlay);
  if (modalStack.length === 1) document.addEventListener('keydown', handleGlobalKeydown);

  // mousedown (not click) so a drag that starts on the modal and ends on
  // the backdrop — e.g. selecting text — doesn't accidentally close it.
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) closeModal(overlay);
  });

  return overlay;
}

export function closeModal(overlay) {
  const idx = modalStack.indexOf(overlay);
  if (idx !== -1) modalStack.splice(idx, 1);
  overlay.remove();
  if (modalStack.length === 0) document.removeEventListener('keydown', handleGlobalKeydown);
}

export function showModalError(overlay, selector, message) {
  const el = overlay.querySelector(selector);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}
