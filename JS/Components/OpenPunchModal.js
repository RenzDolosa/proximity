// The open-day review queue: days where someone scanned IN and never
// scanned OUT, each with the time it would be closed at.
//
// Deliberately a REVIEW step and not a button that fixes everything. These
// writes change hours that end up in pay, so a person sees each proposal,
// each row says what it would add, and implausible ones are called out
// before anyone presses anything. Blocked rows stay on screen with their
// reason rather than quietly disappearing — "41 of 47" with no explanation
// for the other 6 is how a tool loses trust.
import { $, $$ } from '../Utils/dom.js';
import { esc, fmtTime } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { openModal, closeModal, showModalError } from './Modal.js';
import { AttendanceModel } from '../Models/AttendanceModel.js';
import { reportError } from '../Utils/userError.js';
import { fmtDuration } from '../Utils/attendance.js';
import {
  isClosable, isImplausible, addedMinutes, toClosurePayload, summariseOutcomes,
} from '../Utils/openPunches.js';

export async function openOpenPunchModal({ from, to }, onDone) {
  const overlay = openModal(`
    <h3>Days with no tap-out</h3>
    <p class="modal-message">
      Each of these would be closed at the last scan recorded at the same
      scanner that day. Nothing is written until you choose.
    </p>
    <div class="auth-error hidden" id="op-error"></div>
    <div id="op-body">Loading…</div>
    <div class="actions">
      <button class="ghost" id="op-cancel">Close</button>
      <button class="primary" id="op-apply" disabled>Close selected</button>
    </div>
  `, { maxWidth: '760px' });

  $('#op-cancel', overlay).addEventListener('click', () => closeModal(overlay));

  let rows = [];
  const { data, error } = await AttendanceModel.openClosures({ from, to });
  if (error) {
    showModalError(overlay, '#op-error', reportError(error, 'attendance.openClosures', "Couldn't load the open days."));
    $('#op-body', overlay).innerHTML = '';
    return;
  }
  rows = Array.isArray(data) ? data : [];
  paint();

  function paint() {
    const body = $('#op-body', overlay);
    if (!rows.length) {
      body.innerHTML = '<div class="empty-state">No open days in this range.</div>';
      return;
    }
    const closable = rows.filter(isClosable);
    body.innerHTML = `
      <div class="emp-meta" style="margin-bottom:8px;">
        ${closable.length} of ${rows.length} can be closed automatically.
      </div>
      <div class="table-scroll" style="max-height:min(420px,50dvh);">
        <table class="table-as-cards">
          <thead><tr>
            <th class="col-shrink"><input type="checkbox" id="op-all" aria-label="Select all" /></th>
            <th>Employee</th><th class="col-shrink">Day</th>
            <th class="col-shrink">IN</th><th class="col-shrink">Close at</th>
            <th class="col-shrink">Adds</th>
          </tr></thead>
          <tbody>${rows.map(rowHTML).join('')}</tbody>
        </table>
      </div>
    `;
    $('#op-all', overlay)?.addEventListener('change', (e) => {
      $$('input[data-pick]', overlay).forEach((c) => { if (!c.disabled) c.checked = e.target.checked; });
      refreshApply();
    });
    $$('input[data-pick]', overlay).forEach((c) => c.addEventListener('change', refreshApply));
    refreshApply();
  }

  function rowHTML(r, i) {
    const ok = isClosable(r);
    const mins = addedMinutes(r);
    const odd = isImplausible(r);
    return `
      <tr>
        <td class="col-shrink" data-label="Close">
          <input type="checkbox" data-pick="${i}" ${ok ? 'checked' : 'disabled'}
                 aria-label="Close ${esc(r.full_name)} on ${esc(r.work_date)}" />
        </td>
        <td class="card-title">${esc(r.full_name)}
          <span class="emp-meta mono">${esc(r.employee_code || '')}</span></td>
        <td class="col-shrink" data-label="Day">${esc(r.work_date)}</td>
        <td class="col-shrink mono" data-label="IN">${esc(fmtTime(r.open_in_at))}</td>
        <td class="col-shrink mono" data-label="Close at">
          ${ok ? esc(fmtTime(r.proposed_out_at))
               : `<span class="badge unassigned_card">${esc(r.blocked_reason || 'cannot close')}</span>`}
        </td>
        <td class="col-shrink mono" data-label="Adds">
          ${mins === null ? '—' : `${esc(fmtDuration(mins * 60))}${odd ? ' <span class="badge inactive_card" title="Longer than 12 hours — check this one">long</span>' : ''}`}
        </td>
      </tr>`;
  }

  function picked() {
    return $$('input[data-pick]', overlay)
      .filter((c) => c.checked && !c.disabled)
      .map((c) => rows[Number(c.dataset.pick)]);
  }

  function refreshApply() {
    const n = picked().length;
    const btn = $('#op-apply', overlay);
    btn.disabled = n === 0;
    btn.textContent = n ? `Close ${n} day${n === 1 ? '' : 's'}` : 'Close selected';
  }

  $('#op-apply', overlay).addEventListener('click', async () => {
    const chosen = picked();
    const payload = toClosurePayload(chosen);
    if (!payload.length) return;

    const btn = $('#op-apply', overlay);
    btn.disabled = true;
    btn.textContent = 'Closing…';
    const { data: results, error: err } = await AttendanceModel.closeOpenPunches(payload);
    if (err) {
      showModalError(overlay, '#op-error', reportError(err, 'attendance.closeOpenPunches', "Couldn't close those days."));
      btn.disabled = false;
      refreshApply();
      return;
    }
    toast(summariseOutcomes(results));
    closeModal(overlay);
    onDone?.();
  });
}
