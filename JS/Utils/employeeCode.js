// Identity rules for employee_code and full_name, shared by the XLSX import and
// the employee modal so both agree on what "already taken" means.
//
// Codes are recycled when staff leave, so uniqueness applies only to CURRENT
// employees — mirroring employees_employee_code_current_key, the partial unique
// index that actually enforces it (20261006140000). A resigned holder blocks
// nothing.
import { releasesEmployeeCode } from './employeeStatus.js';

// Which status frees a code lives in Utils/employeeStatus.js, so the rule the
// pickers explain and the rule this enforces cannot drift apart.
export const isResigned = (row) => releasesEmployeeCode(row?.status);

// Comparison key for both fields: trimmed and lowercased, matching how the
// import has always matched. Deliberately looser than the database index, which
// is case-sensitive — rejecting "EMP-1" against an existing "emp-1" is the safe
// direction to err.
export const identityKey = (value) => String(value ?? '').trim().toLowerCase();

// The current employee holding `code`, or null when it is free to reuse.
// `excludeId` skips the row being edited, so saving an employee without changing
// their code is not a collision with themselves.
export function currentCodeHolder(employees, code, excludeId = null) {
  const key = identityKey(code);
  if (!key) return null;
  return (employees || []).find((e) =>
    e.id !== excludeId && !isResigned(e) && identityKey(e.employee_code) === key) || null;
}

// Same rule for names. A resigned person's name must not block a re-hire, which
// is the common case now that codes are recycled.
export function currentNameHolder(employees, fullName, excludeId = null) {
  const key = identityKey(fullName);
  if (!key) return null;
  return (employees || []).find((e) =>
    e.id !== excludeId && !isResigned(e) && identityKey(e.full_name) === key) || null;
}

// Index of taken keys plus the resigned rows a reuse would be inheriting from,
// for the import's per-row loop. Built once rather than scanning the roster for
// every line.
export function buildIdentityIndex(employees) {
  const codes = new Map();      // key -> current holder
  const names = new Map();      // key -> current holder
  const resignedCodes = new Map(); // key -> most recent resigned holder
  for (const e of employees || []) {
    const codeK = identityKey(e.employee_code);
    const nameK = identityKey(e.full_name);
    if (isResigned(e)) {
      if (codeK) resignedCodes.set(codeK, e);
      continue;
    }
    if (codeK && !codes.has(codeK)) codes.set(codeK, e);
    if (nameK && !names.has(nameK)) names.set(nameK, e);
  }
  return { codes, names, resignedCodes };
}
