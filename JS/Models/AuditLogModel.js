// Read-only wrapper around get_audit_log() — the RPC itself is the real
// gate (it silently returns zero rows for a non-admin caller, since its
// body is `select * from audit_log where is_admin() ...`), but
// AuditLogPage.js also self-guards with isAdmin() before ever calling
// this, same as every other admin-only page in this app (see
// UsersPage.js's `if (!isAdmin())` at the top of renderUsers()).
import { supabase } from '../Core/supabaseClient.js';

// get_audit_log() returns the newest p_limit rows (server-clamped to 1000).
// With 15 rows today that cap is invisible, which is exactly the problem: the
// page said "1–15 of 15" and would have said "1–200 of 200" at ten thousand
// rows, with nothing to distinguish a complete list from a truncated one.
export const AUDIT_PAGE_LIMIT = 200;

export const AuditLogModel = {
  async list(limit = AUDIT_PAGE_LIMIT) {
    return supabase.rpc('get_audit_log', { p_limit: limit });
  },

  // Scalar count of the whole table — a few bytes, so the page can show the
  // true total alongside however many rows it actually holds.
  async count() {
    return supabase.rpc('get_audit_log_count');
  },
};