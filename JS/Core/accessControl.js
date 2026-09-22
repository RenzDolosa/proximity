// Pure permission rules shared by the browser app and the unit tests.
// Server-side RLS/RPC checks remain the authorization boundary.
export function isAdmin(profile) {
  return profile?.role === 'admin';
}

export function isAdminOrManager(profile) {
  return isAdmin(profile) || profile?.role === 'manager';
}

export function canViewEmployeeManager(profile) {
  return isAdmin(profile) || profile?.role === 'manager' ||
    ['all', 'employee_manager'].includes(profile?.access_scope);
}

export function canViewScanner(profile) {
  return isAdmin(profile) || ['all', 'scanner'].includes(profile?.access_scope);
}

export function isScannerOnlyAccount(profile) {
  return canViewScanner(profile) && !canViewEmployeeManager(profile) && !isAdmin(profile);
}

export function canViewSettings(profile) {
  return isAdmin(profile) || ['all', 'employee_manager', 'scanner'].includes(profile?.access_scope);
}

export function settingsShowSounds(profile) {
  return isAdmin(profile) || ['all', 'scanner'].includes(profile?.access_scope);
}

export function settingsShowPhotos(profile) {
  return isAdmin(profile) || ['all', 'employee_manager'].includes(profile?.access_scope);
}

export function canManageScanSounds(profile) {
  return isAdmin(profile) || (profile?.role === 'manager' && settingsShowSounds(profile));
}
