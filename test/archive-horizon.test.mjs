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
  ARCHIVE_CHOICES, archiveSummary, isValidRetentionDays,
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

// The asymmetry is the point: one job destroys and starts off, the other
// relocates and keeps running.
test('archiving defaults to 180 while trimming defaults to 0', () => {
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

// A NULL effective date means the stored 180 has been running all along,
// which must not be mistaken for a change that has not landed yet — that
// would switch archiving off for everyone on upgrade.
test('an absent effective date means "already in force", not "waiting"', () => {
  assert.match(archive, /if v_from is not null\s*\n\s*and \(now\(\)/,
    'the wait must be conditional on a date actually being set');
  assert.match(sql, /'archive_active_now', r\.scan_events_days > 0\s*\n\s*and \(r\.scan_events_effective_from is null/);
});

// ---- the floor, and what it protects ----

test('below 90 is refused, because analytics reads the live table only', () => {
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
    assert.ok(isValidRetentionDays(c.value), `the picker offers ${c.value}, which would be refused`);
  }
  assert.equal(ARCHIVE_CHOICES[0].value, 0);
  assert.match(ARCHIVE_CHOICES[0].label, /Never/,
    '0 means never archive here, not "off" — the live table still keeps everything');
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
