// Wrapper around the card-sharing configuration (20261104093000): which site
// each scanner stands at, and how long it takes to travel between sites.
//
// The DETECTION costs nothing — it runs in a trigger inside the scan
// transaction and writes to `alerts`, which the bell already polls. These
// requests are configuration only: they happen when an admin opens or saves
// the editor, never on a timer.
//
// get_scanner_sites() exists as a separate RPC rather than a column on
// get_scanners() because get_scanners() has no migration in this repository —
// it is live-only, created through the dashboard SQL Editor, and its body
// cannot be read from here to extend safely. See the migration's comment.
import { supabase } from '../Core/supabaseClient.js';

// Matches the SQL sentinel for "any pair of sites without a specific rule".
export const DEFAULT_SITE_PAIR = '*';

export const SiteRulesModel = {
  async scannerSites() {
    return supabase.rpc('get_scanner_sites');
  },

  // Empty clears the site, which switches detection off for that scanner
  // rather than leaving it half-configured.
  async setScannerSite(scannerId, site) {
    return supabase.rpc('set_scanner_site', {
      p_scanner_id: scannerId,
      p_site: site ?? '',
    });
  },

  async travelRules() {
    return supabase.rpc('get_site_travel_rules');
  },

  // Both sites null/'' sets the fallback that governs every pair.
  async setTravelRule(fromSite, toSite, minMinutes) {
    return supabase.rpc('set_site_travel_rule', {
      p_from_site: fromSite || null,
      p_to_site: toSite || null,
      p_min_minutes: Number(minMinutes),
    });
  },

  async removeTravelRule(fromSite, toSite) {
    return supabase.rpc('delete_site_travel_rule', {
      p_from_site: fromSite || null,
      p_to_site: toSite || null,
    });
  },
};
