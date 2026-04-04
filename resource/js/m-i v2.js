//m-i-v2.js - Updated for PHP Integration

// Configuration
const API_BASE_URL = "qr_search_backend v2.php";
let selectedEmployees = new Set();
let currentEmployees = [];
let allEmployees = []; // Store all employees from PHP

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  initializeTabs();
  setupEventListeners();

  // Load employees from PHP data if available
  if (window.phpEmployees) {
    allEmployees = window.phpEmployees;
    currentEmployees = allEmployees;
    displayEmployees(allEmployees);
    updateResultsCount(`Showing all ${allEmployees.length} employee(s)`);
  } else {
    loadAllEmployees();
  }
});

// Tab functionality
function initializeTabs() {
  const tabButtons = document.querySelectorAll(".tab-button");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((button) => {
    button.addEventListener("click", function () {
      const tabName = this.dataset.tab;

      // Remove active class from all buttons and contents
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      tabContents.forEach((content) => (content.style.display = "none"));

      // Add active class to clicked button and show corresponding content
      this.classList.add("active");
      document.getElementById(tabName + "-tab").style.display = "block";

      // Focus on relevant input
      if (tabName === "qr") {
        setTimeout(() => document.getElementById("qr-lookup").focus(), 100);
      }
    });
  });
}

// Setup event listeners
function setupEventListeners() {
  // Search on Enter key
  const searchInputs = ["search-all", "fullname", "position", "qr_code"];
  searchInputs.forEach((inputId) => {
    const element = document.getElementById(inputId);
    if (element) {
      element.addEventListener("keypress", function (e) {
        if (e.key === "Enter") {
          searchEmployees();
        }
      });
    }
  });

  // QR lookup on Enter
  const qrLookup = document.getElementById("qr-lookup");
  if (qrLookup) {
    qrLookup.addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        lookupByQR();
      }
    });
  }

  // Filter changes trigger search
  const filterInputs = ["brand", "status", "shift", "check_status"];
  filterInputs.forEach((inputId) => {
    const element = document.getElementById(inputId);
    if (element) {
      element.addEventListener("change", function () {
        if (
          document
            .querySelector('.tab-button[data-tab="filters"]')
            .classList.contains("active")
        ) {
          searchEmployees();
        }
      });
    }
  });

  // Real-time search for main search input
  const searchAll = document.getElementById("search-all");
  if (searchAll) {
    searchAll.addEventListener(
      "input",
      debounce(function () {
        if (this.value.length >= 2) {
          searchEmployees();
        } else if (this.value.length === 0) {
          loadAllEmployees();
        }
      }, 500),
    );
  }
}

// Debounce function for real-time search
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

// Search employees - Updated to work with PHP data
async function searchEmployees() {
  showLoading();
  clearMessage();

  try {
    // Use local PHP data if available, otherwise use API
    if (window.phpEmployees && allEmployees.length > 0) {
      searchEmployeesLocal();
      return;
    }

    const searchParams = new URLSearchParams();

    // Get search parameters based on active tab
    const activeTab = document.querySelector(".tab-button.active").dataset.tab;

    if (activeTab === "search") {
      const searchAll = document.getElementById("search-all").value.trim();
      if (searchAll) {
        searchParams.append("fullname", searchAll);
      } else {
        const fullname = document.getElementById("fullname").value.trim();
        const position = document.getElementById("position").value.trim();
        const qr_code = document.getElementById("qr_code").value.trim();

        if (fullname) searchParams.append("fullname", fullname);
        if (position) searchParams.append("position", position);
        if (qr_code) searchParams.append("qr_code", qr_code);
      }
    } else if (activeTab === "filters") {
      const brand = document.getElementById("brand").value;
      const status = document.getElementById("status").value;
      const shift = document.getElementById("shift").value;
      const check_status = document.getElementById("check_status").value;

      if (brand) searchParams.append("brand", brand);
      if (status) searchParams.append("status", status);
      if (shift) searchParams.append("shift", shift);
      if (check_status) searchParams.append("check_status", check_status);
    }

    const response = await fetch(`${API_BASE_URL}?${searchParams}`);
    const data = await response.json();

    hideLoading();

    if (data.success) {
      displayEmployees(data.data);
      showMessage(`Found ${data.count} employee(s)`, "success");
    } else {
      displayEmployees([]);
      showMessage(data.message || "Search failed", "error");
    }
  } catch (error) {
    hideLoading();
    // Fallback to local search if API fails
    searchEmployeesLocal();
    console.error("Search error, using local data:", error);
  }
}

// Local search function for PHP data
function searchEmployeesLocal() {
  const activeTab = document.querySelector(".tab-button.active").dataset.tab;
  let filteredEmployees = [...allEmployees];

  if (activeTab === "search") {
    const searchAll = document
      .getElementById("search-all")
      .value.trim()
      .toLowerCase();
    const fullname = document
      .getElementById("fullname")
      .value.trim()
      .toLowerCase();
    const position = document
      .getElementById("position")
      .value.trim()
      .toLowerCase();
    const qr_code = document
      .getElementById("qr_code")
      .value.trim()
      .toLowerCase();

    filteredEmployees = allEmployees.filter((employee) => {
      if (searchAll) {
        return (
          (employee.fullname || "").toLowerCase().includes(searchAll) ||
          (employee.position || "").toLowerCase().includes(searchAll) ||
          (employee.qr_code || "").toLowerCase().includes(searchAll) ||
          (employee.brand || "").toLowerCase().includes(searchAll)
        );
      }

      let matches = true;
      if (fullname)
        matches =
          matches && (employee.fullname || "").toLowerCase().includes(fullname);
      if (position)
        matches =
          matches && (employee.position || "").toLowerCase().includes(position);
      if (qr_code)
        matches =
          matches && (employee.qr_code || "").toLowerCase().includes(qr_code);

      return matches;
    });
  } else if (activeTab === "filters") {
    const brand = document.getElementById("brand").value;
    const status = document.getElementById("status").value;
    const shift = document.getElementById("shift").value;
    const check_status = document.getElementById("check_status").value;

    filteredEmployees = allEmployees.filter((employee) => {
      let matches = true;
      if (brand) matches = matches && employee.brand === brand;
      if (status) matches = matches && employee.status === status;
      if (shift) matches = matches && employee.shift === shift;
      if (check_status)
        matches = matches && (employee.check_status || "OUT") === check_status;

      return matches;
    });
  }

  hideLoading();
  displayEmployees(filteredEmployees);
  showMessage(`Found ${filteredEmployees.length} employee(s)`, "success");
}

// Load all employees
async function loadAllEmployees() {
  // Use PHP data if available
  if (window.phpEmployees && allEmployees.length > 0) {
    displayEmployees(allEmployees);
    updateResultsCount(`Showing all ${allEmployees.length} employee(s)`);
    return;
  }

  showLoading();
  clearMessage();

  try {
    const response = await fetch(API_BASE_URL);
    const data = await response.json();

    hideLoading();

    if (data.success) {
      allEmployees = data.data;
      currentEmployees = allEmployees;
      displayEmployees(data.data);
      updateResultsCount(`Showing all ${data.count} employee(s)`);
    } else {
      displayEmployees([]);
      showMessage(data.message || "Failed to load employees", "error");
    }
  } catch (error) {
    hideLoading();
    showMessage("Network error: " + error.message, "error");
    console.error("Load all error:", error);
  }
}

// QR Code lookup
async function lookupByQR() {
  const qrCode = document.getElementById("qr-lookup").value.trim();

  if (!qrCode) {
    showMessage("Please enter a QR code", "error");
    return;
  }

  // Try local search first
  if (allEmployees.length > 0) {
    const employee = allEmployees.find((emp) => emp.qr_code === qrCode);
    if (employee) {
      displayEmployees([employee]);
      showMessage("Employee found", "success");
      return;
    }
  }

  showLoading();
  clearMessage();

  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "lookup_by_qr",
        qr_code: qrCode,
      }),
    });

    const data = await response.json();
    hideLoading();

    if (data.success) {
      displayEmployees([data.data]);
      showMessage(data.message, "success");
    } else {
      displayEmployees([]);
      showMessage(data.message || "Employee not found", "error");
    }
  } catch (error) {
    hideLoading();
    showMessage("Network error: " + error.message, "error");
    console.error("QR lookup error:", error);
  }
}

// Get initials helper function
function getInitials(name) {
  if (!name) return "N/A";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

// Display employees - Updated with enhanced UI
function displayEmployees(employees) {
  currentEmployees = employees;
  const grid = document.getElementById("employee-grid");

  if (!employees || employees.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #666;">
        <h3>No employees found</h3>
        <p>Try adjusting your search criteria or load all employees.</p>
      </div>
    `;
    updateResultsCount("No employees found");
    return;
  }

  grid.innerHTML = employees
    .map(
      (employee) => `
        <div class="employee-card ${
          selectedEmployees.has(employee.id) ? "selected" : ""
        }" data-id="${employee.id}">
          <div class="checkbox-container">
            <input type="checkbox" 
                   id="select-${employee.id}" 
                   ${selectedEmployees.has(employee.id) ? "checked" : ""}
                   onchange="toggleEmployeeSelection(${employee.id})">
            <label for="select-${employee.id}">Select</label>
          </div>
          
          <div class="employee-header">
            <div class="employee-avatar">${getInitials(employee.fullname)}</div>
            <div class="employee-info">
              <h3>${employee.fullname || "N/A"}</h3>
              <div class="position">${employee.position || "N/A"}</div>
              <div class="id">ID: ${employee.id}</div>
            </div>
            <div class="status-badge ${(employee.check_status || "OUT").toLowerCase()}">${employee.check_status || "OUT"}</div>
          </div>
          
          <div class="employee-details">
            <div class="detail-row">
              <span class="label">Brand:</span>
              <span class="value">${employee.brand || "N/A"}</span>
            </div>
            <div class="detail-row">
              <span class="label">Status:</span>
              <span class="value status-${(employee.status || "inactive").toLowerCase()}">${employee.status || "Inactive"}</span>
            </div>
            <div class="detail-row">
              <span class="label">Shift:</span>
              <span class="value">${employee.shift || "N/A"}</span>
            </div>
            <div class="detail-row">
              <span class="label">QR Code:</span>
              <span class="value qr-code">${employee.qr_code || "N/A"}</span>
            </div>
            ${
              employee.last_scan_time
                ? `
            <div class="detail-row">
              <span class="label">Last Scan:</span>
              <span class="value">${formatDateTime(employee.last_scan_time)}</span>
            </div>
            `
                : ""
            }
          </div>
          
          <div class="employee-actions">
            <button class="btn btn-sm btn-outline" onclick="viewEmployeeDetails(${employee.id})">
              View Details
            </button>
            <button class="btn btn-sm btn-primary" onclick="updateCheckStatus(${employee.id}, '${employee.check_status === "IN" ? "OUT" : "IN"}')">
              Mark ${employee.check_status === "IN" ? "OUT" : "IN"}
            </button>
          </div>
        </div>
      `,
    )
    .join("");

  updateResultsCount(`Showing ${employees.length} employee(s)`);
}

// Toggle employee selection
function toggleEmployeeSelection(employeeId) {
  if (selectedEmployees.has(employeeId)) {
    selectedEmployees.delete(employeeId);
  } else {
    selectedEmployees.add(employeeId);
  }

  // Update card appearance
  const card = document.querySelector(`[data-id="${employeeId}"]`);
  if (card) {
    card.classList.toggle("selected", selectedEmployees.has(employeeId));
  }

  updateBulkActionsUI();
}

// Update bulk actions UI
function updateBulkActionsUI() {
  const bulkActions = document.getElementById("bulk-actions");
  const selectedCount = selectedEmployees.size;

  if (selectedCount > 0) {
    bulkActions.style.display = "block";
    bulkActions.innerHTML = `
      <div class="bulk-actions-content">
        <span>${selectedCount} employee(s) selected</span>
        <div class="bulk-buttons">
          <button class="btn btn-sm btn-outline" onclick="clearSelection()">Clear Selection</button>
          <button class="btn btn-sm btn-primary" onclick="bulkCheckIn()">Bulk Check IN</button>
          <button class="btn btn-sm btn-secondary" onclick="bulkCheckOut()">Bulk Check OUT</button>
          <button class="btn btn-sm btn-danger" onclick="bulkExport()">Export Selected</button>
        </div>
      </div>
    `;
  } else {
    bulkActions.style.display = "none";
  }
}

// Clear selection
function clearSelection() {
  selectedEmployees.clear();
  document.querySelectorAll(".employee-card").forEach((card) => {
    card.classList.remove("selected");
  });
  document
    .querySelectorAll('input[type="checkbox"][id^="select-"]')
    .forEach((checkbox) => {
      checkbox.checked = false;
    });
  updateBulkActionsUI();
}

// Bulk check in
async function bulkCheckIn() {
  if (selectedEmployees.size === 0) return;

  const confirmMsg = `Are you sure you want to check IN ${selectedEmployees.size} employee(s)?`;
  if (!confirm(confirmMsg)) return;

  await bulkUpdateCheckStatus([...selectedEmployees], "IN");
}

// Bulk check out
async function bulkCheckOut() {
  if (selectedEmployees.size === 0) return;

  const confirmMsg = `Are you sure you want to check OUT ${selectedEmployees.size} employee(s)?`;
  if (!confirm(confirmMsg)) return;

  await bulkUpdateCheckStatus([...selectedEmployees], "OUT");
}

// Bulk update check status
async function bulkUpdateCheckStatus(employeeIds, status) {
  showLoading();

  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "bulk_update_status",
        employee_ids: employeeIds,
        check_status: status,
      }),
    });

    const data = await response.json();
    hideLoading();

    if (data.success) {
      showMessage(
        `Successfully updated ${employeeIds.length} employee(s) to ${status}`,
        "success",
      );

      // Update local data if available
      if (allEmployees.length > 0) {
        allEmployees.forEach((emp) => {
          if (employeeIds.includes(emp.id)) {
            emp.check_status = status;
            emp.last_scan_time = new Date().toISOString();
          }
        });
        displayEmployees(currentEmployees);
      } else {
        // Reload data from server
        loadAllEmployees();
      }

      clearSelection();
    } else {
      showMessage(data.message || "Bulk update failed", "error");
    }
  } catch (error) {
    hideLoading();
    showMessage("Network error: " + error.message, "error");
    console.error("Bulk update error:", error);
  }
}

// Update individual check status
async function updateCheckStatus(employeeId, newStatus) {
  const employee = currentEmployees.find((emp) => emp.id == employeeId);
  const employeName = employee ? employee.fullname : `Employee ${employeeId}`;

  const confirmMsg = `Are you sure you want to mark ${employeName} as ${newStatus}?`;
  if (!confirm(confirmMsg)) return;

  showLoading();

  try {
    const response = await fetch(API_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "update_check_status",
        employee_id: employeeId,
        check_status: newStatus,
      }),
    });

    const data = await response.json();
    hideLoading();

    if (data.success) {
      showMessage(`${employeName} marked as ${newStatus}`, "success");

      // Update local data if available
      if (allEmployees.length > 0) {
        const empIndex = allEmployees.findIndex((emp) => emp.id == employeeId);
        if (empIndex !== -1) {
          allEmployees[empIndex].check_status = newStatus;
          allEmployees[empIndex].last_scan_time = new Date().toISOString();
        }

        const currentIndex = currentEmployees.findIndex(
          (emp) => emp.id == employeeId,
        );
        if (currentIndex !== -1) {
          currentEmployees[currentIndex].check_status = newStatus;
          currentEmployees[currentIndex].last_scan_time =
            new Date().toISOString();
        }

        displayEmployees(currentEmployees);
      } else {
        // Reload data from server
        loadAllEmployees();
      }
    } else {
      showMessage(data.message || "Status update failed", "error");
    }
  } catch (error) {
    hideLoading();
    showMessage("Network error: " + error.message, "error");
    console.error("Status update error:", error);
  }
}

// View employee details
function viewEmployeeDetails(employeeId) {
  const employee = currentEmployees.find((emp) => emp.id == employeeId);

  if (!employee) {
    showMessage("Employee not found", "error");
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>Employee Details</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="employee-detail-grid">
          <div class="detail-item">
            <label>Full Name:</label>
            <span>${employee.fullname || "N/A"}</span>
          </div>
          <div class="detail-item">
            <label>Employee ID:</label>
            <span>${employee.id}</span>
          </div>
          <div class="detail-item">
            <label>Position:</label>
            <span>${employee.position || "N/A"}</span>
          </div>
          <div class="detail-item">
            <label>Brand:</label>
            <span>${employee.brand || "N/A"}</span>
          </div>
          <div class="detail-item">
            <label>Status:</label>
            <span class="status-${(employee.status || "inactive").toLowerCase()}">${employee.status || "Inactive"}</span>
          </div>
          <div class="detail-item">
            <label>Check Status:</label>
            <span class="status-badge ${(employee.check_status || "out").toLowerCase()}">${employee.check_status || "OUT"}</span>
          </div>
          <div class="detail-item">
            <label>Shift:</label>
            <span>${employee.shift || "N/A"}</span>
          </div>
          <div class="detail-item">
            <label>QR Code:</label>
            <span class="qr-code">${employee.qr_code || "N/A"}</span>
          </div>
          ${
            employee.last_scan_time
              ? `
          <div class="detail-item">
            <label>Last Scan:</label>
            <span>${formatDateTime(employee.last_scan_time)}</span>
          </div>
          `
              : ""
          }
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="this.closest('.modal-overlay').remove()">Close</button>
        <button class="btn btn-primary" onclick="updateCheckStatus(${employee.id}, '${employee.check_status === "IN" ? "OUT" : "IN"}'); this.closest('.modal-overlay').remove();">
          Mark ${employee.check_status === "IN" ? "OUT" : "IN"}
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

// Bulk export
function bulkExport() {
  if (selectedEmployees.size === 0) return;

  const selectedData = currentEmployees.filter((emp) =>
    selectedEmployees.has(emp.id),
  );
  const csvContent = convertToCSV(selectedData);
  downloadCSV(
    csvContent,
    `selected_employees_${formatDateForFilename(new Date())}.csv`,
  );

  showMessage(`Exported ${selectedData.length} employee(s)`, "success");
}

// Convert to CSV
function convertToCSV(data) {
  if (!data || data.length === 0) return "";

  const headers = [
    "ID",
    "Full Name",
    "Position",
    "Brand",
    "Status",
    "Check Status",
    "Shift",
    "QR Code",
    "Last Scan",
  ];
  const csvRows = [headers.join(",")];

  data.forEach((emp) => {
    const row = [
      emp.id || "",
      `"${(emp.fullname || "").replace(/"/g, '""')}"`,
      `"${(emp.position || "").replace(/"/g, '""')}"`,
      `"${(emp.brand || "").replace(/"/g, '""')}"`,
      `"${(emp.status || "").replace(/"/g, '""')}"`,
      `"${(emp.check_status || "OUT").replace(/"/g, '""')}"`,
      `"${(emp.shift || "").replace(/"/g, '""')}"`,
      `"${(emp.qr_code || "").replace(/"/g, '""')}"`,
      `"${emp.last_scan_time ? formatDateTime(emp.last_scan_time) : ""}"`,
    ];
    csvRows.push(row.join(","));
  });

  return csvRows.join("\n");
}

// Download CSV
function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Format date and time
function formatDateTime(ts) {
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

// Format date for filename
function formatDateForFilename(date) {
  return date.toISOString().split("T")[0].replace(/-/g, "");
}

// Update results count
function updateResultsCount(message) {
  const resultsCount = document.getElementById("results-count");
  if (resultsCount) {
    resultsCount.textContent = message;
  }
}

// Show loading
function showLoading() {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.style.display = "block";
  }
}

// Hide loading
function hideLoading() {
  const loading = document.getElementById("loading");
  if (loading) {
    loading.style.display = "none";
  }
}

// Show/hide messages
function showMessage(message, type = "info") {
  const messageDiv = document.getElementById("message");
  if (messageDiv) {
    messageDiv.textContent = message;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = "block";

    // Auto-hide success messages after 3 seconds
    if (type === "success") {
      setTimeout(() => {
        clearMessage();
      }, 3000);
    }
  }
}

function clearMessage() {
  const messageDiv = document.getElementById("message");
  if (messageDiv) {
    messageDiv.style.display = "none";
    messageDiv.textContent = "";
    messageDiv.className = "message";
  }
}

// Clear form function
function clearForm() {
  // Clear search inputs
  const inputs = ["search-all", "fullname", "position", "qr_code", "qr-lookup"];
  inputs.forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.value = "";
  });

  // Reset filters
  const filters = ["brand", "status", "shift", "check_status"];
  filters.forEach((id) => {
    const element = document.getElementById(id);
    if (element) element.selectedIndex = 0;
  });

  // Clear selection and load all employees
  clearSelection();
  loadAllEmployees();
  clearMessage();
}

// Select all visible employees
function selectAllVisible() {
  currentEmployees.forEach((emp) => {
    selectedEmployees.add(emp.id);
  });

  // Update UI
  document.querySelectorAll(".employee-card").forEach((card) => {
    card.classList.add("selected");
  });
  document
    .querySelectorAll('input[type="checkbox"][id^="select-"]')
    .forEach((checkbox) => {
      checkbox.checked = true;
    });

  updateBulkActionsUI();
}

// Export all visible employees
function exportAllVisible() {
  if (currentEmployees.length === 0) {
    showMessage("No employees to export", "error");
    return;
  }

  const csvContent = convertToCSV(currentEmployees);
  downloadCSV(
    csvContent,
    `all_employees_${formatDateForFilename(new Date())}.csv`,
  );

  showMessage(`Exported ${currentEmployees.length} employee(s)`, "success");
}
