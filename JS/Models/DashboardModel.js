// Read-only wrappers around the Dashboard's RPCs. Both get_dashboard_stats()
// and get_onsite_roster() were applied straight to the live database; the RPC
// is the real gate (stats: admin or Employee Manager scope; roster:
// admin/manager). DashboardPage.js's own role check is a convenience, not the
// boundary.
//
// 2026-10-05: the page's 30-second refresh used to call stats + roster
// unconditionally, every time, whether or not a single scan had happened in
// between — and get_dashboard_stats() additionally embeds an `on_site[]`
// array that is a second copy of the roster the page never reads (it derives
// every on-site number from the roster itself, see Utils/dashboard.js's
// summarizeRoster()). pulse() replaces the stats half with
// get_dashboard_pulse(): the same stats minus the two array fields nothing
// reads, plus a cheap roster version string so the much larger roster is only
// downloaded when it actually changed. See
// Supabase/migrations/20261005000000_incremental_scanner_cache_and_dashboard_pulse.sql.
import { supabase } from '../Core/supabaseClient.js';

const clampHours = (h, fallback) => Math.max(1, Math.min(72, Number.isFinite(h) ? h : fallback));

export const DashboardModel = {
  // { stats, roster_version }. p_window_hours is clamped server-side to
  // [1, 72]; clamped here too so the request matches what the server will
  // actually do.
  async pulse(windowHours = 16) {
    return supabase.rpc('get_dashboard_pulse', { p_window_hours: clampHours(windowHours, 16) });
  },

  // Kept as the fallback for a client deployed ahead of the migration (this
  // repo does not auto-deploy database changes) — see DashboardPage.js's
  // load(). Returns the full, un-stripped stats object.
  async stats(windowHours = 16) {
    return supabase.rpc('get_dashboard_stats', { p_window_hours: clampHours(windowHours, 16) });
  },

  async onSiteRoster(staleHours = 16) {
    return supabase.rpc('get_onsite_roster', { p_stale_hours: clampHours(staleHours, 16) });
  },
};
