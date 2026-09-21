// Read-only(ish) wrapper around get_slow_query_stats()/reset_slow_query_stats()
// — both RPCs raise an exception for a non-admin caller (is_admin() check
// in the function body), but SettingsPage.js's "Query performance" panel
// also self-guards with isAdmin() before ever calling these, same as
// every other admin-only page in this app (see AuditLogPage.js).
import { supabase } from '../Core/supabaseClient.js';

export const QueryStatsModel = {
  // p_threshold_ms: only query shapes whose MEAN execution time is at or
  // above this show up at all — see Supabase/README.md for why mean
  // (not max) is the right cutoff for "is this query a routine problem",
  // and why this whole thing is filtered to the app's own anon/
  // authenticated/service_role traffic rather than raw pg_stat_statements.
  async list(thresholdMs = 200, limit = 50) {
    return supabase.rpc('get_slow_query_stats', { p_threshold_ms: thresholdMs, p_limit: limit });
  },
  async reset() {
    return supabase.rpc('reset_slow_query_stats');
  },
};
