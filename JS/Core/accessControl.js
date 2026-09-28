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

// Dashboard and Alerts: get_onsite_roster() / get_alerts() /
// acknowledge_alert() all gate on is_admin_or_manager() server-side. A UI
// convenience only; the RPCs are the real boundary.
export function canViewDashboard(profile) {
  return isAdminOrManager(profile);
}

export function canViewAlerts(profile) {
  return isAdminOrManager(profile);
}

// The Scanner registry panel (Settings) is readable by admins and anyone
// with Scanner scope (get_scanners()); only admins can change it
// (update_scanner()).
export function canViewScannerRegistry(profile) {
  return isAdmin(profile) || ['all', 'scanner'].includes(profile?.access_scope);
}

export function canEditScannerRegistry(profile) {
  return isAdmin(profile);
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
