// Read-only(ish) wrapper around get_scan_logs_trim_status()/
// trim_employee_scan_logs() — both RPCs raise for a non-admin caller
// (is_admin() check in the function body; trim_employee_scan_logs() only
// enforces that when there's an actual caller to check, since the same
// function is also called by pg_cron on a schedule with no auth context at
// all — see Supabase/README.md), but SettingsPage.js's "Scan log trimming"
// panel also self-guards with isAdmin() before ever calling these, same as
// the Scan data archival panel right above it.
import { supabase } from '../Core/supabaseClient.js';

export const ScanLogsTrimModel = {
  async status() {
    return supabase.rpc('get_scan_logs_trim_status');
  },
  // p_older_than_days: floored at 90 server-side regardless of what's
  // passed, so an admin's manual run here can never reach into entries
  // get_attendance_report() (capped at 31 days) might still need.
  async runNow(olderThanDays = 180) {
    return supabase.rpc('trim_employee_scan_logs', { p_older_than_days: olderThanDays });
  },
};
