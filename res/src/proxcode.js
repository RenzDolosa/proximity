//proxcode.js - Proximity Management System (FIXED)

// Global variables
let currentAction = "add";
let employees = [];
let currentUserId = null; // Cache current user ID

// Pagination variables
let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;

let currentAudio = null;

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  loadCurrentUserId(); // Load and cache user ID first
  loadEmployees();
  setupEventListeners();
});

// Load and cache current user ID
async function loadCurrentUserId() {
  try {
    const response = await fetch("../cnfg/proxcode_backend.php?action=user_info", {
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
    "#searchForm input, #searchForm select"
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
  stopCurrentAudio();
  const sound = document.getElementById("successSound");
  if (sound) {
    currentAudio = sound;
    sound.currentTime = 0;
    sound.play().catch((e) => console.log("Audio play error:", e));
  }
}

function playInactiveSound() {
  stopCurrentAudio();
  const sound = document.getElementById("inactiveSound");
  if (sound) {
    currentAudio = sound;
    sound.currentTime = 0;
    sound.play().catch((e) => console.log("Audio play error:", e));
  }
}

function playNoResultSound() {
  stopCurrentAudio();
  const sound = document.getElementById("noResultSound");
  if (sound) {
    currentAudio = sound;
    sound.currentTime = 0;
    sound.play().catch((e) => console.log("Audio play error:", e));
  }
}

function playWarningSound() {
  stopCurrentAudio();
  const sound = document.getElementById("warningSound");
  if (sound) {
    currentAudio = sound;
    sound.currentTime = 0;
    sound.play().catch((e) => console.log("Audio play error:", e));
  }
}

// Load proximity code for editing
async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `../cnfg/proxcode_backend.php?action=get_single&id=${employeeId}`,
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

// Render proximity code table
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

  // Render table rows
  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      // Generate initials for placeholder
      const fullnameInitials = (employee.qr_code || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const imageUrl = employee.image 
        ? `../../uploads/user_${userId}/${employee.image}` 
        : null;

      return `
        <tr>
            <td>${startIndex + index + 1}</td>
            <td class="Col8">
              ${
                imageUrl
                  ? `<img src="${imageUrl}" alt="${employee.qr_code}" class="employee-image" onerror="this.style.display='none'; this.nextSibling.style.display='inline';">
                    <span style="display:none;">📷</span>`
                  : `<div class="ph-cont"><div class="employee-ph">${fullnameInitials}</div></div>`
              }
            </td>
            <td class="Col9" onclick="copyQRCode('${escapeHtml(employee.qr_code)}')" title="Copy Proximity code" style="cursor: pointer;">
              <img src="../icon/nfc-icon.png" alt="Copy Proximity code" style="width: 20px; height: 20px;">
            </td>
            <td><small>${employee.created_at || ''}</small></td>
            <td><small>${employee.updated_at || ''}</small></td>
            <td>
              <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-primary btn-sm" onclick="openModal('edit', ${employee.id})" title="EDIT"><i class="fas fa-edit"></i> Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteEmployee(${employee.id})" title="DELETE"><i class="fas fa-trash-alt"></i> Delete</button>
              </div>
            </td>
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

// Add these new pagination functions
function updatePaginationControls() {
  const paginationDiv = document.getElementById("pagination");
  const prevBtn = document.getElementById("prev-btn");
  const nextBtn = document.getElementById("next-btn");
  const pageInfo = document.getElementById("page-info");

  if (!paginationDiv || !prevBtn || !nextBtn || !pageInfo) {
    return;
  }

  if (totalPages <= 1) {
    paginationDiv.style.display = "none";
    return;
  }

  paginationDiv.style.display = "flex";

  // Update page info
  pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${employees.length} total proximity codes)`;

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
async function searchEmployees() {
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("search_qr");
  
  if (!searchForm || !searchInput) return;

  const searchQuery = searchInput.value.trim();
  const formData = new FormData(searchForm);
  const filters = {};

  for (let [key, value] of formData.entries()) {
    if (value.trim()) {
      filters[key] = value.trim();
    }
  }

  // Load employees with filters
  await loadEmployees(filters);

  // ✅ CLEAR AFTER SUCCESSFUL SEARCH
  if (searchQuery) {
    searchInput.value = "";
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
    modalTitle.textContent = "Add Proximity Code";
  } else if (action === "edit" && employeeId) {
    modalTitle.textContent = "Edit Proximity Code";
    await loadEmployeeData(employeeId);
  }

  modal.style.display = "block";
}

// Load proximity code - Modified to preserve pagination
async function loadEmployees(filters = {}, preservePage = false) {
  try {
    showLoading(true);

    const params = new URLSearchParams({
      action: "get",
      ...filters,
    });

    const response = await fetch(
      `../cnfg/proxcode_backend.php?${params.toString()}`,
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

    if (data.success && Array.isArray(data.data)) {
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
  if (!modal) return;

  modal.style.display = "none";

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
      showAlert(
        `Proximity code "${qrCode}" already exists!`,
        "error"
      );
      return;
    }

    showLoading(true);

    const formData = new FormData(e.target);
    formData.append("action", currentAction);

    const response = await fetch("../cnfg/proxcode_backend.php", {
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
        "success"
      );
      closeModal();

      // Preserve current page when updating, reset to page 1 when adding
      const preservePage = currentAction === "edit";
      await loadEmployees({}, preservePage);
    } else {
      showAlert(data.message || "Failed to save proximity code", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert(
      "Failed to save proximity code. Please check your connection.",
      "error"
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

// Delete proximity code - Modified to preserve current page
async function deleteEmployee(employeeId) {
  if (!confirm("Are you sure you want to delete this proximity code?")) {
    return;
  }

  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch("../cnfg/proxcode_backend.php", {
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
      showAlert(data.message || "Proximity code deleted successfully", "success");
      // Preserve current page after deletion
      await loadEmployees({}, true);
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
  if (
    !confirm(
      "⚠️ WARNING: This will permanently delete ALL employee data!\n\nThis action cannot be undone. Are you absolutely sure?",
    )
  ) {
    return;
  }

  // Double confirmation
  if (
    !confirm(
      '🚨 FINAL WARNING: You are about to delete ALL employees and their data.\n\nType "DELETE ALL" in the next dialog to confirm.',
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
    formData.append("id", employeeId);

    const response = await fetch("../cnfg/proxcode_backend.php", {
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
    showAlert("Delete all proximity codes", "success");
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