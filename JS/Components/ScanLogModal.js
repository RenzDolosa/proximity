import { $ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { exportXlsx, todayStamp } from '../Utils/xlsxExport.js';
import { isAdmin } from '../Core/state.js';
import { openModal, closeModal, startModalOpen, isStaleModalOpen, onModalClose } from './Modal.js';
import { openConfirmModal } from './ConfirmModal.js';
import { dateRangePickerHTML, mountDateRangePicker } from './DateRangePicker.js';
import { supabase } from '../Core/supabaseClient.js';
import { EmployeesModel } from '../Models/EmployeesModel.js';
import { buildHeatmap, intensity, dayLabel, HEATMAP_DAYS, MIN_DAYS_FOR_MEDIAN } from '../Utils/scanHeatmap.js';

// Local (not UTC) yyyy-mm-dd, so it lines up with what fmtTime() displays
// and with the value an <input type="date"> gives back.
const localDateKey = (iso) => new Date(iso).toLocaleDateString('en-CA');

// scan_logs is an unbounded jsonb array on the employee row — some
// employees accumulate 1000+ entries over time. Rendering all of them as
// DOM nodes in one innerHTML pass is what causes the brief hang on
// open/close for those employees; capping how many rows actually get
// painted keeps this modal responsive regardless of how large the
// underlying array grows. `logs` itself still holds the full filtered set
// (needed for the scanner dropdown and for date filtering), only the
// painted list is capped.
const RENDER_CAP = 300;

/**
 * The thirty-day grid above the filters.
 *
 * Reads the array that is already here. The list below shows the most
 * recent RENDER_CAP entries in reverse order, which answers "what happened
 * on Tuesday" only by scrolling and counting; the grid answers "is this
 * person's attendance normal" without reading anything. No request, no
 * column, no migration — see Utils/scanHeatmap.js.
 */
function heatmapHTML(logs, selectedDay = '') {
  const { days, summary } = buildHeatmap(logs);
  // A button, not a styled <i>: this is a control now, and it has to be
  // reachable by keyboard and announced as one. `disabled` on an empty day
  // rather than hiding it — the gap in the grid is information, but there is
  // nothing to filter to.
  const cells = days.map((d) => `<button type="button"
      class="hm-cell hm-${d.state} hm-i${intensity(d.count)}${d.key === selectedDay ? ' is-sel' : ''}"
      data-day="${esc(d.key)}"${d.count ? '' : ' disabled'}
      aria-pressed="${d.key === selectedDay}"
      title="${esc(dayLabel(d, { fmtDate: (k) => k }))}${d.count ? ' · click to filter' : ''}"
    ></button>`).join('');

  // What the colours were judged against, stated rather than implied. With
  // too little history the outlier test did not run at all, and reporting
  // "0 unusual" as though it had would be the kind of unearned figure this
  // project refuses elsewhere (see the health drawer's missing denominator).
  const basis = summary.basis === 'self'
    ? `Usual day ${esc(summary.medianIn)} → ${esc(summary.medianOut)}`
    : `Fewer than ${MIN_DAYS_FOR_MEDIAN} closed days — not enough to judge unusual hours`;

  const flags = [
    summary.openDays ? `<span class="hm-flag bad-text">${summary.openDays} unclosed</span>` : '',
    summary.basis === 'self' && summary.oddDays ? `<span class="hm-flag warn-text">${summary.oddDays} unusual</span>` : '',
  ].filter(Boolean).join('');

  // Returns the INSIDE of .hm-wrap, not the wrapper. The wrapper is a stable
  // node in the modal body so the delegated click listener below survives a
  // repaint — rebuilding it would drop the listener with it.
  return `
      <div class="hm-head">
        <span>Last ${HEATMAP_DAYS} days</span>
        <span class="hm-sub">${selectedDay
          ? `filtered to ${esc(selectedDay)} — click again to clear`
          : `${summary.daysWithScans} active · ${summary.totalScans} scans`}</span>
      </div>
      <div class="hm-grid" role="group" aria-label="Filter the log to one day">${cells}</div>
      <div class="hm-foot">
        <span class="hm-sub">${basis}</span>
        <span class="hm-flags">${flags}</span>
      </div>
  `;
}

export async function openScanLogModal(employeeId, initialDate = '') {
  const token = startModalOpen();
  const overlay = openModal(`
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;">
      <h3 id="log-title" style="margin:0;">Scan log</h3>
      <button class="ghost" id="log-export" style="flex:0 0 auto;padding:5px 10px;font-size:12px;">Export</button>
    </div>
    <div id="log-body" class="empty-state">Loading…</div>
    <div class="actions">
      <button class="ghost" id="log-close">Close</button>
    </div>
  `, { maxWidth: '580px' });

  $('#log-close', overlay).addEventListener('click', () => closeModal(overlay));

  let logs = [];
  let employeeName = '';
  let filteredForExport = []; // kept in sync by paintList() below — export uses the FULL filtered set, not just the RENDER_CAP-limited painted rows

  $('#log-export', overlay).addEventListener('click', () => {
    if (!filteredForExport.length) { toast('Nothing to export for the current filter.', 'error'); return; }
    exportXlsx({
      filename: `scan-log-${(employeeName || 'employee').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${todayStamp()}.xlsx`,
      sheetName: 'Scan log',
      columns: [
        { key: 'scanned_at', label: 'Scanned at' },
        { key: 'scanner_id', label: 'Scanner' },
        { key: 'direction', label: 'Direction' },
        { key: 'proximity_code', label: 'Proximity code', text: true },
        { key: 'offline', label: 'Recorded offline' },
      ],
      rows: filteredForExport.map((l) => ({
        scanned_at: fmtTime(l.scanned_at),
        scanner_id: l.scanner_id || '—',
        direction: (l.direction || '—').toUpperCase(),
        proximity_code: l.proximity_code || '',
        offline: l.offline ? 'Yes' : 'No',
      })),
    });
  });

  const paintList = () => {
    const fromVal = $('#log-range .drp-from', overlay)?.value;
    const toVal = $('#log-range .drp-to', overlay)?.value;
    const scannerVal = $('#log-scanner', overlay)?.value || 'all';
    const filtered = logs.filter((l) => {
      const key = localDateKey(l.scanned_at);
      return (!fromVal || key >= fromVal) &&
        (!toVal || key <= toVal) &&
        (scannerVal === 'all' || l.scanner_id === scannerVal);
    });
    filteredForExport = filtered;
    const listEl = $('#log-list', overlay);
    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty-state">No scans match this filter.</div>`;
      return;
    }
    // logs is already sorted newest-first, so the first RENDER_CAP entries
    // of `filtered` are exactly the most recent matching scans.
    const capped = filtered.slice(0, RENDER_CAP);
    const notice = filtered.length > RENDER_CAP
      ? `<div class="emp-meta" style="padding:6px 2px;">Showing the most recent ${RENDER_CAP} of ${filtered.length} matching scans — narrow the date range or scanner filter to see others. Export uses all ${filtered.length}.</div>`
      : '';
    listEl.innerHTML = notice + capped.map((l) => `
      <!-- .log-row keeps the time pushed to the right edge. The scanner's own
           feed moved its time under the name on 2026-10-09 and dropped
           .feed-time's margin-left:auto to do it, which left this row's time
           floating in the middle. -->
      <div class="feed-row log-row">
        <span class="badge ${l.direction === 'out' ? 'suspended' : 'active'}">${(l.direction || '—').toUpperCase()}</span>
        <div class="log-row-who">
          <div style="font-weight:500;">${esc(l.scanner_id || '—')}</div>
          <div class="emp-meta mono">${esc(l.proximity_code || '')}</div>
        </div>
        <div class="feed-time">${fmtTime(l.scanned_at)}</div>
        ${isAdmin() ? `<button class="ghost" data-del-log="${esc(l.scan_id)}" title="Delete this scan log entry" style="flex:0 0 auto;padding:2px 7px;margin-left:6px;color:var(--bad);">×</button>` : ''}
      </div>
    `).join('');
    if (isAdmin()) {
      listEl.querySelectorAll('button[data-del-log]').forEach((btn) => btn.addEventListener('click', async () => {
        const scanId = btn.dataset.delLog;
        const entry = logs.find((l) => l.scan_id === scanId);
        const ok = await openConfirmModal({
          title: 'Delete this scan log entry?',
          message: `Permanently delete the ${(entry?.direction || '').toUpperCase() || 'scan'} record${entry ? ` from ${fmtTime(entry.scanned_at)}` : ''}? This also removes it from Recent Activity. This can't be undone.`,
          confirmLabel: 'Delete',
        });
        if (!ok) return;
        const { error } = await EmployeesModel.deleteScanLog(employeeId, scanId);
        if (error) { toast(error.message, 'error'); return; }
        logs = logs.filter((l) => l.scan_id !== scanId);
        toast('Scan log entry deleted');
        paintList();
      }));
    }
  };

  // Re-fetches this employee's scan_logs and repaints, preserving whatever
  // filters are currently set. Called once on open, and again every time
  // the Realtime subscription below sees a new scan for this employee.
  const refresh = async () => {
    const { data: emp, error } = await EmployeesModel.getScanLogs(employeeId);
    if (isStaleModalOpen(token)) return;
    const bodyEl = $('#log-body', overlay);
    if (error) { bodyEl.textContent = error.message; return; }
    $('#log-title', overlay).textContent = `Scan log — ${emp.full_name}`;
    employeeName = emp.full_name || '';
    logs = (emp.scan_logs || []).slice().sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
    if (!logs.length) {
      bodyEl.innerHTML = `<div class="empty-state"><strong>No scans yet</strong>This employee hasn't tapped their card at any scanner.</div>`;
      return;
    }

    const scanners = [...new Set(logs.map((l) => l.scanner_id).filter(Boolean))].sort();
    const prevFrom = $('#log-range .drp-from', overlay)?.value ?? initialDate;
    const prevTo = $('#log-range .drp-to', overlay)?.value ?? initialDate;
    const prevScanner = $('#log-scanner', overlay)?.value || 'all';

    bodyEl.className = '';
    bodyEl.innerHTML = `
      <div class="hm-wrap" id="log-heatmap"></div>
      <div class="filter-row" id="log-filter-row" style="margin-bottom:10px;">
        ${dateRangePickerHTML('log-range', { from: prevFrom, to: prevTo, emptyLabel: 'All dates' })}
        <select id="log-scanner">
          <option value="all">All scanners</option>
          ${scanners.map((s) => `<option value="${esc(s)}" ${s === prevScanner ? 'selected' : ''}>${esc(s)}</option>`).join('')}
        </select>
        <button class="ghost" id="log-clear" style="flex:0 0 auto;padding:7px 10px;">Clear</button>
      </div>
      <div id="log-list" style="max-height:340px;overflow-y:auto;"></div>
    `;

    // The picker IS the selection state — there is no second variable to
    // drift from it. A single day is a range whose ends are equal, which is
    // exactly what clicking one cell sets.
    const selectedDay = () => {
      const from = $('#log-range .drp-from', overlay)?.value || '';
      const to = $('#log-range .drp-to', overlay)?.value || '';
      return from && from === to ? from : '';
    };
    const paintHeatmap = () => {
      const host = $('#log-heatmap', overlay);
      if (host) host.innerHTML = heatmapHTML(logs, selectedDay());
    };
    // Built from `logs`, never from the filtered set: the grid is the thirty
    // days in context, and redrawing it from its own filter would leave one
    // lit cell and twenty-nine blanks.
    const paintAll = () => { paintHeatmap(); paintList(); };

    // Filtering is local to the rows already fetched, so repainting on apply
    // costs nothing — the picker itself never triggers a request.
    const picker = mountDateRangePicker($('#log-range', overlay), { onApply: paintAll });
    onModalClose(() => picker?.destroy());
    $('#log-scanner', overlay).addEventListener('change', paintList);
    $('#log-clear', overlay).addEventListener('click', () => {
      picker?.set({ from: '', to: '' });
      $('#log-scanner', overlay).value = 'all';
      paintAll();
    });

    // Delegated on the wrapper, which paintHeatmap() never replaces — so one
    // listener survives every repaint. Clicking the selected day clears it,
    // because the alternative is a filter you can set from the grid and have
    // to clear from somewhere else.
    $('#log-heatmap', overlay).addEventListener('click', (e) => {
      const cell = e.target.closest('button[data-day]');
      if (!cell || cell.disabled) return;
      const day = cell.dataset.day;
      const next = day === selectedDay() ? '' : day;
      picker?.set({ from: next, to: next });
      paintAll();
    });

    paintAll();
  };

  await refresh();

  // Live-refresh: scan_events rows only ever come from scan_proximity_code()
  // — the real, door-facing scanner. test_scan_proximity_code() (Test Scan)
  // never inserts one, so this only fires for genuine scans of this
  // employee, never test scans, and never plain profile edits.
  const channel = supabase
    .channel(`scan-log-${employeeId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scan_events', filter: `employee_id=eq.${employeeId}` }, () => refresh())
    .subscribe();
  onModalClose(() => supabase.removeChannel(channel));
}
