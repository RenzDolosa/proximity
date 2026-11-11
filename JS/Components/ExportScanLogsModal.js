// "Export all scan logs" used to sit next to two permanent date inputs in
// the Employee Manager toolbar — taking up toolbar space on every visit
// for what's actually an occasional action, and for the common case
// (export everything, no range) those two inputs did nothing but sit
// there empty. Moved into its own modal, opened only when the button is
// actually clicked: collects an optional date range, then performs the
// export itself and resolves once it's done — same "the modal owns the
// whole collect-input-then-act flow" pattern as RevokeCardModal.js.
//
// PAGED SINCE 2026-11-06, and recorded in the export ledger. One statement
// returning the whole history timed out in production; it also capped at
// 100,000 rows without saying so, which is the worse of the two failures
// because it looks like success. See Utils/exportChunking.js.
//
// AND THEN IT CAPPED AT 1,000 INSTEAD, for the same reason in a different
// place: PostgREST's db-max-rows truncated each page to 1,000, the loop read
// that as the end, and five consecutive exports came out a sixth of a percent
// complete. Fixed by 20261111120000 (the RPC returns one jsonb value, which
// the cap cannot touch) and by readPage() (the loop compares against the
// server's stated page size, never its own).
import { $ } from '../Utils/dom.js';
import { fmtTime } from '../Utils/format.js';
import { dateRangePickerHTML, mountDateRangePicker } from './DateRangePicker.js';
import { openModal, closeModal, setModalLocked } from './Modal.js';
import { ScanEventsModel } from '../Models/ScanEventsModel.js';
import { ExportTasksModel } from '../Models/ExportTasksModel.js';
import {
  EXPORT_PAGE_SIZE, EXPORT_ROW_CEILING, newExportState, appendPage,
  nextCursor, readPage, exportProgressLabel, hitRowCeiling,
} from '../Utils/exportChunking.js';
import { POSTGREST_MAX_ROWS } from '../Utils/rowCap.js';
import { exportXlsx, todayStamp } from '../Utils/xlsxExport.js';

export const SCAN_LOG_EXPORT_MODULE = 'scan_logs';

const COLUMNS = [
  { key: 'scanned_at', label: 'Scanned at' },
  { key: 'employee_name', label: 'Employee' },
  { key: 'department', label: 'Department' },
  { key: 'proximity_code', label: 'Proximity code', text: true },
  { key: 'scanner_id', label: 'Scanner' },
  { key: 'direction', label: 'Direction' },
  { key: 'result', label: 'Result' },
];

const toSheetRow = (s) => ({
  scanned_at: fmtTime(s.scanned_at),
  // A null employee_name means an unmatched/unassigned-card scan attempt
  // (see scan_events.result) — genuinely no employee to show, not a
  // data-loading gap, so this is a plain em dash rather than something that
  // reads as an error.
  employee_name: s.employee_name || '—',
  department: s.department || '',
  proximity_code: s.proximity_code || '',
  scanner_id: s.scanner_id || '—',
  direction: (s.direction || '—').toUpperCase(),
  result: s.result || '',
});

/**
 * Walk every page of the range and return the rows.
 *
 * Exported so the Export Manager's "Re-run" uses the identical path rather
 * than a second implementation that drifts from this one.
 *
 * @param {object} range `{ from, to }`, ISO strings or null
 * @param {(label: string) => void} [onProgress]
 */
export async function fetchAllScanLogs({ from, to }, onProgress) {
  const state = newExportState();
  let cursor = null;
  let page = 0;
  let limit = EXPORT_PAGE_SIZE;

  for (;;) {
    page += 1;
    onProgress?.(exportProgressLabel(state.rows.length, page));
    const { data, error } = await ScanEventsModel.scanLogPage({
      from, to, cursor, limit,
    });
    if (error) return { rows: state.rows, error };

    // `final` comes from readPage, NOT from comparing against the page size
    // this loop asked for. Those two were the same number right up until
    // PostgREST's db-max-rows quietly made them different, and every export
    // between 2026-11-06 and 2026-11-11 stopped after 1,000 rows as a result.
    const { rows, final } = readPage(data, limit);
    appendPage(state, rows);

    // A bare array means 20261111120000 is not applied yet and the old
    // set-returning RPC is answering. PostgREST caps that at db-max-rows
    // whatever we ask for, so continuing to ask for 10,000 makes the database
    // compute 9,000 rows a page that never leave it — ten times the work, and
    // the cursor only advances by what arrives. The export is correct either
    // way; this stops it being needlessly expensive while the migration is
    // outstanding.
    if (Array.isArray(data)) limit = POSTGREST_MAX_ROWS;

    // Checked BEFORE the final-page test: a run that stops at the ceiling has
    // not exported everything, and must not be reported as if it had.
    if (hitRowCeiling(state)) {
      return {
        rows: state.rows,
        error: {
          message: `This range has more than ${EXPORT_ROW_CEILING.toLocaleString()} scans. `
            + 'Export it in narrower date ranges — a spreadsheet that large is '
            + 'not reliably openable anyway.',
        },
      };
    }

    if (final) break;
    cursor = nextCursor(rows);
    // A full page that yields no cursor would loop forever on the same rows.
    // Should be impossible (id and scanned_at are both NOT NULL), so this is
    // a stop rather than a retry.
    if (!cursor) break;
  }

  return { rows: state.rows, error: null };
}

/** @returns {Promise<{ confirmed: boolean, error?: { message: string } }>} */
export function openExportScanLogsModal() {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <h3>Export all scan logs</h3>
      <p class="sub" style="margin:-4px 0 14px;">Optional date range — leave either side blank for no lower/upper bound.</p>
      <div class="filter-row" style="margin-bottom:14px;">
        ${dateRangePickerHTML('esl-range', { emptyLabel: 'All dates' })}
      </div>
      <div class="emp-meta" id="esl-progress" style="margin-bottom:10px;"></div>
      <div class="auth-error hidden" id="esl-error"></div>
      <div class="actions">
        <button class="ghost" id="esl-cancel">Cancel</button>
        <button class="primary" id="esl-ok">Export</button>
      </div>
    `, { maxWidth: '420px' });

    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; resolve(result); };

    // Declared before the handlers that close over it — a `const` referenced
    // from a listener defined above it is a TDZ error the moment that listener
    // runs, which `node --check` will not catch.
    //
    // No onApply: this modal reads the range only when Export is pressed, so
    // the picker never triggers anything by itself. An inverted range is
    // swapped into order by normaliseRange() rather than silently returning
    // nothing.
    const picker = mountDateRangePicker($('#esl-range', overlay));

    $('#esl-cancel', overlay).addEventListener('click', () => { picker?.destroy(); finish({ confirmed: false }); closeModal(overlay); });

    $('#esl-ok', overlay).addEventListener('click', async () => {
      const errEl = $('#esl-error', overlay);
      const progressEl = $('#esl-progress', overlay);
      const okBtn = $('#esl-ok', overlay);
      const showError = (message) => {
        errEl.textContent = message;
        errEl.classList.remove('hidden');
        progressEl.textContent = '';
        okBtn.disabled = false;
        okBtn.textContent = 'Export';
        setModalLocked(overlay, false);
      };

      const fromVal = picker.get().from; // 'YYYY-MM-DD' or ''
      const toVal = picker.get().to;
      // Widened to the full local day (00:00:00.000 through 23:59:59.999)
      // so the "to" day is inclusive — a bare date-only ISO string would
      // otherwise mean midnight UTC and silently exclude that whole day
      // for anyone not on UTC.
      const from = fromVal ? new Date(`${fromVal}T00:00:00`).toISOString() : null;
      const to = toVal ? new Date(`${toVal}T23:59:59.999`).toISOString() : null;
      const filename = `scan-logs-${fromVal || 'all'}_${toVal || 'all'}-${todayStamp()}.xlsx`;

      okBtn.disabled = true;
      okBtn.textContent = 'Exporting…';
      setModalLocked(overlay, true);

      // Recorded before a single row is fetched. If this call fails the
      // export still runs — a ledger that can block an export is worse than
      // one with a gap in it, and the gap is visible either way.
      const { data: taskId } = await ExportTasksModel.start(
        SCAN_LOG_EXPORT_MODULE, filename, { from, to },
      );
      const settle = async (status, rowCount, detail) => {
        if (!taskId) return;
        await ExportTasksModel.finish(taskId, { status, rowCount, detail }).catch(() => {});
      };

      const { rows, error } = await fetchAllScanLogs(
        { from, to }, (label) => { progressEl.textContent = label; },
      );
      if (error) {
        await settle('failed', rows.length, error.message);
        showError(error.message);
        return;
      }
      if (!rows.length) {
        await settle('failed', 0, 'No scan history in range');
        showError('No scan history to export for that range.');
        return;
      }

      try {
        exportXlsx({
          filename,
          sheetName: 'Scan logs',
          columns: COLUMNS,
          rows: rows.map(toSheetRow),
        });
      } catch (err) {
        // The rows were fetched; only the file failed. Recorded as failed
        // with the reason, because "the data left the database" and "the
        // operator got a spreadsheet" are different facts.
        await settle('failed', rows.length, err.message);
        showError(err.message);
        return;
      }

      await settle('finished', rows.length, null);
      finish({ confirmed: true });
      closeModal(overlay);
    });
  });
}
