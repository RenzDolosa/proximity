// Wrapper around the shift-rule RPCs (20261104090000). Reading is
// admin-or-manager, writing is admin-only, and both re-check server-side —
// these calls are a convenience, not the boundary.
//
// Nothing here is on a hot path. The punctuality figures on Attendance are
// computed server-side and arrive with the summary that page already fetches,
// so these requests happen only when an admin opens or saves the editor.
import { supabase } from '../Core/supabaseClient.js';

// The sentinel the SQL uses for "every department without its own row". Kept
// here as well so the UI can label that row rather than printing a bare '*'.
export const DEFAULT_DEPARTMENT = '*';

export const ShiftRulesModel = {
  async list() {
    return supabase.rpc('get_shift_rules');
  },

  // department null/'' sets the default. starts_at is 'HH:MM' from an
  // <input type="time">, which Postgres accepts directly as a `time`.
  async set(department, startsAt, graceMinutes = 0) {
    return supabase.rpc('set_shift_rule', {
      p_department: department || null,
      p_starts_at: startsAt,
      p_grace_minutes: Number(graceMinutes) || 0,
    });
  },

  async remove(department) {
    return supabase.rpc('delete_shift_rule', { p_department: department || null });
  },
};
