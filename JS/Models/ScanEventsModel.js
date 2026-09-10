// The live activity feed and the scan_proximity_code RPC that both the
// in-shell Scanner page and the standalone scanner tab call.
import { supabase } from '../Core/supabaseClient.js';

export const ScanEventsModel = {
  async recentFeed(limit = 25) {
    // get_scan_feed() is SECURITY DEFINER so the employee join always
    // resolves regardless of the caller's RLS scope (see scan_proximity_code
    // below) — querying the old `scan_feed` view directly as the caller
    // meant scanner-only accounts saw every matched scan's employee_name
    // come back null, since RLS on `employees` silently dropped the joined
    // row for them.
    return supabase.rpc('get_scan_feed', { p_limit: limit });
  },

  async scan(proximity_code, scanner_id) {
    return supabase.rpc('scan_proximity_code', { p_proximity_code: proximity_code, p_scanner_id: scanner_id });
  },

  // Same matching logic and permission gate as scan(), but never inserts
  // into scan_events — no Recent Activity entry, no scan_logs on the
  // employee, no change to Employee Manager's "Scans" count.
  async testScan(proximity_code) {
    return supabase.rpc('test_scan_proximity_code', { p_proximity_code: proximity_code });
  },
};
