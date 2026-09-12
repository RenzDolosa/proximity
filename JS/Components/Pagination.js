// Reusable pagination bar for any server-paginated table. Renders the
// markup and wires prev/next/page-size — the caller just supplies the
// current { page, pageSize, total } and a callback for when either changes.
import { $ } from '../Utils/dom.js';

export const PAGE_SIZE_OPTIONS = [20, 50, 100, 500];

export function paginationBar({ page, pageSize, total }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return `
    <div class="pagination">
      <div class="pagination-info">${total === 0 ? 'No results' : `Showing ${start}\u2013${end} of ${total}`}</div>
      <div class="pagination-controls">
        <select id="pg-size">
          ${PAGE_SIZE_OPTIONS.map((n) => `<option value="${n}" ${n === pageSize ? 'selected' : ''}>${n} / page</option>`).join('')}
        </select>
        <button class="ghost" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>
        <span class="pagination-page">Page ${page} of ${totalPages}</span>
        <button class="ghost" id="pg-next" ${page >= totalPages ? 'disabled' : ''}>Next ›</button>
      </div>
    </div>
  `;
}

/**
 * Wire up a pagination bar that was just rendered into `root`.
 * @param {HTMLElement} root - container the pagination markup was rendered into
 * @param {{page:number,pageSize:number,total:number}} state - current state (mutated in place)
 * @param {() => void} onChange - called after `state.page`/`state.pageSize` changes; re-fetch + re-render here
 */
export function wirePagination(root, state, onChange) {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  $('#pg-size', root).addEventListener('change', (e) => {
    state.pageSize = Number(e.target.value);
    state.page = 1; // page size changed — start back at the top rather than landing mid-list
    onChange();
  });
  $('#pg-prev', root).addEventListener('click', () => {
    if (state.page > 1) { state.page -= 1; onChange(); }
  });
  $('#pg-next', root).addEventListener('click', () => {
    if (state.page < totalPages) { state.page += 1; onChange(); }
  });
}
