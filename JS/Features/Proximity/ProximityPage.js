import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime, chunkArray } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdmin, isAdminOrManager } from '../../Core/state.js';
import { ProximityCardsModel } from '../../Models/ProximityCardsModel.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { openCardModal } from '../../Components/ProximityCardModal.js';
import { openImportModal } from '../../Components/ImportModal.js';
import { openProgressModal } from '../../Components/ProgressModal.js';
import { renderPagination } from '../../Components/Pagination.js';

let cardsCache = [];
let assignedByCard = new Map();
let page = 1;
let pageSize = 50;

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
    <div class="table-scroll"><div id="prox-table-wrap">Loading…</div></div>
    <div id="prox-pagination"></div>
  `;
  $('#prox-search').addEventListener('input', () => { page = 1; paintProximityTable(); });
  $('#prox-filter').addEventListener('change', () => { page = 1; paintProximityTable(); });
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
      const CHUNK_SIZE = 500;
      const ids = deletable.map((c) => c.id);
      const chunks = chunkArray(ids, CHUNK_SIZE);
      const progress = openProgressModal(`Deleting ${ids.length} card${ids.length === 1 ? '' : 's'}…`);
      let done = 0;
      progress.update(done, ids.length);
      for (const chunk of chunks) {
        const { error } = await ProximityCardsModel.removeMany(chunk);
        if (error) { progress.close(); toast(error.message, 'error'); return; }
        done += chunk.length;
        progress.update(done, ids.length);
      }
      progress.close();
      toast('Unassigned cards deleted');
      renderProximity();
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
// unassigned — same as clicking "+ Issue proximity card" one row at a
// time, just done as a couple of chunked bulk inserts instead of one
// network round-trip per row (see importEmployees in DirectoryPage.js for
// the same pattern with more detail).
//
// Duplicates are checked twice, for two different reasons:
//  - within the file (via `seen`) — two rows can't both claim the same
//    new code
//  - against codes that already exist in the DB (via `existingCodes`) —
//    fetched once up front so a whole re-imported file (a common case:
//    someone re-runs the same CSV) gets skipped immediately, instead of
//    every chunk containing one hitting the unique-constraint error and
//    falling back to inserting that chunk's rows one at a time to find
//    the culprit. That fallback is what made large duplicate-heavy
//    imports slow — this avoids triggering it at all for the normal case.
async function importCards(records, onProgress) {
  const errors = [];
  const CHUNK_SIZE = 200;
  const seen = new Map(); // code(lower) -> line, catches duplicates within the file

  const { data: existingCards } = await ProximityCardsModel.listAll();
  const existingCodes = new Set((existingCards || []).map((c) => c.proximity_code.toLowerCase()));

  const rows = [];
  records.forEach((r, i) => {
    const line = i + 2;
    const proximity_code = (r.proximity_code || '').trim();
    if (!proximity_code) { errors.push({ line, message: 'proximity_code is required.' }); return; }
    const key = proximity_code.toLowerCase();
    if (existingCodes.has(key)) { errors.push({ line, message: 'Duplicate proximity card — skipped.' }); return; }
    if (seen.has(key)) { errors.push({ line, message: `Proximity code is already used by row ${seen.get(key)} in this file.` }); return; }
    seen.set(key, line);
    rows.push({ line, proximity_code });
  });

  let successCount = 0;
  // Rows that already failed validation (missing/duplicate code) are
  // "done" before the loop even starts, so the bar lands exactly on
  // records.length once the loop finishes.
  let done = records.length - rows.length;
  onProgress?.(done, records.length);
  for (const chunk of chunkArray(rows, CHUNK_SIZE)) {
    const { error } = await ProximityCardsModel.issueMany(
      chunk.map((r) => ({ proximity_code: r.proximity_code, created_by: appState.session.user.id }))
    );
    if (!error) {
      successCount += chunk.length;
    } else {
      for (const r of chunk) {
        const { error: singleErr } = await ProximityCardsModel.issue(r.proximity_code, appState.session.user.id);
        if (singleErr) errors.push({ line: r.line, message: friendlyCardImportError(singleErr.message) });
        else successCount++;
      }
    }
    done += chunk.length;
    onProgress?.(done, records.length);
  }

  errors.sort((a, b) => a.line - b.line);
  return { successCount, errors };
}

// The pre-check above catches duplicates against codes that existed when
// the import started, but it can't catch a code someone else issues in
// the moment between that check and this insert — that race still hits
// Postgres's actual unique constraint, whose raw message
// ("duplicate key value violates unique constraint
// \"proximity_cards_proximity_code_key\"") isn't something a non-technical
// user should have to read.
function friendlyCardImportError(message) {
  if (message?.includes('proximity_cards_proximity_code_key')) return 'Duplicate proximity card — skipped.';
  return message;
}