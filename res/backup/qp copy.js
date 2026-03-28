// qp.js

// QR Pass Employee Filter System
const searchInput = document.getElementById("searchInput");
const body = document.body;

// Global variables
let searchTimeout;
let currentResults = [];
let displayTimeout;
let currentFilter = "all";
let currentAudio = null;

document.getElementById("message").innerHTML =
  '<img src="../icon/nfc-icon.png" alt="Proximity Code" style="width: 100%; height: 90vh;">';

// Setup event listeners
function setupEventListeners() {
  // Live search with debounce
  searchInput.addEventListener("input", function (e) {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
 
    // Auto-clear the input 300 ms after the user stops typing
    if (query !== "") {
      clearTimeout(searchInput.autoClearTimeout);
      searchInput.autoClearTimeout = setTimeout(() => {
        searchInput.value = "";
        searchInput.focus();
      }, 300);
    }
 
    if (query === "") return;
 
    searchTimeout = setTimeout(() => {
      searchEmployees(query);
    }, 300); // 300 ms debounce
  });
 
  // Handle Enter key
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();
      if (query === "") return;
      searchEmployees(query);
    }
  });
 
  // Re-focus the hidden input on any click outside interactive elements
  document.addEventListener("click", function (e) {
    if (!e.target.matches("input, button, select, textarea, a")) {
      searchInput.focus();
    }
  });
 
  // Re-focus on any keydown when the input is not already active
  document.addEventListener("keydown", function (e) {
    if (
      document.activeElement.tagName !== "INPUT" &&
      document.activeElement.tagName !== "TEXTAREA" &&
      !e.target.classList.contains("filter-btn")
    ) {
      searchInput.focus();
    }
  });
 
  // Initial focus
  setTimeout(() => {
    searchInput.value = "";
    searchInput.focus();
  }, 300);
}

// ─────────────────────────────────────────────────────────────────
//  Background / idle state
// ─────────────────────────────────────────────────────────────────
function background() {
  document.getElementById("message").innerHTML =
    '<img src="../icon/nfc-icon.png" alt="Proximity Code" style="width: 100%; height: 90vh;">';
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

const playSuccessSound  = () => playSound("successSound");
const playInactiveSound = () => playSound("inactiveSound");
const playNoResultSound = () => playSound("noResultSound");
const playWarningSound  = () => playSound("warningSound");

// ─────────────────────────────────────────────────────────────────
//  Input-block helper (prevents double-scans)
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
//  Core search function
// ─────────────────────────────────────────────────────────────────
 
/**
 * Determines whether a query string looks like a QR/proximity code.
 *
 * Rules (adjust the pattern to match your actual QR format):
 *   - 6+ alphanumeric chars (with optional - or _)
 *   - OR the literal string "QR" appears anywhere
 */
function looksLikeQRCode(query) {
  return /^[A-Z0-9\-_]{6,}$/i.test(query) || query.toUpperCase().includes("QR");
}

async function searchEmployees(query) {
  const messageEl    = document.getElementById("message");
  const resultsTable = document.getElementById("resultsTable");
  const resultsBody  = document.getElementById("resultsBody");
 
  try {
    // ── Loading state ──────────────────────────────────────────
    resultsTable.style.display = "none";
    messageEl.innerHTML = '<div class="loading">Searching employees…</div>';
 
    let url, method, fetchBody;
 
    if (looksLikeQRCode(query)) {
      // ── QR / proximity scan → POST get_by_qr (auto-toggles IN/OUT) ──
      url    = "../cnfg/qr_search_backend.php";
      method = "POST";
      fetchBody = JSON.stringify({ action: "get_by_qr", qr_code: query });
    } else {
      // ── Free-text search → GET with a single `q` param ──────────
      //
      //  The backend checks the FIRST non-empty allowed param it finds.
      //  Sending all params with the same value means only `fullname`
      //  is ever used, which hides matches by qr_code / brand / etc.
      //
      //  FIX: send a single generic param and let the backend fan it
      //  out to all LIKE columns (the backend already does this via
      //  the `$searchTerm` path when any searchable field is set).
      //
      //  We use `fullname` here because the backend loops through
      //  ['qr_code','fullname','position','brand','shift','status']
      //  and picks the first non-empty value as the free-text term,
      //  then does a LIKE search across ALL columns — so one param
      //  is enough.
      // ─────────────────────────────────────────────────────────
      const params = new URLSearchParams({ fullname: query });
      url    = `../cnfg/qr_search_backend.php?${params.toString()}`;
      method = "GET";
    }
 
    const fetchOptions = {
      method,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    };
 
    if (method === "POST") {
      fetchOptions.headers["Content-Type"] = "application/json";
      fetchOptions.body = fetchBody;
    }
 
    const response = await fetch(url, fetchOptions);
 
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
 
    const data = await response.json();
    console.log("Backend response:", data);
 
    if (data.success) {
      // Backend returns a single object for QR scans, array for searches
      currentResults = Array.isArray(data.data) ? data.data : [data.data];
 
      if (currentResults.length === 0) {
        messageEl.innerHTML =
          '<p class="no-results-message">No results found. 🔍</p>';
        playNoResultSound();
        blockSearchInput();
        return;
      }
 
      renderResults(currentResults);
    } else {
      console.warn("Backend error:", data.message);
      messageEl.innerHTML =
        '<p class="no-results-message">No results found. 🔍</p>';
      playNoResultSound();
      blockSearchInput();
    }
  } catch (error) {
    console.error("Search error:", error);
    document.getElementById("message").innerHTML =
      '<div class="error-message">Failed to search employees. Please check your connection.</div>';
    currentResults = [];
  }
}

// Filter results based on current filter
function filterResults(results) {
  if (currentFilter === "all") return results;
}

// ─────────────────────────────────────────────────────────────────
//  Render results
// ─────────────────────────────────────────────────────────────────
function renderResults(results) {
  stopCurrentAudio();
 
  const messageEl    = document.getElementById("message");
  const resultsTable = document.getElementById("resultsTable");
  const resultsBody  = document.getElementById("resultsBody");
 
  // Clear any pending auto-hide timer
  if (displayTimeout) {
    clearTimeout(displayTimeout);
    displayTimeout = null;
  }
 
  messageEl.innerHTML        = "";
  resultsTable.style.display = "block";
 
  // Decide which sound to play
  const hasViolations = results.some(
    (e) => e.violation && e.violation.trim() !== ""
  );
  const hasInactive = results.some(
    (e) => (e.status || "").toLowerCase() === "inactive"
  );
 
  resultsBody.innerHTML = results.map((employee) => buildCard(employee)).join("");
 
  // Auto-hide after 10 s
  displayTimeout = setTimeout(() => {
    resultsTable.style.display = "none";
    resultsBody.innerHTML      = "";
    background();
  }, 10000);
 
  // Sound priority: violation > inactive > success
  if (hasViolations)    playWarningSound();
  else if (hasInactive) playInactiveSound();
  else                  playSuccessSound();
 
  blockSearchInput();
}

// ─────────────────────────────────────────────────────────────────
//  Card builder
// ─────────────────────────────────────────────────────────────────
 
/**
 * Builds the HTML card for a single employee record.
 *
 * check_status FIX
 * ────────────────
 * The backend stores the CURRENT state of the employee (IN or OUT).
 * The old code displayed the OPPOSITE value (what the next scan would
 * produce), which was misleading.
 *
 *   employee.check_status = "IN"  → show "IN"  (they are currently inside)
 *   employee.check_status = "OUT" → show "OUT" (they are currently outside)
 *
 * The CSS class is keyed on the current status so colours are correct too.
 */
function buildCard(employee) {
  const fullname   = escapeHtml(employee.fullname   || "Unknown");
  const position   = escapeHtml(employee.position   || "Unknown");
  const brand      = escapeHtml(employee.brand      || "N/A");
  const status     = escapeHtml(employee.status     || "unknown");
  const shift      = escapeHtml(employee.shift      || "N/A");
  const violation  = employee.violation ? escapeHtml(employee.violation) : null;
  const image      = employee.image     ? escapeHtml(employee.image)     : null;
 
  // ── check_status: use the value as-is from the backend ──────────
  //
  //  The backend returns the CURRENT check state ("IN" or "OUT").
  //  Previous code did `const checkStatus = check_status === "OUT" ? "IN" : "OUT"`
  //  which showed the NEXT scan result instead of the current state.
  // ─────────────────────────────────────────────────────────────────
  const checkStatus = escapeHtml((employee.check_status || "OUT").toUpperCase());
 
  // Initials placeholder
  const initials = (employee.fullname || "UN")
    .split(" ")
    .map((n) => n.charAt(0))
    .join("")
    .substring(0, 2)
    .toUpperCase();
 
  const imageHtml = image
    ? `<img src="../../uploads/user/${image}" alt="${fullname}" class="employee-image">`
    : `<div class="ph-container"><div class="employee-placeholder">${initials}</div></div>`;
 
  return `
    <div class="${violation ? "div-with-violation" : "div-container"}">
      <div class="div-position">
        <p>${fullname}</p>
        <p>${position}</p>
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
        <div class="div-padding">
          <p>Violation: ${violation || "None"}</p>
        </div>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────────
function escapeHtml(text) {
  if (typeof text !== "string") return String(text ?? "");
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ─────────────────────────────────────────────────────────────────
//  Boot
// ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  setupEventListeners();
});
