// Data-quality checks over the Employee Manager grid.
//
// COSTS NOTHING. DirectoryPage already holds every row of employee_directory
// (EmployeesModel.listDirectory, cached for 60s), so these are pure functions
// over an array that is on the client anyway. Each issue filters the grid
// rather than opening a report, so acting on one costs nothing either.
//
// A BLIND SPOT THIS CANNOT SEE, and the reason the panel says so out loud:
// employee_directory is `employees JOIN proximity_cards ON pc.id =
// e.proximity_card_id` — an INNER join. An employee with no card at all is
// not in this payload, so "active employee with no card issued" is NOT
// computable here and is not claimed. Checking it would need its own query,
// which is exactly the cost this panel exists to avoid.

/** Treats null, undefined and whitespace alike — all three read as "blank". */
const blank = (v) => String(v ?? '').trim() === '';
const isActive = (r) => String(r?.status ?? 'active') === 'active';

// Order is severity, not alphabetical: the panel renders it as given, and the
// two card/status mismatches are the ones that can let a door open.
export const CHECKS = Object.freeze([
  {
    id: 'live_card_inactive_employee',
    label: 'Inactive employee, card still active',
    hint: 'The card still opens doors. This is the one on this list with a physical consequence.',
    severity: 'bad',
    test: (r) => !isActive(r) && r.proximity_card_active === true,
  },
  {
    id: 'active_employee_dead_card',
    label: 'Active employee, card deactivated',
    hint: 'They are expected on site but their card will be refused at the scanner.',
    severity: 'warn',
    test: (r) => isActive(r) && r.proximity_card_active === false,
  },
  {
    id: 'duplicate_code',
    label: 'Duplicate employee code',
    hint: 'Two records share one code, so scans and attendance cannot be attributed reliably.',
    severity: 'bad',
    // Needs the whole set, not one row — filled in by scoreDirectory below.
    test: null,
  },
  {
    id: 'never_scanned',
    label: 'Never scanned',
    hint: 'Has a card but has never used it. Either a card that was never handed over, or a scanner that is not recording.',
    severity: 'warn',
    test: (r) => isActive(r) && Number(r.total_scans ?? 0) === 0,
  },
  {
    id: 'no_photo',
    label: 'No photo',
    hint: 'Shows as initials on every kiosk, so a guard cannot check the face against the badge.',
    severity: 'info',
    test: (r) => blank(r.photo_url),
  },
  {
    id: 'no_department',
    label: 'No department',
    hint: 'Falls into "No department" on the muster sheet and in every department breakdown.',
    severity: 'info',
    test: (r) => blank(r.department),
  },
  {
    id: 'no_contact',
    label: 'No email or phone',
    hint: 'No way to reach them from the record — including when a muster says they are unaccounted for.',
    severity: 'info',
    test: (r) => blank(r.email) && blank(r.phone),
  },
]);

/**
 * Case- and space-insensitive: "A-101", "a-101" and " a-101 " are the same
 * badge number written three ways, and treating them as distinct would hide
 * the duplicate this check exists to find.
 */
export function duplicateCodes(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const key = String(r?.employee_code ?? '').trim().toLowerCase();
    if (!key) continue; // a missing code is not a duplicate of another missing code
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

/** @returns {{issues: Array, total: number, clean: number}} */
export function scoreDirectory(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const dupes = duplicateCodes(list);
  const isDupe = (r) => dupes.has(String(r?.employee_code ?? '').trim().toLowerCase());

  const flagged = new Set();
  const issues = CHECKS.map((c) => {
    const test = c.id === 'duplicate_code' ? isDupe : c.test;
    const matched = list.filter((r) => {
      if (!test(r)) return false;
      flagged.add(r.id);
      return true;
    });
    return { ...c, test, count: matched.length, rows: matched };
  });

  return {
    issues,
    total: list.length,
    // A row with three problems is one unclean row, not three. The headline
    // has to be answerable as "how many records need a human".
    clean: list.length - flagged.size,
  };
}

export function matchesCheck(row, checkId, rows) {
  const check = CHECKS.find((c) => c.id === checkId);
  if (!check) return true;
  if (checkId === 'duplicate_code') {
    return duplicateCodes(rows).has(String(row?.employee_code ?? '').trim().toLowerCase());
  }
  return check.test(row);
}

export const SEVERITY_BADGE = Object.freeze({
  bad: 'inactive_card', warn: 'unassigned_card', info: 'role-viewer',
});
