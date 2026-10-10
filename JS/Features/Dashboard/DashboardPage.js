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
import { summarizeRoster, filterRoster, mergeRosterDelta, deriveRoster } from '../../Utils/dashboard.js';
import { DashboardModel } from '../../Models/DashboardModel.js';
import { openDepartmentRosterModal } from '../../Components/DepartmentRosterModal.js';

const REFRESH_MS = 30000;
// The delta's self-heal, not a correctness requirement: a cursor only sees rows
// whose updated_at moved, so it cannot observe a hard-DELETEd employee or recover
// from a laptop that slept through a stretch of changes. One full roster every
// 10 minutes fixes every such case without reasoning about them individually.
const ROSTER_FULL_RESYNC_MS = 10 * 60 * 1000;

let stats = null;
let roster = [];          // raw rows as the server sent them — NO derived fields
let rosterCursor = null;  // `cursor` from the last delta; null forces a full sync
let rosterStaleHours = 16;
let rosterSyncedAt = 0;
let lastLoadAt = 0;
let loaded = false;
// One-shot latches for a client deployed ahead of its migrations, so later
// refreshes go straight to the legacy RPC instead of paying a failed round trip.
//
// Note what latching the roster one costs: a full roster on every poll, i.e.
// exactly the behaviour the delta exists to remove. If the Dashboard feels
// expensive again, check that 20261006120000_onsite_roster_delta.sql was applied.
let pulseUnavailable = false;
const MISSING_PULSE = { code: 'PGRST202', message: 'Could not find the function public.get_dashboard_pulse' };
let rosterDeltaUnavailable = false;
const MISSING_ROSTER_DELTA = { code: 'PGRST202', message: 'Could not find the function public.get_onsite_roster_delta' };

// Same signal OfflineScanModel.js checks for: PostgREST answers an unknown
// RPC with PGRST202, which means "not deployed yet", not "retry me".
function isMissingFunctionError(error) {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  return /could not find the function/i.test(error.message || '');
}
let filters = { query: '', department: '', view: 'live' };
let page = 1;
let pageSize = 50;
let requestSeq = 0;
let timer = null;
let visibilityHandler = null;

export async function renderDashboard() {
  const content = $('#content');
  clearInterval(timer);
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
  if (!isAdminOrManager()) { content.innerHTML = `<div class="empty-state">You don't have access to this page.</div>`; return; }

  content.innerHTML = `
    <div class="auth-error hidden" id="dash-error" style="margin-bottom:12px;"></div>
    <div id="dash-stats">${loaded ? '' : 'Loading…'}</div>
    <div class="panel" id="dash-panel" style="padding:20px;margin-top:16px;">
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
  // force: an explicit Refresh click should re-read the roster even when the
  // pulse says nothing changed — "I pressed refresh and it did nothing" is
  // not a trade worth making for a few KB. (Also: a bare `load` here would
  // receive the click Event as its options argument.)
  $('#dash-refresh').addEventListener('click', () => load({ force: true }));
  $('#dash-export').addEventListener('click', exportRows);

  if (loaded) { paintStats(); paintTable(); }
  await load();
  // Auto-refresh only while this page is on screen; the interval clears
  // itself the moment the DOM it paints into is gone.
  timer = setInterval(() => {
    if (appState.route !== 'dashboard' || !$('#dash-table')) { clearInterval(timer); return; }
    if (document.hidden) return;
    load();
  }, REFRESH_MS);
  // Alt-Tab back in. The 30-second timer is suppressed while hidden, so this
  // catches up after a real absence — but it used to fire on every flick away
  // and back, however brief. Reusing REFRESH_MS as the floor means returning
  // lands on the same cadence the page would have had if it had stayed visible.
  visibilityHandler = () => {
    if (document.hidden || appState.route !== 'dashboard' || !$('#dash-table')) return;
    if (Date.now() - lastLoadAt < REFRESH_MS) return;
    load();
  };
  document.addEventListener('visibilitychange', visibilityHandler);
}

function showError(message) {
  const el = $('#dash-error');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

async function load({ force = false } = {}) {
  const seq = ++requestSeq;
  lastLoadAt = Date.now();
  const btn = $('#dash-refresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  const p = pulseUnavailable ? { error: MISSING_PULSE } : await DashboardModel.pulse();
  // A client deployed ahead of the migration keeps the old behaviour rather
  // than showing an empty dashboard — see DashboardModel.js.
  if (p.error && isMissingFunctionError(p.error)) {
    pulseUnavailable = true;
    const [s, r] = await Promise.all([DashboardModel.stats(), DashboardModel.onSiteRoster()]);
    if (seq !== requestSeq) return;
    finish(seq, s.error || r.error, s.data, r.data);
    return;
  }
  if (seq !== requestSeq) return; // superseded by a newer load
  if (p.error) { finish(seq, p.error); return; }

  // `roster_version` from the pulse is deliberately NOT consulted: every matched
  // scan bumps employees.updated_at, so during a shift it changes on essentially
  // every poll and the old code re-downloaded all ~500 rows every 30 seconds per
  // tab — most of this project's egress bill (docs/EGRESS_BUDGET.md). A delta asks
  // only for what moved. Refresh and the periodic self-heal drop the cursor, which
  // is what asks for the whole roster.
  const wantsFull = force || !loaded || !rosterCursor
    || Date.now() - rosterSyncedAt > ROSTER_FULL_RESYNC_MS;
  const d = rosterDeltaUnavailable
    ? { error: MISSING_ROSTER_DELTA }
    : await DashboardModel.rosterDelta(wantsFull ? null : rosterCursor);

  if (d.error && isMissingFunctionError(d.error)) {
    rosterDeltaUnavailable = true;
    const r = await DashboardModel.onSiteRoster();
    if (seq !== requestSeq) return;
    finish(seq, r.error, p.data?.stats, r.data);
    return;
  }
  if (seq !== requestSeq) return;
  if (d.error) { finish(seq, d.error, p.data?.stats); return; }

  finish(seq, null, p.data?.stats, mergeRosterDelta(roster, d.data), d.data);
}

// Shared tail of every path through load(). `delta` is present only on the
// incremental path; its cursor is committed HERE, not at the call site, because a
// superseded response must change no state at all — advancing the cursor for rows
// that were discarded would mean never requesting them again. The legacy
// fallbacks pass no delta, leaving the cursor null so they keep asking for full
// rosters, which is all those RPCs can give.
function finish(seq, err, nextStats, nextRoster, delta = null) {
  if (seq !== requestSeq) return;
  const b = $('#dash-refresh');
  if (b) { b.disabled = false; b.textContent = 'Refresh'; }
  if (err) { showError(err.message); return; }
  showError('');
  if (nextStats !== undefined) stats = nextStats;
  roster = nextRoster || [];
  if (delta) {
    rosterCursor = delta.cursor ?? null;
    rosterSyncedAt = Date.now();
    if (Number.isFinite(delta.stale_hours)) rosterStaleHours = delta.stale_hours;
  }
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
  // Derived, not raw: `is_stale` is what splits "On site" from "Possibly left",
  // and it is computed client-side now (see derivedRoster()).
  const derived = derivedRoster();
  const sum = summarizeRoster(derived);
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
    ${sum.byDepartment.length ? `
      <div class="dept-breakdown">
        <div class="dept-breakdown-title">On site by department</div>
        <!-- A wrapping run of "Name 12 · Name 7 · …" separated by dots read
             as one dense paragraph once there were twenty departments and no
             room to lay them out. Each is its own chip now, so the name and
             its count stay together on a line of their own. -->
        <div class="dept-chips">
          ${sum.byDepartment.map((d) => `<button type="button" class="dept-chip" data-dept="${esc(d.department)}">
            <span class="dept-chip-name">${esc(d.department)}</span>
            <span class="dept-chip-count">${d.count}</span>
          </button>`).join('')}
        </div>
      </div>` : ''}
  `;
  el.querySelectorAll('[data-goto]').forEach((card) => {
    const go = () => { appState.route = card.dataset.goto; import('../../Core/router.js').then((m) => m.render()); };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  // Same "live" definition as the count itself (filterRoster's view:'live'),
  // so the modal never shows a different set of people than the number
  // just clicked.
  el.querySelectorAll('[data-dept]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const department = chip.dataset.dept;
      openDepartmentRosterModal(department, filterRoster(derived, { department, view: 'live' }));
    });
  });
}

// seconds_on_site and is_stale are attached at PAINT time, not on arrival: both
// change with nothing but the clock, so deriving them once would freeze "Time on
// site" and never flip is_stale. It is also what removed the old 5-minute
// unconditional refetch — time passing is no longer a reason to call the server.
function derivedRoster() { return deriveRoster(roster, Date.now(), rosterStaleHours); }

function currentRows() { return filterRoster(derivedRoster(), filters); }

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
    <table class="table-as-cards">
      <thead><tr><th>Employee</th><th>Code</th><th>Department</th><th>IN at</th><th>Time on site</th><th>Scanner</th><th></th></tr></thead>
      <tbody>${slice.map((r) => `
        <tr>
          <td>${esc(r.full_name)}</td>
          <td class="mono" data-label="Code">${esc(r.employee_code)}</td>
          <td data-label="Department">${esc(r.department || '—')}</td>
          <td data-label="IN at">${esc(fmtTime(r.last_in_at))}</td>
          <td class="mono" data-label="Time on site">${esc(fmtDuration(Number(r.seconds_on_site)))}</td>
          <td data-label="Scanner">${esc(r.last_scanner_id || '—')}</td>
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
