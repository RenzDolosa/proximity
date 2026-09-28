// Pure permission rules shared by the browser app and the unit tests.
// Server-side RLS/RPC checks remain the authorization boundary.
export function isAdmin(profile) {
  return profile?.role === 'admin';
}

export function isAdminOrManager(profile) {
  return isAdmin(profile) || profile?.role === 'manager';
}

// Mirrors is_admin_or_manager() inside get_attendance_report() — same gate
// as get_all_scan_events(), since attendance is that same per-employee scan
// history, aggregated. A UI convenience only; the RPC is the real boundary.
export function canViewAttendance(profile) {
  return isAdminOrManager(profile);
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
