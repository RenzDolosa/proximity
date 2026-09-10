import { $ } from '../Utils/dom.js';
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
