// Alerts inbox — reads the alerts table through get_alerts() and lets an
// admin/manager acknowledge one or all. Alerts are raised server-side (by
// raise_alert(), e.g. 'unknown_card_scan'); nothing here creates them.
// Acknowledged alerts are kept, not deleted — the toggle just shows them.
import { $ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { isAdminOrManager } from '../../Core/state.js';
import { AlertsModel } from '../../Models/AlertsModel.js';
import { severityBadgeClass, alertKindLabel } from '../../Utils/dashboard.js';
import { refreshAlertsBadge } from '../../Core/alertsBadge.js';

let showAcked = false;
let requestSeq = 0;
let rowsCache = [];  // the last successfully loaded page, so a nav-away/back
                      // re-render can paint instantly instead of flashing
                      // "Loading…" over content that's still perfectly valid
let loaded = false;  // distinguishes "never fetched" from "fetched, zero rows"

export async function renderAlerts() {
  const content = $('#content');
  if (!isAdminOrManager()) { content.innerHTML = `<div class="empty-state">You don't have access to this page.</div>`; return; }

  content.innerHTML = `
    <div class="toolbar">
      <div class="filter-row">
        <label class="emp-meta" style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" id="al-show-acked" ${showAcked ? 'checked' : ''} /> Show acknowledged
        </label>
        <button class="ghost" id="al-refresh">Refresh</button>
        <button class="primary" id="al-ack-all" disabled>Acknowledge all</button>
      </div>
    </div>
    <div class="auth-error hidden" id="al-error" style="margin-bottom:12px;"></div>
    <div class="table-scroll"><div id="al-body">${loaded ? '' : 'Loading…'}</div></div>
  `;
  $('#al-show-acked').addEventListener('change', (e) => { showAcked = e.target.checked; load(); });
  $('#al-refresh').addEventListener('click', load);
  $('#al-ack-all').addEventListener('click', ackAll);
  // Same stale-while-revalidate pattern as Attendance/Dashboard: paint the
  // last loaded page immediately (so re-opening this tab from the sidebar
  // never shows a "Loading…" flash for data it already has), then refresh
  // in the background. Switching "Show acknowledged" still goes through
  // load() -> Loading is fine there since the previous rows may not match
  // the new toggle at all.
  if (loaded) paint(rowsCache);
  await load();
}

function showError(message) {
  const el = $('#al-error');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('hidden', !message);
}

// detail is free-form jsonb written by whichever server code raised the
// alert — shown as compact key: value text, never interpreted as HTML.
function detailText(detail) {
  if (!detail || typeof detail !== 'object') return '';
  return Object.entries(detail)
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
}

async function load() {
  const seq = ++requestSeq;
  const { data, error } = await AlertsModel.list({ includeAcknowledged: showAcked });
  if (seq !== requestSeq) return;
  if (error) { showError(error.message); if (!loaded) { const b = $('#al-body'); if (b) b.innerHTML = ''; } return; }
  showError('');
  rowsCache = data || [];
  loaded = true;
  paint(rowsCache);
}

function paint(rows) {
  const body = $('#al-body');
  if (!body) return;
  const unread = rows.filter((a) => !a.acknowledged_at).length;
  $('#al-ack-all').disabled = unread === 0;
  refreshAlertsBadge();

  if (!rows.length) { body.innerHTML = `<div class="empty-state">${showAcked ? 'No alerts.' : 'No unread alerts. 🎉'}</div>`; return; }
  body.innerHTML = `
    <table>
      <thead><tr><th>When</th><th>Severity</th><th>Type</th><th>Message</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((a) => `
        <tr style="${a.acknowledged_at ? 'opacity:.6;' : ''}">
          <td>${esc(fmtTime(a.created_at))}</td>
          <td><span class="badge ${severityBadgeClass(a.severity)}">${esc(a.severity)}</span></td>
          <td>${esc(alertKindLabel(a.kind))}</td>
          <td>${esc(a.message)}${detailText(a.detail) ? `<div class="emp-meta">${esc(detailText(a.detail))}</div>` : ''}</td>
          <td>${a.acknowledged_at ? `<span class="emp-meta">Acked ${esc(fmtTime(a.acknowledged_at))}${a.acknowledged_by_name ? ` by ${esc(a.acknowledged_by_name)}` : ''}</span>` : '<span class="badge unassigned_card">unread</span>'}</td>
          <td>${a.acknowledged_at ? '' : `<button class="ghost" data-ack="${esc(a.id)}">Acknowledge</button>`}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
  body.querySelectorAll('[data-ack]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    const { error: e } = await AlertsModel.acknowledge(b.dataset.ack);
    if (e) { toast(e.message, 'error'); b.disabled = false; return; }
    load();
  }));
}

async function ackAll() {
  const btn = $('#al-ack-all');
  btn.disabled = true;
  const { data, error } = await AlertsModel.acknowledgeAll();
  if (error) { toast(error.message, 'error'); btn.disabled = false; return; }
  toast(`Acknowledged ${data} alert${data === 1 ? '' : 's'}.`);
  load();
}
