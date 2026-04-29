// resource/js/proxcode.js --> proximity table

// Global variables
let currentAction = "add";
let employees = [];
let currentUserId = null; // Cache current user ID
let employeeDataCache = null; // Cache employee data from manpower_backend
let qrImageMapCache = null;
let systemQRCodesCache = null;

// Pagination variables
let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;

let currentAudio = null;

let activeFilters = {};

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
  return String(str).replace(/[^\s,\-]+/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
  });
}

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  loadCurrentUserId(); // Load and cache user ID first
  loadEmployees();
  updateDeleteButtonState();
  setupEventListeners();
  updateTotalAvailable(); // Update count on page load
});

// Load and cache current user ID
async function loadCurrentUserId() {
  try {
    const response = await fetch("proxcode_backend.php?action=user_info", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.data) {
        currentUserId = data.data.user_id || "default";
      }
    }
  } catch (error) {
    console.error("Error loading user ID:", error);
    currentUserId = "default";
  }
}

// ─────────────────────────────────────────────────────────────────
// FIX: Fetch ALL employee data from manpower_backend.php.
//
// The previous call used ?action=get with no limit, which caused
// manpower_backend.php to apply its default limit of 25.  Any
// employee whose QR code was not in the first 25 rows never
// matched a proxcode, so the row showed "Occupied" but had no
// image or EMPID.
//
// Fix: pass page=1&limit=999999 to retrieve every employee in one
// request.  The result is cached so subsequent calls are free.
// ─────────────────────────────────────────────────────────────────
async function getManpowerEmployeeData() {
  try {
    if (employeeDataCache) {
      return employeeDataCache;
    }

    const response = await fetch(
      "manpower_backend.php?action=get&page=1&limit=1",
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-Silent-Request": "true",
        },
      },
    );

    if (response.ok) {
      const data = await response.json();
      // filter_options is ALL rows (no pagination applied by backend)
      if (data.success && Array.isArray(data.filter_options)) {
        employeeDataCache = data.filter_options;
        console.log(
          `[proxcode] manpower cache loaded: ${data.filter_options.length} employees`,
        );
        return data.filter_options;
      }
    }
  } catch (error) {
    console.error("Error fetching manpower employee data:", error);
  }

  return [];
}

// Build a map of QR codes to employee images and details
async function buildQRToImageMap() {
  if (qrImageMapCache) return qrImageMapCache;

  const manpowerEmployees = await getManpowerEmployeeData();
  const qrImageMap = {};

  manpowerEmployees.forEach((emp) => {
    if (emp.qr_code) {
      qrImageMap[emp.qr_code.trim().toLowerCase()] = {
        image: emp.image,
        id: emp.id,
        fullname: emp.fullname,
        position: emp.position,
        brand: emp.brand,
        status: emp.status,
        shift: emp.shift,
      };
    }
  });

  qrImageMapCache = qrImageMap;
  return qrImageMap;
}

// Returns the set of QR codes currently assigned to employees.
// Reuses the fully-loaded manpower cache (no separate fetch needed).
async function getSystemEmployeeQRCodes() {
  const manpowerEmployees = await getManpowerEmployeeData();
  return manpowerEmployees
    .map((emp) => emp.qr_code)
    .filter((qr) => qr)
    .map((qr) => qr.trim().toLowerCase());
}

// Count and display available / occupied QR codes
async function updateTotalAvailable() {
  try {
    const qrImageMap = await buildQRToImageMap();
    const occupiedCount = employees.filter(
      (emp) =>
        emp.qr_code &&
        Object.prototype.hasOwnProperty.call(
          qrImageMap,
          String(emp.qr_code).trim().toLowerCase(),
        ),
    ).length;

    const availableCount = employees.length - occupiedCount;

    const totalAvailableElement = document.getElementById("total_available");
    const totalOccupiedElement = document.getElementById("total_occupied");

    if (totalAvailableElement)
      totalAvailableElement.textContent = availableCount;
    if (totalOccupiedElement) totalOccupiedElement.textContent = occupiedCount;
  } catch (error) {
    console.error("Error updating total available:", error);
  }
}

// Update total employees count
async function updateTotalEmployees() {
  try {
    const el = document.getElementById("total_employees");
    if (el) el.textContent = employees.length;
  } catch (error) {
    console.error("Error updating total employees:", error);
  }
}

// Setup event listeners
function setupEventListeners() {
  const form = document.getElementById("employeeForm");
  if (form) {
    form.addEventListener("submit", handleFormSubmit);
  }

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

  const isActiveToggle = document.getElementById("is_active_toggle");
  if (isActiveToggle) {
    isActiveToggle.addEventListener("change", function () {
      const hiddenInput = document.getElementById("is_active");
      const statusLabel = document.getElementById("statusLabel");
      hiddenInput.value = this.checked ? "1" : "0";
      statusLabel.textContent = this.checked ? "Enabled" : "Disabled";
      statusLabel.style.color = this.checked ? "#16a34a" : "#b91c1c";
    });
  }

  autoFocusProximity();
  document.addEventListener("click", autoFocusProximity);
  document.addEventListener("focusin", autoFocusProximity);
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
  return Object.keys(getActiveFilters()).length > 0;
}

// DISPLAY FILTER STATUS IN UI
function displayFilterStatus() {
  const filters = getActiveFilters();

  const existingStatus = document.getElementById("filter-status");
  if (existingStatus) existingStatus.remove();

  if (Object.keys(filters).length === 0) return;

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
  textSpan.appendChild(document.createTextNode("Active Filters: "));

  Object.entries(filters).forEach(([key, value], index) => {
    if (index > 0) textSpan.appendChild(document.createTextNode(" | "));

    const strong = document.createElement("strong");
    const properKey = key
      .split(/(?=[A-Z])/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
    strong.textContent = `${properKey}:`;
    textSpan.appendChild(strong);
    textSpan.appendChild(document.createTextNode(` ${value}`));
  });

  filterLabel.appendChild(textSpan);
  filterInfo.appendChild(filterLabel);

  const controlsDiv = document.querySelector(".controls");
  if (controlsDiv) controlsDiv.appendChild(filterInfo);
}

// Load proximity code for editing
async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `proxcode_backend.php?action=get_single&id=${employeeId}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-Silent-Request": "true",
        },
      },
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && data.data) {
      const employee = data.data;

      document.getElementById("employee_id").value = employee.id || "";
      document.getElementById("qr_code").value = employee.qr_code || "";

      const isActive =
        employee.is_active !== undefined ? parseInt(employee.is_active) : 1;
      const toggle = document.getElementById("is_active_toggle");
      const hiddenInput = document.getElementById("is_active");
      const statusLabel = document.getElementById("statusLabel");

      if (toggle && hiddenInput && statusLabel) {
        toggle.checked = isActive === 1;
        hiddenInput.value = isActive;
        statusLabel.textContent = isActive === 1 ? "Enabled" : "Disabled";
        statusLabel.style.color = isActive === 1 ? "#16a34a" : "#b91c1c";
      }

      const fileLabel = document.querySelector(".file-upload-label");
      if (fileLabel) {
        fileLabel.innerHTML = employee.image
          ? `<i class="fas fa-image"></i> Current: ${escapeHtml(employee.image)}`
          : `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      }
    } else {
      showAlert(data.message || "Failed to load proximity code", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to load proximity code", "error");
  }
}

async function renderEmployeeError(message = "Failed to load employee data.") {
  const tbody = document.getElementById("employeeTableBody");
  const pagination = document.getElementById("pagination");
  const noData = document.getElementById("no-data");

  if (!tbody) return;

  if (!employees || employees.length === 0) {
    tbody.innerHTML = "";
    if (pagination) pagination.style.display = "none";
    if (noData) noData.style.display = "block";
    return;
  }

  if (noData) noData.style.display = "none";

  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align:center;padding:20px;color:#c0392b;">
        ⚠️ ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

// Render proximity code table with QR matching logic AND employee image display
async function renderEmployeeTable() {
  const tbody = document.getElementById("employeeTableBody");
  const pagination = document.getElementById("pagination");
  const noData = document.getElementById("no-data");

  if (!tbody || !pagination || !noData) {
    console.error("Table elements not found");
    return;
  }

  if (employees.length === 0) {
    tbody.innerHTML = "";
    pagination.style.display = "none";
    noData.style.display = "block";
    return;
  }

  noData.style.display = "none";

  totalPages = Math.ceil(employees.length / itemsPerPage);
  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentEmployees = employees.slice(startIndex, endIndex);

  // Fetch the full employee list (cached after first call)
  const qrImageMap = await buildQRToImageMap();

  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      const qrLower = employee.qr_code.trim().toLowerCase();
      const isOccupied = Object.prototype.hasOwnProperty.call(
        qrImageMap,
        qrLower,
      );

      const displayRemarks = isOccupied ? "Occupied" : "Available";
      const matchedEmployeeData = qrImageMap[qrLower] || null;

      let imageUrl = null;
      let displayName = employee.qr_code;

      if (matchedEmployeeData && matchedEmployeeData.image) {
        imageUrl = `${window.location.origin}/../public/uploads/user/${matchedEmployeeData.image}`;
        displayName = matchedEmployeeData.fullname || employee.qr_code;
      } else if (employee.image) {
        imageUrl = `${window.location.origin}/../public/uploads/user/${employee.image}`;
      }

      const displayInitials = (displayName || "UN")
        .split(" ")
        .map((n) => n.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const tooltipText = matchedEmployeeData
        ? `${toProperCase(matchedEmployeeData.fullname)}\n${toProperCase(matchedEmployeeData.position)}\n${toProperCase(matchedEmployeeData.brand)}`
        : "No matched employee";

      const empid = matchedEmployeeData ? String(matchedEmployeeData.id) : "";

      // Safe values for HTML attributes
      const safeQr = escapeHtml(employee.qr_code);
      const safeName = escapeHtml(displayName);
      const safeTooltip = escapeHtml(tooltipText);

      return `
        <tr>
          <td>${startIndex + index + 1}</td>
          <td class="Col8">
            ${
              imageUrl
                ? `<img src="${imageUrl}" alt="${safeName}" class="employee-image" loading="lazy"
                    title="${safeTooltip}"
                    onerror="this.onerror=null;this.style.display='none';this.parentElement.querySelector('.employee-ph-fallback').style.display='flex';">
                  <div class="employee-ph-fallback ph-cont" style="display:none;" title="${safeTooltip}">
                    <div class="employee-ph">${escapeHtml(displayInitials)}</div>
                  </div>`
                : `<div class="ph-cont" title="${safeTooltip}"><div class="employee-ph">${escapeHtml(displayInitials)}</div></div>`
            }
          </td>
          <td class="Col9"
              data-qr="${safeQr}"
              onclick="copyQRCodeFromCell(this)"
              title="Copy Proximity code"
              style="cursor:pointer;">
            <img src="../../resource/assets/icon/nfc-icon.svg" alt="Copy Proximity code" loading="lazy" style="width:20px;height:20px;">
          </td>
          <td>
            <div><span class="remarks-${displayRemarks.toLowerCase()}">${displayRemarks}</span></div>
            ${empid ? `<div class="emp-id"><strong>EMPID: ${escapeHtml(empid)}</strong></div>` : ""}
          </td>
          <td>
            <span class="status-${employee.is_active == 1 ? "enabled" : "disabled"}">
              ${employee.is_active == 1 ? "Enabled" : "Disabled"}
            </span>
          </td>
          <td><small>${escapeHtml(employee.created_at || "")}</small></td>
          <td><small>${escapeHtml(employee.updated_at || "")}</small></td>

          ${(window.PERMISSIONS.edit || window.PERMISSIONS.delete) ? `
          <td style="position: relative; width: 160px;">

            <!-- ACTIONS TOGGLE -->
            <button
              onclick="toggleActionsPanel(this)"
              class="actions-toggle-btn"
              style="
                width:100%;padding:6px 12px;font-size:12px;font-weight:700;
                letter-spacing:1px;border:1.5px solid #cbd5e1;border-radius:10px;
                background:#fff;color:#1e293b;cursor:pointer;
                box-shadow:0 1px 4px rgba(0,0,0,0.08);white-space:nowrap;
              ">
              ACTIONS
            </button>

            <!-- FLOATING PANEL -->
            <div class="actions-panel">
              <small style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);text-align:center;color:#fff;">
                ${escapeHtml(toProperCase(matchedEmployeeData?.fullname || "Row SN: " + (startIndex + index + 1)))}
              </small>

              ${window.PERMISSIONS.edit ? `
              <!-- EDIT -->
              <button
                data-emp-id="${escapeHtml(String(employee.id))}"
                onclick="openEditFromBtn(this)"
                style="width:100%;padding:7px;font-size:12px;font-weight:700;
                  background:#fff;color:#6366f1;border:none;
                  border-bottom:1px solid #e2e8f0;cursor:pointer;text-align:center;">
                <i class="fas fa-edit"></i> EDIT
              </button>
              ` : ''}

              ${window.PERMISSIONS.delete ? `
              <!-- DELETE -->
              <button
                data-emp-id="${escapeHtml(String(employee.id))}"
                onclick="openDeleteFromBtn(this)"
                style="width:100%;padding:7px;font-size:12px;font-weight:700;
                  background:#fff;color:#ef4444;border:none;cursor:pointer;text-align:center;">
                <i class="fas fa-trash-alt"></i> DELETE
              </button>
              ` : ''}

            </div>
          </td>
          ` : ''}
        </tr>
      `;
    })
    .join("");

  updatePaginationControls();
  await updateTotalAvailable();
}

// ─────────────────────────────────────────────────────────────────
// SECURITY: data-attribute bridge functions
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

function openEditFromBtn(btn) {
  openModal("edit", parseInt(btn.dataset.empId, 10));
}

function openDeleteFromBtn(btn) {
  // dataset.empId stores the employee row id (set as safeQr in the template above,
  // but we actually need the numeric id — fixed below in renderEmployeeTable)
  openDeleteModal(btn.dataset.empId, false);
}

function copyQRCodeFromCell(td) {
  copyQRCode(td.dataset.qr);
}

function copyQRCode(code) {
  const tempTextArea = document.createElement("textarea");
  tempTextArea.value = code;
  tempTextArea.style.cssText = "position:fixed;opacity:0;";
  document.body.appendChild(tempTextArea);

  try {
    tempTextArea.select();
    tempTextArea.setSelectionRange(0, 99999);

    if (document.execCommand("copy")) {
      showAlert("Proximity code copied to clipboard!");
    } else {
      throw new Error("execCommand failed");
    }
  } catch (err) {
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(code)
        .then(() => showAlert("Proximity code copied to clipboard!"))
        .catch(() => showAlert("Failed to copy Proximity code", "error"));
    } else {
      showAlert("Failed to copy Proximity code", "error");
    }
  } finally {
    document.body.removeChild(tempTextArea);
  }
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
  const range = new Set([1, totalPages]);
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
    <span id="page-info">${employees.length} total &nbsp;|&nbsp; Page ${currentPage} of ${totalPages}</span>
  `;
}

function previousPage() {
  if (currentPage > 1) {
    currentPage--;
    renderEmployeeTable();
  }
}

function nextPage() {
  if (currentPage < totalPages) {
    currentPage++;
    renderEmployeeTable();
  }
}

function goToPage(page) {
  if (page >= 1 && page <= totalPages) {
    currentPage = page;
    renderEmployeeTable();
  }
}

// SEARCH EMPLOYEES
function searchEmployees() {
  const searchForm = document.getElementById("searchForm");
  const searchQuery = document.getElementById("search_qr").value.trim();

  if (!searchForm) return;

  const filters = getActiveFilters();
  loadEmployees(filters, true, true);

  if (searchQuery) document.getElementById("search_qr").value = "";

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
  loadEmployees({}, false, true);
  updateDeleteButtonState();
}

function clearDateFilter() {
  const dateInput = document.getElementById("search_date");
  const clearBtn = document.getElementById("clear_date_btn");
  if (dateInput) dateInput.value = "";
  if (clearBtn) clearBtn.style.display = "none";
  searchEmployees();
}

// OPEN MODAL
async function openModal(action, employeeId = null) {
  currentAction = action;
  const modal = document.getElementById("employeeModal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("employeeForm");
  const qrCodeInput = document.getElementById("qr_code");

  if (!modal || !modalTitle || !form) return;

  form.reset();
  const employeeIdInput = document.getElementById("employee_id");
  if (employeeIdInput) employeeIdInput.value = "";

  const fileLabel = document.querySelector(".file-upload-label");
  if (fileLabel && action === "add") {
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
  }

  if (action === "add") {
    modalTitle.innerHTML = "Add Proximity Code";
    const statusGroup = document.getElementById("statusToggleGroup");
    if (statusGroup) statusGroup.style.display = "none";
  } else if (action === "edit" && employeeId) {
    modalTitle.innerHTML = `<i class="fas fa-edit" style="color:#7c3aed"></i> Edit Proximity`;
    const statusGroup = document.getElementById("statusToggleGroup");
    if (statusGroup) statusGroup.style.display = "block";
    await loadEmployeeData(employeeId);
  }

  modal.style.display = "block";
  if (action === "add") qrCodeInput.focus();
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
      modalTitle.textContent = "⚠️ Delete Filtered Proximity Codes";

      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will delete ${employees.length} code(s) matching your filters:`;
      p1.appendChild(strong);
      msgDiv.appendChild(p1);

      const filterBox = document.createElement("div");
      filterBox.style.cssText =
        "background:#fff3cd;border:1px solid #ffeaa7;padding:12px;border-radius:4px;margin-bottom:15px;";

      Object.entries(getActiveFilters()).forEach(([key, value]) => {
        const row = document.createElement("div");
        row.style.margin = "5px 0";
        const keyStrong = document.createElement("strong");
        keyStrong.textContent = key + ":";
        row.appendChild(keyStrong);
        row.appendChild(document.createTextNode(" " + value));
        filterBox.appendChild(row);
      });

      msgDiv.appendChild(filterBox);
      const p2 = document.createElement("p");
      p2.style.cssText = "color:#d63031;font-weight:bold;";
      p2.textContent = "This action cannot be undone.";
      msgDiv.appendChild(p2);

      modalMessage.innerHTML = "";
      modalMessage.appendChild(msgDiv);
    } else {
      modalTitle.textContent = "⚠️ Delete All Proximity Codes";

      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will permanently delete ALL ${employees.length} code(s).`;
      p1.appendChild(strong);
      msgDiv.appendChild(p1);
      const p2 = document.createElement("p");
      p2.style.cssText = "color:#d63031;font-weight:bold;";
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
    modalTitle.textContent = "Delete Proximity Code";
    modalMessage.textContent =
      "Are you sure you want to delete this proximity code?";
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
    const newInput = confirmationInput.cloneNode(true);
    confirmationInput.parentNode.replaceChild(newInput, confirmationInput);
    newInput.focus();

    newInput.addEventListener("input", () => {
      newConfirmBtn.disabled = newInput.value !== "DELETE ALL";
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
      if (hasFiltersFlag) deleteFilteredEmployees();
      else showAlert("Cannot be Deleted! Try changing filters.", "error");
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

// UPDATE DELETE BUTTON STATE
function updateDeleteButtonState() {
  const deleteBtn = document.querySelector(".delete-all-btn .btn-danger");
  if (!deleteBtn) return;

  const hasFilters = hasActiveFilters();
  deleteBtn.disabled = !hasFilters;
  deleteBtn.style.opacity = hasFilters ? "1" : "0.4";
  deleteBtn.style.cursor = hasFilters ? "pointer" : "not-allowed";
  deleteBtn.title = hasFilters
    ? "Delete filtered proximity codes"
    : "Apply filters first to enable deletion";
}

// DELETE FILTERED PROXIMITY CODES
async function deleteFilteredEmployees() {
  try {
    showLoading(true);

    const employeeIds = employees.map((emp) => emp.id);
    const currentFilters = getActiveFilters();

    if (employeeIds.length === 0) {
      showAlert("No proximity codes to delete", "warning");
      return;
    }

    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(employeeIds));
    formData.append("filters", JSON.stringify(currentFilters));

    const response = await fetch("proxcode_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success) {
      showAlert(
        `Successfully deleted ${data.deleted_count || employeeIds.length} code(s) matching your filters.`,
        "success",
      );
      currentPage = 1;
      clearSearch();
    } else {
      showAlert(
        data.message || "Failed to delete filtered proximity codes",
        "error",
      );
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to delete filtered proximity codes", "error");
  } finally {
    showLoading(false);
  }
}

function updateSelectColor(select) {
  if (!select) return;
  select.style.color = select.selectedIndex === 0 ? "#999" : "#000";
  [...select.options].forEach((opt) => {
    opt.style.color = "#000";
  });
}

function updateColor() {
  updateSelectColor(document.getElementById("search_remarks"));
}

async function populateFilter(employeeList) {
  const remarks = document.getElementById("search_remarks");
  if (!remarks) return;

  const qrImageMap = await buildQRToImageMap();

  const remarksSet = new Set();
  for (const emp of employeeList) {
    const isOccupied = Object.prototype.hasOwnProperty.call(
      qrImageMap,
      String(emp.qr_code).trim().toLowerCase(),
    );
    remarksSet.add(isOccupied ? "Occupied" : "Available");
  }

  function buildSelect(select, placeholder, noneLabel, values) {
    const current = select.value;
    select.innerHTML =
      `<option value="" disabled selected hidden>${placeholder}</option>` +
      `<option value="">Default: ALL</option>` +
      `<option value="__none__">${noneLabel}</option>`;

    if (values.size > 0) {
      select.innerHTML += "<option disabled>──────────</option>";
      [...values].sort().forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      });
    }

    if (current && [...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  }

  buildSelect(remarks, "Remarks", "No Remarks", remarksSet);
  updateColor();
}

// LOAD EMPLOYEES
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

    // Strip 'remarks' before sending to backend — it's a computed field, not a DB column
    const { remarks: remarksFilter, ...backendFilters } = filters;

    const params = new URLSearchParams({ action: "get", ...backendFilters });

    const response = await fetch(`proxcode_backend.php?${params.toString()}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;

      populateFilter(employees);

      // Apply remarks filter client-side (computed field, not stored in DB)
      if (remarksFilter) {
        const qrImageMap = await buildQRToImageMap();
        employees = employees.filter((emp) => {
          const isOccupied = Object.prototype.hasOwnProperty.call(
            qrImageMap,
            String(emp.qr_code).trim().toLowerCase(),
          );
          const displayRemarks = isOccupied ? "Occupied" : "Available";
          return displayRemarks.toLowerCase() === remarksFilter.toLowerCase();
        });
      }

      if (!preservePage && Object.keys(filters).length === 0) {
        currentPage = 1;
      }

      await renderEmployeeTable();
      await updateTotalEmployees();

      if (Object.keys(filters).length > 0) displayFilterStatus();
    } else {
      await renderEmployeeError("Network error. Please try again.");
      showAlert(data.message || "Error loading proximity codes", "error");
    }
  } catch (error) {
    console.error("Error loading employees:", error);
    await renderEmployeeError("Network error. Please try again.");
    showAlert(
      "Failed to load proximity codes. Please check your connection.",
      "error",
    );
  } finally {
    if (!silent) showLoading(false);
  }
}

// CLOSE MODAL
function closeModal() {
  ["employeeModal", "deleteModal", "importModal"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const form = document.getElementById("employeeForm");
  if (form) form.reset();
}

// HANDLE FORM SUBMISSION
async function handleFormSubmit(e) {
  e.preventDefault();

  try {
    const employeeIdField = document.getElementById("employee_id");
    const qrCodeField = document.getElementById("qr_code");

    if (!qrCodeField) {
      showAlert("Form field 'qr_code' not found", "error");
      return;
    }

    const employeeId = employeeIdField?.value || "";
    const qrCode = qrCodeField.value.trim();

    if (!qrCode) {
      showAlert("Please enter a Proximity code", "error");
      return;
    }

    const isDuplicate = employees.some((emp) => {
      if (currentAction === "edit" && employeeId && emp.id == employeeId)
        return false;
      return emp.qr_code.toLowerCase().trim() === qrCode.toLowerCase();
    });

    if (isDuplicate) {
      showAlert(
        `Proximity code "${escapeHtml(qrCode)}" already exists!`,
        "error",
      );
      return;
    }

    showLoading(true);

    const formData = new FormData(e.target);
    formData.append("action", currentAction);

    const response = await fetch("proxcode_backend.php", {
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
            ? "Proximity code added successfully!"
            : "Proximity code updated successfully!"),
        "success",
      );
      closeModal();

      // Invalidate manpower cache so new assignments are reflected immediately
      employeeDataCache = null;
      qrImageMapCache = null;

      const preservePage = currentAction === "edit";
      const filtersToUse = hasActiveFilters() ? getActiveFilters() : {};
      await loadEmployees(filtersToUse, preservePage, true);
      await updateTotalEmployees();
      await updateTotalAvailable();
    } else {
      showAlert(data.message || "Failed to save proximity code", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert(
      "Failed to save proximity code. Please check your connection.",
      "error",
    );
  } finally {
    showLoading(false);
  }
}

function setupFileUploadHandler() {
  const imageInput = document.getElementById("image");
  if (!imageInput) return;

  imageInput.addEventListener("change", function (e) {
    const label = document.querySelector(".file-upload-label");
    if (!label) return;

    if (e.target.files.length === 0) {
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    const file = e.target.files[0];
    const maxSize = 5 * 1024 * 1024;
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (file.size > maxSize) {
      showAlert("File size must be less than 5MB", "error");
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    if (!allowedTypes.includes(file.type)) {
      showAlert("Only image files are allowed", "error");
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    label.innerHTML = `<i class="fas fa-image"></i> ${escapeHtml(file.name)}`;
  });
}

// DELETE SINGLE PROXIMITY CODE
async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch("proxcode_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      employeeDataCache = null;
      qrImageMapCache = null;
      await loadEmployees(activeFilters, true, true);
      await updateTotalEmployees();
    } else {
      showAlert(data.message || "Failed to delete proximity code", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to delete proximity code", "error");
  } finally {
    showLoading(false);
  }
}

// DELETE ALL PROXIMITY CODES
async function deleteAllEmployees(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete_all");
    formData.append("id", employeeId);

    const response = await fetch("proxcode_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      employeeDataCache = null;
      qrImageMapCache = null;
      currentPage = 1;
      clearSearch();
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Delete all proximity code data", "success");
    currentPage = 1;
    clearSearch();
  } finally {
    showLoading(false);
  }
}

// SHOW ALERT
function showAlert(message, type = "info") {
  document.querySelectorAll(".alert").forEach((a) => a.remove());

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText =
    "float:right;background:none;border:none;font-size:18px;cursor:pointer;margin-left:5px;";
  closeBtn.innerHTML = `<i class="fas fa-times"></i>`;
  closeBtn.onclick = () => alert.remove();

  alert.appendChild(msgSpan);
  alert.appendChild(closeBtn);
  document.body.insertBefore(alert, document.body.firstChild);

  setTimeout(() => {
    if (alert.parentElement) alert.remove();
  }, 5000);
}

// SHOW/HIDE LOADING
function showLoading(show) {
  document.body.classList[show ? "add" : "remove"]("loading");
}

// Close modal when clicking outside
window.onclick = function (event) {
  const modal = document.getElementById("employeeModal");
  if (event.target === modal) closeModal();
};
