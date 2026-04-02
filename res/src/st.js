// st.js

const searchInput = document.getElementById("searchInput");
const body = document.body;

let searchTimeout;
let currentResults = [];
let displayTimeout;
let currentAudio = null;
let activeController = null;          // ← AbortController for in-flight fetches

// ── Cached user-id (eliminates the synchronous XHR on every render) ──────────
let cachedUserId = null;
async function fetchUserId() {
  try {
    const r = await fetch("../cnfg/get_user_id.php");
    if (r.ok) {
      const j = await r.json();
      cachedUserId = j.user_id || "default";
    }
  } catch { cachedUserId = "default"; }
}

document.getElementById("message").innerHTML =
  '<img src="../logo/proximity-logo.svg" alt="Proximity Code" loading="lazy" style="width:100%;height:90vh;">';

function setupEventListeners() {
  searchInput.addEventListener("input", function (e) {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    if (query === "") return;

    // Auto-clear after 30 s of inactivity (reset on every keystroke)
    clearTimeout(searchInput.autoClearTimeout);
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
    if (!e.target.matches("input,button,select,textarea,a")) searchInput.focus();
  });

  document.addEventListener("keydown", function (e) {
    if (
      document.activeElement.tagName !== "INPUT" &&
      document.activeElement.tagName !== "TEXTAREA" &&
      !e.target.classList.contains("filter-btn")
    ) searchInput.focus();
  });

  setTimeout(() => { searchInput.value = ""; searchInput.focus(); }, 300);
}

function background() {
  document.getElementById("message").innerHTML =
    '<img src="../logo/proximity-logo.svg" alt="Proximity Code" loading="lazy" style="width:100%;height:90vh;">';
}

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
  sound.play().catch(e => console.log("Audio play error:", e));
}

const playSuccessSound  = () => playSound("successSound");
const playInactiveSound = () => playSound("inactiveSound");
const playNoResultSound = () => playSound("noResultSound");
const playWarningSound  = () => playSound("warningSound");

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

// ── Tighter QR pattern: uppercase letters + digits, 8-20 chars, no spaces ────
const QR_PATTERN = /^[A-Z0-9\-_]{8,20}$/;

async function searchEmployees(query) {
  // Cancel any in-flight request immediately
  if (activeController) activeController.abort();
  activeController = new AbortController();
  const signal = activeController.signal;

  try {
    showLoading(true);

    const isQRCode = QR_PATTERN.test(query);
    let url, method, bodyContent;

    if (isQRCode) {
      url    = "../cnfg/scanTest_search_backend.php";
      method = "POST";
      bodyContent = JSON.stringify({ action: "get_by_qr", qr_code: query });
    } else {
      // Send a single `q` parameter; backend fans it out to all fields
      url    = `../cnfg/scanTest_search_backend.php?q=${encodeURIComponent(query)}`;
      method = "GET";
    }

    const response = await fetch(url, {
      method,
      signal,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        ...(method === "POST" ? { "Content-Type": "application/json" } : {})
      },
      ...(method === "POST" ? { body: bodyContent } : {})
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    if (data.success) {
      currentResults = Array.isArray(data.data) ? data.data : [data.data];
      renderResults(currentResults, query);

      if (currentResults.length === 0) {
        document.getElementById("message").innerHTML =
          '<p class="no-results-message">No results found. 🔍</p>';
        playNoResultSound();
        background();
        blockSearchInput();
      }
    } else {
      showMessage(data.message || "Error loading search results", "error");
      document.getElementById("message").innerHTML =
        '<p class="no-results-message">No results found. 🔍</p>';
      playNoResultSound();
      background();
      blockSearchInput();
    }
  } catch (error) {
    if (error.name === "AbortError") return; // superseded by newer query — silent
    console.error("Search error:", error);
    showMessage("Failed to search. Please check your connection.", "error");
    currentResults = [];
  } finally {
    showLoading(false);
  }
}

function renderResults(results, query) {
  stopCurrentAudio();

  const resultsTable = document.getElementById("resultsTable");
  const resultsBody  = document.getElementById("resultsBody");
  const message      = document.getElementById("message");

  if (displayTimeout) { clearTimeout(displayTimeout); displayTimeout = null; }

  message.innerHTML = "";
  resultsTable.style.display = "block";

  const hasViolations = results.some(e => e.violation && e.violation.trim() !== "");
  const hasInactive   = results.some(e => e.status.toLowerCase() === "inactive");

  // Use cachedUserId (already fetched at page load — no blocking XHR)
  const userId    = cachedUserId || "default";

  resultsBody.innerHTML = results.map(employee => {
    const fullname    = escapeHtml(employee.fullname    || "Unknown");
    const position    = escapeHtml(employee.position    || "unknown");
    const brand       = escapeHtml(employee.brand       || "N/A");
    const status      = escapeHtml(employee.status      || "unknown");
    const shift       = escapeHtml(employee.shift       || "N/A");
    const violation   = employee.violation ? escapeHtml(employee.violation) : null;
    const image       = employee.image     ? escapeHtml(employee.image)     : null;
    const checkStatus = "Test Scan";

    const initials = (employee.fullname || "UN")
      .split(" ").map(n => n.charAt(0)).join("").substring(0, 2).toUpperCase();

    return `
      <div class="${violation ? "div-with-violation" : "div-container"}">
        <div class="div-position">
          <p>${fullname}</p>
          <p>${position}</p>
          ${image
            ? `<img src="${window.location.origin}/uploads/user/${image}" alt="${fullname}" class="employee-image" loading="lazy">`
            : `<div class="ph-container"><div class="employee-placeholder">${initials}</div></div>`}
        </div>
        <div class="div-side-${status.toLowerCase()}">
          <div class="div-padding">
            <p>Brand: ${brand}</p>
            <p>Status: ${status}</p>
            <p>Shift: ${shift}</p>
            <p class="check-status-test-scan">Check: ${checkStatus}</p>
          </div>
        </div>
        <div class="${violation ? "with-violation" : "without-violation"}">
          <div class="div-padding"><p>Violation: ${violation || "None"}</p></div>
        </div>
      </div>`;
  }).join("");

  displayTimeout = setTimeout(() => {
    resultsTable.style.display = "none";
    resultsBody.innerHTML = "";
    background();
  }, 10000);

  if      (hasViolations) playWarningSound();
  else if (hasInactive)   playInactiveSound();
  else                    playSuccessSound();

  blockSearchInput();
}

function escapeHtml(text) {
  if (typeof text !== "string") return text;
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function showLoading(show) {
  const message      = document.getElementById("message");
  const resultsTable = document.getElementById("resultsTable");
  if (show) {
    resultsTable.style.display = "none";
    // message.innerHTML = '<div class="loading">Searching employees...</div>';
  }
}

function showMessage(text, type = "info") {
  const className = type === "error" ? "error-message" : "info-message";
  document.getElementById("message").innerHTML = `<div class="${className}">${text}</div>`;
  if (type === "success") setTimeout(() => { document.getElementById("message").innerHTML = ""; }, 1000);
}

document.addEventListener("DOMContentLoaded", () => {
  fetchUserId();        // async, cached for all future renders
  setupEventListeners();
});