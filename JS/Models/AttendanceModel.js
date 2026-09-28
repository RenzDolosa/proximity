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
    const args = { p_from: from, p_to: to };
    const tz = browserTimeZone();
    if (tz) args.p_tz = tz;
    return supabase.rpc('get_attendance_report', args);
  },
};
