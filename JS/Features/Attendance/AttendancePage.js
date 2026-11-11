// Attendance report — per-employee, per-day first IN / last OUT / time on
// site, built from the scan history the kiosks already record. Read-only.
//
// Paging, filtering and the headline totals are all SERVER-side as of
// 2026-10-09 (see 20261009000000). The browser used to download 1000 rows —
// PostgREST's cap, not the report's size — and display 50 of them, which both
// hid the rest of a 3,382-row week and paid for rows nobody looked at. Now a
// page fetch returns the page, so every row is reachable AND a typical visit
// moves fewer bytes than before.
//
// What a row *means* (complete / no OUT yet / check times) still lives in
// Utils/attendance.js so it stays unit-tested; the SQL mirrors the same
// precedence (anomaly beats open beats complete).
import { $ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { canViewAttendance, isAdminOrManager } from '../../Core/state.js';
import { openOpenPunchModal } from '../../Components/OpenPunchModal.js';
import { renderPagination } from '../../Components/Pagination.js';
import { exportXlsx, todayStamp } from '../../Utils/xlsxExport.js';
import { AttendanceModel } from '../../Models/AttendanceModel.js';
import { reportError } from '../../Utils/userError.js';
import { isFresh, markFetched, PAGE_MAX_AGE_MS } from '../../Utils/freshness.js';
import { openScanLogModal } from '../../Components/ScanLogModal.js';
import { dateRangePickerHTML, mountDateRangePicker } from '../../Components/DateRangePicker.js';
import {
  attendanceStatus, STATUS_LABEL, fmtDuration, toDecimalHours,
  validateRange, defaultRange, toSummary,
} from '../../Utils/attendance.js';
import {
  punctualityState, PUNCTUALITY_STATE, onTimeRate, classifiedDays,
  fmtClock, fmtOffset, isLate,
} from '../../Utils/punctuality.js';
import {
  overtimeState, OVERTIME_STATE, measuredDays, breakSeconds,
  fmtOvertime, fmtHoursTotal, isOver, isShort, BREAK_NOTICE_SECONDS,
} from '../../Utils/overtime.js';

const STATUS_BADGE = { complete: 'matched', open: 'unassigned_card', anomaly: 'inactive_card' };

// Typing in the search box now costs a round trip, so wait for a pause rather
// than firing per keystroke. Long enough to swallow a word, short enough that
// it still feels live.
const SEARCH_DEBOUNCE_MS = 350;

// PostgREST refuses more than 1000 rows per response whatever we ask for, so
// the export pages at that size rather than pretending one request can do it.
const EXPORT_PAGE_SIZE = 1000;

// THE WHOLE QUERY IS THE KEY. This page fires two requests a visit (report +
// summary) and had no freshness gate at all, so the router refetched both on
// every nav click. Keying on the query rather than invalidating around it
// means a filter change misses naturally — a different question gets a
// different timestamp — and paging back to a page already seen inside the
// window costs nothing.
const attendanceKey = () => `attendance:${JSON.stringify(currentQuery())}:${page}:${pageSize}`;

let range = defaultRange();
let userSetRange = false;
let filters = { query: '', department: '', status: '' };
let page = 1;
let pageSize = 50;
let pageRows = [];        // just the rows on screen
let totals = null;        // filtered, uncapped — drives the stat cards and the pager
let departments = [];
let loaded = false;
let requestSeq = 0;
let loadedRange = null;  // the range the current rows cover
let searchTimer = null;
let rangePicker = null;

export async function renderAttendance() {
  const content = $('#content');
  if (!canViewAttendance()) { content.innerHTML = `<div class="empty-state">You don't have access to this page.</div>`; return; }

  if (!userSetRange) range = defaultRange();

  content.innerHTML = `
    <div class="toolbar">
      <div class="filter-row">
        <input class="search" id="att-q" type="search" placeholder="Search name or code…" value="${esc(filters.query)}" />
        <select id="att-dept"><option value="">All departments</option></select>
        <select id="att-status">
          <option value="">All statuses</option>
          ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${k === filters.status ? 'selected' : ''}>${esc(v)}</option>`).join('')}
        </select>
      </div>
      <div class="filter-row">
        ${dateRangePickerHTML('att-range', { from: range.from, to: range.to, emptyLabel: 'Pick dates' })}
        <button class="primary" id="att-run">Run report</button>
        <button class="ghost" id="att-export" disabled>Export</button>
      </div>
    </div>
    <div class="auth-error hidden" id="att-error" style="margin-bottom:12px;"></div>
    <div id="att-body">${loaded ? '' : 'Loading…'}</div>
  `;

  paintDepartments();

  $('#att-q').addEventListener('input', (e) => {
    filters.query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { page = 1; load(); }, SEARCH_DEBOUNCE_MS);
  });
  $('#att-dept').addEventListener('change', (e) => { filters.department = e.target.value; page = 1; load(); });
  $('#att-status').addEventListener('change', (e) => { filters.status = e.target.value; page = 1; load(); });
  $('#att-run').addEventListener('click', () => { page = 1; load({ force: true }); });
  $('#att-export').addEventListener('click', exportRows);
  // Applying a range is an explicit act (Apply / Clear / a preset), so this
  // reloads immediately; typing a date does not reach here, and so cannot
  // fire a request per keystroke.
  rangePicker?.destroy();
  rangePicker = mountDateRangePicker($('#att-range'), {
    onApply: ({ from, to }) => {
      userSetRange = true;
      range = { from, to };
      page = 1;
      load({ force: true });
    },
  });

  if (loaded) paintBody();
  await load();
}

function showError(message) {
  const el = $('#att-error');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

function currentQuery() {
  return { from: range.from, to: range.to, ...filters };
}

async function load({ force = false } = {}) {
  if (!$('#att-body')) return; // navigated away
  // `range` is the source of truth now, kept current by the picker's onApply.
  // Reading it back out of two inputs was what made an inverted pair or a
  // half-typed year reach the RPC at all.
  const problem = validateRange(range.from, range.to);
  if (problem) { showError(problem); return; }
  showError('');

  // Safe to return before the bookkeeping below: the range is part of the
  // key, so a fresh hit means the range has not moved and `loadedRange` is
  // already correct. "Run report" and the open-punch modal both force.
  if (!force && loaded && isFresh(attendanceKey(), PAGE_MAX_AGE_MS)) { paintBody(); return; }

  const rangeChanged = loadedRange?.from !== range.from || loadedRange?.to !== range.to;
  if (rangeChanged) departments = [];
  loadedRange = { ...range };

  const seq = ++requestSeq;
  const runBtn = $('#att-run');
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Running…'; }

  const q = currentQuery();
  const wantsDepartments = force || !departments.length;
  const [rowsRes, totalsRes, deptRes] = await Promise.all([
    AttendanceModel.report({ ...q, limit: pageSize, offset: (page - 1) * pageSize }),
    AttendanceModel.summary(q),
    wantsDepartments ? AttendanceModel.departments(range) : Promise.resolve(null),
  ]);

  if (seq !== requestSeq) return; // a newer request owns the UI
  const btn = $('#att-run');
  if (btn) { btn.disabled = false; btn.textContent = 'Run report'; }

  if (rowsRes.error) {
    showError(reportError(rowsRes.error, 'attendance.report', "Couldn't load the attendance report."));
    if (!loaded) { const b = $('#att-body'); if (b) b.innerHTML = ''; }
    return;
  }

  pageRows = rowsRes.data || [];
  totals = totalsRes?.error ? null : toSummary(totalsRes?.data);
  if (deptRes && !deptRes.error) {
    departments = (deptRes.data || []).map((r) => r.department).filter(Boolean);
  }
  // Marked only past the error return above, so a failed report is retried on
  // the next visit rather than held on screen for the rest of the window.
  markFetched(attendanceKey());
  loaded = true;
  paintDepartments();
  paintBody();
}

// Populated from its own RPC, so the list covers the whole range instead of
// only the departments that happen to appear on the loaded page.
function paintDepartments() {
  const el = $('#att-dept');
  if (!el) return;
  el.innerHTML = `<option value="">All departments</option>${
    departments.map((d) => `<option value="${esc(d)}" ${d === filters.department ? 'selected' : ''}>${esc(d)}</option>`).join('')}`;
}

function paintBody() {
  const body = $('#att-body');
  if (!body) return;
  const total = totals?.days ?? pageRows.length;
  const exportBtn = $('#att-export');
  if (exportBtn) exportBtn.disabled = !total;

  // The totals describe the same filtered set the table is paging through, so
  // they move with the filters and always match the pager's count. If the
  // totals request failed, say so rather than printing zeroes that look like
  // real figures — a wrong number here is worse than a missing one.
  // Mirrors close_open_punches()'s own is_admin_or_manager() gate. The RPC is
  // the boundary; this only decides whether to offer the card as a way in.
  const canEdit = isAdminOrManager();
  const statsHTML = totals ? `
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat-card accent" title="Distinct employees matching the current filters."><div class="stat-value">${totals.employees.toLocaleString()}</div><div class="stat-label">Employees</div></div>
      <div class="stat-card" title="One row per employee per day, so someone working several days contributes several rows."><div class="stat-value">${totals.days.toLocaleString()}</div><div class="stat-label">Employee-days</div></div>
      <div class="stat-card good" title="Sum of every IN&#8594;OUT gap. Breaks scanned out and back in are excluded, and a day with no OUT yet contributes 0 until it's closed."><div class="stat-value">${esc(fmtDuration(totals.workedSeconds))}</div><div class="stat-label">Total time on site</div></div>
      <div class="stat-card warn${totals.open && canEdit ? ' clickable' : ''}"${totals.open && canEdit ? ' id="att-open-review" role="button" tabindex="0"' : ''} title="Days with an IN and no following OUT. Normal for someone still on shift; otherwise usually a missed OUT scan.${totals.open && canEdit ? ' Click to review and close them.' : ''}"><div class="stat-value">${totals.open.toLocaleString()}</div><div class="stat-label">No OUT yet</div></div>
      <div class="stat-card bad" title="Days where an OUT is timestamped before its IN — almost always a backdated offline sync landing out of order."><div class="stat-value">${totals.anomalies.toLocaleString()}</div><div class="stat-label">Check times</div></div>
    </div>`
    : `<div class="empty-state" style="margin:0 0 12px;text-align:left;">Totals are unavailable right now. The rows below are still correct.</div>`;

  body.innerHTML = `
    ${statsHTML}
    ${punctualityHTML()}
    ${overtimeHTML()}
    <div class="table-scroll"><div id="att-table-wrap"></div></div>
    <div id="att-pagination"></div>
  `;

  // The queue is reachable from the number that describes it, rather than
  // from a toolbar button competing with Run report and Export. Only opened
  // on demand, so it costs one request when someone actually looks.
  const reviewCard = $('#att-open-review');
  if (reviewCard) {
    const open = () => openOpenPunchModal({ from: range.from, to: range.to }, () => load({ force: true }));
    reviewCard.addEventListener('click', open);
    reviewCard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  }

  paintTable();
}

// Punctuality, as one line rather than three more stat cards: the grid above
// is already five cards and wraps to 2+2+1 on a 375px phone, so adding to it
// makes the worst layout worse. A strip reflows to two lines at most.
//
// Everything here comes from the summary request the page already made. There
// is no second fetch, and no polling.
function punctualityHTML() {
  if (!totals) return '';

  switch (punctualityState(totals)) {
    case PUNCTUALITY_STATE.UNCONFIGURED:
      // No numbers at all in this state. A guessed shift start would label
      // hundreds of people against a time nobody chose, and "0% on time"
      // would read as a finding rather than a missing setting.
      return `<div class="punct-strip punct-unset">
          Shift times aren't set, so punctuality can't be measured.
          <span class="sub">An admin can set them under Settings → Shift times.</span>
        </div>`;

    case PUNCTUALITY_STATE.NO_DATA:
      return '';

    default: {
      const rate = onTimeRate(totals);
      const avg = fmtClock(totals.avgFirstInSeconds);
      const judged = classifiedDays(totals);
      return `<div class="punct-strip">
          <span><strong class="${rate >= 90 ? 'punct-good' : 'punct-warn'}">${rate}%</strong> on time</span>
          <span><strong>${totals.lateDays.toLocaleString()}</strong> late</span>
          ${avg ? `<span>average arrival <strong>${esc(avg)}</strong></span>` : ''}
          ${/* Stated, not hidden: a percentage whose denominator quietly
                excluded a chunk of the range is how a wrong figure gets
                quoted in a meeting. */''}
          <span class="sub">over ${judged.toLocaleString()} judged day${judged === 1 ? '' : 's'}${
            totals.unclassified ? `, ${totals.unclassified.toLocaleString()} not judged` : ''}</span>
        </div>`;
    }
  }
}

// A second strip rather than more figures on the punctuality one. The two
// halves of a shift are configured independently — a rule can have a start
// time and no expected hours — so they can be in different states at the same
// time, and one line that was sometimes half-populated would be harder to
// read than two that each say one thing.
//
// Silent when unconfigured, unlike punctuality's explicit "not set" note:
// punctuality is the headline feature of that panel and its absence needs
// explaining, whereas a second nudge about a second setting on the same page
// is nagging. Settings says what it enables.
function overtimeHTML() {
  if (!totals) return '';
  if (overtimeState(totals) !== OVERTIME_STATE.READY) return '';

  const measured = measuredDays(totals);
  const net = totals.overtimeMinutes - totals.shortMinutes;
  return `<div class="punct-strip">
      <span><strong class="${totals.overtimeMinutes > 0 ? 'punct-warn' : ''}">${esc(fmtHoursTotal(totals.overtimeMinutes))}</strong> overtime</span>
      <span><strong>${totals.overDays.toLocaleString()}</strong> long day${totals.overDays === 1 ? '' : 's'}</span>
      <span><strong>${esc(fmtHoursTotal(totals.shortMinutes))}</strong> short, over ${totals.shortDays.toLocaleString()} day${totals.shortDays === 1 ? '' : 's'}</span>
      ${/* Net is the number a payroll conversation actually starts from, and
            it is not derivable from the two totals without knowing they are
            both positive magnitudes. */''}
      <span class="sub">net ${net >= 0 ? '+' : '−'}${esc(fmtHoursTotal(Math.abs(net)))} over ${measured.toLocaleString()} measured day${measured === 1 ? '' : 's'}${
        totals.unmeasuredDays ? `, ${totals.unmeasuredDays.toLocaleString()} not measured` : ''}</span>
    </div>`;
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
  const total = totals?.days ?? pageRows.length;

  if (!pageRows.length) {
    const anyFilter = filters.query || filters.department || filters.status;
    wrap.innerHTML = `<div class="empty-state">${anyFilter ? 'Nothing matches these filters.' : 'No IN/OUT scans recorded in this range.'}</div>`;
    $('#att-pagination').innerHTML = '';
    return;
  }

  wrap.innerHTML = `
    <table class="table-as-cards">
      <thead><tr>
        <th class="col-shrink">Date</th><th>Employee</th><th>Department</th>
        <th class="col-shrink">First IN</th><th class="col-shrink">Last OUT</th>
        <th class="col-shrink">Time on site</th><th class="col-shrink">INs</th><th class="col-shrink">Status</th>
      </tr></thead>
      <tbody>
        ${pageRows.map((r) => {
          const st = attendanceStatus(r);
          return `
            <tr class="row-clickable" data-emp="${esc(r.employee_id || '')}" data-date="${esc(r.work_date || '')}" tabindex="0"
                title="Open ${esc(r.full_name)}'s scan log">
              <td class="col-shrink mono" data-label="Date">${esc(fmtWorkDate(r.work_date))}</td>
              <!-- The employee is the headline on a phone; the date is one of
                   several details. Desktop column order is untouched. -->
              <td class="card-title">${esc(r.full_name)}<div class="sub mono" style="margin:0;">${esc(r.employee_code)}</div></td>
              <td data-label="Department">${esc(r.department || '—')}</td>
              <!-- The offset sits on First IN rather than in the Status
                   column, because it describes that timestamp. Status stays
                   complete/open/anomaly: a day can be both late and an
                   anomaly, so folding lateness in would make two independent
                   facts look mutually exclusive. -->
              <td class="col-shrink mono" data-label="First IN">${esc(fmtTime(r.first_in))}${
                fmtOffset(r.first_in_offset_minutes) && isLate(r)
                  ? `<div class="sub" style="margin:0;color:var(--warn);">${esc(fmtOffset(r.first_in_offset_minutes))}</div>`
                  : ''}</td>
              <td class="col-shrink mono" data-label="Last OUT">${r.last_out ? esc(fmtTime(r.last_out)) : '—'}</td>
              <!-- Overtime hangs off Time on site because it qualifies that
                   number. Break time sits here too, and costs nothing: it is
                   (last OUT − first IN) − time on site, all three of which
                   are already in this row. No column, no request. A long
                   unexplained gap is often the real story behind a short
                   day, and until now it was invisible despite being on
                   screen. Only shown when it is worth noticing. -->
              <td class="col-shrink mono" data-label="Time on site">${esc(fmtDuration(Number(r.worked_seconds)))}${
                fmtOvertime(r.overtime_minutes) && (isOver(r) || isShort(r))
                  ? `<div class="sub" style="margin:0;color:var(--${isOver(r) ? 'warn' : 'text-muted'});">${esc(fmtOvertime(r.overtime_minutes))}</div>`
                  : ''}${
                breakSeconds(r) >= BREAK_NOTICE_SECONDS
                  ? `<div class="sub" style="margin:0;">${esc(fmtDuration(breakSeconds(r)))} off site</div>`
                  : ''}</td>
              <td class="col-shrink mono" data-label="INs">${r.in_count}</td>
              <td class="col-shrink" data-label="Status"><span class="badge ${STATUS_BADGE[st]}">${esc(STATUS_LABEL[st])}</span></td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;

  // A row raises the question "what actually happened that day?", and the
  // answer already exists as Employee Manager's scan-log dialog. It fetches
  // only when opened; the row date initializes the dialog's local filter, so
  // it adds no request or subscription beyond opening that dialog as before.
  const openLog = (tr) => {
    const id = tr?.dataset.emp;
    if (id) openScanLogModal(id, tr.dataset.date);
  };
  wrap.querySelectorAll('tr.row-clickable').forEach((tr) => {
    tr.addEventListener('click', () => openLog(tr));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLog(tr); }
    });
  });

  renderPagination($('#att-pagination'), {
    total, page, pageSize,
    onChange: (next) => {
      const sizeChanged = next.pageSize !== pageSize;
      page = sizeChanged ? 1 : next.page;
      pageSize = next.pageSize;
      load();
    },
  });
}

// Exports every row matching the current filters, not just the page on
// screen — so it pages through the whole filtered set first. Deliberately the
// only thing in this page that fetches more than it displays: a spreadsheet
// that silently stopped at one page is the failure this replaces.
async function exportRows() {
  const btn = $('#att-export');
  const total = totals?.days ?? 0;
  if (!total) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }

  const q = currentQuery();
  const all = [];
  try {
    for (let offset = 0; offset < total; offset += EXPORT_PAGE_SIZE) {
      const { data, error } = await AttendanceModel.report({ ...q, limit: EXPORT_PAGE_SIZE, offset });
      if (error) throw error;
      if (!data?.length) break;
      all.push(...data);
    }
  } catch (err) {
    toast(reportError(err, 'attendance.export', "Couldn't prepare the export."), 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Export'; }
    return;
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Export'; }
  if (!all.length) return;

  try {
    exportXlsx({
      filename: `attendance-${range.from}_${range.to}-${todayStamp()}.xlsx`,
      sheetName: 'Attendance',
      columns: [
        { key: 'work_date', label: 'Date' },
        // employee_code is recycled when staff resign, so across a handover
        // the same code can appear under two names in one report.
        // employee_id is the only key that stays unambiguous.
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
      rows: all.map((r) => ({
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
    toast(reportError(err, 'attendance.xlsx', 'Export failed.'), 'error');
  }
}
