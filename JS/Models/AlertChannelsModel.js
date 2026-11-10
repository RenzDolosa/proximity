// Where alerts get delivered (Settings → Notifications).
//
// RPCs only, no createModel(): alert_channels holds chat ids and email
// addresses, and 20261110091000 revokes the table from both client roles so
// there is nothing for a `.from()` to reach. Every call below is admin-gated
// again server-side — the panel being admin-only is the convenience, not the
// control.
import { supabase } from '../Core/supabaseClient.js';

export const AlertChannelsModel = {
  async list() {
    return supabase.rpc('get_alert_channels');
  },

  // Upserts on (channel, target, kind) when p_id is omitted, so saving the
  // same chat twice edits the row instead of failing on a unique index.
  async save({ channel, target, kind = null, enabled = true, id = null }) {
    return supabase.rpc('set_alert_channel', {
      p_channel: channel,
      p_target: target,
      p_kind: kind,
      p_enabled: enabled,
      p_id: id,
    });
  },

  async remove(id) {
    return supabase.rpc('delete_alert_channel', { p_id: id });
  },

  // Everyone who has subscribed to the Viber Public Account, captured by the
  // viber-webhook function. Viber has no getUpdates, so this list is the only
  // way an admin can learn an id — and picking a name beats pasting an opaque
  // string nobody can verify by eye.
  async viberSubscribers() {
    return supabase.rpc('get_viber_subscribers');
  },
};
