// Central, mutable app state + the permission rules every feature checks
// against it. Keeping this in one place is what let the bug fix in
// relinkEmployeeToNewCode-style logic stay isolated to the Models layer —
// UI code never has to know how permissions or session data are derived.
import { supabase } from './supabaseClient.js';

const VALID_ROUTES = ['directory', 'proximity', 'scanner', 'users'];
const hashRoute = location.hash.replace('#', '');

export const appState = {
  session: null,
  profile: null, // { id, full_name, email, role, is_active, access_scope }
  // Seeded from the URL hash (e.g. reloading on #scanner keeps you on Test
  // Scan) instead of always defaulting to Employee Manager. showShell()
  // still redirects away from this if the account can't actually view it.
  route: VALID_ROUTES.includes(hashRoute) ? hashRoute : 'directory',
};

export const isStandaloneScanner = new URLSearchParams(location.search).get('scanner') === '1';

export function isAdmin() {
  return appState.profile?.role === 'admin';
}
export function isAdminOrManager() {
  return appState.profile?.role === 'admin' || appState.profile?.role === 'manager';
}
export function canViewEmployeeManager() {
  return isAdmin() || appState.profile?.role === 'manager' ||
    ['all', 'employee_manager'].includes(appState.profile?.access_scope);
}
export function canViewScanner() {
  return isAdmin() || ['all', 'scanner'].includes(appState.profile?.access_scope);
}
export function isScannerOnlyAccount() {
  return canViewScanner() && !canViewEmployeeManager() && !isAdmin();
}

export async function loadProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', appState.session.user.id)
    .maybeSingle();
  if (!error) appState.profile = data;
}
