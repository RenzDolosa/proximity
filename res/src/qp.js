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

document.getElementById("message").innerHTML = '<img src="../icon/nfc-icon.png" alt="Proximity Code" style="width: 100%; height: 90vh;">';

// Setup event listeners
function setupEventListeners() {
  // Live search with debounce
  searchInput.addEventListener("input", function (e) {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();

    // Auto-clear after user stops typing
    if (query !== "") {
      clearTimeout(searchInput.autoClearTimeout);
      searchInput.autoClearTimeout = setTimeout(() => {
        searchInput.value = "";
        // background();
        searchInput.focus();
      }, 300); // 30 seconds timeout
    }

    // Hide results when search is empty
    if (query === "") {
      // background();
      return;
    }

    searchTimeout = setTimeout(() => {
      searchEmployees(query);
    }, 300); // 300ms debounce
  });

  // Handle Enter key
  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      clearTimeout(searchTimeout);
      const query = e.target.value.trim();

      if (query === "") {
        // background();
        return;
      }

      searchEmployees(query);
    }
  });

  // Focus on click anywhere on the page
  document.addEventListener("click", function (e) {
    if (!e.target.matches("input, button, select, textarea, a")) {
      searchInput.focus();
    }
  });

  // Focus on any keydown event
  document.addEventListener("keydown", function (e) {
    if (
      document.activeElement.tagName !== "INPUT" &&
      document.activeElement.tagName !== "TEXTAREA" &&
      !e.target.classList.contains("filter-btn")
    ) {
      searchInput.focus();
    }
  });

  // Initialize with focus and background
  setTimeout(() => {
    searchInput.value = "";
    searchInput.focus();
  }, 300);
}

function background() {
  document.getElementById("message").innerHTML = '<img src="../icon/nfc-icon.png" alt="Proximity Code" style="width: 100%; height: 90vh;">';
}

// Function to stop any currently playing audio
function stopCurrentAudio() {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  currentAudio = null;
}

// Play sound on successful result
function playSuccessSound() {
  stopCurrentAudio(); // Stop any currently playing audio
  const sound = document.getElementById("successSound");
  currentAudio = sound;
  sound.currentTime = 0;
  sound.play().catch((e) => console.log("Audio play error:", e));
}

function playInactiveSound() {
  stopCurrentAudio(); // Stop any currently playing audio
  const sound = document.getElementById("inactiveSound");
  currentAudio = sound;
  sound.currentTime = 0;
  sound.play().catch((e) => console.log("Audio play error:", e));
}

function playNoResultSound() {
  stopCurrentAudio(); // Stop any currently playing audio
  const sound = document.getElementById("noResultSound");
  currentAudio = sound;
  sound.currentTime = 0;
  sound.play().catch((e) => console.log("Audio play error:", e));
}

function playWarningSound() {
  stopCurrentAudio(); // Stop any currently playing audio
  const sound = document.getElementById("warningSound");
  currentAudio = sound;
  sound.currentTime = 0;
  sound.play().catch((e) => console.log("Audio play error:", e));
}

// Function to temporarily block search input
function blockSearchInput() {
  const originalBgColor = body.style.backgroundColor || "transparent";
  const originalBorderColor = body.style.borderColor || "";

  // Apply disabled state with visual feedback
  searchInput.disabled = true;
  searchInput.style.opacity = "0.7";
  searchInput.style.pointerEvents = "none";
  body.style.backgroundColor = "transparent"; // Light gray background
  body.style.borderColor = "#ff6b6b"; // Red border to indicate blocked state
  body.style.transition = "all 0.3s ease"; // Smooth transition

  body.classList.add("input-blocked-alt");

  setTimeout(() => {
    // Restore input functionality
    searchInput.disabled = false;
    searchInput.style.opacity = "1";
    searchInput.style.pointerEvents = "auto";
    body.style.backgroundColor = "#edffed"; // Light green for success
    body.style.borderColor = "#4caf50"; // Green border

    body.classList.remove("input-blocked-alt");

    // Focus and clear the input
    searchInput.focus();

    setTimeout(() => {
      body.style.backgroundColor = originalBgColor;
      body.style.borderColor = originalBorderColor;
    }, 300);
  }, 1000); // 3 second block
}

// Search employees function with QR code priority
async function searchEmployees(query) {
  try {
    showLoading(true);

    // Check if query looks like a QR code (modify pattern as needed)
    const isQRCode = /^[A-Z0-9\-_]{6,}$/i.test(query) || query.includes("QR");

    let url, method, body;

    if (isQRCode) {
      // For QR codes, use POST method with specific action
      url = "../cnfg/qr_search_backend.php";
      method = "POST";
      body = JSON.stringify({
        action: "get_by_qr",
        qr_code: query,
      });
    } else {
      // For general search, use GET method
      const params = new URLSearchParams();
      params.append("fullname", query);
      params.append("position", query);
      params.append("qr_code", query);
      params.append("brand", query);
      params.append("shift", query);
      params.append("status", query);
      params.append("check_status", query);

      url = `../cnfg/qr_search_backend.php?${params.toString()}`;
      method = "GET";
    }

    const fetchOptions = {
      method: method,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Content-Type":
          method === "POST"
            ? "application/json"
            : "application/x-www-form-urlencoded",
      },
    };

    if (method === "POST") {
      fetchOptions.body = body;
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Backend response:", data);

    if (data.success) {
      // Handle single employee result (QR code search) vs multiple results
      currentResults = Array.isArray(data.data) ? data.data : [data.data];
      renderResults(currentResults, query);

      if (currentResults.length === 0) {
        message.innerHTML = `
            <p class="no-results-message" id="no-results-message">
                No results found. 🔍
            </p>
        `;
        playNoResultSound();
        background();
        blockSearchInput();
      }
    } else {
      console.error("Backend error:", data.message);
      showMessage(data.message || "Error loading search results", "error");
      message.innerHTML = `
            <p class="no-results-message" id="no-results-message">
                No results found. 🔍
            </p>
        `;
      playNoResultSound();
      background();
      blockSearchInput();
    }
  } catch (error) {
    console.error("Search error:", error);
    showMessage(
      "Failed to search employees. Please check your connection.",
      "error"
    );
    currentResults = [];
  } finally {
    showLoading(false);
  }
}

// Filter results based on current filter
function filterResults(results) {
  if (currentFilter === "all") return results;
}

// Render search results with filtering
function renderResults(results, query) {
  // Stop any currently playing audio when rendering new results
  stopCurrentAudio();

  const resultsTable = document.getElementById("resultsTable");
  const resultsBody = document.getElementById("resultsBody");
  const message = document.getElementById("message");

  // Clear any existing display timeout
  if (displayTimeout) {
    clearTimeout(displayTimeout);
    displayTimeout = null;
  }

  // Apply current filter
  const filteredResults = filterResults(results);

  // Show results
  message.innerHTML = "";
  resultsTable.style.display = "block";

  // Check for violations, inactive status, and determine sound to play
  const hasViolations = filteredResults.some(
    (employee) => employee.violation && employee.violation.trim() !== ""
  );

  const hasInactive = filteredResults.some(
    (employee) => employee.status.toLowerCase() === "inactive"
  );

  // Render employee cards
  resultsBody.innerHTML = filteredResults
    .map((employee) => {
      const fullname = escapeHtml(employee.fullname || "Unknown");
      const position = escapeHtml(employee.position || "unknown");
      const brand = escapeHtml(employee.brand || "N/A");
      const status = escapeHtml(employee.status || "unknown");
      const shift = escapeHtml(employee.shift || "N/A");
      const violation = employee.violation
        ? escapeHtml(employee.violation)
        : null;
      const image = employee.image ? escapeHtml(employee.image) : null;
      const qrCode = escapeHtml(employee.qr_code || "N/A");
      const check_status = escapeHtml(employee.check_status || "N/A");
      const currentUserId = getCurrentUserId();
      const checkStatus = check_status === "OUT" ? "IN" : "OUT";

      // Generate initials for placeholder
      const fullnameInitials = (employee.fullname || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      return `
            <div class="${violation ? "div-with-violation" : "div-container"}">
                <div class="div-position">
                    <p>${fullname}</p>
                    <p>${position}</p>
                        ${
                          image
                            ? `<img src="../../uploads/user_${currentUserId}/${image}" alt="${fullname}" class="employee-image">`
                            : `<div class="ph-container"><div class="employee-placeholder">${fullnameInitials}</div></div>`
                        }
                </div>
                <div class="div-side-${status.toLowerCase()}">
                    <div class="div-padding">
                        <p>Brand: ${brand}</p>
                        <p>Status: ${status}</p>
                        <p>Shift: ${shift}</p>
                        <p class="check-status-${checkStatus.toLowerCase()}">Check: ${checkStatus}</p>
                    </div>
                </div>
                <div class="${
                  violation ? "with-violation" : "without-violation"
                }">
                    <div class="div-padding">
                        <p>Violation: ${violation || "None"}</p>
                    </div>
                </div>
            </div>
        `;
    })
    .join("");

  // Set new timeout to clear results after 10 seconds
  displayTimeout = setTimeout(() => {
    // Clear results
    resultsTable.style.display = "none";
    resultsBody.innerHTML = "";

    // Show background
    background();

    // Apply cleanup
  }, 10000); // 10 seconds

  // Play sound based on priority: violations > inactive > success
  if (hasViolations) {
    playWarningSound();
  } else if (hasInactive) {
    playInactiveSound();
  } else {
    playSuccessSound();
  }

  blockSearchInput();
}

function getCurrentUserId() {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "../cnfg/get_user_id.php", false); // synchronous
    xhr.send();
    if (xhr.status === 200) {
      const response = JSON.parse(xhr.responseText);
      return response.user_id || "default";
    }
  } catch (error) {
    console.error("Error getting user ID:", error);
  }

  return "default"; // fallback
}

// Helper function to escape HTML
function escapeHtml(text) {
  if (typeof text !== "string") return text;

  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Show loading state
function showLoading(show) {
  const message = document.getElementById("message");
  const resultsTable = document.getElementById("resultsTable");

  if (show) {
    resultsTable.style.display = "none";
    message.innerHTML = '<div class="loading">Searching employees...</div>';
  }
}

// Show message
function showMessage(text, type = "info") {
  const message = document.getElementById("message");
  const className = type === "error" ? "error-message" : "info-message";
  message.innerHTML = `<div class="${className}">${text}</div>`;

  // Auto-hide success messages
  if (type === "success") {
    setTimeout(() => {
      message.innerHTML = "";
    }, 1000);
  }
}

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  setupEventListeners();
});
