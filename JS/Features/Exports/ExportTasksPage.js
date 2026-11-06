// Export Manager: a ledger of who exported what, when, and how many rows.
//
// THE SCOPING RULE, which is the point of the page: an admin sees every
// task; everyone below admin sees only their own. Enforced by RLS on
// export_tasks AND by get_export_tasks(), so the rule holds even if
// something reaches the table another way. The check below is a UI
// convenience, same as every other page in this app.
//
// WHY THERE IS NO DOWNLOAD BUTTON. The .xlsx is built in the browser and
// saved to the operator's own disk — nothing is stored server-side, because
// storing files would mean Supabase Storage and every download from Storage
// is billed egress. So a row records the PARAMETERS, and "Re-run" repeats the
// export at the same cost the first one had. The alternative was a download
// link whose convenience is paid for in egress every time anyone clicks it.
//
// A row stuck on "running" is not a bug. The export is client-side, so a
// browser closed mid-export leaves one — and that is the honest record: the
// rows really did leave the database, and nothing knows whether they reached
// a disk.
import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { isAdmin, isAdminOrManager } from '../../Core/state.js';
import { ExportTasksModel, EXPORT_TASKS_PAGE_SIZE } from '../../Models/ExportTasksModel.js';
import { renderPagination } from '../../Components/Pagination.js';
import { openExportScanLogsModal } from '../../Components/ExportScanLogsModal.js';
import { toast } from '../../Utils/toast.js';
import { reportError } from '../../Utils/userError.js';

const MODULE_LABEL = Object.freeze({
  scan_logs: 'Scan logs',
});

// Maps to the badge colours already used for scan results, so a failed export
// reads the same way a failed scan does rather than inventing a third
// vocabulary.
const STATUS_TONE = Object.freeze({
  finished: 'matched',
  failed: 'inactive_card',
  running: 'unassigned_card',
});

let rows = [];
let total = 0;
let page = 1;
let pageSize = EXPORT_TASKS_PAGE_SIZE;
let loaded = false;

export async function renderExportTasks() {
  const content = $('#content');
  if (!isAdminOrManager()) {
    content.innerHTML = `<div class="empty-state">Admins and managers only.</div>`;
    return;
  }

  content.innerHTML = `
    <div class="toolbar">
      <div class="sub">${isAdmin()
        ? 'Every export run in this app, by anyone.'
        : 'Your own exports. Admins can see everyone&rsquo;s.'}
        Nothing is stored server-side &mdash; the file was saved to the operator&rsquo;s own device, so an old export is repeated rather than downloaded.</div>
      <span style="margin-left:auto;display:flex;gap:8px;">
        <button class="ghost" id="et-refresh">Refresh</button>
        <button class="primary" id="et-new">New scan log export</button>
      </span>
    </div>
    <div class="table-scroll"><div id="et-table-wrap">${loaded ? '' : 'Loading…'}</div></div>
    <div id="et-pagination"></div>
  `;

  $('#et-new').addEventListener('click', async () => {
    const { confirmed } = await openExportScanLogsModal();
    if (confirmed) { page = 1; await load(); }
  });
  $('#et-refresh').addEventListener('click', () => load());

  // Stale-while-revalidate: paint from cache immediately rather than
  // flashing "Loading…" on a revisit — same pattern as AuditLogPage.js.
  if (loaded) paint();
  await load();
}

async function load() {
  const { data, error } = await ExportTasksModel.list({
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const wrap = $('#et-table-wrap');
  if (!wrap) return; // navigated away mid-request
  if (error) {
    wrap.innerHTML = `<div class="empty-state">${esc(reportError(error, 'exportTasks'))}</div>`;
    return;
  }
  rows = data || [];
  // total_count rides on every row rather than coming from a second count
  // RPC. Zero rows means zero total — there is no row to read it off, and
  // Number(undefined) would be NaN.
  total = rows.length ? Number(rows[0].total_count) || 0 : 0;
  loaded = true;
  paint();
}

function paint() {
  const wrap = $('#et-table-wrap');
  if (!wrap) return;
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state">No exports yet.</div>`;
    $('#et-pagination').innerHTML = '';
    return;
  }

  wrap.innerHTML = `
    <table class="table-as-cards">
      <thead>
        <tr>
          <th class="col-shrink">Started</th>
          ${isAdmin() ? '<th class="col-shrink">Operator</th>' : ''}
          <th class="col-shrink">Export</th>
          <th>File</th>
          <th class="col-shrink">Rows</th>
          <th class="col-shrink">Status</th>
          <th class="col-shrink"></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td class="col-shrink mono" data-label="Started">${fmtTime(r.started_at)}</td>
            ${isAdmin() ? `<td class="col-shrink" data-label="Operator">${esc(r.operator_name || '—')}${r.is_mine ? ' <span class="emp-meta">(you)</span>' : ''}</td>` : ''}
            <td class="col-shrink" data-label="Export">${esc(MODULE_LABEL[r.module] || r.module)}</td>
            <td class="card-title mono">${esc(r.filename)}${describeRange(r.params)}</td>
            <td class="col-shrink" data-label="Rows">${r.row_count === null || r.row_count === undefined ? '—' : Number(r.row_count).toLocaleString()}</td>
            <td class="col-shrink" data-label="Status">
              <span class="badge ${STATUS_TONE[r.status] || 'unassigned_card'}">${esc(r.status)}</span>
              ${r.detail ? `<div class="emp-meta">${esc(r.detail)}</div>` : ''}
            </td>
            <td class="col-shrink">
              ${r.is_mine && r.module === 'scan_logs'
                ? `<button type="button" class="ghost et-rerun" data-id="${esc(r.id)}">Re-run</button>`
                : ''}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  $$('.et-rerun', wrap).forEach((btn) => {
    btn.addEventListener('click', () => rerun(btn.dataset.id));
  });

  renderPagination($('#et-pagination'), {
    total, page, pageSize,
    onChange: (next) => { page = next.page; pageSize = next.pageSize; load(); },
  });
}

// `params` is {from, to}, either of which may be null for an open bound.
function describeRange(params) {
  const from = params?.from ? fmtTime(params.from) : null;
  const to = params?.to ? fmtTime(params.to) : null;
  if (!from && !to) return ' <span class="emp-meta">all dates</span>';
  return ` <span class="emp-meta">${esc(from || 'earliest')} → ${esc(to || 'latest')}</span>`;
}

// Opens the normal export modal rather than silently refetching. A re-run is
// a new export with its own cost and its own ledger row, and it should look
// like one — the operator picks the range again, pre-filled or not, and
// presses Export deliberately.
//
// Only offered for your own rows: re-running someone else's export would put
// their data on your disk under your name, which is the opposite of what a
// ledger is for.
async function rerun(id) {
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  if (!row.is_mine) { toast('You can only re-run your own exports.', 'error'); return; }
  const { confirmed } = await openExportScanLogsModal();
  if (confirmed) { page = 1; await load(); }
}
