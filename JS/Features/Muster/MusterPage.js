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
// Site names the reader has folded away. Collapse hides with CSS rather than
// dropping the rows, so a tick survives a fold and the counts below keep
// working off a list that is always complete.
let collapsed = new Set();
// The "N uncertain" badge doubles as a filter: everyone whose last scan is
// old, and nobody else. That is the sub-list a marshal chases once the
// obvious names have walked up.
let onlyUnsure = false;
// The unfiltered grouping, kept so counts can be recomputed on a tick without
// repainting — losing scroll position halfway through a headcount would be
// its own small disaster — and so a filter can never shrink a denominator.
let allGroups = [];

// Assembly-point mode: pure black, large type, taller rows. This list is read
// outdoors on a phone in daylight by someone counting under pressure, and the
// normal 13px muted grey is tuned for an office monitor.
//
// Persisted per device rather than per account, because it is a property of
// WHERE the device is — the tablet that lives by the fire door wants it on
// permanently; the same person's desk browser does not.
const BRIGHT_KEY = 'proximity.muster.assemblyMode';
let brightMode = readBrightMode();

function readBrightMode() {
  try { return localStorage.getItem(BRIGHT_KEY) === '1'; } catch { return false; }
}
function writeBrightMode(on) {
  try { localStorage.setItem(BRIGHT_KEY, on ? '1' : '0'); } catch { /* private mode — honour it for this session only */ }
}

export async function renderMuster() {
  const content = $('#content');
  const snap = readSnapshot();

  content.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-start">
        <input class="search" id="mu-search" type="search" placeholder="Search name, code, department…" />
      </div>
      <div class="toolbar-actions">
        <button class="ghost${brightMode ? ' active' : ''}" id="mu-bright" aria-pressed="${brightMode}"
                title="Pure black, larger names, taller rows — for reading outdoors in daylight">Assembly mode</button>
        <button class="ghost" id="mu-expand">Collapse all</button>
        <button class="ghost" id="mu-reset">Reset ticks</button>
        <button class="ghost" id="mu-print">Print</button>
        <button class="primary" id="mu-refresh">Refresh</button>
      </div>
    </div>
    <div id="mu-status" class="emp-meta" style="margin-bottom:10px;"></div>
    <div id="mu-body"${brightMode ? ' class="mu-assembly"' : ''}>${snap ? '' : '<div class="empty-state">No roster saved on this device yet. Open the Dashboard once while online, and it will be available here even without a network.</div>'}</div>
  `;

  $('#mu-search').addEventListener('input', paint);
  $('#mu-reset').addEventListener('click', () => { accounted = new Set(); paint(); });
  $('#mu-print').addEventListener('click', () => window.print());
  $('#mu-refresh').addEventListener('click', refresh);
  $('#mu-expand').addEventListener('click', toggleAll);
  // Class toggle only — no repaint. A marshal who hits this mid-headcount
  // must not lose their scroll position or watch the list rebuild.
  $('#mu-bright').addEventListener('click', (ev) => {
    brightMode = !brightMode;
    writeBrightMode(brightMode);
    $('#mu-body').classList.toggle('mu-assembly', brightMode);
    ev.currentTarget.classList.toggle('active', brightMode);
    ev.currentTarget.setAttribute('aria-pressed', String(brightMode));
  });

  // Delegated, bound once. #mu-status and #mu-body have their innerHTML
  // replaced on every paint, but the elements themselves survive — so these
  // outlive the repaints that a per-node listener would not.
  $('#mu-status').addEventListener('click', (e) => {
    if (!e.target.closest('#mu-unsure')) return;
    onlyUnsure = !onlyUnsure;
    paint();
  });
  $('#mu-body').addEventListener('click', (e) => {
    const head = e.target.closest('[data-site-toggle]');
    if (!head) return;
    const site = head.dataset.siteToggle;
    if (collapsed.has(site)) collapsed.delete(site); else collapsed.add(site);
    paint();
  });
  $('#mu-body').addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-person]');
    if (!cb) return;
    if (cb.checked) accounted.add(cb.dataset.person); else accounted.delete(cb.dataset.person);
    paintCounts();
  });

  if (snap) paint();
  // Opportunistic, never blocking: the list is already on screen by now.
  refresh({ quiet: true });
}

function toggleAll() {
  const allFolded = allGroups.length > 0 && allGroups.every((g) => collapsed.has(g.site));
  collapsed = allFolded ? new Set() : new Set(allGroups.map((g) => g.site));
  paint();
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
  // The badge is a button, not decoration: pressing it narrows the grid to
  // the people it counts. aria-pressed rather than a separate control, so the
  // thing that reports the number is the thing that filters by it.
  el.innerHTML = `
    <span class="${age.stale ? 'badge unassigned_card' : ''}">As of ${esc(age.text)}</span>
    · ${totals.people} to account for across ${totals.sites} site${totals.sites === 1 ? '' : 's'}
    ${totals.unsure ? `· <button type="button" id="mu-unsure" class="badge inactive_card mu-filter${onlyUnsure ? ' is-on' : ''}" aria-pressed="${onlyUnsure}" title="${esc(CERTAINTY.unsure)} — show only these">${totals.unsure} uncertain</button>` : ''}
    ${onlyUnsure ? '· <span class="mu-filter-note">showing only uncertain — click the badge to clear</span>' : ''}
    ${failed ? '· <span class="badge inactive_card">no network — showing the saved list</span>' : ''}
  `;
}

function paint() {
  const snap = readSnapshot();
  const body = $('#mu-body');
  if (!body) return;
  setStatus(snap);
  if (!snap) return;

  const all = deriveRoster(snap.rows);
  // Grouped BEFORE any filter. Everything a site's "n of m" line reports is
  // measured against this, so narrowing the view can never make a site look
  // more complete than it is — the one lie this page must not tell.
  allGroups = groupForMuster(all);

  const q = ($('#mu-search')?.value || '').trim().toLowerCase();
  const rows = all.filter((r) => (!onlyUnsure || certainty(r) === 'unsure'))
    .filter((r) => !q
      || String(r.full_name ?? '').toLowerCase().includes(q)
      || String(r.employee_code ?? '').toLowerCase().includes(q)
      || String(r.department ?? '').toLowerCase().includes(q));

  const groups = groupForMuster(rows);
  if (!groups.length) {
    body.innerHTML = `<div class="empty-state">${
      onlyUnsure ? 'No scan is old enough to be uncertain. Click the badge again to show everyone.'
        : q ? 'Nobody matches that search.'
          : 'Nobody is recorded as being on site.'}</div>`;
    paintExpandLabel();
    return;
  }

  // The grid is positional: cell order is scanner order (see scannerOrder in
  // Utils/muster.js), three across, so Scanner 4 lands under Scanner 1.
  // A site that filters down to nobody is dropped rather than left as an
  // empty cell, which does shift the others — accepted, because a column of
  // blank panels is worse to read under pressure than a shifted one.
  body.innerHTML = `<div class="muster-grid">${groups.map(siteHTML).join('')}</div>`;
  paintCounts();
  paintExpandLabel();
}

function paintExpandLabel() {
  const btn = $('#mu-expand');
  if (!btn) return;
  const allFolded = allGroups.length > 0 && allGroups.every((g) => collapsed.has(g.site));
  btn.textContent = allFolded ? 'Expand all' : 'Collapse all';
}

function siteHTML(group) {
  const isFolded = collapsed.has(group.site);
  return `
    <section class="panel muster-site${isFolded ? ' is-folded' : ''}" style="padding:16px;">
      <button type="button" class="muster-site-head" data-site-toggle="${esc(group.site)}"
              aria-expanded="${!isFolded}">
        <span class="muster-site-caret" aria-hidden="true">${isFolded ? '▸' : '▾'}</span>
        <span>
          <h3 style="margin:0 0 2px;">${esc(group.site)}</h3>
          <span class="emp-meta" data-site-count="${esc(group.site)}"></span>
        </span>
      </button>
      <div class="muster-site-body">
        ${group.departments.map(deptHTML).join('')}
      </div>
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
//
// Computed from allGroups and the accounted Set rather than by counting
// checkboxes in the DOM, which is what it used to do. Two reasons: a folded
// or filtered site has no boxes on screen and would have read "0 of 0", and
// the old version matched a panel to its site by comparing h3 text, so any
// change to this heading's markup silently broke every count.
function paintCounts() {
  const bySite = new Map(allGroups.map((g) => [g.site, g]));
  $$('[data-site-count]').forEach((el) => {
    const group = bySite.get(el.dataset.siteCount);
    if (!group) return;
    const total = group.count;
    const done = group.departments
      .reduce((n, d) => n + d.people.filter((p) => accounted.has(p.id)).length, 0);
    // The denominator is the whole site even when a filter is on, so nobody
    // reads "4 of 4" off a narrowed list and calls the building clear. The
    // count of what is actually on screen is spelled out next to it.
    const shown = visibleCount(group);
    el.textContent = `${done} of ${total} accounted for`
      + (shown < total ? ` · ${shown} shown` : '');
    el.classList.toggle('muster-done', total > 0 && done === total);
  });
}

function visibleCount(group) {
  const q = ($('#mu-search')?.value || '').trim().toLowerCase();
  if (!q && !onlyUnsure) return group.count;
  return group.departments.reduce((n, d) => n + d.people.filter((p) => {
    if (onlyUnsure && certainty(p) !== 'unsure') return false;
    if (!q) return true;
    return String(p.full_name ?? '').toLowerCase().includes(q)
      || String(p.employee_code ?? '').toLowerCase().includes(q)
      || String(p.department ?? '').toLowerCase().includes(q);
  }).length, 0);
}
