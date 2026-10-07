export const EMPLOYEE_STATUSES = Object.freeze(['active', 'inactive', 'suspended', 'resigned']);

// The one status that frees an employee_code for reuse, enforced by the partial
// unique index employees_employee_code_current_key (20261006140000).
//
// Named rather than written as a bare 'resigned' in each place that cares, so
// "which status releases a code" has exactly one definition. Utils/employeeCode.js
// reads it too.
export const RELEASES_EMPLOYEE_CODE = 'resigned';
export const releasesEmployeeCode = (status) => status === RELEASES_EMPLOYEE_CODE;

// Shown in every status picker instead of the bare value. The consequence for
// the employee code belongs ON the option, at the moment someone chooses it —
// `inactive` and `resigned` look interchangeable otherwise, and picking the
// wrong one silently blocks reuse of that person's code (or silently allows it).
export const EMPLOYEE_STATUS_LABEL = Object.freeze({
  active: 'Active',
  inactive: 'Inactive — still employed, keeps their employee code',
  suspended: 'Suspended — access withdrawn, keeps their employee code',
  resigned: 'Resigned — has left; frees their employee code for reuse',
});

export const employeeStatusLabel = (status) => EMPLOYEE_STATUS_LABEL[status] || status;

// Rendered under both status pickers.
export const EMPLOYEE_STATUS_HINT =
  'Use Resigned for anyone who has left — it is the only status that frees their '
  + 'employee code to be issued to someone else. Inactive and Suspended keep the code reserved.';

export function employeeStatusOptionsHTML(selected) {
  return EMPLOYEE_STATUSES
    .map((s) => `<option value="${s}"${s === selected ? ' selected' : ''}>${employeeStatusLabel(s)}</option>`)
    .join('');
}
