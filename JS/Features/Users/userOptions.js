// Shared between the Users table (UsersPage) and the User modal so the
// labels and option lists never drift apart.
export const scopeLabel = {
  all: 'All areas',
  employee_manager: 'Employee Manager only',
  scanner: 'Scanner only',
};

export function scopeOptions(selected) {
  return Object.entries(scopeLabel)
    .map(([v, l]) => `<option value="${v}" ${selected === v ? 'selected' : ''}>${l}</option>`)
    .join('');
}

export function roleOptions(selected) {
  return ['admin', 'manager', 'viewer']
    .map((r) => `<option value="${r}" ${selected === r ? 'selected' : ''}>${r}</option>`)
    .join('');
}
