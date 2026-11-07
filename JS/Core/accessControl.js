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

// Export Manager. Same gate as running an export itself
// (is_admin_or_manager() inside get_scan_events_page()), because a ledger of
// exports is only useful to someone who can make one. The SCOPE inside the
// page is a separate rule and lives server-side: get_export_tasks() and the
// export_tasks RLS policy both return every task to an admin and only your
// own to anyone below. A UI convenience only; the RPC is the real boundary.
export function canViewExportTasks(profile) {
  return isAdminOrManager(profile);
}

// The Scanner registry panel (Settings) is readable by admins and anyone
// with Scanner scope (get_scanners()); only admins can change it
// (update_scanner()).
export function canViewScannerRegistry(profile) {
  // Same shape as canViewScanner: the registry is part of that surface.
  return isAdmin(profile) || profile?.access_scope === 'scanner'
    || (profile?.role === 'manager' && profile?.access_scope === 'all');
}

export function canEditScannerRegistry(profile) {
  return isAdmin(profile);
}

// MIRRORS can_view_employee_manager() AS OF 20261106190000, which is the
// real boundary. 'all' no longer grants on its own: it is the DEFAULT
// access_scope, so a brand-new viewer used to satisfy this. An explicit
// 'employee_manager' still does, because that is the narrow grant working
// as intended.
export function canViewEmployeeManager(profile) {
  return isAdmin(profile) || profile?.role === 'manager'
    || profile?.access_scope === 'employee_manager';
}

// Mirrors can_view_scanner(). 'scanner' grants on its own at any role --
// that is how the kiosk accounts are provisioned -- while the catch-all
// 'all' now needs a role behind it.
export function canViewScanner(profile) {
  return isAdmin(profile) || profile?.access_scope === 'scanner'
    || (profile?.role === 'manager' && profile?.access_scope === 'all');
}

export function isScannerOnlyAccount(profile) {
  return canViewScanner(profile) && !canViewEmployeeManager(profile) && !isAdmin(profile);
}

// Mirrors can_view_settings(), same rule.
export function canViewSettings(profile) {
  return isAdmin(profile)
    || ['employee_manager', 'scanner'].includes(profile?.access_scope)
    || (profile?.role === 'manager' && profile?.access_scope === 'all');
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
