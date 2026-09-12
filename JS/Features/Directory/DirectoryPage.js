import { $, $$ } from '../../Utils/dom.js';
import { esc, initials } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { openEmployeeModal } from '../../Components/EmployeeModal.js';
import { openScanLogModal } from '../../Components/ScanLogModal.js';
import { openRemarksModal } from '../../Components/RemarksModal.js';
import { openImportModal } from '../../Components/ImportModal.js';
import { paginationBar, wirePagination } from '../../Components/Pagination.js';

// Server-side paged + searched — see EmployeesModel#listDirectoryPage. At
// 700+ employees, fetching every row on every load (the old approach) was
// the slow part; this only ever pulls the current page.
const tableState = { page: 1, pageSize: 20, total: 0, search: '' };
let searchDebounce = null;

export async function renderDirectory() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-filters">
        <input class="search" id="dir-search" placeholder="Search name, code, department…" value="${esc(tableState.search)}" />
      </div>
      ${isAdminOrManager() ? `
        <div class="toolbar-actions">
          ${isAdmin() ? '<button class="ghost danger" id="dir-delete-all">Delete all</button>' : ''}
          <button class="ghost" id="dir-import">Import</button>
          <button class="primary" id="dir-add">+ Add employee</button>
        </div>
      ` : ''}
    </div>
    <div id="dir-table-wrap">Loading…</div>
  `;

  $('#dir-search').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const value = e.target.value;
    // Debounced because search runs server-side now (it has to, to search
    // the whole table rather than just whatever page happens to be loaded).
    searchDebounce = setTimeout(() => {
      tableState.search = value;
      tableState.page = 1;
      loadDirectoryPage();
    }, 300);
  });

  if (isAdmin()) {
    $('#dir-delete-all').addEventListener('click', async () => {
      if (!tableState.total) return;
      if (!confirm(`Permanently delete all ${tableState.total} employees? This can't be undone.`)) return;
      // Deleting "all" means all matching the current search filter, not
      // just the current page — fetch every matching id first (id-only,
      // cheap) then delete in one call.
      const { data: allMatching, error: listErr } = await EmployeesModel.listDirectoryPage({
        page: 1, pageSize: tableState.total, search: tableState.search,
      });
      if (listErr) { toast(listErr.message, 'error'); return; }
      const ids = (allMatching || []).map((e) => e.id);
      if (!ids.length) return;
      const { error } = await EmployeesModel.deleteMany(ids);
      if (error) toast(error.message, 'error'); else { toast('All employees deleted'); tableState.page = 1; loadDirectoryPage(); }
    });
  }
  if (isAdminOrManager()) {
    $('#dir-add').addEventListener('click', () => openEmployeeModal(null, () => loadDirectoryPage()));
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
    }, () => { tableState.page = 1; loadDirectoryPage(); }));
  }

  await loadDirectoryPage();
}

async function loadDirectoryPage() {
  const wrap = $('#dir-table-wrap');
  if (!wrap) return;
  wrap.classList.add('table-loading');
  const { data, error, count } = await EmployeesModel.listDirectoryPage({
    page: tableState.page, pageSize: tableState.pageSize, search: tableState.search,
  });
  if (error) { wrap.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  tableState.total = count ?? (data || []).length;
  paintDirectoryTable(data || []);
}

function paintDirectoryTable(rows) {
  const wrap = $('#dir-table-wrap');
  wrap.classList.remove('table-loading');
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><strong>No employees found</strong>${tableState.search ? 'Try a different search.' : (isAdminOrManager() ? 'Add your first employee to get started.' : 'Nothing here yet.')}</div>`;
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Employee</th><th>Code</th><th>Department</th><th>Position</th>
        <th>Proximity ID</th><th>Status</th><th>Scans</th><th>Remarks</th><th class="col-shrink"></th>
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
            <td class="mono"><button class="ghost" data-remarks="${e.id}" style="padding:3px 8px;">${e.open_remarks ?? e.total_remarks ?? 0} <span style="text-transform:none;">view</span></button></td>
            <td class="row-actions col-shrink">
              ${isAdminOrManager() ? `<button class="ghost" data-edit="${e.id}">Edit</button>` : ''}
              ${isAdmin() ? `<button class="ghost" data-del="${e.id}" style="color:var(--bad)">Delete</button>` : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${paginationBar(tableState)}
  `;
  wirePagination(wrap, tableState, loadDirectoryPage);
  $$('button[data-edit]', wrap).forEach((b) => b.addEventListener('click', () => {
    const emp = rows.find((e) => e.id === b.dataset.edit);
    openEmployeeModal(emp, () => loadDirectoryPage());
  }));
  $$('button[data-log]', wrap).forEach((b) => b.addEventListener('click', () => openScanLogModal(b.dataset.log)));
  $$('button[data-remarks]', wrap).forEach((b) => b.addEventListener('click', () => openRemarksModal(b.dataset.remarks)));
  $$('button[data-del]', wrap).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this employee? This also removes their proximity cards.')) return;
    const { error } = await EmployeesModel.deleteEmployee(b.dataset.del);
    if (error) toast(error.message, 'error'); else { toast('Employee deleted'); loadDirectoryPage(); }
  }));
}

// Row shape expected: full_name, employee_code, proximity_code (all
// required), department, position, email, phone, status (all optional).
// Rewritten to bulk-insert in chunks instead of one row at a time — the
// previous version did a network round trip per employee (and per new
// card), which is why large imports used to take forever. Now it's one
// round trip per ~250 rows, only falling back to a row-by-row retry for a
// chunk that actually fails (so a single bad row doesn't cost the rest of
// the file their error detail).
const IMPORT_CHUNK_SIZE = 250;

async function importEmployees(records) {
  const errors = [];
  let successCount = 0;

  const [{ data: existingCards }, { data: linkedRows }] = await Promise.all([
    ProximityCardsModel.listAll(),
    EmployeesModel.listCardLinks(),
  ]);
  const cardByCode = new Map((existingCards || []).map((c) => [c.proximity_code.toLowerCase(), c]));
  const linkedCardIds = new Set((linkedRows || []).map((r) => r.proximity_card_id));

  // ---- validate every row up front (no network yet) ----
  const seenEmployeeCodes = new Set();
  const seenNewProximityCodes = new Set();
  const rowsNeedingNewCard = [];
  const resolvedRows = []; // rows that already have a cardId assigned

  records.forEach((r, i) => {
    const line = i + 2; // +1 header, +1 1-indexing
    const full_name = (r.full_name || '').trim();
    const employee_code = (r.employee_code || '').trim();
    const proximity_code = (r.proximity_code || '').trim();
    if (!full_name || !employee_code || !proximity_code) {
      errors.push({ line, message: 'full_name, employee_code, and proximity_code are all required.' });
      return;
    }
    const codeKey = employee_code.toLowerCase();
    if (seenEmployeeCodes.has(codeKey)) {
      errors.push({ line, message: `Duplicate employee_code "${employee_code}" elsewhere in this file.` });
      return;
    }
    seenEmployeeCodes.add(codeKey);

    const status = ['active', 'inactive', 'suspended'].includes((r.status || '').trim()) ? r.status.trim() : 'active';
    const base = {
      line, full_name, employee_code, proximity_code,
      department: r.department?.trim() || null,
      position: r.position?.trim() || null,
      email: r.email?.trim() || null,
      phone: r.phone?.trim() || null,
      status,
    };

    const proxKey = proximity_code.toLowerCase();
    const existing = cardByCode.get(proxKey);
    if (existing) {
      if (linkedCardIds.has(existing.id)) {
        errors.push({ line, message: `Proximity code "${proximity_code}" is already assigned to another employee.` });
        return;
      }
      if (!existing.is_active) {
        errors.push({ line, message: `Proximity code "${proximity_code}" has been revoked — renew it first or use a different code.` });
        return;
      }
      linkedCardIds.add(existing.id); // reserve, in case the file reuses this code again below
      resolvedRows.push({ ...base, cardId: existing.id });
    } else {
      if (seenNewProximityCodes.has(proxKey)) {
        errors.push({ line, message: `Proximity code "${proximity_code}" is used more than once in this file.` });
        return;
      }
      seenNewProximityCodes.add(proxKey);
      rowsNeedingNewCard.push(base);
    }
  });

  // ---- bulk-create every brand-new card in one round trip ----
  if (rowsNeedingNewCard.length) {
    const { data: createdCards, error: bulkErr } = await ProximityCardsModel.issueMany(
      rowsNeedingNewCard.map((r) => r.proximity_code),
      appState.session.user.id
    );
    if (!bulkErr) {
      const idByCode = new Map((createdCards || []).map((c) => [c.proximity_code.toLowerCase(), c.id]));
      rowsNeedingNewCard.forEach((r) => {
        const cardId = idByCode.get(r.proximity_code.toLowerCase());
        if (cardId) resolvedRows.push({ ...r, cardId });
        else errors.push({ line: r.line, message: 'Card creation did not return an id for this proximity_code.' });
      });
    } else {
      // Whole batch failed (e.g. a duplicate slipped through) — fall back
      // to one at a time, but only for this subset, to pinpoint the row.
      for (const r of rowsNeedingNewCard) {
        const { data: card, error } = await ProximityCardsModel.issueAndReturnId(r.proximity_code, appState.session.user.id);
        if (error) { errors.push({ line: r.line, message: error.message }); continue; }
        resolvedRows.push({ ...r, cardId: card.id });
      }
    }
  }

  // ---- bulk-insert employees, chunked, with a per-row fallback on failure ----
  for (let i = 0; i < resolvedRows.length; i += IMPORT_CHUNK_SIZE) {
    const chunk = resolvedRows.slice(i, i + IMPORT_CHUNK_SIZE);
    const payloads = chunk.map((r) => ({
      full_name: r.full_name, employee_code: r.employee_code, proximity_card_id: r.cardId,
      department: r.department, position: r.position, email: r.email, phone: r.phone,
      status: r.status, created_by: appState.session.user.id,
    }));
    const { error: chunkErr } = await EmployeesModel.createMany(payloads);
    if (!chunkErr) { successCount += chunk.length; continue; }
    // a single bad row (e.g. a duplicate employee_code that already exists
    // in the DB, not just in this file) aborts the whole chunk insert —
    // retry row by row only for this chunk to identify which one(s) failed.
    for (const r of chunk) {
      const { error: rowErr } = await EmployeesModel.createEmployee({
        full_name: r.full_name, employee_code: r.employee_code, proximity_card_id: r.cardId,
        department: r.department, position: r.position, email: r.email, phone: r.phone,
        status: r.status, created_by: appState.session.user.id,
      });
      if (rowErr) errors.push({ line: r.line, message: rowErr.message });
      else successCount++;
    }
  }

  return { successCount, errors };
}
