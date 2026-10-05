// Settings -> Usage panel data, from two deliberately separate sources.
//
// databaseUsage()  -> get_database_usage() RPC. Cheap, no secrets, always
//                     available. Database size + the per-table breakdown.
// projectUsage()   -> project-usage Edge Function, which proxies Supabase's
//                     Management API. Egress, Cached Egress, Log Ingestion and
//                     Log Query live ONLY there, behind a Personal Access
//                     Token that is an account-wide credential and therefore
//                     cannot be held by the browser.
//
// Kept apart rather than merged behind one call so the panel degrades
// usefully: an unconfigured or failing Management API still leaves database
// size on screen, instead of blanking a panel that was 20% working.
//
// Neither is polled. See the Edge Function's header — a usage monitor on a
// timer spends the very quota it reports on.
import { supabase } from '../Core/supabaseClient.js';

async function readFunctionError(error) {
  if (!error) return null;
  try {
    if (error.context && typeof error.context.clone === 'function') {
      const body = await error.context.clone().json();
      if (body?.error) return { message: body.error, code: body.code || null };
    }
  } catch {
    // body wasn't JSON (or was already consumed) — fall through
  }
  return { message: error.message || 'Request failed', code: null };
}

export const UsageModel = {
  async databaseUsage() {
    return supabase.rpc('get_database_usage');
  },

  // { data, error: { message, code } }. `code` distinguishes the two failures
  // an admin can actually act on — 'not_configured' (secrets never set) and
  // 'management_token_invalid' (token revoked/expired) — from a transient one,
  // so the panel can tell the user which it is instead of showing a generic
  // failure for a setup step nobody has done yet.
  async projectUsage() {
    const { data, error } = await supabase.functions.invoke('project-usage', { body: {} });
    if (error) return { data: null, error: await readFunctionError(error) };
    return { data, error: null };
  },
};
