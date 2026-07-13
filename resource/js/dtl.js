// resource/js/dtl.js --> datalog table

let EmployeesBackend = null;
let AccessLogBackend = null;
let UserIdHelper = null;

let currentAction = "add";
let employees = [];
let employeeDataCache = null;
let qrImageMapCache = null;
let _lastImageFingerprint = null;

let autoUpdateInterval = null;
let autoUpdateEnabled = false;
let lastUpdateTimestamp = null;
let userActivityTimer = null;
let isUserActive = false;
let autoUpdateFetching = false;

let totalRecords = 0;

let activeFilters = {};
let allEmployees = [];
let fieldFilterOptions = {};
let filterOptionsLoaded = false; // becomes true once we've fetched the distinct filter/suggestion dataset at least once

let sortCol = null;
let sortDir = "asc";

// ── Controls CSS helper ───────────────────────────────────────────
const controls = document.querySelector(".controls");
const sentinel = document.createElement("div");
sentinel.style.cssText =
  "position:absolute;top:0;height:1px;pointer-events:none";
controls.before(sentinel);

new IntersectionObserver(([e]) => {
  controls.classList.toggle("is-stuck", !e.isIntersecting);
}).observe(sentinel);

// ─── Suggestion visibility helpers ───────────────────────────────
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

function isAnySuggestionOpen() {
  return [...document.querySelectorAll("ul[data-suggestion-list]")].some(
    (el) => el.style.display === "block",
  );
}

function computeImageFingerprint(qrImageMap) {
  const parts = [];
  for (const key in qrImageMap) {
    const v = qrImageMap[key];
    parts.push(`${key}:${v.image || ""}:${v.updated_at || ""}`);
  }
  return parts.sort().join("|");
}

// ── Event listeners setup ─────────────────────────────────────────────────────
function setupEventListeners() {
  // ── Date range picker ──────────────────────────────────────────
  initDateRangePicker();
  window.onDateRangeChange = function () {
    searchEmployees();
  };

  const form = document.getElementById("employeeForm");
  if (form) {
    form.addEventListener("submit", handleFormSubmit);
  }

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

    if (isAnySuggestionOpen()) return;

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
    "search_empid",
    "search-empid-suggestions",
    () =>
      [...(fieldFilterOptions.employee_id || allEmployees)]
        .sort(
          (a, b) => Number(a.employee_id || "") - Number(b.employee_id || ""),
        )
        .map((e) => String(e.employee_id)),
    {
      showAll: true,
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_fullname",
    "fullname-suggestions",
    () =>
      [...(fieldFilterOptions.fullname || allEmployees)]
        .sort((a, b) => {
          const lastName = (name) => {
            const parts = (name || "").trim().split(/\s+/);
            return parts[parts.length - 1].toLowerCase();
          };
          return lastName(a.fullname).localeCompare(lastName(b.fullname));
        })
        .map((e) => e.fullname)
        .filter(Boolean),
    {
      requireInput: false,
      showAll: true,
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_position",
    "search-position-suggestions",
    () =>
      [...(fieldFilterOptions.position || allEmployees)]
        .sort((a, b) => (a.position || "").localeCompare(b.position || ""))
        .map((e) => e.position)
        .filter(Boolean),
    {
      hiddenId: "search_position_val",
      noneLabel: "No Position",
      showAll: true,
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_brand",
    "search-brand-suggestions",
    () =>
      [...(fieldFilterOptions.brand || allEmployees)]
        .sort((a, b) => (a.brand || "").localeCompare(b.brand || ""))
        .map((e) => e.brand)
        .filter(Boolean),
    {
      hiddenId: "search_brand_val",
      noneLabel: "No Brand",
      showAll: true,
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_status",
    "search-status-suggestions",
    () =>
      [...(fieldFilterOptions.status || allEmployees)]
        .sort((a, b) => (a.status || "").localeCompare(b.status || ""))
        .map((e) => e.status)
        .filter(Boolean),
    {
      hiddenId: "search_status_val",
      noneLabel: "No Status",
      showAll: true,
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_shift",
    "search-shift-suggestions",
    () =>
      [...(fieldFilterOptions.shift || allEmployees)]
        .sort((a, b) => (a.shift || "").localeCompare(b.shift || ""))
        .map((e) => e.shift)
        .filter(Boolean),
    {
      hiddenId: "search_shift_val",
      noneLabel: "No Shift",
      showAll: true,
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_violation",
    "search-violation-suggestions",
    () =>
      [...(fieldFilterOptions.violation || allEmployees)]
        .sort((a, b) => (a.violation || "").localeCompare(b.violation || ""))
        .map((e) => e.violation)
        .filter(Boolean),
    {
      hiddenId: "search_violation_val",
      noneLabel: "No Violation",
      showAll: true,
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_in-out",
    "search-inout-suggestions",
    () =>
      [...(fieldFilterOptions.check_status || allEmployees)]
        .sort((a, b) =>
          (a.check_status || "").localeCompare(b.check_status || ""),
        )
        .map((e) => e.check_status)
        .filter(Boolean),
    {
      hiddenId: "search_in-out_val",
      noneLabel: "No In/Out Status",
      showAll: true,
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_user_id",
    "search-userid-suggestions",
    () =>
      [...(fieldFilterOptions.user_id || allEmployees)]
        .sort((a, b) => (a.gate_name || "").localeCompare(b.gate_name || ""))
        .map((e) => e.gate_name || "")
        .filter(Boolean),
    {
      hiddenId: "search_user_id_val",
      noneLabel: "No Operator",
      showAll: true,
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
        if (match && hidden) {
          hidden.value = match.value;
        }
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

  (function () {
    const controlsEl = document.querySelector(".controls");
    const tableHeaderEl = document.querySelector(".table-header");

    function sync() {
      if (controlsEl) {
        document.documentElement.style.setProperty(
          "--controls-h",
          controlsEl.offsetHeight + "px",
        );
      }
      if (tableHeaderEl) {
        document.documentElement.style.setProperty(
          "--table-header-h",
          tableHeaderEl.offsetHeight + "px",
        );
      }
    }

    sync();

    if (controlsEl) new ResizeObserver(sync).observe(controlsEl);
    if (tableHeaderEl) new ResizeObserver(sync).observe(tableHeaderEl);
  })();

  const theadWrap = document.querySelector(".thead-sticky-wrap");
  const tbodyWrap = document.querySelector(".table-scroll-wrap");

  if (theadWrap && tbodyWrap) {
    tbodyWrap.addEventListener("scroll", () => {
      theadWrap.scrollLeft = tbodyWrap.scrollLeft;
    });
  }
}

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
    showAlert("Auto-update disabled", "error");
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
  const intervalHidden = document.getElementById("updateInterval_val");

  if (toggle) toggle.checked = autoUpdateEnabled;

  if (status) {
    const strong = document.getElementById("toggle");
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
    console.log("User activity paused, resuming auto-update");
  }, 1000);
}

function showAutoUpdateNotification() {
  const notification = document.getElementById("autoUpdateNotification");
  if (!notification) return;

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
        if (notification) notification.style.display = "none";
      }, 300);
    }
  }, 3000);
}

// ── Auto-update fetch ─────────────────────────────────────────────────────────
async function loadEmployeesAuto(filters = {}) {
  if (!AccessLogBackend) return;
  if (autoUpdateFetching) return;
  autoUpdateFetching = true;

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

    if (sortCol) {
      params.append("sort_col", sortCol);
      params.append("sort_dir", sortDir);
    }

    const response = await fetch(`${AccessLogBackend}?${params.toString()}`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      if (data.stats) applyStats(data.stats);
      const hasChanges = checkForChanges(data.data);

      employeeDataCache = null;
      qrImageMapCache = null;
      const freshMap = await buildQRToImageMap();
      const freshFingerprint = computeImageFingerprint(freshMap);
      const hasImageChanges = freshFingerprint !== _lastImageFingerprint;
      _lastImageFingerprint = freshFingerprint;

      if (hasChanges || hasImageChanges) {
        employees = data.data;
        await renderEmployeeTable();
        showAutoUpdateNotification();
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
  } finally {
    autoUpdateFetching = false;
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
    if (value && value.trim()) {
      filters[key] = value.trim();
    }
  }

  const from = document.getElementById("f_from")?.value || "";
  const to = document.getElementById("f_to")?.value || "";
  if (from) filters["date_from"] = from;
  if (to) filters["date_to"] = to;

  delete filters["access_timestamp"];

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

  const overrideKeys = {
    employee_id: "EMPID",
    violation: "REMARKS",
    check_status: "CHECK STATUS",
    user_id: "OPERATOR",
    date_from: "FROM",
    date_to: "TO",
    qr_code: "PROXIMITY",
  };

  const overrideValues = {
    __none__: "None",
  };

  Object.entries(filters).forEach(([key, value], index) => {
    if (index > 0) textSpan.appendChild(document.createTextNode(" | "));
    const strong = document.createElement("strong");
    const properKey =
      overrideKeys[key] ||
      key
        .split(/(?=[A-Z])/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    strong.textContent = `${properKey}:`;
    textSpan.appendChild(strong);
    textSpan.appendChild(
      document.createTextNode(
        ` ${toProperCase(overrideValues[value] || value)}`,
      ),
    );
  });

  label.appendChild(textSpan);
  filterInfo.appendChild(label);

  const controlsDiv = document.querySelector(".controls");
  if (controlsDiv) controlsDiv.appendChild(filterInfo);
}

// ── Manpower image lookup ─────────────────────────────────────────────────────
async function getManpowerEmployeeData() {
  if (employeeDataCache) return employeeDataCache;
  if (!EmployeesBackend) return [];

  try {
    const response = await fetch(
      `${EmployeesBackend}?action=get&page=1&limit=1&filter_options=1`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-Silent-Request": "true",
        },
      },
    );

    if (response.ok) {
      const data = await response.json();
      if (data.success && Array.isArray(data.filter_options)) {
        employeeDataCache = data.filter_options;
        return data.filter_options;
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
        image_exists: emp.image_exists,
        id: emp.id,
        fullname: emp.fullname,
        position: emp.position,
        brand: emp.brand,
        status: emp.status,
        shift: emp.shift,
        user_id: emp.user_id,
        updated_at: emp.updated_at,
      };
    }
  });

  qrImageMapCache = qrImageMap;
  return qrImageMap;
}

function applyStats(stats) {
  if (!stats) return;

  const totalEl    = document.getElementById("total_scanned");
  const activeEl   = document.getElementById("active_employees");
  const inactiveEl = document.getElementById("inactive_employees");
  const todayEl    = document.getElementById("today_attendance");
  const todayInEl  = document.getElementById("today_in");
  const todayOutEl = document.getElementById("today_out");

  if (totalEl)    totalEl.textContent = stats.total ?? 0;
  if (activeEl)   activeEl.textContent = stats.active ?? 0;
  if (inactiveEl) inactiveEl.textContent = stats.inactive ?? 0;
  if (todayEl)    todayEl.textContent = stats.today ?? 0;
  if (todayInEl)  todayInEl.textContent = `IN : ${stats.today_in ?? 0}`;
  if (todayOutEl) todayOutEl.textContent = `OUT : ${stats.today_out ?? 0}`;
}

async function updateStatsPanel() {
  if (!AccessLogBackend) return;

  try {
    const response = await fetch(`${AccessLogBackend}?action=stats`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    if (!data.success || !data.data) return;

    applyStats(data.data);
  } catch (error) {
    console.error("Error updating employee counts", error);
  }
}

// ── Render table ──────────────────────────────────────────────────────────────
async function renderEmployeeError(message = "Failed to load employee data.") {
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
      <td colspan="13" style="text-align: center; padding: 20px; color: #c0392b;">
        ⚠️ ${escapeHtml(message)}
      </td>
    </tr>
  `;
}

function updateSortHeaders() {
  document.querySelectorAll(".sortable-th").forEach((th) => {
    const icon = th.querySelector(".sort-icon");
    if (!icon) return;
    if (th.dataset.col === sortCol) {
      icon.textContent = sortDir === "asc" ? "▲" : "▼";
      icon.style.color = "var(--accent, #667eea)";
    } else {
      icon.textContent = "⇅";
      icon.style.color = "";
    }
  });
}

function bindSortHeaders() {
  document.querySelectorAll(".sortable-th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = col;
        sortDir = "asc";
      }
      currentPage = 1;
      updateSortHeaders();
      loadEmployees(activeFilters, true, true);
    });
  });
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

  const currentEmployees = employees;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const qrImageMap = await buildQRToImageMap();

  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      let imageUrl = null;
      let displayName = employee.fullname || "N/A";
      let tooltipText = displayName;

      const matchedEmployeeData =
        qrImageMap[employee.qr_code.trim().toLowerCase()];
      const safeFullname = escapeHtml(toProperCase(employee.fullname));
      const safePosition = escapeHtml(toProperCase(employee.position));
      const safeBrand = escapeHtml(toProperCase(employee.brand));
      const safeStatus = escapeHtml(employee.status);
      const safeShift = escapeHtml(employee.shift);
      const safeViolation = escapeHtml(employee.violation);
      const safeQrCode = escapeHtml(employee.qr_code);
      const safeImage = escapeHtml(employee.image);
      const safeId = escapeHtml(String(employee.id));
      const safeEmpId = escapeHtml(String(employee.employee_id));
      const safeCheck = escapeHtml(employee.check_status);
      const safeGate = escapeHtml(
        employee.gate_name || employee.user_id || "N/A",
      );
      const safeTimestamp = escapeHtml(employee.access_timestamp);

      if (matchedEmployeeData && matchedEmployeeData.image) {
        imageUrl = `${window.location.origin}/public/uploads/user/${matchedEmployeeData.image}`;
        displayName = matchedEmployeeData.fullname || safeFullname;
        tooltipText = `${toProperCase(matchedEmployeeData.fullname)}\n${toProperCase(matchedEmployeeData.position)}\n${toProperCase(matchedEmployeeData.brand)}`;
      } else if (employee.image) {
        imageUrl = `${window.location.origin}/public/uploads/user/${employee.image}`;
        tooltipText = `${safeFullname}\n${safePosition}\n${safeBrand}`;
      }

      const fullnameInitials = (employee.fullname || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const isAboveFold = index < 5;

      const liveImage = (matchedEmployeeData?.image_exists
        ? matchedEmployeeData.image
        : null) ||
          (employee.image_exists ? employee.image : null);
      const safeLiveImage = escapeHtml(liveImage);
      const imgVersion = encodeURIComponent(
        matchedEmployeeData?.updated_at ||
          employee.updated_at ||
          employee.created_at ||
          Date.now(),
      );
      const thumbSrc = liveImage
        ? `${window.location.origin}/../public/uploads/user/${safeLiveImage}?v=${imgVersion}`
        : "";
      const imageSrc = thumbSrc;

      return `
        <tr class="row" data-emp-id="${safeId}">
          <td class="sn-cell">${startIndex + index + 1}</td>
          <td>
            <div class="emp-name"><strong>${safeFullname}</strong></div>
            <div class="emp-id"><strong>EMPID: ${safeEmpId}</strong></div>
          </td>
          <td>
            <div><small>${safeBrand}</small></div>
            <div class="emp-position"><strong>Position: ${safePosition}</strong></div>
          </td>
          <td>
            <div><small>${safeShift}</small></div>
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
                    class="remarks-item"
                    tabindex="-1"
                    onclick="openViolationPopupFromBtn(this)"
                    title="${safeViolation}">
                    <i class="fas fa-exclamation-triangle" style="font-size:10px;"></i>
                  </button>`
                  : `<span style="color:#aaa;font-size:11px;font-style:italic;">None</span>`
              }
            </div>
          </td>
          <td class="emp-img">${
            liveImage
              ? `<div class="img-skeleton-wrap">
                  <div class="img-skel-shimmer"></div>
                  <img src="${thumbSrc}" alt="${safeFullname}" class="employee-image"
                    width="45" height="45"
                    loading="${isAboveFold ? "eager" : "lazy"}"
                    decoding="async"
                    title="${tooltipText}"
                    ${isAboveFold ? 'fetchpriority="high"' : ""}
                    onload="this.classList.add('loaded');this.previousElementSibling.classList.add('hidden');"
                    onerror="if(this.src !== '${imageSrc}'){this.src='${imageSrc}';}else{this.onerror=null;this.closest('.img-skeleton-wrap').innerHTML='<div class=\\'ph-cont\\'title=\\'${tooltipText.replace(/'/g, "\\'").replace(/\n/g, " ")}\\'><div class=\\'employee-ph\\'>${escapeHtml(fullnameInitials)}</div></div>';}">
                  <div class="employee-ph-fallback ph-cont" style="display:none;" title="${tooltipText}">
                    <div class="employee-ph">${escapeHtml(fullnameInitials)}</div>
                  </div>
                </div>`
              : `<div class="ph-cont" title="${tooltipText}"><div class="employee-ph">${escapeHtml(fullnameInitials)}</div></div>`
          }</td>
          <td class="emp-proximity" onclick="copyQRCodeFromCell(this)" title="Copy Proximity code" style="cursor:pointer;">
            ${window.NfcIconSVG || ""}
          </td>
          <td class="emp-timestamp"><small>${safeTimestamp}</small></td>
          <td><div class="check-status-${safeCheck.toLowerCase()}"><div class="employee-ph">${safeCheck}</div></div></td>
          <td><small>${safeGate}</small></td>

          ${
            window.PERMISSIONS.delete
              ? `
          <td class="emp-actions">

            <!-- ACTIONS TOGGLE -->
            <button
              data-emp-id="${safeId}"
              class="actions-toggle-btn actions-item"
              tabindex="-1"
              onclick="toggleActionsPanel(this)">
              ACTIONS
            </button>

            <!-- FLOATING PANEL -->
            <div class="actions-panel">
              <small style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); text-align: center; color: #fff;">${safeFullname}</small>

              ${
                window.PERMISSIONS.delete
                  ? `
              <!-- DELETE -->
              <button
                data-emp-id="${safeId}"
                class="view-delete"
                tabindex="-1"
                onclick="openDeleteFromBtn(this)">
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

// ── Actions panel ─────────────────────────────────────────────────────────────
function toggleActionsPanel(btn) {
  const allPanels = document.querySelectorAll(".actions-panel");
  const allBtns = document.querySelectorAll(".actions-toggle-btn");
  const panel = btn.parentElement.querySelector(".actions-panel");
  const isAlreadyOpen = panel.classList.contains("actions-open");

  allPanels.forEach((p) => {
    p.classList.remove("actions-open");
    p.style.display = "none";
    if (p._originalParent && p.parentElement === document.body) {
      p._originalParent.appendChild(p);
    }
  });
  allBtns.forEach((b) => b.classList.remove("actions-active"));

  if (isAlreadyOpen) return;

  panel._originalParent = btn.parentElement;
  document.body.appendChild(panel);

  const rect = btn.getBoundingClientRect();
  const panelW = 160;
  const panelH = panel.scrollHeight || 180;

  let left = rect.right - panelW;
  left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));

  let top;
  if (rect.top >= panelH + 8) {
    top = rect.top - panelH - 4;
  } else {
    top = rect.bottom + 4;
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

async function getCurrentUserId() {
  if (!UserIdHelper) return "default";

  try {
    const response = await fetch(`${UserIdHelper}`, {
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

// ── QR copy ───────────────────────────────────────────────────────────────────
function copyQRCode(code) {
  if (!code) return;

  const fallbackCopy = () => {
    const tempTextArea = document.createElement("textarea");
    tempTextArea.value = code;
    tempTextArea.style.position = "fixed";
    tempTextArea.style.opacity = "0";
    document.body.appendChild(tempTextArea);
    tempTextArea.select();
    tempTextArea.setSelectionRange(0, 99999);
    try {
      document.execCommand("copy");
      showAlert("Proximity code copied to clipboard!");
    } catch (err) {
      showAlert("Failed to copy Proximity code", "error");
    } finally {
      document.body.removeChild(tempTextArea);
    }
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(code)
      .then(() => showAlert("Proximity code copied to clipboard!"))
      .catch(fallbackCopy);
  } else {
    fallbackCopy();
  }
}

function copyQRCodeFromCell(td) {
  const row = td.closest("tr[data-emp-id]");
  if (!row) return;

  const empId = row.dataset.empId;
  const employee = employees.find((e) => String(e.id) === String(empId));
  if (!employee || !employee.qr_code) {
    showAlert("Proximity code not available", "error");
    return;
  }

  copyQRCode(employee.qr_code);
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
  if (typeof clearDateRange === "function") {
    clearDateRange();
  }

  [
    ["search_position", "search_position_val"],
    ["search_brand", "search_brand_val"],
    ["search_status", "search_status_val"],
    ["search_shift", "search_shift_val"],
    ["search_violation", "search_violation_val"],
    ["search_in-out", "search_in-out_val"],
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
  if (!EmployeesBackend && !AccessLogBackend) {
    return;
  }

  setControlButtonsDisabled(true);
  try {
    // if (!silent) showLoading(true);

    if (Object.keys(filters).length === 0 && hasActiveFilters()) {
      filters = getActiveFilters();
    }

    activeFilters = filters;

    const params = buildFilterParams(filters);

    params.append("page", currentPage);
    params.append("limit", itemsPerPage);

    if (sortCol) {
      params.append("sort_col", sortCol);
      params.append("sort_dir", sortDir);
    }

    // The table body itself always loads paginated (itemsPerPage per page).
    // The DISTINCT filter/suggestion dataset is only worth fetching when the
    // user actually has a filter active, or on the very first load (so the
    // filter dropdowns have data to work with). Plain page turns, sorting,
    // and silent polls skip this to avoid a full table scan on every request.
    const filtersActive = Object.keys(filters).length > 0;
    if (!filterOptionsLoaded || filtersActive) {
      params.append("filter_options", "1");
    }

    const response = await fetch(`${AccessLogBackend}?${params.toString()}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;
      totalPages = data.pages;
      totalRecords = data.total;

      // Only refresh the cached suggestion/filter dataset when the backend
      // actually computed it this round; otherwise keep whatever we already have.
      if (
        data.field_filter_options &&
        typeof data.field_filter_options === "object"
      ) {
        fieldFilterOptions = data.field_filter_options;
        filterOptionsLoaded = true;

        allEmployees = Array.isArray(data.filter_options)
          ? data.filter_options
          : (data.data ?? []);
      }

      if (data.stats) applyStats(data.stats);

      if (!preservePage && Object.keys(filters).length === 0) currentPage = 1;

      employeeDataCache = null;
      qrImageMapCache = null;
      const initialMap = await buildQRToImageMap();
      _lastImageFingerprint = computeImageFingerprint(initialMap);

      await renderEmployeeTable();
      lastUpdateTimestamp = Date.now();
      updateAutoUpdateUI();
      resetNetworkErrorCount();
      updateDeleteButtonState();

      if (Object.keys(filters).length > 0) displayFilterStatus();
      console.log(`Loaded ${data.total || employees.length} employees`);
    } else {
      await renderEmployeeError("Network error. Please try again.");
      showAlert(data.message || "Error loading employees", "error");
    }
  } catch (error) {
    console.error("Error loading employees:", error);
    await renderEmployeeError("Network error. Please try again.");
    showAlert("Failed to load records. Please check your connection.", "error");
  } finally {
    // if (!silent) showLoading(false);
    setControlButtonsDisabled(false);
    updateDeleteButtonState();
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

  confirmBtn.dataset.employeeId = employeeId;
  confirmBtn.dataset.requireConfirmation = requireConfirmation;
  confirmBtn.dataset.hasFilters = hasFilters;

  if (requireConfirmation) {
    if (hasFilters) {
      modalTitle.textContent = "⚠️ Delete Filtered Employees";

      const label = totalRecords > 1 ? "employee's" : "employee";
      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will delete ${totalRecords} ${label} matching your filters:`;
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

      const label = totalRecords > 1 ? "employee's" : "employee";
      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will permanently delete ALL ${totalRecords} ${label}.`;
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

  const label = totalRecords > 1 ? "employee's" : "employee";
  const hasFilters = hasActiveFilters();
  const hasData = employees && employees.length > 0;
  const canDelete = hasFilters && hasData;

  deleteBtn.disabled = !canDelete;
  deleteBtn.style.opacity = canDelete ? "1" : "0.4";
  deleteBtn.style.cursor = canDelete ? "pointer" : "not-allowed";

  if (!hasFilters) deleteBtn.title = "Apply filters first to enable deletion";
  else if (!hasData) deleteBtn.title = "No matching records to delete";
  else deleteBtn.title = `Delete ${totalRecords} filtered ${label}`;
}

async function deleteFilteredEmployees() {
  try {
    showLoading(true);

    const params = buildFilterParams(activeFilters);
    params.append("page", 1);
    params.append("limit", 99999);
    params.append("filter_options", "0"); // full matching rows only, skip the distinct scan

    const allRes = await fetch(`${AccessLogBackend}?${params.toString()}`, {
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

    const response = await fetch(`${AccessLogBackend}`, {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success) {
      const label = totalRecords > 1 ? "employee's" : "employee";
      showAlert(
        `Successfully deleted ${totalRecords} ${label} matching your filters.`,
        "success",
      );
      currentPage = 1;
      clearSearch();
    } else {
      showAlert(data.message || "Failed to delete filtered employees", "error");
    }
  } catch (error) {
    showAlert("Failed to delete filtered employees", "error");
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
  overlay.style.cssText = `
    position:fixed;
    inset:0;
    background:rgba(0,0,0,0.35);
    display:flex;
    align-items:center;
    justify-content:center;
    z-index:9999;`;

  const reportUrl = "incident_report.php?" + params.toString();

  const card = document.createElement("div");
  card.style.cssText = `
    background:#fff;
    border:0.5px solid #e2e8f0;
    border-radius:12px;
    padding:1.25rem;
    max-width:360px;
    width:90%;
    box-shadow:0 4px 20px rgba(0,0,0,0.12);`;

  const header = document.createElement("div");
  header.style.cssText = `
    display:flex;
    justify-content:space-between;
    align-items:center;
    margin-bottom:12px;`;

  const headerLabel = document.createElement("span");
  headerLabel.style.cssText = `
    font-size:13px;
    font-weight:500;
    color:#64748b;`;
  headerLabel.textContent = `${toProperCase(fullname)} — Remarks`;

  const footer = document.createElement("div");
  footer.style.cssText = `
    display:flex;
    justify-content:end;
    align-items:center;
    margin-top:12px;`;

  const closeBtn = document.createElement("button");
  closeBtn.style.cssText = `
    background:none;
    border:none;
    font-size:16px;
    cursor:pointer;
    color:#94a3b8;
    line-height:1;
    padding:0;`;
  closeBtn.textContent = "✕";
  closeBtn.onclick = () => overlay.remove();

  header.appendChild(headerLabel);
  header.appendChild(closeBtn);

  const body = document.createElement("div");
  body.style.cssText = `
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:12px;`;

  const violationText = document.createElement("div");
  violationText.style.cssText = `
    font-size:13px;
    color:#1e293b;
    line-height:1.6;
    white-space:pre-wrap;
    flex:1;
    max-height:200px;
    overflow-y:auto;
    word-break:break-word;`;
  violationText.textContent = violation;

  const attachBtn = document.createElement("button");
  attachBtn.style.cssText = `
    display:inline-flex;
    align-items:center;
    gap:5px;
    padding:5px 12px;
    font-size:12px;
    font-weight:500;
    cursor:pointer;
    white-space:nowrap;
    flex-shrink:0;
    border:0.5px solid #cbd5e1;
    border-radius:6px;
    background:#f8fafc;
    color:#1e293b;`;
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

// ── Close modal ───────────────────────────────────────────────────────────────
function closeModal() {
  const deleteModal = document.getElementById("deleteModal");
  if (!deleteModal) return;

  deleteModal.style.display = "none";
}

async function handleFormSubmit(e) {
  e.preventDefault();
}

// ── Delete single record ──────────────────────────────────────────────────────
async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch(`${AccessLogBackend}`, {
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
    showAlert("Failed to delete employee", "error");
  } finally {
    showLoading(false);
  }
}

// ── Delete all records ────────────────────────────────────────────────────────
async function deleteAllEmployees(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete_all");
    formData.append("id", employeeId);

    const response = await fetch(`${AccessLogBackend}`, {
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
    console.error("Success:", error);

    currentPage = 1;
    clearSearch();

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

// ── File upload handler ───────────────────────────────────────────────────────
function setupFileUploadHandler() {
  const imageInput = document.getElementById("image");
  if (!imageInput) return;

  imageInput.addEventListener("change", async function (e) {
    const label = document.querySelector(".file-upload-label");
    if (!label) return;

    if (e.target.files.length === 0) {
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    const file = imageInput.files[0];
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
      "image/webp",
    ];
    if (!allowedTypes.includes(file.type)) {
      showAlert(
        "Only image files are allowed (JPEG, JPG, PNG, GIF, WebP)",
        "error",
      );
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    label.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
        <i class="fas fa-spinner fa-spin" style="font-size:24px;color:#2196F3;"></i>
        <small style="color:#2196F3;">Converting to WebP…</small>
      </div>`;

    try {
      const webpFile = await convertImageToWebP(file);

      const dt = new DataTransfer();
      dt.items.add(webpFile);
      imageInput.files = dt.files;

      const reader = new FileReader();
      reader.onload = (event) => {
        const isConverted =
          webpFile.type === "image/webp" && file.type !== "image/webp";
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

// ── Generic field autocomplete (ported from system.js) ───────────────────────
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

    if (!options.noDefaultAll) {
      items.push({ display: "Default: ALL", raw: "", special: "all" });
    }

    if (options.noneLabel) {
      items.push({
        display: options.noneLabel,
        raw: "__none__",
        special: "none",
      });
      items.push({ display: "──────────", raw: null, special: "divider" });
    }

    const seen = new Map();
    raw
      .map((v) => (v || "").trim())
      .filter((v) => v && v.toLowerCase() !== "none")
      .filter((v) => !lower || v.toLowerCase().includes(lower))
      .forEach((v) => {
        const key = v.toLowerCase();
        if (!seen.has(key)) seen.set(key, v);
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
          return `
            <li data-raw="" data-display=""
              style="padding:4px 12px;font-size:11px;color:#94a3b8;
                pointer-events:none;user-select:none;border-bottom:1px solid #f1f5f9;">
                  ──────────
            </li>
          `;
        }

        const safeDisplay = escapeHtml(item.display);
        let hl = safeDisplay;
        if (lower && !item.special) {
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

        return `
          <li data-raw="${escapeHtml(item.raw ?? "")}"
            data-display="${safeDisplay}"
            data-index="${i}"
            style="padding:8px 12px;cursor:pointer;font-size:13px;
                  border-bottom:1px solid #f1f5f9;
                  display:flex;align-items:center;${specialStyle}">
            ${hl}
          </li>
        `;
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

  input.addEventListener("focus", async () => {
    if (options.requireInput && !input.value.trim()) return;
    show(options.showAll ? "" : input.value);
    if (options.onFocus) {
      await options.onFocus();
      show(options.showAll ? "" : input.value);
    }
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
    if (!options.showAll) return;
    show("");
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

  if (input._outsideClickHandler) {
    document.removeEventListener("click", input._outsideClickHandler);
  }

  input._outsideClickHandler = (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = "none";
      idx = -1;
    }
  };
  document.addEventListener("click", input._outsideClickHandler);
}

// ── Utils ─────────────────────────────────────────────────────────────
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

function setControlButtonsDisabled(disabled) {
  const selectors = [
    ".search-btn .btn",
    ".clear-btn .btn",
    ".delete-all-btn .btn-danger",
    ".fRefresh-btn",
  ];
  selectors.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.disabled = disabled;
    el.style.opacity = disabled ? "0.4" : "";
    el.style.cursor = disabled ? "not-allowed" : "";
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
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

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function () {
  const ready = await resolveEndpoints();
  if (!ready) return;

  loadEmployees();
  updateDeleteButtonState();
  setupEventListeners();
  updateStatsPanel();
  bindSortHeaders();

  setTimeout(() => {
    initializeAutoUpdate();
  }, 1000);
});