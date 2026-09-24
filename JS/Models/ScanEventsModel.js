// The live activity feed and the scan_proximity_code RPC that both the
// in-shell Scanner page and the standalone scanner tab call.
import { supabase } from '../Core/supabaseClient.js';

export const ScanEventsModel = {
  // scannerId, when passed, scopes the feed to scans made by that operator
  // only (scanner_id doubles as the operator name — see scan() below). The
  // standalone kiosk uses this so "Recent activity" only shows the signed-in
  // operator's own scans, not every operator's system-wide.
  async recentFeed(limit = 10, scannerId = null) {
    // get_scan_feed() is SECURITY DEFINER so the employee join always
    // resolves regardless of the caller's RLS scope (see scan_proximity_code
    // below) — querying the old `scan_feed` view directly as the caller
    // meant scanner-only accounts saw every matched scan's employee_name
    // come back null, since RLS on `employees` silently dropped the joined
    // row for them.
    return supabase.rpc('get_scan_feed', { p_limit: limit, p_scanner_id: scannerId });
  },

  async scan(proximity_code, scanner_id) {
    return supabase.rpc('scan_proximity_code', { p_proximity_code: proximity_code, p_scanner_id: scanner_id });
  },

  // Backs Employee Manager's "Export all scan logs" button — the full
  // scan_events history (matched and unmatched), not any one employee's
  // scan_logs. Deliberately a separate RPC from recentFeed() above rather
  // than that one with a huge p_limit — get_all_scan_events() has its own
  // is_admin_or_manager() gate (a full-org export is a materially more
  // sensitive capability than the live "recent activity" feed
  // recentFeed() backs, which scanner-only kiosk accounts also need to
  // read) — see Supabase/README.md's RPC section.
  // from/to are optional ISO timestamps (either end omittable) that map
  // straight onto get_all_scan_events()'s p_from/p_to — the RPC does the
  // date filtering server-side rather than pulling the full history down
  // and filtering client-side, so a narrow range on a large scan_events
  // table doesn't round-trip rows the caller is just going to discard.
  async listAll({ from = null, to = null } = {}) {
    return supabase.rpc('get_all_scan_events', { p_from: from, p_to: to });
  },

  // Same matching logic and permission gate as scan(), but never inserts
  // into scan_events — no Recent Activity entry, no scan_logs on the
  // employee, no change to Employee Manager's "Scans" count.
  async testScan(proximity_code) {
    return supabase.rpc('test_scan_proximity_code', { p_proximity_code: proximity_code });
  },
};
