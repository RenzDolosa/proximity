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
import { toast } from '../../Utils/toast.js';
import { exportXlsx, todayStamp } from '../../Utils/xlsxExport.js';
import { appState } from '../../Core/state.js';
import { DashboardModel } from '../../Models/DashboardModel.js';
import { deriveRoster } from '../../Utils/dashboard.js';
import {
  readSnapshot, saveSnapshot,
  readAccounted, saveAccounted, clearAccounted,
  readUnlisted, saveUnlisted, clearUnlisted,
} from '../../Utils/musterCache.js';
import {
  groupForMuster, musterTotals, certainty, CERTAINTY, snapshotAge,
  pruneAccounted, addUnlisted, removeUnlisted, rollCallRows,
} from '../../Utils/muster.js';

// RESTORED FROM THE DEVICE, not started empty. This used to be a bare
// `new Set()`, so a refresh, a crash or the service worker activating
// mid-evacuation lost every tick — while assembly mode, persisted three
// lines below, survived all three. See Utils/musterCache.js for the expiry
// and pruning rules that keep a stored roll call honest.
let accounted = readAccounted();
// People a marshal typed in because they were present and not on the sheet:
// anyone who tapped in after the snapshot, and anyone who never had a card
// at all — contractors, visitors, a delivery driver.
let unlisted = readUnlisted();
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
        <button class="ghost" id="mu-export">Export</button>
        <button class="ghost" id="mu-print">Print</button>
        <button class="primary" id="mu-refresh">Refresh</button>
      </div>
    </div>
    <div id="mu-status" class="emp-meta" style="margin-bottom:10px;"></div>
    <div id="mu-body"${brightMode ? ' class="mu-assembly"' : ''}>${snap ? '' : '<div class="empty-state">No roster saved on this device yet. Open the Dashboard once while online, and it will be available here even without a network.</div>'}</div>
  `;

  $('#mu-search').addEventListener('input', paint);
  // Reset is the one deliberate clear, so it clears everything a headcount
  // accumulated — ticks AND typed-in people. Leaving the latter behind would
  // make "Reset ticks" quietly a half-reset.
  $('#mu-reset').addEventListener('click', () => {
    accounted = new Set();
    unlisted = [];
    clearAccounted();
    clearUnlisted();
    paint();
  });
  $('#mu-print').addEventListener('click', () => window.print());
  $('#mu-export').addEventListener('click', exportRollCall);
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
    // Written on every tick rather than on a timer or on unload: the events
    // this page exists for are exactly the ones that give no warning before
    // the tab goes away.
    saveAccounted(accounted);
    paintCounts();
  });

  // Adding someone who is present and not on the sheet. Delegated on #mu-body
  // like the rest, so it survives every repaint.
  $('#mu-body').addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-unlisted]');
    if (add) {
      unlisted = addUnlisted(unlisted, add.dataset.addUnlisted);
      const added = unlisted[unlisted.length - 1];
      // Ticked on arrival: nobody types a name at an assembly point except
      // to say that person is standing in front of them.
      if (added) accounted.add(added.id);
      saveUnlisted(unlisted);
      saveAccounted(accounted);
      const search = $('#mu-search');
      if (search) search.value = '';
      paint();
      search?.focus();
      return;
    }
    const drop = e.target.closest('[data-drop-unlisted]');
    if (!drop) return;
    const id = drop.dataset.dropUnlisted;
    unlisted = removeUnlisted(unlisted, id);
    accounted.delete(id);
    saveUnlisted(unlisted);
    saveAccounted(accounted);
    paint();
  });

  if (snap) paint();
  // Opportunistic, never blocking: the list is already on screen by now.
  refresh({ quiet: true });
}

// The record, as opposed to the list. Built from allGroups — the UNFILTERED
// grouping — so a search left in the box cannot quietly export a subset and
// have it read as the whole headcount.
function exportRollCall() {
  const rows = rollCallRows(allGroups, accounted, unlisted);
  if (!rows.length) { toast('Nothing to export yet — no roster on this device.', 'error'); return; }
  const snap = readSnapshot();
  // The roster time goes in the FILENAME, not a column: it is one fact about
  // the whole sheet, and a column repeating it on every row is the kind of
  // thing that later gets mistaken for a per-person timestamp.
  const asOf = snap?.savedAt ? new Date(snap.savedAt) : new Date();
  const stamp = `${asOf.toLocaleDateString('en-CA')}-${String(asOf.getHours()).padStart(2, '0')}${String(asOf.getMinutes()).padStart(2, '0')}`;
  exportXlsx({
    filename: `muster-roster-${stamp}-exported-${todayStamp()}.xlsx`,
    sheetName: 'Roll call',
    columns: [
      { key: 'accounted', label: 'Accounted for' },
      { key: 'full_name', label: 'Name' },
      // text: true — an employee code can be all digits, and Excel will
      // happily turn 0004182 into 4182 on the round trip. Same reason
      // Employee Manager and the card export mark theirs.
      { key: 'employee_code', label: 'Employee code', text: true },
      { key: 'site', label: 'Site' },
      { key: 'department', label: 'Department' },
      { key: 'last_in_at', label: 'Last IN' },
      { key: 'source', label: 'Source' },
    ],
    rows: rows.map((r) => ({ ...r, last_in_at: r.last_in_at ? fmtTime(r.last_in_at) : '' })),
  });
  const missing = rows.filter((r) => r.accounted !== 'yes').length;
  toast(missing
    ? `Exported ${rows.length} — ${missing} not accounted for.`
    : `Exported ${rows.length} — everyone accounted for.`);
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
    ${unlisted.length ? `· <span class="badge inactive_card">${unlisted.length} added here</span>` : ''}
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

  // Refresh replaces the snapshot mid-headcount. A tick for someone who has
  // since tapped out would keep counting toward a site total that no longer
  // includes them — "41 of 40", or a site reading complete when it is not.
  const pruned = pruneAccounted(accounted, [...all, ...unlisted]);
  if (pruned.size !== accounted.size) { accounted = pruned; saveAccounted(accounted); }

  const q = ($('#mu-search')?.value || '').trim().toLowerCase();
  const rows = all.filter((r) => (!onlyUnsure || certainty(r) === 'unsure'))
    .filter((r) => !q
      || String(r.full_name ?? '').toLowerCase().includes(q)
      || String(r.employee_code ?? '').toLowerCase().includes(q)
      || String(r.department ?? '').toLowerCase().includes(q));

  const groups = groupForMuster(rows);
  // Both halves render whether or not the snapshot has anyone matching: the
  // add affordance is most needed exactly when the search finds nobody, and
  // the typed-in panel must not vanish behind a filter that was never about
  // it.
  const extras = addRowHTML(q) + unlistedHTML();

  if (!groups.length) {
    body.innerHTML = extras + `<div class="empty-state">${
      onlyUnsure ? 'No scan is old enough to be uncertain. Click the badge again to show everyone.'
        : q ? 'Nobody on the sheet matches that search.'
          : 'Nobody is recorded as being on site.'}</div>`;
    paintExpandLabel();
    return;
  }

  // The grid is positional: cell order is scanner order (see scannerOrder in
  // Utils/muster.js), three across, so Scanner 4 lands under Scanner 1.
  // A site that filters down to nobody is dropped rather than left as an
  // empty cell, which does shift the others — accepted, because a column of
  // blank panels is worse to read under pressure than a shifted one.
  body.innerHTML = extras + `<div class="muster-grid">${groups.map(siteHTML).join('')}</div>`;
  paintCounts();
  paintExpandLabel();
}

// Offered whenever something is typed, not only when the search comes back
// empty: a marshal looking at "Maria Santos" on screen may still be standing
// in front of a different Maria who is not on the sheet at all.
function addRowHTML(q) {
  if (!q) return '';
  return `
    <button type="button" class="muster-add" data-add-unlisted="${esc(q)}">
      <span class="badge inactive_card">not listed</span>
      Add <strong>${esc(q)}</strong> as present
    </button>`;
}

// A panel of its own, never folded into a site. Site totals are measured
// against the snapshot, and quietly adding people to a denominator the
// snapshot never contained is how "all accounted for" stops meaning
// anything.
function unlistedHTML() {
  if (!unlisted.length) return '';
  const done = unlisted.filter((e) => accounted.has(e.id)).length;
  return `
    <section class="panel muster-site muster-unlisted" style="padding:16px;">
      <div class="muster-site-head" style="cursor:default;">
        <span>
          <h3 style="margin:0 0 2px;">Added at the assembly point</h3>
          <span class="emp-meta" data-unlisted-count>${done} of ${unlisted.length} accounted for · not on the saved sheet</span>
        </span>
      </div>
      <ul class="muster-list">
        ${unlisted.map((e) => `
          <li class="muster-person">
            <label>
              <input type="checkbox" data-person="${esc(e.id)}" ${accounted.has(e.id) ? 'checked' : ''} />
              <span class="muster-name">${esc(e.label)}</span>
              <span class="badge inactive_card">added</span>
            </label>
            <button type="button" class="ghost muster-drop" data-drop-unlisted="${esc(e.id)}"
                    title="Remove — added by mistake">×</button>
          </li>`).join('')}
      </ul>
    </section>`;
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
  // The typed-in panel keeps its own count current on a tick too — it is
  // rendered by paint() and would otherwise sit stale until the next full
  // repaint, which a tick deliberately avoids.
  const extraEl = $('[data-unlisted-count]');
  if (extraEl && unlisted.length) {
    const done = unlisted.filter((e) => accounted.has(e.id)).length;
    extraEl.textContent = `${done} of ${unlisted.length} accounted for · not on the saved sheet`;
  }

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
