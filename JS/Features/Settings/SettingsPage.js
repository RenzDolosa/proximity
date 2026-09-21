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
import { isAdmin, settingsShowSounds, settingsShowPhotos, canManageScanSounds } from '../../Core/state.js';
import { ScanSoundsModel, SOUND_KEYS, SOUND_LABELS, MAX_FILE_SIZE_BYTES } from '../../Models/ScanSoundsModel.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';
import { QueryStatsModel } from '../../Models/QueryStatsModel.js';
import { openConfirmModal } from '../../Components/ConfirmModal.js';

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

    ${(!showSounds && !showPhotos) ? `
    <div class="empty-state" style="margin-top:16px;">You don't have access to any other Settings panels.</div>
    ` : `
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

    ${!isAdmin() ? '' : `
    <div class="panel" style="padding:20px;max-width:920px;margin-top:16px;">
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
    `}
  `;
  paintThemePicker();
  $$('button[data-theme-choice]', $('#theme-picker')).forEach((btn) => {
    btn.addEventListener('click', () => { setTheme(btn.dataset.themeChoice); paintThemePicker(); });
  });
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
  if (isAdmin()) tasks.push(loadQueryStats());

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