// Read-only wrappers around the Dashboard's RPCs. The RPCs are the real
// permission gate; DashboardPage.js's role check is a convenience.
import { supabase } from '../Core/supabaseClient.js';

const clampHours = (h, fallback) => Math.max(1, Math.min(72, Number.isFinite(h) ? h : fallback));

export const DashboardModel = {
  // { stats, roster_version }. Stats minus the on_site[]/by_department[] arrays
  // nothing reads — the page derives both from the roster.
  async pulse(windowHours = 16) {
    return supabase.rpc('get_dashboard_pulse', { p_window_hours: clampHours(windowHours, 16) });
  },

  // Fallback for a client deployed ahead of the pulse migration.
  async stats(windowHours = 16) {
    return supabase.rpc('get_dashboard_stats', { p_window_hours: clampHours(windowHours, 16) });
  },

  // Fallback for a client deployed ahead of the roster-delta migration.
  async onSiteRoster(staleHours = 16) {
    return supabase.rpc('get_onsite_roster', { p_stale_hours: clampHours(staleHours, 16) });
  },

  // { full, cursor, stale_hours, rows }. `since` null asks for the whole roster;
  // otherwise only employees changed after it, each with `on_roster` so the
  // client can drop the ones who left. This is what the 30-second poll calls —
  // `roster_version` above can never skip the roster during working hours,
  // because every scan bumps employees.updated_at. See docs/EGRESS_BUDGET.md.
  async rosterDelta(since = null, staleHours = 16) {
    return supabase.rpc('get_onsite_roster_delta', {
      p_since: since,
      p_stale_hours: clampHours(staleHours, 16),
    });
  },
};
