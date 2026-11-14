// The archive horizon, and why it is a SECOND setting rather than the same
// one worded twice.
//
// "Keep scan history for N days" sounds like one idea and is two, because
// the two jobs remove different things from different places:
//
//   archive_old_scan_events()  MOVES scan_events rows to the archive.
//     Nothing is lost — get_scan_events_page() unions both tables, so an
//     export over any range is unaffected. What the horizon really controls
//     is how far back SCANNER ANALYTICS AND THE DASHBOARD can see, because
//     get_scanner_performance_stats(), get_scanner_scan_details() and the
//     scan feed read the live table only.
//
//   trim_employee_scan_logs()  DELETES employees.scan_logs entries, which
//     is how far back ATTENDANCE can report.
//
// Folding both into one number would mean an operator choosing a faster live
// table silently truncated payroll history to the same figure. The defaults
// differ for the same reason: trimming starts off because it destroys,
// archiving stays at 180 because it does not.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ARCHIVE_CHOICES, ARCHIVE_MIN_DAYS, RETENTION_CHOICES,
  archiveSummary, isValidArchiveDays, isValidRetentionDays,
} from '../JS/Utils/retention.js';

const dir = fileURLToPath(new URL('../Supabase/migrations/', import.meta.url));
const read = (p) => readFileSync(dir + p, 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => { const at = l.indexOf('--'); return at === -1 ? l : l.slice(0, at); })
  .join('\n');

const raw = read('20261113180000_configurable_archive_horizon.sql');
const sql = strip(raw);
const fn = (name) => {
  const from = sql.search(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(`, 'i'));
  assert.ok(from !== -1, `could not find ${name}`);
  return sql.slice(from, sql.indexOf('$function$;', from));
};
const archive = fn('archive_old_scan_events');
const setter = fn('set_archive_days');

// ---- two settings, not one ----

test('the archive horizon is its own column, with its own effective date', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS scan_events_days integer NOT NULL DEFAULT 180/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS scan_events_effective_from date/);
});

// SUPERSEDED by 20261114120000, which made both sides default to 0. Kept as
// the record of what shipped first: archiving defaulted to 180 on the
// reasoning that relocating is free, which was true and still the wrong
// call — two adjacent panels following different rules teaches the rule
// learned from one and assumed for the other.
test('archiving originally defaulted to 180, before the rules were unified', () => {
  assert.match(sql, /scan_events_days integer NOT NULL DEFAULT 180/);
  const retention = strip(read('20261113160000_configurable_retention_with_grace.sql'));
  assert.match(retention, /scan_logs_days integer NOT NULL DEFAULT 0/);
});

test('the two horizons are never read from each other', () => {
  assert.match(archive, /select scan_events_days, scan_events_effective_from/);
  assert.ok(!/scan_logs_days/.test(archive),
    'a faster live table must not quietly truncate attendance history');
});

// ---- the grace period, same mechanism ----

test('a change waits for the next local day, exactly as the trim does', () => {
  assert.match(setter, /\(\(now\(\) at time zone v_tz\)::date \+ 1\)/);
  assert.match(archive, /\(now\(\) at time zone coalesce\(v_tz, 'Asia\/Manila'\)\)::date < v_from/);
});

// SUPERSEDED by 20261114120000. When archiving shipped already-on at 180, a
// NULL effective date had to mean "in force" or applying the migration would
// have switched it off for everyone. Once both sides default to 0 that case
// cannot arise, and the trim's stricter rule applies to both.
test('archiving originally treated an absent date as "already in force"', () => {
  assert.match(archive, /if v_from is not null\s*\n\s*and \(now\(\)/,
    'the wait was conditional on a date actually being set');
  assert.match(sql, /'archive_active_now', r\.scan_events_days > 0\s*\n\s*and \(r\.scan_events_effective_from is null/);
});

// ---- and then the two were made the same ----

const unified = strip(read('20261114120000_archive_matches_trim_semantics.sql'));
const unifiedArchive = unified.slice(
  unified.indexOf('CREATE OR REPLACE FUNCTION public.archive_old_scan_events'),
  unified.indexOf('$function$;', unified.indexOf('CREATE OR REPLACE FUNCTION public.archive_old_scan_events')),
);

test('both horizons now default to 0', () => {
  assert.match(unified, /ALTER COLUMN scan_events_days SET DEFAULT 0/);
  // A default alone would have changed nothing: this table holds exactly one
  // row by construction, and that row already existed with 180 in it.
  assert.match(unified, /SET scan_events_days = 0,\s*\n\s*scan_events_effective_from = NULL/);
});

test('the archive guard is now the trim guard, character for character', () => {
  const trimSrc = strip(read('20261113160000_configurable_retention_with_grace.sql'));
  const shape = /if v_from is null\s*\n?\s*or \(now\(\) at time zone coalesce\(v_tz, 'Asia\/Manila'\)\)::date < v_from then/;
  assert.match(unifiedArchive, shape, 'null must now mean "do nothing", as it does for the trim');
  assert.match(trimSrc, shape);
  assert.ok(!/if v_from is not null/.test(unifiedArchive),
    'the fail-open form is gone');
});

test('an absent row means off on both sides, not 180', () => {
  assert.match(unifiedArchive, /if coalesce\(v_set_days, 0\) = 0 then/);
  assert.ok(!/coalesce\(v_set_days, 180\)/.test(unifiedArchive));
});

// The readout and the job have to agree about whether something is running.
// The old expression reported active while the job refused, which is the
// specific disagreement this project keeps finding and removing.
test('archive_active_now now requires a date, exactly as active_now does', () => {
  assert.match(unified, /'archive_active_now', r\.scan_events_days > 0\s*\n\s*and r\.scan_events_effective_from is not null\s*\n\s*and v_today >= r\.scan_events_effective_from/);
  assert.match(unified, /'active_now', r\.scan_logs_days > 0\s*\n\s*and r\.effective_from is not null\s*\n\s*and v_today >= r\.effective_from/);
});

// The two things that stay different, both deliberate and both asked for.
test('the floors still differ, and the wording still tells the truth', () => {
  assert.equal(ARCHIVE_MIN_DAYS, 30);
  assert.equal(isValidRetentionDays(30), false);
  const off = archiveSummary({ scan_events_days: 0 });
  assert.ok(!/delete/i.test(off), 'archiving never deletes, however the rules are aligned');
});

// ---- the floor, and what it protects ----

// Superseded by 20261114090000, which taught the drilldown to read the
// archive and then lowered this floor to 30. Kept as the record of what the
// floor was protecting, since that is why it could not simply be lowered.
test('the original floor was 90, set against the analytics window', () => {
  assert.match(setter, /raise exception 'archive horizon must be 0 \(never archive\) or between 90 and 3650 days'/);
  assert.match(sql, /CHECK \(scan_events_days = 0 OR \(scan_events_days >= 90 AND scan_events_days <= 3650\)\)/);
});

test('0 is allowed, and means never archive rather than archive everything', () => {
  assert.match(archive, /if coalesce\(v_set_days, 180\) = 0 then\s*\n\s*return query select 0, null::timestamptz;/);
});

test('an override can only keep MORE live, never less', () => {
  assert.match(archive, /greatest\(coalesce\(v_set_days, 180\), coalesce\(p_older_than_days, coalesce\(v_set_days, 180\)\)\)/);
});

test('the schedule stopped hardcoding 180 over the setting', () => {
  assert.match(sql, /\$\$SELECT public\.archive_old_scan_events\(\)\$\$/);
  assert.ok(!/\$\$SELECT public\.archive_old_scan_events\(180\)\$\$/.test(sql));
  assert.ok(sql.indexOf('cron.unschedule') < sql.indexOf('cron.schedule'));
});

// ---- it still moves rather than deletes ----

test('archiving is still a move, and the test says so out loud', () => {
  assert.match(archive, /DELETE FROM public\.scan_events/);
  assert.match(archive, /INSERT INTO public\.scan_events_archive/);
  assert.ok(archive.indexOf('DELETE FROM') < archive.indexOf('INSERT INTO'));
});

// The claim the panel wording rests on. If the export ever stops unioning
// the archive, lowering this horizon starts truncating exports and the
// reassuring sentence becomes a lie.
test('exports still read both tables, which is what makes this reversible', () => {
  const page = strip(read('20261111120000_scan_log_export_row_cap.sql'));
  assert.match(page, /union all/i);
  assert.match(page, /from public\.scan_events_archive/i);
});

// ---- the preview ----

test('the archive preview uses the index rather than a filtered aggregate', () => {
  const preview = fn('preview_scan_events_archive');
  assert.match(preview, /where scanned_at < v_cutoff/);
  assert.ok(!/count\(\*\) filter/.test(preview),
    'a filtered aggregate would seq-scan 183,000 rows to answer the same question');
});

test('nothing puts either preview on a timer', () => {
  const all = readdirSync(dir).filter((f) => f.endsWith('.sql')).map(read).join('\n');
  assert.ok(!/cron\.schedule\([^)]*preview_scan_events_archive/s.test(all));
});

// ---- guards ----

test('the setter is admin-only and attributed', () => {
  assert.match(setter, /if not public\.is_admin\(\) then/);
  assert.match(setter, /log_audit_event\(\s*\n?\s*'archive_horizon_changed'/);
});

test('execute is revoked from PUBLIC and anon on both new functions', () => {
  for (const sig of ['set_archive_days\\(integer\\)', 'preview_scan_events_archive\\(integer\\)']) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM PUBLIC;`));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${sig} FROM anon;`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${sig} TO authenticated;`));
  }
  assert.match(sql, /NOTIFY pgrst, 'reload schema';/);
});

test('the migration says how to prove the grace without waiting a day', () => {
  assert.match(raw, /-- VERIFY/);
  assert.match(raw, /should_be_false/);
  assert.match(raw, /rollback;/);
});

// ---- the wording ----

// The whole reason these are two settings is that they cost different
// things. If the two sentences ever converge, the distinction is gone from
// the only place a user actually meets it.
test('the archive wording never says deleted, and names what is lost instead', () => {
  const on = archiveSummary({ scan_events_days: 180, archive_active_now: true });
  assert.match(on, /Analytics and the Dashboard can look back 180 days/);
  assert.match(on, /stay in exports/);
  assert.ok(!/delete/i.test(on), 'archiving loses nothing — saying deleted would be wrong and alarming');
});

test('never-archive warns about growth rather than reassuring', () => {
  const off = archiveSummary({ scan_events_days: 0 });
  assert.match(off, /keep growing/);
});

test('a pending archive change says when it starts', () => {
  const pending = archiveSummary({
    scan_events_days: 90, archive_active_now: false, archive_effective_from: '2026-11-15',
  });
  assert.match(pending, /takes effect on 2026-11-15/i);
});

test('an unknown archive setting says so rather than guessing', () => {
  assert.match(archiveSummary(null), /unknown/i);
  assert.match(archiveSummary({}), /unknown/i);
});

test('every offered archive choice is one the server accepts', () => {
  for (const c of ARCHIVE_CHOICES) {
    if (c.disabled) continue;
    assert.ok(isValidArchiveDays(c.value), `the picker offers ${c.value}, which would be refused`);
  }
  // The two dropdowns must hold the same rows in the same order — that was
  // the reported inconsistency. Only which rows are selectable differs.
  assert.deepEqual(
    ARCHIVE_CHOICES.map((c) => c.value),
    RETENTION_CHOICES.map((c) => c.value),
    'both panels offer the same horizons; the floors decide what is selectable',
  );
  assert.equal(ARCHIVE_CHOICES.find((c) => c.value === 30)?.disabled, false,
    '30 is selectable for archiving');
  assert.equal(RETENTION_CHOICES.find((c) => c.value === 30)?.disabled, true,
    'and not for trimming, with the reason on the row');
  assert.equal(ARCHIVE_CHOICES[0].value, 0);
  // Was asserted the other way round, when archiving deliberately read
  // "Never" to distinguish it from the trim's "Off". 20261114120000 made the
  // two sides follow one rule, so the two labels should read alike too.
  assert.match(ARCHIVE_CHOICES[0].label, /^Off —/,
    'both panels now start off and wait to be chosen');
  assert.match(RETENTION_CHOICES[0].label, /^Off —/);
});

// ---- the floor came down, and only after it was made safe ----

const lower = strip(read('20261114090000_archive_horizon_down_to_30.sql'));

test('the archive floor is 30 and the trim floor is still 90', () => {
  assert.match(lower, /CHECK \(scan_events_days = 0 OR \(scan_events_days >= 30 AND scan_events_days <= 3650\)\)/);
  assert.match(lower, /raise exception 'archive horizon must be 0 \(never archive\) or between 30 and 3650 days'/);
  assert.ok(!/scan_logs_days = 0 OR \(scan_logs_days >= 30/.test(lower),
    'the trim DELETES and get_attendance_report asks for 31-day ranges — its floor must stay 90');
});

test('the client floors agree with the server, and differ from each other', () => {
  assert.equal(ARCHIVE_MIN_DAYS, 30);
  assert.equal(isValidArchiveDays(30), true);
  assert.equal(isValidArchiveDays(29), false);
  assert.equal(isValidArchiveDays(0), true);
  // The trim's validator must NOT have moved with it.
  assert.equal(isValidRetentionDays(30), false,
    'a 30-day trim horizon would race the attendance report it is deleting under');
});

test('a nullish archive horizon is not mistaken for "never"', () => {
  for (const bad of [null, undefined, NaN, '30', 30.5]) {
    assert.equal(isValidArchiveDays(bad), false, `${String(bad)} should not validate`);
  }
});

// THE REASON THE FLOOR COULD NOT SIMPLY BE LOWERED. Scanner Analytics reads
// the live table, and its drilldown window is 90 days. At a 30-day horizon,
// days 31-90 would have been silently empty.
// THE MISTAKE THIS PINS. The first attempt reconstructed the signature from
// the SELECT list and failed on apply: "cannot change return type of
// existing function". The real OUT columns are scan_id and employee_name,
// and the real parameter order is (p_days, p_filter, p_scanner_id, p_limit).
// The signature stayed (integer, text, text, integer) either way, which is
// what makes the guess dangerous rather than merely wrong.
test('the drilldown keeps the exact signature it already had', () => {
  const original = strip(read('20260928080000_scanner_analytics_drilldown.sql'));
  const sigOf = (src) => {
    const from = src.indexOf('CREATE OR REPLACE FUNCTION public.get_scanner_scan_details');
    const to = src.indexOf('LANGUAGE plpgsql', from);
    return src.slice(from, to).replace(/\s+/g, ' ').trim();
  };
  assert.equal(sigOf(lower), sigOf(original),
    'parameters and OUT columns must match the live function character for character, '
    + 'or CREATE OR REPLACE refuses and the migration cannot apply');
});

test('the body still maps onto those OUT columns in order', () => {
  const details = lower.slice(lower.indexOf('CREATE OR REPLACE FUNCTION public.get_scanner_scan_details'));
  assert.match(details, /#variable_conflict use_column/,
    'scanned_at, scanner_id and result are all both OUT parameters and column names');
  const outer = details.slice(details.indexOf('select r.id'));
  const cols = outer.slice(0, outer.indexOf('from rows_in_window'));
  assert.match(cols, /r\.id,\s*\n\s*r\.scanned_at,\s*\n\s*e\.full_name/,
    'scan_id, scanned_at, employee_name — positional, so the order is the contract');
});

test('the drilldown now reads the archive, so its window survives a short horizon', () => {
  const details = lower.slice(lower.indexOf('CREATE OR REPLACE FUNCTION public.get_scanner_scan_details'));
  assert.match(details, /union all/i);
  assert.match(details, /from public\.scan_events_archive sa/);
  assert.match(details, /least\(coalesce\(p_days, 7\), 90\)/, 'the 90-day window itself is unchanged');
});

// Inside either branch it would report that branch's size, and pagination
// would be wrong by exactly the number of archived rows.
test('the total is counted over the combined set, not one branch', () => {
  const details = lower.slice(lower.indexOf('CREATE OR REPLACE FUNCTION public.get_scanner_scan_details'));
  // Bounded to the CTE body. Slicing at `from rows_in_window r` does not
  // work: a SELECT's column list precedes its FROM, so count(*) over ()
  // always lands in the first half however correct the query is.
  const cteStart = details.indexOf('with rows_in_window as (');
  const cteEnd = details.indexOf('select r.id', cteStart);
  assert.ok(cteStart !== -1 && cteEnd > cteStart, 'could not isolate the CTE');
  assert.ok(!/count\(\*\) over \(\)/.test(details.slice(cteStart, cteEnd)),
    'inside the union it would report one branch, and pagination would be short by the archived rows');
  assert.match(details.slice(cteEnd), /count\(\*\) over \(\)/);
});

test('the job itself floors at 30, not only the constraint', () => {
  const job = lower.slice(lower.indexOf('CREATE OR REPLACE FUNCTION public.archive_old_scan_events'));
  assert.match(job, /v_days := greatest\(30, coalesce\(v_set_days, 180\)\)/,
    'a row written before this migration must not push the cutoff nearer than the drilldown reaches');
});

// The half that could not be done here. If this function ever gains a
// migration, this test should be replaced by one asserting it unions too.
test('the unfixed half is named, with the command to capture it', () => {
  const rawLower = read('20261114090000_archive_horizon_down_to_30.sql');
  assert.match(rawLower, /get_scanner_performance_stats/);
  assert.match(rawLower, /pg_get_functiondef/,
    'the migration must say how to obtain what it could not read');
  const drift = readFileSync(fileURLToPath(new URL('../test/schema-drift.test.mjs', import.meta.url)), 'utf8');
  assert.match(drift, /'get_scanner_performance_stats'/,
    'still live-only; when that changes, give it the same union');
});

// ---- the panel ----

test('the archive panel loads the setting and keeps its preview separate', () => {
  const page = readFileSync(fileURLToPath(new URL('../JS/Features/Settings/SettingsPage.js', import.meta.url)), 'utf8');
  const from = page.indexOf('async function loadArchiveStatus');
  const to = page.indexOf('async function saveArchiveDays', from);
  assert.ok(from !== -1 && to > from, 'could not isolate loadArchiveStatus');
  assert.match(page.slice(from, to), /RetentionModel\.get\(\)/);
  assert.match(page, /let archivePreview = null;/);
  assert.ok(!/archivePreview = trimPreview|trimPreview = archivePreview/.test(page),
    'one preview under the other heading is exactly the confusion these panels invite');
});

test('a failed read explains itself in the archive panel too', () => {
  const page = readFileSync(fileURLToPath(new URL('../JS/Features/Settings/SettingsPage.js', import.meta.url)), 'utf8');
  assert.match(page, /Archive horizon control unavailable/);
});

// ---- the three reported inconsistencies ----

const page = () => readFileSync(fileURLToPath(new URL('../JS/Features/Settings/SettingsPage.js', import.meta.url)), 'utf8');

// Reported: the archive badge read `never` in red while the trim read `off`
// in grey, for the same state on two adjacent panels.
test('the off badge is identical on both panels', () => {
  const src = page();
  // [\w-]+ not \w+: the class is `role-viewer`, and the hyphen silently made
  // this match nothing at all rather than fail loudly.
  const badges = [...src.matchAll(/=== 0 \? '<span class="badge ([\w-]+)">(\w+)<\/span>'/g)]
    .map((m) => `${m[1]}:${m[2]}`);
  assert.equal(badges.length, 2, 'expected one off-badge per panel');
  assert.equal(badges[0], badges[1], `the two off badges differ: ${badges.join(' vs ')}`);
});

// Reported: both descriptions said "180 days" whatever the picker showed.
test('neither description hardcodes a horizon', () => {
  const src = page();
  // To end of line, not to the next quote: one note is in double quotes and
  // contains "employee's", so a quote-terminated match stopped mid-sentence
  // and then failed on text it had truncated itself.
  const notes = [...src.matchAll(/A nightly job[^\n]*/g)].map((m) => m[0]);
  assert.ok(notes.length >= 2, 'expected both panel notes');
  for (const n of notes) {
    assert.ok(!/\d+\s*days/.test(n), `a panel note still states a fixed horizon: ${n}`);
    assert.match(n, /set below/, 'it should point at the control instead');
  }
});

test('the disabled attribute actually reaches both dropdowns', () => {
  const src = page();
  const withDisabled = [...src.matchAll(/c\.disabled \? ' disabled' : ''/g)];
  assert.equal(withDisabled.length, 2, 'both pickers must render the disabled rows as disabled');
});
