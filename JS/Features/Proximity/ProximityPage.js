import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime, chunkArray } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { openCardModal } from '../../Components/ProximityCardModal.js';
import { openImportModal } from '../../Components/ImportModal.js';
import { renderPagination } from '../../Components/Pagination.js';
import { openConfirmModal, openConfirmProgressModal } from '../../Components/ConfirmModal.js';

let cardsCache = [];
let assignedByCard = new Map();
let page = 1;
let pageSize = 50;
let loaded = false; // distinguishes "never fetched yet" from "fetched, zero rows"

export async function renderProximity() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar">
      <div class="filter-row">
        <input class="search" id="prox-search" placeholder="Search proximity code or assignee…" />
        <select id="prox-filter">
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="revoked">Revoked only</option>
        </select>
      </div>
      ${isAdminOrManager() ? `
        <div style="display:flex;gap:8px;">
          ${isAdmin() ? '<button class="ghost danger" id="prox-delete-all">Delete all</button>' : ''}
          <button class="ghost" id="prox-import">Import</button>
          <button class="primary" id="prox-add">+ Issue proximity card</button>
        </div>
      ` : ''}
    </div>
    <div class="table-scroll"><div id="prox-table-wrap">${loaded ? '' : 'Loading…'}</div></div>
    <div id="prox-pagination"></div>
  `;
  $('#prox-search').addEventListener('input', () => { page = 1; paintProximityTable(); });
  $('#prox-filter').addEventListener('change', () => { page = 1; paintProximityTable(); });
  if (isAdmin()) {
    $('#prox-delete-all').addEventListener('click', async () => {
      // Assigned cards can't be deleted (employees.proximity_card_id is a
      // required FK) — same rule the per-row Delete button already follows.
      const deletableCount = cardsCache.filter((c) => !assignedByCard.has(c.id)).length;
      if (!deletableCount) { toast('No unassigned cards to delete.', 'error'); return; }
      const skipped = cardsCache.length - deletableCount;
      const { confirmed, result } = await openConfirmProgressModal({
        title: 'Delete all unassigned cards?',
        message: `Permanently delete ${deletableCount} unassigned card${deletableCount === 1 ? '' : 's'}?` +
          (skipped ? ` ${skipped} assigned card${skipped === 1 ? '' : 's'} will be left untouched.` : '') +
          ` This can't be undone.`,
        confirmLabel: 'Delete all',
        task: async (onProgress) => {
          onProgress(0, 1);
          const { data, error } = await ProximityCardsModel.deleteAllUnassigned();
          onProgress(1, 1);
          return { error, count: data };
        },
      });
      if (!confirmed) return;
      if (result.error) toast(result.error.message, 'error');
      else { toast(`Deleted ${result.count} unassigned card${result.count === 1 ? '' : 's'}`); renderProximity(); }
    });
  }
  if (isAdminOrManager()) {
    $('#prox-add').addEventListener('click', () => openCardModal(renderProximity));
    $('#prox-import').addEventListener('click', () => openImportModal({
      title: 'Import proximity cards',
      description: 'One row per card. Cards are issued unassigned — link them to an employee afterward from Employee Manager.',
      columns: [{ key: 'proximity_code', label: 'proximity_code', required: true }],
      sampleRow: { proximity_code: 'PRX-00099' },
      onImport: importCards,
    }, renderProximity));
  }

  // Stale-while-revalidate: paint from cache immediately (no "Loading…"
  // flash) while the fresh fetch runs, if we've already loaded once.
  if (loaded) paintProximityTable();

  const [{ data, error }, { data: emps }] = await Promise.all([
    ProximityCardsModel.listForTable(),
    EmployeesModel.listForCardAssignment(),
  ]);
  if (error) { $('#prox-table-wrap').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  cardsCache = data || [];
  assignedByCard = new Map((emps || []).map((e) => [e.proximity_card_id, e]));
  loaded = true;
  page = 1;
  paintProximityTable();
}

function paintProximityTable() {
  const wrap = $('#prox-table-wrap');
  const statusFilter = $('#prox-filter').value;
  const q = $('#prox-search').value.trim().toLowerCase();
  const allRows = cardsCache.filter((c) => {
    if (statusFilter !== 'all' && (statusFilter === 'active') !== c.is_active) return false;
    if (!q) return true;
    const e = assignedByCard.get(c.id);
    return [c.proximity_code, e?.full_name, e?.employee_code].some((v) => (v || '').toLowerCase().includes(q));
  });
  const filtered = statusFilter !== 'all' || q;
  if (!allRows.length) {
    wrap.innerHTML = `<div class="empty-state"><strong>No proximity cards${filtered ? ' match this filter' : ' yet'}</strong>${filtered ? 'Try a different search or status.' : "Issue a card — it doesn't need to be assigned to anyone right away."}</div>`;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  page = Math.min(Math.max(1, page), totalPages);
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize);
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Proximity code</th><th>Assigned to</th><th class="col-shrink">Status</th><th class="col-shrink">Issued</th><th class="col-shrink"></th></tr></thead>
      <tbody>
        ${rows.map((c) => { const e = assignedByCard.get(c.id); return `
          <tr>
            <td class="mono">${esc(c.proximity_code)}</td>
            <td>${e ? esc(e.full_name) + ' <span class="emp-meta mono">(' + esc(e.employee_code) + ')</span>' : '<span style="color:var(--text-faint)">unassigned</span>'}</td>
            <td class="col-shrink"><span class="badge ${c.is_active ? 'active' : 'inactive'}">${c.is_active ? 'active' : 'revoked'}</span></td>
            <td class="col-shrink mono">${fmtTime(c.issued_at)}</td>
            <td class="col-shrink"><div class="row-actions">
              ${isAdminOrManager() && c.is_active ? `<button class="ghost" data-revoke="${c.id}" style="color:var(--warn)">Revoke</button>` : ''}
              ${isAdminOrManager() && !c.is_active ? `<button class="ghost" data-renew="${c.id}" style="color:var(--good)">Renew</button>` : ''}
              ${isAdmin() && !e ? `<button class="ghost" data-del="${c.id}" style="color:var(--bad)">Delete</button>` : ''}
            </div></td>
          </tr>
        `; }).join('')}
      </tbody>
    </table>
  `;
  renderPagination($('#prox-pagination'), {
    total: allRows.length, page, pageSize,
    onChange: (next) => { page = next.page; pageSize = next.pageSize; paintProximityTable(); },
  });
  // Revoke/renew update the one row that changed in place, instead of
  // calling renderProximity() (which wiped the whole page back to
  // "Loading…" and re-fetched both tables just to flip one badge).
  $$('button[data-revoke]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.revoke;
    const { error } = await ProximityCardsModel.revoke(id);
    if (error) { toast(error.message, 'error'); return; }
    const card = cardsCache.find((c) => c.id === id);
    if (card) { card.is_active = false; card.revoked_at = new Date().toISOString(); }
    toast('Card revoked');
    paintProximityTable();
  }));
  $$('button[data-renew]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.renew;
    const { error } = await ProximityCardsModel.renew(id);
    if (error) { toast(error.message, 'error'); return; }
    const card = cardsCache.find((c) => c.id === id);
    if (card) { card.is_active = true; card.revoked_at = null; card.issued_at = new Date().toISOString(); }
    toast('Card renewed');
    paintProximityTable();
  }));
  $$('button[data-del]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.del;
    const card = cardsCache.find((c) => c.id === id);
    const ok = await openConfirmModal({
      title: 'Delete this card?',
      message: `Permanently delete proximity card? This can't be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const { error } = await ProximityCardsModel.remove(id);
    if (error) { toast(error.message, 'error'); return; }
    cardsCache = cardsCache.filter((c) => c.id !== id);
    toast('Card deleted');
    paintProximityTable();
  }));
}

// Row shape expected: proximity_code (required). Cards are always issued
// unassigned — same as clicking "+ Issue proximity card" one row at a
// time, just done as a couple of chunked bulk inserts instead of one
// network round-trip per row (see importEmployees in DirectoryPage.js for
// the same pattern with more detail).
async function importCards(records) {
  const errors = [];
  const CHUNK_SIZE = 200;
  const seen = new Map(); // code(lower) -> line, catches duplicates within the file

  const rows = [];
  records.forEach((r, i) => {
    const line = i + 2;
    const proximity_code = (r.proximity_code || '').trim();
    if (!proximity_code) { errors.push({ line, message: 'proximity_code is required.' }); return; }
    const key = proximity_code.toLowerCase();
    if (seen.has(key)) { errors.push({ line, message: `Proximity code "${proximity_code}" is already used by row ${seen.get(key)} in this file.` }); return; }
    seen.set(key, line);
    rows.push({ line, proximity_code });
  });

  let successCount = 0;
  for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
    const { error } = await ProximityCardsModel.issueMany(
      chunk.map((r) => ({ proximity_code: r.proximity_code, created_by: appState.session.user.id }))
    );
    if (!error) { successCount += chunk.length; continue; }
    for (const r of chunk) {
      const { error: singleErr } = await ProximityCardsModel.issue(r.proximity_code, appState.session.user.id);
      if (singleErr) errors.push({ line: r.line, message: singleErr.message });
      else successCount++;
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return { successCount, errors };
}
