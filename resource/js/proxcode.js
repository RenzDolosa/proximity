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

// 🆕 FILTER STATE - Track active filters
let activeFilters = {};

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  loadCurrentUserId(); // Load and cache user ID first
  loadEmployees();
  updateDeleteButtonState();
  setupEventListeners();
  updateTotalAvailable(); // 🆕 Update count on page load
  fetchWithUserRefresh();
});

// Load and cache current user ID
async function loadCurrentUserId() {
  try {
    const response = await fetch(
      "proxcode_backend.php?action=user_info",
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

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

// 🆕 Fetch employee data from manpower_backend.php and cache it
async function getManpowerEmployeeData() {
  try {
    // Return cached data if available
    if (employeeDataCache) {
      return employeeDataCache;
    }

    const response = await fetch("manpower_backend.php?action=get", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        // Cache the employee data
        employeeDataCache = data.data;
        return data.data;
      }
    }
  } catch (error) {
    console.error("Error fetching manpower employee data:", error);
  }

  return [];
}

// 🆕 Build a map of QR codes to employee images and details
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

  qrImageMapCache = qrImageMap; // ← Cache it
  return qrImageMap;
}

async function getSystemEmployeeQRCodes() {
  // Reuse manpower cache
  const manpowerEmployees = await getManpowerEmployeeData();
  return manpowerEmployees
    .map((emp) => emp.qr_code)
    .filter((qr) => qr)
    .map((qr) => qr.trim().toLowerCase());
}

// 🆕 Count and display available QR codes
async function updateTotalAvailable() {
  try {
    // Fetch system.js employee QR codes
    const systemQRCodes = await getSystemEmployeeQRCodes();

    // Normalize system QR codes for comparison
    const normalizedSystemQRCodes = systemQRCodes.map((code) =>
      String(code).trim().toLowerCase(),
    );

    // Count QR codes that ARE in system.js (occupied)
    const occupiedCount = employees.filter(
      (emp) =>
        emp.qr_code &&
        normalizedSystemQRCodes.includes(
          String(emp.qr_code).trim().toLowerCase(),
        ),
    ).length;

    // Available = total employees - occupied
    const availableCount = employees.length - occupiedCount;

    // Update the DOM elements
    const totalAvailableElement = document.getElementById("total_available");
    const totalOccupiedElement = document.getElementById("total_occupied");

    if (totalAvailableElement && totalOccupiedElement) {
      totalAvailableElement.textContent = availableCount;
      totalOccupiedElement.textContent = occupiedCount;
    }
  } catch (error) {
    console.error("Error updating total available:", error);
  }
}

// 🆕 Update total employees count
async function updateTotalEmployees() {
  try {
    const totalEmployeesElement = document.getElementById("total_employees");

    if (totalEmployeesElement) {
      // Update with current employees array length
      totalEmployeesElement.textContent = employees.length;
      console.log("Total employees updated:", employees.length);
    }
  } catch (error) {
    console.error("Error updating total employees:", error);
  }
}

// Setup event listeners
function setupEventListeners() {
  // Form submission
  const form = document.getElementById("employeeForm");
  if (form) {
    form.addEventListener("submit", handleFormSubmit);
  }

  // File upload handler
  setupFileUploadHandler();

  // Search form inputs
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

// 🆕 GET CURRENT ACTIVE FILTERS FROM FORM
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

// 🆕 CHECK IF ANY FILTERS ARE ACTIVE
function hasActiveFilters() {
  const filters = getActiveFilters();
  return Object.keys(filters).length > 0;
}

// 🆕 DISPLAY FILTER STATUS IN UI
function displayFilterStatus() {
  const filters = getActiveFilters();
  const filterInfo = document.createElement("div");

  // Remove existing filter status if any
  const existingStatus = document.getElementById("filter-status");
  if (existingStatus) {
    existingStatus.remove();
  }

  if (Object.keys(filters).length > 0) {
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

    // Create a container for the icon and text
    const filterLabel = document.createElement("span");
    filterLabel.style.display = "inline-flex";
    filterLabel.style.alignItems = "center";
    filterLabel.style.gap = "8px";

    // Create and add the icon element
    const icon = document.createElement("i");
    icon.className = "fas fa-filter";
    filterLabel.appendChild(icon);

    // Add the text content
    const textSpan = document.createElement("span");
    textSpan.appendChild(document.createTextNode("Active Filters: "));

    // Build filter parts with proper strong elements and proper text formatting
    const filterEntries = Object.entries(filters);
    filterEntries.forEach(([key, value], index) => {
      if (index > 0) {
        textSpan.appendChild(document.createTextNode(" | "));
      }

      // Create strong element for the key
      const strong = document.createElement("strong");
      // Convert key to proper case (capitalize first letter of each word)
      const properKey = key
        .split(/(?=[A-Z])/) // Split on capital letters
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
      strong.textContent = `${properKey}:`;
      textSpan.appendChild(strong);

      // Add the value
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

// Load proximity code for editing
async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `proxcode_backend.php?action=get_single&id=${employeeId}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && data.data) {
      const employee = data.data;

      document.getElementById("employee_id").value = employee.id || "";
      document.getElementById("qr_code").value = employee.qr_code || "";

      const fileLabel = document.querySelector(".file-upload-label");
      if (fileLabel) {
        if (employee.image) {
          fileLabel.innerHTML = `<i class="fas fa-image"></i> Current: ${employee.image}`;
        } else {
          fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
        }
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

  tbody.innerHTML = `
    <tr>
      <td colspan="13" style="text-align: center; padding: 20px; color: #c0392b;">
        ⚠️ ${message}
      </td>
    </tr>
  `;
}

// 🆕 ENHANCED Render proximity code table with QR matching logic AND employee image display
async function renderEmployeeTable() {
  const tbody = document.getElementById("employeeTableBody");
  const paginationDiv = document.getElementById("pagination");
  const noDataDiv = document.getElementById("no-data");

  if (!tbody || !paginationDiv || !noDataDiv) {
    console.error("Table elements not found");
    return;
  }

  if (employees.length === 0) {
    tbody.innerHTML = "";
    paginationDiv.style.display = "none";
    noDataDiv.style.display = "block";
    return;
  }

  noDataDiv.style.display = "none";

  // Calculate pagination
  totalPages = Math.ceil(employees.length / itemsPerPage);

  // Ensure currentPage is within valid range
  if (currentPage > totalPages && totalPages > 0) {
    currentPage = totalPages;
  }
  if (currentPage < 1) {
    currentPage = 1;
  }

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentEmployees = employees.slice(startIndex, endIndex);

  // Use cached user ID
  const userId = currentUserId || "default";

  // 🆕 Fetch system.js employee QR codes to match against
  const systemQRCodes = await getSystemEmployeeQRCodes();

  // 🆕 Build QR to image map from manpower_backend
  const qrImageMap = await buildQRToImageMap();

  // Render table rows
  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      // 🆕 Check if this proxcode's QR matches any system.js employee QR code
      const isOccupied = systemQRCodes.includes(
        employee.qr_code.trim().toLowerCase(),
      );

      // 🆕 Update proximity remarks dynamically (without backend change)
      const displayRemarks = isOccupied ? "Occupied" : "Available";

      // 🆕 Get matched employee data from manpower_backend
      const matchedEmployeeData =
        qrImageMap[employee.qr_code.trim().toLowerCase()];

      // Determine which image to display
      let imageUrl = null;
      let displayName = employee.qr_code;

      if (matchedEmployeeData && matchedEmployeeData.image) {
        // Use image from manpower_backend if QR matches
        imageUrl = `${window.location.origin}/../public/uploads/user/${matchedEmployeeData.image}`; // imageUrl = `../../uploads/user_${userId}/${matchedEmployeeData.image}`;
        displayName = matchedEmployeeData.fullname || employee.qr_code;
      } else if (employee.image) {
        // Fallback to proxcode's own image
        imageUrl = `${window.location.origin}/../public/uploads/user/${employee.image}`; // imageUrl = `../../uploads/user_${userId}/${employee.image}`;
      }

      // Generate initials for placeholder
      const displayInitials = (displayName || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      // Additional employee info to display in tooltip
      const tooltipText = matchedEmployeeData
        ? `${matchedEmployeeData.fullname}\n${matchedEmployeeData.position}\n${matchedEmployeeData.brand}`
        : "No matched employee";

      const empid = matchedEmployeeData ? `${matchedEmployeeData.id}` : "";

      return `
        <tr>
            <td>${startIndex + index + 1}</td>
            <td class="Col8">
              ${
                imageUrl
                  ? `<img src="${imageUrl}" alt="${displayName}" class="employee-image" loading="lazy"
                    title="${tooltipText}" 
                    onerror="this.style.display='none'; this.nextSibling.style.display='inline';">
                    <span style="display:none;" title="${tooltipText}">📷</span>`
                  : `<div class="ph-cont" title="${tooltipText}"><div class="employee-ph">${displayInitials}</div></div>`
              }
            </td>
            <td><strong>${empid}</strong></td>
            <td class="Col9" onclick="copyQRCode('${escapeHtml(employee.qr_code)}')" title="Copy Proximity code" style="cursor: pointer;">
              <img src="../../resource/assets/icon/nfc-icon.svg" alt="Copy Proximity code" loading="lazy" style="width: 20px; height: 20px;">
            </td>
            <td><span class="remarks-${displayRemarks.toLowerCase()}">${displayRemarks}</span></td>
            <td><small>${employee.created_at || ""}</small></td>
            <td><small>${employee.updated_at || ""}</small></td>
            <td style="position: relative; width: 160px;">

              <!-- ACTIONS TOGGLE -->
              <button
                onclick="
                  const panel = this.parentElement.querySelector('.actions-panel');
                  const allPanels = document.querySelectorAll('.actions-panel');
                  const allBtns = document.querySelectorAll('.actions-toggle-btn');

                  // Close all other open panels first
                  allPanels.forEach(p => { if (p !== panel) p.classList.remove('actions-open'); });
                  allBtns.forEach(b => { if (b !== this) b.classList.remove('actions-active'); });

                  // Toggle current
                  panel.classList.toggle('actions-open');
                  this.classList.toggle('actions-active');
                "
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

              <!-- FLOATING PANEL (positioned relative to td/tr) -->
              <div class="actions-panel">

                <!-- EDIT -->
                <button
                  onclick="openModal('edit', ${employee.id})"
                  style="
                    width:100%; padding: 7px;
                    font-size: 12px; font-weight: 700;
                    background: #fff; color: #6366f1;
                    border: none; border-bottom: 1px solid #e2e8f0;
                    cursor: pointer; text-align: center;
                  ">
                  <i class="fas fa-edit"></i> EDIT
                </button>

                <!-- DELETE -->
                <button
                  onclick="openDeleteModal('${employee.id}', false)"
                  style="
                    width:100%; padding: 7px;
                    font-size: 12px; font-weight: 700;
                    background: #fff; color: #ef4444;
                    border: none;
                    cursor: pointer; text-align: center;
                  ">
                  <i class="fas fa-trash-alt"></i> DELETE
                </button>

              </div>
            </td>
        </tr>
      `;
    })
    .join("");

  // Update pagination controls
  updatePaginationControls();

  // 🆕 Update total available count
  await updateTotalAvailable();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function copyQRCode(code) {
  // Create a temporary textarea element to hold the text
  const tempTextArea = document.createElement("textarea");
  tempTextArea.value = code;
  tempTextArea.style.position = "fixed";
  tempTextArea.style.opacity = "0";
  document.body.appendChild(tempTextArea);

  try {
    // Select and copy the text
    tempTextArea.select();
    tempTextArea.setSelectionRange(0, 99999); // For mobile devices

    // Copy the text to clipboard
    if (document.execCommand("copy")) {
      showAlert("Proximity code copied to clipboard!");
    } else {
      // Fallback for modern browsers using the Clipboard API
      if (navigator.clipboard) {
        navigator.clipboard
          .writeText(code)
          .then(() => {
            showAlert("Proximity code copied to clipboard!");
          })
          .catch(() => {
            showAlert("Failed to copy Proximity code", "error");
          });
      } else {
        showAlert("Failed to copy Proximity code", "error");
      }
    }
  } catch (err) {
    // Fallback for modern browsers using the Clipboard API
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(code)
        .then(() => {
          showAlert("Proximity code copied to clipboard!");
        })
        .catch(() => {
          showAlert("Failed to copy Proximity code", "error");
        });
    } else {
      showAlert("Failed to copy Proximity code", "error");
    }
  } finally {
    // Remove the temporary textarea
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
  const range = new Set();
  range.add(1);
  range.add(totalPages);
  for (let i = Math.max(2, currentPage - delta); i <= Math.min(totalPages - 1, currentPage + delta); i++) {
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

// 🆕 SEARCH EMPLOYEES - NOW RESPECTS ACTIVE FILTERS
function searchEmployees() {
  const searchForm = document.getElementById("searchForm");
  const searchQuery = document.getElementById("search_qr").value.trim();

  if (!searchForm) return;

  // 🆕 Get active filters from the form
  const filters = getActiveFilters();

  // Load employees with the current filters
  loadEmployees(filters, true); // true = preserve page when filtering

  // ✅ AUTO-CLEAR AFTER SUCCESSFUL SEARCH
  if (searchQuery) {
    document.getElementById("search_qr").value = "";
  }

  // 🆕 Display filter status
  displayFilterStatus();
  updateDeleteButtonState();
}

// Clear search
function clearSearch() {
  const searchForm = document.getElementById("searchForm");
  if (searchForm) {
    searchForm.reset();
  }

  // Remove filter status display
  const filterStatus = document.getElementById("filter-status");
  if (filterStatus) {
    filterStatus.remove();
  }

  // Reset to page 1 and load all employees
  currentPage = 1;
  activeFilters = {};
  loadEmployees({}, false); // Load without filters
  updateDeleteButtonState();
}

function clearDateFilter() {
  const dateInput = document.getElementById("search_date");
  const clearBtn = document.getElementById("clear_date_btn");
  if (dateInput) dateInput.value = "";
  if (clearBtn) clearBtn.style.display = "none";
  searchEmployees();
}

// Open modal
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

  // Reset form
  form.reset();

  const employeeIdInput = document.getElementById("employee_id");
  if (employeeIdInput) {
    employeeIdInput.value = "";
  }

  const fileLabel = document.querySelector(".file-upload-label");
  if (fileLabel && action === "add") {
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
  }

  if (action === "add") {
    modalTitle.innerHTML = "Add Proximity Code";
  } else if (action === "edit" && employeeId) {
    modalTitle.innerHTML = `<i class="fas fa-edit" style="color:#7c3aed"></i> Edit Proximity`;
    await loadEmployeeData(employeeId);
  }

  modal.style.display = "block";

  if (action === "add") {
    // Autofocus on qr_code input after modal is displayed
    qrCodeInput.focus();
  }
}

// ✨ 🆕 ENHANCED DELETE MODAL - WITH FILTERED DELETE SUPPORT
function openDeleteModal(employeeId = null, requireConfirmation = false) {
  const modal = document.getElementById("deleteModal");
  const confirmBtn = document.getElementById("confirmDeleteBtn");
  const confirmationInput = document.getElementById("confirmationInput");
  const confirmationContainer = document.getElementById(
    "confirmationContainer",
  );
  const modalTitle = document.getElementById("deleteModalTitle");
  const modalMessage = document.getElementById("deleteModalMessage");

  // 🆕 NEW: Check if filters are active
  const hasFilters = hasActiveFilters();

  // Store the employeeId for use in confirm handler
  confirmBtn.dataset.employeeId = employeeId;
  confirmBtn.dataset.requireConfirmation = requireConfirmation;
  confirmBtn.dataset.hasFilters = hasFilters; // 🆕 NEW: Store filter state

  // Update modal content based on delete type
  if (requireConfirmation) {
    // 🆕 DELETE BASED ON FILTERS
    if (hasFilters) {
      // Delete filtered employees
      modalTitle.textContent = "⚠️ Delete Filtered Employees";
      modalMessage.innerHTML = `
        <div>
          <p style="margin-bottom: 15px;"><strong>This will delete ${employees.length} employee(s) matching your filters:</strong></p>
          <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
            ${Object.entries(getActiveFilters())
              .map(([key, value]) => {
                const properKey = key
                  .split(/(?=[A-Z])/)
                  .map(
                    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
                  )
                  .join(" ");
                return `<div style="margin: 5px 0;"><strong>${properKey}:</strong> ${value}</div>`;
              })
              .join("")}
          </div>
          <p style="color: #d63031; font-weight: bold;">This action cannot be undone.</p>
        </div>
      `;
    } else {
      // Delete all employees
      modalTitle.textContent = "⚠️ Delete All Employees";
      modalMessage.innerHTML = `
        <div>
          <p style="margin-bottom: 15px;"><strong>This will permanently delete ALL ${employees.length} employee(s).</strong></p>
          <p style="color: #d63031; font-weight: bold;">This action cannot be undone.</p>
        </div>
      `;
    }

    confirmationContainer.style.display = "block";
    confirmBtn.disabled = true;
    confirmBtn.style.opacity = "0.5";
    confirmBtn.style.cursor = "not-allowed";
  } else {
    // Single employee delete
    modalTitle.textContent = "Delete Employee";
    modalMessage.textContent = "Are you sure you want to delete this employee?";
    confirmationContainer.style.display = "none";
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = "1";
    confirmBtn.style.cursor = "pointer";
  }

  // Clear input field
  if (confirmationInput) {
    confirmationInput.value = "";
  }

  // Show modal
  modal.style.display = "flex";

  // Remove previous listeners to avoid duplicates
  const newConfirmBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

  // Handle confirmation input (if delete all)
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

  // Handle confirm click or Enter key
  const handleConfirm = () => {
    const id = newConfirmBtn.dataset.employeeId;
    const requiresConfirm =
      newConfirmBtn.dataset.requireConfirmation === "true";
    const hasFiltersFlag = newConfirmBtn.dataset.hasFilters === "true";

    if (requiresConfirm) {
      if (hasFiltersFlag) {
        deleteFilteredEmployees();
      } else {
        showAlert("Cannot be Deleted!, Try changing filters.", "error");
      }
    } else {
      deleteEmployee(id);
    }
    modal.style.display = "none";
  };

  newConfirmBtn.addEventListener("click", handleConfirm);

  document.addEventListener("keydown", function onEnterKey(e) {
    if (e.key === "Enter" && modal.style.display === "flex") {
      if (!newConfirmBtn.disabled) {
        handleConfirm();
      }
      document.removeEventListener("keydown", onEnterKey);
    }
  });

  // Handle clicking outside modal
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });
}

// 🆕 UPDATE DELETE BUTTON STATE based on active filters
function updateDeleteButtonState() {
  const deleteBtn = document.querySelector(".delete-all-btn .btn-danger");
  if (!deleteBtn) return;

  const hasFilters = hasActiveFilters();

  if (hasFilters) {
    deleteBtn.disabled = false;
    deleteBtn.style.opacity = "1";
    deleteBtn.style.cursor = "pointer";
    deleteBtn.title = "Delete filtered employees";
  } else {
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = "0.4";
    deleteBtn.style.cursor = "not-allowed";
    deleteBtn.title = "Apply filters first to enable deletion";
  }
}

// 🆕 NEW FUNCTION - DELETE EMPLOYEES BASED ON ACTIVE FILTERS
async function deleteFilteredEmployees() {
  try {
    showLoading(true);

    const employeeIds = employees.map((emp) => emp.id);

    if (employeeIds.length === 0) {
      showAlert("No employees to delete", "warning");
      return;
    }

    // BUG FIX: read live form state, not the potentially stale global
    const currentFilters = getActiveFilters();

    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(employeeIds));
    formData.append("filters", JSON.stringify(currentFilters)); // FIXED

    const response = await fetch("proxcode_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    // BUG FIX: was missing — HTTP errors were silently ignored
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

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
  const isPlaceholder = select.selectedIndex === 0;
  select.style.color = isPlaceholder ? "#999" : "#000";
  [...select.options].forEach((opt) => {
    opt.style.color = "#000";
  });
}

function updateColor() {
  const selects = [document.getElementById("search_remarks")];

  selects.forEach(updateSelectColor);
}

async function populateFilter(employeeList) {
  const remarks = document.getElementById("search_remarks");
  if (!remarks) return;

  // ✅ Compute live remarks using QR matching (same logic as renderEmployeeTable)
  const systemQRCodes = await getSystemEmployeeQRCodes();
  const normalizedSystemQRCodes = systemQRCodes.map((code) =>
    String(code).trim().toLowerCase(),
  );

  const remarksSet = new Set();
  for (const emp of employeeList) {
    const isOccupied = normalizedSystemQRCodes.includes(
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

// 🆕 LOAD EMPLOYEES - NOW ALWAYS CHECKS FOR FILTERS
async function loadEmployees(filters = {}, preservePage = false) {
  try {
    showLoading(true);

    if (Object.keys(filters).length === 0 && hasActiveFilters()) {
      filters = getActiveFilters();
    }

    activeFilters = filters;

    // Strip 'remarks' before sending to backend — it's not a DB column
    const { remarks: remarksFilter, ...backendFilters } = filters;

    const params = new URLSearchParams({
      action: "get",
      ...backendFilters,
    });

    const response = await fetch(
      `proxcode_backend.php?${params.toString()}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;
      populateFilter(employees);

      // Apply remarks filter client-side (computed field, not stored in DB)
      if (remarksFilter) {
        const systemQRCodes = await getSystemEmployeeQRCodes();
        const normalizedSystemQRCodes = systemQRCodes.map((code) =>
          String(code).trim().toLowerCase(),
        );
        employees = employees.filter((emp) => {
          const isOccupied = normalizedSystemQRCodes.includes(
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
    showLoading(false);
  }
}

// Close modal
function closeModal() {
  const employeeModal = document.getElementById("employeeModal");
  const deleteModal = document.getElementById("deleteModal");
  const importModal = document.getElementById("importModal");
  if (!employeeModal || !deleteModal || !importModal) return;

  employeeModal.style.display = "none";
  deleteModal.style.display = "none";
  importModal.style.display = "none";

  // Reset form
  const form = document.getElementById("employeeForm");
  if (form) {
    form.reset();
  }
}

// Handle form submission - Fixed with proper variable handling
async function handleFormSubmit(e) {
  e.preventDefault();

  try {
    // Get form values properly
    const employeeIdField = document.getElementById("employee_id");
    const qrCodeField = document.getElementById("qr_code");

    if (!qrCodeField) {
      showAlert("Form field 'qr_code' not found", "error");
      return;
    }

    const employeeId = employeeIdField?.value || "";
    const qrCode = qrCodeField.value.trim();

    // Validate QR code is not empty
    if (!qrCode) {
      showAlert("Please enter a Proximity code", "error");
      return;
    }

    // Check for duplicate proximity code
    const isDuplicate = employees.some((emp) => {
      // For edit mode, exclude the current proximity code from duplicate check
      if (currentAction === "edit" && employeeId && emp.id == employeeId) {
        return false;
      }
      // Case-insensitive comparison
      return emp.qr_code.toLowerCase().trim() === qrCode.toLowerCase();
    });

    if (isDuplicate) {
      showAlert(`Proximity code "${qrCode}" already exists!`, "error");
      return;
    }

    showLoading(true);

    const formData = new FormData(e.target);
    formData.append("action", currentAction);

    const response = await fetch("proxcode_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

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

      // 🆕 Reload with active filters (if any), preserve page for edits
      const preservePage = currentAction === "edit";
      const filtersToUse = hasActiveFilters() ? getActiveFilters() : {};
      await loadEmployees(filtersToUse, preservePage);

      await updateTotalEmployees(); // 🆕 Update total employees count
      await updateTotalAvailable(); // 🆕 Update count after loading
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

    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (file.size > maxSize) {
        showAlert("File size must be less than 5MB", "error");
        e.target.value = "";
        label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
        return;
      }

      // Check file type
      const allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
        "image/webp",
      ];
      if (!allowedTypes.includes(file.type)) {
        showAlert("Only image files are allowed", "error");
        e.target.value = "";
        label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
        return;
      }

      label.innerHTML = `<i class="fas fa-image"></i> ${file.name}`;
    } else {
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
    }
  });
}

// Delete employee - Modified to preserve current page and filters
async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch("proxcode_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      // 🆕 Reload with active filters
      const filtersToUse = activeFilters;
      await loadEmployees(filtersToUse, true);
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

// Delete all employees with better confirmation
async function deleteAllEmployees(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete_all");
    formData.append("id", employeeId);

    const response = await fetch("proxcode_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      // Reset to page 1 and clear filters after deleting all
      currentPage = 1;
      clearSearch(); // This will also remove filter status display
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Success:", error);
    showAlert("Delete all employee data", "success");
    // Reset to page 1 and clear filters
    currentPage = 1;
    clearSearch();
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
  alert.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;"><i class="fas fa-times"></i></button>
  `;

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

// Close modal when clicking outside
window.onclick = function (event) {
  const modal = document.getElementById("employeeModal");
  if (event.target === modal) {
    closeModal();
  }
};
