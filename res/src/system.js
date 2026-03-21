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
    "#searchForm input, #searchForm select",
  );

  searchInputs.forEach((input) => {
    input.addEventListener("input", debounce(searchEmployees, 300));
  });

  // 🔥 AUTO-FOCUS LOGIC
  const codeInput = document.getElementById("search_qr");

  function autoFocus() {
    const active = document.activeElement;

    // Check if active element is NOT an input, select, or textarea
    const isTyping =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "SELECT" ||
        active.tagName === "TEXTAREA");

    if (!isTyping && codeInput) {
      codeInput.focus();
    }
  }

  // Run on page load
  autoFocus();

  // Re-check when user clicks anywhere
  document.addEventListener("click", autoFocus);

  // Re-check when focus changes (keyboard navigation, tabbing, etc.)
  document.addEventListener("focusin", autoFocus);
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
      },
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
        // Get current user ID to construct proper image path
        const currentUserId = await getCurrentUserId();
        const imagePath = `../../uploads/user_${currentUserId}/${employee.image}`;
        
        // Display image preview with styling
        fileLabel.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <img src="${imagePath}" alt="Current employee image" style="max-width: 100%; max-height: 200px; border-radius: 8px; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
          </div>
        `;
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

// 🆕 Update total employees count
async function updateTotalEmployees() {
  try {
    const totalEmployeesElement = document.getElementById("total_employees");
 
    if (totalEmployeesElement) {
      // Update with current employees array length
      totalEmployeesElement.textContent = employees.length;
      console.log("✓ Total employees updated:", employees.length);
    }
  } catch (error) {
    console.error("Error updating total employees:", error);
  }
}

// 🆕 Update active employees count - FIXED VERSION
async function updateActiveEmployees() {
  try {
    const activeEmployeesElement = document.getElementById("active_employees");
    const inactiveEmployeesElement = document.getElementById("inactive_employees");
 
    if (!activeEmployeesElement || !inactiveEmployeesElement) {
      console.warn("Active employees element not found");
      return 0;
    }
 
    if (!Array.isArray(employees)) {
      console.error("Employees array not initialized");
      return 0;
    }
 
    // Filter employees with "Active" status (case-insensitive)
    const activeCount = employees.filter(
      (emp) => emp.status && emp.status.toLowerCase() === "active"
    ).length;

    const inactiveCount = employees.length - activeCount;
 
    activeEmployeesElement.textContent = activeCount;
    inactiveEmployeesElement.textContent = inactiveCount;
    console.log("✓ Active employees updated:", activeCount);
    console.log("✓ Inactive employees updated:", inactiveCount);
 
    return count;
  } catch (error) {
    console.error("Error updating active employees:", error);
    return 0;
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
            <td class="Col9" onclick="copyQRCode('${employee.qr_code}')" title="Copy Proximity code">
            <img src="../icon/nfc-icon.png" alt="Copy Proximity code" style="width: 20px; height: 20px;"></td>
            <td><small>${employee.created_at}</small></td>
            <td><small>${employee.updated_at}</small></td>
            <td>
              <div style="display: flex; gap: 0.5rem;">
                <div style="display: grid; grid-template-row: 20px; gap: 0.2rem; flex: 0.5;">
                  <button class="btn btn-success btn-sm2" onclick="addToLog(${
                    employee.id
                  }, 'IN')" title="Check: IN">🟢\nIN</button>
                  <button class="btn btn-danger btn-sm2" onclick="addToLog(${
                    employee.id
                  }, 'OUT')" title="Check: OUT">🔴\nOUT</button>
                </div>
                <button class="btn btn-primary btn-sm" onclick="openModal('edit', ${employee.id})" title="EDIT"><i class="fas fa-edit"></i>\nEdit</button>
                <button class="btn btn-danger btn-sm" onclick="openDeleteModal('${employee.id}', false)" title="DELETE"><i class="fas fa-trash-alt"></i>\nDelete</button>
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
  const searchForm = document.getElementById("searchForm");
  const searchQuery = document.getElementById("search_qr").value.trim();

  if (!searchForm) return;

  const formData = new FormData(searchForm);
  const filters = {};

  for (let [key, value] of formData.entries()) {
    if (value.trim()) {
      filters[key] = value.trim();
    }
  }

  loadEmployees(filters);

  // ✅ AUTO-CLEAR AFTER SUCCESSFUL SEARCH
  if (searchQuery) {
    document.getElementById("search_qr").value = "";
  }
}

// Clear search
function clearSearch() {
  const searchForm = document.getElementById("searchForm");
  if (searchForm) {
    searchForm.reset();
    loadEmployees();
  }
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

  if (action === "add") {
    // Autofocus on qr_code input after modal is displayed
    qrCodeInput.focus();
  }
}

function openDeleteModal(employeeId = null, requireConfirmation = false) {
  const modal = document.getElementById("deleteModal");
  const confirmBtn = document.getElementById("confirmDeleteBtn");
  const confirmationInput = document.getElementById("confirmationInput");
  const confirmationContainer = document.getElementById("confirmationContainer");
  const modalTitle = document.getElementById("deleteModalTitle");
  const modalMessage = document.getElementById("deleteModalMessage");
 
  // Store the employeeId for use in confirm handler
  confirmBtn.dataset.employeeId = employeeId;
  confirmBtn.dataset.requireConfirmation = requireConfirmation;
 
  // Update modal content based on delete type
  if (requireConfirmation) {
    // Delete all employees
    modalTitle.textContent = "⚠️ Delete All Employees";
    modalMessage.textContent =
      "This will permanently delete ALL employee data. This action cannot be undone.";
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
    confirmationInput.parentNode.replaceChild(newConfirmationInput, confirmationInput);

    newConfirmationInput.focus();
 
    newConfirmationInput.addEventListener("input", () => {
      newConfirmBtn.disabled = newConfirmationInput.value !== "DELETE ALL";
      newConfirmBtn.style.opacity = newConfirmBtn.disabled ? "0.5" : "1";
      newConfirmBtn.style.cursor = newConfirmBtn.disabled ? "not-allowed" : "pointer";
    });
  }
 
  // Handle confirm click
  newConfirmBtn.addEventListener("click", () => {
    const id = newConfirmBtn.dataset.employeeId;
    const requiresConfirm = newConfirmBtn.dataset.requireConfirmation === "true";
 
    if (requiresConfirm) {
      deleteAllEmployees();
    } else {
      deleteEmployee(id);
    }
    modal.style.display = "none";
  });
 
  // Handle clicking outside modal
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });
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

      await renderEmployeeTable();
      await updateTotalEmployees(); // 🆕 Update total employees count
      await updateActiveEmployees(); // 🆕 Update active count after loading
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

  // Reset file upload label
  const fileLabel = document.querySelector(".file-upload-label");
  if (fileLabel) {
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
  }
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
        "success",
      );
      closeModal();

      // Preserve current page when updating, reset to page 1 when adding
      const preservePage = currentAction === "edit";
      await loadEmployees({}, preservePage);
      await updateTotalEmployees(); // 🆕 Update total employees count
      await updateActiveEmployees(); // 🆕 Update active count after loading
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

      // Create image preview using FileReader
      const reader = new FileReader();
      reader.onload = function (event) {
        // Show new image preview with indication it's a new selection
        label.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <img src="${event.target.result}" alt="New image preview" style="max-width: 100%; max-height: 200px; border-radius: 8px; object-fit: cover; box-shadow: 0 2px 8px rgba(0,0,0,0.15), 0 0 0 2px #4CAF50;">
            <small style="color: #4CAF50; font-size: 12px; font-weight: 500;">✓ New image selected</small>
          </div>
        `;
      };
      reader.readAsDataURL(file);
    } else {
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 1MB)`;
    }
  });
}

// Delete employee - Modified to preserve current page
async function deleteEmployee(employeeId) {
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
      await loadEmployees({}, true);
      await updateTotalEmployees(); // 🆕 Update total employees count
      await updateActiveEmployees(); // 🆕 Update active count after loading
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
      await loadEmployees(); // Reload the table (will show empty)
      await updateTotalEmployees(); // 🆕 Update total employees count
      await updateActiveEmployees(); // 🆕 Update active count after loading
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Delete all employee data", "success");
    // Reset to page 1 after error
    currentPage = 1;
    await loadEmployees(); // Reload the table (will show empty)
    await updateTotalEmployees(); // 🆕 Update total employees count
    await updateActiveEmployees(); // 🆕 Update active count after loading
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