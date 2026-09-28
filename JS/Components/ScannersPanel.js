// Settings → Scanners. Lists every scanner_id the system has ever seen
// (rows are created automatically on a scanner's first scan) with its
// 24h volume and online state. Admins can rename a scanner (label) or
// disable it; everyone else with Scanner scope gets a read-only view.
// update_scanner() is admin-only and audit-logged server-side — the
// canEditScannerRegistry() check here just decides whether to draw the
// controls.
import { $ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { canEditScannerRegistry } from '../Core/state.js';
import { ScannersModel } from '../Models/ScannersModel.js';
import { scannerState, SCANNER_STATE_LABEL, scannerStateBadgeClass } from '../Utils/dashboard.js';

let rows = [];
let loaded = false;

export function scannersPanelHTML() {
  return `
    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;">
        <h3 style="margin:0 0 4px;">Scanners</h3>
        <button type="button" class="ghost" id="sc-refresh">Refresh</button>
      </div>
      <p class="sub" style="margin:0 0 10px;">
        Every scanner that has scanned at least once. A scanner counts as online if it was seen in the last
        10 minutes. ${canEditScannerRegistry()
          ? 'Give a scanner a friendly label, or disable one that should no longer be used — changes are recorded in the Audit Log.'
          : 'Your account can view scanners, not change them.'}
      </p>
      <div class="auth-error hidden" id="sc-error"></div>
      <div id="sc-body">${loaded ? '' : 'Loading…'}</div>
    </div>`;
}

export async function mountScannersPanel() {
  $('#sc-refresh')?.addEventListener('click', load);
  if (loaded) paint();
  await load();
}

async function load() {
  const { data, error } = await ScannersModel.list();
  const err = $('#sc-error');
  if (error) { if (err) { err.textContent = error.message; err.classList.remove('hidden'); } return; }
  err?.classList.add('hidden');
  rows = data || [];
  loaded = true;
  paint();
}

function paint() {
  const body = $('#sc-body');
  if (!body) return;
  if (!rows.length) { body.innerHTML = `<div class="empty-state">No scanners have scanned yet.</div>`; return; }
  const edit = canEditScannerRegistry();
  body.innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Scanner</th><th>Status</th><th>Last seen</th><th>24h scans</th><th>Matched</th><th>Offline</th>${edit ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.map((s) => {
      const st = scannerState(s);
      return `<tr>
        <td>${esc(s.label || s.scanner_id)}${s.label ? `<div class="emp-meta mono">${esc(s.scanner_id)}</div>` : ''}</td>
        <td><span class="badge ${scannerStateBadgeClass(st)}">${esc(SCANNER_STATE_LABEL[st])}</span></td>
        <td>${s.last_seen_at ? esc(fmtTime(s.last_seen_at)) : '—'}</td>
        <td class="mono">${esc(s.scans_24h)}</td>
        <td class="mono">${esc(s.matched_24h)}</td>
        <td class="mono">${esc(s.offline_24h)}</td>
        ${edit ? `<td style="white-space:nowrap;">
          <button class="ghost" data-rename="${esc(s.scanner_id)}">Label</button>
          <button class="ghost ${s.is_enabled ? 'danger' : ''}" data-toggle="${esc(s.scanner_id)}">${s.is_enabled ? 'Disable' : 'Enable'}</button>
        </td>` : ''}
      </tr>`;
    }).join('')}</tbody></table></div>`;

  body.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.rename;
    const current = rows.find((r) => r.scanner_id === id)?.label || '';
    const next = window.prompt(`Label for ${id} (leave empty to clear):`, current);
    if (next === null) return;
    const { error } = await ScannersModel.update(id, { label: next.trim() });
    if (error) { toast(error.message, 'error'); return; }
    toast('Label saved.');
    load();
  }));
  body.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.toggle;
    const row = rows.find((r) => r.scanner_id === id);
    if (!row) return;
    b.disabled = true;
    const { error } = await ScannersModel.update(id, { enabled: !row.is_enabled });
    if (error) { toast(error.message, 'error'); b.disabled = false; return; }
    toast(row.is_enabled ? 'Scanner disabled.' : 'Scanner enabled.');
    load();
  }));
}
