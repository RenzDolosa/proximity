import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { openModal, closeModal, showModalError } from './Modal.js';
import { ProfilesModel } from '../Models/ProfilesModel.js';
import { scopeOptions, roleOptions } from '../Features/Users/userOptions.js';

export function openUserModal(user, onSaved) {
  const isEdit = !!user;
  const overlay = openModal(`
    <h3>${isEdit ? 'Edit user' : 'Add user'}</h3>
    <div class="field"><label>Full name</label><input id="u-name" value="${esc(user?.full_name || '')}" /></div>
    <div class="field">
      <label>Email</label>
      <input id="u-email" type="email" value="${esc(user?.email || '')}" ${isEdit ? 'disabled' : ''} />
      ${isEdit ? '<p class="sub" style="margin:4px 0 0;">Email can\'t be changed here.</p>' : ''}
    </div>
    ${!isEdit ? `<div class="field"><label>Password</label><input id="u-password" type="password" placeholder="min. 6 characters" /></div>` : ''}
    <div class="grid-2">
      <div class="field"><label>Role</label><select id="u-role">${roleOptions(user?.role || 'viewer')}</select></div>
      <div class="field"><label>Access</label><select id="u-scope">${scopeOptions(user?.access_scope || 'all')}</select></div>
    </div>
    <p class="sub" style="margin-top:-6px;">Access controls which sections this login can open: the full app, Employee Manager + Proximity Cards only, or the Scanner only. Admins always get full access.</p>
    <div class="auth-error hidden" id="u-error"></div>
    <div class="actions">
      <button class="ghost" id="u-cancel">Cancel</button>
      <button class="primary" id="u-save">${isEdit ? 'Save changes' : 'Create account'}</button>
    </div>
  `);

  $('#u-cancel', overlay).addEventListener('click', () => closeModal(overlay));
  $('#u-save', overlay).addEventListener('click', async () => {
    $('#u-error', overlay).classList.add('hidden');
    const full_name = $('#u-name', overlay).value.trim();
    const email = $('#u-email', overlay).value.trim();
    const role = $('#u-role', overlay).value;
    const access_scope = $('#u-scope', overlay).value;
    if (!full_name || !email) { showModalError(overlay, '#u-error', 'Full name and email are required.'); return; }

    let result;
    if (isEdit) {
      result = await ProfilesModel.callAdminUsers('update', { user_id: user.id, full_name, email, role, access_scope });
    } else {
      const password = $('#u-password', overlay).value;
      if (!password || password.length < 6) { showModalError(overlay, '#u-error', 'Password must be at least 6 characters.'); return; }
      result = await ProfilesModel.callAdminUsers('create', { full_name, email, password, role, access_scope });
    }
    if (result.error) { showModalError(overlay, '#u-error', result.error); return; }
    closeModal(overlay);
    toast(isEdit ? 'User updated' : 'User created');
    onSaved?.();
  });
}
