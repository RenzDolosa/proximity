// Evacuation muster list: who is inside each site, to be read at the
// assembly point.
//
// Renders from the snapshot the Dashboard already saved, NOT from a fetch.
// It tries a refresh when there is a network, but it paints first and never
// waits — the scenario this exists for is one where the network is gone.
//
// Ticking someone off is local only. A drill is not a record to sync, and a
// write that needs a server would fail in the same outage the page is built
// to survive.
import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { appState } from '../../Core/state.js';
import { DashboardModel } from '../../Models/DashboardModel.js';
import { deriveRoster } from '../../Utils/dashboard.js';
import { readSnapshot, saveSnapshot } from '../../Utils/musterCache.js';
import {
  groupForMuster, musterTotals, certainty, CERTAINTY, snapshotAge,
} from '../../Utils/muster.js';

let accounted = new Set();

export async function renderMuster() {
  const content = $('#content');
  const snap = readSnapshot();

  content.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-start">
        <input class="search" id="mu-search" type="search" placeholder="Search name, code, department…" />
      </div>
      <div class="toolbar-actions">
        <button class="ghost" id="mu-reset">Reset ticks</button>
        <button class="ghost" id="mu-print">Print</button>
        <button class="primary" id="mu-refresh">Refresh</button>
      </div>
    </div>
    <div id="mu-status" class="emp-meta" style="margin-bottom:10px;"></div>
    <div id="mu-body">${snap ? '' : '<div class="empty-state">No roster saved on this device yet. Open the Dashboard once while online, and it will be available here even without a network.</div>'}</div>
  `;

  $('#mu-search').addEventListener('input', paint);
  $('#mu-reset').addEventListener('click', () => { accounted = new Set(); paint(); });
  $('#mu-print').addEventListener('click', () => window.print());
  $('#mu-refresh').addEventListener('click', refresh);

  if (snap) paint();
  // Opportunistic, never blocking: the list is already on screen by now.
  refresh({ quiet: true });
}

async function refresh({ quiet = false } = {}) {
  const btn = $('#mu-refresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
  const { data, error } = await DashboardModel.rosterDelta(null);
  if (btn) { btn.disabled = false; btn.textContent = 'Refresh'; }
  if (appState.route !== 'muster') return; // navigated away mid-request

  if (error || !Array.isArray(data?.rows)) {
    // Offline is the expected case here, not an exceptional one. The cached
    // list stays on screen and the status line says how old it is.
    if (!quiet) setStatus(readSnapshot(), { failed: true });
    else paint();
    return;
  }
  saveSnapshot(data.rows);
  paint();
}

function setStatus(snap, { failed = false } = {}) {
  const el = $('#mu-status');
  if (!el) return;
  if (!snap) { el.textContent = ''; return; }
  const age = snapshotAge(snap.savedAt);
  const totals = musterTotals(groupForMuster(deriveRoster(snap.rows)));
  el.innerHTML = `
    <span class="${age.stale ? 'badge unassigned_card' : ''}">As of ${esc(age.text)}</span>
    · ${totals.people} to account for across ${totals.sites} site${totals.sites === 1 ? '' : 's'}
    ${totals.unsure ? `· <span class="badge inactive_card">${totals.unsure} uncertain</span>` : ''}
    ${failed ? '· <span class="badge inactive_card">no network — showing the saved list</span>' : ''}
  `;
}

function paint() {
  const snap = readSnapshot();
  const body = $('#mu-body');
  if (!body) return;
  setStatus(snap);
  if (!snap) return;

  const q = ($('#mu-search')?.value || '').trim().toLowerCase();
  const rows = deriveRoster(snap.rows).filter((r) => !q
    || String(r.full_name ?? '').toLowerCase().includes(q)
    || String(r.employee_code ?? '').toLowerCase().includes(q)
    || String(r.department ?? '').toLowerCase().includes(q));

  const groups = groupForMuster(rows);
  if (!groups.length) {
    body.innerHTML = `<div class="empty-state">${q ? 'Nobody matches that search.' : 'Nobody is recorded as being on site.'}</div>`;
    return;
  }

  body.innerHTML = groups.map(siteHTML).join('');
  $$('input[data-person]', body).forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) accounted.add(cb.dataset.person); else accounted.delete(cb.dataset.person);
    paintCounts();
  }));
  paintCounts();
}

function siteHTML(group) {
  return `
    <section class="panel muster-site" style="padding:16px;margin-bottom:12px;">
      <div class="panel-head" style="margin-bottom:10px;">
        <div>
          <h3 style="margin:0 0 2px;">${esc(group.site)}</h3>
          <div class="emp-meta" data-site-count="${esc(group.site)}"></div>
        </div>
      </div>
      ${group.departments.map(deptHTML).join('')}
    </section>`;
}

function deptHTML(dept) {
  return `
    <div class="muster-dept">
      <div class="dept-breakdown-title">${esc(dept.department)} · ${dept.count}</div>
      <ul class="muster-list">
        ${dept.people.map(personHTML).join('')}
      </ul>
    </div>`;
}

function personHTML(p) {
  const state = certainty(p);
  return `
    <li class="muster-person">
      <label>
        <input type="checkbox" data-person="${esc(p.id)}" ${accounted.has(p.id) ? 'checked' : ''} />
        <span class="muster-name">${esc(p.full_name)}</span>
        <span class="emp-meta mono">${esc(p.employee_code || '')}</span>
        ${state === 'unsure'
          ? `<span class="badge inactive_card" title="${esc(CERTAINTY.unsure)}">check</span>`
          : ''}
        <span class="emp-meta muster-in">in ${esc(fmtTime(p.last_in_at))}</span>
      </label>
    </li>`;
}

// Counts update on tick without repainting the whole list — losing scroll
// position halfway through a headcount would be its own small disaster.
function paintCounts() {
  $$('[data-site-count]').forEach((el) => {
    const site = el.dataset.siteCount;
    const boxes = $$(`.muster-site input[data-person]`)
      .filter((b) => b.closest('.muster-site').querySelector('h3').textContent === site);
    const done = boxes.filter((b) => b.checked).length;
    el.textContent = `${done} of ${boxes.length} accounted for`;
    el.classList.toggle('muster-done', boxes.length > 0 && done === boxes.length);
  });
}
