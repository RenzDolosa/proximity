// A proper in-app confirmation dialog for destructive actions (Delete all,
// etc.), instead of the browser's own confirm() — consistent styling with
// the rest of the app, and doesn't get silently auto-dismissed the way
// some browsers/extensions treat native dialogs. Built on the same
// openModal/closeModal scaffold every other dialog uses.
import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { openModal, closeModal, onModalClose } from './Modal.js';

/**
 * @param {{ title: string, message: string, confirmLabel?: string, cancelLabel?: string }} config
 * @returns {Promise<boolean>} true if the person confirmed, false if they cancelled (including if the modal got torn down by something else opening on top of it).
 */
export function openConfirmModal({ title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <h3>${esc(title)}</h3>
      <p class="sub" style="margin:-4px 0 18px;">${esc(message)}</p>
      <div class="actions">
        <button class="ghost" id="confirm-cancel">${esc(cancelLabel)}</button>
        <button class="danger" id="confirm-ok">${esc(confirmLabel)}</button>
      </div>
    `, { maxWidth: '420px' });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    onModalClose(() => finish(false)); // safety net if something else tears this modal down first
    $('#confirm-cancel', overlay).addEventListener('click', () => { finish(false); closeModal(overlay); });
    $('#confirm-ok', overlay).addEventListener('click', () => { finish(true); closeModal(overlay); });
  });
}
