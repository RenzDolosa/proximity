//system.js

// Global variables
let currentAction = "add";
let employees = [];

// Pagination variables
let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;

let currentAudio = null;

// FILTER STATE - Track active filters
let activeFilters = {};

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  loadEmployees();
  setupEventListeners();
  updateDeleteButtonState();
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

  const dateInput = document.getElementById("search_date");
  if (dateInput) {
    dateInput.addEventListener("change", function () {
      const clearBtn = document.getElementById("clear_date_btn");
      if (clearBtn) clearBtn.style.display = this.value ? "block" : "none";
    });
  }

  const codeInput = document.getElementById("search_qr");

  function autoFocus() {
    const active = document.activeElement;
    const isTyping =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "SELECT" ||
        active.tagName === "TEXTAREA");

    if (!isTyping && codeInput) {
      codeInput.focus();
    }
  }

  autoFocus();
  document.addEventListener("click", autoFocus);
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
const playInactiveSound = () => playSound("inactiveSound");
const playNoResultSound = () => playSound("noResultSound");
const playWarningSound = () => playSound("warningSound");

// Load employee data for editing
async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `../cnfg/manpower_backend.php?action=get_single&id=${employeeId}`,
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
    );

    const data = await response.json();

    if (data.success && data.data) {
      const employee = data.data;

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
        const imagePath = `${window.location.origin}/uploads/user/${employee.image}`;

        fileLabel.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <img id="existingImagePreview" src="${imagePath}" alt="Current employee image" loading="lazy"
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
  try {
    const totalEmployeesElement = document.getElementById("total_employees");
    if (totalEmployeesElement) {
      totalEmployeesElement.textContent = employees.length;
    }
  } catch (error) {
    console.error("Error updating total employees:", error);
  }
}

// Update active employees count
async function updateActiveEmployees() {
  try {
    const activeEmployeesElement = document.getElementById("active_employees");
    const inactiveEmployeesElement =
      document.getElementById("inactive_employees");

    if (!activeEmployeesElement || !inactiveEmployeesElement) return 0;
    if (!Array.isArray(employees)) return 0;

    const activeCount = employees.filter(
      (emp) => emp.status && emp.status.toLowerCase() === "active",
    ).length;

    const inactiveCount = employees.length - activeCount;

    activeEmployeesElement.textContent = activeCount;
    inactiveEmployeesElement.textContent = inactiveCount;

    return activeCount;
  } catch (error) {
    console.error("Error updating active employees:", error);
    return 0;
  }
}

// Add employee to access log
async function addToLog(employeeId, checkStatus = "IN", triggerElement = null) {
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
      check_status: checkStatus,
      access_timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    };

    const response = await fetch("../cnfg/add_to_log.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logData),
    });

    const result = await response.json();

    if (result.success) {
      if (hasViolations) playWarningSound();
      else if (hasInactive) playInactiveSound();
      else playSuccessSound();

      showAlert(`Employee marked as ${checkStatus} successfully!`, "success");
    } else {
      throw new Error(result.message || "Failed to add employee to log");
    }
  } catch (error) {
    console.error("Error adding to log:", error);
    showAlert("Error: " + error.message, "error");
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

  tbody.innerHTML = `
    <tr>
      <td colspan="13" style="text-align: center; padding: 20px; color: #c0392b;">
        ⚠️ ${message}
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

  totalPages = Math.ceil(employees.length / itemsPerPage);

  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentEmployees = employees.slice(startIndex, endIndex);

  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      const fullnameInitials = (employee.fullname || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      String.prototype.toProperCase = function () {
        return this.replace(/[^\s,\-]+/g, function (txt) {
          return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
        });
      };

      const isAboveFold = index < 5;
      const thumbSrc = `${window.location.origin}/uploads/user/thumb_${employee.image}`;
      const imageSrc = `${window.location.origin}/uploads/user/${employee.image}`;

      return `
        <tr>
            <td>${startIndex + index + 1}</td>
            <td><strong>${employee.id}</strong></td>
            <td><strong>${employee.fullname.toProperCase()}</strong></td>
            <td>${employee.position.toProperCase()}</td>
            <td>${employee.brand.toProperCase()}</td>
            <td><span class="status-${employee.status.toLowerCase()}">${employee.status}</span></td>
            <td>${employee.shift}</td>
            <td class="Col7"><div style="height: 50px; overflow-y: auto; scrollbar-width: thin; align-content: center;">
              <small>${employee.violation || "None"}</small></div></td>
            <td class="Col8">${
              employee.image
                ? `<img src="${thumbSrc}" alt="${employee.fullname}" class="employee-image"
                    width="48" height="48"
                    loading="${isAboveFold ? "eager" : "lazy"}"
                    decoding="async"
                    ${isAboveFold ? 'fetchpriority="high"' : ''}
                    onerror="this.src='${imageSrc}'; this.onerror=null;">
                  <span style="display:none;">📷</span>`
                : `<div class="ph-cont"><div class="employee-ph">${fullnameInitials}</div></div>`
            }</td>
            <td class="Col9" onclick="copyQRCode('${employee.qr_code}')" title="Copy Proximity code">
              <img src="../icon/nfc-icon.svg" alt="Copy Proximity code" loading="lazy" style="width: 20px; height: 20px;"></td>
            <td><small>${employee.created_at}</small></td>
            <td><small>${employee.updated_at}</small></td>
            <td>
              <div style="display: flex; gap: 0.5rem;">
                <div style="display: grid; grid-template-row: 20px; gap: 0.2rem; flex: 0.5;">
                  <button class="btn btn-success btn-sm2" onclick="addToLog(${employee.id}, 'IN', this)"  title="Check: IN">🟢\nIN</button>
                  <button class="btn btn-danger btn-sm2"  onclick="addToLog(${employee.id}, 'OUT', this)" title="Check: OUT">🔴\nOUT</button>
                </div>
                <button class="btn btn-primary btn-sm" onclick="openModal('edit', ${employee.id})" title="EDIT"><i class="fas fa-edit"></i>\nEdit</button>
                <button class="btn btn-danger btn-sm" onclick="openDeleteModal('${employee.id}', false)" title="DELETE"><i class="fas fa-trash-alt"></i>\nDelete</button>
              </div>
            </td>
        </tr>
      `;
    })
    .join("");

  updatePaginationControls();
}

async function getCurrentUserId() {
  try {
    const response = await fetch("../cnfg/get_user_id.php", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (response.ok) {
      const data = await response.json();
      return data.user_id || "default";
    }
  } catch (error) {
    console.error("Error getting user ID:", error);
  }

  return "default";
}

function copyQRCode(code) {
  const tempTextArea = document.createElement("textarea");
  tempTextArea.value = code;
  document.body.appendChild(tempTextArea);
  tempTextArea.select();
  tempTextArea.setSelectionRange(0, 99999);

  try {
    document.execCommand("copy");
    showAlert("Proximity code copied to clipboard!");
  } catch (err) {
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(code)
        .then(() => showAlert("Proximity code copied to clipboard!"))
        .catch(() => showAlert("Failed to copy Proximity code"));
    } else {
      showAlert("Failed to copy Proximity code");
    }
  }

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
  loadEmployees(filters, true);

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
  loadEmployees({}, false);
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

  // Reset form and critical hidden fields
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
    qrCodeInput.focus();
  } else if (action === "edit" && employeeId) {
    modalTitle.innerHTML = `<i class="fas fa-edit" style="color:#7c3aed"></i> Edit Employee`;
    modal.style.display = "block";
    await loadEmployeeData(employeeId);
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

    const response = await fetch("../cnfg/manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(
        `Successfully deleted ${data.deleted_count || employeeIds.length} employee(s) matching your filters.`,
        "success",
      );

      currentPage = 1;
      clearSearch();
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

  function toProperCase(str) {
    return str.replace(
      /[^\s,\-]+/g,
      (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    );
  }

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
async function loadEmployees(filters = {}, preservePage = false) {
  try {
    showLoading(true);

    if (Object.keys(filters).length === 0 && hasActiveFilters()) {
      filters = getActiveFilters();
    }

    activeFilters = filters;

    const params = new URLSearchParams({ action: "get" });

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

    const response = await fetch(
      `../cnfg/manpower_backend.php?${params.toString()}`,
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;
      populateFilter(employees);

      if (!preservePage && Object.keys(filters).length === 0) {
        currentPage = 1;
      }

      await renderEmployeeTable();
      await updateTotalEmployees();
      await updateActiveEmployees();

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

  const form = document.getElementById("employeeForm");
  if (form) form.reset();

  const fileLabel = document.querySelector(".file-upload-label");
  const imageInput = document.getElementById("image");

  if (fileLabel)
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
  if (imageInput) imageInput.value = "";
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

    if (currentAction === "edit" && empid !== originalId) {
      const idTaken = employees.some((emp) => String(emp.id) === String(empid));
      if (idTaken) {
        showAlert(`Employee ID "${empid}" is already in use`, "error");
        return;
      }
    }

    const isDuplicate = employees.some((emp) => {
      if (
        currentAction === "edit" &&
        originalId &&
        String(emp.id) === String(originalId)
      ) {
        return false;
      }
      return (
        emp.fullname.toLowerCase().trim() === fullname.toLowerCase().trim()
      );
    });

    if (isDuplicate) {
      showAlert(`Employee with name "${fullname}" already exists!`, "error");
      return;
    }

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
        showAlert("Only image files (JPEG, PNG, GIF, WebP) are allowed", "error");
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

    const response = await fetch("../cnfg/manpower_backend.php", {
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
      await loadEmployees(filtersToUse, preservePage);

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
// Converts any image File to WebP using Canvas API.
// Falls back to original file if browser doesn't support WebP encoding.
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
      // Fill white background (handles transparent PNGs)
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
            // Browser doesn't support WebP encoding — return original
            resolve(file);
          }
        },
        "image/webp",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fallback: return original on load error
    };

    img.src = objectUrl;
  });
}

// ─────────────────────────────────────────────────────────────
// FILE UPLOAD HANDLER  (now converts to WebP before storing)
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

    // --- Validation ---
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
      showAlert("Only image files are allowed (JPEG, PNG, GIF, WebP)", "error");
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    // Show converting indicator
    label.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        <i class="fas fa-spinner fa-spin" style="font-size:24px;color:#2196F3;"></i>
        <small style="color:#2196F3;">Converting to WebP…</small>
      </div>`;

    try {
      // --- Convert to WebP ---
      const webpFile = await convertImageToWebP(file);

      // Replace file in the input via DataTransfer
      const dt = new DataTransfer();
      dt.items.add(webpFile);
      imageInput.files = dt.files;

      // --- Show preview from the converted WebP blob ---
      const reader = new FileReader();
      reader.onload = (event) => {
        const isConverted = webpFile.type === "image/webp" && file.type !== "image/webp";
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

    const response = await fetch("../cnfg/manpower_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      await loadEmployees(activeFilters, true);
      await updateTotalEmployees();
      await updateActiveEmployees();
    } else {
      showAlert(data.message || "Failed to delete proximity code", "error");
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

    const response = await fetch("../cnfg/manpower_backend.php", {
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
    showAlert("Delete all employee data", "success");
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