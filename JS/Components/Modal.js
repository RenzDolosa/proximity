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
export function openModal(innerHTML, { maxWidth } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  const style = maxWidth ? ` style="max-width:${maxWidth};"` : '';
  overlay.innerHTML = `<div class="modal"${style}>${innerHTML}</div>`;
  document.body.appendChild(overlay);
  return overlay;
}

export function closeModal(overlay) {
  overlay.remove();
}

export function showModalError(overlay, selector, message) {
  const el = overlay.querySelector(selector);
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}
