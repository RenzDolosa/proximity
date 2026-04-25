// resource/js/st.js --> qr proximity scanner tester

const searchInput = document.getElementById("searchInput");
const body = document.body;

let searchTimeout;
let currentResults = [];
let displayTimeout;
let currentAudio = null;
let activeController = null;
let cachedUserId = null;

// ── Global-audio endpoint (relative to the scan controller page) ─────────
const GLOBAL_AUDIO_ENDPOINT = "../../services/global_audio.php";

// Maps global_audio_settings.audio_type  →  <audio> element ID
const AUDIO_TYPE_MAP = {
  success:    "successSound",
  checkout:   "checkoutSound",
  not_found:  "noResultSound",
  violations: "warningSound",
  inactive:   "inactiveSound",
};

async function fetchUserId() {
  try {
    const r = await fetch("../../helper/get_user_id.php", {
      credentials: "include",
    });
    if (r.ok) {
      const j = await r.json();
      cachedUserId = j.user_id || "default";
    }
  } catch {
    cachedUserId = "default";
  }
}

// ─────────────────────────────────────────────────────────────────
//  Load global audio from DB; fall back to bundled files if absent
// ─────────────────────────────────────────────────────────────────
async function loadGlobalAudio() {
  try {
    const res = await fetch(GLOBAL_AUDIO_ENDPOINT, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (!json.success) throw new Error("Server returned success:false");

    Object.entries(AUDIO_TYPE_MAP).forEach(([audioType, elementId]) => {
      const el    = document.getElementById(elementId);
      if (!el) return;

      const entry = json.audio?.[audioType];

      if (entry?.data && entry.data.length > 0) {
        // Database has a custom sound — use it directly as a data-URL
        el.src     = entry.data;
        el.preload = "auto";
      } else {
        // Nothing uploaded yet — fall back to the bundled file
        const fallback = el.dataset.fallback;
        if (fallback) {
          el.src     = fallback;
          el.preload = "auto";
        }
      }
    });

  } catch (e) {
    console.warn("Could not load global audio; using bundled fallbacks.", e);

    // On any error, make sure every element at least has its fallback src
    Object.values(AUDIO_TYPE_MAP).forEach((elementId) => {
      const el = document.getElementById(elementId);
      if (el && !el.src && el.dataset.fallback) {
        el.src     = el.dataset.fallback;
        el.preload = "auto";
      }
    });
  }
}

// ─────────────────────────────────────────────────────────────────
//  IMAGE URL HELPER
// ─────────────────────────────────────────────────────────────────
function imageUrl(filename) {
  if (!filename || !filename.trim()) return null;
  const bare = filename.trim().replace(/^.*[\\/]/, "");
  return bare
    ? `${window.location.origin}/../../public/uploads/user/${bare}`
    : null;
}

// ─────────────────────────────────────────────────────────────────
//  Event listeners
// ─────────────────────────────────────────────────────────────────
function setupEventListeners() {
  searchInput.addEventListener("input", function (e) {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query === "") return;

    clearTimeout(searchInput.autoClearTimeout);
    searchInput.autoClearTimeout = setTimeout(() => {
      searchInput.value = "";
      searchInput.focus();
    }, 30000);

    searchTimeout = setTimeout(() => searchEmployees(query), 200);
  });

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (query !== "") searchEmployees(query);
    }
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
  if (!sound || !sound.src) return;       // guard: src not yet set
  currentAudio = sound;
  sound.currentTime = 0;
  sound.play().catch((e) => console.log("Audio play error:", e));
}

const playSuccessSound  = () => playSound("successSound");
const playCheckoutSound = () => playSound("checkoutSound");
const playInactiveSound = () => playSound("inactiveSound");
const playNoResultSound = () => playSound("noResultSound");
const playWarningSound  = () => playSound("warningSound");

// ─────────────────────────────────────────────────────────────────
//  Input-block helper
// ─────────────────────────────────────────────────────────────────
function blockSearchInput(durationMs = 1000) {
  searchInput.disabled = true;
  searchInput.style.opacity = "0.7";
  searchInput.style.pointerEvents = "none";
  body.classList.add("input-blocked-alt");

  setTimeout(() => {
    searchInput.disabled = false;
    searchInput.style.opacity = "1";
    searchInput.style.pointerEvents = "auto";
    body.classList.remove("input-blocked-alt");
    searchInput.value = "";
    searchInput.focus();
  }, durationMs);
}

// ── Matches any non-whitespace string of 4+ chars as a potential QR code ──
const QR_PATTERN = /^[^\s]{4,}$/;

async function searchEmployees(query) {
  if (activeController) activeController.abort();
  activeController = new AbortController();
  const signal = activeController.signal;

  try {
    const isLikelyQR = QR_PATTERN.test(query);
    let response, data;

    if (isLikelyQR) {
      response = await fetch("../../services/scanTest_search_backend.php", {
        method: "POST",
        signal,
        credentials: "include",
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "get_by_qr", qr_code: query }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();

      if (data.success && data.data) {
        currentResults = [data.data];
        renderResults(currentResults, query);
        return;
      }
    }

    const url = `../../services/scanTest_search_backend.php?q=${encodeURIComponent(query)}`;
    response = await fetch(url, {
      method: "GET",
      signal,
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();

    if (data.success && Array.isArray(data.data) && data.data.length > 0) {
      currentResults = data.data;
      renderResults(currentResults, query);
    } else {
      currentResults = [];
      document.getElementById("message").innerHTML =
        '<p class="no-results-message">No results found. 🔍</p>';
      playNoResultSound();
      blockSearchInput();
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Search error:", error);
    showMessage("Failed to search. Please check your connection.", "error");
    currentResults = [];
  }
}

// ─────────────────────────────────────────────────────────────────
//  Render results
// ─────────────────────────────────────────────────────────────────
function renderResults(results) {
  stopCurrentAudio();

  const messageEl    = document.getElementById("message");
  const resultsTable = document.getElementById("resultsTable");
  const resultsBody  = document.getElementById("resultsBody");

  if (displayTimeout) {
    clearTimeout(displayTimeout);
    displayTimeout = null;
  }

  messageEl.innerHTML = "";
  resultsTable.style.display = "block";

  const hasViolations = results.some(
    (e) => e.violation && e.violation.trim() !== ""
  );
  const hasInactive = results.some(
    (e) => (e.status || "").toLowerCase() === "inactive"
  );
  const hasCheckedOut = results.some(
    (e) => (e.check_status || "").toUpperCase() === "OUT"
  );

  resultsBody.innerHTML = results.map(buildCard).join("");

  displayTimeout = setTimeout(() => {
    resultsTable.style.display = "none";
    resultsBody.innerHTML = "";
  }, 10000);

  if (hasViolations) playWarningSound();
  else if (hasInactive) playInactiveSound();
  else if (hasCheckedOut) playCheckoutSound();
  else playSuccessSound();

  blockSearchInput();
}

// ─────────────────────────────────────────────────────────────────
//  Card builder
// ─────────────────────────────────────────────────────────────────
function buildCard(employee) {
  const fullname   = escapeHtml(employee.fullname  || "Unknown");
  const position   = escapeHtml(employee.position  || "Unknown");
  const brand      = escapeHtml(employee.brand     || "N/A");
  const status     = escapeHtml(employee.status    || "Unknown");
  const shift      = escapeHtml(employee.shift     || "N/A");
  const violation  = employee.violation ? escapeHtml(employee.violation) : null;
  const checkStatus = "Test Scan";

  const initials = (employee.fullname || "UN")
    .split(" ")
    .map((n) => n.charAt(0))
    .join("")
    .substring(0, 2)
    .toUpperCase();

  const src = imageUrl(employee.image);
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
          <p class="check-status-${checkStatus.toLowerCase()}">Check: ${checkStatus}</p>
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
function escapeHtml(text) {
  if (typeof text !== "string") return String(text ?? "");
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function showMessage(text, type = "info") {
  const className = type === "error" ? "error-message" : "info-message";
  document.getElementById("message").innerHTML =
    `<div class="${className}">${text}</div>`;
  if (type === "success")
    setTimeout(() => {
      document.getElementById("message").innerHTML = "";
    }, 1000);
}

// ─────────────────────────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  fetchUserId();
  loadGlobalAudio();
  setupEventListeners();
});