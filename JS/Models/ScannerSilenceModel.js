// Read-only(ish) wrapper around get_scanner_silence_status()/
// check_scanner_silence() — both RPCs raise for a non-admin caller
// (is_admin() check in the function body; check_scanner_silence() only
// enforces that when there's an actual caller to check, since the same
// function is also called by pg_cron on a schedule with no auth context
// at all — see Supabase/README.md's "Scanner silence alerts" section),
// but SettingsPage.js's "Scanner silence alerts" panel also self-guards
// with isAdmin() before ever calling these, same as every other
// admin-only panel on that page.
import { supabase } from '../Core/supabaseClient.js';

export const ScannerSilenceModel = {
  async status(silenceMinutes = 60) {
    return supabase.rpc('get_scanner_silence_status', { p_silence_minutes: silenceMinutes });
  },
  // Floored at 15 server-side regardless of what's passed — well above
  // scannerState()'s own 10-minute "online" window (Utils/dashboard.js),
  // so a manual run here can never flag a scanner the rest of the app
  // still calls online.
  async checkNow(silenceMinutes = 60) {
    return supabase.rpc('check_scanner_silence', { p_silence_minutes: silenceMinutes });
  },
};
