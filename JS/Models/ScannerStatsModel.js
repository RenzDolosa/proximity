// Read-only wrapper around get_scanner_performance_stats() — a
// SECURITY DEFINER RPC that was applied directly to the live database
// (not through this repo) and had no caller anywhere in the client until
// AnalyticsPage.js below. Same "the RPC is the real gate" pattern as
// AuditLogModel.js/QueryStatsModel.js: the function raises for a caller
// that fails is_admin()/can_view_scanner() (see Supabase/README.md), but
// AnalyticsPage.js also self-guards with canViewScanner() before ever
// calling this, same as every other scope-gated page in this app.
import { supabase } from '../Core/supabaseClient.js';

export const ScannerStatsModel = {
  // p_days is clamped server-side to [1, 90] (see the RPC body) — the
  // clamp here just keeps the request itself honest with what the server
  // will actually do, so a stale/tampered value never silently asks for
  // a materially different window than what's about to render.
  async get(days = 7) {
    const clamped = Math.max(1, Math.min(90, days || 7));
    return supabase.rpc('get_scanner_performance_stats', { p_days: clamped });
  },
};
