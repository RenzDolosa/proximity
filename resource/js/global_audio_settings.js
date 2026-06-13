// resource/js/global_audio_settings.js

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────────────────────
  const AUDIO_TYPES = [
    {
      key: "success",
      label: "Success sound",
      icon: "fa-check-circle",
      color: "#22c55e",
    },
    {
      key: "checkout",
      label: "Checked Out sound",
      icon: "fa-check-circle",
      color: "#c54822",
    },
    {
      key: "not_found",
      label: "Not found sound",
      icon: "fa-search",
      color: "#f59e0b",
    },
    {
      key: "inactive",
      label: "Inactive sound",
      icon: "fa-user-slash",
      color: "#64748b",
    },
    {
      key: "violations",
      label: "Violations sound",
      icon: "fa-exclamation-triangle",
      color: "#ef4444",
    },
  ];

  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB raw

  // ── State ─────────────────────────────────────────────────────────────────
  const pending = {};

  // ── Build UI ──────────────────────────────────────────────────────────────
  function buildCard() {
    const container = document.getElementById("global-audio-card-body");
    if (!container) return;

    container.innerHTML = `
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:7px;">
        Upload custom audio for each system event. Changes apply globally to all scan stations.
        Supported: MP3, WAV, OGG, AAC — max 5 MB each.
      </p>
      <div class="audio-grid" id="global-audio-grid"></div>
      <div id="global-audio-msg" style="font-size:12px;margin-top:10px;"></div>
      <button id="global-audio-save-btn" class="btn btn-primary" tabindex="-1" style="margin-top:7px;">
        <i class="fas fa-save"></i> Save Audio Settings
      </button>`;

    const grid = document.getElementById("global-audio-grid");

    AUDIO_TYPES.forEach(({ key, label, icon, color }) => {
      const card = document.createElement("div");
      card.className = "audio-card";
      card.id = `gacard-${key}`;
      card.innerHTML = audioCardHtml(key, label, icon, color, null, null);
      grid.appendChild(card);
    });

    document
      .getElementById("global-audio-save-btn")
      .addEventListener("click", saveAll);

    loadAll();
  }

  function audioCardHtml(key, label, icon, color, dataUrl, mime) {
    const hasAudio = dataUrl && dataUrl.length > 0;
    const badge = hasAudio
      ? `<span class="badge badge-ok">Uploaded</span>`
      : `<span class="badge badge-none">None</span>`;

    const audioEl = hasAudio
      ? `<audio controls preload="none" style="flex:1;min-width:0;height:32px;">
           <source src="${dataUrl}" type="${mime || "audio/mpeg"}">
         </audio>`
      : `<div style="flex:1;"></div>`;

    const removeBtn = hasAudio
      ? `<button class="remove-audio" data-key="${key}">
           <i class="fas fa-times-circle"></i> Remove
         </button>`
      : "";

    return `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:nowrap;">
        <div class="audio-card-label" style="display:flex;align-items:center;gap:6px;white-space:nowrap;min-width:130px;">
          <i class="fas ${icon}" style="color:${color};font-size:14px;"></i>
          ${label}
        </div>
        ${audioEl}
        ${badge}
        <label class="file-upload-label" for="ga-input-${key}" style="margin:0;white-space:nowrap;cursor:pointer;">
          <i class="fas fa-file-audio"></i> ${hasAudio ? "Replace" : "Select file"}
        </label>
        <input type="file" id="ga-input-${key}" data-key="${key}"
               accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,audio/aac"
               style="display:none;">
        ${removeBtn}
      </div>
      <div class="file-chosen" id="ga-chosen-${key}" style="font-size:11px;color:#64748b;margin-top:2px;padding-left:136px;"></div>`;
  }

  // ── Load from server ──────────────────────────────────────────────────────
  async function loadAll() {
    try {
      const res = await fetch(`${GlobalAudioBackend}`, {
        credentials: "same-origin",
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      const data = await res.json();
      if (!data.success) return;

      AUDIO_TYPES.forEach(({ key, label, icon, color }) => {
        const entry = data.audio[key] || { data: "", mime: "" };
        refreshCard(key, label, icon, color, entry.data, entry.mime);
      });
    } catch (e) {
      console.warn("Could not load global audio settings:", e);
    }
  }

  // ── Refresh a single card's HTML and re-bind listeners ───────────────────
  function refreshCard(key, label, icon, color, dataUrl, mime) {
    const card = document.getElementById(`gacard-${key}`);
    if (!card) return;
    card.innerHTML = audioCardHtml(key, label, icon, color, dataUrl, mime);
    bindCard(key);
  }

  function bindCard(key) {
    const fileInput = document.getElementById(`ga-input-${key}`);
    if (fileInput) {
      fileInput.addEventListener("change", () => onFileChosen(key, fileInput));
    }

    const removeBtn = document.querySelector(`#gacard-${key} .remove-audio`);
    if (removeBtn) {
      removeBtn.addEventListener("click", () => onRemove(key));
    }
  }

  // ── File chosen handler ───────────────────────────────────────────────────
  function onFileChosen(key, input) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > MAX_BYTES) {
      showMsg(`"${file.name}" exceeds the 5 MB limit.`, "error");
      input.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      pending[key] = { data: e.target.result, mime: file.type };
      document.getElementById(`ga-chosen-${key}`).textContent = file.name;
      showMsg(`"${file.name}" queued. Click Save to apply.`, "info");
    };
    reader.readAsDataURL(file);
    input.value = "";
  }

  // ── Remove handler ────────────────────────────────────────────────────────
  function onRemove(key) {
    if (!confirm(`Remove the ${key} sound globally?`)) return;
    pending[key] = { data: "", mime: "" };
    const entry = AUDIO_TYPES.find((t) => t.key === key);
    if (entry) refreshCard(key, entry.label, entry.icon, entry.color, "", "");
    showMsg(`"${key}" sound marked for removal. Click Save to apply.`, "info");
  }

  // ── Save all pending changes ──────────────────────────────────────────────
  async function saveAll() {
    const btn = document.getElementById("global-audio-save-btn");
    if (!Object.keys(pending).length) {
      showMsg("No changes to save.", "warning");
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

    const keys = Object.keys(pending);
    let success = true;

    for (const key of keys) {
      const { data, mime } = pending[key];
      const isDelete = data === "";

      try {
        const method = isDelete ? "DELETE" : "POST";
        const res = await fetch(GlobalAudioBackend, {
          method,
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify({
            audio_type: key,
            audio_data: data,
            audio_mime: mime,
          }),
        });
        const json = await res.json();
        if (!json.success) {
          showMsg(json.message || `Failed to save "${key}" sound.`, "error");
          success = false;
        } else {
          delete pending[key];
        }
      } catch (e) {
        showMsg(`Network error saving "${key}".`, "error");
        success = false;
      }
    }

    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save"></i> Save Audio Settings';

    if (success) {
      showMsg("Audio settings saved successfully!", "success");
      loadAll();
    }
  }

  // ── Message helper ────────────────────────────────────────────────────────
  function showMsg(text, type) {
    const el = document.getElementById("global-audio-msg");
    if (!el) return;
    const colors = {
      success: "#16a34a",
      error: "#dc2626",
      warning: "#b45309",
      info: "#0369a1",
    };
    el.style.color = colors[type] || "#333";
    el.textContent = text;
    if (type === "success")
      setTimeout(() => {
        if (el) el.textContent = "";
      }, 3000);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async function () {
    const ready = await resolveEndpoints();
    if (!ready) return;

    buildCard();
  });
})();
