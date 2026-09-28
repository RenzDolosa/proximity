// Dashboard — the "what's happening right now" landing page: headline
// numbers from get_dashboard_stats() plus the live on-site roster from
// get_onsite_roster() (everyone whose LAST scan was an IN).
//
// Read-only. All rules for what counts as "live" vs "stale" and how rows
// filter live in Utils/dashboard.js (unit-tested); the RPCs are the real
// permission gate, isAdminOrManager() here is a convenience.
import { $ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { appState, isAdminOrManager } from '../../Core/state.js';
import { renderPagination } from '../../Components/Pagination.js';
import { exportXlsx, todayStamp } from '../../Utils/xlsxExport.js';
import { fmtDuration } from '../../Utils/attendance.js';
import { summarizeRoster, filterRoster } from '../../Utils/dashboard.js';
import { DashboardModel } from '../../Models/DashboardModel.js';

const REFRESH_MS = 30000;

let stats = null;
let roster = [];
let loaded = false;
let filters = { query: '', department: '', view: 'live' };
let page = 1;
let pageSize = 50;
let requestSeq = 0;
let timer = null;

export async function renderDashboard() {
  const content = $('#content');
  clearInterval(timer);
  if (!isAdminOrManager()) { content.innerHTML = `<div class="empty-state">You don't have access to this page.</div>`; return; }

  content.innerHTML = `
    <div class="auth-error hidden" id="dash-error" style="margin-bottom:12px;"></div>
    <div id="dash-stats">${loaded ? '' : 'Loading…'}</div>
    <div class="panel" style="padding:20px;margin-top:16px;">
      <div class="panel-head" style="margin-bottom:12px;">
        <div>
          <h3 style="margin:0 0 4px;">On site now</h3>
          <div class="emp-meta" id="dash-updated"></div>
        </div>
        <button class="ghost" id="dash-refresh">Refresh</button>
      </div>
      <div class="toolbar" style="margin-bottom:10px;">
        <div class="filter-row">
          <input class="search" id="dash-q" type="search" placeholder="Search name or code…" value="${esc(filters.query)}" />
          <select id="dash-dept"><option value="">All departments</option></select>
          <select id="dash-view">
            <option value="live" ${filters.view === 'live' ? 'selected' : ''}>On site</option>
            <option value="stale" ${filters.view === 'stale' ? 'selected' : ''}>Possibly left (old IN)</option>
            <option value="all" ${filters.view === 'all' ? 'selected' : ''}>Everyone with a last IN</option>
          </select>
          <button class="ghost" id="dash-export" disabled>Export</button>
        </div>
      </div>
      <div class="table-scroll"><div id="dash-table">${loaded ? '' : 'Loading…'}</div></div>
      <div id="dash-pagination"></div>
    </div>
  `;

  $('#dash-q').addEventListener('input', (e) => { filters.query = e.target.value; page = 1; paintTable(); });
  $('#dash-dept').addEventListener('change', (e) => { filters.department = e.target.value; page = 1; paintTable(); });
  $('#dash-view').addEventListener('change', (e) => { filters.view = e.target.value; page = 1; paintTable(); });
  $('#dash-refresh').addEventListener('click', load);
  $('#dash-export').addEventListener('click', exportRows);

  if (loaded) { paintStats(); paintTable(); }
  await load();
  // Auto-refresh only while this page is on screen; the interval clears
  // itself the moment the DOM it paints into is gone.
  timer = setInterval(() => {
    if (appState.route !== 'dashboard' || !$('#dash-table')) { clearInterval(timer); return; }
    load();
  }, REFRESH_MS);
}

function showError(message) {
  const el = $('#dash-error');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

async function load() {
  const seq = ++requestSeq;
  const btn = $('#dash-refresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  const [s, r] = await Promise.all([DashboardModel.stats(), DashboardModel.onSiteRoster()]);
  if (seq !== requestSeq) return; // superseded by a newer load
  const b = $('#dash-refresh');
  if (b) { b.disabled = false; b.textContent = 'Refresh'; }
  const err = s.error || r.error;
  if (err) { showError(err.message); return; }
  showError('');
  stats = s.data;
  roster = r.data || [];
  loaded = true;
  if (filters.department && !roster.some((x) => (x.department || '') === filters.department)) filters.department = '';
  paintStats();
  paintTable();
}

function statCard(label, value, { tone = '', route = null } = {}) {
  const attrs = route ? ` data-goto="${route}" role="link" tabindex="0"` : '';
  return `<div class="stat-card${tone ? ` ${tone}` : ''}${route ? ' clickable' : ''}"${attrs}>
    <div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function paintStats() {
  const el = $('#dash-stats');
  if (!el || !stats) return;
  const rate = stats.scans_24h ? `${Math.round((stats.matched_24h / stats.scans_24h) * 100)}%` : '—';
  const alerts = stats.unread_alerts;
  const sum = summarizeRoster(roster);
  el.innerHTML = `
    <div class="stat-grid">
      ${statCard('On site', sum.live, { tone: 'accent' })}
      ${statCard('Possibly left (old IN)', sum.stale, { tone: sum.stale ? 'warn' : '' })}
      ${statCard('Scans, last 24h', stats.scans_24h, { route: 'analytics' })}
      ${statCard('Match rate, 24h', rate, { tone: stats.scans_24h && stats.matched_24h / stats.scans_24h < 0.8 ? 'warn' : 'good' })}
      ${statCard('Scanners online', `${stats.scanners_online} / ${stats.scanners_total}`, { tone: stats.scanners_online < stats.scanners_total ? 'warn' : 'good', route: 'analytics' })}
      ${alerts == null ? '' : statCard('Unread alerts', alerts, { tone: alerts ? 'bad' : '', route: 'alerts' })}
      ${statCard('Open remarks', stats.employees_with_open_remarks, { route: 'directory' })}
      ${statCard('Unassigned active cards', stats.unassigned_active_cards, { route: 'proximity' })}
    </div>
    ${sum.byDepartment.length ? `<div class="emp-meta" style="margin-top:10px;">On site by department: ${sum.byDepartment.map((d) => `<strong>${esc(d.department)}</strong> ${d.count}`).join(' · ')}</div>` : ''}
  `;
  el.querySelectorAll('[data-goto]').forEach((card) => {
    const go = () => { appState.route = card.dataset.goto; import('../../Core/router.js').then((m) => m.render()); };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function currentRows() { return filterRoster(roster, filters); }

function paintTable() {
  const wrap = $('#dash-table');
  if (!wrap) return;
  // Department options come from the full roster so the list doesn't
  // shrink as other filters narrow the table.
  const dept = $('#dash-dept');
  if (dept) {
    const depts = [...new Set(roster.map((r) => r.department || '').filter(Boolean))].sort();
    dept.innerHTML = `<option value="">All departments</option>` +
      depts.map((d) => `<option value="${esc(d)}" ${d === filters.department ? 'selected' : ''}>${esc(d)}</option>`).join('');
  }
  const upd = $('#dash-updated');
  if (upd) upd.textContent = `Updated ${fmtTime(new Date().toISOString())} · refreshes every ${REFRESH_MS / 1000}s`;

  const all = currentRows();
  const exp = $('#dash-export');
  if (exp) exp.disabled = !all.length;
  if (!all.length) {
    wrap.innerHTML = `<div class="empty-state">${roster.length ? 'No one matches the current filter.' : 'Nobody is currently on site.'}</div>`;
    $('#dash-pagination').innerHTML = '';
    return;
  }
  const slice = all.slice((page - 1) * pageSize, page * pageSize);
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>IN at</th><th>Time on site</th><th>Scanner</th><th></th></tr></thead>
      <tbody>${slice.map((r) => `
        <tr>
          <td>${esc(r.full_name)}</td>
          <td class="mono">${esc(r.employee_code)}</td>
          <td>${esc(r.department || '—')}</td>
          <td>${esc(fmtTime(r.last_in_at))}</td>
          <td class="mono">${esc(fmtDuration(Number(r.seconds_on_site)))}</td>
          <td>${esc(r.last_scanner_id || '—')}</td>
          <td>${r.is_stale ? '<span class="badge unassigned_card">old IN</span>' : ''}${r.status && r.status !== 'active' ? ` <span class="badge ${esc(r.status)}">${esc(r.status)}</span>` : ''}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  renderPagination($('#dash-pagination'), {
    total: all.length, page, pageSize,
    onChange: (next) => { page = next.page; pageSize = next.pageSize; paintTable(); },
  });
}

function exportRows() {
  const rows = currentRows();
  if (!rows.length) { toast('Nothing to export for the current filter.', 'error'); return; }
  try {
    exportXlsx({
      filename: `on-site-${todayStamp()}.xlsx`,
      sheetName: 'On site',
      columns: [
        { key: 'employee_code', label: 'Employee code', text: true },
        { key: 'full_name', label: 'Employee' },
        { key: 'department', label: 'Department' },
        { key: 'last_in_at', label: 'IN at' },
        { key: 'time_on_site', label: 'Time on site' },
        { key: 'last_scanner_id', label: 'Scanner' },
        { key: 'flag', label: 'Flag' },
      ],
      rows: rows.map((r) => ({
        ...r,
        last_in_at: fmtTime(r.last_in_at),
        time_on_site: fmtDuration(Number(r.seconds_on_site)),
        flag: r.is_stale ? 'Old IN — may have left' : '',
      })),
    });
  } catch (e) { toast(e.message, 'error'); }
}
