// Shared pagination bar: a page-size select (20/50/100/500) + prev/next.
// Every table page keeps its own {page, pageSize} in module state, slices
// its already-fetched rows before rendering, and calls this after the
// table to draw the controls and wire them back to a repaint.
import { $ } from '../Utils/dom.js';

export const PAGE_SIZES = [20, 50, 100, 500];

// "Module state" is the sentence above, and module state dies with the tab.
// So a reviewer who set Attendance to 100 to read a week at a glance got 50
// again on the next reload, on every table, every day. The choice is a
// property of the person and the table, which is what localStorage is for.
//
// PER TABLE, not one shared setting: 100 rows is right for scanning a week
// of attendance and wrong for the audit log. One key each.
const SIZE_KEY = (name) => `proximity.pageSize.${name}`;

/**
 * The remembered page size for a table, or the caller's default.
 *
 * Validated against PAGE_SIZES rather than merely parsed: a stale or
 * hand-edited key must not put a number in the state that the select cannot
 * display, which would leave the control showing nothing selected.
 */
export function readPageSize(name, fallback = 50) {
  try {
    const stored = Number(localStorage.getItem(SIZE_KEY(name)));
    return PAGE_SIZES.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

function writePageSize(name, size) {
  try { localStorage.setItem(SIZE_KEY(name), String(size)); } catch { /* private mode — honour it for this session only */ }
}

/**
 * @param {HTMLElement} el - container to render the pagination bar into.
 * @param {{ total:number, page:number, pageSize:number, onChange:(next:{page:number,pageSize:number})=>void, storeAs?:string }} opts
 *   `storeAs` names the table, so its page size is remembered across
 *   reloads. Omit it and nothing is stored — the behaviour before this.
 * @returns {number} the clamped current page, in case total shrank under it.
 */
export function renderPagination(el, { total, page, pageSize, onChange, storeAs }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = Math.min(current * pageSize, total);

  el.innerHTML = `
    <div class="pagination">
      <div class="pagination-info">${total === 0 ? 'No results' : `${start}–${end} of ${total}`}</div>
      <div class="pagination-controls">
        <label class="pagination-size">
          Show
          <select id="pg-size">
            ${PAGE_SIZES.map((s) => `<option value="${s}" ${s === pageSize ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </label>
        <button class="ghost" id="pg-prev" ${current <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <span class="pagination-page">Page ${current} / ${totalPages}</span>
        <button class="ghost" id="pg-next" ${current >= totalPages ? 'disabled' : ''}>Next ›</button>
      </div>
    </div>
  `;
  $('#pg-size', el).addEventListener('change', (e) => {
    const next = Number(e.target.value);
    if (storeAs) writePageSize(storeAs, next);
    onChange({ page: 1, pageSize: next });
  });
  $('#pg-prev', el).addEventListener('click', () => onChange({ page: current - 1, pageSize }));
  $('#pg-next', el).addEventListener('click', () => onChange({ page: current + 1, pageSize }));
  return current;
}
