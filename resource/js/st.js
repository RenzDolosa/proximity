// resource/js/qp.js --> qr proximity scanner/viewer

let ScanTestBackend = null;
let GlobalAudioBackend = null;

const searchInput = document.getElementById("searchInput");
const body = document.body;

let searchTimeout;
let currentResults = [];
let displayTimeout;
let currentAudio = null;
let activeController = null;

let scanQueue = [];
let isProcessing = false;

let _wasHidden = false;

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    _wasHidden = true;
    body.classList.add("scanner-paused");
  } else if (_wasHidden) {
    _wasHidden = false;
    body.classList.remove("scanner-paused");
    searchInput.focus();
  }
});

window.addEventListener("focus", () => {
  body.classList.remove("scanner-paused");
  searchInput.focus();
});

window.addEventListener("blur", () => {
  body.classList.add("scanner-paused");
});

// ── Global-audio endpoint ─────────────────────────────────────────
const AUDIO_TYPE_MAP = {
  success: "successSound",
  checkout: "checkoutSound",
  not_found: "noResultSound",
  violations: "warningSound",
  inactive: "inactiveSound",
};

// ─────────────────────────────────────────────────────────────────
//  SECURITY: Read the CSRF token from the meta tag injected by PHP.
//  This token is attached to every POST request so the backend can
//  verify the request originated from this page, not a foreign site.
// ─────────────────────────────────────────────────────────────────
function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.content : "";
}

// ─────────────────────────────────────────────────────────────────
//  Load global audio from DB; fall back to bundled files if absent
// ─────────────────────────────────────────────────────────────────
async function loadGlobalAudio() {
  try {
    const res = await fetch(`${GlobalAudioBackend}`, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (!json.success) throw new Error("Server returned success:false");

    Object.entries(AUDIO_TYPE_MAP).forEach(([audioType, elementId]) => {
      const el = document.getElementById(elementId);
      if (!el) return;

      const entry = json.audio?.[audioType];

      if (entry?.data && entry.data.length > 0) {
        el.src = entry.data;
        el.preload = "auto";
      } else {
        const fallback = el.dataset.fallback;
        if (fallback) {
          el.src = fallback;
          el.preload = "auto";
        }
      }
    });
  } catch (e) {
    console.warn("Could not load global audio; using bundled fallbacks.", e);

    Object.values(AUDIO_TYPE_MAP).forEach((elementId) => {
      const el = document.getElementById(elementId);
      if (el && !el.src && el.dataset.fallback) {
        el.src = el.dataset.fallback;
        el.preload = "auto";
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────
//  IMAGE URL HELPER
// ─────────────────────────────────────────────────────────────────
function imageUrl(filename, updatedAt) {
  if (!filename || !filename.trim()) return null;
  const bare = filename.trim().replace(/^.*[\\/]/, "");
  if (!bare) return null;
  const version = updatedAt ? encodeURIComponent(updatedAt) : Date.now();
  return `${window.location.origin}/../../public/uploads/user/${bare}?v=${version}`;
}

async function processQueue() {
  if (isProcessing || scanQueue.length === 0) return;

  isProcessing = true;
  const query = scanQueue.shift();

  try {
    await searchEmployees(query);
  } catch (e) {
    console.error("Queue processing error:", e);
  } finally {
    isProcessing = false;
    if (scanQueue.length > 0) {
      const latest = scanQueue[scanQueue.length - 1];
      scanQueue = [];
      scanQueue.push(latest);
    }
    processQueue();
  }
}

function enqueueSearch(query) {
  scanQueue.push(query);
  processQueue();
}

// ─────────────────────────────────────────────────────────────────
//  Event listeners
// ─────────────────────────────────────────────────────────────────
function setupEventListeners() {
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (query !== "") {
        captureAndSearch(query);
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "v") {
      e.preventDefault();
    }
  });

  searchInput.addEventListener("input", function (e) {

    if (isProcessing) return;

    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query === "") return;

    clearTimeout(searchInput.autoClearTimeout);
    searchInput.autoClearTimeout = setTimeout(() => {
      if (!isProcessing) {
        searchInput.value = "";
        searchInput.focus();
      }
    }, 30000);

    searchTimeout = setTimeout(() => {
      const finalQuery = searchInput.value.trim();
      if (finalQuery !== "") captureAndSearch(finalQuery);
    }, 400);
  });

  searchInput.addEventListener("paste", function (e) {
    e.preventDefault();
  });

  document.addEventListener("click", function (e) {
    if (!e.target.matches("input,button,select,textarea,a"))
      searchInput.focus();
  });

  document.addEventListener("keydown", function (e) {
    if (
      document.activeElement.tagName !== "INPUT" &&
      document.activeElement.tagName !== "TEXTAREA" &&
      !e.target.classList.contains("filter-btn")
    )
      searchInput.focus();
  });

  setTimeout(() => {
    searchInput.value = "";
    searchInput.focus();
  }, 300);
}

function captureAndSearch(query) {
  clearTimeout(searchTimeout);
  clearTimeout(searchInput.autoClearTimeout);

  searchInput.value = "";
  lockSearchInput();
  searchInput.focus();

  enqueueSearch(query);
}

// ─────────────────────────────────────────────────────────────────
//  Audio helpers
// ─────────────────────────────────────────────────────────────────
function stopCurrentAudio() {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  currentAudio = null;
}

function playSound(id) {
  stopCurrentAudio();
  const sound = document.getElementById(id);
  if (!sound) return;
  currentAudio = sound;
  sound.currentTime = 0;
  sound.play().catch((e) => console.log("Audio play error:", e));
}

const playSuccessSound = () => playSound("successSound");
const playCheckoutSound = () => playSound("checkoutSound");
const playInactiveSound = () => playSound("inactiveSound");
const playNoResultSound = () => playSound("noResultSound");
const playWarningSound = () => playSound("warningSound");

// ─────────────────────────────────────────────────────────────────
//  Input-block helper
// ─────────────────────────────────────────────────────────────────
function lockSearchInput() {
  searchInput.disabled = true;
  searchInput.style.opacity = "0";
  searchInput.style.pointerEvents = "none";
  body.classList.add("input-blocked-alt");
}

function unlockSearchInput(durationMs = 500) {
  setTimeout(() => {
    searchInput.disabled = false;
    searchInput.style.opacity = "1";
    searchInput.style.pointerEvents = "auto";
    body.classList.remove("input-blocked-alt");
    if (!isProcessing) {
      searchInput.value = "";
    }
    searchInput.focus();
  }, durationMs);
}

// ─────────────────────────────────────────────────────────────────
//  QR Code detection
// ─────────────────────────────────────────────────────────────────
function looksLikeQRCode(query) {
  if (query.length < 8) return false;

  const hasDigit = /\d/.test(query);
  if (!hasDigit) return false;

  const isLong = query.length >= 10;
  const hasSeparator = /[-_]/.test(query);

  return isLong || hasSeparator;
}

// ─────────────────────────────────────────────────────────────────
//  Core search
// ─────────────────────────────────────────────────────────────────
async function searchEmployees(query) {
  if (activeController) activeController.abort();
  activeController = new AbortController();
  const { signal } = activeController;

  const messageEl = document.getElementById("message");
  const resultsTable = document.getElementById("resultsTable");
  const resultsBody = document.getElementById("resultsBody");

  try {
    resultsTable.style.display = "none";

    let url, method, fetchBody;

    if (looksLikeQRCode(query)) {
      url = `${ScanTestBackend}`;
      method = "POST";
      fetchBody = JSON.stringify({
        action: "get_by_qr",
        qr_code: query,
        source: "scanner",
      });
    } else {
      url = `${ScanTestBackend}?q=${encodeURIComponent(query)}`;
      method = "GET";
    }

    const response = await fetch(url, {
      method,
      signal,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(method === "POST"
          ? {
              "Content-Type": "application/json",
              "X-CSRF-Token": getCsrfToken(),
            }
          : {}),
      },
      ...(method === "POST" ? { body: fetchBody } : {}),
    });

    if (response.status === 401) {
      messageEl.innerHTML =
        '<p class="no-results-message">Session expired. Please log in again.</p>';
      playNoResultSound();
      return;
    }

    if (response.status === 403) {
      messageEl.innerHTML =
        '<p class="no-results-message">Request blocked. Please refresh the page.</p>';
      playNoResultSound();
      return;
    }

    if (response.status === 429) {
      messageEl.innerHTML =
        '<p class="no-results-message">Too many searches. Please slow down.</p>';
      playNoResultSound();
      return;
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (data.success) {
      currentResults = Array.isArray(data.data) ? data.data : [data.data];

      if (currentResults.length === 0) {
        messageEl.innerHTML = `<p class="no-results-message">No results found. 🔍</p>`;
        playNoResultSound();
        return;
      }

      renderResults(currentResults);
    } else {
      messageEl.innerHTML = `<p class="no-results-message">No results found. 🔍</p>`;
      playNoResultSound();
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    messageEl.innerHTML =
      '<div class="error-message">Failed to search. Please check your connection.</div>';
    currentResults = [];
  } finally {
    unlockSearchInput();
  }
}

// ─────────────────────────────────────────────────────────────────
//  Render results
// ─────────────────────────────────────────────────────────────────
function renderResults(results) {
  stopCurrentAudio();

  const messageEl = document.getElementById("message");
  const resultsTable = document.getElementById("resultsTable");
  const resultsBody = document.getElementById("resultsBody");

  if (displayTimeout) {
    clearTimeout(displayTimeout);
    displayTimeout = null;
  }

  messageEl.innerHTML = "";
  resultsTable.style.display = "block";

  const hasViolations = results.some(
    (e) => e.violation && e.violation.trim() !== "",
  );
  const hasInactive = results.some(
    (e) => (e.status || "").toLowerCase() === "inactive",
  );
  const hasCheckedOut = results.some(
    (e) => (e.check_status || "").toUpperCase() === "OUT",
  );

  resultsBody.innerHTML = results.map(buildCard).join("");

  displayTimeout = setTimeout(() => {
    resultsTable.style.display = "none";
    resultsBody.innerHTML = "";
  }, 10000);

  if (hasViolations) playWarningSound();
  else if (hasInactive) {
    messageEl.innerHTML = `<p class="inactive-message">⛔ Employee Inactive</p>`;
    playInactiveSound();
  } else if (hasCheckedOut) playCheckoutSound();
  else playSuccessSound();

}

// ─────────────────────────────────────────────────────────────────
//  Card builder
// ─────────────────────────────────────────────────────────────────
function buildCard(employee) {
  const fullname = escapeHtml(employee.fullname || "Unknown");
  const position = escapeHtml(employee.position || "Unknown");
  const brand = escapeHtml(employee.brand || "N/A");
  const status = escapeHtml(employee.status || "unknown");
  const shift = escapeHtml(employee.shift || "N/A");
  const violation = employee.violation ? escapeHtml(employee.violation) : null;
  const checkStatus = escapeHtml(
    (employee.check_status || "OUT").toUpperCase(),
  );

  const initials = (employee.fullname || "UN")
    .split(" ")
    .map((n) => n.charAt(0))
    .join("")
    .substring(0, 2)
    .toUpperCase();

  const src = imageUrl(employee.image, employee.updated_at);
  const imageHtml = src
    ? `<img src="${src}" alt="${fullname}" class="employee-image" loading="lazy"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
       <div class="ph-container" style="display:none;">
         <div class="employee-placeholder">${initials}</div>
       </div>`
    : `<div class="ph-container"><div class="employee-placeholder">${initials}</div></div>`;

  return `
    <div class="${violation ? "div-with-violation" : "div-container"}">
      <div class="div-position">
        <h1>${fullname}</h1><p>${position}</p>
        ${imageHtml}
      </div>
      <div class="div-side-${status.toLowerCase()}">
        <div class="div-padding">
          <p>Brand: ${brand}</p>
          <p>Status: ${status}</p>
          <p>Shift: ${shift}</p>
          <p class="check-status">Test Scan</p>
        </div>
      </div>
      <div class="${violation ? "with-violation" : "without-violation"}">
        <div class="div-padding"><p>Remarks: ${violation || "None"}</p></div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─────────────────────────────────────────────────────────────────
//  Format helpers
// ─────────────────────────────────────────────────────────────────
function formatTimestamp(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return isNaN(d)
    ? ts
    : d.toLocaleString(undefined, {
        year:   "numeric",
        month:  "short",
        day:    "numeric",
        hour:   "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

// ─────────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function () {
  const ready = await resolveEndpoints();
  if (!ready) return;

  searchInput.type = "password";
  searchInput.setAttribute("autocomplete", "off");
  
  loadGlobalAudio();
  setupEventListeners();
});
