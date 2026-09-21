// Settings page. Two independent panels — "Scan sounds" (Scanner-related)
// and "Employee photos" (Employee Manager-related) — each shown only when
// the signed-in account's access_scope covers that module (or they're an
// admin, who always sees both). This mirrors canViewEmployeeManager() /
// canViewScanner() in Core/state.js rather than inventing a separate
// permission scheme — see state.js for the canViewSettings() /
// settingsShowSounds() / settingsShowPhotos() / canManageScanSounds()
// helpers this file reads, and Supabase/README.md for their server-side
// mirror (can_view_settings() / can_manage_scan_sounds()).
import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime, fmtBytes } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { getTheme, setTheme } from '../../Utils/theme.js';
import { settingsShowSounds, settingsShowPhotos, canManageScanSounds } from '../../Core/state.js';
import { ScanSoundsModel, SOUND_KEYS, SOUND_LABELS, MAX_FILE_SIZE_BYTES } from '../../Models/ScanSoundsModel.js';
import { EmployeesModel } from '../../Models/EmployeesModel.js';

let soundsCache = {}; // key -> { updated_at, size } | null, once loaded
let loaded = false;

// Every key is capped at MAX_FILE_SIZE_BYTES by the bucket itself, so
// "all 5 at their individual max" is a real, meaningful ceiling here —
// not an arbitrary number — for the capacity bar below.
const TOTAL_CAPACITY = Object.keys(SOUND_KEYS).length * MAX_FILE_SIZE_BYTES;

let photoQuota = null; // { usage, limit, usageInDrive } once loaded, else null
let photoQuotaError = null;
let photoLoaded = false;

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
  `;
  paintThemePicker();
  $$('button[data-theme-choice]', $('#theme-picker')).forEach((btn) => {
    btn.addEventListener('click', () => { setTheme(btn.dataset.themeChoice); paintThemePicker(); });
  });
  if (showSounds && loaded) { paintRows(); paintStorageSummary(); }
  if (showPhotos && photoLoaded) paintPhotoStorage();

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