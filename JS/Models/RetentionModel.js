// The retention horizon: how long scan history is kept, and when a change
// to that takes effect.
//
// Three requests, all admin-only and all on an explicit action: read the
// setting when the panel opens, write it when someone saves, and preview
// what the next run would remove when someone asks. Nothing polls, and the
// trim job reads the setting server-side inside pg_cron — so enforcing the
// horizon costs nothing at all.
//
// The vocabulary, validation and wording live in Utils/retention.js, which
// imports no Supabase client and can therefore be tested under Node. This
// file is only the RPC surface.
//
// THE GRACE PERIOD IS NOT A CLIENT CONCERN. effective_from is computed
// server-side in set_retention_days() from the server's own clock; this
// module only displays it. A client that could choose the date could choose
// today, which is exactly what the grace exists to prevent.
import { supabase } from '../Core/supabaseClient.js';

export const RetentionModel = {
  async get() {
    return supabase.rpc('get_retention_settings');
  },

  /** Returns the new settings object, so the caller need not re-read. */
  async set(days) {
    return supabase.rpc('set_retention_days', { p_days: days });
  },

  // Expensive by nature — it unnests every scan_logs array to date the
  // entries inside. Deliberately separate from the trim status panel, which
  // reads a counter column instead (see 20261107130000: de-TOASTing those
  // arrays measured 1852 ms). Call this on a press, never on a timer.
  async preview(olderThanDays = null) {
    return supabase.rpc('preview_scan_logs_trim', { p_older_than_days: olderThanDays });
  },
};
