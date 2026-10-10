import { $ } from '../Utils/dom.js';
import { esc } from '../Utils/format.js';
import { toast } from '../Utils/toast.js';
import { openModal, closeModal, showModalError } from './Modal.js';
import { ProfilesModel } from '../Models/ProfilesModel.js';
import { scopeOptions, roleOptions } from '../Features/Users/userOptions.js';

import { withHint } from './Hint.js';
import { openResetPasswordModal } from './ResetPasswordModal.js';

// One sentence per access level, shown on hover so it is not permanently
// competing with the two dropdowns above it.
const ACCESS_HINT = 'Access decides which sections this login can open: the whole app, '
  + 'Employee Manager and Proximity Cards only, or the Scanner only. It also decides which '
  + 'Settings panels appear. Admins always have full access whatever this says.';
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
      <div class="field"><label>Access</label>
        ${withHint(`<select id="u-scope">${scopeOptions(user?.access_scope || 'all')}</select>`, ACCESS_HINT)}
      </div>
    </div>
    <div class="auth-error hidden" id="u-error"></div>
    <div class="progress hidden" id="u-progress" style="margin:10px 0 0;">
      <div class="progress-track"><div class="progress-fill indeterminate"></div></div>
    </div>
    <div class="actions">
      ${isEdit ? '<button class="ghost" id="u-reset-pw" style="margin-right:auto;">Reset password</button>' : ''}
      <button class="ghost" id="u-cancel">Cancel</button>
      <button class="primary" id="u-save">${isEdit ? 'Save changes' : 'Create account'}</button>
    </div>
  `);

  // Resetting a password is something you decide while already looking at the
  // account, so it belongs here as well as in the row. Closes this modal
  // first: two stacked dialogs sharing one overlay stack is how the "stale
  // modal" guards in Modal.js got written in the first place.
  $('#u-reset-pw', overlay)?.addEventListener('click', () => {
    closeModal(overlay);
    openResetPasswordModal(user);
  });

  const progressEl = $('#u-progress', overlay);
  const saveBtn = $('#u-save', overlay);
  const cancelBtn = $('#u-cancel', overlay);

  cancelBtn.addEventListener('click', () => closeModal(overlay));
  saveBtn.addEventListener('click', async () => {
    $('#u-error', overlay).classList.add('hidden');
    const full_name = $('#u-name', overlay).value.trim();
    const email = $('#u-email', overlay).value.trim();
    const role = $('#u-role', overlay).value;
    const access_scope = $('#u-scope', overlay).value;
    if (!full_name || !email) { showModalError(overlay, '#u-error', 'Full name and email are required.'); return; }

    let password;
    if (!isEdit) {
      password = $('#u-password', overlay).value;
      if (!password || password.length < 6) { showModalError(overlay, '#u-error', 'Password must be at least 6 characters.'); return; }
    }

    // admin-users is a single request/response with no byte-level
    // progress to report (unlike the photo upload's XHR-based bar) — an
    // indeterminate bar is what tells the user "this is in flight" for
    // that shape of request, same as a scan sound upload's progress bar.
    progressEl.classList.remove('hidden');
    saveBtn.disabled = true;
    cancelBtn.disabled = true;

    let result;
    if (isEdit) {
      result = await ProfilesModel.callAdminUsers('update', { user_id: user.id, full_name, email, role, access_scope });
    } else {
      result = await ProfilesModel.callAdminUsers('create', { full_name, email, password, role, access_scope });
    }

    progressEl.classList.add('hidden');
    saveBtn.disabled = false;
    cancelBtn.disabled = false;

    if (result.error) { showModalError(overlay, '#u-error', result.error); return; }
    closeModal(overlay);
    toast(isEdit ? 'User updated' : 'User created');
    onSaved?.();
  });
}
