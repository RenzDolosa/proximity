// Wrapper around the alerts RPCs (get_alerts, get_unread_alert_count,
// acknowledge_alert, acknowledge_all_alerts). All four re-check
// is_admin_or_manager() server-side; acknowledging is idempotent.
import { supabase } from '../Core/supabaseClient.js';

export const AlertsModel = {
  // get_alerts returns one jsonb array; limit is clamped to 1..500 server-side.
  async list({ limit = 100, includeAcknowledged = false } = {}) {
    return supabase.rpc('get_alerts', {
      p_limit: Math.max(1, Math.min(500, limit || 100)),
      p_include_acknowledged: !!includeAcknowledged,
    });
  },
  async unreadCount() {
    return supabase.rpc('get_unread_alert_count');
  },
  async acknowledge(id) {
    return supabase.rpc('acknowledge_alert', { p_id: id });
  },
  async acknowledgeAll() {
    return supabase.rpc('acknowledge_all_alerts');
  },
};
