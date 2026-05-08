// resource/js/dtl.js --> datalog table

let currentAction = "add";
let employees = [];
let employeeDataCache = null;
let qrImageMapCache = null;

let autoUpdateInterval = null;
let autoUpdateEnabled = false;
let lastUpdateTimestamp = null;
let userActivityTimer = null;
let isUserActive = false;

let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;
let totalRecords = 0;

let activeFilters = {};

const count = employees.length;
const label = count > 1 ? "employee's" : "employee";

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

function toProperCase(str) {
  if (!str) return "";
  return String(str).replace(/[^\s,\-]+/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
  });
}

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

  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  if (autoUpdateToggle) {
    autoUpdateToggle.addEventListener("change", toggleAutoUpdate);
  }

  const intervalSelector = document.getElementById("updateInterval");
  if (intervalSelector) {
    intervalSelector.addEventListener("change", updateAutoUpdateInterval);
  }
}

function initializeAutoUpdate() {
  const toggle = document.getElementById("autoUpdateToggle");
  const intervalSelector = document.getElementById("updateInterval");

  if (!toggle || !intervalSelector) {
    console.warn("Auto-update elements not found, skipping initialization");
    return;
  }

  autoUpdateEnabled = toggle.checked || false;
  const defaultInterval = parseInt(intervalSelector.value) || 30000;

  if (autoUpdateEnabled) {
    startAutoUpdate(defaultInterval);
  }

  updateAutoUpdateUI();
  setupUserActivityTracking();
}

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

function formatInterval(intervalMs) {
  if (intervalMs < 60000) {
    return `${intervalMs / 1000}s`;
  } else {
    const minutes = Math.floor(intervalMs / 60000);
    return `${minutes}min`;
  }
}

function getSelectedInterval() {
  const selector = document.getElementById("updateInterval");
  return selector ? parseInt(selector.value) || 30000 : 30000;
}

function startAutoUpdate(intervalMs) {
  stopAutoUpdate();

  autoUpdateInterval = setInterval(() => {
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

function stopAutoUpdate() {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
    console.log("Auto-update stopped");
  }
}

function checkForChanges(newData) {
  if (!employees || employees.length !== newData.length) {
    return true;
  }

  const oldEmployeeMap = new Map(
    employees.map((emp) => [emp.id, JSON.stringify(emp)]),
  );

  for (const newEmp of newData) {
    const oldEmpJson = oldEmployeeMap.get(newEmp.id);
    const newEmpJson = JSON.stringify(newEmp);

    if (!oldEmpJson || oldEmpJson !== newEmpJson) {
      return true;
    }
  }

  return false;
}

function updateStatistic(elementId, newValue) {
  const element = document.getElementById(elementId);
  if (element && element.textContent !== newValue.toLocaleString()) {
    element.classList.add("fade-in");
    element.textContent = newValue.toLocaleString();
    setTimeout(() => element.classList.remove("fade-in"), 500);
  }
}

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
    lastUpdate.style.cssText = `
      display: block;
      color: #ffffff;
      font-size: 12px;
    `;
  } else if (lastUpdate) {
    lastUpdate.style.display = "none";
  }

  if (intervalSelector) {
    intervalSelector.disabled = !autoUpdateEnabled;
    intervalSelector.style.opacity = autoUpdateEnabled ? "1" : "0.5";
  }
}

function handleUserActivity() {
  isUserActive = true;
  clearTimeout(userActivityTimer);

  userActivityTimer = setTimeout(() => {
    isUserActive = false;
    console.log("User activity paused, resuming auto-update");
  }, 1000);
}

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
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 11px;
      border: 1px solid #b8e6b8;
      transition: opacity 0.3s ease;
    `;

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

async function loadEmployeesAuto(filters = {}) {
  try {
    const filtersToUse =
      Object.keys(activeFilters).length > 0
        ? activeFilters
        : hasActiveFilters()
          ? getActiveFilters()
          : {};

    const params = new URLSearchParams({ action: "get" });

    params.append("page", currentPage);
    params.append("limit", itemsPerPage);

    for (const [key, value] of Object.entries(filtersToUse)) {
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
      } else if (key === "user_id" && value === "__none__") {
        params.append("user_id_none", "1");
      } else if (key === "user_id") {
        params.append("gate_name", value);
      } else {
        params.append(key, value);
      }
    }

    const response = await fetch(`datalog_backend.php?${params.toString()}`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      const hasChanges = checkForChanges(data.data);

      if (hasChanges) {
        employees = data.data;
        employeeDataCache = null;
        qrImageMapCache = null;
        await renderEmployeeTable();
        showAutoUpdateNotification();
        console.log(`Auto-update: ${employees.length} records refreshed`);
      } else {
        console.log("Auto-update: No changes detected");
      }

      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
      resetNetworkErrorCount();
    } else {
      console.warn(
        "Auto-update failed:",
        data.message || "Invalid data format",
      );
    }
  } catch (error) {
    console.error("Auto-update error:", error);
    if (error.name === "TimeoutError") {
      console.warn("Auto-update timeout - server may be slow");
    } else if (
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError")
    ) {
      console.warn("Auto-update: Network connection issue");
      handleNetworkError();
    } else if (error.name === "AbortError") {
      console.warn("Auto-update request was aborted");
    }
  }
}

let networkErrorCount = 0;
function handleNetworkError() {
  networkErrorCount++;

  if (networkErrorCount >= 3) {
    stopAutoUpdate();
    autoUpdateEnabled = false;
    updateAutoUpdateUI();
    showAlert(
      "Auto-update disabled due to repeated connection issues",
      "warning",
    );
    networkErrorCount = 0;
  }
}

function resetNetworkErrorCount() {
  if (networkErrorCount > 0) {
    networkErrorCount = 0;
    console.log("Network connection restored");
  }
}

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

  if (filters.position === "__none__") {
    filters.position = "__none__";
  }

  if (filters.brand === "__none__") {
    filters.brand = "__none__";
  }

  if (filters.violation === "__none__") {
    filters.violation = "__none__";
  }

  if (filters.user_id === "__none__") {
    filters.user_id = "__none__";
  }

  return filters;
}

function hasActiveFilters() {
  const filters = getActiveFilters();
  return Object.keys(filters).length > 0;
}

function displayFilterStatus() {
  const filters = getActiveFilters();
  const filterInfo = document.createElement("div");

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

async function getManpowerEmployeeData() {
  try {
    if (employeeDataCache) {
      return employeeDataCache;
    }

    const response = await fetch("manpower_backend.php?action=get", {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        employeeDataCache = data.data;
        return data.data;
      }
    }
  } catch (error) {
    console.error("Error fetching manpower employee data:", error);
  }

  return [];
}

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
        user_id: emp.user_id,
      };
    }
  });
  qrImageMapCache = qrImageMap;
  return qrImageMap;
}

async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `datalog_backend.php?action=get_single&id=${encodeURIComponent(employeeId)}`,
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

      const fields = {
        employee_id: employee.id,
        fullname: employee.fullname || "",
        position: employee.position || "",
        brand: employee.brand || "",
        status: employee.status || "Active",
        shift: employee.shift || "",
        violation: employee.violation || "",
        check_status: employee.check_status || "",
        user_id: employee.user_id || "",
        access_timestamp: employee.access_timestamp || "",
      };

      Object.entries(fields).forEach(([fieldId, value]) => {
        const field = document.getElementById(fieldId);
        if (field) {
          field.value = value;
        }
      });

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
        ⚠️ ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

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

  const currentEmployees = employees;
  const startIndex = (currentPage - 1) * itemsPerPage;

  const currentUserId = await getCurrentUserId();
  const qrImageMap = await buildQRToImageMap();

  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      const safeFullname = escapeHtml(employee.fullname);
      const safePosition = escapeHtml(employee.position);
      const safeBrand = escapeHtml(employee.brand);
      const safeStatus = escapeHtml(employee.status);
      const safeShift = escapeHtml(employee.shift);
      const safeViolation = escapeHtml(employee.violation);
      const safeQrCode = escapeHtml(employee.qr_code);
      const safeImage = escapeHtml(employee.image);
      const safeId = escapeHtml(String(employee.id));
      const safeEmpId = escapeHtml(String(employee.employee_id));
      const matchedEmployeeData =
        qrImageMap[employee.qr_code.trim().toLowerCase()];

      let imageUrl = null;
      let displayName = employee.fullname || "N/A";
      let tooltipText = displayName;

      if (matchedEmployeeData && matchedEmployeeData.image) {
        imageUrl = `${window.location.origin}/../public/uploads/user/${matchedEmployeeData.image}`; // imageUrl = `../../uploads/user_${currentUserId}/${matchedEmployeeData.image}`;
        displayName = matchedEmployeeData.fullname || employee.fullname;
        tooltipText = `${matchedEmployeeData.fullname}\n${matchedEmployeeData.position}\n${matchedEmployeeData.brand}`;
      } else if (employee.image) {
        imageUrl = `${window.location.origin}/../public/uploads/user/${employee.image}`; // imageUrl = `../../uploads/user_${currentUserId}/${employee.image}`;
        tooltipText = `${employee.fullname}\n${employee.position}\n${employee.brand}`;
      }

      const fullnameInitials = (employee.fullname || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const isAboveFold = index < 5;

      const thumbSrc = `${window.location.origin}/public/uploads/user/thumb_${safeImage}`;
      const imageSrc = `${window.location.origin}/public/uploads/user/${safeImage}`;

      return `
          <tr>
              <td style="text-align: center; width: 50px;">${startIndex + index + 1}</td>
              <td>
                <div><strong>${toProperCase(safeFullname)}</strong></div>
                <div class="emp-id"><strong>EMPID: ${safeEmpId}</strong></div>
              </td>
              <td>
                <div>${toProperCase(safeBrand)}</div>
                <div class="emp-position"><strong>Position: ${toProperCase(safePosition)}</strong></div>
              </td>
              <td>
                <div>${safeShift}</div>
                <div class="emp-status"><strong>Status: <span class="status-${safeStatus.toLowerCase()}">${safeStatus}</span></strong></div>
              </td>
              <td class="Col7">
                <div style="display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:center;">
                  ${
                    employee.violation && employee.violation.trim()
                      ? `<button
                        data-emp-id="${safeEmpId}"
                        data-fullname="${safeFullname}"
                        data-violation="${safeViolation}"
                        onclick="openViolationPopupFromBtn(this)"
                        style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;
                          font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;
                          border:0.5px solid #fca5a5;border-radius:6px;
                          background:#fff5f5;color:#e53e3e;">
                        <i class="fas fa-exclamation-triangle" style="font-size:10px;"></i>
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
                        title="${tooltipText}"
                        ${isAboveFold ? 'fetchpriority="high"' : ""}
                        onerror="if(this.src !== '${imageSrc}'){this.src='${imageSrc}';}else{this.onerror=null;this.style.display='none';this.parentElement.querySelector('.employee-ph-fallback').style.display='flex';}">
                      <div class="employee-ph-fallback ph-cont" style="display:none;" title="${tooltipText}">
                        <div class="employee-ph">${escapeHtml(fullnameInitials)}</div>
                      </div>`
                  : `<div class="ph-cont" title="${tooltipText}"><div class="employee-ph">${escapeHtml(fullnameInitials)}</div></div>`
              }</td>
              <td class="Col9" data-qr="${safeQrCode}" onclick="copyQRCodeFromCell(this)" title="Copy Proximity code" style="cursor:pointer;">
                <img src="../../resource/assets/icon/nfc-icon.svg" alt="Copy Proximity code" loading="lazy" style="width: 20px; height: 20px;"></td>
              <td class="employee-timestamp"><small>${employee.access_timestamp || "N/A"}</small></td>
              <td><div class="check-status-${(employee.check_status || "").toLowerCase()}"><div class="employee-ph">${
                employee.check_status || "N/A"
              }</div></div></td>
              <td>${employee.gate_name || employee.user_id || "N/A"}</td>

              ${
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

function openDeleteFromBtn(btn) {
  openDeleteModal(btn.dataset.empId, false);
}

function openViolationPopupFromBtn(btn) {
  const empId = btn.dataset.empId;
  const employee = employees.find(
    (e) => String(e.employee_id) === String(empId),
  );
  if (!employee) return;
  openViolationPopup(
    employee.fullname,
    employee.violation,
    employee.employee_id,
  );
}

function copyQRCodeFromCell(td) {
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

  document.body.removeChild(tempTextArea);
}

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

function forceRefresh() {
  showLoading(true);
  isUserActive = true;

  loadEmployees()
    .then(() => {
      showAlert("Employee data refreshed manually", "success");
      resetNetworkErrorCount();

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
  ].slice(0, 10);

  if (!matches.length || !q) {
    list.style.display = "none";
    suggestionIndex = -1;
    return;
  }

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

function selectSuggestionFromLi(li) {
  selectSuggestion(li.dataset.value);
}

function selectSuggestion(name) {
  const input = document.getElementById("search_fullname");
  const list = document.getElementById("fullname-suggestions");
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
    selectSuggestion(items[suggestionIndex].dataset.value);
  } else if (e.key === "Escape") {
    list.style.display = "none";
    suggestionIndex = -1;
  }
}

document.addEventListener("click", function (e) {
  const list = document.getElementById("fullname-suggestions");
  const input = document.getElementById("search_fullname");
  if (list && input && !input.contains(e.target) && !list.contains(e.target)) {
    list.style.display = "none";
    suggestionIndex = -1;
  }
});

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

      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will delete ${count} ${label} matching your filters:`;
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
      strong.textContent = `This will permanently delete ALL ${count} ${label}.`;
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

function updateDeleteButtonState() {
  const deleteBtn = document.querySelector(".delete-all-btn .btn-danger");
  if (!deleteBtn) return;

  const hasFilters = hasActiveFilters();
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
    deleteBtn.title = `Delete ${count} filtered ${label}`;
  }
}

async function deleteFilteredEmployees() {
  try {
    showLoading(true);

    const params = new URLSearchParams({
      action: "get",
      page: 1,
      limit: 99999,
    });

    for (const [key, value] of Object.entries(activeFilters)) {
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
      } else if (key === "user_id" && value === "__none__") {
        params.append("user_id_none", "1");
      } else if (key === "user_id") {
        params.append("gate_name", value);
      } else {
        params.append(key, value);
      }
    }

    const allRes = await fetch(`datalog_backend.php?${params.toString()}`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
    });
    const allData = await allRes.json();

    if (
      !allData.success ||
      !Array.isArray(allData.data) ||
      allData.data.length === 0
    ) {
      showAlert("No log entries to delete", "warning");
      return;
    }

    const employeeIds = allData.data.map((emp) => emp.id);

    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(employeeIds));
    formData.append("filters", JSON.stringify(activeFilters));

    const response = await fetch("datalog_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      const deletedCount = data.deleted_count || employeeIds.length;
      const deletedLabel = deletedCount > 1 ? "employee's" : "employee";
      showAlert(
        `Successfully deleted ${escapeHtml(String(deletedCount))} ${deletedLabel} matching your filters.`,
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

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;";

  const headerLabel = document.createElement("span");
  headerLabel.style.cssText = "font-size:13px;font-weight:500;color:#64748b;";
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

  const body = document.createElement("div");
  body.style.cssText =
    "display:flex;align-items:flex-start;justify-content:space-between;gap:12px;";

  const violationText = document.createElement("div");
  violationText.style.cssText =
    "font-size:13px;color:#1e293b;line-height:1.6;white-space:pre-wrap;flex:1;max-height:200px;overflow-y:auto;word-break:break-word;";
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
    document.getElementById("search_in-out"),
    document.getElementById("search_user_id"),
  ];

  selects.forEach(updateSelectColor);
}

function populateFilter(employeeList) {
  const position = document.getElementById("search_position");
  const brand = document.getElementById("search_brand");
  const status = document.getElementById("search_status");
  const shift = document.getElementById("search_shift");
  const violation = document.getElementById("search_violation");
  const inOut = document.getElementById("search_in-out");
  const userId = document.getElementById("search_user_id");
  if (
    !position ||
    !brand ||
    !status ||
    !shift ||
    !violation ||
    !inOut ||
    !userId
  )
    return;

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
  const inOutMap = new Map();
  const userIdMap = new Map();

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
    add(inOutMap, emp.check_status);
    add(userIdMap, emp.gate_name || emp.user_id);
  }

  buildSelect(position, "Position", "No Position", positionMap);
  buildSelect(brand, "Brand", "No Brand", brandMap);
  buildSelect(status, "Status", "No Status", statusMap);
  buildSelect(shift, "Shift", "No Shift", shiftMap);
  buildSelect(violation, "Violation", "No Violation", violationMap);
  buildSelect(inOut, "In/Out Status", "No In/Out Status", inOutMap);
  buildSelect(userId, "Operator", "No Operator", userIdMap);

  updateColor();
}

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
      } else if (key === "user_id" && value === "__none__") {
        params.append("user_id_none", "1");
      } else if (key === "user_id") {
        params.append("gate_name", value);
      } else {
        params.append(key, value);
      }
    }

    const response = await fetch(`datalog_backend.php?${params.toString()}`, {
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
      totalPages = data.pages;
      totalRecords = data.total;

      if (Array.isArray(data.filter_options)) {
        populateFilter(data.filter_options);
      }

      if (!preservePage && Object.keys(filters).length === 0) {
        currentPage = 1;
      }

      employeeDataCache = null;
      qrImageMapCache = null;

      await renderEmployeeTable();
      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
      resetNetworkErrorCount();
      updateDeleteButtonState();

      if (Object.keys(filters).length > 0) {
        displayFilterStatus();
      }

      console.log(`Loaded ${data.total || employees.length} employees`);
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

function closeModal() {
  const deleteModal = document.getElementById("deleteModal");
  if (!deleteModal) return;

  deleteModal.style.display = "none";
}

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
        showAlert(
          `Employee ID "${escapeHtml(empid)}" is already in use`,
          "error",
        );
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
      showAlert(
        `Employee with name "${escapeHtml(fullname)}" already exists!`,
        "error",
      );
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
        showAlert(
          "Only image files (JPEG, JPG, PNG, GIF, WebP) are allowed",
          "error",
        );
        return;
      }
    }

    showLoading(true);

    const formData = new FormData(e.target);
    formData.append("action", currentAction);
    formData.set("id", empid);

    if (currentAction === "edit") {
      formData.set("original_id", originalId);
    }

    const response = await fetch("datalog_backend.php", {
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

      employeeDataCache = null;
      qrImageMapCache = null;
      const preservePage = currentAction === "edit";
      const filtersToUse = hasActiveFilters() ? getActiveFilters() : {};
      await loadEmployees(filtersToUse, preservePage, true);
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
// FILE UPLOAD HANDLER
// ─────────────────────────────────────────────────────────────
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

async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch("datalog_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      employeeDataCache = null;
      qrImageMapCache = null;
      await loadEmployees(activeFilters, true, true);
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

async function deleteAllEmployees(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete_all");
    formData.append("id", employeeId);

    const response = await fetch("datalog_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

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
    console.error("Success:", error);

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

function showAlert(message, type = "info") {
  const existingAlerts = document.querySelectorAll(".alert");
  existingAlerts.forEach((alert) => alert.remove());

  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;

  const msgSpan = document.createElement("span");
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

function showLoading(show) {
  const body = document.body;
  if (show) {
    body.classList.add("loading");
  } else {
    body.classList.remove("loading");
  }
}

window.addEventListener("beforeunload", function () {
  stopAutoUpdate();
  clearTimeout(userActivityTimer);
});

window.onclick = function (event) {
  const modal = document.getElementById("employeeModal");
  if (event.target === modal) {
    closeModal();
  }
};

document.addEventListener("mousedown", handleUserActivity);
document.addEventListener("keydown", handleUserActivity);
document.addEventListener("scroll", handleUserActivity);

document.addEventListener("DOMContentLoaded", function () {
  loadEmployees();
  setupEventListeners();
  updateDeleteButtonState();

  setTimeout(() => {
    initializeAutoUpdate();
  }, 1000);
});
