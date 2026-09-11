// Recent-activity list, used both on the in-shell Scanner page and the
// compact sidebar of the standalone scanner tab (targetId lets callers
// point it at either container).
import { $ } from '../Utils/dom.js';
import { esc, initials, fmtTime } from '../Utils/format.js';
import { ScanEventsModel } from '../Models/ScanEventsModel.js';

export async function loadScanFeed(targetId = 'scan-feed', limit = 10, scannerId = null) {
  const feedEl = $('#' + targetId);
  if (!feedEl) return;
  const { data, error } = await ScanEventsModel.recentFeed(limit, scannerId);
  if (error) { feedEl.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  if (!data.length) { feedEl.innerHTML = `<div class="empty-state">No scans yet.</div>`; return; }
  feedEl.innerHTML = data.map((row) => `
    <div class="feed-row">
      <div class="avatar">${row.employee_name ? esc(initials(row.employee_name)) : '?'}</div>
      <div>
        <div style="font-weight:500;">${row.employee_name ? esc(row.employee_name) : 'Unmatched scan'}</div>
        <div class="emp-meta mono">${esc(row.scanner_id)}</div>
      </div>
      <div>
        <span class="badge ${row.result}" style="margin-left:8px;">${esc(row.result)}</span>
        <div class="feed-time">${fmtTime(row.scanned_at)}</div>
      </div>
    </div>
  `).join('');
}
