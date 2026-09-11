import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { openCardModal } from '../../Components/ProximityCardModal.js';
import { openImportModal } from '../../Components/ImportModal.js';

let cardsCache = [];
let assignedByCard = new Map();

export async function renderProximity() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar">
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input class="search" id="prox-search" placeholder="Search proximity code or assignee…" />
        <select id="prox-filter" style="max-width:180px;">
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
    <div id="prox-table-wrap">Loading…</div>
  `;
  $('#prox-search').addEventListener('input', () => paintProximityTable());
  $('#prox-filter').addEventListener('change', () => paintProximityTable());
  if (isAdmin()) {
    $('#prox-delete-all').addEventListener('click', async () => {
      // Assigned cards can't be deleted (employees.proximity_card_id is a
      // required FK) — same rule the per-row Delete button already follows.
      const deletable = cardsCache.filter((c) => !assignedByCard.has(c.id));
      if (!deletable.length) { toast('No unassigned cards to delete.', 'error'); return; }
      const skipped = cardsCache.length - deletable.length;
      const msg = `Permanently delete ${deletable.length} unassigned card${deletable.length === 1 ? '' : 's'}?` +
        (skipped ? ` (${skipped} assigned card${skipped === 1 ? '' : 's'} will be left untouched.)` : '') +
        ` This can't be undone.`;
      if (!confirm(msg)) return;
      const { error } = await ProximityCardsModel.removeMany(deletable.map((c) => c.id));
      if (error) toast(error.message, 'error'); else { toast('Unassigned cards deleted'); renderProximity(); }
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

  const [{ data, error }, { data: emps }] = await Promise.all([
    ProximityCardsModel.listForTable(),
    EmployeesModel.listForCardAssignment(),
  ]);
  if (error) { $('#prox-table-wrap').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  cardsCache = data || [];
  assignedByCard = new Map((emps || []).map((e) => [e.proximity_card_id, e]));
  paintProximityTable();
}

function paintProximityTable() {
  const wrap = $('#prox-table-wrap');
  const statusFilter = $('#prox-filter').value;
  const q = $('#prox-search').value.trim().toLowerCase();
  const rows = cardsCache.filter((c) => {
    if (statusFilter !== 'all' && (statusFilter === 'active') !== c.is_active) return false;
    if (!q) return true;
    const e = assignedByCard.get(c.id);
    return [c.proximity_code, e?.full_name, e?.employee_code].some((v) => (v || '').toLowerCase().includes(q));
  });
  const filtered = statusFilter !== 'all' || q;
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><strong>No proximity cards${filtered ? ' match this filter' : ' yet'}</strong>${filtered ? 'Try a different search or status.' : "Issue a card — it doesn't need to be assigned to anyone right away."}</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Proximity code</th><th>Assigned to</th><th>Status</th><th>Issued</th><th class="col-shrink"></th></tr></thead>
      <tbody>
        ${rows.map((c) => { const e = assignedByCard.get(c.id); return `
          <tr>
            <td class="mono">${esc(c.proximity_code)}</td>
            <td>${e ? esc(e.full_name) + ' <span class="emp-meta mono">(' + esc(e.employee_code) + ')</span>' : '<span style="color:var(--text-faint)">unassigned</span>'}</td>
            <td><span class="badge ${c.is_active ? 'active' : 'inactive'}">${c.is_active ? 'active' : 'revoked'}</span></td>
            <td>${fmtTime(c.issued_at)}</td>
            <td class="row-actions col-shrink">
              ${isAdminOrManager() && c.is_active ? `<button class="ghost" data-revoke="${c.id}" style="color:var(--warn)">Revoke</button>` : ''}
              ${isAdminOrManager() && !c.is_active ? `<button class="ghost" data-renew="${c.id}" style="color:var(--good)">Renew</button>` : ''}
              ${isAdmin() && !e ? `<button class="ghost" data-del="${c.id}" style="color:var(--bad)">Delete</button>` : ''}
            </td>
          </tr>
        `; }).join('')}
      </tbody>
    </table>
  `;
  $$('button[data-revoke]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await ProximityCardsModel.revoke(b.dataset.revoke);
    if (error) toast(error.message, 'error'); else { toast('Card revoked'); renderProximity(); }
  }));
  $$('button[data-renew]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const { error } = await ProximityCardsModel.renew(b.dataset.renew);
    if (error) toast(error.message, 'error'); else { toast('Card renewed'); renderProximity(); }
  }));
  $$('button[data-del]', wrap).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Permanently delete this card record?')) return;
    const { error } = await ProximityCardsModel.remove(b.dataset.del);
    if (error) toast(error.message, 'error'); else { toast('Card deleted'); renderProximity(); }
  }));
}

// Row shape expected: proximity_code (required). Cards are always issued
// unassigned — same as clicking "+ Issue proximity card" one row at a time.
async function importCards(records) {
  const errors = [];
  let successCount = 0;
  for (let i = 0; i < records.length; i++) {
    const proximity_code = (records[i].proximity_code || '').trim();
    const line = i + 2;
    if (!proximity_code) { errors.push({ line, message: 'proximity_code is required.' }); continue; }
    const { error } = await ProximityCardsModel.issue(proximity_code, appState.session.user.id);
    if (error) errors.push({ line, message: error.message });
    else successCount++;
  }
  return { successCount, errors };
}
