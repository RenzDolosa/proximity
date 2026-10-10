// A value you can copy, with the button only appearing on hover.
//
// Proximity codes are ten digits that get read aloud, typed into other
// systems and pasted into messages. Selecting one by dragging across a table
// cell is fiddly and easy to get wrong by a character — and a wrong proximity
// code points at a different person.
//
// The button is hidden until hover (and on keyboard focus) so a column of
// these does not turn into a column of icons.
//
// One delegated listener for the whole app, bound once: tables re-render from
// innerHTML constantly here, and per-row listeners would be rebound on every
// repaint and leak on every teardown.
import { esc } from '../Utils/format.js';

/**
 * @param {string} value  the text to show and copy
 * @param {{ label?: string, className?: string }} [opts]
 *   `label` names the value for screen readers ("Copy proximity code").
 */
export function copyableHTML(value, { label = 'value', className = '' } = {}) {
  const v = String(value ?? '');
  if (!v) return '—';
  return `<span class="copyable ${esc(className)}">`
    + `<span class="copyable-text">${esc(v)}</span>`
    + `<button type="button" class="copyable-btn" data-copy="${esc(v)}" `
    + `title="Copy ${esc(label)}" aria-label="Copy ${esc(label)} ${esc(v)}">`
    + `<span aria-hidden="true">⧉</span></button></span>`;
}

let copyWatchBound = false;

export function initCopyWatch() {
  if (copyWatchBound) return;
  copyWatchBound = true;
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest?.('.copyable-btn');
    if (!btn) return;
    // A copyable inside a clickable row must not also trigger the row.
    e.preventDefault();
    e.stopPropagation();
    const value = btn.dataset.copy || '';
    let ok = false;
    try {
      await navigator.clipboard.writeText(value);
      ok = true;
    } catch {
      // Clipboard access is refused outside a secure context and in some
      // embedded webviews. Fall back to the old execCommand path rather than
      // failing silently — a kiosk on plain http is a real deployment here.
      ok = legacyCopy(value);
    }
    flash(btn, ok);
  });
}

function legacyCopy(value) {
  const ta = document.createElement('textarea');
  ta.value = value;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

// Confirmation on the button itself rather than a toast: at one copy per row
// a toast stack would be worse than no feedback at all.
function flash(btn, ok) {
  const mark = btn.querySelector('span');
  if (!mark) return;
  const original = mark.textContent;
  mark.textContent = ok ? '✓' : '✕';
  btn.classList.add(ok ? 'copied' : 'copy-failed');
  setTimeout(() => {
    mark.textContent = original;
    btn.classList.remove('copied', 'copy-failed');
  }, 1100);
}
