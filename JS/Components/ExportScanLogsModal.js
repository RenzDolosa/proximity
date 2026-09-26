// "Export all scan logs" used to sit next to two permanent date inputs in
// the Employee Manager toolbar — taking up toolbar space on every visit
// for what's actually an occasional action, and for the common case
// (export everything, no range) those two inputs did nothing but sit
// there empty. Moved into its own modal, opened only when the button is
// actually clicked: collects an optional date range, then performs the
// export itself and resolves once it's done — same "the modal owns the
// whole collect-input-then-act flow" pattern as RevokeCardModal.js.
import { $ } from '../Utils/dom.js';
import { fmtTime } from '../Utils/format.js';
import { openModal, closeModal, setModalLocked } from './Modal.js';
import { ScanEventsModel } from '../Models/ScanEventsModel.js';
import { exportXlsx, todayStamp } from '../Utils/xlsxExport.js';

/** @returns {Promise<{ confirmed: boolean, error?: { message: string } }>} */
export function openExportScanLogsModal() {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <h3>Export all scan logs</h3>
      <p class="sub" style="margin:-4px 0 14px;">Optional date range — leave either side blank for no lower/upper bound.</p>
      <div class="filter-row" style="margin-bottom:14px;">
        <div class="field" style="flex:1;">
          <label>From</label>
          <input type="date" id="esl-from" />
        </div>
        <div class="field" style="flex:1;">
          <label>To</label>
          <input type="date" id="esl-to" />
        </div>
      </div>
      <div class="auth-error hidden" id="esl-error"></div>
      <div class="actions">
        <button class="ghost" id="esl-cancel">Cancel</button>
        <button class="primary" id="esl-ok">Export</button>
      </div>
    `, { maxWidth: '420px' });

    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; resolve(result); };

    $('#esl-cancel', overlay).addEventListener('click', () => { finish({ confirmed: false }); closeModal(overlay); });

    // Same mutual-clamp behavior the inline toolbar fields used to have —
    // picking a "from" after the current "to" (or vice versa) pulls the
    // other bound along instead of silently producing an inverted,
    // always-empty range.
    $('#esl-from', overlay).addEventListener('change', () => {
      const toEl = $('#esl-to', overlay);
      if (toEl.value && $('#esl-from', overlay).value > toEl.value) toEl.value = $('#esl-from', overlay).value;
    });
    $('#esl-to', overlay).addEventListener('change', () => {
      const fromEl = $('#esl-from', overlay);
      if (fromEl.value && fromEl.value > $('#esl-to', overlay).value) fromEl.value = $('#esl-to', overlay).value;
    });

    $('#esl-ok', overlay).addEventListener('click', async () => {
      const errEl = $('#esl-error', overlay);
      const okBtn = $('#esl-ok', overlay);
      const showError = (message) => {
        errEl.textContent = message;
        errEl.classList.remove('hidden');
        okBtn.disabled = false;
        okBtn.textContent = 'Export';
        setModalLocked(overlay, false);
      };

      const fromVal = $('#esl-from', overlay).value; // 'YYYY-MM-DD' or ''
      const toVal = $('#esl-to', overlay).value;
      // Widened to the full local day (00:00:00.000 through 23:59:59.999)
      // so the "to" day is inclusive — a bare date-only ISO string would
      // otherwise mean midnight UTC and silently exclude that whole day
      // for anyone not on UTC.
      const from = fromVal ? new Date(`${fromVal}T00:00:00`).toISOString() : null;
      const to = toVal ? new Date(`${toVal}T23:59:59.999`).toISOString() : null;

      okBtn.disabled = true;
      okBtn.textContent = 'Exporting…';
      setModalLocked(overlay, true);

      const { data, error } = await ScanEventsModel.listAll({ from, to });
      if (error) { showError(error.message); return; }
      if (!data.length) { showError('No scan history to export for that range.'); return; }

      exportXlsx({
        filename: `scan-logs-${fromVal || 'all'}_${toVal || 'all'}-${todayStamp()}.xlsx`,
        sheetName: 'Scan logs',
        columns: [
          { key: 'scanned_at', label: 'Scanned at' },
          { key: 'employee_name', label: 'Employee' },
          { key: 'department', label: 'Department' },
          { key: 'proximity_code', label: 'Proximity code', text: true },
          { key: 'scanner_id', label: 'Scanner' },
          { key: 'direction', label: 'Direction' },
          { key: 'result', label: 'Result' },
        ],
        rows: data.map((s) => ({
          scanned_at: fmtTime(s.scanned_at),
          // A null employee_name means an unmatched/unassigned-card scan
          // attempt (see scan_events.result) — genuinely no employee to
          // show, not a data-loading gap, so this is a plain em dash
          // rather than something that reads as an error.
          employee_name: s.employee_name || '—',
          department: s.department || '',
          proximity_code: s.proximity_code || '',
          scanner_id: s.scanner_id || '—',
          direction: (s.direction || '—').toUpperCase(),
          result: s.result || '',
        })),
      });

      finish({ confirmed: true });
      closeModal(overlay);
    });
  });
}