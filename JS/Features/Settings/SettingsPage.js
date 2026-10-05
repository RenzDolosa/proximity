// Settings page. "Scan sounds" (Scanner-related) and "Employee photos"
// (Employee Manager-related) are each shown only when the signed-in
// account's access_scope covers that module (or they're an admin, who
// always sees both). This mirrors canViewEmployeeManager() /
// canViewScanner() in Core/state.js rather than inventing a separate
// permission scheme — see state.js for the canViewSettings() /
// settingsShowSounds() / settingsShowPhotos() / canManageScanSounds()
// helpers this file reads, and Supabase/README.md for their server-side
// mirror (can_view_settings() / can_manage_scan_sounds()). "Query
// performance" (added 2026-09-21) is unconditionally admin-only instead
// — isAdmin() directly, not one of the scope helpers above, since there's
// no partial-visibility case that makes sense for raw cross-database
// query stats the way there is for sounds/photos.
import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime, fmtBytes } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { getTheme, setTheme } from '../../Utils/theme.js';
import { appState, isAdmin, settingsShowSounds, settingsShowPhotos, canManageScanSounds, canViewScannerRegistry } from '../../Core/state.js';
import { scannersPanelHTML, mountScannersPanel } from '../../Components/ScannersPanel.js';
import { ProfilesModel } from '../../Models/ProfilesModel.js';
import { ScanSoundsModel, SOUND_KEYS, SOUND_LABELS, MAX_FILE_SIZE_BYTES } from '../../Models/ScanSoundsModel.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { QueryStatsModel } from '../../Models/QueryStatsModel.js';
import { ScanArchiveModel } from '../../Models/ScanArchiveModel.js';
import { ScanLogsTrimModel } from '../../Models/ScanLogsTrimModel.js';
import { ScannerSilenceModel } from '../../Models/ScannerSilenceModel.js';
import { UsageModel } from '../../Models/UsageModel.js';
import { fmtUsageBytes, summarizeMetric } from '../../Utils/usage.js';
import { openConfirmModal } from '../../Components/ConfirmModal.js';
import { showModalError } from '../../Components/Modal.js';

let soundsCache = {}; // key -> { updated_at, size } | null, once loaded
let loaded = false;

// Every key is capped at MAX_FILE_SIZE_BYTES by the bucket itself, so
// "all 5 at their individual max" is a real, meaningful ceiling here —
// not an arbitrary number — for the capacity bar below.
const TOTAL_CAPACITY = Object.keys(SOUND_KEYS).length * MAX_FILE_SIZE_BYTES;

let photoQuota = null; // { usage, limit, usageInDrive } once loaded, else null
let photoQuotaError = null;
let photoLoaded = false;

let queryStats = null; // array once loaded, else null
let queryStatsError = null;
let queryStatsLoaded = false;
let queryThresholdMs = 200; // matches the server-side default in get_slow_query_stats() / the log_min_duration_statement set on anon/authenticated/service_role — see Supabase/README.md

let archiveStatus = null; // { live_count, oldest_live_scanned_at, archive_count, last_archived_at, last_run } once loaded, else null
let archiveStatusError = null;
let archiveStatusLoaded = false;
let archiveRunning = false;

let trimStatus = null; // { total_entries, employees_with_entries, max_entries_for_one_employee, last_run } once loaded, else null
let trimStatusError = null;
let trimStatusLoaded = false;
let trimRunning = false;

let silenceStatus = null; // { silence_minutes, total_scanners, enabled_scanners, silent_now, last_run } once loaded, else null
let silenceStatusError = null;
let silenceStatusLoaded = false;
let silenceChecking = false;

// Usage panel. Two independent sources, tracked separately on purpose: the
// database half always works, the Management API half needs secrets that may
// never have been set. One failing must not blank the other.
let dbUsage = null;           // { database_bytes, database_limit_bytes, tables[], measured_at }
let dbUsageError = null;
let projectUsage = null;      // { period_start, period_end, metrics[], partial, notes[] }
let projectUsageError = null; // { message, code }
let usageLoaded = false;
let usageRefreshing = false;

export async function renderSettings() {
  const content = $('#content');
  const showSounds = settingsShowSounds();
  const showPhotos = settingsShowPhotos();

  content.innerHTML = `
    <div class="panel" style="padding:20px;max-width:720px;">
      <h3 style="margin:0 0 4px;">Appearance</h3>
      <p class="sub" style="margin:0 0 10px;">A personal preference for this browser — not shared with other accounts, and not saved to your profile, so it won't follow you to a different device or kiosk.</p>
      <div class="sub-nav" id="theme-picker" role="group" aria-label="Theme">
        <button type="button" data-theme-choice="dark">Dark</button>
        <button type="button" data-theme-choice="light">Light</button>
      </div>
    </div>

    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <h3 style="margin:0 0 4px;">Change password</h3>
      <p class="sub" style="margin:0 0 10px;">Update the password for your own account (${esc(appState.profile?.email || appState.session?.user?.email || '')}). This only changes what you sign in with — it's separate from an admin resetting someone else's password from Users &amp; Roles.</p>
      <form id="cp-form" autocomplete="off">
        <div class="field"><label>Current password</label>
          <!-- autocomplete="new-password" here is deliberate, not a typo: it's the
               standard cross-browser way to tell Chrome/Firefox/Edge/Safari "don't
               suggest a saved password for this field, and don't offer to save
               whatever's typed here" — there's no dedicated autocomplete token for
               "password field, no autofill, no save prompt", and the spec-correct
               "current-password" is exactly what invites both of those. This also
               drops the earlier hidden username field entirely: it existed only to
               anchor the browser's OWN autofill (the thing we're now suppressing),
               and removing it also helps avoid Chrome's post-submit "Save this
               password?" prompt, which keys off seeing a username+password pair
               together. Not verified against a real browser + password-manager
               extension in this sandboxed environment — same caveat as the
               2026-09-28 entry below; if a specific browser or manager still
               offers to fill or save this field, say which one. -->
          <input id="cp-current" name="current-password" type="password" autocomplete="new-password"
                 data-lpignore="true" data-1p-ignore data-bwignore="true" data-form-type="other" /></div>
        <div class="field"><label>New password</label>
          <input id="cp-new" name="new-password" type="password" placeholder="min. 6 characters" autocomplete="new-password"
                 data-lpignore="true" data-1p-ignore data-bwignore="true" data-form-type="other" /></div>
        <div class="field"><label>Confirm new password</label>
          <input id="cp-confirm" name="new-password-confirm" type="password" autocomplete="new-password"
                 data-lpignore="true" data-1p-ignore data-bwignore="true" data-form-type="other" /></div>
        <div class="auth-error hidden" id="cp-error"></div>
        <div style="display:flex;justify-content:flex-end;">
          <button type="submit" class="primary" id="cp-save">Update password</button>
        </div>
      </form>
    </div>

    ${(!showSounds && !showPhotos) ? `
    <div class="empty-state" style="margin-top:16px;">You don't have access to any other Settings panels.</div>
    ` : `
    ${!isAdmin() ? '' : `
    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Usage</h3>
        <button type="button" class="ghost" id="us-refresh" ${usageRefreshing ? 'disabled' : ''}>${usageRefreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <p class="sub" style="margin:0 0 10px;">
        Billing-cycle usage for this project, read on demand — never on a
        timer. A usage monitor that polled would spend the very egress and
        log-ingestion quota it reports on.
        <strong>Avg/day and Projected are the numbers that matter.</strong> The
        figures Supabase shows are cumulative for the cycle: they only ever go
        up and reset at the boundary, so after shipping a fix the total cannot
        fall and tells you nothing. The rate can, and does, immediately.
        Projected is where each metric lands at the cycle boundary if the
        current rate holds — that is what predicts a breach while there is
        still cycle left to act in.
      </p>
      <div id="us-body">${usageLoaded ? '' : 'Loading…'}</div>
    </div>
    `}

    ${!showSounds ? '' : `
    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;">
        <h3 style="margin:0 0 4px;">Scan sounds</h3>
        <div class="emp-meta mono" id="sound-storage-summary" style="white-space:nowrap;">${loaded ? '' : 'Loading…'}</div>
      </div>
      <p class="sub" style="margin:0 0 10px;">
        ${canManageScanSounds()
          ? 'Upload a short audio clip for each scan outcome. They play on the live Scanner and Test Scan as soon as a result comes back. Uploading a new file replaces the previous one immediately.'
          : 'Audio clips played on the live Scanner and Test Scan for each outcome. Your account can view these, not change them.'}
      </p>
      <div class="progress" style="margin:0 0 16px;">
        <div class="progress-track"><div class="progress-fill" id="sound-storage-fill"></div></div>
      </div>
      <div id="sound-rows">${loaded ? '' : 'Loading…'}</div>
    </div>
    `}

    ${!showPhotos ? '' : `
    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <h3 style="margin:0 0 4px;">Employee photos</h3>
      <p class="sub" style="margin:0 0 10px;">
        Photos upload into the Google Drive account connected to the
        photo-upload function — this is how much room is left on that
        account before uploads start failing.
      </p>
      <div id="photo-storage-body">${photoLoaded ? '' : 'Loading…'}</div>
    </div>
    `}
    `}

    ${canViewScannerRegistry() ? scannersPanelHTML() : ''}

    ${!isAdmin() ? '' : `
    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Query performance</h3>
        <div style="display:flex;align-items:center;gap:8px;">
          <label class="emp-meta" for="qs-threshold" style="white-space:nowrap;">Slower than (ms)</label>
          <input type="number" id="qs-threshold" value="${queryThresholdMs}" min="0" step="10" style="width:80px;" />
          <button type="button" class="ghost" id="qs-refresh">Refresh</button>
          <button type="button" class="ghost danger" id="qs-reset">Reset stats</button>
        </div>
      </div>
      <p class="sub" style="margin:0 0 10px;">
        Every distinct query shape the app has run (grouped the way
        Postgres itself groups them — same query text with different
        literal values counts as one row), whose <em>average</em> time is
        at or above the threshold above. "How often" is Calls; "how much
        resource" is Total time (Calls × Mean — the actual cumulative
        load a query puts on the database, which a single slow-but-rare
        query might not). Scoped to this app's own traffic — Supabase's
        internal housekeeping queries are left out. Stats accumulate
        since the last reset (see "since" below); Reset stats clears them
        to get a clean baseline, e.g. right after a fix, to confirm it
        actually worked rather than reading a history that mixes pre-
        and post-fix numbers together.
      </p>
      <div id="qs-body">${queryStatsLoaded ? '' : 'Loading…'}</div>
    </div>

    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Scan data archival</h3>
        <button type="button" class="ghost" id="sa-run" ${archiveRunning ? 'disabled' : ''}>${archiveRunning ? 'Running…' : 'Run archival now'}</button>
      </div>
      <p class="sub" style="margin:0 0 10px;">
        A daily scheduled job (pg_cron, 03:00 UTC) moves scan_events rows
        older than 180 days into scan_events_archive — same data, just out
        of the table the scanner and live Dashboard/Analytics pages read
        from, so it stays fast as history accumulates. Nothing is deleted:
        "Export all scan logs" in Employee Manager still reaches archived
        rows for an old date range. 180 days is comfortably past every
        other feature's own lookback (Attendance caps at 31 days, Scanner
        Analytics at 90), so the scheduled job can never remove a row
        anything else might still ask for. "Run archival now" runs the
        exact same job on demand — useful right after changing the
        schedule, or just to see it work.
      </p>
      <div id="sa-body">${archiveStatusLoaded ? '' : 'Loading…'}</div>
    </div>

    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Scan log trimming</h3>
        <button type="button" class="ghost" id="st-run" ${trimRunning ? 'disabled' : ''}>${trimRunning ? 'Running…' : 'Run trim now'}</button>
      </div>
      <p class="sub" style="margin:0 0 10px;">
        A daily scheduled job (pg_cron, 03:10 UTC) removes entries older
        than 180 days from each employee's scan log history
        (employees.scan_logs), the per-employee record behind the Scan log
        dialog and the Attendance/on-site-roster calculations. Nothing is
        lost: every entry's scan still lives in Export all scan logs
        (which reaches archived scans too). IN/OUT direction for new scans
        does not depend on this history's length, so trimming it never
        affects a scan going forward. "Run trim now" runs the exact same
        job on demand.
      </p>
      <div id="st-body">${trimStatusLoaded ? '' : 'Loading…'}</div>
    </div>

    <div class="panel" style="padding:20px;max-width:720px;margin-top:16px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Scanner silence alerts</h3>
        <button type="button" class="ghost" id="ss-run" ${silenceChecking ? 'disabled' : ''}>${silenceChecking ? 'Checking…' : 'Check now'}</button>
      </div>
      <p class="sub" style="margin:0 0 10px;">
        A scheduled job (pg_cron, every 15 minutes) raises an alert for
        any enabled scanner that hasn't reported in over 60 minutes — a
        kiosk whose tab crashed, lost power, or fell off the network
        would otherwise go unnoticed until someone physically checks it.
        Independent of the Dashboard's own 10-minute "online" indicator
        (Utils/dashboard.js's scannerState()) — that's a glance-level
        status for a page you're already looking at; this is what
        actually notifies someone who isn't. Re-raising the same alert
        every 15 minutes while a scanner stays silent would just be
        noise, so each one is deduplicated (one alert per scanner, until
        it reports again). "Check now" runs the exact same job on
        demand.
      </p>
      <div id="ss-body">${silenceStatusLoaded ? '' : 'Loading…'}</div>
    </div>
    `}
  `;
  paintThemePicker();
  $$('button[data-theme-choice]', $('#theme-picker')).forEach((btn) => {
    btn.addEventListener('click', () => { setTheme(btn.dataset.themeChoice); paintThemePicker(); });
  });
  // A real <form> (see the comment above) needs its own submit handler —
  // Enter in any single field inside a <form> submits it even with no
  // explicit listener on the button — or the page would hard-reload.
  $('#cp-form').addEventListener('submit', (e) => { e.preventDefault(); handleChangePassword(); });
  if (showSounds && loaded) { paintRows(); paintStorageSummary(); }
  if (showPhotos && photoLoaded) paintPhotoStorage();
  if (isAdmin()) {
    if (queryStatsLoaded) paintQueryStats();
    $('#qs-refresh').addEventListener('click', () => loadQueryStats());
    $('#qs-threshold').addEventListener('change', (e) => {
      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
      queryThresholdMs = v;
      e.target.value = v;
      loadQueryStats();
    });
    $('#qs-reset').addEventListener('click', async () => {
      const ok = await openConfirmModal({
        title: 'Reset query statistics?',
        message: 'Clears every accumulated call count and timing for every query shape, app-wide — not just what\'s shown below. This can\'t be undone, and there\'s no reason to do this routinely; it\'s for getting a clean baseline right after a fix.',
        confirmLabel: 'Reset',
      });
      if (!ok) return;
      const { error } = await QueryStatsModel.reset();
      if (error) { toast(error.message, 'error'); return; }
      toast('Query statistics reset');
      loadQueryStats();
    });
    if (usageLoaded) paintUsage();
    $('#us-refresh').addEventListener('click', async () => {
      usageRefreshing = true;
      const btn = $('#us-refresh');
      btn.disabled = true;
      btn.textContent = 'Refreshing…';
      await loadUsage();
      usageRefreshing = false;
      const btnAfter = $('#us-refresh'); // re-query: the repaint inside loadUsage() may have replaced this node
      if (btnAfter) { btnAfter.disabled = false; btnAfter.textContent = 'Refresh'; }
    });
    if (archiveStatusLoaded) paintArchiveStatus();
    $('#sa-run').addEventListener('click', async () => {
      archiveRunning = true;
      const btn = $('#sa-run');
      btn.disabled = true;
      btn.textContent = 'Running…';
      const { data, error } = await ScanArchiveModel.runNow();
      archiveRunning = false;
      const btnAfter = $('#sa-run'); // re-query: a repaint between the two awaits above could have replaced this node
      if (btnAfter) { btnAfter.disabled = false; btnAfter.textContent = 'Run archival now'; }
      if (error) { toast(error.message, 'error'); return; }
      const row = Array.isArray(data) ? data[0] : data;
      toast(row?.archived_count ? `Archived ${row.archived_count} scan${row.archived_count === 1 ? '' : 's'}` : 'Nothing to archive — already current');
      loadArchiveStatus();
    });
    if (trimStatusLoaded) paintTrimStatus();
    $('#st-run').addEventListener('click', async () => {
      trimRunning = true;
      const btn = $('#st-run');
      btn.disabled = true;
      btn.textContent = 'Running…';
      const { data, error } = await ScanLogsTrimModel.runNow();
      trimRunning = false;
      const btnAfter = $('#st-run'); // re-query: a repaint between the two awaits above could have replaced this node
      if (btnAfter) { btnAfter.disabled = false; btnAfter.textContent = 'Run trim now'; }
      if (error) { toast(error.message, 'error'); return; }
      const row = Array.isArray(data) ? data[0] : data;
      toast(row?.entries_removed
        ? `Trimmed ${row.entries_removed} entr${row.entries_removed === 1 ? 'y' : 'ies'} across ${row.employees_trimmed} employee${row.employees_trimmed === 1 ? '' : 's'}`
        : 'Nothing to trim — already current');
      loadTrimStatus();
    });
    if (silenceStatusLoaded) paintSilenceStatus();
    $('#ss-run').addEventListener('click', async () => {
      silenceChecking = true;
      const btn = $('#ss-run');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      const { data, error } = await ScannerSilenceModel.checkNow();
      silenceChecking = false;
      const btnAfter = $('#ss-run'); // re-query: a repaint between the two awaits above could have replaced this node
      if (btnAfter) { btnAfter.disabled = false; btnAfter.textContent = 'Check now'; }
      if (error) { toast(error.message, 'error'); return; }
      const row = Array.isArray(data) ? data[0] : data;
      toast(row?.scanners_flagged
        ? `${row.scanners_flagged} scanner${row.scanners_flagged === 1 ? '' : 's'} flagged as silent`
        : 'All enabled scanners have reported recently — nothing flagged');
      loadSilenceStatus();
    });
  }

  const tasks = [];
  if (showSounds) {
    tasks.push((async () => {
      const { data, error } = await ScanSoundsModel.list();
      if (error) { $('#sound-rows').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
      const byPath = Object.fromEntries((data || []).map((o) => [o.name, o]));
      soundsCache = Object.fromEntries(Object.keys(SOUND_KEYS).map((key) => {
        const obj = byPath[SOUND_KEYS[key]];
        return [key, obj ? { updated_at: obj.updated_at, size: obj.metadata?.size ?? 0 } : null];
      }));
      loaded = true;
      paintRows();
      paintStorageSummary();
    })());
  }
  if (showPhotos) {
    tasks.push((async () => {
      const { data, error } = await EmployeesModel.getPhotoStorageQuota();
      photoQuotaError = error || null;
      photoQuota = error ? null : data;
      photoLoaded = true;
      paintPhotoStorage();
    })());
  }
  if (isAdmin()) tasks.push(loadUsage());
  if (isAdmin()) tasks.push(loadQueryStats());
  if (isAdmin()) tasks.push(loadArchiveStatus());
  if (isAdmin()) tasks.push(loadTrimStatus());
  if (isAdmin()) tasks.push(loadSilenceStatus());
  if (canViewScannerRegistry()) tasks.push(mountScannersPanel());

  // Independent panels, each backed by its own API call — run them
  // concurrently rather than awaiting one before starting the other, and
  // let each repaint itself as soon as its own data is back instead of
  // making the faster one wait on the slower.
  await Promise.all(tasks);
}

// Marks whichever button matches the CURRENT theme as .active — reads
// getTheme() fresh each time rather than trusting a closure variable, so
// this stays correct even if something else in the app ever changes the
// theme out from under this page (it doesn't today, but this is the
// cheap-and-safe way to write it regardless).
function paintThemePicker() {
  const picker = $('#theme-picker');
  if (!picker) return;
  const current = getTheme();
  $$('button[data-theme-choice]', picker).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeChoice === current);
  });
}

// Mirrors paintStorageSummary()'s used-vs-cap framing, but the "cap" here
// is a real number Drive itself reports (storageQuota.limit) rather than
// one derived from this app's own per-file rules — null means the
// connected account has no storage cap at all (some Workspace plans), not
// that the number failed to load.
function paintPhotoStorage() {
  const body = $('#photo-storage-body');
  if (!body) return; // panel not in the DOM for this account's scope
  if (photoQuotaError) {
    body.innerHTML = `<div class="empty-state">${esc(photoQuotaError)}</div>`;
    return;
  }
  if (!photoQuota) { body.innerHTML = 'Loading…'; return; }
  const { usage, limit } = photoQuota;
  if (limit == null) {
    body.innerHTML = `<div class="emp-meta mono">${fmtBytes(usage)} used — this account has no storage cap.</div>`;
    return;
  }
  const remaining = Math.max(0, limit - usage);
  const pct = limit ? Math.min(100, (usage / limit) * 100) : 0;
  body.innerHTML = `
    <div class="emp-meta mono" style="margin-bottom:8px;">${fmtBytes(usage)} of ${fmtBytes(limit)} used — ${fmtBytes(remaining)} remaining</div>
    <div class="progress" style="margin:0;">
      <div class="progress-track"><div class="progress-fill${pct >= 80 ? ' warn' : ''}" style="width:${pct}%;"></div></div>
    </div>
  `;
}

async function loadQueryStats() {
  const { data, error } = await QueryStatsModel.list(queryThresholdMs);
  queryStatsError = error ? error.message : null;
  queryStats = error ? null : (data || []);
  queryStatsLoaded = true;
  paintQueryStats();
}

// mean_exec_time_ms is what determines inclusion (server-side threshold
// filter) and what this sorts severity by visually; total_exec_time_ms
// (already the sort order the RPC returns rows in) is what the table's
// own row order reflects — see the panel's own explanatory copy in
// renderSettings() for why those answer different questions.
function paintQueryStats() {
  const body = $('#qs-body');
  if (!body) return; // panel not in the DOM (non-admin) — shouldn't happen since loadQueryStats() is only ever called when isAdmin()
  if (queryStatsError) {
    body.innerHTML = `<div class="empty-state">${esc(queryStatsError)}</div>`;
    return;
  }
  if (!queryStats) { body.innerHTML = 'Loading…'; return; }
  if (!queryStats.length) {
    body.innerHTML = `<div class="empty-state">No query shape is averaging ${queryThresholdMs}ms or slower right now.</div>`;
    return;
  }
  const oldestSince = queryStats.reduce((oldest, r) => (!oldest || r.stats_since < oldest ? r.stats_since : oldest), null);
  body.innerHTML = `
    <table>
      <thead><tr><th>Query</th><th class="col-shrink">Calls</th><th class="col-shrink">Mean</th><th class="col-shrink">Total</th><th class="col-shrink">Max</th><th class="col-shrink">Rows</th><th class="col-shrink">Cache hit</th></tr></thead>
      <tbody>
        ${queryStats.map((r) => `
          <tr>
            <td class="mono" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(r.query)}">${esc(r.query)}</td>
            <td class="col-shrink mono">${r.calls.toLocaleString()}</td>
            <td class="col-shrink mono"${r.mean_exec_time_ms >= queryThresholdMs * 2 ? ' style="color:var(--bad);font-weight:600;"' : ''}>${r.mean_exec_time_ms}ms</td>
            <td class="col-shrink mono">${(r.total_exec_time_ms / 1000).toFixed(1)}s</td>
            <td class="col-shrink mono">${r.max_exec_time_ms}ms</td>
            <td class="col-shrink mono">${r.rows.toLocaleString()}</td>
            <td class="col-shrink mono">${r.cache_hit_pct == null ? '—' : `${r.cache_hit_pct}%`}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${oldestSince ? `<div class="emp-meta" style="margin-top:8px;">Accumulated since ${esc(fmtTime(oldestSince))}${queryStats.length >= 50 ? ' — showing the top 50 by total time' : ''}</div>` : ''}
  `;
}

// Both halves in parallel, each recorded independently — see the state
// declarations above for why one failing must not blank the other.
async function loadUsage() {
  const [db, proj] = await Promise.all([
    UsageModel.databaseUsage(),
    UsageModel.projectUsage(),
  ]);
  dbUsageError = db.error ? db.error.message : null;
  dbUsage = db.error ? null : db.data;
  projectUsageError = proj.error || null;
  projectUsage = proj.error ? null : proj.data;
  usageLoaded = true;
  paintUsage();
}

// Database size is a LEVEL, not a flow: it is how big the database is right
// now, not something accumulated over the cycle and reset at the boundary.
// Averaging it over elapsed days would be meaningless, so it gets its own row
// shape with no Avg/day or Projected — a dash there is correct, not missing
// data.
function usageRowHTML(row, { rate = true } = {}) {
  const tone = row.state === 'over' ? 'bad' : row.state === 'warn' ? 'warn' : '';
  const pct = row.percent === null ? '' : ` <span class="emp-meta">(${row.percent}%)</span>`;
  const projPct = row.projectedPercent === null ? '' : ` <span class="emp-meta">(${row.projectedPercent}%)</span>`;
  return `
    <tr>
      <td>${esc(row.label)}</td>
      <td class="mono">${esc(row.valueText)}${row.limitText ? ` <span class="emp-meta">/ ${esc(row.limitText)}</span>` : ''}${pct}</td>
      <td class="mono">${rate ? esc(row.perDayText) : '—'}</td>
      <td class="mono">${rate ? `${esc(row.projectedText)}${projPct}` : '—'}</td>
      <td class="col-shrink">${rate && tone
        ? `<span class="badge ${tone === 'bad' ? 'inactive_card' : 'unassigned_card'}">${tone === 'bad' ? 'over' : 'near'}</span>`
        : ''}</td>
    </tr>`;
}

function paintUsage() {
  const body = $('#us-body');
  if (!body) return; // panel not in the DOM (non-admin)
  if (!usageLoaded) { body.innerHTML = 'Loading…'; return; }

  const start = projectUsage?.period_start || null;
  const end = projectUsage?.period_end || null;
  const rows = [];

  // Management API metrics first — these are the ones with quota pressure.
  if (projectUsage?.metrics?.length) {
    for (const m of projectUsage.metrics) rows.push(usageRowHTML(summarizeMetric(m, start, end)));
  }

  // Database size, from the RPC, always available.
  if (dbUsage) {
    rows.push(usageRowHTML(summarizeMetric({
      key: 'db_size',
      label: 'Database size',
      value: Number(dbUsage.database_bytes),
      limit: Number(dbUsage.database_limit_bytes) || null,
      unit: 'bytes',
    }, start, end), { rate: false }));
  }

  const cycleNote = start && end
    ? `Billing cycle ${esc(fmtTime(start))} → ${esc(fmtTime(end))}.`
    : 'Billing-cycle dates unavailable, so Avg/day and Projected cannot be calculated.';

  // Distinguish "never set up" from "broken" — the first is a one-time admin
  // task with a documented fix, the second is an incident. A generic error
  // would send someone debugging a feature nobody has configured yet.
  let apiNote = '';
  if (projectUsageError?.code === 'not_deployed') {
    apiNote = `<div class="empty-state" style="margin-top:10px;text-align:left;">
      <strong>The <span class="mono">project-usage</span> Edge Function isn't deployed yet.</strong>
      Egress, Cached Egress, Log Ingestion and Log Query come from it, and so do the
      billing-cycle dates that Avg/day and Projected are calculated against — which is why
      those read “—” above. Edge Functions deploy on a merge to <span class="mono">main</span>
      (<span class="mono">.github/workflows/deploy-supabase.yml</span>), behind a manual
      approval gate. Database size below needs none of this and is live.
    </div>`;
  } else if (projectUsageError?.code === 'not_configured') {
    apiNote = `<div class="empty-state" style="margin-top:10px;text-align:left;">
      <strong>Egress, Cached Egress, Log Ingestion and Log Query aren't configured.</strong>
      These are platform billing metrics that exist only in Supabase's Management API,
      behind a Personal Access Token — a control-plane credential that cannot live in the
      browser. Set <span class="mono">MANAGEMENT_API_TOKEN</span> as an Edge Function
      secret to enable them (issue it project-scoped and read-only).
      See <span class="mono">Supabase/functions/project-usage/README.md</span>.
      Database size below needs none of this and is live.
    </div>`;
  } else if (projectUsageError?.code === 'management_token_invalid') {
    apiNote = `<div class="empty-state" style="margin-top:10px;text-align:left;color:var(--bad)">
      <strong>Supabase rejected the management token.</strong> It has been revoked, has expired,
      or no longer has access to this project. Issue a new one and update the
      <span class="mono">MANAGEMENT_API_TOKEN</span> secret.
    </div>`;
  } else if (projectUsageError) {
    apiNote = `<div class="empty-state" style="margin-top:10px;">${esc(projectUsageError.message)}</div>`;
  } else if (projectUsage?.partial) {
    apiNote = `<div class="emp-meta" style="margin-top:8px;color:var(--warn)">
      Some metrics weren't present in the Management API response and show as “—”.
      ${esc((projectUsage.notes || []).join(' '))}
    </div>`;
  }

  const tables = Array.isArray(dbUsage?.tables) ? dbUsage.tables.slice(0, 5) : [];

  body.innerHTML = `
    ${rows.length ? `
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Metric</th><th>This cycle</th><th>Avg/day</th><th>Projected</th><th class="col-shrink"></th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>` : '<div class="empty-state">No usage data available.</div>'}
    <p class="emp-meta" style="margin-top:8px;">${cycleNote}</p>
    ${apiNote}
    ${dbUsageError ? `<div class="empty-state" style="margin-top:10px;">${esc(dbUsageError)}</div>` : ''}
    ${tables.length ? `
      <p class="emp-meta" style="margin-top:12px;">Largest tables — "Database size" on its own isn't actionable; this is:</p>
      <div class="emp-meta mono" style="margin-top:4px;">
        ${tables.map((t) => `${esc(t.name)} ${esc(fmtUsageBytes(Number(t.total_bytes)))}`).join(' · ')}
      </div>
    ` : ''}
  `;
}

async function loadArchiveStatus() {
  const { data, error } = await ScanArchiveModel.status();
  archiveStatusError = error ? error.message : null;
  archiveStatus = error ? null : data;
  archiveStatusLoaded = true;
  paintArchiveStatus();
}

function paintArchiveStatus() {
  const body = $('#sa-body');
  if (!body) return; // panel not in the DOM (non-admin) — shouldn't happen since loadArchiveStatus() is only ever called when isAdmin()
  if (archiveStatusError) { body.innerHTML = `<div class="empty-state">${esc(archiveStatusError)}</div>`; return; }
  if (!archiveStatus) { body.innerHTML = 'Loading…'; return; }
  const s = archiveStatus;
  const lastRun = s.last_run;
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent"><div class="stat-value">${s.live_count.toLocaleString()}</div><div class="stat-label">Live scan_events</div></div>
      <div class="stat-card"><div class="stat-value">${s.archive_count.toLocaleString()}</div><div class="stat-label">Archived</div></div>
    </div>
    <p class="emp-meta" style="margin-top:10px;">
      ${s.oldest_live_scanned_at ? `Oldest live row: ${esc(fmtTime(s.oldest_live_scanned_at))}.` : 'No live scan rows yet.'}
      ${s.last_archived_at ? ` Last row moved to the archive at ${esc(fmtTime(s.last_archived_at))}.` : ''}
    </p>
    ${lastRun ? `
      <p class="emp-meta" style="margin-top:4px;">
        Last scheduled run: <span class="badge ${lastRun.status === 'succeeded' ? 'matched' : 'inactive_card'}">${esc(lastRun.status || 'unknown')}</span>
        ${lastRun.started_at ? ` started ${esc(fmtTime(lastRun.started_at))}` : ''}${lastRun.message ? ` — ${esc(lastRun.message)}` : ''}
      </p>
    ` : `<p class="emp-meta" style="margin-top:4px;">The scheduled job hasn't run yet since this status was last checked (it runs once daily at 03:00 UTC).</p>`}
  `;
}

async function loadTrimStatus() {
  const { data, error } = await ScanLogsTrimModel.status();
  trimStatusError = error ? error.message : null;
  trimStatus = error ? null : data;
  trimStatusLoaded = true;
  paintTrimStatus();
}

function paintTrimStatus() {
  const body = $('#st-body');
  if (!body) return; // panel not in the DOM (non-admin) — shouldn't happen since loadTrimStatus() is only ever called when isAdmin()
  if (trimStatusError) { body.innerHTML = `<div class="empty-state">${esc(trimStatusError)}</div>`; return; }
  if (!trimStatus) { body.innerHTML = 'Loading…'; return; }
  const s = trimStatus;
  const lastRun = s.last_run;
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent"><div class="stat-value">${s.total_entries.toLocaleString()}</div><div class="stat-label">Entries, all employees</div></div>
      <div class="stat-card"><div class="stat-value">${s.employees_with_entries.toLocaleString()}</div><div class="stat-label">Employees with history</div></div>
      <div class="stat-card"><div class="stat-value">${s.max_entries_for_one_employee.toLocaleString()}</div><div class="stat-label">Most on one employee</div></div>
    </div>
    ${lastRun ? `
      <p class="emp-meta" style="margin-top:10px;">
        Last scheduled run: <span class="badge ${lastRun.status === 'succeeded' ? 'matched' : 'inactive_card'}">${esc(lastRun.status || 'unknown')}</span>
        ${lastRun.started_at ? ` started ${esc(fmtTime(lastRun.started_at))}` : ''}${lastRun.message ? ` — ${esc(lastRun.message)}` : ''}
      </p>
    ` : `<p class="emp-meta" style="margin-top:10px;">The scheduled job hasn't run yet since this status was last checked (it runs once daily at 03:10 UTC).</p>`}
  `;
}

async function loadSilenceStatus() {
  const { data, error } = await ScannerSilenceModel.status();
  silenceStatusError = error ? error.message : null;
  silenceStatus = error ? null : data;
  silenceStatusLoaded = true;
  paintSilenceStatus();
}

function paintSilenceStatus() {
  const body = $('#ss-body');
  if (!body) return; // panel not in the DOM (non-admin) — shouldn't happen since loadSilenceStatus() is only ever called when isAdmin()
  if (silenceStatusError) { body.innerHTML = `<div class="empty-state">${esc(silenceStatusError)}</div>`; return; }
  if (!silenceStatus) { body.innerHTML = 'Loading…'; return; }
  const s = silenceStatus;
  const lastRun = s.last_run;
  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card${s.silent_now > 0 ? ' warn' : ' accent'}"><div class="stat-value">${s.silent_now.toLocaleString()}</div><div class="stat-label">Silent right now</div></div>
      <div class="stat-card"><div class="stat-value">${s.enabled_scanners.toLocaleString()}</div><div class="stat-label">Enabled scanners</div></div>
      <div class="stat-card"><div class="stat-value">${s.total_scanners.toLocaleString()}</div><div class="stat-label">Total scanners</div></div>
    </div>
    <p class="emp-meta" style="margin-top:10px;">Threshold: ${s.silence_minutes} minutes with no scan.${s.silent_now > 0 ? ' See Alerts for which scanner(s) and when.' : ''}</p>
    ${lastRun ? `
      <p class="emp-meta" style="margin-top:4px;">
        Last scheduled run: <span class="badge ${lastRun.status === 'succeeded' ? 'matched' : 'inactive_card'}">${esc(lastRun.status || 'unknown')}</span>
        ${lastRun.started_at ? ` started ${esc(fmtTime(lastRun.started_at))}` : ''}${lastRun.message ? ` — ${esc(lastRun.message)}` : ''}
      </p>
    ` : `<p class="emp-meta" style="margin-top:4px;">The scheduled job hasn't run yet since this status was last checked (it runs every 15 minutes).</p>`}
  `;
}

// Client-side validation mirrors ResetPasswordModal.js's (min. 6 chars) —
// Supabase's own auth.updateUser() enforces the same floor server-side
// regardless, so this is purely for fast feedback before a round-trip.
async function handleChangePassword() {
  const errorEl = $('#cp-error');
  errorEl.classList.add('hidden');

  const current = $('#cp-current').value;
  const next = $('#cp-new').value;
  const confirm = $('#cp-confirm').value;

  if (!current) { showModalError($('#content'), '#cp-error', 'Enter your current password.'); return; }
  if (!next || next.length < 6) { showModalError($('#content'), '#cp-error', 'New password must be at least 6 characters.'); return; }
  if (next !== confirm) { showModalError($('#content'), '#cp-error', 'New password and confirmation don\'t match.'); return; }
  if (next === current) { showModalError($('#content'), '#cp-error', 'New password must be different from your current one.'); return; }

  const btn = $('#cp-save');
  btn.disabled = true;
  const email = appState.profile?.email || appState.session?.user?.email;
  const { error } = await ProfilesModel.changePassword({ email, currentPassword: current, newPassword: next });
  btn.disabled = false;

  if (error) { showModalError($('#content'), '#cp-error', error); return; }

  // A successful updateUser() fires a USER_UPDATED auth event, which
  // main.js's onAuthStateChange listener doesn't special-case the way it
  // does TOKEN_REFRESHED/same-user SIGNED_IN — it falls through to a full
  // boot()/showShell() re-render of whatever page is open (this one).
  // Harmless (Settings just redraws itself, appState.route is unchanged)
  // but means the toast below can be immediately followed by this whole
  // panel remounting — expected, not a bug, so it isn't worth threading a
  // new special case into that shared listener for.
  $('#cp-current').value = '';
  $('#cp-new').value = '';
  $('#cp-confirm').value = '';
  toast('Password updated');
}

// Sums whatever's actually uploaded against TOTAL_CAPACITY. Reads
// straight from soundsCache so it always matches what the rows below are
// showing — callers repaint both together after any change.
function paintStorageSummary() {
  const el = $('#sound-storage-summary');
  if (!el) return; // panel not in the DOM for this account's scope
  const used = Object.values(soundsCache).reduce((sum, o) => sum + (o?.size || 0), 0);
  const pct = TOTAL_CAPACITY ? Math.min(100, (used / TOTAL_CAPACITY) * 100) : 0;
  el.textContent = `${fmtBytes(used)} of ${fmtBytes(TOTAL_CAPACITY)} used`;
  const fill = $('#sound-storage-fill');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('warn', pct >= 80);
}

function paintRows() {
  const wrap = $('#sound-rows');
  if (!wrap) return; // panel not in the DOM for this account's scope
  const manage = canManageScanSounds();
  wrap.innerHTML = Object.keys(SOUND_KEYS).map((key) => {
    const obj = soundsCache[key];
    return `
      <div class="sound-row" data-sound-row="${key}">
        <div class="sound-row-info">
          <div class="sound-row-label">${esc(SOUND_LABELS[key])}</div>
          <div class="emp-meta" data-status>
            ${obj ? `Set, ${fmtBytes(obj.size)} — uploaded ${esc(fmtTime(obj.updated_at))}` : 'Not set — the scan stays silent for this outcome.'}
          </div>
        </div>
        <div class="sound-row-controls">
          ${manage ? `<input type="file" accept="audio/*" data-file="${key}" />` : ''}
          <button type="button" class="ghost" data-preview="${key}" title="Preview" ${obj ? '' : 'disabled'}>▶</button>
          ${manage ? `<button type="button" class="ghost danger" data-remove="${key}" ${obj ? '' : 'style="display:none;"'}>Remove</button>` : ''}
        </div>
        <div class="progress hidden" data-progress>
          <div class="progress-track"><div class="progress-fill indeterminate"></div></div>
        </div>
      </div>
    `;
  }).join('');

  if (manage) {
    $$('input[data-file]', wrap).forEach((input) => {
      input.addEventListener('change', (e) => handleUpload(e.target.dataset.file, e.target.files[0], e.target));
    });
  }
  $$('button[data-preview]', wrap).forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = soundsCache[btn.dataset.preview];
      if (!obj) return;
      const url = `${ScanSoundsModel.publicUrl(btn.dataset.preview)}?v=${encodeURIComponent(obj.updated_at || obj.id || '')}`;
      new Audio(url).play().catch(() => toast('Could not play this file — it may not be a supported audio format.', 'error'));
    });
  });
  if (manage) {
    $$('button[data-remove]', wrap).forEach((btn) => {
      btn.addEventListener('click', () => handleRemove(btn.dataset.remove));
    });
  }
}

async function handleUpload(key, file, inputEl) {
  if (!file) return;
  const row = $(`[data-sound-row="${key}"]`);
  const progressEl = $('[data-progress]', row);
  const statusEl = $('[data-status]', row);
  progressEl.classList.remove('hidden');
  statusEl.textContent = 'Uploading…';
  $$('button', row).forEach((b) => (b.disabled = true));

  const { error } = await ScanSoundsModel.upload(key, file);

  progressEl.classList.add('hidden');
  inputEl.value = '';
  if (error) {
    toast(`Upload failed: ${error.message || error}`, 'error');
    // repaint this row back to its last-known-good state rather than
    // leaving it stuck on "Uploading…"
    paintRows();
    return;
  }
  soundsCache[key] = { updated_at: new Date().toISOString(), size: file.size };
  toast(`${SOUND_LABELS[key]} sound updated`);
  paintRows();
  paintStorageSummary();
}

async function handleRemove(key) {
  const row = $(`[data-sound-row="${key}"]`);
  $$('button', row).forEach((b) => (b.disabled = true));
  const { error } = await ScanSoundsModel.remove(key);
  if (error) {
    toast(`Remove failed: ${error.message || error}`, 'error');
    $$('button', row).forEach((b) => (b.disabled = false));
    return;
  }
  soundsCache[key] = null;
  toast(`${SOUND_LABELS[key]} sound removed`);
  paintRows();
  paintStorageSummary();
}