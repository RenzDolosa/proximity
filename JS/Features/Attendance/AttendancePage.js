// Attendance report — per-employee, per-day first IN / last OUT / time on
// site, built from the scan history the kiosks already record. Read-only.
//
// All the numbers come from get_attendance_report() (see
// Supabase/README.md for exactly how a row is derived and why); the rules
// for what a row *means* (complete / no OUT yet / check times) live in
// Utils/attendance.js so they're unit-tested rather than buried here.
import { $ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { canViewAttendance } from '../../Core/state.js';
import { renderPagination } from '../../Components/Pagination.js';
import { exportXlsx, todayStamp } from '../../Utils/xlsxExport.js';
import { AttendanceModel } from '../../Models/AttendanceModel.js';
import {
  attendanceStatus, STATUS_LABEL, fmtDuration, toDecimalHours,
  validateRange, defaultRange, filterRows, summarize,
} from '../../Utils/attendance.js';

// Badge colors reuse the existing result-badge classes rather than adding
// new CSS: green = fine, amber = needs a look, red = actually suspicious.
const STATUS_BADGE = { complete: 'matched', open: 'unassigned_card', anomaly: 'inactive_card' };

let range = defaultRange();
let rowsCache = [];   // the last successfully loaded report, unfiltered
let loaded = false;   // distinguishes "never fetched" from "fetched, zero rows"
let loadedRange = null; // the range rowsCache actually covers (may differ from the inputs mid-edit)
let filters = { query: '', department: '', status: '' };
let page = 1;
let pageSize = 50;
let requestSeq = 0;   // drops a slow, superseded response instead of letting it overwrite a newer one

export async function renderAttendance() {
  const content = $('#content');
  if (!canViewAttendance()) { content.innerHTML = `<div class="empty-state">You don't have access to this page.</div>`; return; }

  content.innerHTML = `
    <div class="toolbar">
      <div class="sub">Time on site per employee per day, from IN/OUT scans. A day belongs to the date of its IN scan, so a shift that runs past midnight stays on one row. Read-only.</div>
    </div>
    <div class="filter-row" style="margin-bottom:14px;flex-wrap:wrap;">
      <div class="field" style="margin:0;"><label>From</label><input type="date" id="att-from" value="${esc(range.from)}" /></div>
      <div class="field" style="margin:0;"><label>To</label><input type="date" id="att-to" value="${esc(range.to)}" /></div>
      <button class="primary" id="att-run" style="align-self:flex-end;">Run report</button>
      <button class="ghost" id="att-export" style="align-self:flex-end;" disabled>Export .xlsx</button>
    </div>
    <div class="auth-error hidden" id="att-error" style="margin-bottom:12px;"></div>
    <div id="att-body">${loaded ? '' : 'Loading…'}</div>
  `;

  $('#att-run').addEventListener('click', runReport);
  $('#att-export').addEventListener('click', exportRows);
  // Same mutual clamp as the scan-log export modal: picking a "from" after
  // the current "to" (or vice versa) pulls the other bound along instead of
  // leaving an inverted, always-invalid range.
  $('#att-from').addEventListener('change', () => {
    const to = $('#att-to');
    if (to.value && $('#att-from').value > to.value) to.value = $('#att-from').value;
  });
  $('#att-to').addEventListener('change', () => {
    const from = $('#att-from');
    if (from.value && from.value > $('#att-to').value) from.value = $('#att-to').value;
  });

  // Stale-while-revalidate, same as AuditLogPage.js: paint what we already
  // have immediately, then refresh for the range currently shown.
  if (loaded) paintBody();
  await runReport();
}

function showError(message) {
  const el = $('#att-error');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

async function runReport() {
  const fromEl = $('#att-from'), toEl = $('#att-to');
  if (!fromEl || !toEl) return; // navigated away
  const next = { from: fromEl.value, to: toEl.value };
  const problem = validateRange(next.from, next.to);
  if (problem) { showError(problem); return; }
  showError('');
  range = next;

  const seq = ++requestSeq;
  const runBtn = $('#att-run');
  runBtn.disabled = true;
  runBtn.textContent = 'Running…';

  const { data, error } = await AttendanceModel.report(range);

  if (seq !== requestSeq) return; // a newer run started; let it own the UI
  const btn = $('#att-run');
  if (btn) { btn.disabled = false; btn.textContent = 'Run report'; }
  if (error) { showError(error.message); if (!loaded) { const b = $('#att-body'); if (b) b.innerHTML = ''; } return; }

  rowsCache = data || [];
  loadedRange = { ...range };
  loaded = true;
  page = 1;
  // A department that no longer exists in the new data would otherwise
  // leave an invisible filter active and an empty-looking table.
  if (filters.department && !rowsCache.some((r) => (r.department || '') === filters.department)) filters.department = '';
  paintBody();
}

function paintBody() {
  const body = $('#att-body');
  if (!body) return;
  const exportBtn = $('#att-export');
  if (exportBtn) exportBtn.disabled = !rowsCache.length;

  if (!rowsCache.length) {
    body.innerHTML = `<div class="empty-state">No IN/OUT scans recorded in this range.</div>`;
    return;
  }

  const departments = [...new Set(rowsCache.map((r) => r.department || '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const shown = filterRows(rowsCache, filters);
  const sum = summarize(shown);

  body.innerHTML = `
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat-card accent"><div class="stat-value">${sum.employees}</div><div class="stat-label">Employees</div></div>
      <div class="stat-card"><div class="stat-value">${sum.days}</div><div class="stat-label">Employee-days</div></div>
      <div class="stat-card good"><div class="stat-value">${esc(fmtDuration(sum.workedSeconds))}</div><div class="stat-label">Total time on site</div></div>
      <div class="stat-card warn"><div class="stat-value">${sum.open}</div><div class="stat-label">No OUT yet</div></div>
      <div class="stat-card bad"><div class="stat-value">${sum.anomalies}</div><div class="stat-label">Check times</div></div>
    </div>

    <div class="filter-row" style="margin-bottom:12px;">
      <input class="search" id="att-q" type="search" placeholder="Search name or code…" value="${esc(filters.query)}" />
      <select id="att-dept">
        <option value="">All departments</option>
        ${departments.map((d) => `<option value="${esc(d)}" ${d === filters.department ? 'selected' : ''}>${esc(d)}</option>`).join('')}
      </select>
      <select id="att-status">
        <option value="">All statuses</option>
        ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === filters.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}
      </select>
    </div>

    <div class="table-scroll"><div id="att-table-wrap"></div></div>
    <div id="att-pagination"></div>
    <p class="sub" style="margin-top:12px;">
      <b>No OUT yet</b> is normal for someone still on shift, and otherwise means a missing OUT scan.
      <b>Check times</b> means an OUT is timestamped before its IN (usually a backdated offline sync).
      Time on site is the sum of each IN to its following OUT, so breaks that were scanned out and in are excluded.
    </p>
  `;

  // The search box repaints only the table, never the whole body — a full
  // repaint would replace the <input> mid-typing and drop focus/caret.
  $('#att-q').addEventListener('input', (e) => { filters.query = e.target.value; page = 1; paintTable(); });
  $('#att-dept').addEventListener('change', (e) => { filters.department = e.target.value; page = 1; paintBody(); });
  $('#att-status').addEventListener('change', (e) => { filters.status = e.target.value; page = 1; paintBody(); });
  paintTable();
}

// Local calendar date from the RPC's 'YYYY-MM-DD' — built from parts, since
// new Date('YYYY-MM-DD') parses as UTC and can show the previous day west of UTC.
function fmtWorkDate(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return String(ymd);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function paintTable() {
  const wrap = $('#att-table-wrap');
  if (!wrap) return;
  const all = filterRows(rowsCache, filters);
  if (!all.length) {
    wrap.innerHTML = `<div class="empty-state">Nothing matches these filters.</div>`;
    $('#att-pagination').innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  if (page > totalPages) page = totalPages;
  const rows = all.slice((page - 1) * pageSize, page * pageSize);

  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th class="col-shrink">Date</th><th>Employee</th><th>Department</th>
        <th class="col-shrink">First IN</th><th class="col-shrink">Last OUT</th>
        <th class="col-shrink">Time on site</th><th class="col-shrink">INs</th><th class="col-shrink">Status</th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => {
          const st = attendanceStatus(r);
          return `
            <tr>
              <td class="col-shrink mono">${esc(fmtWorkDate(r.work_date))}</td>
              <td>${esc(r.full_name)}<div class="sub mono" style="margin:0;">${esc(r.employee_code)}</div></td>
              <td>${esc(r.department || '—')}</td>
              <td class="col-shrink mono">${esc(fmtTime(r.first_in))}</td>
              <td class="col-shrink mono">${r.last_out ? esc(fmtTime(r.last_out)) : '—'}</td>
              <td class="col-shrink mono">${esc(fmtDuration(Number(r.worked_seconds)))}</td>
              <td class="col-shrink mono">${r.in_count}</td>
              <td class="col-shrink"><span class="badge ${STATUS_BADGE[st]}">${esc(STATUS_LABEL[st])}</span></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;

  renderPagination($('#att-pagination'), {
    total: all.length, page, pageSize,
    onChange: (next) => { page = next.page; pageSize = next.pageSize; paintTable(); },
  });
}

// Exports every row matching the current filters (not just the visible
// page), labelled with the range the data was actually loaded for — not
// whatever the date inputs say right now, which may have been edited
// without re-running the report.
function exportRows() {
  const rows = filterRows(rowsCache, filters);
  if (!rows.length || !loadedRange) return;
  try {
    exportXlsx({
      filename: `attendance-${loadedRange.from}_${loadedRange.to}-${todayStamp()}.xlsx`,
      sheetName: 'Attendance',
      columns: [
        { key: 'work_date', label: 'Date' },
        { key: 'employee_code', label: 'Employee code', text: true },
        { key: 'full_name', label: 'Employee' },
        { key: 'department', label: 'Department' },
        { key: 'first_in', label: 'First IN' },
        { key: 'last_out', label: 'Last OUT' },
        { key: 'duration', label: 'Time on site (h m)' },
        { key: 'hours', label: 'Hours (decimal)' },
        { key: 'in_count', label: 'IN scans' },
        { key: 'status', label: 'Status' },
      ],
      rows: rows.map((r) => ({
        work_date: r.work_date,
        employee_code: r.employee_code,
        full_name: r.full_name,
        department: r.department || '',
        first_in: fmtTime(r.first_in),
        last_out: r.last_out ? fmtTime(r.last_out) : '',
        duration: fmtDuration(Number(r.worked_seconds)),
        hours: toDecimalHours(Number(r.worked_seconds)),
        in_count: r.in_count,
        status: STATUS_LABEL[attendanceStatus(r)],
      })),
    });
  } catch (err) {
    toast(err.message || 'Export failed', 'error');
  }
}
