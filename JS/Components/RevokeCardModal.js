// Revoking an assigned card updates the employee status and records it,
// together with any additional remarks, as one Employee Manager remark.
import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { openModal, closeModal, setModalLocked } from './Modal.js';
import { ProximityCardsModel } from '../Models/ProximityCardsModel.js';
import { EMPLOYEE_STATUSES } from '../Utils/employeeStatus.js';

/**
 * @param {{ id: string, proximity_code: string }} card
 * @param {{ id: string, full_name: string, status: string } | undefined} employee
 *   - whoever currently holds this card, if anyone (an unassigned card can still be revoked).
 * @returns {Promise<{ confirmed: boolean, employeeStatus?: string, error?: { message: string } }>}
 */
export function openRevokeCardModal(card, employee) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <h3>Revoke proximity card</h3>
      <p class="sub" style="margin:-4px 0 14px;">
        ${employee
          ? `Revoking <span class="mono">${esc(card.proximity_code)}</span>, currently assigned to <strong>${esc(employee.full_name)}</strong>. The selected status will update Employee Manager and be recorded as a remark.`
          : `Revoking <span class="mono">${esc(card.proximity_code)}</span>. It isn't assigned to anyone, so only the additional remarks will be saved on the card.`}
      </p>
      ${employee ? `
        <div class="field">
          <label>Employee status</label>
          <select id="rv-status">
            ${EMPLOYEE_STATUSES.map((status) => `<option value="${status}" ${employee.status === status ? 'selected' : ''}>${status}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      <div class="field">
        <label>Additional remarks (optional)</label>
        <textarea id="rv-reason" rows="3" placeholder="e.g. Lost card, damaged card, or other context…"></textarea>
      </div>
      <div class="actions">
        <button class="ghost" id="rv-cancel">Cancel</button>
        <button class="danger" id="rv-ok">Revoke</button>
      </div>
    `, { maxWidth: '440px' });

    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; resolve(result); };

    $('#rv-cancel', overlay).addEventListener('click', () => { finish({ confirmed: false }); closeModal(overlay); });
    $('#rv-ok', overlay).addEventListener('click', async () => {
      const employeeStatus = employee ? $('#rv-status', overlay).value : null;
      const additionalRemarks = $('#rv-reason', overlay).value.trim() || null;
      const okBtn = $('#rv-ok', overlay);
      okBtn.disabled = true;
      okBtn.textContent = 'Revoking…';
      setModalLocked(overlay, true); // no partial-revoke to recover from mid-flight

      const { error } = await ProximityCardsModel.revoke(card.id, employeeStatus, additionalRemarks);
      finish({ confirmed: !error, employeeStatus, error });
      closeModal(overlay);
    });
  });
}
