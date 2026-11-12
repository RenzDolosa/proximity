// One line per dialog: "do not throw this away on a stray click".
//
// Lives apart from Modal.js because asking the question needs
// ConfirmModal, and ConfirmModal is itself built on Modal.js — importing it
// there would be a cycle. Modal.js takes a predicate and knows nothing about
// what it asks.
import { setCloseGuard } from './Modal.js';
import { openConfirmModal } from './ConfirmModal.js';
import { watchFields } from '../Utils/formDirty.js';

/**
 * Guard a dialog's backdrop against discarding unsaved edits.
 *
 * Call immediately after openModal(), once the fields are in the DOM — the
 * snapshot is taken now, so anything rendered afterwards would read as a
 * change the moment it appeared.
 *
 * @param {HTMLElement} overlay
 * @param {{ noun?: string }} [opts] what is being edited, for the question
 */
export function guardUnsaved(overlay, { noun = 'changes' } = {}) {
  const changed = watchFields(overlay);
  setCloseGuard(overlay, async () => {
    // Nothing typed: close exactly as before. The overwhelmingly common
    // case is opening a dialog to look at something, and that must not
    // acquire a confirmation step.
    if (!changed()) return true;
    return openConfirmModal({
      title: 'Discard your changes?',
      message: `This dialog has unsaved ${noun}. Closing it now loses them.`,
      confirmLabel: 'Discard',
    });
  });
}
