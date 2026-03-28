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
  '<img src="../logo/proximity-logo.png" alt="Proximity Code" style="width: 100%; height: 90vh;">';

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
    }, 300);
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

  // Re-focus on any click outside interactive elements
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
    '<img src="../logo/proximity-logo.png" alt="Proximity Code" style="width: 100%; height: 90vh;">';
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
//  QR code detection
// ─────────────────────────────────────────────────────────────────
function looksLikeQRCode(query) {
  return /^[A-Z0-9\-_]{6,}$/i.test(query) || query.toUpperCase().includes("QR");
}

// ─────────────────────────────────────────────────────────────────
//  Fetch last log entry for an employee from datalog_backend.php
//  Uses the QR code (most specific) or fullname as fallback.
// ─────────────────────────────────────────────────────────────────
async function fetchLastLog(qrCode, fullname) {
  try {
    // Prefer QR code lookup — most specific
    const params = qrCode
      ? new URLSearchParams({ action: "get", qr_code: qrCode })
      : new URLSearchParams({ action: "get", fullname: fullname });

    const response = await fetch(
      `../cnfg/datalog_backend.php?${params.toString()}`,
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
    );

    if (!response.ok) return null;

    const data = await response.json();

    if (data.success && Array.isArray(data.data) && data.data.length > 0) {
      // getLogs() returns rows ORDER BY id DESC — first row is the most recent
      return data.data[0];
    }
  } catch (e) {
    console.warn("fetchLastLog error:", e);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
//  Core search function
// ─────────────────────────────────────────────────────────────────
async function searchEmployees(query) {
  const messageEl = document.getElementById("message");
  const resultsTable = document.getElementById("resultsTable");
  const resultsBody = document.getElementById("resultsBody");

  try {
    resultsTable.style.display = "none";
    messageEl.innerHTML = '<div class="loading">Searching employees…</div>';

    let url, method, fetchBody;

    if (looksLikeQRCode(query)) {
      url = "../cnfg/qr_search_backend.php";
      method = "POST";
      fetchBody = JSON.stringify({ action: "get_by_qr", qr_code: query });
    } else {
      const params = new URLSearchParams({ fullname: query });
      url = `../cnfg/qr_search_backend.php?${params.toString()}`;
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

    // ── Fire QR scan + last-log fetch simultaneously ──────────────
    const [response] = await Promise.all([
      fetch(url, fetchOptions),
      // The last-log fetch is handled per-employee after we know who was found
    ]);

    if (response.status === 401) {
      messageEl.innerHTML =
        '<p class="no-results-message">Session expired. Please log in again.</p>';
      playNoResultSound();
      blockSearchInput();
      return;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Backend response:", data);

    if (data.success) {
      const rawResults = Array.isArray(data.data) ? data.data : [data.data];

      if (rawResults.length === 0) {
        messageEl.innerHTML =
          `<p class="no-results-message">No results found. 🔍</p>
          <img src="../logo/proximity-logo.png" alt="Proximity Code" style="width: 100%; height: 90vh;">`;
        playNoResultSound();
        blockSearchInput();
        return;
      }

      // ── Enrich every employee with their last log — all in parallel ──
      const enriched = await Promise.all(
        rawResults.map(async (employee) => {
          const lastLog = await fetchLastLog(
            employee.qr_code || null,
            employee.fullname || null,
          );
          return { ...employee, lastLog };
        }),
      );

      currentResults = enriched;
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

  resultsBody.innerHTML = results
    .map((employee) => buildCard(employee))
    .join("");

  // Auto-hide after 10 s
  displayTimeout = setTimeout(() => {
    resultsTable.style.display = "none";
    resultsBody.innerHTML = "";
    background();
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
  if (isNaN(d)) return ts; // pass through if already a string
  return d.toLocaleString(undefined, {
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
  const image = employee.image ? escapeHtml(employee.image) : null;

  const checkStatus = escapeHtml(
    (employee.check_status || "OUT").toUpperCase(),
  );

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

  // ── Last log panel ────────────────────────────────────────────────
  // const log = employee.lastLog;
  // let lastLogHtml = "";

  // if (log) {
  //   const logCheckStatus = escapeHtml((log.check_status || "—").toUpperCase());
  //   const logAccessType = escapeHtml(log.access_type || "—");
  //   const logTimestamp = escapeHtml(formatTimestamp(log.access_timestamp));
  //   const logIP = escapeHtml(log.ip_address || "—");

  //   lastLogHtml = `
  //     <div class="last-log-panel">
  //       <p class="last-log-title">Last Log Entry</p>
  //       <p>Access Type : ${logAccessType}</p>
  //       <p>Check Status: <span class="check-status-${logCheckStatus.toLowerCase()}">${logCheckStatus}</span></p>
  //       <p>Timestamp   : ${logTimestamp}</p>
  //       <p>IP Address  : ${logIP}</p>
  //     </div>`;
  // } else {
  //   lastLogHtml = `
  //     <div class="last-log-panel last-log-empty">
  //       <p class="last-log-title">Last Log Entry</p>
  //       <p>No previous log found.</p>
  //     </div>`;
  // }

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
