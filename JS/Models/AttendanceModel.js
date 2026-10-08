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
  // from/to: inclusive 'YYYY-MM-DD' strings.
  async report({ from, to }) {
    return supabase.rpc('get_attendance_report', rangeArgs(from, to));
  },

  // One row of true, uncapped totals for the same range. The rows above are
  // truncated by PostgREST's db-max-rows (1000) long before the RPC's own
  // 25000 limit, so headline numbers derived from them understate a busy
  // range — measured 1,000 against a real 3,385. ~150 bytes, once per run.
  async summary({ from, to }) {
    return supabase.rpc('get_attendance_summary', rangeArgs(from, to));
  },
};

function rangeArgs(from, to) {
  const args = { p_from: from, p_to: to };
  const tz = browserTimeZone();
  if (tz) args.p_tz = tz;
  return args;
}
