import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError, GENERIC_ERROR } from '../JS/Utils/userError.js';

// Real messages Postgres and PostgREST produce. Every one names something
// about the schema; none of them should ever reach a screen.
const RAW = [
  'relation "public.employees" does not exist',
  'duplicate key value violates unique constraint "employees_employee_code_current_key"',
  'new row for relation "profiles" violates check constraint "profiles_role_check"',
  'insert or update on table "employees" violates foreign key constraint "employees_proximity_card_id_fkey"',
  'null value in column "full_name" of relation "employees" violates not-null constraint',
  'permission denied for function get_scanner_offline_photos',
  'Could not find the function public.get_attendance_summary(p_from, p_to) in the schema cache',
  'invalid input syntax for type uuid: "not-a-uuid"',
  'column employees.photo_thumb_b64 does not exist',
];

// The words that must never survive the mapping. A failure here is a schema
// disclosure, not a cosmetic bug.
const LEAKS = [
  /relation/i, /constraint/i, /\bcolumn\b/i, /\btable\b/i, /schema/i,
  /public\./i, /employees/i, /profiles/i, /proximity_card/i, /scan_events/i,
  /_fkey|_key\b|_check\b/i, /\buuid\b/i, /pg_/i, /get_\w+\(/i,
];

test('no raw database error survives the mapping', () => {
  for (const raw of RAW) {
    const out = friendlyError(new Error(raw));
    for (const leak of LEAKS) {
      assert.ok(!leak.test(out), `"${out}" leaked ${leak} from "${raw}"`);
    }
    assert.ok(out.length > 0);
  }
});

test('the same holds for a PostgREST error object, not just a message', () => {
  const err = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "employees_employee_code_current_key"',
    details: 'Key (employee_code)=(3522) already exists.',
    hint: null,
  };
  const out = friendlyError(err);
  for (const leak of LEAKS) assert.ok(!leak.test(out), `leaked ${leak}`);
  assert.ok(!out.includes('3522'), 'must not echo the offending value either');
  assert.match(out, /already in use/i);
});

test('each error class gets its own actionable sentence', () => {
  assert.match(friendlyError(new Error('permission denied for function x')), /access/i);
  assert.match(friendlyError(new Error('JWT expired')), /sign in/i);
  assert.match(friendlyError(new TypeError('Failed to fetch')), /connection/i);
  assert.match(friendlyError({ code: '429', message: 'Too Many Requests' }), /wait a moment/i);
  assert.match(friendlyError(new Error('date range too large (max 31 days)')), /31 days/);
  assert.match(friendlyError({ code: '23503', message: 'foreign key violation' }), /linked/i);
});

// Permission errors must not distinguish "you may not" from "it is not there"
// — that difference is itself information.
test('permission and not-found are indistinguishable to the reader', () => {
  const denied = friendlyError(new Error('permission denied for table employees'));
  assert.match(denied, /access/i);
  assert.ok(!/exist|found|missing/i.test(denied));
});

test('an unrecognised error falls back rather than passing anything through', () => {
  const weird = 'ERROR: something nobody mapped, table "secrets" at character 42';
  const out = friendlyError(new Error(weird));
  assert.equal(out, GENERIC_ERROR);
  assert.ok(!out.includes('secrets'));
});

test('a caller can supply a more useful fallback than the generic one', () => {
  const out = friendlyError(new Error('unmapped nonsense'), "Couldn't load the attendance report.");
  assert.equal(out, "Couldn't load the attendance report.");
});

test('empty, null and malformed errors still return something sayable', () => {
  for (const nothing of [null, undefined, {}, '', new Error('')]) {
    const out = friendlyError(nothing);
    assert.equal(out, GENERIC_ERROR);
  }
});

test('a plain string error is handled, not just an Error', () => {
  assert.match(friendlyError('Failed to fetch'), /connection/i);
});
