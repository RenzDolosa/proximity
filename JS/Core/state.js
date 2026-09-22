// Central, mutable app state + the permission rules every feature checks
// against it. Keeping this in one place is what let the bug fix in
// relinkEmployeeToNewCode-style logic stay isolated to the Models layer —
// UI code never has to know how permissions or session data are derived.
import { supabase } from './supabaseClient.js';
import * as access from './accessControl.js';

const VALID_ROUTES = ['directory', 'proximity', 'scanner', 'users', 'settings', 'audit'];
const hashRoute = location.hash.replace('#', '');

export const appState = {
  session: null,
  profile: null, // { id, full_name, email, role, is_active, access_scope }
  // Seeded from the URL hash (e.g. reloading on #scanner keeps you on Test
  // Scan) instead of always defaulting to Employee Manager. showShell()
  // still redirects away from this if the account can't actually view it.
  route: VALID_ROUTES.includes(hashRoute) ? hashRoute : 'directory',
  employeesCache: [],
};

export const isStandaloneScanner = new URLSearchParams(location.search).get('scanner') === '1';

export function isAdmin() {
  return access.isAdmin(appState.profile);
}
export function isAdminOrManager() {
  return access.isAdminOrManager(appState.profile);
}
export function canViewEmployeeManager() {
  return access.canViewEmployeeManager(appState.profile);
}
export function canViewScanner() {
  return access.canViewScanner(appState.profile);
}
export function isScannerOnlyAccount() {
  return access.isScannerOnlyAccount(appState.profile);
}

// Settings reuses the same role + access_scope model as the module gates
// above, rather than a parallel permission scheme — see
// Supabase/README.md's can_view_settings()/can_manage_scan_sounds() for
// the server-side mirror of this same logic (the Storage RLS on
// scan-sounds and the upload-employee-photo Edge Function's "quota"
// action both enforce it independently of these client-side checks).

// Whether the account can open Settings at all (either panel). Admins
// always can; anyone else needs an access_scope that covers at least one
// Settings-relevant module.
export function canViewSettings() {
  return access.canViewSettings(appState.profile);
}
// The "Scan sounds" panel is Scanner-related — shown when scope covers
// Scanner (or admin).
export function settingsShowSounds() {
  return access.settingsShowSounds(appState.profile);
}
// The "Employee photos" panel is Employee Manager-related — shown when
// scope covers Employee Manager (or admin).
export function settingsShowPhotos() {
  return access.settingsShowPhotos(appState.profile);
}
// Upload/replace/remove scan sounds — admins and managers (with a scope
// that shows the panel in the first place); Viewers are always read-only
// here regardless of scope.
export function canManageScanSounds() {
  return access.canManageScanSounds(appState.profile);
}

export async function loadProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', appState.session.user.id)
    .maybeSingle();
  if (!error) appState.profile = data;
}
