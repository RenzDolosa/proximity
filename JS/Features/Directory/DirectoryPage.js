import { $, $$ } from '../../Utils/dom.js';
import { esc, initials, chunkArray } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { openEmployeeModal } from '../../Components/EmployeeModal.js';
import { openScanLogModal } from '../../Components/ScanLogModal.js';
import { openImportModal } from '../../Components/ImportModal.js';
import { renderPagination } from '../../Components/Pagination.js';

let page = 1;
let pageSize = 50;

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
  $('#dir-search').addEventListener('input', (e) => { page = 1; paintDirectoryTable(e.target.value); });
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
  page = 1;
  paintDirectoryTable('');
}

function paintDirectoryTable(filter) {
  const wrap = $('#dir-table-wrap');
  const f = filter.trim().toLowerCase();
  const allRows = appState.employeesCache.filter((e) =>
    !f || [e.full_name, e.employee_code, e.department, e.position, e.active_proximity_code]
      .some((v) => (v || '').toLowerCase().includes(f))
  );
  if (!allRows.length) {
    wrap.innerHTML = `<div class="empty-state"><strong>No employees found</strong>${isAdminOrManager() ? 'Add your first employee to get started.' : 'Nothing matches your search.'}</div>`;
    return;
  }
  const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
  page = Math.min(Math.max(1, page), totalPages);
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize);
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Employee</th><th>Code</th><th>Department</th><th>Position</th>
        <th>Proximity ID</th><th class="col-shrink">Status</th><th class="col-shrink">Scans</th><th class="col-shrink"></th>
      </tr></thead>
      <tbody>
        ${rows.map((e) => `
          <tr>
            <td><div class="emp-line"><div class="avatar">${esc(initials(e.full_name))}</div><div><div style="font-weight:600">${esc(e.full_name)}</div><div class="emp-meta">${esc(e.email || '')}</div></div></div></td>
            <td class="mono">${esc(e.employee_code)}</td>
            <td>${esc(e.department || '—')}</td>
            <td>${esc(e.position || '—')}</td>
            <td class="mono">${e.active_proximity_code ? `<span${e.proximity_card_active ? '' : ' style="color:var(--bad)"'}>${esc(e.active_proximity_code)}</span>` : '<span style="color:var(--text-faint)">unassigned</span>'}</td>
            <td class="col-shrink"><span class="badge ${e.status}">${esc(e.status)}</span></td>
            <td class="mono col-shrink"><button class="ghost" data-log="${e.id}" style="padding:3px 8px;">${e.total_scans ?? 0} <span style="text-transform:none;">view</span></button></td>
            <td class="row-actions col-shrink">
              ${isAdminOrManager() ? `<button class="ghost" data-edit="${e.id}">Edit</button>` : ''}
              ${isAdmin() ? `<button class="ghost" data-del="${e.id}" style="color:var(--bad)">Delete</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div id="dir-pagination"></div>
  `;
  renderPagination($('#dir-pagination', wrap), {
    total: allRows.length, page, pageSize,
    onChange: (next) => { page = next.page; pageSize = next.pageSize; paintDirectoryTable(filter); },
  });
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
// uses for a single employee.
//
// Performance note: this used to insert one card and one employee per row,
// sequentially — for a few hundred rows that's a few hundred network
// round-trips and it visibly crawled. It now validates everything against
// data it already has in memory, then does the actual writes in a couple
// of chunked bulk inserts. A chunk only falls back to inserting its rows
// one-by-one if the bulk call itself errors, so we can still say exactly
// which line caused the problem.
async function importEmployees(records) {
  const errors = [];
  const CHUNK_SIZE = 200;

  const [{ data: existingCards }, { data: linkedRows }] = await Promise.all([
    ProximityCardsModel.listAll(),
    EmployeesModel.listCardLinks(),
  ]);
  const cardByCode = new Map((existingCards || []).map((c) => [c.proximity_code.toLowerCase(), c]));
  const linkedCardIds = new Set((linkedRows || []).map((r) => r.proximity_card_id));
  const claimedCodes = new Map(); // code(lower) -> the line that already claimed it
  const codesNeedingNewCard = new Map(); // code(lower) -> original-case code

  const pending = [];
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
    const codeKey = proximity_code.toLowerCase();
    if (claimedCodes.has(codeKey)) {
      errors.push({ line, message: `Proximity code "${proximity_code}" is already used by row ${claimedCodes.get(codeKey)} in this file.` });
      continue;
    }
    const existing = cardByCode.get(codeKey);
    if (existing) {
      if (linkedCardIds.has(existing.id)) {
        errors.push({ line, message: `Proximity code "${proximity_code}" is already assigned to another employee.` });
        continue;
      }
      if (!existing.is_active) {
        errors.push({ line, message: `Proximity code "${proximity_code}" has been revoked — renew it first or use a different code.` });
        continue;
      }
    } else {
      codesNeedingNewCard.set(codeKey, proximity_code);
    }
    claimedCodes.set(codeKey, line);
    const status = ['active', 'inactive', 'suspended'].includes((r.status || '').trim()) ? r.status.trim() : 'active';
    pending.push({
      line, codeKey, proximity_code,
      payload: {
        full_name, employee_code,
        department: r.department?.trim() || null,
        position: r.position?.trim() || null,
        email: r.email?.trim() || null,
        phone: r.phone?.trim() || null,
        status,
        created_by: appState.session.user.id,
      },
    });
  }

  // Bulk-issue every brand-new card the file needs, a chunk at a time.
  for (const chunk of chunkArray([...codesNeedingNewCard.values()], CHUNK_SIZE)) {
    const { data, error } = await ProximityCardsModel.issueMany(
      chunk.map((code) => ({ proximity_code: code, created_by: appState.session.user.id }))
    );
    if (!error) {
      data.forEach((c) => cardByCode.set(c.proximity_code.toLowerCase(), c));
      continue;
    }
    // Something in this batch collided (e.g. a duplicate code already in
    // the DB) — retry the chunk one row at a time so we know which.
    for (const code of chunk) {
      const { data: single, error: singleErr } = await ProximityCardsModel.issueAndReturnId(code, appState.session.user.id);
      if (single) cardByCode.set(code.toLowerCase(), single);
      else {
        for (const p of pending) {
          if (p.codeKey === code.toLowerCase() && !p._cardFailed) {
            errors.push({ line: p.line, message: singleErr.message });
            p._cardFailed = true;
          }
        }
      }
    }
  }

  const ready = pending
    .filter((p) => !p._cardFailed)
    .map((p) => ({ line: p.line, payload: { ...p.payload, proximity_card_id: cardByCode.get(p.codeKey)?.id } }))
    .filter((p) => {
      if (p.payload.proximity_card_id) return true;
      errors.push({ line: p.line, message: 'Could not resolve a proximity card for this row.' });
      return false;
    });

  let successCount = 0;
  for (const chunk of chunkArray(ready, CHUNK_SIZE)) {
    const { error } = await EmployeesModel.createMany(chunk.map((r) => r.payload));
    if (!error) { successCount += chunk.length; continue; }
    // Same fallback: only go row-by-row for a chunk that actually failed.
    for (const r of chunk) {
      const { error: singleErr } = await EmployeesModel.createEmployee(r.payload);
      if (singleErr) errors.push({ line: r.line, message: singleErr.message });
      else successCount++;
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return { successCount, errors };
}
