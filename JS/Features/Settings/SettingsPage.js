// Admin-only Settings page. Currently holds one section — the 5 scan
// feedback sounds, stored in the public `scan-sounds` Storage bucket (see
// Models/ScanSoundsModel.js) — but is its own top-level route/file rather
// than folded into Users & Roles so future non-user settings have a home
// without another restructure.
import { $, $$ } from '../../Utils/dom.js';
import { esc, fmtTime } from '../../Utils/format.js';
import { toast } from '../../Utils/toast.js';
import { isAdmin } from '../../Core/state.js';
import { ScanSoundsModel, SOUND_KEYS, SOUND_LABELS } from '../../Models/ScanSoundsModel.js';

let soundsCache = {}; // key -> { updated_at } | null, once loaded
let loaded = false;

export async function renderSettings() {
  const content = $('#content');
  if (!isAdmin()) { content.innerHTML = `<div class="empty-state">Admins only.</div>`; return; }
  content.innerHTML = `
    <div class="panel" style="padding:20px;max-width:720px;">
      <h3 style="margin:0 0 4px;">Scan sounds</h3>
      <p class="sub" style="margin:0 0 18px;">
        Upload a short audio clip for each scan outcome. They play on the
        live Scanner and Test Scan as soon as a result comes back.
        Uploading a new file replaces the previous one immediately.
      </p>
      <div id="sound-rows">${loaded ? '' : 'Loading…'}</div>
    </div>
  `;
  if (loaded) paintRows();

  const { data, error } = await ScanSoundsModel.list();
  if (error) { $('#sound-rows').innerHTML = `<div class="empty-state">${esc(error.message)}</div>`; return; }
  const byPath = Object.fromEntries((data || []).map((o) => [o.name, o]));
  soundsCache = Object.fromEntries(Object.keys(SOUND_KEYS).map((key) => [key, byPath[SOUND_KEYS[key]] || null]));
  loaded = true;
  paintRows();
}

function paintRows() {
  const wrap = $('#sound-rows');
  wrap.innerHTML = Object.keys(SOUND_KEYS).map((key) => {
    const obj = soundsCache[key];
    return `
      <div class="field" data-sound-row="${key}" style="border-top:1px solid var(--border);padding-top:14px;margin-top:14px;">
        <label style="margin-bottom:2px;">${esc(SOUND_LABELS[key])}</label>
        <div class="emp-meta" data-status style="margin-bottom:8px;">
          ${obj ? `Set — uploaded ${esc(fmtTime(obj.updated_at))}` : 'Not set — the scan stays silent for this outcome.'}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="file" accept="audio/*" data-file="${key}" />
          <button type="button" class="ghost" data-preview="${key}" ${obj ? '' : 'disabled'}>▶ Preview</button>
          <button type="button" class="ghost danger" data-remove="${key}" ${obj ? '' : 'style="display:none;"'}>Remove</button>
        </div>
        <div class="progress hidden" data-progress style="margin-top:8px;">
          <div class="progress-track"><div class="progress-fill indeterminate"></div></div>
        </div>
      </div>
    `;
  }).join('');

  $$('input[data-file]', wrap).forEach((input) => {
    input.addEventListener('change', (e) => handleUpload(e.target.dataset.file, e.target.files[0], e.target));
  });
  $$('button[data-preview]', wrap).forEach((btn) => {
    btn.addEventListener('click', () => {
      const obj = soundsCache[btn.dataset.preview];
      if (!obj) return;
      const url = `${ScanSoundsModel.publicUrl(btn.dataset.preview)}?v=${encodeURIComponent(obj.updated_at || obj.id || '')}`;
      new Audio(url).play().catch(() => toast('Could not play this file — it may not be a supported audio format.', 'error'));
    });
  });
  $$('button[data-remove]', wrap).forEach((btn) => {
    btn.addEventListener('click', () => handleRemove(btn.dataset.remove));
  });
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
  soundsCache[key] = { updated_at: new Date().toISOString() };
  toast(`${SOUND_LABELS[key]} sound updated`);
  paintRows();
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
}