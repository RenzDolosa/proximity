// Read-only wrappers around the Dashboard's RPCs. The RPCs are the real
// permission gate; DashboardPage.js's role check is a convenience.
import { supabase } from '../Core/supabaseClient.js';

const clampHours = (h, fallback) => Math.max(1, Math.min(72, Number.isFinite(h) ? h : fallback));

export const DashboardModel = {
  // { stats, roster_version, roster: { full, cursor, stale_hours, rows } } —
  // one refresh in one request. This is what the poll calls.
  //
  // Log Ingestion bills per REQUEST, not per byte: every call writes one
  // API-gateway log line whether it returns 40 bytes or 5 MB. The Dashboard was
  // firing pulse() and rosterDelta() back to back on every tick, so merging
  // them server-side halves its log footprint for a byte-identical payload.
  // See the 20261021090000 migration, and note that this is the opposite
  // optimisation to the egress work — that one shrank payloads, which does
  // nothing here.
  async tick(windowHours = 16, since = null, staleHours = 16) {
    return supabase.rpc('get_dashboard_tick', {
      p_window_hours: clampHours(windowHours, 16),
      p_since: since,
      p_stale_hours: clampHours(staleHours, 16),
    });
  },

  // { stats, roster_version }. Stats minus the on_site[]/by_department[] arrays
  // nothing reads — the page derives both from the roster.
  // Fallback for a client deployed ahead of the combined-tick migration.
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
  // client can drop the ones who left.
  //
  // No longer called on the poll path — tick() returns this same object under
  // its `roster` key. Kept as the fallback for a client deployed ahead of the
  // combined-tick migration. `roster_version` can never skip the roster during
  // working hours, because every scan bumps employees.updated_at, which is why
  // the calls were merged rather than made conditional. See
  // docs/EGRESS_BUDGET.md.
  async rosterDelta(since = null, staleHours = 16) {
    return supabase.rpc('get_onsite_roster_delta', {
      p_since: since,
      p_stale_hours: clampHours(staleHours, 16),
    });
  },
};
