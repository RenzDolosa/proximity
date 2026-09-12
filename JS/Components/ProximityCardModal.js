import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { openModal, closeModal, showModalError } from './Modal.js';
import { appState } from '../Core/state.js';
import { ProximityCardsModel } from '../Models/ProximityCardsModel.js';

export function openCardModal(onSaved) {
  const overlay = openModal(`
    <h3>Issue proximity card</h3>
    <p class="sub" style="margin:-4px 0 16px;">Cards can be issued as unassigned inventory — link one to an employee later from Employee Manager.</p>
    <div class="field"><label>Proximity code</label><input id="c-code" class="mono" placeholder="e.g. PRX-00021" /></div>
    <div class="auth-error hidden" id="c-error"></div>
    <div class="actions">
      <button class="ghost" id="c-cancel">Cancel</button>
      <button class="primary" id="c-save">Issue card</button>
    </div>
  `);

  $('#c-cancel', overlay).addEventListener('click', () => closeModal(overlay));
  $('#c-save', overlay).addEventListener('click', async () => {
    const proximity_code = $('#c-code', overlay).value.trim();
    if (!proximity_code) {
      showModalError(overlay, '#c-error', 'Enter a proximity code.');
      return;
    }
    const { error } = await ProximityCardsModel.issue(proximity_code, appState.session.user.id);
    if (error) { showModalError(overlay, '#c-error', error.message); return; }
    closeModal(overlay);
    toast('Proximity card issued');
    onSaved?.();
  });
}

/**
 * Revoke confirmation with a reason. If the card is currently linked to an
 * employee, that reason is cascaded into the employee's remarks by the
 * revoke_proximity_card() RPC (see ProximityCardsModel#revoke) — this modal
 * just collects the reason and shows who, if anyone, will get the remark.
 * @param {{id:string, proximity_code:string, employee_name?:string, employee_code?:string}} card
 */
export function openRevokeCardModal(card, onDone) {
  const assignedTo = card.employee_name
    ? `${esc(card.employee_name)}${card.employee_code ? ` <span class="emp-meta mono">(${esc(card.employee_code)})</span>` : ''}`
    : '<span style="color:var(--text-faint)">unassigned</span>';

  const overlay = openModal(`
    <h3>Revoke proximity card</h3>
    <div class="emp-meta" style="margin-bottom:14px;line-height:1.7;">
      Code: <span class="mono" style="color:var(--text)">${esc(card.proximity_code)}</span><br/>
      Assigned to: ${assignedTo}
    </div>
    ${card.employee_name ? `<p class="sub" style="margin:-4px 0 14px;">This reason will be saved as a remark on ${esc(card.employee_name)}'s employee record.</p>` : ''}
    <div class="field"><label>Reason for revoking</label>
      <textarea id="rv-reason" rows="3" placeholder="e.g. Lost card, employee offboarded, card damaged…" style="width:100%;resize:vertical;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 10px;border-radius:var(--radius);font-family:var(--sans);font-size:13px;"></textarea>
    </div>
    <div class="auth-error hidden" id="rv-error"></div>
    <div class="actions">
      <button class="ghost" id="rv-cancel">Cancel</button>
      <button class="danger" id="rv-confirm">Revoke card</button>
    </div>
  `);

  $('#rv-cancel', overlay).addEventListener('click', () => closeModal(overlay));
  $('#rv-confirm', overlay).addEventListener('click', async () => {
    const reason = $('#rv-reason', overlay).value.trim();
    const btn = $('#rv-confirm', overlay);
    btn.disabled = true;
    btn.textContent = 'Revoking…';
    const { error } = await ProximityCardsModel.revoke(card.id, reason);
    if (error) {
      showModalError(overlay, '#rv-error', error.message);
      btn.disabled = false;
      btn.textContent = 'Revoke card';
      return;
    }
    closeModal(overlay);
    toast('Card revoked');
    onDone?.();
  });
}
