// The notification picker against the kinds the database actually raises.
//
// THE BUG THIS CATCHES. Three of the five options the picker used to offer
// were strings no migration has ever passed to raise_alert():
// `unassigned_card` and `inactive_card` are scan_events.result values, and
// `impossible_travel` was removed by 20261008140000 — after which the only
// occurrence left in the entire repository was the picker entry itself.
//
// An alert_channels row carrying one of those saves cleanly, renders as
// configured, and delivers nothing, forever. There is no error anywhere and
// no way to tell it apart from a site where nothing has gone wrong. That is
// the shape of bug a drift test exists for: two lists that must agree, kept
// in agreement by remembering.
//
// Same guard test/scan-sounds.test.mjs applies to the six sound filenames.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALERT_KINDS, UNLISTED_ALERT_KINDS, alertKindLabel, isDeadAlertKind } from '../JS/Utils/alertKinds.js';

const dir = fileURLToPath(new URL('../Supabase/migrations/', import.meta.url));

// Comments stripped before matching. These files explain themselves at
// length, and 20261008140000's header discusses the alerts it is REMOVING —
// a raw search would find `impossible_travel` in the prose that says it is
// gone and conclude it is still raised. The same trap caught the `2>&1` and
// `SET LOCAL` assertions in the Invoke-Sql tests.
const code = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => { const at = line.indexOf('--'); return at === -1 ? line : line.slice(0, at); })
  .join('\n');

const raisedKinds = (() => {
  const found = new Set();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.sql')) continue;
    const sql = code(readFileSync(dir + name, 'utf8'));
    for (const m of sql.matchAll(/raise_alert\(\s*'([a-z0-9_]+)'/gi)) found.add(m[1]);
  }
  return found;
})();

const picker = ALERT_KINDS.map((k) => k.value).filter((v) => v !== '');

test('the migrations really do raise alerts, so an empty scan is not a pass', () => {
  assert.ok(raisedKinds.size >= 5,
    `only found ${raisedKinds.size} raise_alert kinds — the regex or the path is wrong, `
    + 'and every assertion below would pass vacuously');
});

// The assertion that would have caught the shipped bug.
test('every kind the picker offers is one raise_alert actually produces', () => {
  for (const value of picker) {
    assert.ok(raisedKinds.has(value),
      `Settings offers "${value}" but no migration ever raises it — a channel routed `
      + 'to it would deliver nothing and look configured');
  }
});

test('every kind that fires is routable, unless deliberately unlisted', () => {
  for (const kind of raisedKinds) {
    if (UNLISTED_ALERT_KINDS.includes(kind)) continue;
    assert.ok(picker.includes(kind),
      `raise_alert emits "${kind}" but Settings cannot route it. Add it to ALERT_KINDS, `
      + 'or to UNLISTED_ALERT_KINDS with a reason if that is deliberate');
  }
});

// Named individually because this one is the reason the feature exists: one
// badge seen at two gates, severity critical, and it was unroutable.
test('card sharing between sites can be routed', () => {
  assert.ok(raisedKinds.has('card_shared_between_sites'));
  assert.ok(picker.includes('card_shared_between_sites'));
});

// Regression pins. If any of these ever comes back into the list it means
// someone reached for scan_events.result again, which is where they came from.
test('the three dead options stay gone', () => {
  for (const dead of ['unassigned_card', 'inactive_card', 'impossible_travel']) {
    assert.ok(!picker.includes(dead), `"${dead}" is not an alert kind and never was`);
    assert.ok(!raisedKinds.has(dead), `if the database now raises "${dead}", this test is the stale one`);
  }
});

test('the empty value still means every kind', () => {
  assert.equal(ALERT_KINDS[0].value, '', 'NULL in alert_channels.kind is "all", and it leads the list');
  assert.equal(alertKindLabel(''), 'Every alert');
  assert.equal(alertKindLabel(null), 'Every alert', 'a NULL column reads as the empty value');
  assert.equal(isDeadAlertKind(null), false, 'NULL routes everything — it is the opposite of dead');
  assert.equal(isDeadAlertKind(''), false);
});

// An existing row saved under the old list has to be legible, not echoed.
// Rendering `impossible_travel` bare reads as a working rule with an odd
// name; it is the one row guaranteed to deliver nothing.
test('a stored dead kind announces itself rather than looking configured', () => {
  assert.equal(isDeadAlertKind('impossible_travel'), true);
  assert.match(alertKindLabel('impossible_travel'), /no longer raised/);
  assert.equal(isDeadAlertKind('after_hours_scan'), false);
  assert.equal(isDeadAlertKind('test_notification'), false,
    'deliberately unlisted is not the same as dead — it does fire');
});

test('Settings renders the dead case through the shared helper', () => {
  const page = readFileSync(fileURLToPath(new URL('../JS/Features/Settings/SettingsPage.js', import.meta.url)), 'utf8');
  assert.match(page, /alertKindLabel, isDeadAlertKind/);
  assert.match(page, /isDeadAlertKind\(c\.kind\)/);
  assert.ok(!/\.find\(\(x\) => x\.value === \(k \|\| ''\)\)\?\.label \|\| k/.test(page),
    'the old fallback echoed an unrecognised kind back as though it worked');
});

test('every label is sentence case and names the event', () => {
  for (const { label } of ALERT_KINDS) {
    assert.ok(label.length > 0);
    assert.ok(!/^[a-z]/.test(label), `"${label}" should start capitalised`);
    assert.ok(!/_/.test(label), `"${label}" is a raw kind, not a label`);
  }
});
