import { $, $$ } from '../../Utils/dom.js';
import { esc, initials } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { openEmployeeModal } from '../../Components/EmployeeModal.js';
import { openScanLogModal } from '../../Components/ScanLogModal.js';

export async function renderDirectory() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar">
      <input class="search" id="dir-search" placeholder="Search name, code, department…" />
      ${isAdminOrManager() ? '<button class="primary" id="dir-add">+ Add employee</button>' : ''}
    </div>
    <div id="dir-table-wrap">Loading…</div>
  `;
  $('#dir-search').addEventListener('input', (e) => paintDirectoryTable(e.target.value));
  if (isAdminOrManager()) $('#dir-add').addEventListener('click', () => openEmployeeModal(null, renderDirectory));

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
        <th>Proximity ID</th><th>Status</th><th>Scans</th><th></th>
      </tr></thead>
      <tbody>
        ${rows.map((e) => `
          <tr>
            <td><div class="emp-line"><div class="avatar">${esc(initials(e.full_name))}</div><div><div style="font-weight:600">${esc(e.full_name)}</div><div class="emp-meta">${esc(e.email || '')}</div></div></div></td>
            <td class="mono">${esc(e.employee_code)}</td>
            <td>${esc(e.department || '—')}</td>
            <td>${esc(e.position || '—')}</td>
            <td class="mono">${e.active_proximity_code ? esc(e.active_proximity_code) : '<span style="color:var(--text-faint)">unassigned</span>'}</td>
            <td><span class="badge ${e.status}">${esc(e.status)}</span></td>
            <td class="mono"><button class="ghost" data-log="${e.id}" style="padding:3px 8px;">${e.total_scans ?? 0} <span style="text-transform:none;">view</span></button></td>
            <td class="row-actions">
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
