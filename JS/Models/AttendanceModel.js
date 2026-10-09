// Read-only wrapper around get_attendance_report(). Same "the RPC is the
// real gate" pattern as AuditLogModel.js/ScannerStatsModel.js: the function
// raises for a caller that fails is_admin_or_manager(), and validates the
// range (max 31 days) and time zone itself — AttendancePage.js's own
// canViewAttendance()/validateRange() checks are conveniences, not the
// boundary.
import { supabase } from '../Core/supabaseClient.js';

// The browser's own zone, so "which day is this shift on" matches the
// calendar the person reading the report actually lives in. If the runtime
// can't report one, p_tz is omitted and the RPC's own default applies.
function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

export const AttendanceModel = {
  // One page of rows. Paging and filtering are the SERVER's job: the browser
  // used to download 1000 rows (PostgREST's cap, not the report's size) and
  // display 50 of them, which both hid the other 2,382 employee-days and paid
  // for rows nobody looked at. Now it fetches what it shows.
  async report({ from, to, limit, offset, query, department, status }) {
    return supabase.rpc('get_attendance_report', {
      ...rangeArgs(from, to),
      p_limit: limit,
      p_offset: offset,
      ...filterArgs({ query, department, status }),
    });
  },

  // Totals for the same filtered set, uncapped — this is what the stat cards
  // and the pagination count against. One row, ~150 bytes.
  async summary({ from, to, query, department, status }) {
    return supabase.rpc('get_attendance_summary', {
      ...rangeArgs(from, to),
      ...filterArgs({ query, department, status }),
    });
  },

  // Every department in the range, so the dropdown does not depend on which
  // page happens to be loaded. A handful of short strings.
  async departments({ from, to }) {
    return supabase.rpc('get_attendance_departments', rangeArgs(from, to));
  },
};

function rangeArgs(from, to) {
  const args = { p_from: from, p_to: to };
  const tz = browserTimeZone();
  if (tz) args.p_tz = tz;
  return args;
}

// Empty string and null mean the same thing to the RPC ("no filter"); send
// null so an empty search box cannot be mistaken for a search for ''.
function filterArgs({ query, department, status }) {
  return {
    p_query: query || null,
    p_department: department || null,
    p_status: status || null,
  };
}
