import test from 'node:test';
import assert from 'node:assert/strict';
import * as access from '../JS/Core/accessControl.js';

test('permission matrix keeps scanner-only viewers out of employee management', () => {
  const profile = { role: 'viewer', access_scope: 'scanner' };
  assert.equal(access.canViewScanner(profile), true);
  assert.equal(access.canViewEmployeeManager(profile), false);
  assert.equal(access.isScannerOnlyAccount(profile), true);
  assert.equal(access.canViewSettings(profile), true);
  assert.equal(access.canManageScanSounds(profile), false);
});

test('manager scopes distinguish employee, scanner, and settings capabilities', () => {
  const employeeManager = { role: 'manager', access_scope: 'employee_manager' };
  const scannerManager = { role: 'manager', access_scope: 'scanner' };

  assert.equal(access.canViewEmployeeManager(employeeManager), true);
  assert.equal(access.settingsShowPhotos(employeeManager), true);
  assert.equal(access.canManageScanSounds(employeeManager), false);

  assert.equal(access.canViewScanner(scannerManager), true);
  assert.equal(access.settingsShowSounds(scannerManager), true);
  assert.equal(access.canManageScanSounds(scannerManager), true);
});

test('admins retain access regardless of an incomplete profile scope', () => {
  const admin = { role: 'admin', access_scope: null };
  assert.equal(access.canViewEmployeeManager(admin), true);
  assert.equal(access.canViewScanner(admin), true);
  assert.equal(access.canViewSettings(admin), true);
});
