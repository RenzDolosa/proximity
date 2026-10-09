// One control for a date range, instead of two bare <input type="date"> boxes
// sitting side by side.
//
// The old pairs took roughly twice the width, showed "dd/mm/yyyy · to ·
// dd/mm/yyyy" even when no range was set, and offered no way to say "last 7
// days" without typing both ends. This collapses to a single button showing
// the current range, with the two inputs and a few shortcuts behind it.
//
// Native <input type="date"> is kept inside the popover on purpose: a
// hand-built calendar grid is a lot of surface to get wrong (locale, week
// start, keyboard, mobile) and buys nothing here. The presets are what people
// actually reach for.
//
// Nothing in this component fetches. It reports a range and the caller decides
// what to do with it, so adding a picker never adds a request.
import { esc } from '../Utils/format.js';
import {
  RANGE_PRESETS, rangeFromPreset, formatRangeLabel, normaliseRange,
} from '../Utils/dateRangePresets.js';

/**
 * @param {string} id        unique element id
 * @param {object} [opts]
 * @param {string} [opts.from] 'YYYY-MM-DD'
 * @param {string} [opts.to]   'YYYY-MM-DD'
 * @param {string} [opts.emptyLabel] what to read when no range is set
 */
export function dateRangePickerHTML(id, { from = '', to = '', emptyLabel = 'All dates' } = {}) {
  return `
    <div class="drp" id="${esc(id)}" data-empty-label="${esc(emptyLabel)}">
      <button type="button" class="drp-trigger" aria-haspopup="dialog" aria-expanded="false">
        <span class="drp-value">${esc(formatRangeLabel(from, to, emptyLabel))}</span>
        <span class="drp-caret" aria-hidden="true">▾</span>
      </button>
      <div class="drp-pop" hidden role="dialog" aria-label="Choose a date range">
        <div class="drp-presets">
          ${RANGE_PRESETS.map((p) => `<button type="button" data-preset="${esc(p.id)}">${esc(p.label)}</button>`).join('')}
        </div>
        <div class="drp-fields">
          <label>From<input type="date" class="drp-from" value="${esc(from)}" /></label>
          <label>To<input type="date" class="drp-to" value="${esc(to)}" /></label>
        </div>
        <div class="drp-actions">
          <button type="button" class="ghost drp-clear">Clear</button>
          <button type="button" class="primary drp-apply">Apply</button>
        </div>
      </div>
    </div>`;
}

/**
 * Wires a rendered picker. Returns { get, set, destroy }.
 * `onApply({ from, to })` fires only when Apply, Clear or a preset is used —
 * never while someone is still typing a date, so a caller that refetches on
 * change cannot fire a request per keystroke.
 */
export function mountDateRangePicker(root, { onApply } = {}) {
  if (!root) return null;
  const trigger = root.querySelector('.drp-trigger');
  const pop = root.querySelector('.drp-pop');
  const valueEl = root.querySelector('.drp-value');
  const fromEl = root.querySelector('.drp-from');
  const toEl = root.querySelector('.drp-to');
  const emptyLabel = root.dataset.emptyLabel || 'All dates';

  const paint = () => {
    valueEl.textContent = formatRangeLabel(fromEl.value, toEl.value, emptyLabel);
    root.classList.toggle('drp-set', Boolean(fromEl.value || toEl.value));
  };
  const setOpen = (open) => {
    pop.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  };
  const apply = () => {
    const next = normaliseRange(fromEl.value, toEl.value);
    fromEl.value = next.from;
    toEl.value = next.to;
    paint();
    setOpen(false);
    onApply?.(next);
  };

  trigger.addEventListener('click', () => setOpen(pop.hidden));
  root.querySelector('.drp-apply').addEventListener('click', apply);
  root.querySelector('.drp-clear').addEventListener('click', () => {
    fromEl.value = '';
    toEl.value = '';
    apply();
  });
  root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const r = rangeFromPreset(b.dataset.preset);
    if (!r) return;
    fromEl.value = r.from;
    toEl.value = r.to;
    apply();
  }));
  // Typing updates the label live, but never notifies the caller — see onApply.
  fromEl.addEventListener('change', paint);
  toEl.addEventListener('change', paint);

  const onDocPointer = (e) => { if (!root.contains(e.target)) setOpen(false); };
  const onKey = (e) => {
    if (e.key !== 'Escape' || pop.hidden) return;
    setOpen(false);
    trigger.focus();
    // A picker inside a modal must not also close the modal.
    e.stopPropagation();
  };
  document.addEventListener('pointerdown', onDocPointer);
  root.addEventListener('keydown', onKey);

  paint();
  return {
    get: () => normaliseRange(fromEl.value, toEl.value),
    set: ({ from = '', to = '' }) => { fromEl.value = from; toEl.value = to; paint(); },
    // Modals are torn down and rebuilt; without this the document-level
    // listener would outlive the element it closes.
    destroy: () => document.removeEventListener('pointerdown', onDocPointer),
  };
}
