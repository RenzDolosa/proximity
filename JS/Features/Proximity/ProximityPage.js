import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { openCardModal, openRevokeCardModal } from '../../Components/ProximityCardModal.js';
import { openImportModal } from '../../Components/ImportModal.js';
import { paginationBar, wirePagination } from '../../Components/Pagination.js';

// Server-side paged + searched, same reasoning as DirectoryPage.js — see
// ProximityCardsModel#listDirectoryPage (backed by the
// proximity_card_directory view so the assignee's name/code is
// searchable in the same query, no client-side join needed).
const tableState = { page: 1, pageSize: 20, total: 0, search: '', status: 'all' };
let searchDebounce = null;

export async function renderProximity() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-filters">
        <input class="search" id="prox-search" placeholder="Search proximity code or assignee…" value="${esc(tableState.search)}" />
        <select id="prox-filter">
          <option value="all" ${tableState.status === 'all' ? 'selected' : ''}>All statuses</option>
          <option value="active" ${tableState.status === 'active' ? 'selected' : ''}>Active only</option>
          <option value="revoked" ${tableState.status === 'revoked' ? 'selected' : ''}>Revoked only</option>
        </select>
      </div>
      ${isAdminOrManager() ? `
        <div class="toolbar-actions">
          ${isAdmin() ? '<button class="ghost danger" id="prox-delete-all">Delete all</button>' : ''}
          <button class="ghost" id="prox-import">Import</button>
          <button class="primary" id="prox-add">+ Issue proximity card</button>
        </div>
      ` : ''}
    </div>
    <div id="prox-table-wrap">Loading…</div>
  `;

  $('#prox-search').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const value = e.target.value;
    searchDebounce = setTimeout(() => {
      tableState.search = value;
      tableState.page = 1;
      loadProximityPage();
    }, 300);
  });
  $('#prox-filter').addEventListener('change', (e) => {
    tableState.status = e.target.value;
    tableState.page = 1;
    loadProximityPage();
  });

  if (isAdmin()) {
    $('#prox-delete-all').addEventListener('click', async () => {
      if (!confirm(`Permanently delete every unassigned proximity card? Assigned cards are left untouched. This can't be undone.`)) return;
      const { data: deletedCount, error } = await ProximityCardsModel.deleteAllUnassigned();
      if (error) toast(error.message, 'error');
      else { toast(`${deletedCount ?? 0} unassigned card${deletedCount === 1 ? '' : 's'} deleted`); tableState.page = 1; loadProximityPage(); }
    });
  }
  if (isAdminOrManager()) {
    $('#prox-add').addEventListener('click', () => openCardModal(() => loadProximityPage()));
    $('#prox-import').addEventListener('click', () => openImportModal({
      title: 'Import proximity cards',
      description: 'One row per card. Cards are issued unassigned — link them to an employee afterward from Employee Manager.',
      columns: [{ key: 'proximity_code', label: 'proximity_code', required: true }],
      sampleRow: { proximity_code: 'PRX-00099' },
      onImport: importCards,
    }, () => { tableState.page = 1; loadProximityPage(); }));
  }

  await loadProximityPage();
}

async function loadProximityPage() {
  const wrap = $('#prox-table-wrap');
  if (!wrap) return;
  wrap.classList.add('table-loading');
  const { data, error, count } = await ProximityCardsModel.listDirectoryPage({
    page: tableState.page, pageSize: tableState.pageSize, search: tableState.search, status: tableState.status,
  });
  if (error) { wrap.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  tableState.total = count ?? (data || []).length;
  paintProximityTable(data || []);
}

function paintProximityTable(rows) {
  const wrap = $('#prox-table-wrap');
  wrap.classList.remove('table-loading');
  const filtered = tableState.status !== 'all' || tableState.search;
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><strong>No proximity cards${filtered ? ' match this filter' : ' yet'}</strong>${filtered ? 'Try a different search or status.' : "Issue a card — it doesn't need to be assigned to anyone right away."}</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Proximity code</th><th>Assigned to</th><th>Status</th><th>Issued</th><th class="col-shrink"></th></tr></thead>
      <tbody>
        ${rows.map((c) => `
          <tr>
            <td class="mono">${esc(c.proximity_code)}</td>
            <td>${c.employee_id ? esc(c.employee_name) + ' <span class="emp-meta mono">(' + esc(c.employee_code) + ')</span>' : '<span style="color:var(--text-faint)">unassigned</span>'}</td>
            <td><span class="badge ${c.is_active ? 'active' : 'inactive'}">${c.is_active ? 'active' : 'revoked'}</span></td>
            <td>${fmtTime(c.issued_at)}</td>
            <td class="row-actions col-shrink">
              ${isAdminOrManager() && c.is_active ? `<button class="ghost" data-revoke="${c.id}" style="color:var(--warn)">Revoke</button>` : ''}
              ${isAdminOrManager() && !c.is_active ? `<button class="ghost" data-renew="${c.id}" style="color:var(--good)">Renew</button>` : ''}
              ${isAdmin() && !c.employee_id ? `<button class="ghost" data-del="${c.id}" style="color:var(--bad)">Delete</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${paginationBar(tableState)}
  `;
  wirePagination(wrap, tableState, loadProximityPage);
  $$('button[data-revoke]', wrap).forEach((b) => b.addEventListener('click', () => {
    const card = rows.find((c) => c.id === b.dataset.revoke);
    openRevokeCardModal(card, () => loadProximityPage());
  }));
  $$('button[data-renew]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await ProximityCardsModel.renew(b.dataset.renew);
    if (error) toast(error.message, 'error'); else { toast('Card renewed'); loadProximityPage(); }
  }));
  $$('button[data-del]', wrap).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Permanently delete this card record?')) return;
    const { error } = await ProximityCardsModel.remove(b.dataset.del);
    if (error) toast(error.message, 'error'); else { toast('Card deleted'); loadProximityPage(); }
  }));
}

// Row shape expected: proximity_code (required). Cards are always issued
// unassigned. Rewritten to bulk-insert in chunks for the same reason as
// importEmployees in DirectoryPage.js — one round trip per ~250 rows
// instead of one per row, falling back to per-row only for a chunk that
// actually fails.
const IMPORT_CHUNK_SIZE = 250;

async function importCards(records) {
  const errors = [];
  let successCount = 0;
  const seen = new Set();
  const valid = [];

  records.forEach((r, i) => {
    const line = i + 2;
    const proximity_code = (r.proximity_code || '').trim();
    if (!proximity_code) { errors.push({ line, message: 'proximity_code is required.' }); return; }
    const key = proximity_code.toLowerCase();
    if (seen.has(key)) { errors.push({ line, message: `Duplicate proximity_code "${proximity_code}" elsewhere in this file.` }); return; }
    seen.add(key);
    valid.push({ line, proximity_code });
  });

  for (let i = 0; i < valid.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = valid.slice(i, i + IMPORT_CHUNK_SIZE);
    const { error: chunkErr } = await ProximityCardsModel.issueMany(chunk.map((r) => r.proximity_code), appState.session.user.id);
    if (!chunkErr) { successCount += chunk.length; continue; }
    for (const r of chunk) {
      const { error: rowErr } = await ProximityCardsModel.issue(r.proximity_code, appState.session.user.id);
      if (rowErr) errors.push({ line: r.line, message: rowErr.message });
      else successCount++;
    }
  }

  return { successCount, errors };
}
