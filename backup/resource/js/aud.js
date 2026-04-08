// resource/js/aud.js  — audio settings manager

// ─── Mute state ────────────────────────────────────────────────────────────

let audioStates = {
  success: true,
  not_found: true,
  inactive: true,
  violations: true,
};

// ─── Audio paths from server (injected by PHP or fetched) ──────────────────

let audioPaths = {
  success: null,
  not_found: null,
  inactive: null,
  violations: null,
};

// ─── Pre-loaded Audio objects cache ────────────────────────────────────────

const audioCache = {};

// ─── Fallback tone settings ────────────────────────────────────────────────

const TONE_CONFIG = {
  success:    { frequency: 800, type: 'sine',     duration: 0.4 },
  not_found:  { frequency: 300, type: 'sawtooth', duration: 0.3 },
  inactive:   { frequency: 220, type: 'square',   duration: 0.5 },
  violations: { frequency: 600, type: 'triangle', duration: 0.6 },
};

// ═══════════════════════════════════════════════════════════════════════════
// INITIALISATION
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  loadMuteStates();
  loadAudioPaths();
  setupFileUploadHandlers();
});

/**
 * Load mute states from localStorage.
 */
function loadMuteStates() {
  try {
    const saved = localStorage.getItem('audioSettings');
    if (saved) {
      audioStates = { ...audioStates, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Could not parse saved audio states:', e);
  }
  updateAllToggles();
}

/**
 * Load audio paths.
 * Uses window.AUDIO_SETTINGS when available (injected by settings.php).
 * Otherwise fetches from get_audio_settings.php (for scanner pages, etc.).
 */
function loadAudioPaths() {
  if (window.AUDIO_SETTINGS) {
    // Injected directly by PHP — no network request needed
    audioPaths = { ...audioPaths, ...window.AUDIO_SETTINGS };
    preloadAudioFiles();
    return;
  }

  // Fetch from API (scanner pages, other pages)
  fetch('../pages/get_audio_settings.php')
    .then((r) => r.json())
    .then((data) => {
      audioPaths = { ...audioPaths, ...data };
      preloadAudioFiles();
    })
    .catch((e) => {
      console.warn('Could not load audio settings from server:', e);
    });
}

/**
 * Pre-load Audio objects for instant playback.
 */
function preloadAudioFiles() {
  Object.entries(audioPaths).forEach(([type, path]) => {
    if (!path) return;
    try {
      const audio = new Audio(path);
      audio.preload = 'auto';
      audio.volume = 0.8;
      audioCache[type] = audio;
    } catch (e) {
      console.warn(`Could not preload audio for "${type}":`, e);
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TOGGLE MUTE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Toggle mute for a given audio type.
 * Called by onclick in settings.php.
 */
function toggleMute(audioType) {
  // If called from legacy onclick with no argument, derive type from DOM
  if (!audioType && event) {
    const group = event.target.closest('.audio-group');
    if (!group) return;
    audioType = group.dataset.audioType;
  }
  if (!audioType || !(audioType in audioStates)) return;

  audioStates[audioType] = !audioStates[audioType];
  updateToggle(audioType);
  saveMuteStates();

  // Play a quick preview when unmuting
  if (audioStates[audioType]) {
    playSystemAudio(audioType);
  }
}

function updateToggle(audioType) {
  const toggleEl = document.getElementById('toggle-' + audioType);
  if (!toggleEl) return;

  const slider = toggleEl.querySelector('.toggle-slider');

  if (audioStates[audioType]) {
    toggleEl.classList.add('active');
    if (slider) slider.style.transform = 'translateX(26px)';
  } else {
    toggleEl.classList.remove('active');
    if (slider) slider.style.transform = 'translateX(0px)';
  }
}

function updateAllToggles() {
  Object.keys(audioStates).forEach(updateToggle);
}

function saveMuteStates() {
  localStorage.setItem('audioSettings', JSON.stringify(audioStates));
  window.dispatchEvent(new CustomEvent('audioSettingsChanged', { detail: audioStates }));
}

// ═══════════════════════════════════════════════════════════════════════════
// PLAYBACK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Play a system audio event.
 * Uses uploaded file if available, otherwise generates a tone.
 */
function playSystemAudio(audioType) {
  if (!audioStates[audioType]) return; // muted

  const cachedAudio = audioCache[audioType];

  if (cachedAudio) {
    // Reset to start so it plays immediately even if triggered rapidly
    cachedAudio.currentTime = 0;
    cachedAudio.play().catch((e) => {
      console.warn(`Playback failed for "${audioType}", using fallback tone:`, e);
      playFallbackTone(audioType);
    });
    return;
  }

  // No file uploaded — use generated tone
  playFallbackTone(audioType);
}

/**
 * Generate and play a short Web Audio tone as fallback.
 */
function playFallbackTone(audioType) {
  const config = TONE_CONFIG[audioType];
  if (!config) return;

  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = config.type;
    osc.frequency.setValueAtTime(config.frequency, ctx.currentTime);

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + config.duration);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + config.duration);

    osc.onended = () => ctx.close();
  } catch (e) {
    console.error('Web Audio fallback failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE UPLOAD HANDLERS (settings page)
// ═══════════════════════════════════════════════════════════════════════════

function setupFileUploadHandlers() {
  document.querySelectorAll('input[type="file"][accept="audio/*"]').forEach((input) => {
    input.addEventListener('change', handleAudioFileChange);
  });
}

function handleAudioFileChange(e) {
  const input  = e.target;
  const label  = input.nextElementSibling;
  const file   = input.files[0];

  if (!label) return;

  if (!file) {
    label.innerHTML = '<i class="fas fa-file-audio"></i> Click to select audio';
    label.style.color = '';
    return;
  }

  // Validate type
  if (!file.type.startsWith('audio/')) {
    alert('Please select a valid audio file (MP3, WAV, OGG, AAC).');
    input.value = '';
    return;
  }

  // Validate size (5 MB)
  if (file.size > 5 * 1024 * 1024) {
    alert('File size must be less than 5 MB.');
    input.value = '';
    return;
  }

  label.innerHTML = `<i class="fas fa-check-circle" style="color:#28a745"></i> ${file.name}`;

  // Offer a quick preview
  offerPreview(file);
}

function offerPreview(file) {
  const url   = URL.createObjectURL(file);
  const audio = new Audio(url);

  audio.addEventListener('loadeddata', () => {
    if (confirm(`Preview "${file.name}"?`)) {
      audio.volume = 0.4;
      audio.play().catch(() => {});

      setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
        URL.revokeObjectURL(url);
      }, 2500);
    } else {
      URL.revokeObjectURL(url);
    }
  });

  audio.addEventListener('error', () => {
    alert('Could not load this audio file for preview.');
    URL.revokeObjectURL(url);
  });
}

// ─── Form guard: warn if no file is selected ───────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector("form[method='POST'][enctype='multipart/form-data']");
  if (!form) return;

  form.addEventListener('submit', (e) => {
    const inputs   = form.querySelectorAll('input[type="file"]');
    const hasFiles = [...inputs].some((i) => i.files.length > 0);

    if (!hasFiles) {
      e.preventDefault();
      alert('Please select at least one audio file to upload.');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    if (btn) {
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';
      btn.disabled  = true;
    }
  });
});

// ─── Cross-tab sync ────────────────────────────────────────────────────────

window.addEventListener('audioSettingsChanged', (e) => {
  audioStates = { ...audioStates, ...e.detail };
  updateAllToggles();
});

// ─── Public API ────────────────────────────────────────────────────────────

window.playSystemAudio = playSystemAudio;
window.isAudioMuted    = (type) => !audioStates[type];
window.getAudioStates  = () => ({ ...audioStates });