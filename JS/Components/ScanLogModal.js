import { $ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { openModal, closeModal } from './Modal.js';
import { EmployeesModel } from '../Models/EmployeesModel.js';

export async function openScanLogModal(employeeId) {
  const overlay = openModal(`
    <h3 id="log-title">Scan log</h3>
    <div id="log-body" class="empty-state">Loading…</div>
    <div class="actions">
      <button class="ghost" id="log-close">Close</button>
    </div>
  `, { maxWidth: '520px' });

  $('#log-close', overlay).addEventListener('click', () => closeModal(overlay));

  const { data: emp, error } = await EmployeesModel.getScanLogs(employeeId);
  const bodyEl = $('#log-body', overlay);
  if (error) { bodyEl.textContent = error.message; return; }
  $('#log-title', overlay).textContent = `Scan log — ${emp.full_name}`;
  const logs = (emp.scan_logs || []).slice().sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
  if (!logs.length) {
    bodyEl.innerHTML = `<div class="empty-state"><strong>No scans yet</strong>This employee hasn't tapped their card at any scanner.</div>`;
    return;
  }
  bodyEl.className = '';
  bodyEl.innerHTML = `
    <div style="max-height:360px;overflow-y:auto;">
      ${logs.map((l) => `
        <div class="feed-row">
          <span class="badge ${l.direction === 'out' ? 'suspended' : 'active'}">${(l.direction || '—').toUpperCase()}</span>
          <div>
            <div style="font-weight:500;">${esc(l.scanner_id || '—')}</div>
            <div class="emp-meta mono">${esc(l.proximity_code || '')}</div>
          </div>
          <div class="feed-time">${fmtTime(l.scanned_at)}</div>
        </div>
      `).join('')}
    </div>
  `;
}
