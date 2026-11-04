import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  punctualityState, PUNCTUALITY_STATE, onTimeRate, classifiedDays,
  fmtClock, fmtOffset, isLate,
} from '../JS/Utils/punctuality.js';
import { toSummary } from '../JS/Utils/attendance.js';

const ready = { rulesConfigured: true, onTime: 84, lateDays: 16, unclassified: 0 };

// The three states exist because "no shift time is set" and "this filter
// matched nothing" look identical in the counts, and only one of them is
// something the reader can act on.
test('an unset shift time is reported as unconfigured, not as zero percent', () => {
  for (const summary of [
    { rulesConfigured: null, onTime: 0, lateDays: 0 },
    { rulesConfigured: false, onTime: 0, lateDays: 0 },
    {},
    null,
  ]) {
    assert.equal(punctualityState(summary), PUNCTUALITY_STATE.UNCONFIGURED);
  }
});

// The important precedence: with no rules configured there is nothing to
// judge, so claiming "no data" would imply the setting was fine and the range
// was empty.
test('unconfigured beats no-data even when rows exist', () => {
  assert.equal(
    punctualityState({ rulesConfigured: false, onTime: 0, lateDays: 0, unclassified: 500 }),
    PUNCTUALITY_STATE.UNCONFIGURED,
  );
});

test('configured rules with nothing judged is no-data, not ready', () => {
  assert.equal(
    punctualityState({ rulesConfigured: true, onTime: 0, lateDays: 0, unclassified: 40 }),
    PUNCTUALITY_STATE.NO_DATA,
  );
});

test('configured rules with judged days is ready', () => {
  assert.equal(punctualityState(ready), PUNCTUALITY_STATE.READY);
});

// A displayed 0% reads as "every single person was late", which is a finding.
// An absent figure reads as "we cannot say", which is the truth.
test('an empty set has no on-time rate rather than a rate of zero', () => {
  assert.equal(onTimeRate({ rulesConfigured: true, onTime: 0, lateDays: 0 }), null);
  assert.equal(onTimeRate({}), null);
  assert.equal(onTimeRate(null), null);
});

test('the on-time rate divides by judged days only', () => {
  // 84 of 100 judged; the 900 unclassified days must not dilute it.
  assert.equal(onTimeRate({ rulesConfigured: true, onTime: 84, lateDays: 16, unclassified: 900 }), 84);
  assert.equal(classifiedDays({ onTime: 84, lateDays: 16, unclassified: 900 }), 100);
});

test('the rate is a whole percent', () => {
  assert.equal(onTimeRate({ onTime: 2, lateDays: 1 }), 67);
  assert.equal(onTimeRate({ onTime: 1, lateDays: 2 }), 33);
  assert.equal(onTimeRate({ onTime: 1, lateDays: 0 }), 100);
});

// Counts arriving as strings is normal for bigint over PostgREST.
test('counts that arrive as strings still divide correctly', () => {
  assert.equal(onTimeRate({ onTime: '84', lateDays: '16' }), 84);
});

// 0 is a real clock time, so a missing average must not render as 00:00.
test('a missing average arrival is absent, not midnight', () => {
  for (const bad of [null, undefined, '', NaN, -1, 'abc']) {
    assert.equal(fmtClock(bad), null, String(bad));
  }
  // But a genuine midnight arrival is a legitimate value and must survive.
  assert.equal(fmtClock(0), '0:00');
});

test('seconds past midnight format as a clock time', () => {
  assert.equal(fmtClock(25920), '7:12');
  assert.equal(fmtClock(3600), '1:00');
  assert.equal(fmtClock(43200), '12:00');
  assert.equal(fmtClock(86399), '23:59');
});

// A mean of clock times can round up to exactly 86400, which would print as
// the nonexistent "24:00".
test('an average that rounds to a full day wraps instead of printing 24:00', () => {
  assert.equal(fmtClock(86400), '0:00');
  assert.equal(fmtClock(86399.7), '0:00');
});

test('an offset reads as late, early, or exactly on the minute', () => {
  assert.equal(fmtOffset(12), '12m late');
  assert.equal(fmtOffset(-5), '5m early');
  assert.equal(fmtOffset(0), 'on the minute');
  assert.equal(fmtOffset(95), '1h 35m late');
  assert.equal(fmtOffset(-120), '2h 00m early');
});

// null means the server declined to judge the day — no rule, or past the
// 12-hour guard. Rendering "on time" there would assert what it refused to.
test('an unjudged offset renders nothing at all', () => {
  for (const bad of [null, undefined, '', NaN, 'abc']) {
    assert.equal(fmtOffset(bad), null, String(bad));
  }
});

// The grace period never reaches the browser, so deriving lateness from the
// offset would silently ignore it: 3 minutes past a start with 5 minutes of
// grace is ON TIME, and offset > 0 would call it late.
test('lateness comes from the server flag, never from the offset sign', () => {
  assert.equal(isLate({ late: true, first_in_offset_minutes: 12 }), true);
  assert.equal(isLate({ late: false, first_in_offset_minutes: 3 }), false);
  assert.equal(isLate({ late: null, first_in_offset_minutes: 400 }), false);
  assert.equal(isLate({ first_in_offset_minutes: 99 }), false);
  assert.equal(isLate({}), false);
  assert.equal(isLate(null), false);
});

// End to end over the mapper, since that is the real path: RPC row ->
// toSummary -> panel state.
test('a real summary row drives the panel state it should', () => {
  const live = toSummary({
    row_count: 3345, employees: 361, worked_seconds: 1000, open_punches: 382, anomalies: 4,
    on_time: 2400, late_days: 300, unclassified: 645, avg_first_in_seconds: 25920,
    rules_configured: true,
  });
  assert.equal(punctualityState(live), PUNCTUALITY_STATE.READY);
  assert.equal(onTimeRate(live), 89);
  assert.equal(fmtClock(live.avgFirstInSeconds), '7:12');
  assert.equal(classifiedDays(live), 2700);
});

test('the same row with no rules configured shows no figures', () => {
  const live = toSummary({
    row_count: 3345, employees: 361, on_time: 0, late_days: 0, unclassified: 3345,
    avg_first_in_seconds: 25920, rules_configured: false,
  });
  assert.equal(punctualityState(live), PUNCTUALITY_STATE.UNCONFIGURED);
});

// ---- migration invariants ----
//
// These assert properties of the SQL that no JS test can reach but that the
// features depend on. Source-level, in the same spirit as the CSS contract
// tests in nav-groups.test.mjs.

const sql = (name) => readFileSync(fileURLToPath(new URL(`../Supabase/migrations/${name}`, import.meta.url)), 'utf8');

// Strips `--` line comments. Needed because these files deliberately DESCRIBE
// the patterns they avoid — the trigger's own comment explains why
// `scan_logs -> -2` is wrong, which made the first run of the array-position
// test below fail against its own rationale. Same trap as the re-export guard.
const code = (src) => src.split('\n').map((line) => {
  const at = line.indexOf('--');
  return at === -1 ? line : line.slice(0, at);
}).join('\n');

test('the punctuality migration never invents a shift start', () => {
  const src = code(sql('20261104090000_punctuality.sql'));
  // A DEFAULT on starts_at would mean creating the table silently switches
  // punctuality on for everyone against a time nobody chose.
  assert.ok(/starts_at time NOT NULL,/.test(src), 'starts_at must be NOT NULL with no default');
  assert.ok(!/starts_at time NOT NULL DEFAULT/i.test(src), 'starts_at must not have a default');
  // rules_configured is what lets the panel tell unconfigured from empty.
  assert.ok(src.includes('rules_configured'), 'the summary must report whether any rule exists');
});

test('the report declines to judge an arrival too far from its shift start', () => {
  const src = code(sql('20261104090000_punctuality.sql'));
  // 720 minutes = 12h. Without this a 22:00 shift arrived for at 01:00 reads
  // as three hours LATE when it is three hours early for the next one.
  const guards = src.match(/> 720 then null/g) || [];
  assert.equal(guards.length, 2, 'both the report and the summary need the 12-hour guard');
});

test('the shift rule resolver prefers a department over the default', () => {
  const src = code(sql('20261104090000_punctuality.sql'));
  // false sorts before true in Postgres, so the specific row wins. Inverting
  // this would make every department silently use the fallback.
  assert.ok(src.includes("ORDER BY (r.department = '*')"), 'specificity ordering must be present');
});

// The card-sharing migration's own invariants live in
// test/card-sharing.test.mjs, so each feature's tests stand alone against its
// own migration.
