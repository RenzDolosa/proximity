// Recent-activity list, used both on the in-shell Scanner page and the
// compact sidebar of the standalone scanner tab (targetId lets callers
// point it at either container).
import { $ } from '../Utils/dom.js';
import { esc, avatarHTML, fmtTime } from '../Utils/format.js';
import { ScanEventsModel } from '../Models/ScanEventsModel.js';

function feedRowHTML(row) {
  return `
    <div class="feed-row${row.pending ? ' feed-row-pending' : ''}">
      <div class="avatar">${row.employee_name ? avatarHTML(row.employee_name, row.photo_url, row.cache_key) : '?'}</div>
      <div>
        <div style="font-weight:500;">${row.employee_name ? esc(row.employee_name) : 'Unmatched scan'}</div>
        <div class="emp-meta mono">${esc(row.scanner_id)}</div>
      </div>
      <div>
        <span class="badge ${row.result}" style="margin-left:8px;">${esc(row.result)}</span>
        <div class="feed-time">${row.pending ? 'Queued — syncing…' : fmtTime(row.scanned_at)}</div>
      </div>
    </div>
  `;
}

export async function loadScanFeed(targetId = 'scan-feed', limit = 10, scannerId = null) {
  const feedEl = $('#' + targetId);
  if (!feedEl) return;
  const { data, error } = await ScanEventsModel.recentFeed(limit, scannerId);
  if (error) {
    // A failed refresh is routine, not fatal — it happens on every page
    // load made while already offline (StandaloneScanner.js calls this
    // unconditionally on init), and on any periodic/post-sync retry made
    // while still offline. This used to replace the ENTIRE feed with the
    // raw error text (`TypeError: Failed to fetch` and similar — exactly
    // what a failed fetch() throws, not a message meant for an operator
    // to read), which threw away whatever pending/offline rows were
    // already showing. Only show a placeholder if the feed has nothing
    // in it to preserve; otherwise leave existing rows alone and let the
    // next successful refresh fix it silently — same pattern as
    // OfflineScanModel's "best-effort, never break the rest of the app
    // over a network hiccup" throughout this file.
    if (!feedEl.children.length) {
      feedEl.innerHTML = `<div class="empty-state">Recent activity unavailable — ${navigator.onLine ? 'reconnecting…' : 'offline'}</div>`;
    }
    return;
  }
  if (!data.length) { feedEl.innerHTML = `<div class="empty-state">No scans yet.</div>`; return; }
  feedEl.innerHTML = data.map((row) => feedRowHTML({ ...row, cache_key: row.scanned_at })).join('');
}

// Optimistic local row for a scan made while offline. Nothing was
// actually written to scan_events yet — OfflineScanModel just queued the
// raw attempt in IndexedDB — so this is never authoritative and never
// persisted anywhere itself: it's plain DOM, gone on refresh, and it gets
// wholesale replaced by the real thing the moment loadScanFeed() next
// runs (on reconnect-and-sync, or the next successful online scan).
// Purpose is purely "don't leave the operator staring at a feed that
// looks like nothing happened" while the kiosk is offline — previously
// offline scans were invisible here until sync, sometimes minutes later.
export function prependPendingRow(targetId, classifyResult, scannerId, limit = 10) {
  const feedEl = $('#' + targetId);
  if (!feedEl) return;
  const e = classifyResult.employee;
  const rowHTML = feedRowHTML({
    pending: true,
    result: classifyResult.result,
    scanner_id: scannerId,
    employee_name: e?.full_name || null,
    photo_url: e?.photo_url || null,
    // photo_file_id, not updated_at — a scan bumps employees.updated_at
    // itself (trg_employees_updated_at fires on the scan_logs append), so
    // updated_at would never match what prefetchPhotos() actually cached.
    // See OfflineScanModel.js's classify() for the full explanation.
    cache_key: e?.photo_file_id || '',
  });
  const existingRows = feedEl.querySelector('.empty-state') ? [] : Array.from(feedEl.children);
  feedEl.innerHTML = rowHTML + existingRows.slice(0, limit - 1).map((el) => el.outerHTML).join('');
}