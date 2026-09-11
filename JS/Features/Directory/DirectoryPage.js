import { $, $$ } from '../../Utils/dom.js';
import { esc, initials } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { openEmployeeModal } from '../../Components/EmployeeModal.js';
import { openScanLogModal } from '../../Components/ScanLogModal.js';
import { openImportModal } from '../../Components/ImportModal.js';

export async function renderDirectory() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar">
      <input class="search" id="dir-search" placeholder="Search name, code, department…" />
      ${isAdminOrManager() ? `
        <div style="display:flex;gap:8px;">
          ${isAdmin() ? '<button class="ghost danger" id="dir-delete-all">Delete all</button>' : ''}
          <button class="ghost" id="dir-import">Import</button>
          <button class="primary" id="dir-add">+ Add employee</button>
        </div>
      ` : ''}
    </div>
    <div id="dir-table-wrap">Loading…</div>
  `;
  $('#dir-search').addEventListener('input', (e) => paintDirectoryTable(e.target.value));
  if (isAdmin()) {
    $('#dir-delete-all').addEventListener('click', async () => {
      const ids = appState.employeesCache.map((e) => e.id);
      if (!ids.length) return;
      if (!confirm(`Permanently delete all ${ids.length} employees? This can't be undone.`)) return;
      const { error } = await EmployeesModel.deleteMany(ids);
      if (error) toast(error.message, 'error'); else { toast('All employees deleted'); renderDirectory(); }
    });
  }
  if (isAdminOrManager()) {
    $('#dir-add').addEventListener('click', () => openEmployeeModal(null, renderDirectory));
    $('#dir-import').addEventListener('click', () => openImportModal({
      title: 'Import employees',
      description: 'One row per employee. proximity_code is matched against an existing unassigned card, or issued as a brand-new card if it doesn\'t exist yet.',
      columns: [
        { key: 'full_name', label: 'full_name', required: true },
        { key: 'employee_code', label: 'employee_code', required: true },
        { key: 'proximity_code', label: 'proximity_code', required: true },
        { key: 'department', label: 'department' },
        { key: 'position', label: 'position' },
        { key: 'email', label: 'email' },
        { key: 'phone', label: 'phone' },
        { key: 'status', label: 'status (active/inactive/suspended)' },
      ],
      sampleRow: {
        full_name: 'Jordan Cruz', employee_code: 'EMP-1044', proximity_code: 'PRX-00099',
        department: 'Apparel', position: 'Process Engineer', email: '', phone: '', status: 'active',
      },
      onImport: importEmployees,
    }, renderDirectory));
  }

  const { data, error } = await EmployeesModel.listDirectory();
  if (error) { $('#dir-table-wrap').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  appState.employeesCache = data || [];
  paintDirectoryTable('');
}

function paintDirectoryTable(filter) {
  const wrap = $('#dir-table-wrap');
  const f = filter.trim().toLowerCase();
  const rows = appState.employeesCache.filter((e) =>
    !f || [e.full_name, e.employee_code, e.department, e.position, e.active_proximity_code]
      .some((v) => (v || '').toLowerCase().includes(f))
  );
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><strong>No employees found</strong>${isAdminOrManager() ? 'Add your first employee to get started.' : 'Nothing matches your search.'}</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Employee</th><th>Code</th><th>Department</th><th>Position</th>
        <th>Proximity ID</th><th>Status</th><th>Scans</th><th class="col-shrink"></th>
      </tr></thead>
      <tbody>
        ${rows.map((e) => `
          <tr>
            <td><div class="emp-line"><div class="avatar">${esc(initials(e.full_name))}</div><div><div style="font-weight:600">${esc(e.full_name)}</div><div class="emp-meta">${esc(e.email || '')}</div></div></div></td>
            <td class="mono">${esc(e.employee_code)}</td>
            <td>${esc(e.department || '—')}</td>
            <td>${esc(e.position || '—')}</td>
            <td class="mono">${e.active_proximity_code ? `<span${e.proximity_card_active ? '' : ' style="color:var(--bad)"'}>${esc(e.active_proximity_code)}</span>` : '<span style="color:var(--text-faint)">unassigned</span>'}</td>
            <td><span class="badge ${e.status}">${esc(e.status)}</span></td>
            <td class="mono"><button class="ghost" data-log="${e.id}" style="padding:3px 8px;">${e.total_scans ?? 0} <span style="text-transform:none;">view</span></button></td>
            <td class="row-actions col-shrink">
              ${isAdminOrManager() ? `<button class="ghost" data-edit="${e.id}">Edit</button>` : ''}
              ${isAdmin() ? `<button class="ghost" data-del="${e.id}" style="color:var(--bad)">Delete</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  $$('button[data-edit]', wrap).forEach((b) => b.addEventListener('click', () => {
    const emp = appState.employeesCache.find((e) => e.id === b.dataset.edit);
    openEmployeeModal(emp, renderDirectory);
  }));
  $$('button[data-log]', wrap).forEach((b) => b.addEventListener('click', () => openScanLogModal(b.dataset.log)));
  $$('button[data-del]', wrap).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this employee? This also removes their proximity cards.')) return;
    const { error } = await EmployeesModel.deleteEmployee(b.dataset.del);
    if (error) toast(error.message, 'error'); else { toast('Employee deleted'); renderDirectory(); }
  }));
}

// Row shape expected: full_name, employee_code, proximity_code (all
// required), department, position, email, phone, status (all optional).
// Each row that names a proximity_code no existing card has gets a brand
// new card issued for it — same "reuse or issue" logic EmployeeModal.js
// uses for a single employee, just looped over the whole file.
async function importEmployees(records) {
  const errors = [];
  let successCount = 0;

  const [{ data: existingCards }, { data: linkedRows }] = await Promise.all([
    ProximityCardsModel.listAll(),
    EmployeesModel.listCardLinks(),
  ]);
  const cardByCode = new Map((existingCards || []).map((c) => [c.proximity_code.toLowerCase(), c]));
  const linkedCardIds = new Set((linkedRows || []).map((r) => r.proximity_card_id));

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const line = i + 2; // +1 for header row, +1 for 1-indexing
    const full_name = (r.full_name || '').trim();
    const employee_code = (r.employee_code || '').trim();
    const proximity_code = (r.proximity_code || '').trim();
    if (!full_name || !employee_code || !proximity_code) {
      errors.push({ line, message: 'full_name, employee_code, and proximity_code are all required.' });
      continue;
    }

    let cardId;
    const existing = cardByCode.get(proximity_code.toLowerCase());
    if (existing) {
      if (linkedCardIds.has(existing.id)) {
        errors.push({ line, message: `Proximity code "${proximity_code}" is already assigned to another employee.` });
        continue;
      }
      if (!existing.is_active) {
        errors.push({ line, message: `Proximity code "${proximity_code}" has been revoked — renew it first or use a different code.` });
        continue;
      }
      cardId = existing.id;
    } else {
      const { data: newCard, error: cardErr } = await ProximityCardsModel.issueAndReturnId(proximity_code, appState.session.user.id);
      if (cardErr) { errors.push({ line, message: cardErr.message }); continue; }
      cardId = newCard.id;
      cardByCode.set(proximity_code.toLowerCase(), { id: cardId, proximity_code, is_active: true });
    }

    const status = ['active', 'inactive', 'suspended'].includes((r.status || '').trim()) ? r.status.trim() : 'active';
    const { error } = await EmployeesModel.createEmployee({
      full_name,
      employee_code,
      proximity_card_id: cardId,
      department: r.department?.trim() || null,
      position: r.position?.trim() || null,
      email: r.email?.trim() || null,
      phone: r.phone?.trim() || null,
      status,
      created_by: appState.session.user.id,
    });
    if (error) errors.push({ line, message: error.message });
    else { successCount++; linkedCardIds.add(cardId); }
  }

  return { successCount, errors };
}
