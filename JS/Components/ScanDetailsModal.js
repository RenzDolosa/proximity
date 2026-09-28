// "What's behind this number?" — opened by clicking a stat card or a scanner
// row on the Scanner Analytics page. Lists the actual scan_events rows the
// card counted (newest first), via ScannerStatsModel.details().
//
// Read-only on purpose: Analytics is a read-only page, and this dialog keeps
// that promise — no delete or edit affordance, unlike ScanLogModal.js.
//
// `days` must be the window the *displayed* stats were loaded for
// (stats.summary.days), not whatever range button is highlighted right now:
// a range switch takes a moment to resolve, and drilling into a card during
// that gap must still list the rows that card was counting.
import { $ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { exportXlsx, todayStamp } from '../Utils/xlsxExport.js';
import { openModal, closeModal, startModalOpen, isStaleModalOpen } from './Modal.js';
import { ScannerStatsModel } from '../Models/ScannerStatsModel.js';
import { detailsTitle, resultLabel, capNotice } from '../Utils/scanDetails.js';

// The list is server-capped (500 rows by default), but painting 500 rows of
// markup at once is still the kind of thing that made ScanLogModal hang on
// big employees — cap what's painted to keep open/close instant. Export
// uses everything that was fetched.
const RENDER_CAP = 200;
const FETCH_LIMIT = 500;

export async function openScanDetailsModal({ days, filter = 'all', scannerId = null }) {
  const token = startModalOpen();
  const title = detailsTitle({ filter, scannerId });
  const overlay = openModal(`
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;">
      <h3 id="sd-title" style="margin:0;">${esc(title)}</h3>
      <button class="ghost" id="sd-export" style="flex:0 0 auto;padding:5px 10px;font-size:12px;" disabled>Export</button>
    </div>
    <p class="sub" style="margin:4px 0 10px;">Last ${esc(days)} days, newest first. Read-only.</p>
    <div id="sd-body" class="empty-state">Loading…</div>
    <div class="actions">
      <button class="ghost" id="sd-close">Close</button>
    </div>
  `, { maxWidth: '760px' });

  $('#sd-close', overlay).addEventListener('click', () => closeModal(overlay));

  const { data, error } = await ScannerStatsModel.details({ days, filter, scannerId, limit: FETCH_LIMIT });
  // A newer modal was opened while this one was loading (Enter pressed twice
  // on a focused card, say). Close this one rather than leave it stacked
  // underneath, stuck on "Loading…".
  if (isStaleModalOpen(token)) { closeModal(overlay); return; }
  const body = $('#sd-body', overlay);
  if (!body) return; // closed while loading
  if (error) { body.textContent = error.message; return; }

  const rows = data || [];
  if (!rows.length) {
    body.innerHTML = `<strong>No scans</strong>Nothing matched in this window.`;
    return;
  }

  const total = Number(rows[0].total_count);
  const notice = capNotice(rows.length, total);
  const painted = rows.slice(0, RENDER_CAP);
  const paintNotice = rows.length > RENDER_CAP
    ? `Showing ${RENDER_CAP} of ${rows.length} loaded${notice ? ` (${total} match in total)` : ''} — export includes all ${rows.length} loaded.`
    : notice;

  body.className = '';
  body.innerHTML = `
    ${paintNotice ? `<div class="emp-meta" style="padding:0 2px 8px;">${esc(paintNotice)}</div>` : `<div class="emp-meta" style="padding:0 2px 8px;">${total} scan${total === 1 ? '' : 's'}</div>`}
    <div class="table-scroll" style="max-height:380px;">
      <table>
        <thead><tr><th>When</th><th>Employee</th><th>Card</th><th>Scanner</th><th>Result</th></tr></thead>
        <tbody>
          ${painted.map((r) => `
            <tr>
              <td class="mono">${esc(fmtTime(r.scanned_at))}${r.captured_offline ? ' <span class="badge suspended" title="Recorded on the scanner while offline, synced later">offline</span>' : ''}</td>
              <td>${r.employee_name ? `${esc(r.employee_name)}<div class="emp-meta">${esc([r.employee_code, r.department].filter(Boolean).join(' · '))}</div>` : '<span class="emp-meta">—</span>'}</td>
              <td class="mono">${esc(r.proximity_code || '')}</td>
              <td class="mono">${esc(r.scanner_id || '—')}</td>
              <td><span class="badge ${esc(r.result)}">${esc(resultLabel(r.result))}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  const exportBtn = $('#sd-export', overlay);
  exportBtn.disabled = false;
  exportBtn.addEventListener('click', () => {
    try {
      exportXlsx({
        filename: `scan-details-${(filter + (scannerId ? `-${scannerId}` : '')).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${todayStamp()}.xlsx`,
        sheetName: 'Scans',
        columns: [
          { key: 'scanned_at', label: 'Scanned at' },
          { key: 'employee_name', label: 'Employee' },
          { key: 'employee_code', label: 'Employee code', text: true },
          { key: 'department', label: 'Department' },
          { key: 'proximity_code', label: 'Proximity code', text: true },
          { key: 'scanner_id', label: 'Scanner' },
          { key: 'result', label: 'Result' },
          { key: 'offline', label: 'Recorded offline' },
        ],
        rows: rows.map((r) => ({
          scanned_at: fmtTime(r.scanned_at),
          employee_name: r.employee_name || '',
          employee_code: r.employee_code || '',
          department: r.department || '',
          proximity_code: r.proximity_code || '',
          scanner_id: r.scanner_id || '',
          result: resultLabel(r.result),
          offline: r.captured_offline ? 'Yes' : 'No',
        })),
      });
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}
