// Shared pagination bar: a page-size select (20/50/100/500) + prev/next.
// Every table page keeps its own {page, pageSize} in module state, slices
// its already-fetched rows before rendering, and calls this after the
// table to draw the controls and wire them back to a repaint.
import { $ } from '../Utils/dom.js';

export const PAGE_SIZES = [20, 50, 100, 500];

/**
 * @param {HTMLElement} el - container to render the pagination bar into.
 * @param {{ total:number, page:number, pageSize:number, onChange:(next:{page:number,pageSize:number})=>void }} opts
 * @returns {number} the clamped current page, in case total shrank under it.
 */
export function renderPagination(el, { total, page, pageSize, onChange }) {
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
  $('#pg-size', el).addEventListener('change', (e) => onChange({ page: 1, pageSize: Number(e.target.value) }));
  $('#pg-prev', el).addEventListener('click', () => onChange({ page: current - 1, pageSize }));
  $('#pg-next', el).addEventListener('click', () => onChange({ page: current + 1, pageSize }));
  return current;
}
