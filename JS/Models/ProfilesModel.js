// Login accounts (`profiles`) + the admin-only account-management actions
// that must go through the `admin-users` Edge Function (service-role only
// operations: create, update email, reset password).
import { supabase } from '../Core/supabaseClient.js';
import { createModel } from './BaseModel.js';

const base = createModel('profiles');

export const ProfilesModel = {
  ...base,

  async listUsers() {
    return supabase.from('profiles').select('*').order('created_at');
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

  // Permanently deletes the login account (auth.users row, which cascades
  // to the profiles row). Server-side action, admin-only — enforced by the
  // admin-users function itself, not just by hiding the button here.
  async deleteUser(user_id) {
    return this.callAdminUsers('delete', { user_id });
  },
};
