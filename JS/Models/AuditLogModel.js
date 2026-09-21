// Read-only wrapper around get_audit_log() — the RPC itself is the real
// gate (it silently returns zero rows for a non-admin caller, since its
// body is `select * from audit_log where is_admin() ...`), but
// AuditLogPage.js also self-guards with isAdmin() before ever calling
// this, same as every other admin-only page in this app (see
// UsersPage.js's `if (!isAdmin())` at the top of renderUsers()).
import { supabase } from '../Core/supabaseClient.js';

export const AuditLogModel = {
  async list(limit = 200) {
    return supabase.rpc('get_audit_log', { p_limit: limit });
  },
};