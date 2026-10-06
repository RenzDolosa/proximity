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
// How often to throw away the accumulated roster and ask for the whole thing
// again, regardless of what the delta cursor says.
//
// Not a correctness requirement — it is the self-heal. A cursor can only
// observe rows whose `updated_at` moved, so it cannot see a hard-DELETEd
// employee, and it cannot recover on its own if a laptop slept through a
// stretch of changes and resumed with a stale cursor. Rather than reason
// about every such case, pay one full roster every 10 minutes and let all of
// them fix themselves within that window.
//
// This REPLACES the old 5-minute unconditional refetch, which existed because
// `is_stale` arrived from the server and flips with the clock alone. The client
// derives both `is_stale` and `seconds_on_site` from `last_in_at` now
// (Utils/dashboard.js's deriveRoster), so the passage of time is no longer a
// reason to talk to the server at all.
const ROSTER_FULL_RESYNC_MS = 10 * 60 * 1000;

let stats = null;
let roster = [];          // raw rows as the server sent them — NO derived fields
let rosterCursor = null;  // `cursor` from the last delta; null forces a full sync
let rosterStaleHours = 16;
let rosterSyncedAt = 0;
let loaded = false;
// Set once if get_dashboard_pulse() isn't on the project yet (client
// deployed ahead of the migration), so every later refresh goes straight to
// the legacy pair instead of paying a failed round trip first.
let pulseUnavailable = false;
const MISSING_PULSE = { code: 'PGRST202', message: 'Could not find the function public.get_dashboard_pulse' };
// Same one-shot latch for get_onsite_roster_delta. Falling back costs the full
// roster on every poll — i.e. the behaviour this change exists to remove — so
// if the Dashboard feels expensive again, check whether
// 20261006120000_onsite_roster_delta.sql actually got applied.
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
  visibilityHandler = () => {
    if (!document.hidden && appState.route === 'dashboard' && $('#dash-table')) load();
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

  // The roster is the expensive half of this refresh, and `roster_version`
  // from the pulse cannot make it cheap: every matched scan bumps
  // employees.updated_at via the scan_logs trigger, so during a shift the
  // version changes on essentially every poll and the old code re-downloaded
  // all ~500 rows every 30 seconds per open tab. See
  // get_onsite_roster_delta's header — that one fact was most of this
  // project's egress bill.
  //
  // So the version is no longer consulted at all. A delta asks for what moved,
  // which on a busy poll is a handful of rows and on a quiet one is none.
  // `force` (the Refresh button) and the periodic self-heal both drop the
  // cursor, which is what asks for the whole roster again.
  const wantsFull = force || !loaded || !rosterCursor
    || Date.now() - rosterSyncedAt > ROSTER_FULL_RESYNC_MS;
  const d = rosterDeltaUnavailable
    ? { error: MISSING_ROSTER_DELTA }
    : await DashboardModel.rosterDelta(wantsFull ? null : rosterCursor);

  // Same forward-compatibility shape as the pulse above: a client deployed
  // ahead of the migration falls back permanently to the full-roster RPC
  // rather than failing every refresh.
  if (d.error && isMissingFunctionError(d.error)) {
    rosterDeltaUnavailable = true;
    const r = await DashboardModel.onSiteRoster();
    if (seq !== requestSeq) return;
    finish(seq, r.error, p.data?.stats, r.data);
    return;
  }
  if (seq !== requestSeq) return;
  if (d.error) { finish(seq, d.error, p.data?.stats); return; }

  // Merge BEFORE the sequence guard's effects land, but only commit to the
  // cursor inside finish() — a response that lost a race must not advance the
  // cursor, or the rows it carried would never be requested again.
  finish(seq, null, p.data?.stats, mergeRosterDelta(roster, d.data), d.data);
}

// Shared tail of every path through load() above: re-enable the button, show
// or clear the error, and repaint.
//
// `delta` is the raw response, present only on the incremental path. Its
// `cursor` is committed here rather than at the call site for the same reason
// the repaint is: a superseded response must change no state at all. The
// legacy fallbacks pass no delta, which leaves `rosterCursor` null and so keeps
// asking for full rosters — correct, because that is all those RPCs can give.
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
    ${sum.byDepartment.length ? `<div class="emp-meta" style="margin-top:10px;">On site by department: ${sum.byDepartment.map((d) => `<button type="button" class="dept-chip" data-dept="${esc(d.department)}"><strong>${esc(d.department)}</strong> ${d.count}</button>`).join(' · ')}</div>` : ''}
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

// `roster` holds rows exactly as the server sent them. `seconds_on_site` and
// `is_stale` are attached HERE, at paint time, because both change with nothing
// but the clock — deriving them once on arrival would freeze "Time on site" at
// whatever it was when the row came in, and would never flip `is_stale`.
// Deriving on every paint is also what let the 5-minute unconditional refetch go
// away: the passage of time is no longer a reason to call the server.
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
