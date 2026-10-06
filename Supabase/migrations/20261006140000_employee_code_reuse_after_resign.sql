-- Allow an employee_code to be recycled, but only once its previous holder is
-- marked `resigned`.
--
-- The business practice is to reuse codes when staff leave.
-- employees_employee_code_key (UNIQUE) made that impossible. Dropping the
-- constraint outright would also throw away the protection against a mistyped
-- code, which in an access-control system silently merges two people's scans —
-- and a UNIQUE cannot be re-added later once duplicates exist. A partial unique
-- index states the real rule instead: a code identifies one CURRENT employee.
--
-- `resigned` has been a valid employees.status since 20261003060125, so no
-- status change is needed to express this.
--
-- Nothing in the database keys on employee_code — scan_events uses employee_id,
-- scan_logs uses proximity_code — so history stays attributed correctly across a
-- handover. It is the human-facing exports that need care; see
-- JS/Utils/employeeCode.js and the README entry.

ALTER TABLE public.employees DROP CONSTRAINT employees_employee_code_key;

-- Partial, so resigned rows are exempt. CONCURRENTLY is not available inside
-- the implicit transaction a migration runs in; at this table's size the brief
-- lock is immaterial.
CREATE UNIQUE INDEX employees_employee_code_current_key
  ON public.employees (employee_code)
  WHERE status <> 'resigned';

COMMENT ON INDEX public.employees_employee_code_current_key IS
  'Replaces employees_employee_code_key. Permits reusing an employee_code once the previous holder is status = resigned, while still rejecting duplicates among current employees.';

-- No companion lookup RPC on purpose. Both callers that need to know whether a
-- code is free (the XLSX import and the employee modal) run on Employee Manager,
-- which already holds the whole directory including `status`, so they decide
-- locally via JS/Utils/employeeCode.js. A per-row RPC would add a round trip per
-- import line for data already in memory. This index remains the enforcement;
-- the client check only buys a better error message.
