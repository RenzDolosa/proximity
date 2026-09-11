import { $ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { openModal, closeModal, startModalOpen, isStaleModalOpen } from './Modal.js';
import { EmployeesModel } from '../Models/EmployeesModel.js';

// Local (not UTC) yyyy-mm-dd, so it lines up with what fmtTime() displays
// and with the value an <input type="date"> gives back.
const localDateKey = (iso) => new Date(iso).toLocaleDateString('en-CA');

export async function openScanLogModal(employeeId) {
  const token = startModalOpen();
  const overlay = openModal(`
    <h3 id="log-title">Scan log</h3>
    <div id="log-body" class="empty-state">Loading…</div>
    <div class="actions">
      <button class="ghost" id="log-close">Close</button>
    </div>
  `, { maxWidth: '520px' });

  $('#log-close', overlay).addEventListener('click', () => closeModal(overlay));

  const { data: emp, error } = await EmployeesModel.getScanLogs(employeeId);
  if (isStaleModalOpen(token)) return; // superseded by a newer click before this resolved
  const bodyEl = $('#log-body', overlay);
  if (error) { bodyEl.textContent = error.message; return; }
  $('#log-title', overlay).textContent = `Scan log — ${emp.full_name}`;
  const logs = (emp.scan_logs || []).slice().sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
  if (!logs.length) {
    bodyEl.innerHTML = `<div class="empty-state"><strong>No scans yet</strong>This employee hasn't tapped their card at any scanner.</div>`;
    return;
  }

  const scanners = [...new Set(logs.map((l) => l.scanner_id).filter(Boolean))].sort();
  bodyEl.className = '';
  bodyEl.innerHTML = `
    <div class="toolbar" style="margin-bottom:10px;gap:8px;">
      <input type="date" id="log-date-from" title="From" style="max-width:150px;" />
      <span class="emp-meta">to</span>
      <input type="date" id="log-date-to" title="To" style="max-width:150px;" />
      <select id="log-scanner" style="max-width:170px;">
        <option value="all">All scanners</option>
        ${scanners.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
      </select>
      <button class="ghost" id="log-clear" style="padding:7px 10px;">Clear</button>
    </div>
    <div id="log-list" style="max-height:340px;overflow-y:auto;"></div>
  `;

  const paintList = () => {
    const fromVal = $('#log-date-from', overlay).value;
    const toVal = $('#log-date-to', overlay).value;
    const scannerVal = $('#log-scanner', overlay).value;
    const filtered = logs.filter((l) => {
      const key = localDateKey(l.scanned_at);
      return (!fromVal || key >= fromVal) &&
        (!toVal || key <= toVal) &&
        (scannerVal === 'all' || l.scanner_id === scannerVal);
    });
    const listEl = $('#log-list', overlay);
    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty-state">No scans match this filter.</div>`;
      return;
    }
    listEl.innerHTML = filtered.map((l) => `
      <div class="feed-row">
        <span class="badge ${l.direction === 'out' ? 'suspended' : 'active'}">${(l.direction || '—').toUpperCase()}</span>
        <div>
          <div style="font-weight:500;">${esc(l.scanner_id || '—')}</div>
          <div class="emp-meta mono">${esc(l.proximity_code || '')}</div>
        </div>
        <div class="feed-time">${fmtTime(l.scanned_at)}</div>
      </div>
    `).join('');
  };

  $('#log-date-from', overlay).addEventListener('change', () => {
    // Keep the range sane: don't let "from" land after "to".
    const toEl = $('#log-date-to', overlay);
    if (toEl.value && $('#log-date-from', overlay).value > toEl.value) toEl.value = $('#log-date-from', overlay).value;
    paintList();
  });
  $('#log-date-to', overlay).addEventListener('change', () => {
    const fromEl = $('#log-date-from', overlay);
    if (fromEl.value && fromEl.value > $('#log-date-to', overlay).value) fromEl.value = $('#log-date-to', overlay).value;
    paintList();
  });
  $('#log-scanner', overlay).addEventListener('change', paintList);
  $('#log-clear', overlay).addEventListener('click', () => {
    $('#log-date-from', overlay).value = '';
    $('#log-date-to', overlay).value = '';
    $('#log-scanner', overlay).value = 'all';
    paintList();
  });
  paintList();
}
