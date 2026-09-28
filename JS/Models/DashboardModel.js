// Read-only wrappers around get_dashboard_stats() and get_onsite_roster().
// Both RPCs were applied straight to the live database; the RPC is the real
// gate (stats: admin or Employee Manager scope; roster: admin/manager).
// DashboardPage.js's own role check is a convenience, not the boundary.
import { supabase } from '../Core/supabaseClient.js';

const clampHours = (h, fallback) => Math.max(1, Math.min(72, Number.isFinite(h) ? h : fallback));

export const DashboardModel = {
  // p_window_hours is clamped server-side to [1, 72]; clamped here too so
  // the request matches what the server will actually do.
  async stats(windowHours = 16) {
    return supabase.rpc('get_dashboard_stats', { p_window_hours: clampHours(windowHours, 16) });
  },
  async onSiteRoster(staleHours = 16) {
    return supabase.rpc('get_onsite_roster', { p_stale_hours: clampHours(staleHours, 16) });
  },
};
