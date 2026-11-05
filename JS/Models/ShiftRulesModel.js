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

  // department null/'' sets the default. Times are 'HH:MM' from an
  // <input type="time">, which Postgres accepts directly as a `time`.
  //
  // The three optional fields are independent switches, and null means "not
  // set" rather than zero for every one of them:
  //   endsAt         — enables nothing by itself; required by the margin
  //   expectedMinutes — enables the overtime figures on Attendance
  //   afterHoursMarginMinutes — enables after-hours ALERTS, and only this
  //
  // Sending 0 for any of them would be a configured value, which is why each
  // is coerced to null when blank rather than through Number().
  async set(department, startsAt, graceMinutes = 0, {
    endsAt = null, expectedMinutes = null, afterHoursMarginMinutes = null,
  } = {}) {
    return supabase.rpc('set_shift_rule', {
      p_department: department || null,
      p_starts_at: startsAt,
      p_grace_minutes: Number(graceMinutes) || 0,
      p_ends_at: endsAt || null,
      p_expected_minutes: blankToNull(expectedMinutes),
      p_after_hours_margin_minutes: blankToNull(afterHoursMarginMinutes),
    });
  },

  async remove(department) {
    return supabase.rpc('delete_shift_rule', { p_department: department || null });
  },
};

// Number('') is 0 and Number(null) is 0, either of which would silently turn
// an empty input into a configured value — the exact coercion trap that put a
// 0% progress bar on screen on 2026-11-03.
function blankToNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
