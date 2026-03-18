//system.js - Employee Management System

// Global variables
let currentAction = "add";
let employees = [];

// Pagination variables
let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;

let currentAudio = null;

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  loadEmployees();
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  // Form submission
  document
    .getElementById("employeeForm")
    .addEventListener("submit", handleFormSubmit);

  // File upload handler
  setupFileUploadHandler();

  // Search form inputs
  const searchInputs = document.querySelectorAll(
    "#searchForm input, #searchForm select"
  );
  searchInputs.forEach((input) => {
    input.addEventListener("input", debounce(searchEmployees, 300));
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

// Load employee data for editing
async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `../cnfg/manpower_backend.php?action=get_single&id=${employeeId}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );

    const data = await response.json();

    if (data.success && data.data) {
      const employee = data.data;

      document.getElementById("employee_id").value = employee.id;
      document.getElementById("fullname").value = employee.fullname || "";
      document.getElementById("position").value = employee.position || "";
      document.getElementById("brand").value = employee.brand || "";
      document.getElementById("status").value = employee.status || "Active";
      document.getElementById("shift").value = employee.shift || "";
      document.getElementById("violation").value = employee.violation || "";
      document.getElementById("qr_code").value = employee.qr_code || "";

      const fileLabel = document.querySelector(".file-upload-label");
      if (employee.image) {
        fileLabel.innerHTML = `<i class="fas fa-image"></i> Current: ${employee.image}`;
      } else {
        fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
      }
    } else {
      showAlert("Failed to load employee data", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to load employee data", "error");
  }
}

// Add employee to access log
async function addToLog(employeeId, checkStatus = "IN") {
  // Stop any currently playing audio when rendering new results
  stopCurrentAudio();

  try {
    // Show loading state
    const button = event.target;
    const originalText = button.innerHTML;
    button.innerHTML = "⏳ Added...";
    button.disabled = true;

    // Find the employee data
    const employee = employees.find((emp) => emp.id === employeeId);
    if (!employee) {
      throw new Error("Employee not found");
    }

    const hasViolations =
      employee.violation && employee.violation.trim() !== "";
    const hasInactive = employee.status.toLowerCase() === "inactive";

    // Prepare data for logging
    const logData = {
      employee_id: employee.id,
      fullname: employee.fullname,
      position: employee.position,
      brand: employee.brand,
      status: employee.status,
      shift: employee.shift,
      violation: employee.violation || "",
      image: employee.image || "",
      qr_code: employee.qr_code,
      check_status: checkStatus, // Use the passed parameter
      access_timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    };

    // Send to backend
    const response = await fetch("../cnfg/add_to_log.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(logData),
    });

    const result = await response.json();

    if (result.success) {
      if (hasViolations) {
        playWarningSound();
      } else if (hasInactive) {
        playInactiveSound();
      } else {
        playSuccessSound();
      }
      // Show success message with status
      showAlert(`Employee marked as ${checkStatus} successfully!`, "success");
    } else {
      throw new Error(result.message || "Failed to add employee to log");
    }
  } catch (error) {
    console.error("Error adding to log:", error);
    showAlert("Error: " + error.message, "error");
  } finally {
    // Reset button state
    setTimeout(() => {
      searchEmployees();
      button.innerHTML = "⏳ Added...";
      button.disabled = false;
    }, 1000);
  }
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

  // Get current user ID BEFORE rendering
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
            <td><strong>${employee.fullname}</strong></td>
            <td>${employee.position}</td>
            <td>${employee.brand}</td>
            <td><span class="status-${employee.status.toLowerCase()}">${
        employee.status
      }</span></td>
            <td>${employee.shift}</td>
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
            <td class="Col9" onclick="copyQRCode('${employee.qr_code}')" title="Copy Proximity code"><i class='fas fa-qrcode'></i></td>
            <td><small>${employee.created_at}</small></td>
            <td><small>${employee.updated_at}</small></td>
            <td>
              <div style="display: flex; gap: 0.5rem;">
                <div style="display: grid; grid-template-row: 20px; gap: 0.2rem; flex: 0.5;">
                  <button class="btn btn-success btn-sm2" onclick="addToLog(${
                    employee.id
                  }, 'IN')" title="Check: IN">🟢 IN</button>
                  <button class="btn btn-danger btn-sm2" onclick="addToLog(${
                    employee.id
                  }, 'OUT')" title="Check: OUT">🔴 OUT</button>
                </div>
                <button class="btn btn-primary btn-sm" onclick="openModal('edit', ${
                  employee.id
                })" title="EDIT"><i class="fas fa-edit"></i> Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${
                  employee.id
                })" title="DELETE"><i class="fas fa-trash-alt"></i> Delete</button>
              </div>
            </td>
        </tr>
    `;
    })
    .join("");

  // Update pagination controls
  updatePaginationControls();
}

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
    }
  } catch (error) {
    console.error("Error getting user ID:", error);
  }

  return "default"; // fallback
}

function copyQRCode(qrCode) {
  // Create a temporary textarea element to hold the text
  const tempTextArea = document.createElement('textarea');
  tempTextArea.value = qrCode;
  document.body.appendChild(tempTextArea);
  
  // Select and copy the text
  tempTextArea.select();
  tempTextArea.setSelectionRange(0, 99999); // For mobile devices
  
  try {
    // Copy the text to clipboard
    document.execCommand('copy');
    
    // Show success message (optional)
    showAlert('Proximity code copied to clipboard!');
    
    // Alternative: Use a more subtle notification
    // console.log('QR code copied:', qrCode);
    
  } catch (err) {
    // Fallback for modern browsers using the Clipboard API
    if (navigator.clipboard) {
      navigator.clipboard.writeText(qrCode).then(() => {
        showAlert('Proximity code copied to clipboard!');
      }).catch(() => {
        showAlert('Failed to copy Proximity code');
      });
    } else {
      showAlert('Failed to copy Proximity code');
    }
  }
  
  // Remove the temporary textarea
  document.body.removeChild(tempTextArea);
}

// Add these new pagination functions
function updatePaginationControls() {
  const paginationDiv = document.getElementById("pagination");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const pageInfo = document.getElementById("page-info");

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

// Search employees
function searchEmployees() {
  const formData = new FormData(document.getElementById("searchForm"));
  const filters = {};

  for (let [key, value] of formData.entries()) {
    if (value.trim()) {
      filters[key] = value.trim();
    }
  }

  // Reset to page 1 for new searches
  currentPage = 1;
  loadEmployees(filters);
}

// Clear search
function clearSearch() {
  document.getElementById("searchForm").reset();
  // Reset to page 1 when clearing search
  currentPage = 1;
  loadEmployees();
}

// Open modal
async function openModal(action, employeeId = null) {
  currentAction = action;
  const modal = document.getElementById("employeeModal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("employeeForm");

  // Reset form
  form.reset();
  document.getElementById("employee_id").value = ""; // Fixed ID reference

  // Reset file upload label
  const fileLabel = document.querySelector(".file-upload-label");
  fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;

  if (action === "add") {
    modalTitle.textContent = "Add Employee";
    // Set default values for new employee
    document.getElementById("status").value = "Active";
  } else if (action === "edit" && employeeId) {
    modalTitle.textContent = "Edit Employee";
    await loadEmployeeData(employeeId);
  }

  modal.style.display = "block";
}

// Load employee data - Modified to preserve pagination
async function loadEmployees(filters = {}, preservePage = false) {
  try {
    showLoading(true);

    const params = new URLSearchParams({
      action: "get", // or 'list' - both work according to your backend
      ...filters,
    });

    const response = await fetch(
      `../cnfg/manpower_backend.php?${params.toString()}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      employees = data.data;

      // Only reset to page 1 if not preserving page and not filtering
      if (!preservePage && Object.keys(filters).length === 0) {
        currentPage = 1;
      }

      await renderEmployeeTable();

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
  modal.style.display = "none";

  // Reset form
  const form = document.getElementById("employeeForm");
  form.reset();

  // Reset file upload label
  const fileLabel = document.querySelector(".file-upload-label");
  fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
}

// Handle form submission - Modified with duplicate name validation
async function handleFormSubmit(e) {
  e.preventDefault();

  try {
    // Basic form validation
    const fullname = document.getElementById("fullname").value.trim();
    const position = document.getElementById("position").value.trim();
    const brand = document.getElementById("brand").value.trim();
    const shift = document.getElementById("shift").value;
    const qrcode = document.getElementById("qr_code").value.trim();
    const employeeId = document.getElementById("employee_id").value;

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

    if (!qrcode) {
      showAlert("Proximity Code is required", "error");
      return;
    }

    // Check for duplicate fullname
    const isDuplicate = employees.some((emp) => {
      // For edit mode, exclude the current employee from duplicate check
      if (currentAction === "edit" && employeeId && emp.id == employeeId) {
        return false;
      }
      // Case-insensitive comparison
      return (
        emp.fullname.toLowerCase().trim() === fullname.toLowerCase().trim()
      );
    });

    if (isDuplicate) {
      showAlert(`Employee with name "${fullname}" already exists!`, "error");
      return;
    }

    // Check file size if image is selected
    const imageInput = document.getElementById("image");
    if (imageInput.files.length > 0) {
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

    const response = await fetch("../cnfg/manpower_backend.php", {
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

      // Preserve current page when updating, reset to page 1 when adding
      const preservePage = currentAction === "edit";
      loadEmployees({}, preservePage);
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

function setupFileUploadHandler() {
  document.getElementById("image").addEventListener("change", function (e) {
    const label = document.querySelector(".file-upload-label");
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      const maxSize = 5 * 1024 * 1024; // 5MB

      if (file.size > maxSize) {
        showAlert("File size must be less than 5MB", "error");
        e.target.value = ""; // Clear the input
        label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
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
        label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
        return;
      }

      label.innerHTML = `<i class="fas fa-image"></i> ${file.name}`;
    } else {
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
    }
  });
}

// Delete employee - Modified to preserve current page
async function deleteEmployee(employeeId) {
  if (!confirm("Are you sure you want to delete this employee?")) {
    return;
  }

  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch("../cnfg/manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      // Preserve current page after deletion
      loadEmployees({}, true);
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

    const response = await fetch("../cnfg/manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      // Reset to page 1 after deleting all
      currentPage = 1;
      loadEmployees(); // Reload the table (will show empty)
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Delete all employee data", "success");
    // Reset to page 1 after error
    currentPage = 1;
    loadEmployees(); // Reload the table (will show empty)
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

// Close modal when clicking outside
window.onclick = function (event) {
  const modal = document.getElementById("employeeModal");
  if (event.target === modal) {
    closeModal();
  }
};
