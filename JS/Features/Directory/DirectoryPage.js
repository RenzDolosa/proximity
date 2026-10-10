import { $, $$ } from '../../Utils/dom.js';
import { esc, initials, chunkArray } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { exportXlsx, todayStamp } from '../../Utils/xlsxExport.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { supabase } from '../../Core/supabaseClient.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { EMPLOYEE_STATUSES } from '../../Utils/employeeStatus.js';
import { openEmployeeModal } from '../../Components/EmployeeModal.js';
import { openScanLogModal } from '../../Components/ScanLogModal.js';
import { openRemarksModal } from '../../Components/RemarksModal.js';
import { openImportModal } from '../../Components/ImportModal.js';
import { openExportScanLogsModal } from '../../Components/ExportScanLogsModal.js';
import { renderPagination } from '../../Components/Pagination.js';
import { copyableHTML } from '../../Components/Copyable.js';
import { openConfirmModal, openConfirmProgressModal } from '../../Components/ConfirmModal.js';
import { wireAvatarPreview } from '../../Utils/avatarPreview.js';
import { buildIdentityIndex, identityKey } from '../../Utils/employeeCode.js';
import { isFresh, markFetched, invalidate } from '../../Utils/freshness.js';

const DIRECTORY_KEY = 'directory';
// Long enough that flicking between sidebar items costs nothing, short enough
// that another admin's edit shows up without a reload. Edits made HERE are not
// subject to it — they invalidate explicitly.
const DIRECTORY_MAX_AGE_MS = 60 * 1000;

// Every path that changes the roster goes through this rather than
// renderDirectory() directly, so the freshness window can never swallow a
// just-made edit.
export function reloadDirectory() {
  invalidate(DIRECTORY_KEY);
  return renderDirectory();
}

let page = 1;
let pageSize = 50;
let loaded = false; // distinguishes "never fetched yet" from "fetched, zero rows"
let scanChannel = null; // created once, kept alive for the rest of the session — see below
let unresolvedOnly = false; // toolbar toggle — resets to off each fresh page load, same as `page`
let visibleRows = []; // the current search/toggle-filtered set (pre-pagination) — kept in sync by paintDirectoryTable(), read by the Export button so it exports what's actually on screen, not just the current page

export async function renderDirectory() {
  const content = $('#content');
  content.innerHTML = `
    <div class="toolbar">
      <div style="display:flex;gap:8px;align-items:center;flex:1;min-width:0;">
        <input class="search" id="dir-search" placeholder="Search name, code, department…" />
        <button class="ghost${unresolvedOnly ? ' active' : ''}" id="dir-unresolved-toggle" title="Show only employees with unresolved remarks">Unresolved remarks<span class="count-pill" id="dir-unresolved-count"></span></button>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="ghost" id="dir-export">Export</button>
        ${isAdminOrManager() ? `
          <button class="ghost" id="dir-export-scans">Export all scan logs</button>
          ${isAdmin() ? '<button class="ghost danger" id="dir-delete-all">Delete all</button>' : ''}
          <button class="ghost" id="dir-import">Import</button>
          <button class="primary" id="dir-add">+ Add employee</button>
        ` : ''}
      </div>
    </div>
    <div class="table-scroll"><div id="dir-table-wrap">${loaded ? '' : 'Loading…'}</div></div>
    <div id="dir-pagination"></div>
  `;
  wireAvatarPreview($('#dir-table-wrap'), $('.table-scroll'));

  $('#dir-search').addEventListener('input', (e) => { page = 1; paintDirectoryTable(e.target.value); });
  $('#dir-unresolved-toggle').addEventListener('click', (e) => {
    unresolvedOnly = !unresolvedOnly;
    e.target.classList.toggle('active', unresolvedOnly);
    page = 1;
    paintDirectoryTable($('#dir-search')?.value || '');
  });
  $('#dir-export').addEventListener('click', () => {
    if (!visibleRows.length) { toast('Nothing to export for the current search/filter.', 'error'); return; }
    exportXlsx({
      filename: `employees-${todayStamp()}.xlsx`,
      sheetName: 'Employees',
      // employee_code and Proximity ID are both marked text: true — both
      // are codes that can look numeric (e.g. "00091") and must survive
      // an Excel round-trip exactly as issued, not get silently
      // reinterpreted as a number. See Utils/xlsxExport.js.
      columns: [
        { key: 'full_name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'employee_code', label: 'Employee code', text: true },
        { key: 'department', label: 'Department' },
        { key: 'position', label: 'Position' },
        { key: 'proximity_code', label: 'Proximity ID', text: true },
        { key: 'status', label: 'Status' },
        { key: 'total_scans', label: 'Total scans' },
      ],
      rows: visibleRows.map((e) => ({
        full_name: e.full_name || '',
        email: e.email || '',
        employee_code: e.employee_code || '',
        department: e.department || '',
        position: e.position || '',
        proximity_code: e.active_proximity_code || '',
        status: e.status || '',
        total_scans: e.total_scans ?? 0,
      })),
    });
  });
  if (isAdmin()) {
    $('#dir-delete-all').addEventListener('click', async () => {
      const total = appState.employeesCache.length;
      if (!total) return;
      const { confirmed, result } = await openConfirmProgressModal({
        title: 'Delete all employees?',
        message: `This permanently deletes all ${total} employee${total === 1 ? '' : 's'} and their scan history. This can't be undone.`,
        confirmLabel: 'Delete all',
        task: async (onProgress) => {
          onProgress(0, 1);
          const { error } = await EmployeesModel.deleteAll();
          onProgress(1, 1);
          return { error };
        },
      });
      if (!confirmed) return;
      if (result.error) toast(result.error.message, 'error'); else { toast('All employees deleted'); reloadDirectory(); }
    });
  }
  if (isAdminOrManager()) {
    $('#dir-add').addEventListener('click', () => openEmployeeModal(null, reloadDirectory));
    $('#dir-export-scans').addEventListener('click', () => openExportScanLogsModal());
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
        { key: 'status', label: `status (${EMPLOYEE_STATUSES.join('/')})` },
      ],
      sampleRow: {
        full_name: 'Jordan Cruz', employee_code: 'EMP-1044', proximity_code: 'PRX-00099',
        department: 'Apparel', position: 'Process Engineer', email: '', phone: '', status: 'active',
      },
      onImport: importEmployees,
    }, reloadDirectory));
  }

  // Paint from the in-memory roster first, so a repeat visit shows the table
  // immediately instead of flashing "Loading…".
  if (loaded) paintDirectoryTable('');

  // ~220 KB a visit (729 rows), previously refetched on every single sidebar
  // click. Within the window, the paint above is the whole render. Mutations
  // call reloadDirectory() below, which invalidates first, so an edit is never
  // hidden by this.
  if (loaded && isFresh(DIRECTORY_KEY, DIRECTORY_MAX_AGE_MS)) {
    subscribeToScans();
    return;
  }

  const { data, error } = await EmployeesModel.listDirectory();
  if (error) { $('#dir-table-wrap').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  const next = data || [];
  markFetched(DIRECTORY_KEY);
  // Repainting recreates every row's <img>, so skipping this second repaint when
  // the roster came back identical — the common case — leaves already-decoded
  // photos alone instead of reloading them on every visit.
  const changed = !loaded || JSON.stringify(next) !== JSON.stringify(appState.employeesCache);
  appState.employeesCache = next;
  loaded = true;
  if (changed) {
    page = 1;
    paintDirectoryTable($('#dir-search')?.value || '');
  }
  subscribeToScans();
}

// Keeps the Scans column current without needing to leave and come back
// to this page. scan_events is only ever inserted by the real scanner
// (scan_proximity_code) — Test Scan never touches it — so, same reasoning
// as ScanLogModal's live-refresh, this only fires for genuine scans.
// Subscribed once for the whole session (renderDirectory() runs on every
// sidebar click) rather than per-visit, since re-subscribing on every
// visit would pile up duplicate channels all incrementing the same count.
function subscribeToScans() {
  if (scanChannel) return;
  scanChannel = supabase
    .channel('directory-scan-events')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scan_events' }, (payload) => {
      const row = payload.new;
      if (row.result !== 'matched' || !row.employee_id) return;
      const emp = appState.employeesCache.find((e) => e.id === row.employee_id);
      if (!emp) return; // not on this page / not loaded — the count will just be right next time it's fetched
      emp.total_scans = (emp.total_scans || 0) + 1;
      if (appState.route === 'directory') paintDirectoryTable($('#dir-search')?.value || '');
    })
    .subscribe();
}

// Refetches and repaints WITHOUT renderDirectory()'s full toolbar rebuild, which
// is what preserves page number, search text and scroll position across an
// edit-save — that rebuild recreates #dir-search empty and resets `page = 1`.
// Used only for the edit path; Add/Import/Delete all still do a full render,
// where landing back on page 1 is reasonable.
async function refreshDirectoryInPlace() {
  const { data, error } = await EmployeesModel.listDirectory();
  if (error) { toast(error.message, 'error'); return; }
  markFetched(DIRECTORY_KEY);
  appState.employeesCache = data || [];
  paintDirectoryTable($('#dir-search')?.value || '');
}

function paintDirectoryTable(filter) {
  const wrap = $('#dir-table-wrap');
  const f = filter.trim().toLowerCase();
  // Total unresolved-remarks count for the toolbar toggle's badge — always
  // computed from the full cache (not the search/filter-narrowed `allRows`
  // below), so it reads as "how many need attention overall", not "how
  // many match what I'm currently typing".
  const unresolvedCount = appState.employeesCache.filter((e) => e.open_remarks > 0).length;
  const countEl = $('#dir-unresolved-count');
  if (countEl) countEl.textContent = unresolvedCount || '';
  const allRows = appState.employeesCache.filter((e) => {
    if (unresolvedOnly && !(e.open_remarks > 0)) return false;
    return !f || [e.full_name, e.employee_code, e.department, e.position, e.active_proximity_code]
      .some((v) => (v || '').toLowerCase().includes(f));
  });
  visibleRows = allRows;
  if (!allRows.length) {
    const emptyReason = unresolvedOnly
      ? 'No employees have unresolved remarks right now.'
      : (isAdminOrManager() ? 'Add your first employee to get started.' : 'Nothing matches your search.');
    wrap.innerHTML = `<div class="empty-state"><strong>No employees found</strong>${emptyReason}</div>`;
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
            <td><div class="emp-line"><div class="avatar">${e.photo_url ? `<img class="avatar-photo" src="${esc(e.photo_url)}" alt="" />` : esc(initials(e.full_name))}</div><div><div style="font-weight:600">${esc(e.full_name)}</div><div class="emp-meta">${esc(e.email || '')}</div></div></div></td>
            <td class="mono">${esc(e.employee_code)}</td>
            <td>${esc(e.department || '—')}</td>
            <td>${esc(e.position || '—')}</td>
            <td class="mono">${e.active_proximity_code ? `
              ${copyableHTML(e.active_proximity_code, { label: 'proximity ID' })}
              ${!e.proximity_card_active ? '<span class="badge inactive" style="margin-left:6px;">revoked</span>' : ''}
            ` : '<span style="color:var(--text-faint)">unassigned</span>'}</td>
            <td class="col-shrink"><span class="badge ${e.status}">${esc(e.status)}</span></td>
            <td class="mono col-shrink"><button class="ghost" data-log="${e.id}" style="padding:3px 8px;">${e.total_scans ?? 0} <span style="text-transform:none;">view</span></button></td>
            <td class="col-shrink"><div class="row-actions">
              ${isAdminOrManager() ? `<button class="ghost" data-edit="${e.id}">Edit</button>` : ''}
              <button class="ghost" data-remarks="${e.id}">Remarks${e.open_remarks > 0 ? ' <span class="remark-dot" title="Unresolved remarks"></span>' : ''}</button>
              ${isAdmin() ? `<button class="ghost" data-del="${e.id}" style="color:var(--bad)">Delete</button>` : ''}
            </div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  renderPagination($('#dir-pagination'), {
    total: allRows.length, page, pageSize,
    onChange: (next) => { page = next.page; pageSize = next.pageSize; paintDirectoryTable(filter); },
  });
  $$('button[data-edit]', wrap).forEach((b) => b.addEventListener('click', () => {
    const emp = appState.employeesCache.find((e) => e.id === b.dataset.edit);
    openEmployeeModal(emp, refreshDirectoryInPlace);
  }));
  $$('button[data-log]', wrap).forEach((b) => b.addEventListener('click', () => openScanLogModal(b.dataset.log)));
  $$('button[data-remarks]', wrap).forEach((b) => b.addEventListener('click', () => openRemarksModal(b.dataset.remarks)));
  $$('button[data-del]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const emp = appState.employeesCache.find((e) => e.id === b.dataset.del);
    const ok = await openConfirmModal({
      title: 'Delete this employee?',
      message: `Delete ${emp?.full_name || 'this employee'}? Their proximity card will be unassigned and their scan history will be permanently deleted. This can't be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const { error } = await EmployeesModel.deleteEmployee(b.dataset.del);
    if (error) { toast(error.message, 'error'); return; }
    appState.employeesCache = appState.employeesCache.filter((e) => e.id !== b.dataset.del);
    toast('Employee deleted');
    paintDirectoryTable($('#dir-search').value);
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
async function importEmployees(records, onProgress) {
  const errors = [];
  let skippedCount = 0;
  const CHUNK_SIZE = 200;
  const report = (done, total) => onProgress?.(done, total);
  report(0, records.length);

  const [{ data: existingCards }, { data: linkedRows }] = await Promise.all([
    ProximityCardsModel.listAll(),
    EmployeesModel.listCardLinks(),
  ]);
  const cardByCode = new Map((existingCards || []).map((c) => [c.proximity_code.toLowerCase(), c]));
  const linkedCardIds = new Set((linkedRows || []).map((r) => r.proximity_card_id));
  const claimedCodes = new Map(); // code(lower) -> the line that already claimed it
  const codesNeedingNewCard = new Map(); // code(lower) -> original-case code

  // Codes and names already taken by CURRENT employees. Resigned holders are
  // excluded on purpose: codes are recycled when staff leave, so a code whose
  // only holder has resigned is a legitimate new hire, not a duplicate — see
  // Utils/employeeCode.js. Treating it as a duplicate is what used to make the
  // import silently drop re-hires.
  const { codes: takenCodes, names: takenNames, resignedCodes } =
    buildIdentityIndex(appState.employeesCache);
  const claimedEmployeeCodes = new Map(); // key -> line that already claimed it
  // Names are an error rather than a silent skip: unlike an exact code rematch,
  // a name collision can also be two genuinely different people.
  const claimedEmployeeNames = new Map();
  let reusedCount = 0;

  const pending = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const line = i + 2; // +1 for header row, +1 for 1-indexing
    const full_name = (r.full_name || '').trim();
    const employee_code = (r.employee_code || '').trim();
    const proximity_code = (r.proximity_code || '').trim();
    if (!full_name || !employee_code || !proximity_code) {
      errors.push({ line, message: 'Fullname, Employee Code, and Proximity Code are all required.' });
      continue;
    }
    const nameKey = identityKey(full_name);
    const existingByName = takenNames.get(nameKey);
    if (existingByName) {
      errors.push({ line, message: `An employee named "${full_name}" already exists (code ${existingByName.employee_code}). If this is a different person, adjust the name; otherwise remove this row.` });
      continue;
    }
    if (claimedEmployeeNames.has(nameKey)) {
      errors.push({ line, message: `"${full_name}" is already used by row ${claimedEmployeeNames.get(nameKey)} in this file.` });
      continue;
    }
    const empCodeKey = identityKey(employee_code);
    if (takenCodes.has(empCodeKey)) {
      skippedCount++;
      continue; // a current employee already holds this code
    }
    if (claimedEmployeeCodes.has(empCodeKey)) {
      skippedCount++;
      continue; // duplicate employee_code earlier in this same file
    }
    // Free because its previous holder resigned. Allowed, but counted so the
    // summary says so — reuse is intentional, and silently importing it would
    // hide a typo that happens to match a former employee's code.
    if (resignedCodes.has(empCodeKey)) reusedCount++;
    const codeKey = proximity_code.toLowerCase();
    if (claimedCodes.has(codeKey)) {
      errors.push({ line, message: `Proximity code is already used by row ${claimedCodes.get(codeKey)} in this file.` });
      continue;
    }
    const existing = cardByCode.get(codeKey);
    if (existing) {
      if (linkedCardIds.has(existing.id)) {
        skippedCount++; // proximity code already assigned to someone else — duplicate, skipped
        continue;
      }
      if (!existing.is_active) {
        errors.push({ line, message: `Proximity code has been revoked — renew it first or use a different code.` });
        continue;
      }
    } else {
      codesNeedingNewCard.set(codeKey, proximity_code);
    }
    claimedCodes.set(codeKey, line);
    claimedEmployeeCodes.set(empCodeKey, line);
    claimedEmployeeNames.set(nameKey, line);
    const status = EMPLOYEE_STATUSES.includes((r.status || '').trim()) ? r.status.trim() : 'active';
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
  let processed = records.length - pending.length; // rows already resolved as skipped/errored above
  report(processed, records.length);
  for (const chunk of chunkArray(ready, CHUNK_SIZE)) {
    const { error } = await EmployeesModel.createMany(chunk.map((r) => r.payload));
    if (!error) {
      successCount += chunk.length;
    } else {
      // Same fallback: only go row-by-row for a chunk that actually failed.
      for (const r of chunk) {
        const { error: singleErr } = await EmployeesModel.createEmployee(r.payload);
        if (singleErr) errors.push({ line: r.line, message: singleErr.message });
        else successCount++;
      }
    }
    processed += chunk.length;
    report(processed, records.length);
  }

  errors.sort((a, b) => a.line - b.line);
  return { successCount, skippedCount, reusedCount, errors };
}