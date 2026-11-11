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
import { describeQuery } from '../../Utils/queryLabel.js';
import { readSummary, resetMeter } from '../../Core/requestLog.js';
import { shareOfAllowance } from '../../Utils/requestMeter.js';
import { isFresh, markFetched, invalidate } from '../../Utils/freshness.js';
import { AlertChannelsModel } from '../../Models/AlertChannelsModel.js';
import { ALERT_KINDS } from '../../Utils/alertKinds.js';

// Matches DIRECTORY_MAX_AGE_MS in DirectoryPage: long enough that flicking
// between sidebar items costs nothing, short enough that another admin's
// change shows up without a reload. Every panel here also has its own
// Refresh button, and those call their loader directly rather than going
// through openGroup(), so an explicit refresh is never suppressed.
const SETTINGS_MAX_AGE_MS = 60 * 1000;
import { ScanArchiveModel } from '../../Models/ScanArchiveModel.js';
import { ScanLogsTrimModel } from '../../Models/ScanLogsTrimModel.js';
import { ScannerSilenceModel } from '../../Models/ScannerSilenceModel.js';
import { UsageModel } from '../../Models/UsageModel.js';
import { fmtUsageBytes, fmtPercent } from '../../Utils/usage.js';
import {
  scanGrowthRate, projectFull, runwayLabel, growthSeverity, topRelations, deadShare,
} from '../../Utils/dbGrowth.js';
import { OFFLINE_THUMB_TARGET, recompressThumbBase64 } from '../../Utils/image.js';
import { shrinkSoundFile, SOUND_TARGET, MAX_SOUND_SECONDS } from '../../Utils/audio.js';
import { openConfirmModal } from '../../Components/ConfirmModal.js';
import { panelNote } from '../../Components/PanelNote.js';
import { showModalError } from '../../Components/Modal.js';
import { reportError } from '../../Utils/userError.js';
import { ShiftRulesModel, DEFAULT_DEPARTMENT } from '../../Models/ShiftRulesModel.js';
import { SiteRulesModel, DEFAULT_SITE_PAIR } from '../../Models/SiteRulesModel.js';

let soundsCache = {}; // key -> { updated_at, size } | null, once loaded
let loaded = false;

// Shift times (20261104090000) and site travel times (20261104093000). Both
// are small lists an admin edits rarely, so they load when their group is
// opened and are held for the life of the page.
let shiftRules = null;
let shiftRulesError = null;
let shiftRulesSaving = false;
let travelRules = null;
let scannerSites = null;
let siteRulesError = null;
let siteRulesSaving = false;

// Every key is capped at MAX_FILE_SIZE_BYTES by the bucket itself, so
// "all 6 at their individual max" is a real, meaningful ceiling here —
// not an arbitrary number — for the capacity bar below. Derived from
// SOUND_KEYS rather than written out, so adding an outcome moves it.
const TOTAL_CAPACITY = Object.keys(SOUND_KEYS).length * MAX_FILE_SIZE_BYTES;

let photoQuota = null; // { usage, limit, usageInDrive } once loaded, else null
let photoQuotaError = null;
let photoLoaded = false;

let queryStats = null; // array once loaded, else null
let queryStatsError = null;
let queryStatsLoaded = false;
// 1000 ms, matching log_min_duration_statement rather than
// get_slow_query_stats()'s own 200 ms default.
//
// This was 200 on the reasoning that the panel and the log answer different
// questions — "what is slow" is worth knowing before a statement is slow
// enough to justify writing its full text to a metered log. That reasoning
// still holds, but it produced a fifteen-row table where every row was red,
// and a list on which everything is urgent sorts nothing. At 1000 the panel
// shows what is actually at risk of the 8 s statement_timeout.
//
// NOTHING IS LOST, only hidden by default: pg_stat_statements still counts
// the 200-1000 ms band, and typing 200 into the box brings it straight back.
let queryThresholdMs = 1000;

let archiveStatus = null; // { live_count, oldest_live_scanned_at, archive_count, last_archived_at, last_run } once loaded, else null
let archiveStatusError = null;
let archiveStatusLoaded = false;
let archiveRunning = false;

let trimStatus = null; // { total_entries, employees_with_entries, max_entries_for_one_employee, last_run } once loaded, else null
let trimStatusError = null;
let trimStatusLoaded = false;
let trimRunning = false;

// Settings → Notifications. Admin-only, and the table behind it is revoked
// from both client roles (20261110091000) — these go through RPCs.
let alertChannels = null; // array once loaded, else null
let viberSubscribers = []; // [{ viber_id, name, last_seen_at }] — the destination picker
let alertChannelsError = null;
let alertChannelsLoaded = false;
let alertChannelSaving = false;

let silenceStatus = null; // { silence_minutes, total_scanners, enabled_scanners, silent_now, last_run } once loaded, else null
let silenceStatusError = null;
let silenceStatusLoaded = false;
let silenceChecking = false;

// Usage panel. Database size and its per-table breakdown only — Egress,
// Cached Egress, Log Ingestion and Log Query were removed on 2026-10-05 along
// with the `project-usage` Edge Function, once the live project proved
// Supabase exposes no usage/billing API at all (every candidate path 404s
// while the token verifiably works). See README.md's change log.
let dbUsage = null;           // { database_bytes, database_limit_bytes, tables[], measured_at }
let dbUsageError = null;
let usageLoaded = false;
let usageRefreshing = false;

// Offline-thumbnail recompression. `thumbStats` is the cheap server-side
// measurement (get_offline_thumb_stats — a few hundred bytes); `thumbRun`
// only exists while a pass is in flight or has just finished, and holds the
// running before/after tally so the panel can show what was actually saved
// rather than only what was projected.
let thumbStats = null;        // { with_thumb, total_bytes, avg_bytes, max_bytes, over_target_rows, over_target_total_bytes, ... }
let thumbStatsError = null;
let thumbStatsLoaded = false;
let thumbRun = null;          // { done, changed, skipped, failed, before, after, finished } | null
let repairRun = null;         // { done, repaired, unavailable, failed, finished } | null

export async function renderSettings() {
  const content = $('#content');
  const showSounds = settingsShowSounds();
  const showPhotos = settingsShowPhotos();

  // Each panel is built independently, then composed into intent groups
  // below. Before 2026-10-08 these were one nested template whose
  // conditionals interleaved concerns — "Offline scanner thumbnails" was
  // nested inside the photo-scope branch, and "Database usage" sat between
  // the password form and the scan sounds. Naming them first makes the
  // grouping a list rather than a nesting puzzle, and lets an empty group
  // disappear on its own.
  const panels = {
    appearance: `
    <div class="panel" style="padding:20px;">
      <h3 style="margin:0 0 4px;">Appearance</h3>
      ${panelNote(
        'A personal preference for this browser only.',
        `<p>It isn't shared with other accounts and isn't saved to your
         profile, so it won't follow you to a different device or kiosk.</p>`,
      )}
      <div class="sub-nav" id="theme-picker" role="group" aria-label="Theme">
        <button type="button" data-theme-choice="dark">Dark</button>
        <button type="button" data-theme-choice="light">Light</button>
      </div>
    </div>`,

    password: `
    <div class="panel" style="padding:20px;">
      <h3 style="margin:0 0 4px;">Change password</h3>
      ${panelNote(
        `Update the password for your own account (${esc(appState.profile?.email || appState.session?.user?.email || '')}).`,
        `<p>This only changes what you sign in with — it's separate from an
         admin resetting someone else's password from Users &amp; Roles.</p>`,
      )}
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
    </div>`,

    usage: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Database usage</h3>
        <button type="button" class="ghost" id="us-refresh" ${usageRefreshing ? 'disabled' : ''}>${usageRefreshing ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      ${panelNote(
        'How much storage is in use, and which records account for it.',
        `<p>Updated only when you open this or press Refresh.</p>
         <p>Bandwidth figures are not shown here — those live on your hosting
         provider's usage page.</p>`,
      )}
      <div id="us-body">${usageLoaded ? '' : 'Loading…'}</div>
    </div>`,

    sounds: !showSounds ? '' : `
    <div class="panel" style="padding:20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;">
        <h3 style="margin:0 0 4px;">Scan sounds</h3>
        <div class="emp-meta mono" id="sound-storage-summary" style="white-space:nowrap;">${loaded ? '' : 'Loading…'}</div>
      </div>
      ${canManageScanSounds()
        ? panelNote(
          'Upload a short audio clip for each scan outcome.',
          `<p>They play on the live Scanner and Test Scan as soon as a result
           comes back. Uploading a new file replaces the previous one
           immediately.</p>
           <p>Every outcome already has a built-in tone, so a scanner is never
           silent — uploading here replaces that tone rather than filling a
           gap.</p>
           <p>Clips are converted to mono at ${SOUND_TARGET.sampleRate / 1000} kHz
           in your browser before they are sent, and <strong>anything longer
           than ${MAX_SOUND_SECONDS} seconds is cut to the first
           ${MAX_SOUND_SECONDS}</strong>. That is what keeps uploads quick, and
           a scan sound longer than that is still playing over the next few
           people's scans anyway. You are told when a clip was cut. A file that
           would not get smaller is sent exactly as it is.</p>
           <p><strong>Matched, but has an unresolved remark</strong> takes the
           place of the IN and OUT sounds when the person who scanned has an
           open remark against them. One scan plays one clip, and that is the
           one worth looking up for; the direction is still shown on the
           result card.</p>`,
        )
        : panelNote('Audio clips played on the live Scanner and Test Scan for each outcome. Your account can view these, not change them.')}
      <div class="progress" style="margin:0 0 16px;">
        <div class="progress-track"><div class="progress-fill" id="sound-storage-fill"></div></div>
      </div>
      <div id="sound-rows">${loaded ? '' : 'Loading…'}</div>
    </div>`,

    photos: !showPhotos ? '' : `
    <div class="panel" style="padding:20px;">
      <h3 style="margin:0 0 4px;">Employee photos</h3>
      ${panelNote(
        'How much room is left before photo uploads start failing.',
        `<p>Photos upload into the Google Drive account connected to the
         photo-upload function; this is that account's remaining space.</p>`,
      )}
      <div id="photo-storage-body">${photoLoaded ? '' : 'Loading…'}</div>
    </div>`,

    thumbs: !(showPhotos && isAdmin()) ? '' : `
    <div class="panel" style="padding:20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Offline scanner thumbnails</h3>
        <div style="display:flex;align-items:center;gap:8px;">
          <button type="button" class="ghost" id="th-refresh" ${thumbBusy() ? 'disabled' : ''}>Refresh</button>
          <button type="button" class="ghost" id="th-repair" ${thumbBusy() ? 'disabled' : ''}>${repairRun && !repairRun.finished ? 'Repairing…' : 'Repair missing'}</button>
          <button type="button" class="ghost" id="th-run" ${thumbBusy() ? 'disabled' : ''}>${thumbRun && !thumbRun.finished ? 'Recompressing…' : 'Recompress now'}</button>
        </div>
      </div>
      ${panelNote(
        'Each employee photo is also kept as a small copy so a Scanner can show a face while offline.',
        `<p>These are the largest thing stored here and the heaviest part of
         every kiosk's sync.</p>
         <p><strong>Recompress now</strong> shrinks the oversized ones
         (${OFFLINE_THUMB_TARGET.maxDimension}px, quality
         ${OFFLINE_THUMB_TARGET.quality}). Safe to re-run — a photo is only
         replaced when shrinking saves at least 10%, so already-small ones are
         left alone rather than losing more quality. Kiosks pick up the smaller
         copies on their next full sync.</p>
         <p><strong>Repair missing</strong> fixes a different problem: an
         employee whose photo shows correctly in Employee Manager but who
         appears as initials on every kiosk, because no offline copy was made
         at upload time. Repair rebuilds it. The photo never passes through
         this browser, so repairing the whole roster is cheap.</p>`,
      )}
      <div id="th-body">${thumbStatsLoaded ? '' : 'Loading…'}</div>
    </div>`,

    scanners: canViewScannerRegistry() ? scannersPanelHTML() : '',

    notifications: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <h3 style="margin:0 0 4px;">Notifications</h3>
      ${panelNote(
        'Push alerts as they happen, instead of waiting to notice the badge.',
        `<p><strong>Viber needs setting up first.</strong> A Viber Public
         Account cannot message someone who has not subscribed to it — send
         them the PA link, have them open the chat, and their name appears in
         the list below. Saving an id for someone who has not subscribed
         fails with Viber status 6.</p>
         <p>The list fills itself from the <span class="mono">viber-webhook</span>
         function, because Viber has no way to look an id up on demand. If it
         is empty, nobody has opened the chat yet.</p>
         <p>A destination id is a <strong>credential</strong> — anyone holding
         it and the bot token can message that person. This list is
         admin-only, stored masked, and the tables behind it are unreachable
         except through these controls.</p>
         <p>Telegram is still selectable as a fallback. Setup for both is in
         <span class="mono">Supabase/functions/notify-alert/README.md</span>.</p>`,
      )}
      <div id="ac-body">${alertChannelsLoaded ? '' : 'Loading…'}</div>
    </div>`,

    // The replacement for the Egress / Log Ingestion tiles removed on
    // 2026-10-05. Those asked Supabase; this counts locally, which is the
    // only option left once the usage API turned out not to exist.
    requests: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Request volume</h3>
        <button type="button" class="ghost danger" id="rq-reset">Reset counts</button>
      </div>
      ${panelNote(
        'How many requests this app makes, counted in this browser.',
        `<p>Supabase bills <strong>Log Ingestion per request</strong>, not per
         byte — one log line each, however small the response. So the number
         that moves that bill is how many calls you make, which is what this
         counts.</p>
         <p><strong>It counts this browser only.</strong> Other devices,
         kiosks on other tablets, and Supabase's own internal traffic are all
         invisible here. Use it to find which screen generates volume, not to
         reconcile against an invoice.</p>
         <p>The Egress and Log Ingestion tiles that used to sit in this panel
         were removed on 2026-10-05: Supabase exposes no usage API to ask, so
         counting before the request leaves is the only place left.</p>`,
      )}
      <div id="rq-body"></div>
    </div>`,

    queryPerf: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Query performance</h3>
        <div style="display:flex;align-items:center;gap:8px;">
          <label class="emp-meta" for="qs-threshold" style="white-space:nowrap;">Slower than (ms)</label>
          <input type="number" id="qs-threshold" value="${queryThresholdMs}" min="0" step="10" style="width:80px;" />
          <button type="button" class="ghost" id="qs-refresh">Refresh</button>
          <button type="button" class="ghost danger" id="qs-reset">Reset stats</button>
        </div>
      </div>
      ${panelNote(
        "The app's slowest operations, averaged.",
        `<p><strong>Calls</strong> is how often one ran; <strong>Total
         time</strong> is the cumulative load it puts on the system, which a
         slow-but-rare operation may not.</p>
         <p>Figures build up since the last reset — clear them to get a fresh
         baseline after a change, rather than reading a mix of before and
         after.</p>`,
      )}
      <div id="qs-body">${queryStatsLoaded ? '' : 'Loading…'}</div>
    </div>`,

    archival: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Scan data archival</h3>
        <button type="button" class="ghost" id="sa-run" ${archiveRunning ? 'disabled' : ''}>${archiveRunning ? 'Running…' : 'Run archival now'}</button>
      </div>
      ${panelNote(
        'A nightly job moves scans older than 180 days out of the live history, so the Scanner, Dashboard and Analytics stay fast as records build up.',
        `<p><strong>Nothing is deleted</strong> — "Export all scan logs" still
         reaches archived scans for an older date range.</p>
         <p>180 days is well past every report's own limit (Attendance 31 days,
         Scanner Analytics 90), so archiving can never remove something another
         page still needs.</p>`,
      )}
      <div id="sa-body">${archiveStatusLoaded ? '' : 'Loading…'}</div>
    </div>`,

    trimming: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Scan log trimming</h3>
        <button type="button" class="ghost" id="st-run" ${trimRunning ? 'disabled' : ''}>${trimRunning ? 'Running…' : 'Run trim now'}</button>
      </div>
      ${panelNote(
        "A nightly job trims each employee's personal scan history to the last 180 days.",
        `<p>That history is the record behind the Scan log dialog, Attendance
         and the on-site roster. <strong>Nothing is lost</strong>: every scan
         still appears in "Export all scan logs".</p>
         <p>IN/OUT direction for new scans does not depend on how long this
         history is, so trimming never affects a future scan.</p>`,
      )}
      <div id="st-body">${trimStatusLoaded ? '' : 'Loading…'}</div>
    </div>`,

    silence: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:16px;flex-wrap:wrap;">
        <h3 style="margin:0 0 4px;">Scanner silence alerts</h3>
        <button type="button" class="ghost" id="ss-run" ${silenceChecking ? 'disabled' : ''}>${silenceChecking ? 'Checking…' : 'Check now'}</button>
      </div>
      ${panelNote(
        "Every 15 minutes, any enabled scanner that hasn't reported for over an hour raises an alert.",
        `<p>A kiosk that crashed, lost power or fell off the network would
         otherwise go unnoticed until someone walked past it.</p>
         <p>This is separate from the Dashboard's "online" dot: that tells you
         at a glance on a page you are already looking at; this notifies
         someone who isn't. One alert per scanner until it reports again, so a
         silent kiosk doesn't flood the list.</p>`,
      )}
      <div id="ss-body">${silenceStatusLoaded ? '' : 'Loading…'}</div>
    </div>`,

    shifts: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <h3 style="margin:0 0 4px;">Shift times</h3>
      ${panelNote(
        'What time a shift starts, so Attendance can tell a late arrival from an early one.',
        `<p>Until a time is set here, the Attendance page says punctuality
         can't be measured and shows no figure. That is deliberate — a
         guessed shift start would label people late against a time nobody
         chose.</p>
         <p>The default applies to every department without its own row.
         <strong>Grace</strong> is how many minutes past the start still
         count as on time.</p>
         <p>Changing a time re-reads every day in the report the next time it
         loads; it rewrites no scans and no hours.</p>`,
      )}
      <div id="shift-body">${shiftRules ? '' : 'Loading…'}</div>
    </div>`,

    travel: !isAdmin() ? '' : `
    <div class="panel" style="padding:20px;">
      <h3 style="margin:0 0 4px;">Sites and travel times</h3>
      ${panelNote(
        'Group scanners into sites, and say how long it takes to get between them.',
        `<p>One card used at two different sites closer together than the
         journey takes is either shared or cloned, and raises a critical
         alert.</p>
         <p>This only works for scanners that have a site set. A scanner with
         no site raises nothing — so two readers standing at the same place
         are safe to leave blank, and will never alert on someone walking
         past both.</p>
         <p>Travel times are symmetric: a rule between two sites governs
         both directions.</p>`,
      )}
      <div id="travel-body">${travelRules ? '' : 'Loading…'}</div>
    </div>`,
  };

  // Grouped by what you came to Settings to do. "Your account" is open by
  // default because it costs nothing to show; the other two are collapsed,
  // which is what makes the lazy loading below possible.
  const groups = [
    { id: 'account', label: 'Your account', hint: 'How this browser looks, and your own sign-in', open: true,
      html: panels.appearance + panels.password },
    { id: 'scanning', label: 'Scanning & kiosks', hint: 'The scanners themselves, and what they play and show',
      html: panels.scanners + panels.sounds + panels.thumbs + panels.silence + panels.notifications + panels.travel },
    // Its own group rather than a fourth panel under Scanning: a shift start
    // is a fact about the working day, not about a kiosk, and it is the
    // Attendance report it changes.
    { id: 'rules', label: 'Attendance rules', hint: 'Shift times, and what counts as late',
      html: panels.shifts },
    { id: 'data', label: 'Data & maintenance', hint: 'Storage, retention jobs, and query health',
      html: panels.usage + panels.requests + panels.photos + panels.archival + panels.trimming + panels.queryPerf },
  ].filter((group) => group.html.trim());

  const onlyAccount = groups.length === 1;
  content.innerHTML = `
    <div class="settings-groups">
      ${groups.map((group) => `
        <details class="settings-group" data-settings-group="${group.id}"${group.open ? ' open' : ''}>
          <summary>
            <span class="settings-group-title">${esc(group.label)}</span>
            <span class="settings-group-hint">${esc(group.hint)}</span>
          </summary>
          <div class="settings-group-body">${group.html}</div>
        </details>
      `).join('')}
      ${onlyAccount ? '<div class="empty-state">You don\'t have access to any other Settings panels.</div>' : ''}
    </div>
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
    paintRequestMeter();
    $('#rq-reset').addEventListener('click', async () => {
      const ok = await openConfirmModal({
        title: 'Reset request counts?',
        message: 'Clears the request tally held in THIS browser only — other devices keep their own. Nothing on the server changes, and no data other than the counts is affected.',
        confirmLabel: 'Reset',
      });
      if (!ok) return;
      resetMeter();
      paintRequestMeter();
      toast('Request counts reset');
    });
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
      if (error) { toast(reportError(error, 'settings'), 'error'); return; }
      toast('Query statistics reset');
      loadQueryStats();
    });
    if (thumbStatsLoaded) paintThumbStats();
    $('#th-refresh')?.addEventListener('click', () => loadThumbStats());
    $('#th-repair')?.addEventListener('click', async () => {
      const missing = thumbStats?.missing_thumb_rows ?? 0;
      if (!missing) { toast('Every employee with a photo already has a kiosk thumbnail.'); return; }
      const ok = await openConfirmModal({
        title: 'Repair missing thumbnails?',
        message: `Re-fetches a thumbnail from Google Drive for ${missing} employee${missing === 1 ? '' : 's'} who currently show as initials on every Scanner. Nothing else about their record changes, and employees that already have one are untouched. Drive may still have no usable thumbnail for some — those are reported and left alone.`,
        confirmLabel: 'Repair',
      });
      if (!ok) return;
      await runThumbRepair();
    });
    $('#th-run')?.addEventListener('click', async () => {
      const ok = await openConfirmModal({
        title: 'Recompress offline thumbnails?',
        message: `Re-encodes ${thumbStats?.over_target_rows ?? 'the oversized'} stored thumbnail${thumbStats?.over_target_rows === 1 ? '' : 's'} at ${OFFLINE_THUMB_TARGET.maxDimension}px / quality ${OFFLINE_THUMB_TARGET.quality} and writes them back. Re-encoding is lossy, so this is not reversible without re-uploading the original photos — those stay untouched in Google Drive. Rows that would not get at least 10% smaller are left alone.`,
        confirmLabel: 'Recompress',
      });
      if (!ok) return;
      await runThumbRecompress();
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
      if (error) { toast(reportError(error, 'settings'), 'error'); return; }
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
      if (error) { toast(reportError(error, 'settings'), 'error'); return; }
      const row = Array.isArray(data) ? data[0] : data;
      toast(row?.entries_removed
        ? `Trimmed ${row.entries_removed} entr${row.entries_removed === 1 ? 'y' : 'ies'} across ${row.employees_trimmed} employee${row.employees_trimmed === 1 ? '' : 's'}`
        : 'Nothing to trim — already current');
      loadTrimStatus();
    });
    if (silenceStatusLoaded) paintSilenceStatus();
    // These two were the only panels with no repaint-from-state on render —
    // they painted solely from inside their own loaders. That was invisible
    // while every visit refetched, and would have left both stuck on
    // "Loading…" forever the moment a freshness window skipped the fetch.
    // Both read module state that outlives the render, so they are safe to
    // call unconditionally; paintSiteRules() and paintShiftRules() each
    // handle the not-yet-loaded case themselves.
    paintSiteRules();
    paintShiftRules();
    // Same reason as the two above: the freshness window means this panel's
    // loader does not run on every visit, so the render path has to paint it
    // from state or it sits on "Loading…" until the window expires.
    if (alertChannelsLoaded) paintAlertChannels();
    $('#ac-body').addEventListener('click', onAlertChannelClick);
    $('#ac-body').addEventListener('submit', onAlertChannelSubmit);
    $('#ss-run').addEventListener('click', async () => {
      silenceChecking = true;
      const btn = $('#ss-run');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      const { data, error } = await ScannerSilenceModel.checkNow();
      silenceChecking = false;
      const btnAfter = $('#ss-run'); // re-query: a repaint between the two awaits above could have replaced this node
      if (btnAfter) { btnAfter.disabled = false; btnAfter.textContent = 'Check now'; }
      if (error) { toast(reportError(error, 'settings'), 'error'); return; }
      const row = Array.isArray(data) ? data[0] : data;
      toast(row?.scanners_flagged
        ? `${row.scanners_flagged} scanner${row.scanners_flagged === 1 ? '' : 's'} flagged as silent`
        : 'All enabled scanners have reported recently — nothing flagged');
      loadSilenceStatus();
    });
  }

  const loadSounds = async () => {
    const { data, error } = await ScanSoundsModel.list();
    if (error) { $('#sound-rows').innerHTML = `<div class="empty-state">${esc(reportError(error, 'settings.sounds', "Couldn't load the scan sounds."))}</div>`; return; }
    const byPath = Object.fromEntries((data || []).map((o) => [o.name, o]));
    soundsCache = Object.fromEntries(Object.keys(SOUND_KEYS).map((key) => {
      const obj = byPath[SOUND_KEYS[key]];
      return [key, obj ? { updated_at: obj.updated_at, size: obj.metadata?.size ?? 0 } : null];
    }));
    loaded = true;
    paintRows();
    paintStorageSummary();
  };
  const loadPhotoQuota = async () => {
    const { data, error } = await EmployeesModel.getPhotoStorageQuota();
    photoQuotaError = error || null;
    photoQuota = error ? null : data;
    photoLoaded = true;
    paintPhotoStorage();
  };

  // Which panels each intent group is responsible for fetching. Keep in step
  // with the `groups` array above — a loader listed under the wrong group
  // fires when the wrong section is opened, which looks exactly like a panel
  // that never loads.
  // Binds listeners to markup that renderSettings just rebuilt, so it has to
  // run on EVERY visit, freshness window or not. mountScannersPanel() does
  // its own freshness check for the data half — see the note in
  // ScannersPanel.js on why mounting and fetching had to be separated.
  const groupMounts = {
    scanning: () => [
      canViewScannerRegistry() ? mountScannersPanel({ maxAgeMs: SETTINGS_MAX_AGE_MS }) : null,
    ],
  };

  const groupLoaders = {
    scanning: () => [
      showSounds ? loadSounds() : null,
      showPhotos && isAdmin() ? loadThumbStats() : null,
      isAdmin() ? loadSilenceStatus() : null,
      isAdmin() ? loadAlertChannels() : null,
      isAdmin() ? loadSiteRules() : null,
    ],
    rules: () => [
      isAdmin() ? loadShiftRules() : null,
    ],
    data: () => [
      isAdmin() ? loadUsage() : null,
      showPhotos ? loadPhotoQuota() : null,
      isAdmin() ? loadArchiveStatus() : null,
      isAdmin() ? loadTrimStatus() : null,
      isAdmin() ? loadQueryStats() : null,
    ],
  };

  // Settings used to fire all nine of these on every single visit — the
  // `*Loaded` flags gated PAINTING, never fetching, so flicking to Settings
  // five times cost forty-five round trips. A group now fetches once per
  // freshness window, and a visit that only changes the theme costs nothing.
  // Each group's panels still run concurrently with each other, which is what
  // the old Promise.all was actually for.
  //
  // THE WINDOW IS THE FIX, AND IT IS THE SECOND HALF OF ONE. The first
  // attempt used `const started = new Set()` declared right here — a local,
  // so it was rebuilt on every render and only ever de-duplicated within a
  // single visit. Settings' own Request volume panel is what exposed it:
  // 20 of 41 requests in a session came from this one screen, because
  // reopening it refetched the whole group every time.
  //
  // Shares Utils/freshness.js with Employee Manager, and the same 60s window,
  // so "how stale may a screen be" has one answer in this app rather than
  // one per page. The panels repaint from module state above regardless, so
  // skipping the fetch costs nothing visible.
  const openGroup = async (id) => {
    const work = (groupMounts[id]?.() || []).filter(Boolean);
    const key = `settings:${id}`;
    const stale = groupLoaders[id] && !isFresh(key, SETTINGS_MAX_AGE_MS);
    if (stale) {
      // Marked BEFORE the await, not after: `pending` below and the toggle
      // listener can both reach the same group in one render, and marking
      // afterwards would let both get past the check and fetch twice.
      markFetched(key);
      work.push(...groupLoaders[id]().filter(Boolean));
    }
    try {
      await Promise.all(work);
    } catch (e) {
      // A thrown load must not leave the key looking fresh, or the failure
      // sticks for the whole window with no way to retry but waiting.
      if (stale) invalidate(key);
      throw e;
    }
  };

  const pending = [];
  $$('details[data-settings-group]').forEach((details) => {
    const id = details.dataset.settingsGroup;
    details.addEventListener('toggle', () => { if (details.open) openGroup(id); });
    // A group rendered already-open (or restored open by the browser) has no
    // toggle event to wait for.
    if (details.open) pending.push(openGroup(id));
  });
  await Promise.all(pending);
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

// ---- offline-thumbnail recompression ----

async function loadThumbStats() {
  const { data, error } = await EmployeesModel.offlineThumbStats(OFFLINE_THUMB_TARGET.overTargetStoredBytes);
  thumbStatsError = error ? reportError(error, 'settings.thumbs', "Couldn't load photo details.") : null;
  thumbStats = error ? null : data;
  thumbStatsLoaded = true;
  paintThumbStats();
}

function paintThumbStats() {
  const body = $('#th-body');
  if (!body) return; // panel not in the DOM (non-admin)
  if (thumbStatsError) {
    body.innerHTML = `<div class="empty-state">${esc(thumbStatsError)}</div>`;
    return;
  }
  if (!thumbStats) { body.innerHTML = 'Loading…'; return; }

  const { with_thumb: withThumb, total_bytes: total, avg_bytes: avg, max_bytes: max,
          over_target_rows: overRows, over_target_total_bytes: overBytes,
          missing_thumb_rows: missing = 0 } = thumbStats;

  // A roster with no thumbnails at all is still worth the missing-count line:
  // "nobody has one" and "nobody has a photo" need different actions.
  if (!withThumb && !missing) {
    body.innerHTML = '<div class="empty-state">No employee has a photo on file yet.</div>';
    return;
  }

  // Projected, not promised: the real saving depends on each photo's own
  // content, which only the encoder knows. Stated as "about half" rather
  // than a precise figure for exactly that reason — the run reports what it
  // actually achieved below, and that number is the one to trust.
  const projected = Math.round(overBytes * 0.5);

  body.innerHTML = `
    <div class="emp-meta mono" style="margin-bottom:8px;">
      ${withThumb} thumbnail${withThumb === 1 ? '' : 's'} · ${fmtUsageBytes(total)} stored
      · ${fmtUsageBytes(avg)} average · ${fmtUsageBytes(max)} largest
    </div>
    ${missing === 0 ? '' : `
      <div class="emp-meta" style="margin-bottom:8px;color:var(--warn);">
        <strong>${missing}</strong> employee${missing === 1 ? ' has a photo' : 's have photos'} with no kiosk
        thumbnail — ${missing === 1 ? 'that person shows' : 'they show'} as initials on every Scanner despite
        looking correct in Employee Manager. Use <strong>Repair missing</strong>.
      </div>
    `}
    ${!withThumb ? '' : overRows === 0 ? `
      <div class="emp-meta">Every thumbnail is already at or under
      ${fmtUsageBytes(thumbStats.over_target_bytes)} — nothing to recompress.</div>
    ` : `
      <div class="emp-meta" style="margin-bottom:8px;">
        <strong>${overRows}</strong> ${overRows === 1 ? 'is' : 'are'} over
        ${fmtUsageBytes(thumbStats.over_target_bytes)}, accounting for
        ${fmtUsageBytes(overBytes)}. Recompressing those should recover
        roughly ${fmtUsageBytes(projected)} — a projection from the target,
        not a measurement; the run reports what it actually saved.
      </div>
    `}
    ${!repairRun ? '' : `
      <div class="progress" style="margin:0 0 8px;">
        <div class="progress-track">
          <div class="progress-fill" style="width:${runPercent(repairRun, missing + repairRun.repaired)}%;"></div>
        </div>
      </div>
      <div class="emp-meta mono">
        ${repairRun.finished ? 'Repair done' : 'Repairing'} — ${repairRun.done} tried,
        ${repairRun.repaired} fixed${repairRun.unavailable ? `, ${repairRun.unavailable} with no thumbnail in Drive` : ''}${repairRun.failed ? `, ${repairRun.failed} failed` : ''}
      </div>
    `}
    ${!thumbRun ? '' : `
      <div class="progress" style="margin:0 0 8px;">
        <div class="progress-track">
          <div class="progress-fill" style="width:${runPercent(thumbRun, overRows)}%;"></div>
        </div>
      </div>
      <div class="emp-meta mono">
        ${thumbRun.finished ? 'Done' : 'Working'} — ${thumbRun.done} examined,
        ${thumbRun.changed} rewritten, ${thumbRun.skipped} left alone${thumbRun.failed ? `, ${thumbRun.failed} failed` : ''}
        ${thumbRun.changed ? ` · ${fmtUsageBytes(thumbRun.before)} → ${fmtUsageBytes(thumbRun.after)} (saved ${fmtUsageBytes(thumbRun.before - thumbRun.after)})` : ''}
      </div>
      ${!thumbRun.finished ? '' : '<div class="emp-meta">Refresh above to re-measure the column.</div>'}
    `}
  `;
}

const thumbBusy = () => Boolean((thumbRun && !thumbRun.finished) || (repairRun && !repairRun.finished));

// Determinate, since the row count is known up front. `expected` comes from the
// last measurement, which the run is actively invalidating as it works — taking
// the max of the two keeps the bar monotonic instead of dividing by a number
// that shrank out from under it.
function runPercent(run, expected) {
  if (!run) return 0;
  if (run.finished) return 100;
  const denominator = Math.max(expected || 0, run.done, 1);
  return Math.min(100, Math.round((run.done / denominator) * 100));
}

// Walks employees with a photo but no kiosk thumbnail, asking the Edge Function
// to repair each one. The thumbnail is fetched from Drive and written to the row
// server-side; only a status comes back here.
//
// Sequential on purpose. Each call makes Drive fetch an image, and firing dozens
// concurrently is how you find Drive's rate limits — which would turn repairable
// rows into "unavailable" ones and make the run look like it failed.
async function runThumbRepair() {
  const PAGE = 25;
  repairRun = { done: 0, repaired: 0, unavailable: 0, failed: 0, finished: false };
  setThumbButtons(true);
  paintThumbStats();

  let afterId = null;
  try {
    for (;;) {
      const { data: page, error } = await EmployeesModel.employeesMissingThumb({ afterId, limit: PAGE });
      if (error) { toast(reportError(error, 'settings'), 'error'); break; }
      const rows = Array.isArray(page) ? page : [];
      if (!rows.length) break;

      for (const row of rows) {
        // Advance before attempting, so a row that keeps failing cannot stall the
        // walk on itself. A repaired row also drops out of the next page's
        // results, which is why the cursor must come from the id and not a count.
        afterId = row.id;
        repairRun.done += 1;
        const { data, error: repairErr } = await EmployeesModel.backfillThumb(row.id);
        if (repairErr) {
          repairRun.failed += 1;
          console.warn(`Could not repair the kiosk thumbnail for ${row.full_name || row.id}:`, repairErr);
        } else if (data?.ok && data.bytes) {
          repairRun.repaired += 1;
        } else {
          // Drive has no usable thumbnail for this file. Expected for some
          // uploads, and not something re-running will fix — the photo needs
          // re-uploading from Employee Manager, ideally as JPEG or PNG.
          repairRun.unavailable += 1;
          console.info(`Google Drive has no usable thumbnail for ${row.full_name || row.id} (${data?.reason || data?.skipped || 'unknown'}) — re-upload that photo to fix it.`);
        }
        paintThumbStats();
        await new Promise((r) => setTimeout(r, 0));
      }
      if (rows.length < PAGE) break;
    }
  } finally {
    repairRun.finished = true;
    setThumbButtons(false);
    paintThumbStats();
  }

  toast(repairRun.repaired
    ? `Repaired ${repairRun.repaired} kiosk thumbnail${repairRun.repaired === 1 ? '' : 's'}`
    : 'Nothing could be repaired — those photos need re-uploading');
  await loadThumbStats();
}

// Walks the over-target rows a page at a time, re-encoding each in this
// browser and writing it back. Deliberately sequential rather than
// parallel: canvas decode + WebP encode is synchronous main-thread work, so
// firing them concurrently would not finish sooner and would just make the
// page unresponsive for longer at a stretch.
//
// Every failure mode is per-row and non-fatal. A photo this browser can't
// decode (a corrupt row, or a format its canvas doesn't support) or a write
// that RLS rejects increments `failed` and the walk continues — one bad row
// must not strand the other 700. Only a failure to read a PAGE stops the
// run, since without the page there is nothing to continue from.
async function runThumbRecompress() {
  const PAGE = 20;
  thumbRun = { done: 0, changed: 0, skipped: 0, failed: 0, before: 0, after: 0, finished: false };
  // Toggle just this panel's own buttons rather than calling
  // renderSettings(), which would re-run every other panel's loader for a
  // state change confined to this one.
  setThumbButtons(true);
  paintThumbStats();

  let afterId = null;
  try {
    for (;;) {
      const { data: page, error } = await EmployeesModel.thumbsToRecompress({
        afterId,
        limit: PAGE,
        overTargetBytes: OFFLINE_THUMB_TARGET.overTargetStoredBytes,
      });
      if (error) { toast(reportError(error, 'settings'), 'error'); break; }
      const rows = Array.isArray(page) ? page : [];
      if (!rows.length) break;

      for (const row of rows) {
        // Advance the cursor BEFORE attempting the row. A row that throws
        // must still move the keyset forward, or the next page returns the
        // same failing row and the loop never ends.
        afterId = row.id;
        thumbRun.done += 1;
        try {
          const result = await recompressThumbBase64(row.photo_thumb_b64);
          if (!result.changed) {
            thumbRun.skipped += 1;
          } else {
            const { error: writeErr } = await EmployeesModel.updateThumb(row.id, result.base64);
            if (writeErr) {
              thumbRun.failed += 1;
              console.warn(`Could not store the recompressed thumbnail for ${row.full_name || row.id}:`, writeErr.message);
            } else {
              thumbRun.changed += 1;
              thumbRun.before += result.before;
              thumbRun.after += result.after;
            }
          }
        } catch (err) {
          thumbRun.failed += 1;
          console.warn(`Could not re-encode the thumbnail for ${row.full_name || row.id}:`, err);
        }
        paintThumbStats();
        // Yield to the event loop between rows so the progress line above
        // actually repaints and the page stays responsive through a
        // several-hundred-row pass.
        await new Promise((r) => setTimeout(r, 0));
      }
      if (rows.length < PAGE) break;
    }
  } finally {
    // In the finally, not after it: an unexpected throw must still release
    // the buttons, or the panel is left permanently stuck on
    // "Recompressing…" with no way to retry short of a reload.
    thumbRun.finished = true;
    setThumbButtons(false);
    paintThumbStats();
  }

  const saved = thumbRun.before - thumbRun.after;
  toast(thumbRun.changed
    ? `Recompressed ${thumbRun.changed} thumbnail${thumbRun.changed === 1 ? '' : 's'} — saved ${fmtUsageBytes(saved)}`
    : 'Nothing to recompress — every thumbnail is already small enough');
  // Re-measure server-side so the panel's headline figures reflect the
  // rewritten column rather than the pre-run snapshot.
  await loadThumbStats();
}

// Re-queried each time rather than captured: paintThumbStats() only
// replaces #th-body, but a full renderSettings() elsewhere (navigating away
// and back mid-run) replaces these nodes entirely.
// Both actions share the panel, so either one running disables both — they write
// the same column and would race each other over it.
function setThumbButtons(running) {
  const run = $('#th-run');
  const repair = $('#th-repair');
  const refresh = $('#th-refresh');
  if (run) {
    run.disabled = running;
    run.textContent = thumbRun && !thumbRun.finished ? 'Recompressing…' : 'Recompress now';
  }
  if (repair) {
    repair.disabled = running;
    repair.textContent = repairRun && !repairRun.finished ? 'Repairing…' : 'Repair missing';
  }
  if (refresh) refresh.disabled = running;
}

async function loadAlertChannels() {
  // Both in one round trip rather than one per panel open. The subscriber
  // list is what makes the destination picker usable at all — Viber has no
  // getUpdates, so an id can only be learned from a webhook callback.
  const [channelsRes, subsRes] = await Promise.all([
    AlertChannelsModel.list(),
    AlertChannelsModel.viberSubscribers(),
  ]);
  alertChannelsError = channelsRes.error
    ? reportError(channelsRes.error, 'settings.alertChannels', "Couldn't load notification channels.")
    : null;
  alertChannels = channelsRes.error ? null : (channelsRes.data || []);
  // A failed subscriber lookup is not fatal: the id can still be typed in,
  // and blocking the whole panel on the convenience half would be worse.
  viberSubscribers = subsRes.error ? [] : (subsRes.data || []);
  alertChannelsLoaded = true;
  paintAlertChannels();
}

function paintAlertChannels() {
  const body = $('#ac-body');
  if (!body) return;
  if (alertChannelsError) {
    body.innerHTML = `<div class="empty-state">${esc(alertChannelsError)}</div>`;
    return;
  }
  if (!alertChannels) { body.innerHTML = 'Loading…'; return; }

  const kindLabel = (k) => ALERT_KINDS.find((x) => x.value === (k || ''))?.label || k;
  body.innerHTML = `
    ${alertChannels.length ? `
      <table>
        <thead><tr><th>Destination</th><th>Sends</th><th class="col-shrink">On</th><th class="col-shrink"></th></tr></thead>
        <tbody>
          ${alertChannels.map((c) => `
            <tr>
              <td>
                <span class="badge role-viewer">${esc(c.channel)}</span>
                ${copyableMasked(c.target)}
              </td>
              <td>${esc(kindLabel(c.kind))}</td>
              <td class="col-shrink">
                <input type="checkbox" data-ac-toggle="${esc(c.id)}" ${c.enabled ? 'checked' : ''}
                       ${alertChannelSaving ? 'disabled' : ''} aria-label="Enabled" />
              </td>
              <td class="col-shrink">
                <button type="button" class="ghost danger" data-ac-delete="${esc(c.id)}"
                        ${alertChannelSaving ? 'disabled' : ''}>Remove</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>` : '<div class="empty-state">No destinations yet. Alerts are still recorded — nothing is pushed anywhere.</div>'}
    <form id="ac-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin-top:12px;">
      <label style="flex:0 0 auto;">
        <span class="emp-meta">Channel</span>
        <select id="ac-channel" style="min-width:120px;">
          <option value="viber">Viber</option>
          <option value="telegram">Telegram</option>
        </select>
      </label>
      <label style="flex:1 1 200px;min-width:0;">
        <span class="emp-meta">Send to</span>
        <input id="ac-target" type="text" inputmode="text" autocomplete="off"
               list="ac-viber-ids" placeholder="pick a Viber subscriber, or paste an id" />
        <datalist id="ac-viber-ids">
          ${viberSubscribers.map((s) => `
            <option value="${esc(s.viber_id)}">${esc(s.name || 'Viber user')}</option>`).join('')}
        </datalist>
      </label>
      <label style="flex:0 0 auto;">
        <span class="emp-meta">Sends</span>
        <select id="ac-kind" style="min-width:160px;">
          ${ALERT_KINDS.map((k) => `<option value="${esc(k.value)}">${esc(k.label)}</option>`).join('')}
        </select>
      </label>
      <button type="submit" class="primary" ${alertChannelSaving ? 'disabled' : ''}>${alertChannelSaving ? 'Saving…' : 'Add'}</button>
    </form>`;
}

// Enough to recognise which chat a row is, not enough to be worth copying
// off a shared screen. The full value is never rendered after it is saved.
function maskTarget(target) {
  const s = String(target ?? '');
  if (s.length <= 6) return s;
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

// Masked text, real value on the clipboard.
//
// Hand-rolled rather than copyableHTML(), which renders the value it copies —
// the opposite of what is wanted here. The class names are the component's
// own, so Components/Copyable.js's single delegated listener (already bound
// in main.js) handles the click with no extra JS.
//
// A MASKED VALUE STILL HAS TO BE RETRIEVABLE. A Viber id can be re-picked
// from the subscriber list and a Telegram chat id re-read from getUpdates,
// so nothing here is unrecoverable — but copying beats reading digits off a
// masked string and retyping them somewhere else, which is how a destination
// ends up one character wrong and silently receiving nothing.
function copyableMasked(target) {
  const v = String(target ?? '');
  const label = 'destination';
  return `<span class="copyable">`
    + `<span class="copyable-text mono">${esc(maskTarget(v))}</span>`
    + `<button type="button" class="copyable-btn" data-copy="${esc(v)}" `
    + `title="Copy ${esc(label)}" aria-label="Copy ${esc(label)}">`
    + `<span aria-hidden="true">⧉</span></button></span>`;
}


async function onAlertChannelSubmit(e) {
  if (e.target.id !== 'ac-form') return;
  e.preventDefault();
  if (alertChannelSaving) return;
  const target = $('#ac-target')?.value?.trim();
  if (!target) { toast('A chat id is required.', 'error'); return; }

  alertChannelSaving = true;
  paintAlertChannels();
  const { error } = await AlertChannelsModel.save({
    channel: $('#ac-channel')?.value || 'telegram',
    target,
    kind: $('#ac-kind')?.value || null,
  });
  alertChannelSaving = false;
  if (error) { toast(reportError(error, 'settings.alertChannels'), 'error'); paintAlertChannels(); return; }
  toast('Destination saved. The next alert will go there.');
  await loadAlertChannels();
}

async function onAlertChannelClick(e) {
  const del = e.target.closest('[data-ac-delete]');
  const toggle = e.target.closest('[data-ac-toggle]');
  if (!del && !toggle) return;
  if (alertChannelSaving) return;

  if (del) {
    const row = alertChannels?.find((c) => c.id === del.dataset.acDelete);
    const ok = await openConfirmModal({
      title: 'Remove this destination?',
      message: `Alerts will stop being pushed to ${row ? maskTarget(row.target) : 'it'}. They are still recorded and still shown on the Alerts page — only the push stops.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    alertChannelSaving = true;
    paintAlertChannels();
    const { error } = await AlertChannelsModel.remove(del.dataset.acDelete);
    alertChannelSaving = false;
    if (error) { toast(reportError(error, 'settings.alertChannels'), 'error'); paintAlertChannels(); return; }
    toast('Destination removed');
    await loadAlertChannels();
    return;
  }

  const row = alertChannels?.find((c) => c.id === toggle.dataset.acToggle);
  if (!row) return;
  alertChannelSaving = true;
  paintAlertChannels();
  const { error } = await AlertChannelsModel.save({
    id: row.id, channel: row.channel, target: row.target, kind: row.kind, enabled: !row.enabled,
  });
  alertChannelSaving = false;
  if (error) { toast(reportError(error, 'settings.alertChannels'), 'error'); paintAlertChannels(); return; }
  await loadAlertChannels();
}

// No loader: the counts are already in this browser, so there is nothing to
// fetch — which is the entire point of the panel.
function paintRequestMeter() {
  const body = $('#rq-body');
  if (!body) return;
  const s = readSummary();
  if (!s.today) {
    body.innerHTML = '<div class="empty-state">No requests counted yet today. Move around the app and come back.</div>';
    return;
  }
  const share = shareOfAllowance(s.projectedMonthly);
  const pct = (n) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
  const bar = (n, max) => `<div class="rq-bar" style="width:${max > 0 ? Math.max(2, Math.round((n / max) * 100)) : 0}%"></div>`;
  const topRoute = s.byRoute[0]?.count || 0;
  const topName = s.byName[0]?.count || 0;

  body.innerHTML = `
    <div class="rq-stats">
      <div class="stat"><div class="stat-value">${s.today.toLocaleString()}</div><div class="stat-label">Requests today</div></div>
      <div class="stat"><div class="stat-value">${s.perMinute.toFixed(1)}</div><div class="stat-label">Per minute</div></div>
      <div class="stat"><div class="stat-value">${s.projectedMonthly.toLocaleString()}</div><div class="stat-label">Monthly at today's rate</div></div>
      <div class="stat"><div class="stat-value">${pct(share.low)}–${pct(share.high)}</div><div class="stat-label">Of a 1 GB log allowance</div></div>
    </div>
    <p class="emp-meta" style="margin:10px 0 14px;">
      One gateway log line per request, roughly 1–2 KB each — hence the range.
      "Monthly" extrapolates from today so far, so it is a rate, not a forecast.
      <strong>background</strong> is the alerts badge, which polls on a timer
      wherever you are; everything else is charged to the screen that was open,
      which is not always the screen that caused it.
    </p>
    <div class="rq-cols">
      <div>
        <div class="dept-breakdown-title">By screen</div>
        ${s.byRoute.slice(0, 8).map((r) => `
          <div class="rq-row"><span class="rq-name">${esc(r.name)}</span>${bar(r.count, topRoute)}<span class="mono emp-meta">${r.count.toLocaleString()}</span></div>
        `).join('')}
      </div>
      <div>
        <div class="dept-breakdown-title">By call</div>
        ${s.byName.slice(0, 8).map((r) => `
          <div class="rq-row"><span class="rq-name mono">${esc(r.name)}</span>${bar(r.count, topName)}<span class="mono emp-meta">${r.count.toLocaleString()}</span></div>
        `).join('')}
      </div>
    </div>
    ${s.days > 1 ? `<div class="emp-meta" style="margin-top:12px;">Earlier days — ${
      s.history.slice(0, -1).map((d) => `${esc(d.day.slice(5))}: ${d.total.toLocaleString()}`).join(' · ')
    }</div>` : ''}
  `;
}

async function loadQueryStats() {
  const { data, error } = await QueryStatsModel.list(queryThresholdMs);
  queryStatsError = error ? reportError(error, 'settings.queryStats', "Couldn't load performance figures.") : null;
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
  // Every PostgREST statement opens with the same `WITH pgrst_source AS …`
  // wrapper, so showing the raw text made all nine rows identical and the
  // panel unactionable. describeQuery() pulls the RPC or relation name out;
  // an unrecognised shape still falls back to the full SQL. Both halves of
  // what it returns are untrusted text and stay inside esc().
  const rows = queryStats.map((r) => ({ r, q: describeQuery(r.query) }));
  // Scrolls inside the panel rather than pushing it wider than every other
  // panel on the page. Seven columns plus a query label will not fit a
  // narrow window, and the alternative — letting the panel grow — made this
  // one card visibly wider than the ones above and below it.
  body.innerHTML = `
    <div class="qs-scroll">
    <table>
      <thead><tr><th>Query</th><th class="col-shrink">Calls</th><th class="col-shrink">Mean</th><th class="col-shrink">Total</th><th class="col-shrink">Max</th><th class="col-shrink">Rows</th><th class="col-shrink">Cache hit</th></tr></thead>
      <tbody>
        ${rows.map(({ r, q }) => `
          <tr>
            <td class="mono" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(q.title)}">${esc(q.label)}</td>
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
    </div>
    ${oldestSince ? `<div class="emp-meta" style="margin-top:8px;">Accumulated since ${esc(fmtTime(oldestSince))}${queryStats.length >= 50 ? ' — showing the top 50 by total time' : ''}</div>` : ''}
  `;
}

async function loadUsage() {
  const { data, error } = await UsageModel.databaseUsage();
  dbUsageError = error ? reportError(error, 'settings.usage', "Couldn't load storage usage.") : null;
  dbUsage = error ? null : data;
  usageLoaded = true;
  paintUsage();
}

function paintUsage() {
  const body = $('#us-body');
  if (!body) return; // panel not in the DOM (non-admin)
  if (!usageLoaded) { body.innerHTML = 'Loading…'; return; }
  if (dbUsageError) { body.innerHTML = `<div class="empty-state">${esc(dbUsageError)}</div>`; return; }
  if (!dbUsage) { body.innerHTML = '<div class="empty-state">No usage data available.</div>'; return; }

  const bytes = Number(dbUsage.database_bytes);
  const limit = Number(dbUsage.database_limit_bytes) || null;
  const pct = fmtPercent(bytes, limit);
  // 80% of a 500 MB ceiling is the point at which someone should be looking at
  // the archival and trim panels below rather than finding out at 100%.
  const tone = pct === null ? '' : pct >= 90 ? 'bad' : pct >= 80 ? 'warn' : '';

  const largest = topRelations(dbUsage.tables, 8);
  // Share of the total, because "12.5 MB" means nothing without knowing the
  // database is 35 MB — the ratio is what tells you where to look.
  const shareOf = (n) => (bytes > 0 ? Math.round((Number(n) / bytes) * 100) : null);

  // THE FIGURE THAT PERCENTAGE CANNOT GIVE. Storage is the one Supabase
  // quota that does not reset at the billing boundary, so 18% reads the
  // same whether it took six weeks or six years. On 2026-11-11 it had taken
  // seven weeks. `growth` is absent on a client talking to a project that
  // has not applied 20261111160000, and scanGrowthRate returns null for it
  // — which renders as "not enough history" rather than a wrong number.
  const rate = scanGrowthRate({
    bytes: dbUsage.growth?.scan_bytes,
    rows: dbUsage.growth?.scan_rows,
    firstAt: dbUsage.growth?.first_scan_at,
    lastAt: dbUsage.growth?.last_scan_at,
  });
  const projection = projectFull({
    databaseBytes: bytes, limitBytes: limit, bytesPerDay: rate?.bytesPerDay,
  });
  const severity = growthSeverity(projection.daysRemaining);
  const growthTone = severity === 'bad' ? ' bad' : severity === 'warn' ? ' warn' : '';

  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card${tone ? ` ${tone}` : ' accent'}">
        <div class="stat-value">${esc(fmtUsageBytes(bytes))}</div>
        <div class="stat-label">Database size${limit ? ` of ${esc(fmtUsageBytes(limit))}${pct === null ? '' : ` (${pct}%)`}` : ''}</div>
      </div>
      <div class="stat-card${growthTone}">
        <div class="stat-value">${rate ? `+${esc(fmtUsageBytes(rate.bytesPerDay))}` : '—'}</div>
        <div class="stat-label">Per day${rate ? ` · ${esc(Math.round(rate.scansPerDay).toLocaleString())} scans` : ''}</div>
      </div>
      <div class="stat-card${growthTone}">
        <div class="stat-value">${esc(runwayLabel(projection.daysRemaining).replace(/^about /, ''))}</div>
        <div class="stat-label">${projection.fullOn
          ? `Full around ${esc(fmtTime(projection.fullOn).split(',')[0])}`
          : 'Storage does not reset monthly'}</div>
      </div>
    </div>
    <p class="emp-meta" style="margin-top:10px;">
      ${rate
        ? `Projected from scan volume over ${esc(Math.round(rate.spanDays).toLocaleString())} days
           at ${esc(fmtUsageBytes(rate.bytesPerScan))} a scan — the dominant term, but not the only one.
           <code>employees.scan_logs</code> also grows until the 180-day trim starts biting and then
           levels off, and photo thumbnails are flat, so treat this as a floor rather than a forecast.`
        : `Not enough scan history to project a rate yet. The panel reports the size it can measure
           rather than extrapolating from a single reading.`}
    </p>
    ${largest.length ? `
      <p class="emp-meta" style="margin-top:12px;">
        Largest relations, across every schema. <b>Dead</b> is the share of rows that are
        reclaimable — large and reclaimable are different problems, and only the second one
        is fixed by vacuuming.
      </p>
      <div class="table-scroll" style="margin-top:6px;">
        <table>
          <thead><tr><th>Relation</th><th>Total</th><th>Of which indexes</th><th class="col-shrink">Share</th><th class="col-shrink">Dead</th></tr></thead>
          <tbody>
            ${largest.map((t) => {
              const share = shareOf(t.totalBytes);
              const dead = deadShare(t);
              return `<tr>
                <td class="mono">${t.schema === 'public' ? '' : `<span class="emp-meta">${esc(t.schema)}.</span>`}${esc(t.name)}</td>
                <td class="mono">${esc(fmtUsageBytes(t.totalBytes))}</td>
                <td class="mono">${esc(fmtUsageBytes(t.indexBytes))}</td>
                <td class="mono col-shrink">${share === null ? '—' : `${share}%`}</td>
                <td class="mono col-shrink${dead !== null && dead >= 20 ? ' warn-text' : ''}">${dead === null ? '—' : `${dead}%`}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}
    <p class="emp-meta" style="margin-top:10px;">
      ${dbUsage.measured_at ? `Measured ${esc(fmtTime(dbUsage.measured_at))}. ` : ''}Read on demand — never on a timer.
    </p>
  `;
}


async function loadArchiveStatus() {
  const { data, error } = await ScanArchiveModel.status();
  archiveStatusError = error ? reportError(error, 'settings.archive', "Couldn't load archive status.") : null;
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
  trimStatusError = error ? reportError(error, 'settings.trim', "Couldn't load trim status.") : null;
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
  silenceStatusError = error ? reportError(error, 'settings.silence', "Couldn't load scanner status.") : null;
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

// ---- shift times (punctuality) ----

async function loadShiftRules() {
  const { data, error } = await ShiftRulesModel.list();
  shiftRulesError = error ? reportError(error, 'settings.shifts', "Couldn't load shift times.") : null;
  shiftRules = error ? null : (data || []);
  paintShiftRules();
}

function paintShiftRules() {
  const body = $('#shift-body');
  if (!body) return;
  if (shiftRulesError) { body.innerHTML = `<div class="empty-state">${esc(shiftRulesError)}</div>`; return; }
  if (!shiftRules) { body.innerHTML = 'Loading…'; return; }

  const rows = shiftRules.map((r) => {
    const isDefault = r.department === DEFAULT_DEPARTMENT;
    return `
      <tr>
        <td data-label="Applies to">${isDefault
          ? '<strong>Every department</strong><div class="sub" style="margin:0;">unless it has its own row below</div>'
          : esc(r.department)}</td>
        <td class="col-shrink mono" data-label="Starts">${esc(String(r.starts_at).slice(0, 5))}</td>
        <td class="col-shrink mono" data-label="Grace">${r.grace_minutes}m</td>
        <td class="col-shrink mono" data-label="Ends">${r.ends_at ? esc(String(r.ends_at).slice(0, 5)) : '—'}</td>
        <td class="col-shrink mono" data-label="Expected">${r.expected_minutes ? esc(fmtExpected(r.expected_minutes)) : '—'}</td>
        <td class="col-shrink mono" data-label="Alerts outside">${
          r.after_hours_margin_minutes ? `±${r.after_hours_margin_minutes}m` : '<span class="sub">off</span>'}</td>
        <td class="col-shrink">
          <button type="button" class="ghost" data-shift-del="${esc(r.department)}"
                  ${shiftRulesSaving ? 'disabled' : ''}>Remove</button>
        </td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    ${shiftRules.length ? `
      <table class="table-as-cards">
        <thead><tr><th>Applies to</th><th class="col-shrink">Starts</th><th class="col-shrink">Grace</th>
          <th class="col-shrink">Ends</th><th class="col-shrink">Expected</th>
          <th class="col-shrink">Alerts outside</th><th class="col-shrink"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
      : `<div class="empty-state" style="text-align:left;">No shift times set, so Attendance shows no punctuality figure. Add a default below to turn it on.</div>`}
    <div class="filter-row" style="margin-top:12px;flex-wrap:wrap;">
      <input type="text" id="shift-dept" class="search" placeholder="Department (blank = default)" autocomplete="off" />
      <input type="time" id="shift-start" aria-label="Shift start time" title="Shift start" />
      <input type="number" id="shift-grace" min="0" max="240" step="1" value="0" style="width:88px;" aria-label="Grace minutes" title="Grace minutes" />
      <input type="time" id="shift-end" aria-label="Shift end time" title="Shift end (optional)" />
      <input type="number" id="shift-expected" min="0.5" max="24" step="0.25" style="width:96px;" placeholder="Hours" aria-label="Expected hours" title="Expected paid hours (optional)" />
      <input type="number" id="shift-margin" min="15" max="720" step="15" style="width:104px;" placeholder="Alert ±m" aria-label="After-hours margin" title="Alert on scans this many minutes outside the shift (optional)" />
      <button type="button" class="primary" id="shift-save" ${shiftRulesSaving ? 'disabled' : ''}>${shiftRulesSaving ? 'Saving…' : 'Save'}</button>
    </div>
    ${panelNote(
      'Start and grace drive punctuality. The other three are optional and do different jobs.',
      `<p><strong>Ends</strong> on its own does nothing — it exists so the
       other two have a window to work from.</p>
       <p><strong>Expected</strong> is paid hours per day, and it is
       deliberately not calculated from start and end: an 07:00–16:00 shift
       is nine hours elapsed but usually eight paid, because an unpaid break
       sits inside it. Deriving one from the other would overstate everyone's
       expected hours by exactly the break. Setting this turns on the
       overtime figures on Attendance.</p>
       <p><strong>Alerts outside</strong> is the only one that creates
       alerts, and it needs an end time. A scan more than this many minutes
       outside the shift raises a warning in Alerts. Leave it blank unless
       your hours are genuinely regular — on an irregular operation it
       produces noise that buries the card-sharing alerts, which are
       unambiguous. Start generous: hours, not minutes.</p>
       <p>Saving a department that already has a row replaces it, including
       clearing any of these three you leave blank.</p>`,
    )}
  `;

  $('#shift-save').addEventListener('click', handleSaveShiftRule);
  $$('button[data-shift-del]', body).forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteShiftRule(btn.dataset.shiftDel));
  });
}

// Minutes -> "8h" / "7h 30m", for the table. The column stores minutes
// because that is what the overtime arithmetic needs; the inputs are hours
// because that is how anyone states a shift.
function fmtExpected(minutes) {
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (!h) return `${m}m`;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

async function handleSaveShiftRule() {
  const startsAt = $('#shift-start')?.value;
  if (!startsAt) { toast('Pick a shift start time.', 'error'); return; }

  const endsAt = $('#shift-end')?.value || null;
  const marginRaw = $('#shift-margin')?.value;
  // Mirrors the RPC's own check so the operator finds out before a round
  // trip. The server still refuses it — that is the real boundary.
  if (marginRaw && !endsAt) {
    toast('An after-hours margin needs a shift end time.', 'error');
    return;
  }

  // Hours in the input, minutes in the column. Blank stays blank: Number('')
  // is 0, and 0 expected hours would mean every minute worked is overtime.
  const hoursRaw = $('#shift-expected')?.value;
  const expectedMinutes = String(hoursRaw ?? '').trim() === ''
    ? null
    : Math.round(Number(hoursRaw) * 60);

  shiftRulesSaving = true;
  paintShiftRules();
  const { error } = await ShiftRulesModel.set(
    $('#shift-dept')?.value, startsAt, $('#shift-grace')?.value,
    { endsAt, expectedMinutes, afterHoursMarginMinutes: marginRaw },
  );
  shiftRulesSaving = false;
  if (error) { toast(reportError(error, 'settings.shifts'), 'error'); paintShiftRules(); return; }
  toast('Shift time saved.');
  await loadShiftRules();
}

async function handleDeleteShiftRule(department) {
  const isDefault = department === DEFAULT_DEPARTMENT;
  const confirmed = await openConfirmModal({
    title: isDefault ? 'Remove the default shift time?' : `Remove the ${department} shift time?`,
    // Removing the default is the one destructive-feeling action here: it
    // silently switches the whole punctuality panel off rather than changing
    // a number, so say so plainly instead of letting it look like an edit.
    message: isDefault
      ? 'Departments without their own time will stop being judged, and Attendance will show no punctuality figure for them.'
      : `${department} will fall back to the default shift time.`,
    confirmLabel: 'Remove',
  });
  if (!confirmed) return;

  shiftRulesSaving = true;
  paintShiftRules();
  const { error } = await ShiftRulesModel.remove(department);
  shiftRulesSaving = false;
  if (error) { toast(reportError(error, 'settings.shifts'), 'error'); paintShiftRules(); return; }
  toast('Shift time removed.');
  await loadShiftRules();
}

// ---- sites and travel times (card sharing) ----

async function loadSiteRules() {
  const [sitesRes, rulesRes] = await Promise.all([
    SiteRulesModel.scannerSites(),
    SiteRulesModel.travelRules(),
  ]);
  const error = sitesRes.error || rulesRes.error;
  siteRulesError = error ? reportError(error, 'settings.sites', "Couldn't load site rules.") : null;
  scannerSites = error ? null : (sitesRes.data || []);
  travelRules = error ? null : (rulesRes.data || []);
  paintSiteRules();
}

function paintSiteRules() {
  const body = $('#travel-body');
  if (!body) return;
  if (siteRulesError) { body.innerHTML = `<div class="empty-state">${esc(siteRulesError)}</div>`; return; }
  if (!travelRules || !scannerSites) { body.innerHTML = 'Loading…'; return; }

  const configured = scannerSites.filter((s) => s.site);
  const distinctSites = [...new Set(configured.map((s) => s.site))];

  const scannerRows = scannerSites.map((s) => `
    <tr>
      <td class="mono" data-label="Scanner">${esc(s.scanner_id)}</td>
      <td data-label="Site">
        <input type="text" class="search" data-site-for="${esc(s.scanner_id)}"
               value="${esc(s.site || '')}" placeholder="No site — not checked"
               autocomplete="off" ${siteRulesSaving ? 'disabled' : ''} />
      </td>
      <td class="col-shrink">
        <button type="button" class="ghost" data-site-save="${esc(s.scanner_id)}"
                ${siteRulesSaving ? 'disabled' : ''}>Save</button>
      </td>
    </tr>`).join('');

  const ruleRows = travelRules.map((r) => {
    const isDefault = r.from_site === DEFAULT_SITE_PAIR && r.to_site === DEFAULT_SITE_PAIR;
    return `
      <tr>
        <td data-label="Between">${isDefault
          ? '<strong>Any two sites</strong><div class="sub" style="margin:0;">unless a specific pair is listed</div>'
          : `${esc(r.from_site)} ↔ ${esc(r.to_site)}`}</td>
        <td class="col-shrink mono" data-label="Takes">${r.min_minutes}m</td>
        <td class="col-shrink">
          <button type="button" class="ghost" data-travel-del="${esc(r.from_site)}|${esc(r.to_site)}"
                  ${siteRulesSaving ? 'disabled' : ''}>Remove</button>
        </td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    <table class="table-as-cards">
      <thead><tr><th class="col-shrink">Scanner</th><th>Site</th><th class="col-shrink"></th></tr></thead>
      <tbody>${scannerRows || '<tr><td colspan="3">No scanners have reported yet.</td></tr>'}</tbody>
    </table>

    ${distinctSites.length < 2 ? `
      <div class="empty-state" style="text-align:left;margin-top:12px;">
        ${configured.length === 0
          ? 'No scanner has a site yet, so nothing is being checked.'
          : 'Only one site is configured, so there is no journey to check yet.'}
        Card sharing is only detectable between two different sites.
      </div>` : ''}

    <h4 style="margin:16px 0 6px;">Travel times</h4>
    ${travelRules.length ? `
      <table class="table-as-cards">
        <thead><tr><th>Between</th><th class="col-shrink">Takes</th><th class="col-shrink"></th></tr></thead>
        <tbody>${ruleRows}</tbody>
      </table>`
      : `<div class="empty-state" style="text-align:left;">No travel times set, so no card-sharing check runs. Add a default below.</div>`}
    <div class="filter-row" style="margin-top:12px;flex-wrap:wrap;">
      <input type="text" id="travel-from" class="search" placeholder="From site (blank = any)" autocomplete="off" />
      <input type="text" id="travel-to" class="search" placeholder="To site (blank = any)" autocomplete="off" />
      <input type="number" id="travel-mins" min="1" max="1440" step="1" placeholder="Minutes" style="width:96px;" aria-label="Minutes" />
      <button type="button" class="primary" id="travel-save" ${siteRulesSaving ? 'disabled' : ''}>${siteRulesSaving ? 'Saving…' : 'Save'}</button>
    </div>
  `;

  $('#travel-save').addEventListener('click', handleSaveTravelRule);
  $$('button[data-site-save]', body).forEach((btn) => {
    btn.addEventListener('click', () => handleSaveScannerSite(btn.dataset.siteSave));
  });
  $$('button[data-travel-del]', body).forEach((btn) => {
    const [from, to] = btn.dataset.travelDel.split('|');
    btn.addEventListener('click', () => handleDeleteTravelRule(from, to));
  });
}

async function handleSaveScannerSite(scannerId) {
  const input = $(`input[data-site-for="${scannerId}"]`);
  if (!input) return;
  siteRulesSaving = true;
  paintSiteRules();
  const { error } = await SiteRulesModel.setScannerSite(scannerId, input.value);
  siteRulesSaving = false;
  if (error) { toast(reportError(error, 'settings.sites'), 'error'); paintSiteRules(); return; }
  toast('Site saved.');
  await loadSiteRules();
}

async function handleSaveTravelRule() {
  const mins = Number($('#travel-mins')?.value);
  if (!Number.isFinite(mins) || mins < 1) { toast('Enter a travel time of at least one minute.', 'error'); return; }

  siteRulesSaving = true;
  paintSiteRules();
  const { error } = await SiteRulesModel.setTravelRule(
    $('#travel-from')?.value, $('#travel-to')?.value, mins,
  );
  siteRulesSaving = false;
  if (error) { toast(reportError(error, 'settings.sites'), 'error'); paintSiteRules(); return; }
  toast('Travel time saved.');
  await loadSiteRules();
}

async function handleDeleteTravelRule(fromSite, toSite) {
  const isDefault = fromSite === DEFAULT_SITE_PAIR && toSite === DEFAULT_SITE_PAIR;
  const confirmed = await openConfirmModal({
    title: 'Remove this travel time?',
    message: isDefault
      ? 'Site pairs without a specific rule will stop being checked, so card sharing between them will no longer raise an alert.'
      : `${fromSite} ↔ ${toSite} will fall back to the default travel time, if one is set.`,
    confirmLabel: 'Remove',
  });
  if (!confirmed) return;

  siteRulesSaving = true;
  paintSiteRules();
  const { error } = await SiteRulesModel.removeTravelRule(fromSite, toSite);
  siteRulesSaving = false;
  if (error) { toast(reportError(error, 'settings.sites'), 'error'); paintSiteRules(); return; }
  toast('Travel time removed.');
  await loadSiteRules();
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
            ${obj
              ? `Set, ${fmtBytes(obj.size)} — uploaded ${esc(fmtTime(obj.updated_at))}`
              // Not silence: every outcome has a bundled tone that ships with
              // the app and is precached by the Service Worker, so a kiosk is
              // audible from its first boot whether or not anything is
              // uploaded here. The old wording promised silence and was wrong.
              : 'Not set — the built-in tone plays for this outcome.'}
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
  $$('button', row).forEach((b) => (b.disabled = true));

  // Shrink before sending. A sound-library clip is routinely 48kHz stereo and
  // hundreds of KB per second; mono at 22050 is inaudibly different through a
  // kiosk speaker and uploads several times faster on this site's link.
  //
  // shrinkSoundFile is time-boxed and never throws, but this belt-and-braces
  // catch is the difference between "the shrink did not work" and "the row
  // sits on Preparing… forever and nothing uploads", which is what was
  // reported. The optimisation must never be able to gate the upload.
  statusEl.textContent = 'Preparing…';
  let prepared;
  try {
    prepared = await shrinkSoundFile(file);
  } catch (err) {
    prepared = { file, before: file.size, after: file.size, saved: 0, changed: false, trimmed: false, reason: String(err) };
  }
  // Says why on the console when the clip went up as-is. Without this, "it did
  // not get smaller" and "it timed out" look identical from the outside.
  if (!prepared.changed && prepared.reason) {
    console.warn(`Scan sound "${key}" uploaded without shrinking: ${prepared.reason}`);
  }

  // Say the size as well as the percentage: "47%" of an unknown total tells
  // you nothing about how long is left on a slow link.
  const sizeNote = prepared.changed
    ? `${fmtBytes(prepared.after)} (was ${fmtBytes(prepared.before)})`
    : fmtBytes(prepared.before);

  // Real bytes, not a shimmer. onProgress gets null once the bytes are all
  // sent and the server has yet to answer — that is a genuinely unknown wait,
  // so the bar switches to the indeterminate style for it rather than sitting
  // at 100% looking finished.
  const fillEl = $('.progress-fill', progressEl);
  fillEl.classList.remove('indeterminate');
  fillEl.style.width = '0%';
  const { error } = await ScanSoundsModel.upload(key, prepared.file, (pct) => {
    if (pct === null) {
      fillEl.classList.add('indeterminate');
      statusEl.textContent = `Saving ${sizeNote}…`;
      return;
    }
    fillEl.classList.remove('indeterminate');
    fillEl.style.width = `${pct}%`;
    statusEl.textContent = `Uploading ${sizeNote} — ${pct}%`;
  });

  progressEl.classList.add('hidden');
  inputEl.value = '';
  if (error) {
    toast(reportError(error, 'settings.soundUpload', 'Upload failed. Try a smaller file.'), 'error');
    // repaint this row back to its last-known-good state rather than
    // leaving it stuck on "Uploading…"
    paintRows();
    return;
  }
  soundsCache[key] = { updated_at: new Date().toISOString(), size: prepared.file.size };
  // Trimming is destructive, so it is never silent — this is the one message
  // the admin must not miss.
  toast(prepared.trimmed
    ? `${SOUND_LABELS[key]} sound updated — trimmed to the first ${MAX_SOUND_SECONDS}s and compressed to ${fmtBytes(prepared.after)}`
    : prepared.changed
      ? `${SOUND_LABELS[key]} sound updated — compressed to ${fmtBytes(prepared.after)}`
      : `${SOUND_LABELS[key]} sound updated`);
  paintRows();
  paintStorageSummary();
}

async function handleRemove(key) {
  const row = $(`[data-sound-row="${key}"]`);
  $$('button', row).forEach((b) => (b.disabled = true));
  const { error } = await ScanSoundsModel.remove(key);
  if (error) {
    toast(reportError(error, 'settings.soundRemove', "Couldn't remove that sound."), 'error');
    $$('button', row).forEach((b) => (b.disabled = false));
    return;
  }
  soundsCache[key] = null;
  toast(`${SOUND_LABELS[key]} sound removed`);
  paintRows();
  paintStorageSummary();
}
