// A proper in-app confirmation dialog for destructive actions (Delete all,
// etc.), instead of the browser's own confirm() — consistent styling with
// the rest of the app, and doesn't get silently auto-dismissed the way
// some browsers/extensions treat native dialogs. Built on the same
// openModal/closeModal scaffold every other dialog uses.
import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { openModal, closeModal, onModalClose, setModalLocked } from './Modal.js';

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

/**
 * Same confirm step as openConfirmModal, but on confirm the dialog stays
 * open and morphs into a progress bar while `task` runs, then closes
 * itself. `task` gets an onProgress(done, total) callback to call as it
 * goes — for a single-request operation, just call it once at the end
 * (or not at all, and the bar still shows something moved).
 * @returns {Promise<{confirmed:boolean, result?:any}>}
 */
export function openConfirmProgressModal({ title, message, confirmLabel = 'Delete', task }) {
  return new Promise((resolve) => {
    const overlay = openModal(`
      <h3>${esc(title)}</h3>
      <div id="cp-body">
        <p class="sub" style="margin:-4px 0 18px;">${esc(message)}</p>
        <div class="actions">
          <button class="ghost" id="cp-cancel">Cancel</button>
          <button class="danger" id="cp-ok">${esc(confirmLabel)}</button>
        </div>
      </div>
    `, { maxWidth: '420px' });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    onModalClose(() => finish({ confirmed: false }));
    $('#cp-cancel', overlay).addEventListener('click', () => { finish({ confirmed: false }); closeModal(overlay); });
    $('#cp-ok', overlay).addEventListener('click', async () => {
      $('#cp-body', overlay).innerHTML = `
        <div class="progress">
          <div class="progress-label" id="cp-progress-label">Working…</div>
          <div class="progress-track"><div class="progress-fill" id="cp-progress-fill"></div></div>
        </div>
      `;
      setModalLocked(overlay, true);
      const onProgress = (done, total) => {
        const fillEl = $('#cp-progress-fill', overlay);
        const labelEl = $('#cp-progress-label', overlay);
        if (fillEl) fillEl.style.width = `${total ? Math.min(100, Math.round((done / total) * 100)) : 100}%`;
        if (labelEl) labelEl.textContent = total > 1 ? `${done} / ${total}` : 'Working…';
      };
      let result;
      try {
        result = await task(onProgress);
      } finally {
        finish({ confirmed: true, result });
        closeModal(overlay);
      }
    });
  });
}
