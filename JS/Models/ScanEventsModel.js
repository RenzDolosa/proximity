// Live activity feed and compact scan RPC wrappers, used by the in-shell Scanner
// page and the standalone kiosk tab.
import { supabase } from '../Core/supabaseClient.js';

export const ScanEventsModel = {
  // scannerId scopes the feed to one operator (scanner_id doubles as the
  // operator name), which is how the kiosk shows only its own scans.
  // The _compact variant omits thumbnails and proximity codes; ScanFeed.js
  // resolves photos from the kiosk's local cache by employee_id.
  async recentFeed(limit = 10, scannerId = null) {
    return supabase.rpc('get_scan_feed_compact', { p_limit: limit, p_scanner_id: scannerId });
  },

  // p_include_photo false: the result card's thumbnail comes from the local
  // photo cache (OfflineScanModel.withCachedPhoto()).
  async scan(proximity_code, scanner_id) {
    return supabase.rpc('scan_proximity_code_compact', {
      p_proximity_code: proximity_code,
      p_scanner_id: scanner_id,
      p_include_photo: false,
    });
  },

  // "Export all scan logs" — full scan_events history. A separate RPC from
  // recentFeed rather than a huge p_limit because a full-org export carries its
  // own is_admin_or_manager() gate, which kiosk accounts must not pass.
  // from/to filter server-side so a narrow range doesn't ship discarded rows.
  async listAll({ from = null, to = null } = {}) {
    return supabase.rpc('get_all_scan_events', { p_from: from, p_to: to });
  },

  // Same matching and gate as scan(), but inserts nothing: no feed entry, no
  // scan_logs, no change to the employee's scan count.
  async testScan(proximity_code) {
    return supabase.rpc('test_scan_proximity_code_compact', { p_proximity_code: proximity_code });
  },
};
