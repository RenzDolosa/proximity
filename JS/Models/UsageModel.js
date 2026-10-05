// Settings → Usage panel data.
//
// Database size and the per-table breakdown only. There is deliberately no
// Egress / Cached Egress / Log Ingestion / Log Query here: those are platform
// billing metrics with no API behind them. A `project-usage` Edge Function was
// built to fetch them and removed on 2026-10-05 once the live project proved
// the endpoint does not exist — the token was good (`/v1/projects/<ref>` → 200)
// while every usage path returned 404, matching the published OpenAPI spec,
// which names no usage, billing, quota, analytics or logs route at all.
// See README.md's change log entry for the full probe output.
//
// Read those four from the Supabase dashboard's Usage page, and attribute
// egress to specific endpoints with the Logs Explorer queries in
// docs/SUPABASE_QUOTA_DECISION.md §7 — which is the question a billing total
// could never answer anyway.
import { supabase } from '../Core/supabaseClient.js';

export const UsageModel = {
  async databaseUsage() {
    return supabase.rpc('get_database_usage');
  },
};
