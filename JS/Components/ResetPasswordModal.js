import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { openModal, closeModal, showModalError } from './Modal.js';
import { ProfilesModel } from '../Models/ProfilesModel.js';

export function openResetPasswordModal(user) {
  const overlay = openModal(`
    <h3>Reset password — ${esc(user.full_name)}</h3>
    <div class="field"><label>New password</label><input id="pw-new" type="password" placeholder="min. 6 characters" /></div>
    <div class="auth-error hidden" id="pw-error"></div>
    <div class="actions">
      <button class="ghost" id="pw-cancel">Cancel</button>
      <button class="primary" id="pw-save">Set new password</button>
    </div>
  `);

  $('#pw-cancel', overlay).addEventListener('click', () => closeModal(overlay));
  $('#pw-save', overlay).addEventListener('click', async () => {
    const password = $('#pw-new', overlay).value;
    if (!password || password.length < 6) { showModalError(overlay, '#pw-error', 'Password must be at least 6 characters.'); return; }
    const result = await ProfilesModel.callAdminUsers('reset_password', { user_id: user.id, password });
    if (result.error) { showModalError(overlay, '#pw-error', result.error); return; }
    closeModal(overlay);
    toast('Password updated');
  });
}
