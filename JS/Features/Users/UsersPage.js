import { $, $$ } from '../../Utils/dom.js';
import { esc } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { isAdmin, appState } from '../../Core/state.js';
import { ProfilesModel } from '../../Models/ProfilesModel.js';
import { openUserModal } from '../../Components/UserModal.js';
import { openResetPasswordModal } from '../../Components/ResetPasswordModal.js';
import { openConfirmModal } from '../../Components/ConfirmModal.js';
import { renderPagination } from '../../Components/Pagination.js';
import { scopeLabel } from './userOptions.js';

let usersCache = [];
let page = 1;
let pageSize = 20;
let loaded = false; // distinguishes "never fetched yet" from "fetched, zero rows"

export async function renderUsers() {
  const content = $('#content');
  if (!isAdmin()) { content.innerHTML = `<div class="empty-state">Admins only.</div>`; return; }
  content.innerHTML = `
    <div class="toolbar">
      <div></div>
      <button class="primary" id="user-add">+ Add user</button>
    </div>
    <div class="table-scroll"><div id="users-table-wrap">${loaded ? '' : 'Loading…'}</div></div>
    <div id="users-pagination"></div>
  `;
  $('#user-add').addEventListener('click', () => openUserModal(null, renderUsers));

  // Stale-while-revalidate: paint from cache immediately (no "Loading…"
  // flash) while the fresh fetch runs, if we've already loaded once.
  if (loaded) paintUsersTable();

  const { data, error } = await ProfilesModel.listUsers();
  const wrap = $('#users-table-wrap');
  if (error) { wrap.innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  usersCache = data || [];
  loaded = true;
  page = 1;
  paintUsersTable();
}

function paintUsersTable() {
  const wrap = $('#users-table-wrap');
  const data = usersCache;
  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  page = Math.min(Math.max(1, page), totalPages);
  const rows = data.slice((page - 1) * pageSize, page * pageSize);
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th class="col-shrink">Role</th><th class="col-shrink">Access</th><th class="col-shrink">Account</th><th class="col-shrink"></th></tr></thead>
      <tbody>
        ${rows.map((u) => `
          <tr>
            <td>${esc(u.full_name)}</td>
            <td class="mono">${esc(u.email)}</td>
            <td class="col-shrink"><span class="badge role-${u.role}">${esc(u.role)}</span></td>
            <td class="col-shrink">${esc(scopeLabel[u.access_scope] || u.access_scope)}</td>
            <td class="col-shrink"><span class="badge ${u.is_active ? 'active' : 'inactive'}">${u.is_active ? 'active' : 'disabled'}</span></td>
            <td class="col-shrink"><div class="row-actions">
              <button class="ghost" data-edit="${u.id}">Edit</button>
              <button class="ghost" data-pw="${u.id}">Reset password</button>
              <button class="ghost" data-toggle="${u.id}" ${u.id === appState.session.user.id ? 'disabled' : ''}>${u.is_active ? 'Disable' : 'Enable'}</button>
              <button class="ghost danger" data-delete="${u.id}" ${u.id === appState.session.user.id ? 'disabled' : ''}>Delete</button>
            </div></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  renderPagination($('#users-pagination'), {
    total: data.length, page, pageSize,
    onChange: (next) => { page = next.page; pageSize = next.pageSize; paintUsersTable(); },
  });
  $$('button[data-edit]', wrap).forEach((b) => b.addEventListener('click', () => {
    openUserModal(data.find((u) => u.id === b.dataset.edit), renderUsers);
  }));
  $$('button[data-pw]', wrap).forEach((b) => b.addEventListener('click', () => {
    openResetPasswordModal(data.find((u) => u.id === b.dataset.pw));
  }));
  $$('button[data-toggle]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const row = data.find((u) => u.id === b.dataset.toggle);
    const { error } = await ProfilesModel.toggleActive(row.id, !row.is_active);
    if (error) { toast(error.message, 'error'); return; }
    row.is_active = !row.is_active;
    toast('Account updated');
    paintUsersTable();
  }));
  // Delete is gated three ways: the whole Users & Roles page already checks
  // isAdmin() above, this button is disabled for the caller's own account,
  // and the admin-users Edge Function re-checks the caller's role and
  // rejects self-deletion server-side regardless of what the client sends.
  $$('button[data-delete]', wrap).forEach((b) => b.addEventListener('click', async () => {
    const row = data.find((u) => u.id === b.dataset.delete);
    const ok = await openConfirmModal({
      title: 'Delete this account?',
      message: `Permanently delete ${row.full_name}'s account (${row.email})? This can't be undone.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const { error } = await ProfilesModel.deleteUser(row.id);
    if (error) { toast(error, 'error'); return; }
    usersCache = usersCache.filter((u) => u.id !== row.id);
    toast('Account deleted');
    paintUsersTable();
  }));
}
