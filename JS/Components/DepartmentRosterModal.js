// "Who's on site in this department?" — opened by clicking a department
// chip in Dashboard's "On site by department" line. Purely a client-side
// filter of the roster DashboardPage.js has already loaded from
// get_onsite_roster() — no RPC, no fetch. Uses the exact same `view:
// 'live'` filter as the count itself (Utils/dashboard.js's filterRoster()),
// so the modal's row count always matches the number on the chip that
// opened it — never off by the stale/inactive rows the headline excludes.
import { $ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { exportXlsx, todayStamp } from '../Utils/xlsxExport.js';
import { fmtDuration } from '../Utils/attendance.js';
import { openModal, closeModal } from './Modal.js';

export function openDepartmentRosterModal(department, rows) {
  const overlay = openModal(`
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;">
      <h3 style="margin:0;">On site — ${esc(department)}</h3>
      <button class="ghost" id="dr-export" style="flex:0 0 auto;padding:5px 10px;font-size:12px;" ${rows.length ? '' : 'disabled'}>Export</button>
    </div>
    <p class="sub" style="margin:4px 0 10px;">${rows.length} employee${rows.length === 1 ? '' : 's'} currently on site in this department, earliest IN first. Read-only.</p>
    ${rows.length ? `
      <div class="table-scroll" style="max-height:380px;">
        <table>
          <thead><tr><th>Employee</th><th>Code</th><th>IN at</th><th>Time on site</th><th>Scanner</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${esc(r.full_name)}</td>
                <td class="mono">${esc(r.employee_code)}</td>
                <td class="mono">${esc(fmtTime(r.last_in_at))}</td>
                <td class="mono">${esc(fmtDuration(Number(r.seconds_on_site)))}</td>
                <td>${esc(r.last_scanner_id || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : `<div class="empty-state">Nobody from this department is currently on site.</div>`}
    <div class="actions"><button class="ghost" id="dr-close">Close</button></div>
  `, { maxWidth: '640px' });

  $('#dr-close', overlay).addEventListener('click', () => closeModal(overlay));
  const exportBtn = $('#dr-export', overlay);
  if (rows.length) {
    exportBtn.addEventListener('click', () => {
      try {
        exportXlsx({
          filename: `on-site-${department.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'department'}-${todayStamp()}.xlsx`,
          sheetName: 'On site',
          columns: [
            { key: 'employee_code', label: 'Employee code', text: true },
            { key: 'full_name', label: 'Employee' },
            { key: 'last_in_at', label: 'IN at' },
            { key: 'time_on_site', label: 'Time on site' },
            { key: 'last_scanner_id', label: 'Scanner' },
          ],
          rows: rows.map((r) => ({
            employee_code: r.employee_code,
            full_name: r.full_name,
            last_in_at: fmtTime(r.last_in_at),
            time_on_site: fmtDuration(Number(r.seconds_on_site)),
            last_scanner_id: r.last_scanner_id || '',
          })),
        });
      } catch (e) { toast(e.message, 'error'); }
    });
  }
}
