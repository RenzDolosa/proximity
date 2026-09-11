import { $, $$ } from '../../Utils/dom.js';
import { esc } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { isAdmin, appState } from '../../Core/state.js';
import { ProfilesModel } from '../../Models/ProfilesModel.js';
import { openUserModal } from '../../Components/UserModal.js';
import { openResetPasswordModal } from '../../Components/ResetPasswordModal.js';
import { scopeLabel } from './userOptions.js';

export async function renderUsers() {
  const content = $('#content');
  if (!isAdmin()) { content.innerHTML = `<div class="empty-state">Admins only.</div>`; return; }
  content.innerHTML = `
    <div class="toolbar">
      <div></div>
      <button class="primary" id="user-add">+ Add user</button>
    </div>
    <div id="users-table-wrap">Loading…</div>
  `;
  $('#user-add').addEventListener('click', () => openUserModal(null, renderUsers));
  const { data, error } = await ProfilesModel.listUsers();
  const wrap = $('#users-table-wrap');
  if (error) { wrap.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Account</th><th class="col-shrink"></th></tr></thead>
      <tbody>
        ${data.map((u) => `
          <tr>
            <td>${esc(u.full_name)}</td>
            <td class="mono">${esc(u.email)}</td>
            <td><span class="badge role-${u.role}">${esc(u.role)}</span></td>
            <td>${esc(scopeLabel[u.access_scope] || u.access_scope)}</td>
            <td><span class="badge ${u.is_active ? 'active' : 'inactive'}">${u.is_active ? 'active' : 'disabled'}</span></td>
            <td class="row-actions col-shrink">
              <button class="ghost" data-edit="${u.id}">Edit</button>
              <button class="ghost" data-pw="${u.id}">Reset password</button>
              <button class="ghost" data-toggle="${u.id}" ${u.id === appState.session.user.id ? 'disabled' : ''}>${u.is_active ? 'Disable' : 'Enable'}</button>
              <button class="ghost danger" data-delete="${u.id}" ${u.id === appState.session.user.id ? 'disabled' : ''}>Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  $$('button[data-edit]', wrap).forEach((b) => b.addEventListener('click', () => {
    openUserModal(data.find((u) => u.id === b.dataset.edit), renderUsers);
  }));
  $$('button[data-pw]', wrap).forEach((b) => b.addEventListener('click', () => {
    openResetPasswordModal(data.find((u) => u.id === b.dataset.pw));
  }));
  $$('button[data-toggle]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const row = data.find((u) => u.id === b.dataset.toggle);
    const { error } = await ProfilesModel.toggleActive(row.id, !row.is_active);
    if (error) toast(error.message, 'error'); else { toast('Account updated'); renderUsers(); }
  }));
  // Delete is gated three ways: the whole Users & Roles page already checks
  // isAdmin() above, this button is disabled for the caller's own account,
  // and the admin-users Edge Function re-checks the caller's role and
  // rejects self-deletion server-side regardless of what the client sends.
  $$('button[data-delete]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const row = data.find((u) => u.id === b.dataset.delete);
    if (!confirm(`Permanently delete ${row.full_name}'s account (${row.email})? This can't be undone.`)) return;
    const { error } = await ProfilesModel.deleteUser(row.id);
    if (error) toast(error, 'error'); else { toast('Account deleted'); renderUsers(); }
  }));
}
