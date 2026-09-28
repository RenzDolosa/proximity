// Scanner registry: get_scanners() (admin or Scanner scope) and
// update_scanner() (admin only, audit-logged server-side as
// 'scanner_updated'). A scanner row is created automatically the first time
// a new scanner_id scans; this only edits label / enabled.
import { supabase } from '../Core/supabaseClient.js';

export const ScannersModel = {
  async list() {
    return supabase.rpc('get_scanners');
  },
  // Pass only what changes: null leaves a field as-is, and an empty-string
  // label clears it.
  async update(scannerId, { enabled = null, label = null } = {}) {
    return supabase.rpc('update_scanner', { p_scanner_id: scannerId, p_enabled: enabled, p_label: label });
  },
};
