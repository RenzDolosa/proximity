// Scanner Analytics — admin/scanner-scope dashboard over
// get_scanner_performance_stats(). That RPC was applied straight to the
// live database in an earlier session, fully secured, and then never
// wired to any page or documented (see this file's entry in
// Supabase/README.md's change log — same "backend shipped, UI never
// followed up" pattern as the Audit Log a few sessions before it). This
// page is that follow-up.
//
// Permission boundary matches the RPC exactly: canViewScanner() mirrors
// is_admin() OR can_view_scanner() in Postgres (see
// Core/accessControl.js and its server-side twin in Supabase/README.md),
// so this page's self-guard below can never show something the server
// would refuse to return anyway.
import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { canViewScanner } from '../../Core/state.js';
import { ScannerStatsModel } from '../../Models/ScannerStatsModel.js';
import { openScanDetailsModal } from '../../Components/ScanDetailsModal.js';
import { canDrillDown } from '../../Utils/scanDetails.js';

const RANGE_OPTIONS = [7, 14, 30, 90];

let selectedDays = 7;
let stats = null; // { summary, by_scanner, daily } once loaded, else null
let statsError = null;
let loaded = false; // distinguishes "never fetched yet" from "fetched, empty window"

export async function renderAnalytics() {
  const content = $('#content');
  if (!canViewScanner()) { content.innerHTML = `<div class="empty-state">You don't have access to this page.</div>`; return; }

  content.innerHTML = `
    <div class="toolbar">
      <div class="sub">Scan activity and scanner health over time. Read-only — nothing here can be edited. Click a number or a scanner to see the scans behind it.</div>
      <div class="sub-nav" id="analytics-range" role="group" aria-label="Date range">
        ${RANGE_OPTIONS.map((d) => `<button type="button" data-days="${d}" class="${d === selectedDays ? 'active' : ''}">${d}d</button>`).join('')}
      </div>
    </div>
    <div id="analytics-body">${loaded ? '' : 'Loading…'}</div>
  `;

  $$('button[data-days]', $('#analytics-range')).forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days, 10);
      if (days === selectedDays) return;
      selectedDays = days;
      $$('button[data-days]', $('#analytics-range')).forEach((b) => b.classList.toggle('active', b === btn));
      loadStats();
    });
  });

  // One delegated listener on the body node rather than per-card listeners:
  // paintBody() replaces every card on each fetch, so per-card wiring would
  // have to be redone every time (and would leak nothing, but be easy to miss).
  const bodyEl = $('#analytics-body');
  bodyEl.addEventListener('click', onDrillActivate);
  bodyEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') onDrillActivate(e);
  });

  // Stale-while-revalidate, same pattern as AuditLogPage.js/UsersPage.js:
  // paint whatever's already loaded immediately (no "Loading…" flash on
  // a range already seen this session) while the fresh fetch for the
  // current selection runs underneath.
  if (loaded) paintBody();
  await loadStats();
}

async function loadStats() {
  const { data, error } = await ScannerStatsModel.get(selectedDays);
  statsError = error ? error.message : null;
  stats = error ? null : data;
  loaded = true;
  paintBody();
}

// Opens the details modal for whichever [data-drill] card/row was activated.
// The window comes from the stats currently on screen (stats.summary.days),
// not selectedDays: after clicking a range button the highlighted range
// changes immediately but the numbers stay on the old range until the fetch
// resolves, and a drill-down must list the rows those numbers counted.
function onDrillActivate(e) {
  const el = e.target.closest?.('[data-drill]');
  if (!el || !stats) return;
  if (e.type === 'keydown') e.preventDefault(); // Space would otherwise scroll the page
  openScanDetailsModal({
    days: stats.summary?.days || selectedDays,
    filter: el.dataset.drill,
    scannerId: el.dataset.scanner || null,
  });
}

// A stat card that opens its underlying scans when clicked. A card showing 0
// has nothing behind it, so it renders as a plain (non-interactive) card.
function statCard(tone, value, label, filter) {
  const cls = `stat-card${tone ? ` ${tone}` : ''}`;
  const inner = `<div class="stat-value">${value}</div><div class="stat-label">${label}</div>`;
  if (!canDrillDown(value)) return `<div class="${cls}">${inner}</div>`;
  return `<div class="${cls} clickable" data-drill="${filter}" role="button" tabindex="0" title="Show these scans">${inner}</div>`;
}

function paintBody() {
  const body = $('#analytics-body');
  if (!body) return; // navigated away before the fetch resolved
  if (statsError) { body.innerHTML = `<div class="empty-state">${esc(statsError)}</div>`; return; }
  if (!stats) { body.innerHTML = 'Loading…'; return; }

  const s = stats.summary || {};
  const total = s.total_scans || 0;
  const matchRate = total ? Math.round((s.matched / total) * 1000) / 10 : 0;

  body.innerHTML = `
    <div class="stat-grid" style="margin-bottom:16px;">
      ${statCard('accent', total, 'Total scans', 'all')}
      ${statCard('good', s.matched || 0, `Matched (${matchRate}%)`, 'matched')}
      ${s.unmatched ? statCard('bad', s.unmatched, 'Unmatched', 'unmatched') : ''}
      ${statCard('bad', s.inactive_card || 0, 'Inactive card', 'inactive_card')}
      ${statCard('bad', s.inactive_employee || 0, 'Inactive employee', 'inactive_employee')}
      ${statCard('warn', s.unassigned_card || 0, 'Unassigned card', 'unassigned_card')}
      ${statCard('', s.offline_captured || 0, 'Captured offline', 'offline')}
    </div>

    ${s.unmatched ? '' : `<p class="sub" style="margin:-6px 0 16px;">Scans of unknown codes aren't stored by the scanner, so they can't be counted here — only recognised cards (including revoked ones) appear.</p>`}

    <div class="panel" style="padding:20px;margin-bottom:16px;">
      <h3 style="margin:0 0 4px;">Daily trend</h3>
      <p class="sub" style="margin:0 0 14px;">Total scans per day over the last ${s.days || selectedDays} days; the filled portion of each bar is the matched share. Hover a bar for exact counts.</p>
      ${renderTrendChart(stats.daily || [])}
    </div>

    <div class="panel" style="padding:20px;">
      <h3 style="margin:0 0 4px;">By scanner</h3>
      <p class="sub" style="margin:0 0 10px;">Every distinct <span class="mono">Scanner ID</span> that logged at least one scan in this window, busiest first.</p>
      <div class="table-scroll">${renderScannerTable(stats.by_scanner || [])}</div>
    </div>
  `;
}

// Deliberately plain divs sized with inline height, not a canvas or
// charting library — same zero-external-dependency stance as the rest of
// this app (see JS/Utils/idb.js's header comment). Each bar's total
// height is proportional to that day's total scans relative to the
// busiest day in the window; the accent-colored fill inside it is the
// matched share of that day's total, so a short-but-fully-accent bar and
// a tall-but-mostly-empty bar both read correctly at a glance.
function renderTrendChart(daily) {
  if (!daily.length) return `<div class="empty-state">No scans in this window.</div>`;
  const maxTotal = Math.max(1, ...daily.map((d) => d.total || 0));
  return `
    <div class="trend-chart">
      ${daily.map((d) => {
        const total = d.total || 0;
        const matched = d.matched || 0;
        const heightPx = Math.max(2, Math.round((total / maxTotal) * 90));
        const matchedPct = total ? Math.round((matched / total) * 100) : 0;
        const parsed = new Date(d.day);
        const label = Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
        return `
          <div class="trend-col" title="${esc(label)}: ${total} total, ${matched} matched">
            <div class="trend-bar" style="height:${heightPx}px">
              <div class="trend-bar-matched" style="height:${matchedPct}%"></div>
            </div>
            <div class="trend-day">${esc(label)}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderScannerTable(byScanner) {
  if (!byScanner.length) return `<div class="empty-state">No scanner activity in this window.</div>`;
  return `
    <table>
      <thead><tr><th>Scanner</th><th class="col-shrink">Total</th><th class="col-shrink">Matched</th><th class="col-shrink">Match rate</th><th class="col-shrink">Last scan</th></tr></thead>
      <tbody>
        ${byScanner.map((r) => `
          <tr class="clickable-row" data-drill="all" data-scanner="${esc(r.scanner_id || '')}" tabindex="0" title="Show this scanner's scans">
            <td class="mono">${esc(r.scanner_id || '—')}</td>
            <td class="col-shrink mono">${r.total}</td>
            <td class="col-shrink mono">${r.matched}</td>
            <td class="col-shrink mono">${r.match_rate_pct}%</td>
            <td class="col-shrink mono">${fmtTime(r.last_scan_at)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}
