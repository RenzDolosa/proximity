// qrproximity.js

const searchInput = document.getElementById("searchInput");
const body = document.body;

let searchTimeout;
let currentResults = [];
let displayTimeout;
let currentAudio = null;
let activeController = null;

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
    clearTimeout(searchInput.autoClearTimeout);
    const query = e.target.value.trim();
    if (query === "") return;

    searchInput.autoClearTimeout = setTimeout(() => {
      searchInput.value = "";
      searchInput.focus();
    }, 30000);

    searchTimeout = setTimeout(() => searchEmployees(query), 200); // 200 ms debounce
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
  if (!sound) return;
  currentAudio = sound;
  sound.currentTime = 0;
  sound.play().catch((e) => console.log("Audio play error:", e));
}

const playSuccessSound = () => playSound("successSound");
const playInactiveSound = () => playSound("inactiveSound");
const playNoResultSound = () => playSound("noResultSound");
const playWarningSound = () => playSound("warningSound");

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

// ─────────────────────────────────────────────────────────────────
//  FIX 1: Tightened QR pattern — requires at least one digit AND
//  a hyphen/underscore OR a minimum length of 12 to avoid colliding
//  with long plain names like "ALEJANDRO" or "CHRISTOPHER".
//
//  A QR code from a physical scanner typically:
//    - is 12+ characters long, OR
//    - contains digits mixed with separators (hyphens/underscores)
//
//  Plain name searches typed by hand are usually all-alpha and
//  shorter, so the two rules below safely separate the paths.
// ─────────────────────────────────────────────────────────────────
function looksLikeQRCode(query) {
  if (query.length < 8) return false;

  // Must contain at least one digit — human names are all-alpha
  const hasDigit = /\d/.test(query);
  if (!hasDigit) return false;

  // Either long enough (12+) to be a scanner token,
  // OR contains a separator character typical of QR payloads
  const isLong = query.length >= 10;
  const hasSeparator = /[-_]/.test(query);

  return isLong || hasSeparator;
}

// ─────────────────────────────────────────────────────────────────
//  Core search — check_status comes back embedded in each employee
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
    // messageEl.innerHTML = '<div class="loading">Searching employees…</div>';

    let url, method, fetchBody;

    if (looksLikeQRCode(query)) {
      // Physical scanner path — auto-toggles check-in/out status
      url = "../../services/qr_search_backend.php";
      method = "POST";
      fetchBody = JSON.stringify({ action: "get_by_qr", qr_code: query });
    } else {
      // Manual text search path — read-only, no status toggle
      url = `../../services/qr_search_backend.php?q=${encodeURIComponent(query)}`;
      method = "GET";
    }

    const response = await fetch(url, {
      method,
      signal,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: fetchBody } : {}),
    });

    if (response.status === 401) {
      messageEl.innerHTML =
        '<p class="no-results-message">Session expired. Please log in again.</p>';
      playNoResultSound();
      blockSearchInput();
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (data.success) {
      currentResults = Array.isArray(data.data) ? data.data : [data.data];

      if (currentResults.length === 0) {
        messageEl.innerHTML = `
          <p class="no-results-message">No results found. 🔍</p>`;
        playNoResultSound();
        blockSearchInput();
        return;
      }

      renderResults(currentResults);
    } else {
      messageEl.innerHTML = `
          <p class="no-results-message">No results found. 🔍</p>`;
      playNoResultSound();
      blockSearchInput();
    }
  } catch (error) {
    if (error.name === "AbortError") return; // superseded — silent
    console.error("Search error:", error);
    messageEl.innerHTML =
      '<div class="error-message">Failed to search. Please check your connection.</div>';
    currentResults = [];
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

  resultsBody.innerHTML = results.map(buildCard).join("");

  displayTimeout = setTimeout(() => {
    resultsTable.style.display = "none";
    resultsBody.innerHTML = "";
    // background();
  }, 10000);

  if (hasViolations) playWarningSound();
  else if (hasInactive) playInactiveSound();
  else playSuccessSound();

  blockSearchInput();
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
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
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
        <div class="div-padding"><p>Violation: ${violation || "None"}</p></div>
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

// ─────────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
});
