import test from 'node:test';
import assert from 'node:assert/strict';
import { EMPLOYEE_STATUSES } from '../JS/Utils/employeeStatus.js';

test('employee statuses include the options supported by Employee Manager and card revocation', () => {
  assert.deepEqual(EMPLOYEE_STATUSES, ['active', 'inactive', 'suspended', 'resigned']);
});
