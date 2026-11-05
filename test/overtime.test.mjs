import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  overtimeState, OVERTIME_STATE, measuredDays, breakSeconds,
  fmtOvertime, fmtHoursTotal, isOver, isShort, BREAK_NOTICE_SECONDS,
} from '../JS/Utils/overtime.js';
import { toSummary } from '../JS/Utils/attendance.js';

// ---- state ----
//
// Separate from punctuality's three states because the two halves of a shift
// are configured independently: a rule can have a start time and no expected
// hours, so punctuality works and overtime cannot.

test('no expected hours is unconfigured, whatever punctuality says', () => {
  for (const summary of [
    { rulesConfigured: true, expectedConfigured: null, days: 100 },
    { rulesConfigured: true, expectedConfigured: false, days: 100 },
    {},
    null,
  ]) {
    assert.equal(overtimeState(summary), OVERTIME_STATE.UNCONFIGURED);
  }
});

test('expected hours set but nothing measurable is no-data', () => {
  assert.equal(
    overtimeState({ expectedConfigured: true, days: 40, unmeasuredDays: 40 }),
    OVERTIME_STATE.NO_DATA,
  );
});

test('expected hours with measured days is ready', () => {
  assert.equal(
    overtimeState({ expectedConfigured: true, days: 40, unmeasuredDays: 5 }),
    OVERTIME_STATE.READY,
  );
});

// A day worked to exactly the expected minute is measured and is neither over
// nor short, so overDays + shortDays would undercount it.
test('measured days counts the exactly-on-target days too', () => {
  const s = { days: 100, unmeasuredDays: 10, overDays: 30, shortDays: 20 };
  assert.equal(measuredDays(s), 90);
  assert.notEqual(measuredDays(s), s.overDays + s.shortDays);
});

test('measured days never goes negative on inconsistent input', () => {
  assert.equal(measuredDays({ days: 5, unmeasuredDays: 99 }), 0);
  assert.equal(measuredDays({}), 0);
  assert.equal(measuredDays(null), 0);
});

// ---- break time ----
//
// The whole point of this one: it is arithmetic on bytes already downloaded.

test('break time is time on site minus time worked', () => {
  // 07:00 to 17:00 on site = 10h; worked 8h; so 2h off site.
  const row = {
    first_in: '2026-11-06T07:00:00+08:00',
    last_out: '2026-11-06T17:00:00+08:00',
    worked_seconds: 8 * 3600,
  };
  assert.equal(breakSeconds(row), 2 * 3600);
});

// An open day has no end, so time on site is not a quantity yet.
test('a day with no OUT has no break figure', () => {
  assert.equal(breakSeconds({
    first_in: '2026-11-06T07:00:00+08:00', last_out: null, worked_seconds: 0,
  }), null);
});

// last_out before first_in is the anomaly case; a negative break is not a
// thing to render.
test('an impossible span yields no break rather than a negative one', () => {
  assert.equal(breakSeconds({
    first_in: '2026-11-06T17:00:00+08:00',
    last_out: '2026-11-06T07:00:00+08:00',
    worked_seconds: 3600,
  }), null);
});

test('a day with no gap has no break figure', () => {
  assert.equal(breakSeconds({
    first_in: '2026-11-06T07:00:00+08:00',
    last_out: '2026-11-06T15:00:00+08:00',
    worked_seconds: 8 * 3600,
  }), null);
});

test('malformed rows never produce a break figure', () => {
  for (const row of [null, {}, { first_in: 'nope', last_out: 'nope' },
                     { first_in: '2026-11-06T07:00:00+08:00', last_out: '2026-11-06T17:00:00+08:00', worked_seconds: 'x' }]) {
    assert.equal(breakSeconds(row), null, JSON.stringify(row));
  }
});

test('the break threshold is high enough to exclude noise', () => {
  // Every multi-IN day has some gap; a five-minute one is not information.
  assert.ok(BREAK_NOTICE_SECONDS >= 15 * 60, 'too low — a smoke break would show');
  assert.ok(BREAK_NOTICE_SECONDS <= 60 * 60, 'too high — a lunch would be hidden');
});

// ---- formatting ----

test('overtime reads as over, short, or exactly expected', () => {
  assert.equal(fmtOvertime(45), '45m over');
  assert.equal(fmtOvertime(-30), '30m short');
  assert.equal(fmtOvertime(0), 'exactly expected');
  assert.equal(fmtOvertime(95), '1h 35m over');
  assert.equal(fmtOvertime(-120), '2h 00m short');
});

// null means the server declined to judge — no expected hours, or a day
// flagged for review. Printing "0m over" would assert what it refused to.
test('an unmeasured day renders nothing at all', () => {
  for (const bad of [null, undefined, '', NaN, 'abc']) {
    assert.equal(fmtOvertime(bad), null, String(bad));
  }
});

test('hour totals round and never show a bare zero-minute tail', () => {
  assert.equal(fmtHoursTotal(12840), '214h');
  assert.equal(fmtHoursTotal(90), '1h 30m');
  assert.equal(fmtHoursTotal(45), '45m');
  assert.equal(fmtHoursTotal(0), '0h');
  assert.equal(fmtHoursTotal(-5), '0h');
  assert.equal(fmtHoursTotal(null), '0h');
});

// The grace period has an equivalent here: nothing. The client does not know
// expected_minutes, so it must not infer over/short from anything else.
test('over and short come from the server figure only', () => {
  assert.equal(isOver({ overtime_minutes: 10 }), true);
  assert.equal(isShort({ overtime_minutes: -10 }), true);
  assert.equal(isOver({ overtime_minutes: 0 }), false);
  assert.equal(isShort({ overtime_minutes: 0 }), false);
  assert.equal(isOver({ overtime_minutes: null }), false);
  assert.equal(isShort({ overtime_minutes: null }), false);
  // A long day with no expected hours configured is not overtime.
  assert.equal(isOver({ worked_seconds: 14 * 3600 }), false);
  assert.equal(isOver(null), false);
  assert.equal(isShort(null), false);
});

// ---- end to end over the mapper ----

test('a real summary row drives the overtime strip', () => {
  const live = toSummary({
    row_count: 3345, employees: 361, worked_seconds: 1e7, open_punches: 382, anomalies: 4,
    on_time: 2400, late_days: 300, unclassified: 645, avg_first_in_seconds: 25920,
    rules_configured: true,
    overtime_minutes: 12840, short_minutes: 3720, over_days: 214, short_days: 62,
    unmeasured_days: 386, expected_configured: true,
  });
  assert.equal(overtimeState(live), OVERTIME_STATE.READY);
  assert.equal(measuredDays(live), 2959);
  assert.equal(fmtHoursTotal(live.overtimeMinutes), '214h');
  assert.equal(fmtHoursTotal(live.shortMinutes), '62h');
});

test('punctuality configured without expected hours leaves overtime off', () => {
  const live = toSummary({
    row_count: 3345, on_time: 2400, late_days: 300, rules_configured: true,
    unmeasured_days: 3345, expected_configured: false,
  });
  assert.equal(overtimeState(live), OVERTIME_STATE.UNCONFIGURED);
});

// ---- migration invariants ----

const sql = (name) => readFileSync(fileURLToPath(new URL(`../Supabase/migrations/${name}`, import.meta.url)), 'utf8');
const code = (src) => src.split('\n').map((line) => {
  const at = line.indexOf('--');
  return at === -1 ? line : line.slice(0, at);
}).join('\n');

const MIGRATION = '20261106090000_overtime_and_after_hours.sql';

test('the new shift columns are all nullable with no default', () => {
  const src = code(sql(MIGRATION));
  for (const col of ['ends_at', 'expected_minutes', 'after_hours_margin_minutes']) {
    assert.ok(new RegExp(`ADD COLUMN ${col}\\b`).test(src), `${col} must be added`);
    assert.ok(!new RegExp(`ADD COLUMN ${col}[^;]*\\bNOT NULL`, 'i').test(src), `${col} must stay nullable`);
    assert.ok(!new RegExp(`ADD COLUMN ${col}[^;]*\\bDEFAULT`, 'i').test(src), `${col} must have no default`);
  }
});

// A flagged day's hours are not final: open_punch under-counts by the whole
// afternoon, and anomaly excludes a negative gap. Reporting either as a huge
// short day would be a confident wrong number about hours.
test('no overtime is reported for a day flagged for review', () => {
  const src = code(sql(MIGRATION));
  const guards = src.match(/when .*opened or .*anom then null/g) || [];
  assert.equal(guards.length, 2, 'both the report and the summary need the flagged-day guard');
});

test('after-hours detection can never roll back a scan', () => {
  const src = code(sql(MIGRATION));
  const body = src.slice(src.indexOf('CREATE FUNCTION public.trg_detect_after_hours'));
  assert.ok(/exception\s+when others then/i.test(body), 'needs an exception guard');
  const guard = body.slice(body.search(/exception\s+when others then/i));
  assert.ok(!/raise\s/i.test(guard.slice(0, 200)), 'the handler must not re-raise');
});

// The margin is the off switch, and off is the default. Setting shift hours
// for a report must not silently start generating security alerts.
test('after-hours alerting is opt-in and needs all three settings', () => {
  const src = code(sql(MIGRATION));
  const body = src.slice(src.indexOf('CREATE FUNCTION public.trg_detect_after_hours'));
  assert.ok(body.includes('if v_margin is null or v_starts is null or v_ends is null then'),
    'must bail unless margin, start and end are all set');
  assert.ok(/raise exception 'an after-hours margin needs a shift end time'/.test(src),
    'set_shift_rule must refuse a margin with no end time');
});

// A night shift's allowed window wraps midnight, so "inside" is the union of
// two spans rather than the gap between them.
test('the after-hours window handles a shift that crosses midnight', () => {
  const src = code(sql(MIGRATION));
  const body = src.slice(src.indexOf('CREATE FUNCTION public.trg_detect_after_hours'));
  assert.ok(body.includes('if v_open <= v_close then'), 'needs the non-wrapping branch');
  assert.ok(body.includes('v_inside := v_minute >= v_open or v_minute <= v_close'),
    'the wrapping branch must be a union, not a range');
  // (x - margin) can go negative, and % on a negative stays negative in
  // Postgres, so the + 1440 is load-bearing rather than decorative.
  assert.ok(body.includes('+ 1440) % 1440'), 'the window must be normalised into 0..1439');
});

test('the old 3-argument set_shift_rule is dropped, not left as an overload', () => {
  const src = code(sql(MIGRATION));
  // PostgREST resolves by argument name, so a surviving overload would let a
  // stale client keep saving rules that silently discard the end time.
  assert.ok(src.includes('DROP FUNCTION public.set_shift_rule(text, time, integer);'),
    'the narrower signature must be dropped');
});

test('the migration reloads the PostgREST schema cache', () => {
  assert.ok(/NOTIFY\s+pgrst\s*,\s*'reload schema'/i.test(code(sql(MIGRATION))));
});
