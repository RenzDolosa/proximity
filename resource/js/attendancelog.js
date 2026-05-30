// resource/js/attendancelog.js --> attendance log table

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
let allEmployees = [];


function isInputVisible(input) {
  const parentModal = input.closest(".modal, .modal-overlay");
  if (parentModal) {
    const d = parentModal.style.display;
    return d === "block" || d === "flex";
  }

  const anyModalOpen =
    document.getElementById("deleteModal")?.style.display === "flex";

  return !anyModalOpen;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// ── Event listeners setup ─────────────────────────────────────────────────────
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

  // ── Auto-focus hidden proximity input ─────────────────────────────────
  const proximityInput = document.getElementById("search_qr");

  function autoFocusProximity() {
    const modalOpen =
      document.getElementById("deleteModal")?.style.display === "block";
    if (modalOpen) return;

    const anySuggestionOpen = [
      "fullname-suggestions",
      "search-position-suggestions",
      "search-brand-suggestions",
      "search-status-suggestions",
      "search-shift-suggestions",
      "search-violation-suggestions",
      "search-userid-suggestions",
    ].some((id) => document.getElementById(id)?.style.display === "block");
    if (anySuggestionOpen) return;

    const active = document.activeElement;
    const isTyping =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "SELECT" ||
        active.tagName === "TEXTAREA");

    if (!isTyping && proximityInput) proximityInput.focus();
  }

  autoFocusProximity();
  document.addEventListener("click", autoFocusProximity);
  document.addEventListener("focusin", autoFocusProximity);

  // ── Field suggestion dropdowns ─────────────────────────────────────────
  setupFieldSuggestions(
    "search_fullname",
    "fullname-suggestions",
    () =>
      [...employees]
        .sort((a, b) => {
          const lastName = (name) => {
            const parts = (name || "").trim().split(/\s+/);
            return parts[parts.length - 1].toLowerCase();
          };
          return lastName(a.fullname).localeCompare(lastName(b.fullname));
        })
        .map((e) => e.fullname),
    { requireInput: false, onSelect: () => searchEmployees() },
  );

  setupFieldSuggestions(
    "search_position",
    "search-position-suggestions",
    () =>
      [...allEmployees]
        .sort((a, b) => (a.position || "").localeCompare(b.position || ""))
        .map((e) => e.position),
    {
      hiddenId: "search_position_val",
      noneLabel: "No Position",
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_brand",
    "search-brand-suggestions",
    () =>
      [...allEmployees]
        .sort((a, b) => (a.brand || "").localeCompare(b.brand || ""))
        .map((e) => e.brand),
    {
      hiddenId: "search_brand_val",
      noneLabel: "No Brand",
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_status",
    "search-status-suggestions",
    () => [...allEmployees].map((e) => e.status),
    {
      hiddenId: "search_status_val",
      noneLabel: "No Status",
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_shift",
    "search-shift-suggestions",
    () => [...allEmployees].map((e) => e.shift),
    {
      hiddenId: "search_shift_val",
      noneLabel: "No Shift",
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_violation",
    "search-violation-suggestions",
    () => allEmployees.map((e) => e.violation),
    {
      hiddenId: "search_violation_val",
      noneLabel: "No Violation",
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_user_id",
    "search-userid-suggestions",
    () => [...employees].map((e) => e.gate_name || e.user_id),
    {
      hiddenId: "search_user_id_val",
      noneLabel: "No Operator",
      onSelect: () => searchEmployees(),
    },
  );

  // ── Auto-update toggle ─────────────────────────────────────────────────
  const autoUpdateToggle = document.getElementById("autoUpdateToggle");
  if (autoUpdateToggle) {
    autoUpdateToggle.addEventListener("change", toggleAutoUpdate);
  }

  setupFieldSuggestions(
    "updateInterval",
    "updateInterval-suggestions",
    () => UPDATE_INTERVAL_OPTIONS.map((o) => o.label),
    {
      hiddenId: "updateInterval_val",
      raw: true,
      showAll: true,
      noDefaultAll: true,
      onSelect: (displayValue) => {
        const match = UPDATE_INTERVAL_OPTIONS.find(
          (o) => o.label.toLowerCase() === (displayValue || "").toLowerCase(),
        );
        const hidden = document.getElementById("updateInterval_val");
        if (match && hidden) hidden.value = match.value;
        if (autoUpdateEnabled) {
          const interval = getSelectedInterval();
          startAutoUpdate(interval);
          showAlert(
            `Auto-update interval changed to ${formatInterval(interval)}`,
            "info",
          );
        }
      },
    },
  );
}

// ── Auto-update interval options ──────────────────────────────────────────────
const UPDATE_INTERVAL_OPTIONS = [
  { label: "Every Second", value: "1000" },
  { label: "10 seconds", value: "10000" },
  { label: "30 seconds", value: "30000" },
  { label: "1 minute", value: "60000" },
  { label: "5 minutes", value: "300000" },
];

function initializeAutoUpdate() {
  const toggle = document.getElementById("autoUpdateToggle");
  const intervalSelector = document.getElementById("updateInterval");

  if (!toggle || !intervalSelector) {
    console.warn("Auto-update elements not found, skipping initialization");
    return;
  }

  autoUpdateEnabled = toggle.checked || false;
  if (autoUpdateEnabled)
    startAutoUpdate(parseInt(intervalSelector.value) || 30000);

  updateAutoUpdateUI();
  setupUserActivityTracking();
}

function setupUserActivityTracking() {
  [
    "mousedown",
    "keydown",
    "scroll",
    "click",
    "mousemove",
    "touchstart",
  ].forEach((event) =>
    document.addEventListener(event, handleUserActivity, { passive: true }),
  );
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

function formatInterval(intervalMs) {
  return intervalMs < 60000
    ? `${intervalMs / 1000}s`
    : `${Math.floor(intervalMs / 60000)}min`;
}

function getSelectedInterval() {
  const hidden = document.getElementById("updateInterval_val");
  return hidden ? parseInt(hidden.value) || 1000 : 1000;
}

function startAutoUpdate(intervalMs) {
  stopAutoUpdate();
  autoUpdateInterval = setInterval(() => {
    if (autoUpdateEnabled && !isUserActive) {
      loadEmployeesAuto();
    }
  }, intervalMs);
}

function stopAutoUpdate() {
  if (autoUpdateInterval) {
    clearInterval(autoUpdateInterval);
    autoUpdateInterval = null;
  }
}

function checkForChanges(newData) {
  if (!employees || employees.length !== newData.length) return true;

  const oldMap = new Map(employees.map((emp) => [emp.id, JSON.stringify(emp)]));
  for (const newEmp of newData) {
    const oldJson = oldMap.get(newEmp.id);
    if (!oldJson || oldJson !== JSON.stringify(newEmp)) return true;
  }
  return false;
}

function updateAutoUpdateUI() {
  const toggle = document.getElementById("autoUpdateToggle");
  const status = document.getElementById("autoUpdateStatus");
  const lastUpdate = document.getElementById("lastUpdateTime");
  const intervalDisplay = document.getElementById("updateInterval");

  if (toggle) toggle.checked = autoUpdateEnabled;

  if (status) {
    const strong = document.createElement("strong");
    strong.textContent = autoUpdateEnabled ? "ON" : "OFF";
    status.replaceChildren(strong);
    status.className = `auto-update-status ${autoUpdateEnabled ? "active" : "inactive"}`;
  }

  if (lastUpdate && lastUpdateTimestamp) {
    const timeString = new Date(lastUpdateTimestamp).toLocaleTimeString();
    lastUpdate.textContent = `Last updated: ${timeString}`;
    lastUpdate.style.cssText = "display:block;color:#000;font-size:12px;";
  } else if (lastUpdate) {
    lastUpdate.style.display = "none";
  }

  if (intervalDisplay) {
    intervalDisplay.disabled = !autoUpdateEnabled;
    intervalDisplay.style.opacity = autoUpdateEnabled ? "1" : "0.5";
    intervalDisplay.style.cursor = autoUpdateEnabled
      ? "pointer"
      : "not-allowed";
  }
}

function handleUserActivity() {
  isUserActive = true;
  clearTimeout(userActivityTimer);
  userActivityTimer = setTimeout(() => {
    isUserActive = false;
  }, 1000);
}

function showAutoUpdateNotification() {
  const notification = document.getElementById("autoUpdateNotification");
  if (!notification) return;

  const timeString = new Date().toLocaleTimeString();
  notification.textContent = `Data updated at ${timeString}`;
  notification.style.cssText = `
    display:block;opacity:1;background-color:#e8f5e8;color:#2d5a2d;
    padding:2px 4px;border-radius:4px;font-size:11px;
    border:1px solid #b8e6b8;transition:opacity 0.3s ease;
  `;

  setTimeout(() => {
    if (notification) {
      notification.style.opacity = "0";
      setTimeout(() => {
        if (notification) notification.style.display = "none";
      }, 300);
    }
  }, 3000);
}

// ── Auto-update fetch ─────────────────────────────────────────────────────────
async function loadEmployeesAuto() {
  try {
    const filtersToUse =
      Object.keys(activeFilters).length > 0
        ? activeFilters
        : hasActiveFilters()
          ? getActiveFilters()
          : {};

    const params = buildFilterParams(filtersToUse);
    params.append("page", currentPage);
    params.append("limit", itemsPerPage);

    const response = await fetch(
      `attendancelog_backend.php?${params.toString()}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-Silent-Request": "true",
        },
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      if (checkForChanges(data.data)) {
        employees = data.data;
        employeeDataCache = null;
        qrImageMapCache = null;
        await renderEmployeeTable();
        showAutoUpdateNotification();
      }

      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
      resetNetworkErrorCount();
    }
  } catch (error) {
    if (error.name === "TimeoutError") {
      console.warn("Auto-update timeout");
    } else if (
      error.message.includes("Failed to fetch") ||
      error.message.includes("NetworkError")
    ) {
      handleNetworkError();
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
  if (networkErrorCount > 0) networkErrorCount = 0;
}

// ── Filter helpers ────────────────────────────────────────────────────────────
function buildFilterParams(filters) {
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
    } else if (key === "user_id" && value === "__none__") {
      params.append("user_id_none", "1");
    } else if (key === "user_id") {
      params.append("gate_name", value);
    } else {
      params.append(key, value);
    }
  }

  return params;
}

function getActiveFilters() {
  const searchForm = document.getElementById("searchForm");
  const filters = {};
  if (!searchForm) return filters;

  const formData = new FormData(searchForm);
  for (let [key, value] of formData.entries()) {
    if (value && value.trim()) filters[key] = value.trim();
  }

  return filters;
}

function hasActiveFilters() {
  return Object.keys(getActiveFilters()).length > 0;
}

function displayFilterStatus() {
  const existing = document.getElementById("filter-status");
  if (existing) existing.remove();

  const filters = getActiveFilters();
  if (!Object.keys(filters).length) return;

  const filterInfo = document.createElement("div");
  filterInfo.id = "filter-status";
  filterInfo.style.cssText = `
    background:#e3f2fd;border-left:4px solid #2196F3;padding:12px 16px;
    margin-left:16px;border-radius:4px;font-size:14px;color:#1565c0;
    display:inline-flex;justify-content:space-between;align-items:center;
  `;

  const label = document.createElement("span");
  label.style.cssText = "display:inline-flex;align-items:center;gap:8px;";

  const icon = document.createElement("i");
  icon.className = "fas fa-filter";
  label.appendChild(icon);

  const textSpan = document.createElement("span");
  textSpan.appendChild(document.createTextNode("Active Filters: "));

  Object.entries(filters).forEach(([key, value], index) => {
    if (index > 0) textSpan.appendChild(document.createTextNode(" | "));
    const strong = document.createElement("strong");
    const properKey = key
      .split(/(?=[A-Z])/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    strong.textContent = `${properKey}:`;
    textSpan.appendChild(strong);
    textSpan.appendChild(document.createTextNode(` ${value}`));
  });

  label.appendChild(textSpan);
  filterInfo.appendChild(label);

  const controlsDiv = document.querySelector(".controls");
  if (controlsDiv) controlsDiv.appendChild(filterInfo);
}

// ── Manpower image lookup ─────────────────────────────────────────────────────
async function getManpowerEmployeeData() {
  if (employeeDataCache) return employeeDataCache;

  try {
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

// ── Render table ──────────────────────────────────────────────────────────────
async function renderEmployeeError(message = "Failed to load data.") {
  const tbody = document.getElementById("employeeTableBody");
  const paginationDiv = document.getElementById("pagination");
  const noDataDiv = document.getElementById("no-data");

  if (!tbody) return;

  if (!employees || employees.length === 0) {
    tbody.innerHTML = "";
    if (paginationDiv) paginationDiv.style.display = "none";
    if (noDataDiv) noDataDiv.style.display = "block";
    return;
  }

  if (noDataDiv) noDataDiv.style.display = "none";

  tbody.innerHTML = `
    <tr>
      <td colspan="10" style="text-align:center;padding:20px;color:#c0392b;">
        ⚠️ ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

async function renderEmployeeTable() {
  const tbody = document.getElementById("employeeTableBody");
  const paginationDiv = document.getElementById("pagination");
  const noDataDiv = document.getElementById("no-data");

  if (!tbody) return;

  if (!employees || employees.length === 0) {
    tbody.innerHTML = "";
    if (paginationDiv) paginationDiv.style.display = "none";
    if (noDataDiv) noDataDiv.style.display = "block";
    return;
  }

  if (noDataDiv) noDataDiv.style.display = "none";

  const startIndex = (currentPage - 1) * itemsPerPage;
  const qrImageMap = await buildQRToImageMap();

  tbody.innerHTML = employees
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

      const matchedEmp =
        qrImageMap[(employee.qr_code || "").trim().toLowerCase()];

      let tooltipText = employee.fullname || "N/A";
      if (matchedEmp) {
        tooltipText = `${matchedEmp.fullname}\n${matchedEmp.position}\n${matchedEmp.brand}`;
      }

      const initials = (employee.fullname || "UN")
        .split(" ")
        .map((n) => n.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const isAboveFold = index < 5;
      const thumbSrc = `${window.location.origin}/public/uploads/user/thumb_${safeImage}`;
      const imageSrc = `${window.location.origin}/public/uploads/user/${safeImage}`;

      return `
        <tr>
          <td class="sn-cell">${startIndex + index + 1}</td>
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
          <td class="emp-remark">
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
          <td class="emp-img">${
            employee.image
              ? `<img src="${thumbSrc}" alt="${safeFullname}" class="employee-image"
                    width="48" height="48"
                    loading="${isAboveFold ? "eager" : "lazy"}"
                    decoding="async"
                    title="${escapeHtml(tooltipText)}"
                    ${isAboveFold ? 'fetchpriority="high"' : ""}
                    onerror="if(this.src!=='${imageSrc}'){this.src='${imageSrc}';}else{this.onerror=null;this.style.display='none';this.parentElement.querySelector('.employee-ph-fallback').style.display='flex';}">
                  <div class="employee-ph-fallback ph-cont" style="display:none;" title="${escapeHtml(tooltipText)}">
                    <div class="employee-ph">${escapeHtml(initials)}</div>
                  </div>`
              : `<div class="ph-cont" title="${escapeHtml(tooltipText)}"><div class="employee-ph">${escapeHtml(initials)}</div></div>`
          }</td>
          <td class="emp-proximity" data-qr="${safeQrCode}" onclick="copyQRCodeFromCell(this)" title="Copy Proximity code" style="cursor:pointer;">
            <img src="../../resource/assets/icon/nfc-icon.svg" alt="Copy Proximity code" loading="lazy" style="width:20px;height:20px;">
          </td>
          <td class="employee-timestamp"><small>${employee.access_timestamp || "N/A"}</small></td>
          <td>${escapeHtml(employee.gate_name || employee.user_id || "N/A")}</td>
          ${
            window.PERMISSIONS.delete
              ? `<td style="position: relative; width: 160px; overflow: visible;">
                  <button
                    onclick="toggleActionsPanel(this)"
                    data-emp-id="${safeId}"
                    class="actions-toggle-btn"
                    style="width:100%;padding:6px 12px;font-size:12px;font-weight:700;
                      letter-spacing:1px;border:1.5px solid #cbd5e1;border-radius:10px;
                      background:#fff;color:#1e293b;cursor:pointer;
                      box-shadow:0 1px 4px rgba(0,0,0,0.08);white-space:nowrap;">
                    ACTIONS
                  </button>
                  <div class="actions-panel">
                    <small style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);text-align:center;color:#fff;">
                      ${toProperCase(safeFullname)}
                    </small>
                    <button
                      data-emp-id="${safeId}"
                      tabindex="-1"
                      onclick="openDeleteFromBtn(this)"
                      style="width:100%;padding:7px;font-size:12px;font-weight:700;
                        background:#fff;color:#ef4444;border:none;cursor:pointer;text-align:center;">
                      <i class="fas fa-trash-alt"></i> DELETE
                    </button>
                  </div>
                </td>`
              : ""
          }
        </tr>
      `;
    })
    .join("");

  updatePaginationControls();
}

// ── Actions panel ─────────────────────────────────────────────────────────────
function toggleActionsPanel(btn) {
  const allPanels = document.querySelectorAll(".actions-panel");
  const allBtns = document.querySelectorAll(".actions-toggle-btn");
  const panel = btn.parentElement.querySelector(".actions-panel");
  const isAlreadyOpen = panel.classList.contains("actions-open");

  // ── Close all open panels and return them to their original parents ──
  allPanels.forEach((p) => {
    p.classList.remove("actions-open");
    p.style.display = "none";
    if (p._originalParent && p.parentElement === document.body) {
      p._originalParent.appendChild(p);
    }
  });
  allBtns.forEach((b) => b.classList.remove("actions-active"));

  if (isAlreadyOpen) return;

  // ── Move panel to <body> to escape all overflow clipping ──
  panel._originalParent = btn.parentElement;
  document.body.appendChild(panel);

  const rect = btn.getBoundingClientRect();
  const panelW = 160;
  const panelH = panel.scrollHeight || 180;

  // Right-align panel to the right edge of the button
  let left = rect.right - panelW;
  // Clamp so it never bleeds off-screen
  left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));

  // Prefer opening upward; fall back to downward if not enough room
  let top;
  if (rect.top >= panelH + 8) {
    top = rect.top - panelH - 4; // above the button
  } else {
    top = rect.bottom + 4; // below the button
  }

  panel.style.position = "fixed";
  panel.style.top = Math.round(top) + "px";
  panel.style.left = Math.round(left) + "px";
  panel.style.width = panelW + "px";
  panel.style.bottom = "auto";
  panel.style.transform = "none";
  panel.style.zIndex = "99999";

  panel.classList.add("actions-open");
  btn.classList.add("actions-active");
}

// ── Close panel when clicking outside ──────────────────────────────
document.addEventListener("click", function (e) {
  if (
    !e.target.closest(".actions-toggle-btn") &&
    !e.target.closest(".actions-panel")
  ) {
    document.querySelectorAll(".actions-panel").forEach((p) => {
      p.classList.remove("actions-open");
      p.style.display = "none";
      if (p._originalParent && p.parentElement === document.body) {
        p._originalParent.appendChild(p);
      }
    });
    document
      .querySelectorAll(".actions-toggle-btn")
      .forEach((b) => b.classList.remove("actions-active"));
  }
});

// ── Close all actions panels ──────────────────────────────────────────────────
function closeAllActionsPanels() {
  document.querySelectorAll(".actions-panel").forEach((p) => {
    p.classList.remove("actions-open");
    p.style.display = "none";
    if (p._originalParent && p.parentElement === document.body) {
      p._originalParent.appendChild(p);
    }
  });
  document
    .querySelectorAll(".actions-toggle-btn")
    .forEach((b) => b.classList.remove("actions-active"));
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

// ── Pagination ────────────────────────────────────────────────────────────────
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
  )
    range.add(i);

  const sorted = [...range].sort((a, b) => a - b);
  let prev = null;
  let buttonsHTML = "";

  for (const p of sorted) {
    if (prev !== null && p - prev > 1)
      buttonsHTML += `<span class="page-ellipsis">…</span>`;
    buttonsHTML += `<button class="page-num-btn ${currentPage === p ? "active" : ""}" onclick="goToPage(${p})">${p}</button>`;
    prev = p;
  }

  paginationDiv.innerHTML = `
    <button class="page-arrow-btn" tabindex="-1" onclick="previousPage()" ${currentPage <= 1 ? "disabled" : ""}>
      <i class="fas fa-arrow-left"></i>
    </button>
    ${buttonsHTML}
    <button class="page-arrow-btn" tabindex="-1" onclick="nextPage()" ${currentPage >= totalPages ? "disabled" : ""}>
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

// ── Search / clear ────────────────────────────────────────────────────────────
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

function clearSearch() {
  const searchForm = document.getElementById("searchForm");
  if (searchForm) searchForm.reset();

  [
    ["search_position", "search_position_val"],
    ["search_brand", "search_brand_val"],
    ["search_status", "search_status_val"],
    ["search_shift", "search_shift_val"],
    ["search_violation", "search_violation_val"],
    ["search_user_id", "search_user_id_val"],
  ].forEach(([displayId, hiddenId]) => {
    const display = document.getElementById(displayId);
    const hidden = document.getElementById(hiddenId);
    if (display) display.value = "";
    if (hidden) hidden.value = "";
  });

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
      showAlert("Data refreshed", "success");
      resetNetworkErrorCount();
      setTimeout(() => {
        isUserActive = false;
      }, 2000);
    })
    .catch(() => showAlert("Failed to refresh data", "error"))
    .finally(() => showLoading(false));
}

// ── Load employees from backend ───────────────────────────────────────────────
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

    const params = buildFilterParams(filters);
    params.append("page", currentPage);
    params.append("limit", itemsPerPage);

    const response = await fetch(
      `attendancelog_backend.php?${params.toString()}`,
      {
        headers: { "X-Requested-With": "XMLHttpRequest" },
      },
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;
      totalPages = data.pages;
      totalRecords = data.total;

      if (Array.isArray(data.filter_options))
        allEmployees = data.filter_options;

      if (!preservePage && Object.keys(filters).length === 0) currentPage = 1;

      employeeDataCache = null;
      qrImageMapCache = null;

      await renderEmployeeTable();
      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
      resetNetworkErrorCount();
      updateDeleteButtonState();

      if (Object.keys(filters).length > 0) displayFilterStatus();
    } else {
      await renderEmployeeError("Network error. Please try again.");
      showAlert(data.message || "Error loading records", "error");
    }
  } catch (error) {
    console.error("Error loading records:", error);
    await renderEmployeeError("Network error. Please try again.");
    showAlert("Failed to load records. Please check your connection.", "error");
  } finally {
    if (!silent) showLoading(false);
  }
}

// ── Delete modal ──────────────────────────────────────────────────────────────
function openDeleteModal(employeeId = null, requireConfirmation = false) {
  closeAllActionsPanels();
  const modal = document.getElementById("deleteModal");
  const confirmBtn = document.getElementById("confirmDeleteBtn");
  const confirmationInput = document.getElementById("confirmationInput");
  const confirmationContainer = document.getElementById(
    "confirmationContainer",
  );
  const modalTitle = document.getElementById("deleteModalTitle");
  const modalMessage = document.getElementById("deleteModalMessage");

  const hasFilters = hasActiveFilters();
  const count = employees.length;
  const label = count > 1 ? "record's" : "record";

  confirmBtn.dataset.employeeId = employeeId;
  confirmBtn.dataset.requireConfirmation = requireConfirmation;
  confirmBtn.dataset.hasFilters = hasFilters;

  if (requireConfirmation) {
    if (hasFilters) {
      modalTitle.textContent = "⚠️ Delete Filtered Records";

      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will delete ${count} ${label} matching your filters:`;
      p1.appendChild(strong);
      msgDiv.appendChild(p1);

      const filterBox = document.createElement("div");
      filterBox.style.cssText =
        "background:#fff3cd;border:1px solid #ffeaa7;padding:12px;border-radius:4px;margin-bottom:15px;";
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
      p2.style.cssText = "color:#d63031;font-weight:bold;";
      p2.textContent = "This action cannot be undone.";
      msgDiv.appendChild(p2);

      modalMessage.innerHTML = "";
      modalMessage.appendChild(msgDiv);
    } else {
      modalTitle.textContent = "⚠️ Delete All Records";

      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will permanently delete ALL ${count} ${label}.`;
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
    modalTitle.textContent = "Delete Record";
    modalMessage.textContent = "Are you sure you want to delete this record?";
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

function updateDeleteButtonState() {
  const deleteBtn = document.querySelector(".delete-all-btn .btn-danger");
  if (!deleteBtn) return;

  const hasFilters = hasActiveFilters();
  const hasData = employees && employees.length > 0;
  const canDelete = hasFilters && hasData;
  const count = employees.length;
  const label = count > 1 ? "record's" : "record";

  deleteBtn.disabled = !canDelete;
  deleteBtn.style.opacity = canDelete ? "1" : "0.4";
  deleteBtn.style.cursor = canDelete ? "pointer" : "not-allowed";

  if (!hasFilters) deleteBtn.title = "Apply filters first to enable deletion";
  else if (!hasData) deleteBtn.title = "No matching records to delete";
  else deleteBtn.title = `Delete ${count} filtered ${label}`;
}

async function deleteFilteredEmployees() {
  try {
    showLoading(true);

    const params = buildFilterParams(activeFilters);
    params.append("page", 1);
    params.append("limit", 99999);

    const allRes = await fetch(
      `attendancelog_backend.php?${params.toString()}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-Silent-Request": "true",
        },
      },
    );
    const allData = await allRes.json();

    if (
      !allData.success ||
      !Array.isArray(allData.data) ||
      allData.data.length === 0
    ) {
      showAlert("No log entries to delete", "warning");
      return;
    }

    const logIds = allData.data.map((emp) => emp.id);
    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(logIds));
    formData.append("filters", JSON.stringify(activeFilters));

    const response = await fetch("attendancelog_backend.php", {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      const deletedCount = data.deleted_count || logIds.length;
      const deletedLabel = deletedCount > 1 ? "record's" : "record";
      showAlert(
        `Successfully deleted ${escapeHtml(String(deletedCount))} ${deletedLabel}.`,
        "success",
      );
      currentPage = 1;
      clearSearch();
    } else {
      showAlert(
        escapeHtml(data.message) || "Failed to delete filtered records",
        "error",
      );
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to delete filtered records", "error");
  } finally {
    showLoading(false);
  }
}

// ── Violation popup ───────────────────────────────────────────────────────────
function openViolationPopup(fullname, violation, employeeId) {
  closeAllActionsPanels();
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
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:9999;";

  const reportUrl = "incident_report.php?" + params.toString();

  const card = document.createElement("div");
  card.style.cssText =
    "background:#fff;border:0.5px solid #e2e8f0;border-radius:12px;padding:1.25rem;max-width:360px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,0.12);";

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;";

  const headerLabel = document.createElement("span");
  headerLabel.style.cssText = "font-size:13px;font-weight:500;color:#64748b;";
  headerLabel.textContent = `${fullname} — Remarks`;

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

  const footer = document.createElement("div");
  footer.style.cssText =
    "display:flex;justify-content:end;align-items:center;margin-top:12px;";

  const attachBtn = document.createElement("button");
  attachBtn.style.cssText =
    "display:inline-flex;align-items:center;gap:5px;padding:5px 12px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;flex-shrink:0;border:0.5px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#1e293b;";
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

// ── QR copy ───────────────────────────────────────────────────────────────────
function copyQRCode(code) {
  const tempArea = document.createElement("textarea");
  tempArea.value = code;
  document.body.appendChild(tempArea);
  tempArea.select();
  tempArea.setSelectionRange(0, 99999);

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

  document.body.removeChild(tempArea);
}

// ── Close modal ───────────────────────────────────────────────────────────────
function closeModal() {
  const deleteModal = document.getElementById("deleteModal");
  if (deleteModal) deleteModal.style.display = "none";
}

// ── Delete single record ──────────────────────────────────────────────────────
async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch("attendancelog_backend.php", {
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
    showAlert("Failed to delete record", "error");
  } finally {
    showLoading(false);
  }
}

// ── Delete all records ────────────────────────────────────────────────────────
async function deleteAllEmployees() {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete_all");

    const response = await fetch("attendancelog_backend.php", {
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
      currentPage = 1;
      clearSearch();
    } else {
      showAlert(data.message, "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to delete all records", "error");
  } finally {
    showLoading(false);
  }
}

// ── File upload handler ───────────────────────────────────────────────────────
function setupFileUploadHandler() {
  const imageInput = document.getElementById("image");
  if (!imageInput) return;

  imageInput.addEventListener("change", function (e) {
    const label = document.querySelector(".file-upload-label");
    if (!label) return;

    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      const maxSize = 5 * 1024 * 1024;

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

async function handleFormSubmit(e) {
  e.preventDefault();
  // Form submit handler — extend as needed for add/edit if required
}

// ── Alert ─────────────────────────────────────────────────────────────────────
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

function showLoading(show) {
  document.body.classList.toggle("loading", show);
}

// ── Generic field autocomplete ────────────────────────────────────────────────
function setupFieldSuggestions(inputId, listId, getValues, options = {}) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const hidden = options.hiddenId
    ? document.getElementById(options.hiddenId)
    : null;

  const existing = document.getElementById(listId);
  if (existing) existing.remove();

  const list = document.createElement("ul");
  list.id = listId;
  list.style.cssText = `
    display:none;position:fixed;z-index:99999;
    background:#fff;border:1px solid #cbd5e1;
    border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);
    list-style:none;margin:0;padding:0;
    max-height:260px;overflow:hidden;overflow-y:auto;min-width:160px;
  `;
  document.body.appendChild(list);

  let idx = -1;

  function selectItem(displayValue, rawValue) {
    if (rawValue === "") {
      input.value = "";
      if (hidden) hidden.value = "";
    } else {
      input.value = displayValue;
      if (hidden) hidden.value = rawValue;
    }
    list.style.display = "none";
    idx = -1;
    if (options.onSelect) options.onSelect(rawValue);
  }

  function positionList() {
    const rect = input.getBoundingClientRect();
    list.style.top = rect.bottom + 4 + "px";
    list.style.left = rect.left + "px";
    list.style.width = Math.max(rect.width, 200) + "px";
  }

  function show(q) {
    if (!isInputVisible(input)) {
      list.style.display = "none";
      idx = -1;
      return;
    }

    const lower = q.trim().toLowerCase();
    const raw = getValues();
    const items = [];

    if (!options.noDefaultAll)
      items.push({ display: "Default: ALL", raw: "", special: "all" });
    if (options.noneLabel)
      items.push({
        display: options.noneLabel,
        raw: "__none__",
        special: "none",
      });
    if (options.noneLabel)
      items.push({ display: "──────────", raw: null, special: "divider" });

    const seen = new Map();
    raw
      .map((v) => (v || "").trim())
      .filter((v) => v && v.toLowerCase() !== "none")
      .filter(
        (v) => options.showAll || !lower || v.toLowerCase().includes(lower),
      )
      .forEach((v) => {
        const k = v.toLowerCase();
        if (!seen.has(k)) seen.set(k, v);
      });

    [...seen.values()].forEach((v) => {
      items.push({ display: options.raw ? v : toProperCase(v), raw: v });
    });

    const visibleItems =
      lower && !options.showAll ? items.filter((i) => !i.special) : items;
    const hasRealItems = visibleItems.some((i) => !i.special);

    if (!visibleItems.length || (lower && !hasRealItems)) {
      list.style.display = "none";
      idx = -1;
      return;
    }

    list.innerHTML = visibleItems
      .map((item, i) => {
        if (item.special === "divider") {
          return `<li data-raw="" data-display="" style="padding:4px 12px;font-size:11px;color:#94a3b8;pointer-events:none;user-select:none;border-bottom:1px solid #f1f5f9;">──────────</li>`;
        }

        const safeDisplay = escapeHtml(item.display);
        let hl = safeDisplay;
        if (lower && !item.special && !options.showAll) {
          const regex = new RegExp(
            `(${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
          );
          hl = safeDisplay.replace(
            regex,
            '<mark style="background:#fef08a;border-radius:2px;">$1</mark>',
          );
        }

        const isSpecial = item.special === "all" || item.special === "none";
        const specialStyle = isSpecial
          ? "font-weight:600;color:#1e40af;background:#f0f9ff;"
          : "";

        return `<li
          data-raw="${escapeHtml(item.raw ?? "")}"
          data-display="${safeDisplay}"
          data-index="${i}"
          style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;${specialStyle}">
          ${hl}
        </li>`;
      })
      .join("");

    list.querySelectorAll("li[data-raw]").forEach((li) => {
      if (li.style.pointerEvents === "none") return;
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectItem(li.dataset.display, li.dataset.raw);
      });
      li.addEventListener("mouseover", () => {
        list
          .querySelectorAll("li")
          .forEach((l) => (l.style.background = l === li ? "#f0f9ff" : ""));
        idx = [...list.querySelectorAll("li")].indexOf(li);
      });
    });

    positionList();
    list.style.display = "block";
    idx = -1;
  }

  input.addEventListener("focus", () => {
    if (!options.requireInput || input.value.trim()) show(input.value);
  });
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!list.contains(document.activeElement)) {
        list.style.display = "none";
        idx = -1;
      }
    }, 150);
  });
  input.addEventListener("click", () => {
    if (options.showAll) show(input.value);
  });
  input.addEventListener("input", () => show(input.value));

  window.addEventListener(
    "scroll",
    () => {
      if (list.style.display !== "none") positionList();
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (list.style.display !== "none") positionList();
  });

  input.addEventListener("keydown", (e) => {
    const liItems = [...list.querySelectorAll("li")].filter(
      (l) => l.style.pointerEvents !== "none",
    );
    if (e.key === "Tab") {
      list.style.display = "none";
      idx = -1;
      return;
    }
    if (!liItems.length || list.style.display === "none") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      idx = Math.min(idx + 1, liItems.length - 1);
      liItems.forEach(
        (l, j) => (l.style.background = j === idx ? "#f0f9ff" : ""),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      idx = Math.max(idx - 1, 0);
      liItems.forEach(
        (l, j) => (l.style.background = j === idx ? "#f0f9ff" : ""),
      );
    } else if (e.key === "Enter" && idx >= 0) {
      e.preventDefault();
      selectItem(liItems[idx].dataset.display, liItems[idx].dataset.raw);
    } else if (e.key === "Escape") {
      list.style.display = "none";
      idx = -1;
    }
  });

  if (input._outsideClickHandler)
    document.removeEventListener("click", input._outsideClickHandler);
  input._outsideClickHandler = (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = "none";
      idx = -1;
    }
  };
  document.addEventListener("click", input._outsideClickHandler);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
window.addEventListener("beforeunload", () => {
  stopAutoUpdate();
  clearTimeout(userActivityTimer);
});

window.onclick = function (event) {
  const modal = document.getElementById("employeeModal");
  if (event.target === modal) closeModal();
};

document.addEventListener("mousedown", handleUserActivity);
document.addEventListener("keydown", handleUserActivity);
document.addEventListener("scroll", handleUserActivity);

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  loadEmployees();
  setupEventListeners();
  updateDeleteButtonState();
  setTimeout(initializeAutoUpdate, 1000);
});
