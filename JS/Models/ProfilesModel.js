// Login accounts (`profiles`) + the admin-only account-management actions
// that must go through the `admin-users` Edge Function (service-role only
// operations: create, update email, reset password).
import { supabase } from '../Core/supabaseClient.js';
import { createModel } from './BaseModel.js';
import { fetchAllRows } from '../Utils/fetchAllRows.js';

const base = createModel('profiles');

export const ProfilesModel = {
  ...base,

  async listUsers() {
    // Pages through past Supabase's default 1000-row-per-request cap —
    // see Utils/fetchAllRows.js. Users & Roles is a small table in
    // practice, but this keeps it correct if that ever changes.
    return fetchAllRows((from, to) =>
      supabase.from('profiles').select('*').order('created_at').range(from, to)
    );
  },

  async toggleActive(id, isActive) {
    return supabase.from('profiles').update({ is_active: isActive }).eq('id', id);
  },

  // Wraps supabase.functions.invoke('admin-users', ...) with the caller's
  // own JWT — the function re-checks admin status server-side before
  // touching anything.
  async callAdminUsers(action, payload) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session.access_token;
    const { data, error } = await supabase.functions.invoke('admin-users', {
      body: { action, ...payload },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (error) return { error: error.message || 'Request failed' };
    if (data?.error) return { error: data.error };
    return { data };
  },

  // Self-service password change for the CURRENTLY signed-in account —
  // distinct from callAdminUsers('reset_password', ...) above, which is
  // an admin setting someone ELSE's password via the service-role
  // Edge Function. This never touches that function: supabase.auth
  // .updateUser() already works for a user changing their own password
  // from a valid session, no service-role privileges needed.
  //
  // Re-authenticates with the current password FIRST, via a second
  // signInWithPassword call, before calling updateUser — Supabase's
  // updateUser() itself doesn't require or check the current password at
  // all (a valid session is the only thing it checks), so skipping this
  // would let anyone at an unattended, already-logged-in session (a
  // shared kiosk left open, in particular — the exact device class this
  // app runs on) silently lock the real owner out by setting a new
  // password nobody else knows. signInWithPassword failing here means
  // wrong current password, not a session problem — the caller's session
  // is already valid or this function couldn't have been reached.
  async changePassword({ email, currentPassword, newPassword }) {
    const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
    if (reauthError) return { error: 'Current password is incorrect.' };

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: error.message };
    return {};
  },

  // Permanently deletes the login account (auth.users row, which cascades
  // to the profiles row). Server-side action, admin-only — enforced by the
  // admin-users function itself, not just by hiding the button here.
  async deleteUser(user_id) {
    return this.callAdminUsers('delete', { user_id });
  },
};