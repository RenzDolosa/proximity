// A hint that appears on hover instead of sitting under the control forever.
//
// The employee-status hint was three lines of permanent text below the
// dropdown, pushing the rest of the form down and read once then ignored.
// Moving it into a bubble reclaims the space and puts the explanation where
// it is wanted — at the moment someone is deciding which status to pick.
//
// The bubble sits ABOVE the control on purpose: a native <select> opens its
// options downward, so a hint rendered below would cover the very choices it
// is describing.
//
// Pure CSS for the show/hide (`:hover` plus `:focus-within`), so it costs no
// JS, works for keyboard users who tab into the field, and cannot leak a
// listener when a modal is torn down. The text is also on `aria-describedby`
// duty via the bubble's `role="tooltip"`.
import { esc } from '../Utils/format.js';

/**
 * Wraps a control so `text` appears above it on hover or focus.
 * `controlHTML` is inserted as-is — callers pass already-escaped markup.
 */
export function withHint(controlHTML, text) {
  if (!text) return controlHTML;
  return `<span class="hinted">${controlHTML}<span class="hint-bubble" role="tooltip">${esc(text)}</span></span>`;
}

// Suppresses the bubble while a native <select> inside the hint is actually
// open. There is no "dropdown is open" state in CSS, and the option list is
// drawn by the OS *outside* the page — so :hover on the <select> stays true
// underneath it and the bubble sits on top of the choices it describes.
//
// pointerdown is the open; change/blur are the two ways it closes. Delegated
// from the document so a modal rebuilt from innerHTML needs no re-wiring, and
// idempotent so repeated calls cannot stack handlers.
let hintDropdownWatchBound = false;

export function initHintDropdownWatch() {
  if (hintDropdownWatchBound) return;
  hintDropdownWatchBound = true;
  const close = (el) => el?.closest('.hinted')?.removeAttribute('data-open');
  document.addEventListener('pointerdown', (e) => {
    const select = e.target.closest?.('.hinted select');
    // Any other click closes whatever was open.
    document.querySelectorAll('.hinted[data-open]').forEach((h) => h.removeAttribute('data-open'));
    if (select) select.closest('.hinted').setAttribute('data-open', '');
  }, true);
  document.addEventListener('change', (e) => close(e.target), true);
  document.addEventListener('blur', (e) => close(e.target), true);
  // Escape closes a native dropdown without firing change or blur.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.hinted[data-open]').forEach((h) => h.removeAttribute('data-open'));
  }, true);
}
