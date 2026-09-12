// Revoking a card now asks why, and — when the card is actually assigned
// to someone — records that reason as a remark on their Employee Manager
// profile (via the same add_employee_remark() RPC the Remarks modal uses),
// so the "why was this person's access pulled" story lives in one place
// instead of just a bare revoked_at timestamp with no context.
import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { openModal, closeModal, setModalLocked } from './Modal.js';
import { ProximityCardsModel } from '../Models/ProximityCardsModel.js';
import { EmployeesModel } from '../Models/EmployeesModel.js';

/**
 * @param {{ id: string, proximity_code: string }} card
 * @param {{ id: string, full_name: string } | undefined} employee - whoever
 *   currently holds this card, if anyone (an unassigned card can still be revoked).
 * @returns {Promise<{ confirmed: boolean, error?: { message: string } }>}
 */
export function openRevokeCardModal(card, employee) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <h3>Revoke proximity card</h3>
      <p class="sub" style="margin:-4px 0 14px;">
        ${employee
          ? `Revoking <span class="mono">${esc(card.proximity_code)}</span>, currently assigned to <strong>${esc(employee.full_name)}</strong>. The reason below is saved as a remark on their profile.`
          : `Revoking <span class="mono">${esc(card.proximity_code)}</span>. It isn't assigned to anyone, so there's no employee profile to attach a remark to.`}
      </p>
      <div class="field">
        <label>Reason${employee ? '' : ' (optional)'}</label>
        <textarea id="rv-reason" rows="3" placeholder="e.g. Lost card, employee offboarded, card damaged…"></textarea>
      </div>
      <div class="auth-error hidden" id="rv-error"></div>
      <div class="actions">
        <button class="ghost" id="rv-cancel">Cancel</button>
        <button class="danger" id="rv-ok">Revoke</button>
      </div>
    `, { maxWidth: '440px' });

    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; resolve(result); };

    $('#rv-cancel', overlay).addEventListener('click', () => { finish({ confirmed: false }); closeModal(overlay); });
    $('#rv-ok', overlay).addEventListener('click', async () => {
      const reason = $('#rv-reason', overlay).value.trim();
      if (employee && !reason) {
        const errEl = $('#rv-error', overlay);
        errEl.textContent = 'A reason is required when the card is assigned to someone.';
        errEl.classList.remove('hidden');
        return;
      }
      const okBtn = $('#rv-ok', overlay);
      okBtn.disabled = true;
      okBtn.textContent = 'Revoking…';
      setModalLocked(overlay, true); // no partial-revoke to recover from mid-flight

      const { error } = await ProximityCardsModel.revoke(card.id);
      if (!error && employee && reason) {
        // Best-effort: the card is already revoked either way. A failure
        // here (extremely unlikely given the permission check above
        // already matches what let them revoke in the first place)
        // shouldn't make the revoke itself look like it failed.
        // Note: the reason is stored without the card's proximity_code —
        // this remark can later surface on the Scanner's result card (see
        // ScanResultCard.js) as an "unresolved remark" flag, and that
        // screen is watched at a physical door, so a raw code has no
        // business ending up there.
        await EmployeesModel.addRemark(employee.id, `Proximity card revoked: ${reason}`);
      }
      finish({ confirmed: !error, error });
      closeModal(overlay);
    });
  });
}
