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
