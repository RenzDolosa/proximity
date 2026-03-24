//dtl.js - Employee Management System (ENHANCED WITH EMPLOYEE IMAGE MATCHING)

// Global variables
let currentAction = "add";
let employees = [];
let employeeDataCache = null; // 🆕 Cache employee data from manpower_backend

// Update variables
let autoUpdateInterval = null;
let autoUpdateEnabled = false;
let lastUpdateTimestamp = null;
let userActivityTimer = null;
let isUserActive = false;

// Pagination variables
let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;

let activeFilters = {};

// Setup event listeners
function setupEventListeners() {
  // Form submission
  document
    .getElementById("employeeForm")
    ?.addEventListener("submit", handleFormSubmit);

  // File upload handler
  setupFileUploadHandler();

  // Search form inputs
  const searchInputs = document.querySelectorAll(
    "#searchForm input, #searchForm select",
  );

  searchInputs.forEach((input) => {
    input.addEventListener("input", debounce(searchEmployees, 300));
  });

  // 🔥 AUTO-FOCUS LOGIC
  const proximityInput = document.getElementById("search_qr");

  function autoFocusProximity() {
    const active = document.activeElement;

    // Check if active element is NOT an input, select, or textarea
    const isTyping =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "SELECT" ||
        active.tagName === "TEXTAREA");

    if (!isTyping && proximityInput) {
      proximityInput.focus();
    }
  }

  // Run on page load
  autoFocusProximity();

  // Re-check when user clicks anywhere
  document.addEventListener("click", autoFocusProximity);

  // Re-check when focus changes (keyboard navigation, tabbing, etc.)
  document.addEventListener("focusin", autoFocusProximity);

  // Auto-update toggle
  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  if (autoUpdateToggle) {
    autoUpdateToggle.addEventListener("change", toggleAutoUpdate);
  }

  // Auto-update interval selector
  const intervalSelector = document.getElementById("updateInterval");
  if (intervalSelector) {
    intervalSelector.addEventListener("change", updateAutoUpdateInterval);
  }
}

// Initialize auto-update functionality
function initializeAutoUpdate() {
  // Check if auto-update elements exist before initializing
  const toggle = document.getElementById("autoUpdateToggle");
  const intervalSelector = document.getElementById("updateInterval");

  if (!toggle || !intervalSelector) {
    console.warn("Auto-update elements not found, skipping initialization");
    return;
  }

  // Start with auto-update enabled and default interval
  autoUpdateEnabled = toggle.checked || false;
  const defaultInterval = parseInt(intervalSelector.value) || 30000; // Default to 30 seconds

  if (autoUpdateEnabled) {
    startAutoUpdate(defaultInterval);
  }

  updateAutoUpdateUI();
  setupUserActivityTracking();
}

// Setup user activity tracking
function setupUserActivityTracking() {
  const activityEvents = [
    "mousedown",
    "keydown",
    "scroll",
    "click",
    "mousemove",
    "touchstart",
  ];

  activityEvents.forEach((event) => {
    document.addEventListener(event, handleUserActivity, { passive: true });
  });
}

// Toggle auto-update on/off
function toggleAutoUpdate() {
  const toggle = document.getElementById("autoUpdateToggle");
  autoUpdateEnabled = toggle ? toggle.checked : !autoUpdateEnabled;

  if (autoUpdateEnabled) {
    const interval = getSelectedInterval();
    startAutoUpdate(interval);
    showAlert(`Auto-update enabled (${formatInterval(interval)})`, "success");
  } else {
    stopAutoUpdate();
    showAlert("Auto-update disabled", "info");
  }

  updateAutoUpdateUI();
}

// Update auto-update interval
function updateAutoUpdateInterval() {
  if (autoUpdateEnabled) {
    const interval = getSelectedInterval();
    startAutoUpdate(interval);
    showAlert(
      `Auto-update interval changed to ${formatInterval(interval)}`,
      "info",
    );
  }
}

// Format interval for display
function formatInterval(intervalMs) {
  if (intervalMs < 60000) {
    return `${intervalMs / 1000}s`;
  } else {
    const minutes = Math.floor(intervalMs / 60000);
    return `${minutes}min`;
  }
}

// Get selected update interval
function getSelectedInterval() {
  const selector = document.getElementById("updateInterval");
  return selector ? parseInt(selector.value) || 30000 : 30000;
}

// Start auto-update
function startAutoUpdate(intervalMs) {
  stopAutoUpdate(); // Clear any existing interval

  autoUpdateInterval = setInterval(() => {
    // Only auto-update if enabled and user is not actively using the interface
    if (autoUpdateEnabled && !isUserActive) {
      console.log("Performing auto-update...");
      loadEmployeesAuto();
    } else if (isUserActive) {
      console.log("Skipping auto-update - user is active");
    }
  }, intervalMs);

  console.log(
    `Auto-update started with ${formatInterval(intervalMs)} interval`,
  );
}

// Stop auto-update
function stopAutoUpdate() {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
    console.log("Auto-update stopped");
  }
}

// Check if employee data has changed
function checkForChanges(newData) {
  if (!employees || employees.length !== newData.length) {
    return true;
  }

  // Create a map for faster lookup and comparison
  const oldEmployeeMap = new Map(
    employees.map((emp) => [emp.id, JSON.stringify(emp)]),
  );

  // Compare each employee record
  for (const newEmp of newData) {
    const oldEmpJson = oldEmployeeMap.get(newEmp.id);
    const newEmpJson = JSON.stringify(newEmp);

    if (!oldEmpJson || oldEmpJson !== newEmpJson) {
      return true; // Employee added, removed, or modified
    }
  }

  return false;
}

// Update statistic with animation
function updateStatistic(elementId, newValue) {
  const element = document.getElementById(elementId);
  if (element && element.textContent !== newValue.toLocaleString()) {
    element.classList.add("fade-in");
    element.textContent = newValue.toLocaleString();
    setTimeout(() => element.classList.remove("fade-in"), 500);
  }
}

// Update auto-update UI elements - Fixed
function updateAutoUpdateUI() {
  const toggle = document.getElementById("autoUpdateToggle");
  const status = document.getElementById("autoUpdateStatus");
  const lastUpdate = document.getElementById("lastUpdateTime");
  const intervalSelector = document.getElementById("updateInterval");

  if (toggle) {
    toggle.checked = autoUpdateEnabled;
  }

  if (status) {
    status.textContent = autoUpdateEnabled ? "ON" : "OFF";
    status.className = `auto-update-status ${
      autoUpdateEnabled ? "active" : "inactive"
    }`;
  }

  if (lastUpdate && lastUpdateTimestamp) {
    const timeString = new Date(lastUpdateTimestamp).toLocaleTimeString();
    lastUpdate.textContent = `Last updated: ${timeString}`;
    lastUpdate.style.display = "block";
  } else if (lastUpdate) {
    lastUpdate.style.display = "none";
  }

  // Enable/disable interval selector based on auto-update status
  if (intervalSelector) {
    intervalSelector.disabled = !autoUpdateEnabled;
    intervalSelector.style.opacity = autoUpdateEnabled ? "1" : "0.5";
  }
}

// Handle user activity - Fixed timing
function handleUserActivity() {
  isUserActive = true;
  clearTimeout(userActivityTimer);

  // Resume auto-update after 5 seconds of inactivity
  userActivityTimer = setTimeout(() => {
    isUserActive = false;
    console.log("User activity paused, resuming auto-update");
  }, 1000); // Increased from 1 second to 5 seconds
}

// Show subtle notification for auto-updates
function showAutoUpdateNotification() {
  const notification = document.getElementById("autoUpdateNotification");
  if (notification) {
    const timeString = new Date().toLocaleTimeString();
    notification.textContent = `Data updated at ${timeString}`;
    notification.style.cssText = `
      display: block;
      opacity: 1;
      background-color: #e8f5e8;
      color: #2d5a2d;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      border: 1px solid #b8e6b8;
      transition: opacity 0.3s ease;
    `;

    // Fade out after 3 seconds
    setTimeout(() => {
      if (notification) {
        notification.style.opacity = "0";
        setTimeout(() => {
          if (notification) {
            notification.style.display = "none";
          }
        }, 300);
      }
    }, 3000);
  }
}

// Auto-load employees (silent update) - Fixed error handling
async function loadEmployeesAuto(filters = {}) {
  try {
    showLoading(false);

    // 🆕 If no filters passed, check for active filters in form
    if (Object.keys(filters).length === 0 && hasActiveFilters()) {
      filters = getActiveFilters();
      console.log("📋 Using active filters from form:", filters);
    }

    // 🆕 Store the active filters
    activeFilters = filters;

    const params = new URLSearchParams({
      action: "get", // or 'list' - both work according to your backend
      ...filters,
    });

    const response = await fetch(
      `../cnfg/datalog_backend.php?${params.toString()}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      const hasChanges = checkForChanges(data.data);

      if (hasChanges) {
        employees = data.data;
        // 🆕 Clear cache to fetch fresh manpower data
        employeeDataCache = null;
        await renderEmployeeTable();
        showAutoUpdateNotification();
        console.log(
          `Auto-update: Employee data refreshed - ${employees.length} employees loaded`,
        );
      } else {
        console.log("Auto-update: No changes detected");
      }

      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
    } else {
      console.warn(
        "Auto-update failed:",
        data.message || "Invalid data format",
      );
    }
  } catch (error) {
    console.error("Auto-update error:", error);

    // Handle different types of errors
    if (error.name === "TimeoutError") {
      console.warn("Auto-update timeout - server may be slow");
    } else if (
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError")
    ) {
      console.warn("Auto-update: Network connection issue");
      // Optionally disable auto-update on repeated network failures
      handleNetworkError();
    } else if (error.name === "AbortError") {
      console.warn("Auto-update request was aborted");
    }
  }
}

// Handle network errors for auto-update
let networkErrorCount = 0;
function handleNetworkError() {
  networkErrorCount++;

  // Disable auto-update after 3 consecutive network errors
  if (networkErrorCount >= 3) {
    stopAutoUpdate();
    autoUpdateEnabled = false;
    updateAutoUpdateUI();
    showAlert(
      "Auto-update disabled due to repeated connection issues",
      "warning",
    );
    networkErrorCount = 0; // Reset counter
  }
}

// Reset network error counter on successful update
function resetNetworkErrorCount() {
  if (networkErrorCount > 0) {
    networkErrorCount = 0;
    console.log("Network connection restored");
  }
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

// 🆕 Fetch employee data from manpower_backend.php and cache it
async function getManpowerEmployeeData() {
  try {
    // Return cached data if available
    if (employeeDataCache) {
      return employeeDataCache;
    }

    const response = await fetch("../cnfg/manpower_backend.php?action=get", {
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
  const manpowerEmployees = await getManpowerEmployeeData();
  const qrImageMap = {};

  manpowerEmployees.forEach((emp) => {
    if (emp.qr_code) {
      qrImageMap[emp.qr_code.trim().toLowerCase()] = {
        image: emp.image,
        fullname: emp.fullname,
        position: emp.position,
        brand: emp.brand,
        status: emp.status,
        shift: emp.shift,
      };
    }
  });

  return qrImageMap;
}

// Load single employee data for editing
async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `../cnfg/datalog_backend.php?action=get_single&id=${employeeId}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    const data = await response.json();

    if (data.success && data.data) {
      const employee = data.data;

      // Populate form fields
      const fields = {
        employee_id: employee.id,
        fullname: employee.fullname || "",
        position: employee.position || "",
        brand: employee.brand || "",
        status: employee.status || "Active",
        shift: employee.shift || "",
        violation: employee.violation || "",
        check_status: employee.check_status || "",
        access_timestamp: employee.access_timestamp || "",
      };

      Object.entries(fields).forEach(([fieldId, value]) => {
        const field = document.getElementById(fieldId);
        if (field) {
          field.value = value;
        }
      });

      // Update file upload label if image exists
      const fileLabel = document.querySelector(".file-upload-label");
      if (fileLabel) {
        if (employee.image) {
          fileLabel.innerHTML = `<i class="fas fa-image"></i> Current: ${employee.image}`;
        } else {
          fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
        }
      }
    } else {
      showAlert("Failed to load employee data", "error");
    }
  } catch (error) {
    console.error("Error loading employee data:", error);
    showAlert("Failed to load employee data", "error");
  }
}

// 🆕 ENHANCED Render employee table with QR matching logic AND employee image display
async function renderEmployeeTable() {
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

  // Get current user ID asynchronously
  const currentUserId = await getCurrentUserId();

  // 🆕 Build QR to image map from manpower_backend
  const qrImageMap = await buildQRToImageMap();

  // Render table rows
  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      // 🆕 Get matched employee data from manpower_backend
      const matchedEmployeeData =
        qrImageMap[employee.qr_code.trim().toLowerCase()];

      // Determine which image to display
      let imageUrl = null;
      let displayName = employee.fullname || "N/A";
      let tooltipText = displayName;

      if (matchedEmployeeData && matchedEmployeeData.image) {
        // Use image from manpower_backend if QR matches
        imageUrl = `../../uploads/user_${currentUserId}/${matchedEmployeeData.image}`;
        displayName = matchedEmployeeData.fullname || employee.fullname;
        tooltipText = `${matchedEmployeeData.fullname}\n${matchedEmployeeData.position}\n${matchedEmployeeData.brand}`;
      } else if (employee.image) {
        // Fallback to datalog's own image
        imageUrl = `../../uploads/user_${currentUserId}/${employee.image}`;
        tooltipText = `${employee.fullname}\n${employee.position}\n${employee.brand}`;
      }

      // Generate initials for placeholder
      const fullnameInitials = (displayName || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      return `
          <tr>
              <td>${startIndex + index + 1}</td>
              <td><strong>${displayName}</strong></td>
              <td>${matchedEmployeeData ? matchedEmployeeData.position : employee.position || "N/A"}</td>
              <td>${matchedEmployeeData ? matchedEmployeeData.brand : employee.brand || "N/A"}</td>
              <td><span class="status-${(employee.status || "").toLowerCase()}">${
                employee.status || "N/A"
              }</span></td>
              <td>${employee.shift || "N/A"}</td>
              <td class="Col7"><div style="height: 50px; overflow-y: auto; scrollbar-width: thin; align-content: center;">
                <small>${employee.violation || "None"}</small></div></td>
              <td class="Col8">${
                imageUrl
                  ? `
                <img src="${imageUrl}" alt="${displayName}" class="employee-image" 
                     title="${tooltipText}" 
                     onerror="this.style.display='none'; this.nextSibling.style.display='inline';">
                  <span style="display:none;" title="${tooltipText}">📷</span>`
                  : `<div class="ph-cont" title="${tooltipText}"><div class="employee-ph">${fullnameInitials}</div></div>`
              }
              </td>
              <td class="Col9" onclick="copyQRCode('${escapeHtml(employee.qr_code || "")}')" title="Copy Proximity code" style="cursor: pointer;">
              <img src="../icon/nfc-icon.png" alt="Copy Proximity code" style="width: 20px; height: 20px;"></td>
              <td class="employee-timestamp"><small>${employee.access_timestamp || "N/A"}</small></td>
              <td><div class="check-status-${(employee.check_status || "").toLowerCase()}"><div class="employee-ph">${
                employee.check_status || "N/A"
              }</div></div></td>
          </tr>
      `;
    })
    .join("");

  // Update pagination controls
  updatePaginationControls();
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

// Get current user ID with better error handling
async function getCurrentUserId() {
  try {
    const response = await fetch("../cnfg/get_user_id.php", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
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

  return "default"; // fallback
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
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const pageInfo = document.getElementById("page-info");

  if (!paginationDiv) return;

  if (totalPages <= 1) {
    paginationDiv.style.display = "none";
    return;
  }

  paginationDiv.style.display = "flex";

  // Update page info
  pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${employees.length} total employees)`;

  // Update button states
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= totalPages;
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

// 🆕 CLEAR SEARCH - Properly reset and reload all
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

// Force refresh with improved UX
function forceRefresh() {
  showLoading(true);
  isUserActive = true; // Prevent auto-update during manual refresh

  loadEmployees()
    .then(() => {
      showAlert("Employee data refreshed manually", "success");
      resetNetworkErrorCount(); // Reset network error counter on successful refresh

      // Resume auto-update tracking after a short delay
      setTimeout(() => {
        isUserActive = false;
      }, 2000);
    })
    .catch((error) => {
      console.error("Force refresh failed:", error);
      showAlert("Failed to refresh employee data", "error");
    })
    .finally(() => {
      showLoading(false);
    });
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
  const deleteBtn = document.querySelector('.delete-all-btn .btn-danger');
  if (!deleteBtn) return;

  const hasFilters = hasActiveFilters();

  if (hasFilters) {
    deleteBtn.disabled = false;
    deleteBtn.style.opacity = '1';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.title = 'Delete filtered employees';
  } else {
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = '0.4';
    deleteBtn.style.cursor = 'not-allowed';
    deleteBtn.title = 'Apply filters first to enable deletion';
  }
}

// 🆕 NEW FUNCTION - DELETE EMPLOYEES BASED ON ACTIVE FILTERS
async function deleteFilteredEmployees() {
  try {
    showLoading(true);

    // 🆕 Get employee IDs from current filtered employees array
    const employeeIds = employees.map((emp) => emp.id);

    if (employeeIds.length === 0) {
      showAlert("No employees to delete", "warning");
      return;
    }

    // 🆕 Send filtered employee IDs to backend
    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(employeeIds));
    formData.append("filters", JSON.stringify(activeFilters)); // 🆕 Send filters for logging

    const response = await fetch("../cnfg/datalog_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(
        `Successfully deleted ${data.deleted_count || employeeIds.length} employee(s) matching your filters.`,
        "success",
      );

      // 🆕 Reset to page 1 and clear filters after deleting filtered
      currentPage = 1;
      clearSearch(); // This will also remove filter status display
    } else {
      showAlert(data.message || "Failed to delete filtered employees", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to delete filtered employees", "error");
  } finally {
    showLoading(false);
  }
}

// Load employees with improved error handling
async function loadEmployees(filters = {}, preservePage = false) {
  try {
    showLoading(true);

    // 🆕 If no filters passed, check for active filters in form
    if (Object.keys(filters).length === 0 && hasActiveFilters()) {
      filters = getActiveFilters();
      console.log("📋 Using active filters from form:", filters);
    }

    // 🆕 Store the active filters
    activeFilters = filters;

    const params = new URLSearchParams({
      action: "get", // or 'list' - both work according to your backend
      ...filters,
    });

    const response = await fetch(
      `../cnfg/datalog_backend.php?${params.toString()}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;

      // Only reset to page 1 if not preserving page and not filtering
      if (!preservePage && Object.keys(filters).length === 0) {
        currentPage = 1;
      }

      // 🆕 Clear cache to fetch fresh manpower data
      employeeDataCache = null;

      await renderEmployeeTable();
      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
      resetNetworkErrorCount(); // Reset network error counter on successful load

      if (Object.keys(filters).length > 0) {
        displayFilterStatus();
      }

      console.log(`Loaded ${data.total || employees.length} employees`);
    } else {
      showAlert(data.message || "Error loading employees", "error");
    }
  } catch (error) {
    console.error("Error loading employees:", error);
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
  const deleteModal = document.getElementById("deleteModal");
  if (!deleteModal) return;

  deleteModal.style.display = "none";
}

// Handle form submission with better validation
async function handleFormSubmit(e) {
  e.preventDefault();

  try {
    // Basic form validation
    const fullname = document.getElementById("fullname")?.value.trim();
    const position = document.getElementById("position")?.value.trim();
    const brand = document.getElementById("brand")?.value.trim();
    const shift = document.getElementById("shift")?.value;

    if (!fullname) {
      showAlert("Full name is required", "error");
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

    // Check file size if image is selected
    const imageInput = document.getElementById("image");
    if (imageInput && imageInput.files.length > 0) {
      const file = imageInput.files[0];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (file.size > maxSize) {
        showAlert("Image file size must be less than 5MB", "error");
        return;
      }

      // Check file type
      const allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
      ];
      if (!allowedTypes.includes(file.type)) {
        showAlert("Only image files (JPEG, PNG, GIF) are allowed", "error");
        return;
      }
    }

    showLoading(true);

    const formData = new FormData(e.target);
    formData.append("action", currentAction);

    const response = await fetch("../cnfg/datalog_backend.php", {
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
            ? "Employee added successfully!"
            : "Employee updated successfully!"),
        "success",
      );
      closeModal();
      // 🆕 Clear cache and reload with fresh manpower data
      employeeDataCache = null;
      const preservePage = currentAction === "edit";
      const filtersToUse = hasActiveFilters() ? getActiveFilters() : {};
      await loadEmployees(filtersToUse, preservePage);
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

// Setup file upload handler with fixed label assignment
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
        e.target.value = ""; // Clear the input
        label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
        return;
      }

      // Check file type
      const allowedTypes = [
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/gif",
      ];
      if (!allowedTypes.includes(file.type)) {
        showAlert("Only image files are allowed", "error");
        e.target.value = ""; // Clear the input
        label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
        return;
      }

      label.innerHTML = `<i class="fas fa-image"></i> ${file.name}`; // Fixed: removed extra 'label'
    } else {
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
    }
  });
}

// Delete employee
async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch("../cnfg/datalog_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      // 🆕 Clear cache and reload
      employeeDataCache = null;
      await loadEmployees();
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

// Delete all employees with better confirmation
async function deleteAllEmployees() {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete_all");

    const response = await fetch("../cnfg/datalog_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    // Check if response is ok
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Check for success response
    if (data.success) {
      showAlert(data.message, "success");
      // Clear cache and reload the table (will show empty)
      employeeDataCache = null;
      await loadEmployees();
    } else {
      // Show error message from backend
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Success:", error);

    // More specific error messages
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
  // Remove any existing alerts
  const existingAlerts = document.querySelectorAll(".alert");
  existingAlerts.forEach((alert) => alert.remove());

  // Create alert element
  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;
  alert.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;"><i class="fas fa-times"></i></button>
  `;

  // Add to page
  document.body.insertBefore(alert, document.body.firstChild);

  // Auto remove after 5 seconds
  setTimeout(() => {
    if (alert.parentElement) {
      alert.remove();
    }
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

// Clean up intervals when page is closed
window.addEventListener("beforeunload", function () {
  stopAutoUpdate();
  clearTimeout(userActivityTimer);
});

// Close modal when clicking outside
window.onclick = function (event) {
  const modal = document.getElementById("employeeModal");
  if (event.target === modal) {
    closeModal();
  }
};

// Add activity listeners
document.addEventListener("mousedown", handleUserActivity);
document.addEventListener("keydown", handleUserActivity);
document.addEventListener("scroll", handleUserActivity);

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  loadEmployees();
  setupEventListeners();
  updateDeleteButtonState();

  // Initialize auto-update after a short delay to ensure all elements are ready
  setTimeout(() => {
    initializeAutoUpdate();
  }, 1000);
});
