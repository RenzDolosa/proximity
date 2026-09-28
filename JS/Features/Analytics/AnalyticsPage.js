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
      <div class="sub">Scan activity and scanner health over time. Read-only — nothing here can be edited.</div>
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
      <div class="stat-card accent"><div class="stat-value">${total}</div><div class="stat-label">Total scans</div></div>
      <div class="stat-card good"><div class="stat-value">${s.matched || 0}</div><div class="stat-label">Matched (${matchRate}%)</div></div>
      <div class="stat-card bad"><div class="stat-value">${s.unmatched || 0}</div><div class="stat-label">Unmatched</div></div>
      <div class="stat-card bad"><div class="stat-value">${s.inactive_card || 0}</div><div class="stat-label">Inactive card</div></div>
      <div class="stat-card bad"><div class="stat-value">${s.inactive_employee || 0}</div><div class="stat-label">Inactive employee</div></div>
      <div class="stat-card warn"><div class="stat-value">${s.unassigned_card || 0}</div><div class="stat-label">Unassigned card</div></div>
      <div class="stat-card"><div class="stat-value">${s.offline_captured || 0}</div><div class="stat-label">Captured offline</div></div>
    </div>

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
          <tr>
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
