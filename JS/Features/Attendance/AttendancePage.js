// Attendance report — per-employee, per-day first IN / last OUT / time on
// site, built from the scan history the kiosks already record. Read-only.
//
// All the numbers come from get_attendance_report() (see
// Supabase/README.md for exactly how a row is derived and why); the rules
// for what a row *means* (complete / no OUT yet / check times) live in
// Utils/attendance.js so they're unit-tested rather than buried here.
import { $ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { wireDateRangeOrdering } from '../../Utils/dateRange.js';
import { toast } from '../../Utils/toast.js';
import { canViewAttendance } from '../../Core/state.js';
import { renderPagination } from '../../Components/Pagination.js';
import { exportXlsx, todayStamp } from '../../Utils/xlsxExport.js';
import { AttendanceModel } from '../../Models/AttendanceModel.js';
import { isFresh, markFetched } from '../../Utils/freshness.js';
import {
  attendanceStatus, STATUS_LABEL, fmtDuration, toDecimalHours,
  validateRange, defaultRange, filterRows, summarize,
  toSummary, attendanceTruncationNotice,
} from '../../Utils/attendance.js';
import { truncation } from '../../Utils/rowCap.js';

// Badge colors reuse the existing result-badge classes rather than adding
// new CSS: green = fine, amber = needs a look, red = actually suspicious.
const STATUS_BADGE = { complete: 'matched', open: 'unassigned_card', anomaly: 'inactive_card' };

// How long a report for one range stays good enough to reuse on a nav click.
// Attendance is historical — a 60-second-old report for a past range is the same
// report — and the Run button always forces a refetch anyway.
const ATTENDANCE_MAX_AGE_MS = 60 * 1000;

let range = defaultRange();
// True once the user has actually touched a date input. Before that, every
// render recomputes range = defaultRange() from *today* (see below) — a
// module-level `range` set once at import time would otherwise go stale:
// leave this tab open across midnight and "today" silently means whatever
// day the page happened to first load, not the day it actually is now.
let userSetRange = false;
let rowsCache = [];   // the last successfully loaded report, unfiltered — TRUNCATED at 1000 by PostgREST
let rangeTotals = null; // get_attendance_summary() for loadedRange: true, uncapped, unfiltered
let loaded = false;   // distinguishes "never fetched" from "fetched, zero rows"
let loadedRange = null; // the range rowsCache actually covers (may differ from the inputs mid-edit)
let filters = { query: '', department: '', status: '' };
let page = 1;
let pageSize = 50;
let requestSeq = 0;   // drops a slow, superseded response instead of letting it overwrite a newer one

export async function renderAttendance() {
  const content = $('#content');
  if (!canViewAttendance()) { content.innerHTML = `<div class="empty-state">You don't have access to this page.</div>`; return; }

  // Keep the default anchored to *today* until the user picks their own
  // range — once they do, their choice is what "unless the date picker is
  // used" means, and it survives navigating away and back within this tab.
  if (!userSetRange) range = defaultRange();

  content.innerHTML = `
    <div class="toolbar">
      <div class="filter-row">
        <input class="search" id="att-q" type="search" placeholder="Search name or code…" value="${esc(filters.query)}" />
        <select id="att-dept">
          <option value="">All departments</option>
        </select>
        <select id="att-status">
          <option value="">All statuses</option>
          ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === filters.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-row">
        <input type="date" id="att-from" value="${esc(range.from)}" />
        <input type="date" id="att-to" value="${esc(range.to)}" />
        <button class="primary" id="att-run">Run report</button>
        <button class="ghost" id="att-export" disabled>Export</button>
      </div>
    </div>
    <div class="auth-error hidden" id="att-error" style="margin-bottom:12px;"></div>
    <div id="att-body">${loaded ? '' : 'Loading…'}</div>
  `;

  // Search/department/status live in the persistent page shell above (same
  // one-row toolbar as Employee Manager and Proximity Cards), not inside
  // #att-body, so painting the results never replaces them: the search
  // <input> keeps focus and caret while typing, and the handlers are wired
  // once here instead of being re-bound on every paintBody().
  $('#att-q').addEventListener('input', (e) => { filters.query = e.target.value; page = 1; paintTable(); });
  $('#att-dept').addEventListener('change', (e) => { filters.department = e.target.value; page = 1; paintBody(); });
  $('#att-status').addEventListener('change', (e) => { filters.status = e.target.value; page = 1; paintBody(); });
  // Explicit Run always refetches — "I pressed the button and nothing happened"
  // is never worth the saved request.
  $('#att-run').addEventListener('click', () => runReport({ force: true }));
  $('#att-export').addEventListener('click', exportRows);
  $('#att-from').addEventListener('change', () => { userSetRange = true; });
  $('#att-to').addEventListener('change', () => { userSetRange = true; });
  // Same behaviour as the scan-log export modal: an inverted range (from
  // after to) is swapped into order rather than left always-invalid.
  wireDateRangeOrdering($('#att-from'), $('#att-to'));

  // Paint what we already have, then refresh for the range currently shown —
  // unless that exact range was fetched moments ago, in which case the paint is
  // the whole render. See runReport().
  if (loaded) paintBody();
  await runReport();
}

function showError(message) {
  const el = $('#att-error');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

async function runReport({ force = false } = {}) {
  const fromEl = $('#att-from'), toEl = $('#att-to');
  if (!fromEl || !toEl) return; // navigated away
  const next = { from: fromEl.value, to: toEl.value };
  const problem = validateRange(next.from, next.to);
  if (problem) { showError(problem); return; }
  showError('');
  range = next;

  // Skip the refetch only when the rows already in hand ARE this range's rows.
  // Freshness alone is not enough: rowsCache holds one report, so switching
  // A -> B -> A inside the window would find key A fresh while rowsCache still
  // held B, and paint B's rows under A's label. loadedRange is what makes that
  // impossible.
  const key = `attendance:${range.from}..${range.to}`;
  const haveThisRange = loadedRange?.from === range.from && loadedRange?.to === range.to;
  if (!force && loaded && haveThisRange && isFresh(key, ATTENDANCE_MAX_AGE_MS)) { paintBody(); return; }

  const seq = ++requestSeq;
  const runBtn = $('#att-run');
  runBtn.disabled = true;
  runBtn.textContent = 'Running…';

  // In parallel: the rows (capped at 1000 by PostgREST) and one row of true
  // totals for the same range. The summary is what the stat cards read — see
  // Utils/attendance.js's ROW_CAP for why deriving them from `data` was wrong.
  const [rows, totals] = await Promise.all([
    AttendanceModel.report(range),
    AttendanceModel.summary(range),
  ]);
  const { data, error } = rows;

  if (seq !== requestSeq) return; // a newer run started; let it own the UI
  const btn = $('#att-run');
  if (btn) { btn.disabled = false; btn.textContent = 'Run report'; }
  if (error) { showError(error.message); if (!loaded) { const b = $('#att-body'); if (b) b.innerHTML = ''; } return; }

  rowsCache = data || [];
  // A failed summary must not blank a working report: fall back to deriving
  // from the rows in hand, which is exactly the old behaviour — understated
  // when truncated, but never worse than before this change.
  rangeTotals = totals?.error ? null : toSummary(totals?.data);
  loadedRange = { ...range };
  loaded = true;
  markFetched(key);
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

  // Department choices come from the loaded report, so they're refreshed
  // here (into the persistent toolbar's <select>) every time the data or a
  // filter changes — including down to just "All departments" when a new
  // range comes back empty.
  const departments = [...new Set(rowsCache.map((r) => r.department || '').filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const deptEl = $('#att-dept');
  if (deptEl) {
    deptEl.innerHTML = `<option value="">All departments</option>${departments.map((d) => `<option value="${esc(d)}" ${d === filters.department ? 'selected' : ''}>${esc(d)}</option>`).join('')}`;
  }

  if (!rowsCache.length) {
    body.innerHTML = `<div class="empty-state">No IN/OUT scans recorded in this range.</div>`;
    return;
  }

  // Headline numbers come from get_attendance_summary() — the whole range,
  // uncapped and unfiltered — not from the rows in hand. Filters narrow the
  // table below, not these: a filter changing "Total time on site" would make
  // the figure impossible to quote, and deriving it from a 1000-row slice of
  // a 3,342-row range was reporting a third of the truth as all of it.
  const sum = rangeTotals || summarize(rowsCache);
  const cut = truncation(rowsCache.length, sum.days);
  const notice = attendanceTruncationNotice(cut);
  const scope = rangeTotals ? 'the whole date range' : 'the rows loaded';

  body.innerHTML = `
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat-card accent" title="Distinct employees with at least one recorded day across ${scope}."><div class="stat-value">${sum.employees.toLocaleString()}</div><div class="stat-label">Employees</div></div>
      <div class="stat-card" title="One row per employee per day across ${scope}, so someone working several days contributes several rows."><div class="stat-value">${sum.days.toLocaleString()}</div><div class="stat-label">Employee-days</div></div>
      <div class="stat-card good" title="Sum of every IN&#8594;OUT gap across ${scope}. Breaks scanned out and back in are excluded, and a day with no OUT yet contributes 0 until it's closed."><div class="stat-value">${esc(fmtDuration(sum.workedSeconds))}</div><div class="stat-label">Total time on site</div></div>
      <div class="stat-card warn" title="Days with an IN and no following OUT, across ${scope}. Normal for someone still on shift; otherwise usually a missed OUT scan."><div class="stat-value">${sum.open.toLocaleString()}</div><div class="stat-label">No OUT yet</div></div>
      <div class="stat-card bad" title="Days where an OUT is timestamped before its IN, across ${scope} — almost always a backdated offline sync landing out of order."><div class="stat-value">${sum.anomalies.toLocaleString()}</div><div class="stat-label">Check times</div></div>
    </div>

    ${notice ? `<div class="empty-state" id="att-truncated" style="margin:0 0 12px;text-align:left;">${esc(notice)}</div>` : ''}

    <div class="table-scroll"><div id="att-table-wrap"></div></div>
    <div id="att-pagination"></div>
  `;

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
  // A spreadsheet gets filed and quoted long after the screen it came from is
  // gone, so a truncated export is worse than a truncated table: nothing in
  // the file says it is partial. Say so at the moment it is written.
  const cut = truncation(rowsCache.length, rangeTotals?.days ?? rowsCache.length);
  if (cut.truncated) {
    toast(`Exporting the ${cut.fetched.toLocaleString()} most recent of ${cut.total.toLocaleString()} employee-days — `
      + `${cut.missing.toLocaleString()} older rows are not in this file. Narrow the date range to export them.`, 'error');
  }
  try {
    exportXlsx({
      filename: `attendance-${loadedRange.from}_${loadedRange.to}-${todayStamp()}.xlsx`,
      sheetName: 'Attendance',
      columns: [
        { key: 'work_date', label: 'Date' },
        // employee_code is recycled when staff resign
        // (employees_employee_code_current_key), so across a handover the same
        // code can appear under two names in one report. employee_id is the
        // only key that stays unambiguous — group or pivot on it, not the code.
        { key: 'employee_id', label: 'Employee ID', text: true },
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
        employee_id: r.employee_id || '',
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
