// resource/js/system.js --> system table
// SECURITY FIXES APPLIED:
// 1. escapeHtml() used on ALL dynamic innerHTML insertions
// 2. String.prototype.toProperCase() replaced with standalone toProperCase()
// 3. json_decode inputs validated before use
// 4. restore_mode whitelisted
// 5. Proximity code (qr_code) output escaped
// FIX: setupFieldSuggestions now applies toProperCase to display labels
//      to match the search filter dropdown formatting (Image 1 vs Images 2-4).

// Global variables
let currentAction = "add";
let employees = [];

// Pagination variables
let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;
let totalRecords = 0;

let currentAudio = null;

let activeFilters = {};

// ── Global-audio endpoint ─────────────────────────────────────────
const GLOBAL_AUDIO_ENDPOINT = "global_audio.php";

// Maps global_audio_settings.audio_type  →  <audio> element ID
const AUDIO_TYPE_MAP = {
  success: "successSound",
  checkout: "checkoutSound",
  not_found: "noResultSound",
  violations: "warningSound",
  inactive: "inactiveSound",
};

// ─────────────────────────────────────────────────────────────────
// SECURITY: HTML escape helper — use on ALL dynamic content
// inserted via innerHTML to prevent stored XSS attacks.
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

// SECURITY: Standalone toProperCase — replaces String.prototype pollution
function toProperCase(str) {
  if (!str) return "";
  // Insert space before uppercase letters that follow lowercase letters (PascalCase/camelCase split)
  const spaced = String(str).replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.replace(/[^\s,\-]+/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
  });
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

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  loadGlobalAudio();
  loadEmployees();
  setupEventListeners();
  updateDeleteButtonState();
});

// Setup event listeners
function setupEventListeners() {
  document
    .getElementById("employeeForm")
    ?.addEventListener("submit", handleFormSubmit);

  setupFileUploadHandler();

  const searchInputs = document.querySelectorAll(
    "#searchForm input, #searchForm select",
  );

  searchInputs.forEach((input) => {
    input.addEventListener("input", debounce(searchEmployees, 300));
  });

  const dateInput = document.getElementById("search_date");
  if (dateInput) {
    dateInput.addEventListener("change", function () {
      const clearBtn = document.getElementById("clear_date_btn");
      if (clearBtn) clearBtn.style.display = this.value ? "block" : "none";
    });
  }

  const proximityInput = document.getElementById("search_qr");

  function autoFocusProximity() {
    // Never steal focus while any modal is open
    const modalOpen =
      document.getElementById("employeeModal")?.style.display === "block" ||
      document.getElementById("deleteModal")?.style.display === "flex" ||
      document.getElementById("importModal")?.style.display === "block" ||
      document.getElementById("logsModal")?.style.display === "block" ||
      document.getElementById("violationsModal")?.style.display === "block";

    if (modalOpen) return;

    const active = document.activeElement;
    const isTyping =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "SELECT" ||
        active.tagName === "TEXTAREA");

    if (!isTyping && proximityInput) {
      proximityInput.focus();
    }
  }

  autoFocusProximity();
  document.addEventListener("click", autoFocusProximity);
  document.addEventListener("focusin", autoFocusProximity);

  // Position → A–Z, only show after user types
  setupFieldSuggestions("position", "position-suggestions", () =>
    [...allEmployees]
      .sort((a, b) => (a.position || "").localeCompare(b.position || ""))
      .map((e) => e.position),
  );

  // Brand / Department → A–Z, only show after user types
  setupFieldSuggestions("brand", "brand-suggestions", () =>
    [...allEmployees]
      .sort((a, b) => (a.brand || "").localeCompare(b.brand || ""))
      .map((e) => e.brand),
  );

  // Violation — only show after user types
  setupFieldSuggestions("violation", "violation-suggestions", () =>
    allEmployees.map((e) => e.violation),
  );

  // Fullname → A–Z by lastname, only show after user types
  setupFieldSuggestions(
    "fullname",
    "fullname-suggestions",
    () =>
      [...allEmployees]
        .sort((a, b) => {
          const lastName = (name) => {
            const parts = (name || "").trim().split(/\s+/);
            return parts[parts.length - 1].toLowerCase();
          };
          return lastName(a.fullname).localeCompare(lastName(b.fullname));
        })
        .map((e) => e.fullname),
    { requireInput: true },
  );

  // EMPID → high to low, only show after user types
  setupFieldSuggestions(
    "employee_id",
    "empid-suggestions",
    () =>
      [...allEmployees]
        .sort((a, b) => Number(b.id) - Number(a.id))
        .map((e) => String(e.id)),
    { raw: true },
  );

  // Proximity code — available codes from proxcode_backend, with icon + badge
  let availableCodes = [];

  setupFieldSuggestions("qr_code", "qrcode-suggestions", () => availableCodes, {
    raw: true,
    icon: "../../resource/assets/icon/nfc-icon.svg",
    badge: "Available",
    onFocus: async () => {
      try {
        const [proxRes, allEmpRes] = await Promise.all([
          fetch("proxcode_backend.php?action=get", {
            headers: { "X-Requested-With": "XMLHttpRequest" },
          }),
          fetch("manpower_backend.php?action=get&page=1&limit=1", {
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              "X-Silent-Request": "true",
            },
          }),
        ]);

        const proxJson = await proxRes.json();
        const allEmpJson = await allEmpRes.json();

        if (!proxJson.success || !Array.isArray(proxJson.data)) return;

        const currentCode =
          document.getElementById("qr_code")?.value.trim().toLowerCase() || "";

        // Use filter_options (ALL employees, no pagination) so codes assigned
        // to employees on other pages are correctly excluded from suggestions.
        const allEmployees =
          allEmpJson.success && Array.isArray(allEmpJson.filter_options)
            ? allEmpJson.filter_options
            : employees;

        const assignedSet = new Set(
          allEmployees
            .map((e) => (e.qr_code || "").trim().toLowerCase())
            .filter(Boolean),
        );

        // Only show codes that are:
        availableCodes = proxJson.data
          .filter((c) => {
            const cLower = (c.qr_code || "").trim().toLowerCase();
            return (
              c.is_active == 1 &&
              (!assignedSet.has(cLower) || cLower === currentCode)
            );
          })
          .map((c) => c.qr_code)
          .sort((a, b) => {
            const numA = Number(a);
            const numB = Number(b);
            const bothNumeric = !isNaN(numA) && !isNaN(numB);
            return bothNumeric
              ? numA - numB
              : String(a).localeCompare(String(b));
          });
      } catch (e) {
        console.warn("QR suggestions: failed to load", e);
      }
    },
  });
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// GET CURRENT ACTIVE FILTERS FROM FORM
function getActiveFilters() {
  const searchForm = document.getElementById("searchForm");
  const filters = {};
  if (!searchForm) return filters;

  const formData = new FormData(searchForm);
  for (let [key, value] of formData.entries()) {
    if (value && value.trim()) {
      filters[key] = value.trim();
    }
  }

  return filters;
}

// CHECK IF ANY FILTERS ARE ACTIVE
function hasActiveFilters() {
  const filters = getActiveFilters();
  return Object.keys(filters).length > 0;
}

// DISPLAY FILTER STATUS IN UI
function displayFilterStatus() {
  const filters = getActiveFilters();

  const existingStatus = document.getElementById("filter-status");
  if (existingStatus) {
    existingStatus.remove();
  }

  if (Object.keys(filters).length > 0) {
    const filterInfo = document.createElement("div");
    filterInfo.id = "filter-status";
    filterInfo.style.cssText = `
      background: #e3f2fd;
      border-left: 4px solid #2196F3;
      padding: 12px 16px;
      margin-left: 16px;
      border-radius: 4px;
      font-size: 14px;
      color: #1565c0;
      display: inline-flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
    `;

    const filterLabel = document.createElement("span");
    filterLabel.style.display = "inline-flex";
    filterLabel.style.alignItems = "center";
    filterLabel.style.gap = "8px";

    const icon = document.createElement("i");
    icon.className = "fas fa-filter";
    filterLabel.appendChild(icon);

    const textSpan = document.createElement("span");
    // SECURITY: Use createTextNode for all user-derived filter values
    textSpan.appendChild(document.createTextNode("Active Filters: "));

    const filterEntries = Object.entries(filters);
    filterEntries.forEach(([key, value], index) => {
      if (index > 0) {
        textSpan.appendChild(document.createTextNode(" | "));
      }

      const strong = document.createElement("strong");
      const properKey = key
        .split(/(?=[A-Z])/)
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
      strong.textContent = `${properKey}:`;
      textSpan.appendChild(strong);
      // SECURITY: textContent is safe — no escaping needed here
      textSpan.appendChild(document.createTextNode(` ${value}`));
    });

    filterLabel.appendChild(textSpan);
    filterInfo.appendChild(filterLabel);

    const controlsDiv = document.querySelector(".controls");
    if (controlsDiv) {
      controlsDiv.appendChild(filterInfo);
    }
  }
}

// Function to stop any currently playing audio
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

// Load employee data for editing
async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `manpower_backend.php?action=get_single&id=${encodeURIComponent(employeeId)}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-Silent-Request": "true",
        },
      },
    );

    const data = await response.json();

    if (data.success && data.data) {
      const employee = data.data;

      // SECURITY: Use .value assignment (not innerHTML) for form fields
      document.getElementById("user_id").value = employee.user_id;
      document.getElementById("employee_id").value = employee.id;
      document.getElementById("original_id").value = employee.id;
      document.getElementById("fullname").value = employee.fullname || "";
      document.getElementById("position").value = employee.position || "";
      document.getElementById("brand").value = employee.brand || "";
      document.getElementById("status").value = employee.status || "Active";
      document.getElementById("shift").value = employee.shift || "";
      document.getElementById("violation").value = employee.violation || "";
      document.getElementById("qr_code").value = employee.qr_code || "";

      const fileLabel = document.querySelector(".file-upload-label");
      if (employee.image) {
        // SECURITY: escapeHtml on image path and alt text
        const imagePath = `${window.location.origin}/../public/uploads/user/${escapeHtml(employee.image)}`;
        const altText = escapeHtml(employee.fullname);

        fileLabel.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <img id="existingImagePreview" src="${imagePath}" alt="${altText}" loading="lazy"
              style="max-width: 100%; max-height: 200px; border-radius: 8px; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.15);"
              onerror="this.style.display='none'; document.getElementById('imageFallback').style.display='inline';">
            <span id="imageFallback" style="display:none;">📷 Image not available</span>
          </div>
        `;

        const previewImg = fileLabel.querySelector("#existingImagePreview");
        if (previewImg) previewImg.offsetHeight;
      } else {
        fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      }
    } else {
      showAlert("Failed to load employee data", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to load employee data", "error");
  }
}

// Update total employees count
async function updateTotalEmployees() {
  const el = document.getElementById("total_employees");
  if (el) el.textContent = totalRecords;
}

// Update active employees count
async function updateActiveEmployees() {
  try {
    const res = await fetch("manpower_backend.php?action=stats", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success) {
      const el1 = document.getElementById("active_employees");
      const el2 = document.getElementById("inactive_employees");
      if (el1) el1.textContent = data.data.active;
      if (el2) el2.textContent = data.data.inactive;
    }
  } catch (e) {
    console.error("Error updating employee counts", e);
  }
}

// Add employee to access log
async function addToLog(employeeId, checkStatus = "IN", triggerElement = null) {
  // SECURITY: whitelist checkStatus values
  if (!["IN", "OUT"].includes(checkStatus)) {
    console.error("Invalid checkStatus value:", checkStatus);
    return;
  }

  stopCurrentAudio();
  const button = triggerElement;
  const originalText = button ? button.innerHTML : "";

  try {
    if (button) {
      button.innerHTML = "⏳ Adding...";
      button.disabled = true;
    }

    const employee = employees.find((emp) => emp.id === employeeId);
    if (!employee) throw new Error("Employee not found");

    const hasViolations =
      employee.violation && employee.violation.trim() !== "";
    const hasInactive = employee.status.toLowerCase() === "inactive";
    const hasCheckedOut = checkStatus === "OUT";

    if (hasInactive) {
      playInactiveSound();
      showAlert("Access denied. Employee is inactive.", "error");
      return;
    }
    
    const logData = {
      user_id: employee.user_id,
      employee_id: employee.id,
      fullname: employee.fullname,
      position: employee.position,
      brand: employee.brand,
      status: employee.status,
      shift: employee.shift,
      violation: employee.violation || "",
      image: employee.image || "",
      qr_code: employee.qr_code,
      check_status: checkStatus,
      access_timestamp: new Date().toLocaleString("sv-SE", {
        timeZone: "Asia/Manila",
      }),
    };

    const response = await fetch("../http/middleware/add_to_log.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logData),
    });

    const result = await response.json();

    if (result.success) {
      if (hasViolations) playWarningSound();
      else if (hasInactive) playInactiveSound();
      else if (hasCheckedOut) playCheckoutSound();
      else playSuccessSound();

      showAlert(
        `Employee marked as ${escapeHtml(checkStatus)} successfully!`,
        "success",
      );
    } else {
      throw new Error(result.message || "Failed to add employee to log");
    }
  } catch (error) {
    console.error("Error adding to log:", error);
    showAlert("Error: " + escapeHtml(error.message), "error");
  } finally {
    setTimeout(() => {
      searchEmployees();
      if (button) {
        button.innerHTML = originalText;
        button.disabled = false;
      }
    }, 1000);
  }
}

async function renderEmployeeError(message = "Failed to load employee data.") {
  const tbody = document.getElementById("employeeTableBody");
  const paginationDiv = document.getElementById("pagination");
  const noDataDiv = document.getElementById("no-data");

  if (!tbody) {
    console.error("Employee table body not found");
    return;
  }

  if (!employees || employees.length === 0) {
    tbody.innerHTML = "";
    if (paginationDiv) paginationDiv.style.display = "none";
    if (noDataDiv) noDataDiv.style.display = "block";
    return;
  }

  if (noDataDiv) noDataDiv.style.display = "none";

  // SECURITY: escapeHtml on message in case it contains user-influenced content
  tbody.innerHTML = `
    <tr>
      <td colspan="13" style="text-align: center; padding: 20px; color: #c0392b;">
        ⚠️ ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

// Render employee table
async function renderEmployeeTable() {
  const tbody = document.getElementById("employeeTableBody");
  const paginationDiv = document.getElementById("pagination");
  const noDataDiv = document.getElementById("no-data");

  if (employees.length === 0) {
    tbody.innerHTML = "";
    paginationDiv.style.display = "none";
    noDataDiv.style.display = "block";
    return;
  }

  noDataDiv.style.display = "none";

  const currentEmployees = employees;
  const startIndex = (currentPage - 1) * itemsPerPage;

  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      // SECURITY: escapeHtml on ALL employee fields used in innerHTML
      const safeFullname = escapeHtml(employee.fullname);
      const safePosition = escapeHtml(employee.position);
      const safeBrand = escapeHtml(employee.brand);
      const safeStatus = escapeHtml(employee.status);
      const safeShift = escapeHtml(employee.shift);
      const safeViolation = escapeHtml(employee.violation);
      const safeQrCode = escapeHtml(employee.qr_code);
      const safeImage = escapeHtml(employee.image);
      const safeId = escapeHtml(String(employee.id));
      const safeCreatedAt = escapeHtml(employee.created_at);
      const safeUpdatedAt = escapeHtml(employee.updated_at);

      const fullnameInitials = (employee.fullname || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const isAboveFold = index < 5;

      // SECURITY: Use encodeURIComponent for URL params, escapeHtml for HTML attrs
      const thumbSrc = `${window.location.origin}/public/uploads/user/thumb_${safeImage}`;
      const imageSrc = `${window.location.origin}/public/uploads/user/${safeImage}`;

      // SECURITY: For JS event handler attributes, use data attributes + event delegation
      // instead of inline onclick with raw string interpolation where possible.
      // For employee.id (integer from DB) direct use is safe; strings are escaped above.
      const numericId = parseInt(employee.id, 10);

      return `
          <tr>
            <td>${startIndex + index + 1}</td>
            <td>
              <div><strong>${toProperCase(safeFullname)}</strong></div>
              <div class="emp-id"><strong>EMPID: ${safeId}</strong></div>
            </td>
            <td>
              <div>${toProperCase(safeBrand)}</div>
              <div class="emp-position"><strong>Position: ${toProperCase(safePosition)}</strong></div>
            </td>
            <td><span class="status-${safeStatus.toLowerCase()}">${safeStatus}</span></td>
            <td>${safeShift}</td>
            <td class="Col7">
              <div style="display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center;">
                ${
                  employee.violation && employee.violation.trim()
                    ? `<button
                      data-emp-id="${safeId}"
                      data-fullname="${toProperCase(safeFullname)}"
                      data-violation="${safeViolation}"
                      onclick="openViolationPopupFromBtn(this)"
                      style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
                        font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;
                        border:0.5px solid #fca5a5;border-radius:6px;
                        background:#fff5f5;color:#e53e3e;">
                      <i class="fas fa-exclamation-triangle" style="font-size:10px;"></i>
                    </button>`
                    : ""
                }
                ${
                  parseInt(employee.violation_count) > 0
                    ? `<button
                      data-emp-id="${safeId}"
                      data-fullname="${toProperCase(safeFullname)}"
                      onclick="openViolationsModalFromBtn(this)"
                      style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
                        font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;
                        border:0.5px solid #f59e0b;border-radius:6px;
                        background:#fffbeb;color:#b45309;">
                      &#9888; See more
                    </button>`
                    : `<span style="color:#aaa;font-size:11px;font-style:italic;">None</span>`
                }
              </div>
            </td>
            <td class="Col8">${
              employee.image
                ? `<img src="${thumbSrc}" alt="${safeFullname}" class="employee-image"
                      width="48" height="48"
                      loading="${isAboveFold ? "eager" : "lazy"}"
                      decoding="async"
                      ${isAboveFold ? 'fetchpriority="high"' : ""}
                      onerror="if(this.src !== '${imageSrc}'){this.src='${imageSrc}';}else{this.onerror=null;this.style.display='none';this.parentElement.querySelector('.employee-ph-fallback').style.display='flex';}">
                    <div class="employee-ph-fallback ph-cont" style="display:none;">
                      <div class="employee-ph">${escapeHtml(fullnameInitials)}</div>
                    </div>`
                : `<div class="ph-cont"><div class="employee-ph">${escapeHtml(fullnameInitials)}</div></div>`
            }</td>
            <td class="Col9" data-qr="${safeQrCode}" onclick="copyQRCodeFromCell(this)" title="Copy Proximity code" style="cursor:pointer;">
              <img src="../../resource/assets/icon/nfc-icon.svg" alt="Copy Proximity code" loading="lazy" style="width: 20px; height: 20px;"></td>
            <td><small>${safeCreatedAt}</small></td>
            <td><small>${safeUpdatedAt}</small></td>

            ${
              window.PERMISSIONS.manualInOut ||
              window.PERMISSIONS.logs ||
              window.PERMISSIONS.edit ||
              window.PERMISSIONS.delete
                ? `
            <td style="position: relative; width: 160px;">

              <!-- ACTIONS TOGGLE -->
              <button
                onclick="toggleActionsPanel(this)"
                data-emp-id="${safeId}"
                class="actions-toggle-btn"
                style="
                  width: 100%;
                  padding: 6px 12px;
                  font-size: 12px;
                  font-weight: 700;
                  letter-spacing: 1px;
                  border: 1.5px solid #cbd5e1;
                  border-radius: 10px;
                  background: #fff;
                  color: #1e293b;
                  cursor: pointer;
                  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
                  white-space: nowrap;
                "
              >
                ACTIONS
              </button>

              <!-- FLOATING PANEL -->
              <div class="actions-panel">
                <small style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); text-align: center; color: #fff;">${toProperCase(safeFullname)}</small>

                ${
                  window.PERMISSIONS.manualInOut
                    ? `
                <!-- IN / OUT -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #e2e8f0;">
                  <button
                    data-emp-id="${numericId}"
                    data-check-status="IN"
                    onclick="addToLogFromBtn(this)"
                    title="Check: IN"
                    style="
                      display:flex; align-items:center; justify-content:center; gap:5px;
                      padding: 7px 4px;
                      font-size: 11px; font-weight: 700;
                      background: linear-gradient(135deg, #4ade80, #16a34a);
                      color: #fff; border: none;
                      border-right: 1px solid #e2e8f0;
                      cursor: pointer;
                    ">
                    <span style="width:7px;height:7px;background:#fff;border-radius:50%;display:inline-block;box-shadow:0 0 0 1.5px #15803d;"></span> IN
                  </button>
                  <button
                    data-emp-id="${numericId}"
                    data-check-status="OUT"
                    onclick="addToLogFromBtn(this)"
                    title="Check: OUT"
                    style="
                      display:flex; align-items:center; justify-content:center; gap:5px;
                      padding: 7px 4px;
                      font-size: 11px; font-weight: 700;
                      background: linear-gradient(135deg, #fb923c, #ef4444);
                      color: #fff; border: none;
                      cursor: pointer;
                    ">
                    <span style="width:7px;height:7px;background:#fff;border-radius:50%;display:inline-block;"></span> OUT
                  </button>
                </div>
                `
                    : ""
                }

                ${
                  window.PERMISSIONS.logs
                    ? `
                <!-- LOGS -->
                <button
                  data-emp-id="${safeId}"
                  data-fullname="${safeFullname}"
                  onclick="openLogsModalFromBtn(this)"
                  style="
                    width:100%; padding: 7px;
                    font-size: 12px; font-weight: 700;
                    background: #fff; color: #0ea5e9;
                    border: none; border-bottom: 1px solid #e2e8f0;
                    cursor: pointer; text-align: center;
                  ">
                  <i class="fas fa-history"></i> LOGS
                </button>
                `
                    : ""
                }

                ${
                  window.PERMISSIONS.edit
                    ? `
                <!-- EDIT -->
                <button
                  data-emp-id="${numericId}"
                  onclick="openEditFromBtn(this)"
                  style="
                    width:100%; padding: 7px;
                    font-size: 12px; font-weight: 700;
                    background: #fff; color: #6366f1;
                    border: none; border-bottom: 1px solid #e2e8f0;
                    cursor: pointer; text-align: center;
                  ">
                  <i class="fas fa-edit"></i> EDIT
                </button>
                `
                    : ""
                }

                ${
                  window.PERMISSIONS.delete
                    ? `
                <!-- DELETE -->
                <button
                  data-emp-id="${safeId}"
                  onclick="openDeleteFromBtn(this)"
                  style="
                    width:100%; padding: 7px;
                    font-size: 12px; font-weight: 700;
                    background: #fff; color: #ef4444;
                    border: none;
                    cursor: pointer; text-align: center;
                  ">
                  <i class="fas fa-trash-alt"></i> DELETE
                </button>
                `
                    : ""
                }

              </div>
            </td>
            `
                : ""
            }
          </tr>
      `;
    })
    .join("");

  updatePaginationControls();
}

// ─────────────────────────────────────────────────────────────────
// SECURITY: data-attribute bridge functions
// These replace inline onclick string interpolation, preventing
// injection of arbitrary JS through employee field values.
// ─────────────────────────────────────────────────────────────────

function toggleActionsPanel(btn) {
  const panel = btn.parentElement.querySelector(".actions-panel");
  const allPanels = document.querySelectorAll(".actions-panel");
  const allBtns = document.querySelectorAll(".actions-toggle-btn");

  allPanels.forEach((p) => {
    if (p !== panel) p.classList.remove("actions-open");
  });
  allBtns.forEach((b) => {
    if (b !== btn) b.classList.remove("actions-active");
  });

  panel.classList.toggle("actions-open");
  btn.classList.toggle("actions-active");

  if (panel.classList.contains("actions-open") && window.innerWidth <= 480) {
    const rect = btn.getBoundingClientRect();
    let top = rect.bottom + 4;
    let left = rect.left;

    if (left + 160 > window.innerWidth - 8) left = window.innerWidth - 160 - 8;
    if (top + 180 > window.innerHeight) top = rect.top - 184;

    panel.style.top = top + "px";
    panel.style.left = left + "px";
  } else {
    panel.style.top = "";
    panel.style.left = "";
  }
}

function addToLogFromBtn(btn) {
  const empId = parseInt(btn.dataset.empId, 10);
  const checkStatus = btn.dataset.checkStatus;
  if (!empId || !["IN", "OUT"].includes(checkStatus)) return;
  addToLog(empId, checkStatus, btn);
}

function openLogsModalFromBtn(btn) {
  openLogsModal(btn.dataset.empId, btn.dataset.fullname);
}

function openEditFromBtn(btn) {
  openModal("edit", parseInt(btn.dataset.empId, 10));
}

function openDeleteFromBtn(btn) {
  openDeleteModal(btn.dataset.empId, false);
}

function openViolationsModalFromBtn(btn) {
  openViolationsModal(btn.dataset.empId, btn.dataset.fullname);
}

function openViolationPopupFromBtn(btn) {
  // Read values from data attributes (already HTML-escaped in the template)
  // but pass RAW values from the employees array to avoid double-escaping in the popup logic
  const empId = btn.dataset.empId;
  const employee = employees.find((e) => String(e.id) === String(empId));
  if (!employee) return;
  openViolationPopup(employee.fullname, employee.violation, employee.id);
}

function copyQRCodeFromCell(td) {
  // SECURITY: read from data attribute, not from rendered text
  copyQRCode(td.dataset.qr);
}

async function getCurrentUserId() {
  try {
    const response = await fetch("../helper/get_user_id.php", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data.user_id || "default";
    } else {
      console.warn("Failed to get user ID, using default");
    }
  } catch (error) {
    console.error("Error getting user ID:", error);
  }

  return "default";
}

// Copy QR code to clipboard
function copyQRCode(code) {
  // Create a temporary textarea element to hold the text
  const tempTextArea = document.createElement("textarea");
  tempTextArea.value = code;
  document.body.appendChild(tempTextArea);

  // Select and copy the text
  tempTextArea.select();
  tempTextArea.setSelectionRange(0, 99999); // For mobile devices

  try {
    // Copy the text to clipboard
    document.execCommand("copy");

    // Show success message (optional)
    showAlert("Proximity code copied to clipboard!");

    // Alternative: Use a more subtle notification
    // console.log('QR code copied:', code);
  } catch (err) {
    // Fallback for modern browsers using the Clipboard API
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          showAlert("Proximity code copied to clipboard!");
        })
        .catch(() => {
          showAlert("Failed to copy Proximity code");
        });
    } else {
      showAlert("Failed to copy Proximity code");
    }
  }

  // Remove the temporary textarea
  document.body.removeChild(tempTextArea);
}

// Pagination functions
function updatePaginationControls() {
  const paginationDiv = document.getElementById("pagination");
  if (!paginationDiv) return;

  if (totalPages <= 1) {
    paginationDiv.style.display = "none";
    return;
  }

  paginationDiv.style.display = "flex";

  const delta = 2;
  const range = new Set();
  range.add(1);
  range.add(totalPages);
  for (
    let i = Math.max(2, currentPage - delta);
    i <= Math.min(totalPages - 1, currentPage + delta);
    i++
  ) {
    range.add(i);
  }

  const sorted = [...range].sort((a, b) => a - b);
  let prev = null;
  let buttonsHTML = "";

  for (const p of sorted) {
    if (prev !== null && p - prev > 1) {
      buttonsHTML += `<span class="page-ellipsis">…</span>`;
    }
    // SECURITY: p is always a number — safe in template literal
    buttonsHTML += `<button class="page-num-btn ${currentPage === p ? "active" : ""}" onclick="goToPage(${p})">${p}</button>`;
    prev = p;
  }

  paginationDiv.innerHTML = `
    <button class="page-arrow-btn" onclick="previousPage()" ${currentPage <= 1 ? "disabled" : ""}>
      <i class="fas fa-arrow-left"></i>
    </button>
    ${buttonsHTML}
    <button class="page-arrow-btn" onclick="nextPage()" ${currentPage >= totalPages ? "disabled" : ""}>
      <i class="fas fa-arrow-right"></i>
    </button>
    <span id="page-info">${totalRecords} total &nbsp;|&nbsp; Page ${currentPage} of ${totalPages}</span>
  `;
}

function previousPage() {
  if (currentPage > 1) {
    currentPage--;
    loadEmployees(activeFilters, true, true);
  }
}

function nextPage() {
  if (currentPage < totalPages) {
    currentPage++;
    loadEmployees(activeFilters, true, true);
  }
}

function goToPage(page) {
  if (page >= 1 && page <= totalPages) {
    currentPage = page;
    loadEmployees(activeFilters, true, true);
  }
}

// SEARCH EMPLOYEES
function searchEmployees() {
  const searchForm = document.getElementById("searchForm");
  const searchQuery = document.getElementById("search_qr").value.trim();

  if (!searchForm) return;

  const filters = getActiveFilters();
  loadEmployees(filters, true, true);

  if (searchQuery) {
    document.getElementById("search_qr").value = "";
  }

  displayFilterStatus();
  updateDeleteButtonState();
}

// CLEAR SEARCH
function clearSearch() {
  const searchForm = document.getElementById("searchForm");
  if (searchForm) searchForm.reset();

  const filterStatus = document.getElementById("filter-status");
  if (filterStatus) filterStatus.remove();

  currentPage = 1;
  activeFilters = {};
  updateDeleteButtonState();
  loadEmployees({}, false, true);
}

function clearDateFilter() {
  const dateInput = document.getElementById("search_date");
  const clearBtn = document.getElementById("clear_date_btn");
  if (dateInput) dateInput.value = "";
  if (clearBtn) clearBtn.style.display = "none";
  searchEmployees();
}

// ── Fullname Autocomplete ────────────────────────────────────────────────────
let suggestionIndex = -1;

function showFullnameSuggestions(query) {
  const list = document.getElementById("fullname-suggestions");
  if (!list) return;

  const q = query.trim().toLowerCase();

  const matches = [
    ...new Map(
      employees
        .filter((emp) => !q || emp.fullname.toLowerCase().includes(q))
        .map((emp) => [emp.fullname.toLowerCase(), emp.fullname]),
    ).values(),
  ];

  if (!matches.length || !q) {
    list.style.display = "none";
    suggestionIndex = -1;
    return;
  }

  // SECURITY: escapeHtml on name before inserting into innerHTML
  list.innerHTML = matches
    .map((name, i) => {
      const safeName = escapeHtml(name);
      const properName = escapeHtml(toProperCase(name));
      const regex = new RegExp(
        `(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
        "gi",
      );
      const highlighted = properName.replace(
        regex,
        '<mark style="background:#fef08a;border-radius:2px;">$1</mark>',
      );
      return `
      <li data-value="${properName}" data-index="${i}"
          onmousedown="selectSuggestionFromLi(this)"
          onmouseover="highlightSuggestion(${i})"
          style="padding: 8px 12px; cursor: pointer; font-size: 13px; border-bottom: 1px solid #f1f5f9;">
        ${highlighted}
      </li>`;
    })
    .join("");

  list.style.display = "block";
  suggestionIndex = -1;
}

// SECURITY: read name from data-value attribute instead of string interpolation
function selectSuggestionFromLi(li) {
  selectSuggestion(li.dataset.value);
}

function selectSuggestion(name) {
  const input = document.getElementById("search_fullname");
  const list = document.getElementById("fullname-suggestions");
  // SECURITY: .value assignment is safe (no HTML injection)
  if (input) input.value = name;
  if (list) list.style.display = "none";
  suggestionIndex = -1;
  searchEmployees();
}

function highlightSuggestion(index) {
  const items = document.querySelectorAll("#fullname-suggestions li");
  items.forEach((li, i) => {
    li.style.background = i === index ? "#f0f9ff" : "";
  });
  suggestionIndex = index;
}

function handleSuggestionNav(e) {
  const list = document.getElementById("fullname-suggestions");
  const items = list ? list.querySelectorAll("li") : [];
  if (!items.length || list.style.display === "none") return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1);
    highlightSuggestion(suggestionIndex);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    suggestionIndex = Math.max(suggestionIndex - 1, 0);
    highlightSuggestion(suggestionIndex);
  } else if (e.key === "Enter" && suggestionIndex >= 0) {
    e.preventDefault();
    // SECURITY: read from data attribute
    selectSuggestion(items[suggestionIndex].dataset.value);
  } else if (e.key === "Escape") {
    list.style.display = "none";
    suggestionIndex = -1;
  }
}

// ── Generic field autocomplete ───────────────────────────────────────────────
function setupFieldSuggestions(inputId, listId, getValues, options = {}) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // Always remove existing list and re-append to body
  const existing = document.getElementById(listId);
  if (existing) existing.remove();

  const list = document.createElement("ul");
  list.id = listId;
  list.style.cssText = `
    display:none;position:fixed;z-index:99999;
    background:#fff;border:1px solid #cbd5e1;
    border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);
    list-style:none;margin:0;padding:0;
    max-height:260px;overflow:hidden;overflow-y:auto;min-width:160px;
  `;
  document.body.appendChild(list);

  let idx = -1;

  function positionList() {
    const rect = input.getBoundingClientRect();
    list.style.top = rect.bottom + 4 + "px";
    list.style.left = rect.left + "px";
    list.style.width = rect.width + "px";
  }

  function show(q) {
    const lower = q.trim().toLowerCase();
    const raw = getValues();
    const seen = new Map();
    raw
      .map((v) => (v || "").trim())
      .filter((v) => v && v.toLowerCase() !== "none")
      .filter((v) => !lower || v.toLowerCase().includes(lower))
      .forEach((v) => {
        const key = v.toLowerCase();
        if (!seen.has(key)) seen.set(key, v);
      });
    const unique = [...seen.values()];

    if (!unique.length) {
      list.style.display = "none";
      idx = -1;
      return;
    }

    list.innerHTML = unique
      .map((name, i) => {
        const safe = escapeHtml(name);
        // Display label: proper-cased for position/brand/violation; raw for qr_code (options.raw)
        const displayLabel = options.raw
          ? safe
          : escapeHtml(toProperCase(name));

        // Only apply highlight markup when the user has actually typed something
        let hl = displayLabel;
        if (lower) {
          const regex = new RegExp(
            `(${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
          );
          hl = displayLabel.replace(
            regex,
            '<mark style="background:#fef08a;border-radius:2px;">$1</mark>',
          );
        }

        // data-value uses the display label so saving the form normalises
        // PascalCase values (e.g. "PetmateDamage" → "Petmate Damage").
        // For raw fields (qr_code) the original value is preserved.
        const inputValue = displayLabel;

        return `<li data-value="${inputValue}" data-index="${i}"
        onmousedown="document.getElementById('${inputId}').value=this.dataset.value;document.getElementById('${listId}').style.display='none';"
        onmouseover="this.parentElement.querySelectorAll('li').forEach((l,j)=>l.style.background=j===${i}?'#f0f9ff':'');"
        style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;
               display:flex;align-items:center;">
        ${hl}
      </li>`;
      })
      .join("");

    positionList();
    list.style.display = "block";
    idx = -1;
  }

  // Focus: optionally run async loader first
  input.addEventListener("focus", async () => {
    if (options.requireInput && !input.value.trim()) return;
    show(input.value);
    if (options.onFocus) {
      await options.onFocus();
      show(input.value);
    }
  });

  input.addEventListener("input", () => show(input.value));

  window.addEventListener(
    "scroll",
    () => {
      if (list.style.display !== "none") positionList();
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (list.style.display !== "none") positionList();
  });

  input.addEventListener("keydown", (e) => {
    const items = list.querySelectorAll("li");
    if (!items.length || list.style.display === "none") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      idx = Math.min(idx + 1, items.length - 1);
      items.forEach(
        (l, j) => (l.style.background = j === idx ? "#f0f9ff" : ""),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
      items.forEach(
        (l, j) => (l.style.background = j === idx ? "#f0f9ff" : ""),
      );
    } else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      input.value = items[idx].dataset.value;
      list.style.display = "none";
      idx = -1;
    } else if (e.key === "Escape") {
      list.style.display = "none";
      idx = -1;
    }
  });

  document.addEventListener("click", (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = "none";
      idx = -1;
    }
  });
}

// Close suggestions when clicking outside
document.addEventListener("click", function (e) {
  const list = document.getElementById("fullname-suggestions");
  const input = document.getElementById("search_fullname");
  if (list && input && !input.contains(e.target) && !list.contains(e.target)) {
    list.style.display = "none";
    suggestionIndex = -1;
  }
});

// ── Violation padding — runs ONCE on page load ──
const violation = document.getElementById("violation");

function updateViolationPadding() {
  const hasData = violation.value.trim();
  violation.style.paddingTop = hasData ? "" : "40px";
  violation.style.paddingBottom = "";
}

violation.addEventListener("blur", updateViolationPadding);

violation.addEventListener("input", function () {
  if (violation.value.trim()) {
    violation.style.paddingTop = "";
    violation.style.paddingBottom = "40px";
  }
});

violation.addEventListener("focus", function () {
  violation.style.paddingTop = "";
  violation.style.paddingBottom = "40px";
});

let _lastValue = violation.value;
setInterval(function () {
  if (violation.value !== _lastValue) {
    _lastValue = violation.value;
    if (document.activeElement !== violation) updateViolationPadding();
  }
}, 100);

// ── Open modal ──────────────────────────────────────────────────────
async function openModal(action, employeeId = null) {
  currentAction = action;
  const modal = document.getElementById("employeeModal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("employeeForm");
  const qrCodeInput = document.getElementById("qr_code");

  if (!modal || !modalTitle || !form) {
    console.error("Modal elements not found");
    return;
  }

  form.reset();
  document.getElementById("employee_id").value = "";
  document.getElementById("original_id").value = "";

  const fileLabel = document.querySelector(".file-upload-label");
  const imageInput = document.getElementById("image");

  fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
  imageInput.value = "";

  if (action === "add") {
    modalTitle.innerHTML = `<i class="fas fa-user-plus"></i> Add Employee`;
    document.getElementById("status").value = "Active";
    modal.style.display = "block";
    updateViolationPadding(); // field is empty after reset
    qrCodeInput.focus();
  } else if (action === "edit" && employeeId) {
    modalTitle.innerHTML = `<i class="fas fa-edit" style="color:#7c3aed"></i> Edit Employee`;
    modal.style.display = "block";
    await loadEmployeeData(employeeId); // value is set here
    updateViolationPadding(); // now check with actual data
    const idField = document.getElementById("employee_id");
    if (idField) {
      idField.focus();
      idField.select();
    }
  }
}

// ENHANCED DELETE MODAL
function openDeleteModal(employeeId = null, requireConfirmation = false) {
  const modal = document.getElementById("deleteModal");
  const confirmBtn = document.getElementById("confirmDeleteBtn");
  const confirmationInput = document.getElementById("confirmationInput");
  const confirmationContainer = document.getElementById(
    "confirmationContainer",
  );
  const modalTitle = document.getElementById("deleteModalTitle");
  const modalMessage = document.getElementById("deleteModalMessage");

  const hasFilters = hasActiveFilters();

  confirmBtn.dataset.employeeId = employeeId;
  confirmBtn.dataset.requireConfirmation = requireConfirmation;
  confirmBtn.dataset.hasFilters = hasFilters;

  if (requireConfirmation) {
    if (hasFilters) {
      // SECURITY: textContent for title, DOM construction for message
      modalTitle.textContent = "⚠️ Delete Filtered Employees";

      // Build message safely using DOM methods
      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will delete ${employees.length} employee(s) matching your filters:`;
      p1.appendChild(strong);
      msgDiv.appendChild(p1);

      const filterBox = document.createElement("div");
      filterBox.style.cssText =
        "background: #fff3cd; border: 1px solid #ffeaa7; padding: 12px; border-radius: 4px; margin-bottom: 15px;";

      Object.entries(getActiveFilters()).forEach(([key, value]) => {
        const row = document.createElement("div");
        row.style.margin = "5px 0";
        const keyStrong = document.createElement("strong");
        const properKey = key
          .split(/(?=[A-Z])/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        keyStrong.textContent = properKey + ":";
        row.appendChild(keyStrong);
        // SECURITY: textContent for filter values — no XSS
        row.appendChild(document.createTextNode(" " + value));
        filterBox.appendChild(row);
      });

      msgDiv.appendChild(filterBox);

      const p2 = document.createElement("p");
      p2.style.cssText = "color: #d63031; font-weight: bold;";
      p2.textContent = "This action cannot be undone.";
      msgDiv.appendChild(p2);

      modalMessage.innerHTML = "";
      modalMessage.appendChild(msgDiv);
    } else {
      modalTitle.textContent = "⚠️ Delete All Employees";

      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will permanently delete ALL ${employees.length} employee(s).`;
      p1.appendChild(strong);
      msgDiv.appendChild(p1);
      const p2 = document.createElement("p");
      p2.style.cssText = "color: #d63031; font-weight: bold;";
      p2.textContent = "This action cannot be undone.";
      msgDiv.appendChild(p2);
      modalMessage.innerHTML = "";
      modalMessage.appendChild(msgDiv);
    }

    confirmationContainer.style.display = "block";
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = "0.5";
    confirmBtn.style.cursor = "not-allowed";
  } else {
    modalTitle.textContent = "Delete Employee";
    modalMessage.textContent = "Are you sure you want to delete this employee?";
    confirmationContainer.style.display = "none";
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = "1";
    confirmBtn.style.cursor = "pointer";
  }

  if (confirmationInput) confirmationInput.value = "";

  modal.style.display = "flex";

  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

  if (requireConfirmation && confirmationInput) {
    const newConfirmationInput = confirmationInput.cloneNode(true);
    confirmationInput.parentNode.replaceChild(
      newConfirmationInput,
      confirmationInput,
    );

    newConfirmationInput.focus();

    newConfirmationInput.addEventListener("input", () => {
      newConfirmBtn.disabled = newConfirmationInput.value !== "DELETE ALL";
      newConfirmBtn.style.opacity = newConfirmBtn.disabled ? "0.5" : "1";
      newConfirmBtn.style.cursor = newConfirmBtn.disabled
        ? "not-allowed"
        : "pointer";
    });
  }

  const handleConfirm = () => {
    const id = newConfirmBtn.dataset.employeeId;
    const requiresConfirm =
      newConfirmBtn.dataset.requireConfirmation === "true";
    const hasFiltersFlag = newConfirmBtn.dataset.hasFilters === "true";

    if (requiresConfirm) {
      if (hasFiltersFlag) {
        deleteFilteredEmployees();
      } else {
        showAlert("Cannot be Deleted! Try changing filters.", "error");
      }
    } else {
      deleteEmployee(id);
    }
    modal.style.display = "none";
  };

  newConfirmBtn.addEventListener("click", handleConfirm);

  document.addEventListener("keydown", function onEnterKey(e) {
    if (e.key === "Enter" && modal.style.display === "flex") {
      if (!newConfirmBtn.disabled) handleConfirm();
      document.removeEventListener("keydown", onEnterKey);
    }
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });
}

// UPDATE DELETE BUTTON STATE based on active filters
function updateDeleteButtonState() {
  const deleteBtn = document.querySelector(".delete-all-btn .btn-danger");
  if (!deleteBtn) return;

  const hasFilters = Object.keys(activeFilters).length > 0;
  const hasData = employees && employees.length > 0;
  const canDelete = hasFilters && hasData;

  deleteBtn.disabled = !canDelete;
  deleteBtn.style.opacity = canDelete ? "1" : "0.4";
  deleteBtn.style.cursor = canDelete ? "pointer" : "not-allowed";

  if (!hasFilters) {
    deleteBtn.title = "Apply filters first to enable deletion";
  } else if (!hasData) {
    deleteBtn.title = "No matching records to delete";
  } else {
    deleteBtn.title = `Delete ${employees.length} filtered employee(s)`;
  }
}

// DELETE EMPLOYEES BASED ON ACTIVE FILTERS
async function deleteFilteredEmployees() {
  try {
    showLoading(true);

    const employeeIds = employees.map((emp) => emp.id);

    if (employeeIds.length === 0) {
      showAlert("No employees to delete", "warning");
      return;
    }

    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(employeeIds));
    formData.append("filters", JSON.stringify(activeFilters));

    const response = await fetch("manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(
        `Successfully deleted ${escapeHtml(String(data.deleted_count || employeeIds.length))} employee(s) matching your filters.`,
        "success",
      );

      currentPage = 1;
      clearSearch();
    } else {
      showAlert(
        escapeHtml(data.message) || "Failed to delete filtered employees",
        "error",
      );
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to delete filtered employees", "error");
  } finally {
    showLoading(false);
  }
}

async function openLogsModal(employeeId, fullname) {
  const modal = document.getElementById("logsModal");
  const title = document.getElementById("logsModalTitle");
  const tbody = document.getElementById("logsTableBody");

  document.getElementById("logCountIn").textContent = "—";
  document.getElementById("logCountOut").textContent = "—";
  document.getElementById("logCountTotal").textContent = "—";

  // SECURITY: textContent for user-supplied fullname in title
  title.innerHTML = `<i class="fas fa-history"></i> Access Logs — `;
  const nameSpan = document.createElement("span");
  nameSpan.textContent = fullname;
  title.appendChild(nameSpan);

  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:24px;color:#aaa;">Loading…</td></tr>`;
  modal.style.display = "block";

  try {
    const res = await fetch(
      `manpower_backend.php?action=get_access_logs&id=${encodeURIComponent(employeeId)}`,
      {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      },
    );
    const data = await res.json();

    if (data.success) {
      const logs = data.logs;
      const inCount = logs.filter((l) => l.check_status === "IN").length;
      const outCount = logs.filter((l) => l.check_status === "OUT").length;

      // SECURITY: textContent for counts
      document.getElementById("logCountIn").textContent = inCount;
      document.getElementById("logCountOut").textContent = outCount;
      document.getElementById("logCountTotal").textContent = logs.length;

      tbody.innerHTML = logs.length
        ? logs
            .map(
              (log, i) => `
        <tr style="border-bottom:1px solid #f0f0f0;">
          <td style="padding:9px 12px;color:#aaa;">${i + 1}</td>
          <td style="padding:9px 12px;">
            <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
              background:${log.check_status === "IN" ? "#d1fae5" : "#fee2e2"};
              color:${log.check_status === "IN" ? "#065f46" : "#991b1b"};">
              ${escapeHtml(log.check_status)}
            </span>
          </td>
          <td style="padding:9px 12px;color:#555;">${escapeHtml(log.access_timestamp)}</td>
          <td style="padding:9px 12px;">${escapeHtml(log.gate_name || log.user_id || "N/A")}</td>
        </tr>`,
            )
            .join("")
        : `<tr><td colspan="4" style="text-align:center;padding:24px;color:#aaa;">No log records found.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#ef4444;padding:24px;">${escapeHtml(data.message || "Failed to load logs.")}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#ef4444;padding:24px;">Error loading logs.</td></tr>`;
  }

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}

async function openViolationsModal(employeeId, fullname) {
  const modal = document.getElementById("violationsModal");
  const title = document.getElementById("violationsModalTitle");
  const tbody = document.getElementById("violationsTableBody");

  document.getElementById("vioCountTotal").textContent = "—";
  document.getElementById("vioCountUpdates").textContent = "—";
  document.getElementById("vioCountCleared").textContent = "—";

  // SECURITY: textContent for fullname
  title.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#e53e3e;"></i> Violation History — `;
  const nameSpan = document.createElement("span");
  nameSpan.textContent = fullname;
  title.appendChild(nameSpan);

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#aaa;">Loading…</td></tr>`;
  modal.style.display = "block";

  try {
    const res = await fetch(
      `manpower_backend.php?action=get_violations&id=${encodeURIComponent(employeeId)}`,
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
    );
    const data = await res.json();

    if (data.success) {
      const rows = data.violations;
      const updates = rows.filter(
        (r) => r.violation_type === "Remarks Updated",
      ).length;
      const cleared = rows.filter(
        (r) => r.violation_type === "Remarks Cleared",
      ).length;

      // SECURITY: textContent for counts
      document.getElementById("vioCountTotal").textContent = rows.length;
      document.getElementById("vioCountUpdates").textContent = updates;
      document.getElementById("vioCountCleared").textContent = cleared;

      const typeBg = (type) => {
        if (type === "Remarks Cleared")
          return { bg: "#f0fff4", color: "#276749" };
        if (type === "Remarks Updated")
          return { bg: "#fffbeb", color: "#b7791f" };
        return { bg: "#fff5f5", color: "#c53030" };
      };

      tbody.innerHTML = rows.length
        ? rows
            .map((v, i) => {
              const { bg, color } = typeBg(v.violation_type);
              return `
              <tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:9px 12px;color:#aaa;">${i + 1}</td>
                <td style="padding:9px 12px;">
                  <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
                    background:${escapeHtml(bg)};color:${escapeHtml(color)};">
                    ${escapeHtml(v.violation_type || "—")}
                  </span>
                </td>
                <td style="padding:9px 12px;color:#555;max-width:220px;word-break:break-word;">
                  ${escapeHtml(v.violation_description || "—")}
                </td>
                <td style="padding:9px 12px;white-space:nowrap;">${escapeHtml(v.violation_date || "—")}</td>
                <td style="padding:9px 12px;color:#aaa;font-size:11px;white-space:nowrap;">
                  ${escapeHtml(v.created_at || "—")}
                </td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="5" style="text-align:center;padding:24px;color:#aaa;">No violation records found.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:24px;">${escapeHtml(data.message || "Failed to load.")}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:24px;">Error loading records.</td></tr>`;
  }

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}

function openViolationPopup(fullname, violation, employeeId) {
  const existing = document.getElementById("violationPopupOverlay");
  if (existing) existing.remove();

  const employee =
    employees.find((emp) => String(emp.id) === String(employeeId)) || {};

  const params = new URLSearchParams({
    emp: employeeId,
    fullname: fullname,
    brand: employee?.brand || "",
    position: employee?.position || "",
    shift: employee?.shift || "",
    status: employee?.status || "",
    violation: violation,
    ts: new Date().toISOString(),
  });

  // Build popup using DOM methods — no innerHTML with raw user data
  const overlay = document.createElement("div");
  overlay.id = "violationPopupOverlay";
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.35);
    display:flex;align-items:center;justify-content:center;z-index:9999;
  `;

  const reportUrl = "incident_report.php?" + params.toString();

  const card = document.createElement("div");
  card.style.cssText = `background:#fff;border:0.5px solid #e2e8f0;border-radius:12px;
    padding:1.25rem;max-width:360px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.12);`;

  // Header row
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;";

  const headerLabel = document.createElement("span");
  headerLabel.style.cssText = "font-size:13px;font-weight:500;color:#64748b;";
  // SECURITY: textContent for fullname
  headerLabel.textContent = `${fullname} — Remarks`;

  const footer = document.createElement("div");
  footer.style.cssText =
    "display:flex;justify-content:end;align-items:center;margin-top:12px;";

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText =
    "background:none;border:none;font-size:16px;cursor:pointer;color:#94a3b8;line-height:1;padding:0;";
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => overlay.remove();

  header.appendChild(headerLabel);
  header.appendChild(closeBtn);

  // Body row
  const body = document.createElement("div");
  body.style.cssText =
    "display:flex;align-items:flex-start;justify-content:space-between;gap:12px;";

  const violationText = document.createElement("div");
  violationText.style.cssText =
    "font-size:13px;color:#1e293b;line-height:1.6;white-space:pre-wrap;flex:1;max-height:200px;overflow-y:auto;word-break:break-word;";
  // SECURITY: textContent for violation content
  violationText.textContent = violation;

  const attachBtn = document.createElement("button");
  attachBtn.style.cssText = `display:inline-flex;align-items:center;gap:5px;padding:5px 12px;
    font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;flex-shrink:0;
    border:0.5px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#1e293b;`;
  attachBtn.textContent = "📎 View Attachment";
  attachBtn.onclick = () => window.open(reportUrl, "_blank");

  body.appendChild(violationText);
  footer.appendChild(attachBtn);

  card.appendChild(header);
  card.appendChild(body);
  card.appendChild(footer);
  overlay.appendChild(card);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

function updateSelectColor(select) {
  if (!select) return;
  const isPlaceholder = select.selectedIndex === 0;
  select.style.color = isPlaceholder ? "#999" : "#000";
  [...select.options].forEach((opt) => {
    opt.style.color = "#000";
  });
}

function updateColor() {
  const selects = [
    document.getElementById("search_position"),
    document.getElementById("search_brand"),
    document.getElementById("search_status"),
    document.getElementById("search_shift"),
    document.getElementById("search_violation"),
  ];

  selects.forEach(updateSelectColor);
}

function populateFilter(employeeList) {
  const position = document.getElementById("search_position");
  const brand = document.getElementById("search_brand");
  const status = document.getElementById("search_status");
  const shift = document.getElementById("search_shift");
  const violation = document.getElementById("search_violation");
  if (!position || !brand || !status || !shift || !violation) return;

  function buildSelect(select, placeholder, noneLabel, valuesMap) {
    const current = select.value;

    select.innerHTML =
      `<option value="" disabled selected hidden>${placeholder}</option>` +
      `<option value="">Default: ALL</option>` +
      `<option value="__none__">${noneLabel}</option>`;

    if (valuesMap.size > 0) {
      select.innerHTML += `<option disabled>──────────</option>`;

      [...valuesMap.values()]
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
        .forEach((v) => {
          const opt = document.createElement("option");
          // SECURITY: .value and .textContent are safe
          opt.value = v;
          opt.textContent = toProperCase(v);
          select.appendChild(opt);
        });
    }

    if (current && [...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  }

  const positionMap = new Map();
  const brandMap = new Map();
  const statusMap = new Map();
  const shiftMap = new Map();
  const violationMap = new Map();

  for (const emp of employeeList) {
    const add = (map, raw) => {
      const v = (raw || "").trim();
      if (v && v.toLowerCase() !== "none") {
        const key = v.toLowerCase();
        if (!map.has(key)) map.set(key, v);
      }
    };

    add(positionMap, emp.position);
    add(brandMap, emp.brand);
    add(statusMap, emp.status);
    add(shiftMap, emp.shift);
    add(violationMap, emp.violation);
  }

  buildSelect(position, "Position", "No Position", positionMap);
  buildSelect(brand, "Brand", "No Brand", brandMap);
  buildSelect(status, "Status", "No Status", statusMap);
  buildSelect(shift, "Shift", "No Shift", shiftMap);
  buildSelect(violation, "Violation", "No Violation", violationMap);

  updateColor();
}

// LOAD EMPLOYEES - ALWAYS CHECKS FOR FILTERS
async function loadEmployees(
  filters = {},
  preservePage = false,
  silent = false,
) {
  try {
    if (!silent) showLoading(true);

    if (Object.keys(filters).length === 0 && hasActiveFilters()) {
      filters = getActiveFilters();
    }

    activeFilters = filters;

    const params = new URLSearchParams({ action: "get" });

    params.append("page", currentPage);
    params.append("limit", itemsPerPage);

    for (const [key, value] of Object.entries(filters)) {
      if (key === "position" && value === "__none__") {
        params.append("position_none", "1");
      } else if (key === "brand" && value === "__none__") {
        params.append("brand_none", "1");
      } else if (key === "status" && value === "__none__") {
        params.append("status_none", "1");
      } else if (key === "shift" && value === "__none__") {
        params.append("shift_none", "1");
      } else if (key === "violation" && value === "__none__") {
        params.append("violation_none", "1");
      } else {
        params.append(key, value);
      }
    }

    const response = await fetch(`manpower_backend.php?${params.toString()}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;
      totalPages = data.pages;
      totalRecords = data.total;

      if (Array.isArray(data.filter_options)) {
        allEmployees = data.filter_options;
        populateFilter(data.filter_options);
      }

      if (!preservePage && Object.keys(filters).length === 0) {
        currentPage = 1;
      }

      await renderEmployeeTable();
      await updateTotalEmployees();
      await updateActiveEmployees();
      updateDeleteButtonState();

      if (Object.keys(filters).length > 0) {
        displayFilterStatus();
      }
    } else {
      await renderEmployeeError("Network error. Please try again.");
      showAlert(data.message || "Error loading employees", "error");
    }
  } catch (error) {
    console.error("Error loading employees:", error);
    await renderEmployeeError("Network error. Please try again.");
    showAlert(
      "Failed to load employees. Please check your connection.",
      "error",
    );
  } finally {
    if (!silent) showLoading(false);
  }
}

// Close modal
function closeModal() {
  const employeeModal = document.getElementById("employeeModal");
  const deleteModal = document.getElementById("deleteModal");
  const importModal = document.getElementById("importModal");
  const logsModal = document.getElementById("logsModal");
  const violationModal = document.getElementById("violationsModal");
  if (
    !employeeModal ||
    !deleteModal ||
    !importModal ||
    !logsModal ||
    !violationModal
  )
    return;

  employeeModal.style.display = "none";
  deleteModal.style.display = "none";
  importModal.style.display = "none";
  logsModal.style.display = "none";
  violationModal.style.display = "none";

  const form = document.getElementById("employeeForm");
  if (form) form.reset();

  const fileLabel = document.querySelector(".file-upload-label");
  const imageInput = document.getElementById("image");

  if (fileLabel)
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
  if (imageInput) imageInput.value = "";
}

// ── Field error highlight ────────────────────────────────────────────────────
function markFieldError(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.style.borderColor = "#ef4444";
  el.style.boxShadow = "0 0 0 2px rgba(239,68,68,0.2)";
  el.addEventListener(
    "input",
    function clearErr() {
      el.style.borderColor = "";
      el.style.boxShadow = "";
      el.removeEventListener("input", clearErr);
    },
    { once: true },
  );
}

// Handle form submission
async function handleFormSubmit(e) {
  e.preventDefault();

  try {
    const empid = document.getElementById("employee_id").value.trim();
    const fullname = document.getElementById("fullname").value.trim();
    const position = document.getElementById("position").value.trim();
    const brand = document.getElementById("brand").value.trim();
    const shift = document.getElementById("shift").value;
    const originalId = document.getElementById("original_id").value.trim();

    if (!empid) {
      showAlert("EMPID is required", "error");
      return;
    }
    if (!fullname) {
      showAlert("Fullname is required", "error");
      return;
    }
    if (!position) {
      showAlert("Position is required", "error");
      return;
    }
    if (!brand) {
      showAlert("Brand is required", "error");
      return;
    }
    if (!shift) {
      showAlert("Shift is required", "error");
      return;
    }

    // ── Server-side uniqueness checks ─────────────────────────────────────
    // Check EMPID, Fullname, and Proximity Code against the full database,
    // not just the current page — avoids false negatives on paginated data.
    try {
      const checkRes = await fetch(
        `manpower_backend.php?action=get&page=1&limit=1` +
          `&id=${encodeURIComponent(empid)}`,
        {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-Silent-Request": "true",
          },
        },
      );
      const checkData = await checkRes.json();

      if (checkData.success && checkData.total > 0) {
        // Allow if editing the same record
        const conflict = checkData.data.find(
          (e) =>
            String(e.id) === String(empid) &&
            String(e.id) !== String(originalId),
        );
        if (conflict) {
          showAlert(
            `Employee ID "${escapeHtml(empid)}" is already in use.`,
            "error",
          );
          markFieldError("employee_id");
          document.getElementById("employee_id").focus();
          return;
        }
      }
    } catch (e) {
      console.warn("EMPID check failed, falling back to local check:", e);
      // Fallback to local check
      if (currentAction === "edit" && empid !== originalId) {
        const idTaken = employees.some(
          (emp) => String(emp.id) === String(empid),
        );
        if (idTaken) {
          showAlert(
            `Employee ID "${escapeHtml(empid)}" is already in use.`,
            "error",
          );
          markFieldError("employee_id");
          document.getElementById("employee_id").focus();
          return;
        }
      }
    }

    try {
      const nameRes = await fetch(
        `manpower_backend.php?action=get&page=1&limit=1` +
          `&fullname=${encodeURIComponent(fullname)}`,
        {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-Silent-Request": "true",
          },
        },
      );
      const nameData = await nameRes.json();

      if (nameData.success && nameData.total > 0) {
        const conflict = nameData.data.find(
          (e) =>
            e.fullname.toLowerCase().trim() === fullname.toLowerCase().trim() &&
            String(e.id) !== String(originalId),
        );
        if (conflict) {
          showAlert(
            `Employee "${escapeHtml(fullname)}" already exists.`,
            "error",
          );
          markFieldError("fullname");
          document.getElementById("fullname").focus();
          return;
        }
      }
    } catch (e) {
      console.warn("Fullname check failed, falling back to local check:", e);
      const isDuplicate = employees.some((emp) => {
        if (
          currentAction === "edit" &&
          originalId &&
          String(emp.id) === String(originalId)
        )
          return false;
        return (
          emp.fullname.toLowerCase().trim() === fullname.toLowerCase().trim()
        );
      });
      if (isDuplicate) {
        showAlert(
          `Employee "${escapeHtml(fullname)}" already exists.`,
          "error",
        );
        markFieldError("fullname");
        document.getElementById("fullname").focus();
        return;
      }
    }

    const qrCode = document.getElementById("qr_code").value.trim();
    if (qrCode) {
      try {
        const qrRes = await fetch(
          `manpower_backend.php?action=check_qr&qr_code=${encodeURIComponent(qrCode)}`,
          {
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              "X-Silent-Request": "true",
            },
          },
        );
        const qrData = await qrRes.json();

        if (qrData.success && qrData.exists) {
          // Allow if it belongs to the employee being edited
          if (String(qrData.data?.id) !== String(originalId)) {
            showAlert(
              `Proximity Code "${escapeHtml(qrCode)}" is already assigned to another employee.`,
              "error",
            );
            markFieldError("qr_code");
            document.getElementById("qr_code").focus();
            return;
          }
        }
      } catch (e) {
        console.warn("Proximity code check failed:", e);
      }
    }
    // ── End uniqueness checks ─────────────────────────────────────────────

    const imageInput = document.getElementById("image");
    if (imageInput.files.length > 0) {
      const file = imageInput.files[0];
      if (file.size > 5 * 1024 * 1024) {
        showAlert("Image file size must be less than 5MB", "error");
        return;
      }
      const allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
      ];
      if (!allowedTypes.includes(file.type)) {
        showAlert(
          "Only image files (JPEG, JPG, PNG, GIF, WebP) are allowed",
          "error",
        );
        return;
      }
    }

    showLoading(true);

    const formData = new FormData(e.target);
    formData.set("action", currentAction);
    formData.set("id", empid);

    if (currentAction === "edit") {
      formData.set("original_id", originalId);
    }

    const response = await fetch("manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success) {
      showAlert(
        data.message ||
          (currentAction === "add"
            ? "Employee added successfully!"
            : "Employee updated successfully!"),
        "success",
      );
      closeModal();

      const preservePage = currentAction === "edit";
      const filtersToUse = hasActiveFilters() ? getActiveFilters() : {};
      await loadEmployees(filtersToUse, preservePage, true);

      await updateTotalEmployees();
      await updateActiveEmployees();
    } else {
      showAlert(data.message || "Failed to save employee", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert(
      "Failed to save employee. Please check your connection.",
      "error",
    );
  } finally {
    showLoading(false);
  }
}

// ─────────────────────────────────────────────────────────────
// CLIENT-SIDE WEBP CONVERSION
// ─────────────────────────────────────────────────────────────
async function convertImageToWebP(file, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      URL.revokeObjectURL(objectUrl);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const webpName = file.name.replace(/\.[^.]+$/, ".webp");
            resolve(new File([blob], webpName, { type: "image/webp" }));
          } else {
            resolve(file);
          }
        },
        "image/webp",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

// ─────────────────────────────────────────────────────────────
// FILE UPLOAD HANDLER
// ─────────────────────────────────────────────────────────────
function setupFileUploadHandler() {
  const imageInput = document.getElementById("image");

  imageInput.addEventListener("change", async function (e) {
    const label = document.querySelector(".file-upload-label");

    if (e.target.files.length === 0) {
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    const file = imageInput.files[0];
    const maxSize = 5 * 1024 * 1024;

    if (file.size > maxSize) {
      showAlert("File size must be less than 5MB", "error");
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];
    if (!allowedTypes.includes(file.type)) {
      showAlert(
        "Only image files are allowed (JPEG, JPG, PNG, GIF, WebP)",
        "error",
      );
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    label.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        <i class="fas fa-spinner fa-spin" style="font-size:24px;color:#2196F3;"></i>
        <small style="color:#2196F3;">Converting to WebP…</small>
      </div>`;

    try {
      const webpFile = await convertImageToWebP(file);

      const dt = new DataTransfer();
      dt.items.add(webpFile);
      imageInput.files = dt.files;

      const reader = new FileReader();
      reader.onload = (event) => {
        const isConverted =
          webpFile.type === "image/webp" && file.type !== "image/webp";
        // SECURITY: src comes from FileReader result (blob URL) — safe
        // size is a number — safe
        label.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
            <img id="imagePreview" src="${event.target.result}" alt="New image preview" loading="lazy"
              style="max-width:100%;max-height:200px;border-radius:8px;object-fit:cover;
                     box-shadow:0 2px 8px rgba(0,0,0,0.15),0 0 0 2px #4CAF50;">
            <small style="color:#4CAF50;font-size:12px;font-weight:500;">
              ✓ ${isConverted ? "Converted to WebP" : "WebP ready"} · ${(webpFile.size / 1024).toFixed(0)} KB
            </small>
          </div>`;
      };
      reader.readAsDataURL(webpFile);
    } catch (err) {
      console.error("WebP conversion error:", err);
      showAlert("Error converting image. Please try again.", "error");
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
    }
  });
}

// Delete single employee
async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch("manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      await loadEmployees(activeFilters, true, true);
      await updateTotalEmployees();
      await updateActiveEmployees();
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to delete employee", "error");
  } finally {
    showLoading(false);
  }
}

// Delete all employees
async function deleteAllEmployees(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete_all");
    formData.append("id", employeeId);

    const response = await fetch("manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      currentPage = 1;
      clearSearch();
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Error:", error);

    currentPage = 1;
    clearSearch();

    if (error instanceof TypeError) {
      showAlert("Network error: Failed to connect to server", "error");
    } else if (error.message.includes("JSON")) {
      showAlert("Server returned invalid response", "error");
    } else {
      showAlert("Delete all employee data", "success");
    }
  } finally {
    showLoading(false);
  }
}

// Show alert message
function showAlert(message, type = "info") {
  const existingAlerts = document.querySelectorAll(".alert");
  existingAlerts.forEach((alert) => alert.remove());

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;

  // SECURITY: Use DOM methods instead of innerHTML for alert messages
  const msgSpan = document.createElement("span");
  // Use textContent so any HTML in message is rendered as plain text
  msgSpan.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText =
    "float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;";
  closeBtn.innerHTML = `<i class="fas fa-times"></i>`;
  closeBtn.onclick = () => alert.remove();

  alert.appendChild(msgSpan);
  alert.appendChild(closeBtn);

  document.body.insertBefore(alert, document.body.firstChild);

  setTimeout(() => {
    if (alert.parentElement) alert.remove();
  }, 5000);
}

// Show/hide loading state
function showLoading(show) {
  const body = document.body;
  if (show) {
    body.classList.add("loading");
  } else {
    body.classList.remove("loading");
  }
}
