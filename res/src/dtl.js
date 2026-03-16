//dtl.js - Employee Management System

// Global variables
let currentAction = "add";
let employees = [];

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
    "#searchForm input, #searchForm select"
  );
  searchInputs.forEach((input) => {
    input.addEventListener("input", debounce(searchEmployees, 300));
  });

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
    "touchstart"
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
    showAlert(`Auto-update interval changed to ${formatInterval(interval)}`, "info");
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

  console.log(`Auto-update started with ${formatInterval(intervalMs)} interval`);
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
    employees.map((emp) => [emp.id, JSON.stringify(emp)])
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
    const params = new URLSearchParams({
      action: "get",
      ...filters,
    });

    const response = await fetch(`../cnfg/datalog_backend.php?${params.toString()}`, {
      method: "GET",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "Cache-Control": "no-cache"
      },
      signal: AbortSignal.timeout(10000) // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      const hasChanges = checkForChanges(data.data);

      if (hasChanges) {
        employees = data.data;
        await renderEmployeeTable();
        showAutoUpdateNotification();
        console.log(`Auto-update: Employee data refreshed - ${employees.length} employees loaded`);
      } else {
        console.log("Auto-update: No changes detected");
      }

      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
    } else {
      console.warn("Auto-update failed:", data.message || "Invalid data format");
    }
  } catch (error) {
    console.error("Auto-update error:", error);

    // Handle different types of errors
    if (error.name === 'TimeoutError') {
      console.warn("Auto-update timeout - server may be slow");
    } else if (error.message.includes("Failed to fetch") || error.message.includes("NetworkError")) {
      console.warn("Auto-update: Network connection issue");
      // Optionally disable auto-update on repeated network failures
      handleNetworkError();
    } else if (error.name === 'AbortError') {
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
    showAlert("Auto-update disabled due to repeated connection issues", "warning");
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

// Load single employee data for editing
async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `../cnfg/datalog_backend.php?action=get_single&id=${employeeId}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );

    const data = await response.json();

    if (data.success && data.data) {
      const employee = data.data;

      // Populate form fields
      const fields = {
        "employee_id": employee.id,
        "fullname": employee.fullname || "",
        "position": employee.position || "",
        "brand": employee.brand || "",
        "status": employee.status || "Active",
        "shift": employee.shift || "",
        "violation": employee.violation || "",
        "check_status": employee.check_status || "",
        "access_timestamp": employee.access_timestamp || ""
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

// Render employee table with improved error handling
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
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentEmployees = employees.slice(startIndex, endIndex);

  // Get current user ID asynchronously
  const currentUserId = await getCurrentUserId();

  // Render table rows
  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      // Generate initials for placeholder
      const fullnameInitials = (employee.fullname || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      return `
          <tr>
              <td>${startIndex + index + 1}</td>
              <td><strong>${employee.fullname || 'N/A'}</strong></td>
              <td>${employee.position || 'N/A'}</td>
              <td>${employee.brand || 'N/A'}</td>
              <td><span class="status-${(employee.status || '').toLowerCase()}">${
        employee.status || 'N/A'
      }</span></td>
              <td>${employee.shift || 'N/A'}</td>
              <td class="Col7"><div style="height: 50px; overflow-y: auto; scrollbar-width: thin; align-content: center;">
                <small>${employee.violation || "None"}</small></div></td>
              <td class="Col8">${
                employee.image
                  ? `
                <img src="../../uploads/user_${currentUserId}/${employee.image}" alt="${employee.fullname}" class="employee-image" onerror="this.style.display='none'; this.nextSibling.style.display='inline';">
                  <span style="display:none;">📷</span>`
                  : `<div class="ph-cont"><div class="employee-ph">${fullnameInitials}</div></div>`
              }
              </td>
              <td class="Col9" onclick="copyQRCode('${employee.qr_code || ''}')" title="Copy QR code"><i class='fas fa-qrcode'></i></td>
              <td class="employee-timestamp"><small>${employee.access_timestamp || 'N/A'}</small></td>
              <td><div class="check-status-${(employee.check_status || '').toLowerCase()}"><div class="employee-ph">${
        employee.check_status || 'N/A'
      }</div></div></td>
          </tr>
      `;
    })
    .join("");

  // Update pagination controls
  updatePaginationControls();
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
function copyQRCode(qrCode) {
  if (!qrCode) {
    showAlert('No QR code available', 'warning');
    return;
  }

  // Modern clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(qrCode).then(() => {
      showAlert('QR code copied to clipboard!', 'success');
    }).catch(() => {
      fallbackCopyTextToClipboard(qrCode);
    });
  } else {
    // Fallback for older browsers
    fallbackCopyTextToClipboard(qrCode);
  }
}

// Fallback copy method
function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    document.execCommand('copy');
    showAlert('QR code copied to clipboard!', 'success');
  } catch (err) {
    showAlert('Failed to copy QR code', 'error');
  }
  
  document.body.removeChild(textArea);
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
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${employees.length} total employees)`;
  }

  // Update button states
  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
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

// Search employees
function searchEmployees() {
  const searchForm = document.getElementById("searchForm");
  if (!searchForm) return;

  const formData = new FormData(searchForm);
  const filters = {};

  for (let [key, value] of formData.entries()) {
    if (value.trim()) {
      filters[key] = value.trim();
    }
  }

  loadEmployees(filters);
}

// Clear search
function clearSearch() {
  const searchForm = document.getElementById("searchForm");
  if (searchForm) {
    searchForm.reset();
    loadEmployees();
  }
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

// Modal functions
async function openModal(action, employeeId = null) {
  currentAction = action;
  const modal = document.getElementById("employeeModal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("employeeForm");

  if (!modal || !modalTitle || !form) {
    console.error("Modal elements not found");
    return;
  }

  // Reset form
  form.reset();
  const employeeIdField = document.getElementById("employee_id");
  if (employeeIdField) {
    employeeIdField.value = "";
  }

  // Reset file upload label
  const fileLabel = document.querySelector(".file-upload-label");
  if (fileLabel) {
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
  }

  if (action === "add") {
    modalTitle.textContent = "Add Employee";
    // Set default values for new employee
    const statusField = document.getElementById("status");
    if (statusField) {
      statusField.value = "Active";
    }
  } else if (action === "edit" && employeeId) {
    modalTitle.textContent = "Edit Employee";
    await loadEmployeeData(employeeId);
  }

  modal.style.display = "block";
}

// Load employees with improved error handling
async function loadEmployees(filters = {}) {
  try {
    showLoading(true);

    const params = new URLSearchParams({
      action: "get",
      ...filters,
    });

    const response = await fetch(`../cnfg/datalog_backend.php?${params.toString()}`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;
      currentPage = 1;
      await renderEmployeeTable();
      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
      resetNetworkErrorCount(); // Reset network error counter on successful load

      console.log(`Loaded ${data.total || employees.length} employees`);
    } else {
      showAlert(data.message || "Error loading employees", "error");
    }
  } catch (error) {
    console.error("Error loading employees:", error);
    showAlert(
      "Failed to load employees. Please check your connection.",
      "error"
    );
  } finally {
    showLoading(false);
  }
}

// Close modal
function closeModal() {
  const modal = document.getElementById("employeeModal");
  if (!modal) return;

  modal.style.display = "none";

  // Reset form
  const form = document.getElementById("employeeForm");
  if (form) {
    form.reset();
  }

  // Reset file upload label
  const fileLabel = document.querySelector(".file-upload-label");
  if (fileLabel) {
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
  }
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
        "success"
      );
      closeModal();
      loadEmployees(); // Reload the employee list
    } else {
      showAlert(data.message || "Failed to save employee", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert(
      "Failed to save employee. Please check your connection.",
      "error"
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
  if (!confirm("Are you sure you want to delete this employee?")) {
    return;
  }

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
      loadEmployees();
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
  if (
    !confirm(
      "⚠️ WARNING: This will permanently delete ALL employee data!\n\nThis action cannot be undone. Are you absolutely sure?"
    )
  ) {
    return;
  }

  // Double confirmation
  if (
    !confirm(
      '🚨 FINAL WARNING: You are about to delete ALL employees and their data.\n\nType "DELETE ALL" in the next dialog to confirm.'
    )
  ) {
    return;
  }

  const userInput = prompt('Please type "DELETE ALL" to confirm this action:');
  if (userInput !== "DELETE ALL") {
    showAlert("Action cancelled - confirmation text did not match", "error");
    return;
  }

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

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      loadEmployees(); // Reload the table (will show empty)
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Delete all employees", "success");
    // Force reload anyway to refresh the display
    loadEmployees();
  } finally {
    showLoading(false);
  }
}

// Show alert message
function showAlert(message, type = "info") {
  // Remove any existing alerts
  const existingAlerts = document.querySelectorAll(".alert");
  existingAlerts.forEach(alert => alert.remove());

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

  // Initialize auto-update after a short delay to ensure all elements are ready
  setTimeout(() => {
    initializeAutoUpdate();
  }, 1000);
});
