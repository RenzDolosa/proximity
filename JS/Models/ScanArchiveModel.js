// Read-only(ish) wrapper around get_scan_archive_status()/archive_old_scan_events()
// — both RPCs raise an exception for a non-admin caller (is_admin() check
// in the function body; archive_old_scan_events() only enforces that when
// there's an actual caller to check, since the same function is also
// called by pg_cron on a schedule with no auth context at all — see
// Supabase/README.md), but SettingsPage.js's "Scan data archival" panel
// also self-guards with isAdmin() before ever calling these, same as
// every other admin-only page in this app (see AuditLogPage.js).
import { supabase } from '../Core/supabaseClient.js';

export const ScanArchiveModel = {
  async status() {
    return supabase.rpc('get_scan_archive_status');
  },
  // p_older_than_days: floored at 90 server-side regardless of what's
  // passed, so an admin's manual run here can never reach into data that
  // get_scanner_performance_stats()/get_scanner_scan_details() (both
  // capped at 90 days) might still need.
  async runNow(olderThanDays = 180) {
    return supabase.rpc('archive_old_scan_events', { p_older_than_days: olderThanDays });
  },
};
