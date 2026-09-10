// The live activity feed and the scan_proximity_code RPC that both the
// in-shell Scanner page and the standalone scanner tab call.
import { supabase } from '../Core/supabaseClient.js';

export const ScanEventsModel = {
  async recentFeed(limit = 25) {
    return supabase.from('scan_feed').select('*').limit(limit);
  },

  async scan(proximity_code, scanner_id) {
    return supabase.rpc('scan_proximity_code', { p_proximity_code: proximity_code, p_scanner_id: scanner_id });
  },
};
