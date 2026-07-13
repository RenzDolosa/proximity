// resource/js/proxcode.js --> proximity table

let EmployeesBackend = null;
let ProxcodeBackend = null;
let UserIdHelper = null;

let currentAction = "add";
let employees = [];
let currentUserId = null;
let employeeDataCache = null;
let qrImageMapCache = null;
let systemQRCodesCache = null;

let totalRecords = 0;

let activeFilters = {};
let allEmployees = [];
let fieldFilterOptions = {};

let sortCol = null;
let sortDir = "asc";

const MANPOWER_LIVE_SYNC_POLL_MS = 2000;
let _manpowerLiveSyncInterval = null;
let _manpowerSyncInFlight = false;
let _lastManpowerFingerprint = null;

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

  return !isAnyModalOpen();
}

function isAnySuggestionOpen() {
  return [...document.querySelectorAll("ul[data-suggestion-list]")].some(
    (el) => el.style.display === "block",
  );
}

function isAnyModalOpen() {
  return (
    document.getElementById("employeeModal")?.style.display === "block" ||
    document.getElementById("deleteModal")?.style.display === "flex" ||
    document.getElementById("importModal")?.style.display === "block"
  );
}

function hideAllSuggestions(scope) {
  document.querySelectorAll("ul[data-suggestion-list]").forEach((ul) => {
    if (!scope) {
      ul.style.display = "none";
      return;
    }
    const owner = document.getElementById(ul.dataset.ownerInput);
    if (owner && scope.contains(owner)) ul.style.display = "none";
  });
}

function _buildManpowerFingerprint(list) {
  if (!Array.isArray(list)) return "";
  return list
    .map(
      (e) =>
        `${e.id}|${String(e.qr_code || "").trim().toLowerCase()}|${e.image || ""}|${e.updated_at || ""}|${e.fullname || ""}|${e.status || ""}`,
    )
    .sort()
    .join(";");
}

async function _fetchFreshManpowerEmployeeData() {
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
        return data.filter_options;
      }
    }
  } catch (error) {
    console.warn("[proxcode] Failed to fetch fresh manpower data:", error);
  }

  return [];
}

async function pollForRemoteManpowerChanges() {
  if (_manpowerSyncInFlight) return;
  if (!EmployeesBackend) return;

  if (isAnyModalOpen() || isAnySuggestionOpen()) return;
  if (document.hidden) return;

  _manpowerSyncInFlight = true;
  try {
    const freshData = await _fetchFreshManpowerEmployeeData();
    const fingerprint = _buildManpowerFingerprint(freshData);

    if (_lastManpowerFingerprint === null) {
      _lastManpowerFingerprint = fingerprint;
      return;
    }

    if (fingerprint !== _lastManpowerFingerprint) {
      _lastManpowerFingerprint = fingerprint;

      employeeDataCache = freshData;
      qrImageMapCache = null;

      await loadEmployees(
        hasActiveFilters() ? getActiveFilters() : {},
        true,
        true,
      );
    }
  } catch (error) {
    console.warn("[proxcode] pollForRemoteManpowerChanges failed:", error);
  } finally {
    _manpowerSyncInFlight = false;
  }
}

function startManpowerLiveSync() {
  stopManpowerLiveSync();
  _manpowerLiveSyncInterval = setInterval(
    pollForRemoteManpowerChanges,
    MANPOWER_LIVE_SYNC_POLL_MS,
  );
}

function stopManpowerLiveSync() {
  if (_manpowerLiveSyncInterval) {
    clearInterval(_manpowerLiveSyncInterval);
    _manpowerLiveSyncInterval = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopManpowerLiveSync();
  } else {
    pollForRemoteManpowerChanges();
    startManpowerLiveSync();
  }
});

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

    if (isAnyModalOpen()) return;

    if (isAnySuggestionOpen()) return;

    const active = document.activeElement;
    const isTyping =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "SELECT" ||
        active.tagName === "TEXTAREA");

    if (!isTyping && proximityInput) proximityInput.focus();
  }

  const isActiveToggle = document.getElementById("is_active_toggle");
  if (isActiveToggle) {
    isActiveToggle.addEventListener("change", function () {
      const hiddenInput = document.getElementById("is_active");
      const statusLabel = document.getElementById("statusLabel");
      hiddenInput.value = this.checked ? "1" : "0";
      statusLabel.textContent = this.checked ? "Enabled" : "Disabled";
      statusLabel.style.color = this.checked ? "#16a34a" : "#b91c1c";
    });
  }

  autoFocusProximity();
  document.addEventListener("click", autoFocusProximity);
  document.addEventListener("focusin", autoFocusProximity);

  // ── Field suggestion dropdowns ─────────────────────────────────────────
  setupFieldSuggestions(
    "search_empid",
    "search-empid-suggestions",
    () => {
      const map = qrImageMapCache || {};
      const ids = new Set();
      Object.values(map).forEach((v) => {
        if (v && v.id !== undefined && v.id !== null && v.id !== "") {
          ids.add(String(v.id));
        }
      });
      return [...ids].sort((a, b) => Number(a) - Number(b));
    },
    {
      showAll: true,
      onSelect: () => searchEmployees(),
      onFocus: async () => {
        if (!qrImageMapCache) await buildQRToImageMap();
      },
    },
  );
  
  setupFieldSuggestions(
    "search_remarks",
    "search-remarks-suggestions",
    () => {
      const map = qrImageMapCache || {};
      const values = new Set();
      (allEmployees.length ? allEmployees : employees).forEach((row) => {
        const qr = String(row.qr_code || "").trim().toLowerCase();
        if (!qr) return;
        values.add(
          Object.prototype.hasOwnProperty.call(map, qr)
            ? "Occupied"
            : "Available",
        );
      });
      return [...values];
    },
    {
      hiddenId: "search_remarks_val",
      noneLabel: "No Remarks",
      showAll: true,
      raw: true,
      onSelect: () => searchEmployees(),
      onFocus: async () => {
        if (!qrImageMapCache) await buildQRToImageMap();
      },
    },
  );

  setupFieldSuggestions(
    "search_status",
    "search-status-suggestions",
    () =>
      [...(fieldFilterOptions.status || allEmployees)]
        .map((e) => (e.is_active == 1 ? "Enabled" : "Disabled"))
        .filter(Boolean),
    {
      hiddenId: "search_status_val",
      noneLabel: "No Status",
      showAll: true,
      onSelect: () => searchEmployees(),
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

// ── Filter helpers ────────────────────────────────────────────────────────────
function buildFilterParams(filters) {
  const params = new URLSearchParams({ action: "get" });

  for (const [key, value] of Object.entries(filters)) {
    if (key === "remarks" && value === "__none__") {
      continue;
    } else if (key === "remarks") {
      params.append("remarks", value);
    } else if (key === "status" && value === "__none__") {
      continue;
    } else if (key === "status" && value === "Enabled") {
      params.append("is_active", "1");
    } else if (key === "status" && value === "Disabled") {
      params.append("is_active", "0");
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

  delete filters["created_at"];

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
    empid: "EMPID",
    remarks: "REMARKS",
    date_from: "FROM",
    date_to: "TO",
    qr_code: "PROXIMITY",
  };

  const overrideValues = {
    "__none__": "None",
  }

  Object.entries(filters).forEach(([key, value], index) => {
    if (index > 0) textSpan.appendChild(document.createTextNode(" | "));
    const strong = document.createElement("strong");
    const properKey = overrideKeys[key] || key
      .split(/(?=[A-Z])/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    strong.textContent = `${properKey}:`;
    textSpan.appendChild(strong);
    textSpan.appendChild(document.createTextNode(` ${toProperCase(overrideValues[value] || value)}`));
  });

  label.appendChild(textSpan);
  filterInfo.appendChild(label);

  const controlsDiv = document.querySelector(".controls");
  if (controlsDiv) controlsDiv.appendChild(filterInfo);
}

// ── Manpower image lookup ────────────────────────────────────────────────────
async function getManpowerEmployeeData() {
  if (employeeDataCache) return employeeDataCache;

  if (!EmployeesBackend) return [];

  try {
    if (employeeDataCache) {
      return employeeDataCache;
    }

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
        updated_at: emp.updated_at,
      };
    }
  });

  qrImageMapCache = qrImageMap;
  return qrImageMap;
}

async function syncOrphanStatuses() {
  if (!ProxcodeBackend) return;

  try {
    const response = await fetch(`${ProxcodeBackend}?action=sync_orphans`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
    });

    if (!response.ok) return;

    const data = await response.json();

    if (data.success && data.synced_count > 0) {
      const label = data.synced_count === 1 ? "employee" : "employees";
      showAlert(
        `${escapeHtml(String(data.synced_count))} ${label} set to Inactive — ` +
          `their proximity code is missing or disabled.`,
        "info",
      );

      employeeDataCache = null;
      qrImageMapCache = null;

      await loadEmployees(
        hasActiveFilters() ? getActiveFilters() : {},
        true,
        true,
      );
      await updateStatsPanel();
    }
  } catch (error) {
    console.warn("[proxcode] syncOrphanStatuses failed:", error);
  }
}

async function loadEmployeeData(employeeId) {
  if (!EmployeesBackend) return;

  try {
    const response = await fetch(
      `${ProxcodeBackend}?action=get_single&id=${encodeURIComponent(employeeId)}`,
      {
        headers: {
          "X-Requested-With": "XMLHttpRequest",
          "X-Silent-Request": "true",
        },
      },
    );

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && data.data) {
      const employee = data.data;

      document.getElementById("employee_id").value = employee.id || "";
      document.getElementById("qr_code").value = employee.qr_code || "";

      const isActive =
        employee.is_active !== undefined ? parseInt(employee.is_active) : 1;
      const toggle = document.getElementById("is_active_toggle");
      const hiddenInput = document.getElementById("is_active");
      const statusLabel = document.getElementById("statusLabel");

      if (toggle && hiddenInput && statusLabel) {
        toggle.checked = isActive === 1;
        hiddenInput.value = isActive;
        statusLabel.textContent = isActive === 1 ? "Enabled" : "Disabled";
        statusLabel.style.color = isActive === 1 ? "#16a34a" : "#b91c1c";
      }

      const fileLabel = document.querySelector(".file-upload-label");
      if (fileLabel) {
        fileLabel.innerHTML = employee.image
          ? `<i class="fas fa-image"></i> Current: ${escapeHtml(employee.image)}`
          : `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      }
    } else {
      showAlert(data.message || "Failed to load proximity code", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to load proximity code", "error");
  }
}

async function getSystemEmployeeQRCodes() {
  const manpowerEmployees = await getManpowerEmployeeData();
  return manpowerEmployees
    .map((emp) => emp.qr_code)
    .filter((qr) => qr)
    .map((qr) => qr.trim().toLowerCase());
}

async function updateStatsPanel() {
  if (!ProxcodeBackend) return;

  try {
    const response = await fetch(`${ProxcodeBackend}?action=stats`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();
    if (data.success && data.data) {
      const stats = data.data;

      const totalEl = document.getElementById("total_employees");
      const availableEl = document.getElementById("total_available");
      const occupiedEl = document.getElementById("total_occupied");

      if (totalEl) totalEl.textContent = stats.total ?? 0;
      if (availableEl) availableEl.textContent = stats.available ?? 0;
      if (occupiedEl) occupiedEl.textContent = stats.occupied ?? 0;
    }
  } catch (error) {
    console.error("Error updating code counts", error);
  }
}

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
      <td colspan="8" style="text-align:center;padding:20px;color:#c0392b;">
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
  const currentUserId = await loadCurrentUserId();
  const qrImageMap = await buildQRToImageMap();

  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      let imageUrl = null;
      let displayName = employee.qr_code;
      let tooltipText = displayName;

      const matchedEmployeeData =
        qrImageMap[employee.qr_code.trim().toLowerCase()];
      const safeQrCode = escapeHtml(employee.qr_code);
      const safeName = escapeHtml(displayName);
      const safeId = escapeHtml(String(employee.id));
      const safeEmpId = escapeHtml(
        matchedEmployeeData ? String(matchedEmployeeData.id) : "",
      );
      const qrLower = employee.qr_code.trim().toLowerCase();
      const isOccupied = Object.prototype.hasOwnProperty.call(
        qrImageMap,
        qrLower,
      );
      const safeCreatedAt = escapeHtml(employee.created_at);
      const safeUpdatedAt = escapeHtml(employee.updated_at);

      const displayRemarks = isOccupied ? "Occupied" : "Available";

      if (matchedEmployeeData && matchedEmployeeData.image) {
        displayName = matchedEmployeeData.fullname || safeName;
        tooltipText = `${toProperCase(matchedEmployeeData.fullname)}\n${toProperCase(matchedEmployeeData.position)}\n${toProperCase(matchedEmployeeData.brand)}`;
      } else if (employee.image) {
        tooltipText = `${toProperCase(employee.fullname)}\n${toProperCase(employee.position)}\n${toProperCase(employee.brand)}`;
      }

      const liveImage =
        (matchedEmployeeData?.image_exists ? matchedEmployeeData.image : null) ||
        (employee.image_exists ? employee.image : null);
      const safeLiveImage = escapeHtml(liveImage);
      const imgVersion = encodeURIComponent(
        matchedEmployeeData?.updated_at ||
          employee.updated_at ||
          employee.created_at ||
          Date.now(),
      );
      imageUrl = liveImage
        ? `${window.location.origin}/../public/uploads/user/${safeLiveImage}?v=${imgVersion}`
        : null;
      const imageSrc = imageUrl;

      const displayInitials = (displayName || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const isAboveFold = index < 5;

      return `
        <tr class="row" data-emp-id="${safeId}">
          <td class="sn-cell">${startIndex + index + 1}</td>
          <td class="emp-img">${
            imageUrl
              ? `<div class="img-skeleton-wrap">
                  <div class="img-skel-shimmer"></div>
                  <img src="${imageUrl}" alt="${safeName}" class="employee-image"
                    width="45" height="45"
                    loading="${isAboveFold ? "eager" : "lazy"}"
                    decoding="async"
                    title="${tooltipText}"
                    ${isAboveFold ? 'fetchpriority="high"' : ""}
                    onload="this.classList.add('loaded');this.previousElementSibling.classList.add('hidden');"
                    onerror="if(this.src !== '${imageSrc}'){this.src='${imageSrc}';}else{this.onerror=null;this.style.display='none';this.parentElement.querySelector('.employee-ph-fallback').style.display='flex';}">
                  <div class="employee-ph-fallback ph-cont" style="display:none;" title="${tooltipText}">
                    <div class="employee-ph">${escapeHtml(displayInitials)}</div>
                  </div>
                </div>`
              : `<div class="ph-cont" title="${tooltipText}"><div class="employee-ph">${escapeHtml(displayInitials)}</div></div>`
          }</td>
          <td class="emp-proximity" onclick="copyQRCodeFromCell(this)" title="Copy Proximity code" style="cursor:pointer;">
            ${window.NfcIconSVG || ""}
          </td>
          <td class="emp-remark">
            <div>${displayRemarks.toLowerCase() == "occupied" ? `<small class="remarks-occupied">Occupied</small>` : `<span class="remarks-available">Available</span>`}</div>
            ${safeEmpId ? `<div class="emp-id"><strong>EMPID: ${safeEmpId}</strong></div>` : ""}
          </td>
          <td>
            <span class="status-${employee.is_active == 1 ? "enabled" : "disabled"}">
              ${escapeHtml(employee.is_active == 1 ? "Enabled" : "Disabled")}
            </span>
          </td>
          <td><small>${safeCreatedAt}</small></td>
          <td class="emp-updatedAt"><small>${safeUpdatedAt}</small></td>

          ${
            window.PERMISSIONS.edit || window.PERMISSIONS.delete
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
              <small style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);text-align:center;color:#fff;">
                ${escapeHtml(toProperCase(matchedEmployeeData?.fullname || "Row SN: " + (startIndex + index + 1)))}
              </small>

              ${
                window.PERMISSIONS.edit
                  ? `
              <!-- EDIT -->
              <button
                data-emp-id="${safeId}"
                class="view-edit"
                tabindex="-1"
                onclick="openEditFromBtn(this)">
                <i class="fas fa-edit"></i> EDIT
              </button>
              `
                  : ""
              }

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
  await updateStatsPanel();
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

function openEditFromBtn(btn) {
  openModal("edit", parseInt(btn.dataset.empId, 10));
}

function openDeleteFromBtn(btn) {
  openDeleteModal(btn.dataset.empId, false);
}

async function loadCurrentUserId() {
  if (!ProxcodeBackend) return;

  try {
    const response = await fetch(`${ProxcodeBackend}?action=user_info`, {
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
    ["search_remarks", "search_remarks_val"],
    ["search_status", "search_status_val"],
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
  if (!EmployeesBackend && !ProxcodeBackend) {
    return;
  }

  setControlButtonsDisabled(true);
  try {
    if (Object.keys(filters).length === 0 && hasActiveFilters()) {
      filters = getActiveFilters();
    }

    activeFilters = filters;

    const { status: statusFilter, ...backendFilters } = filters;

    const params = new URLSearchParams({ action: "get", ...backendFilters });

    params.append("page", currentPage);
    params.append("limit", itemsPerPage);

    if (sortCol) {
      params.append("sort_col", sortCol);
      params.append("sort_dir", sortDir);
    }

    if (statusFilter === "Enabled") params.set("is_active", "1");
    else if (statusFilter === "Disabled") params.set("is_active", "0");

    const response = await fetch(`${ProxcodeBackend}?${params.toString()}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;
      totalPages = data.pages;
      totalRecords = data.total;
      
      if (Array.isArray(data.filter_options)) {
        allEmployees = data.filter_options;
      }

      if (data.field_filter_options && typeof data.field_filter_options === "object") {
        fieldFilterOptions = data.field_filter_options;
      }

      if (sortCol === "remarks") {
        const qrImageMap = await buildQRToImageMap();
        employees.sort((a, b) => {
          const getRemarks = (emp) =>
            Object.prototype.hasOwnProperty.call(
              qrImageMap,
              String(emp.qr_code).trim().toLowerCase(),
            )
              ? "Occupied"
              : "Available";
          const ra = getRemarks(a);
          const rb = getRemarks(b);
          const cmp = ra.localeCompare(rb);
          return sortDir === "asc" ? cmp : -cmp;
        });
      }

      if (!preservePage && Object.keys(filters).length === 0) currentPage = 1;

      await buildQRToImageMap();
      await renderEmployeeTable();
      await syncOrphanStatuses();

      if (Object.keys(filters).length > 0) displayFilterStatus();
      console.log(`Loaded ${data.total || employees.length} employees`);
    } else {
      await renderEmployeeError("Network error. Please try again.");
      showAlert(data.message || "Error loading proximity codes", "error");
    }
  } catch (error) {
    await renderEmployeeError("Network error. Please try again.");
    showAlert(
      "Failed to load proximity codes. Please check your connection.",
      "error",
    );
  } finally {
    setControlButtonsDisabled(false);
    updateDeleteButtonState();
  }
}

// ── Open modal ──────────────────────────────────────────────────────
async function openModal(action, employeeId = null) {
  closeAllActionsPanels();

  currentAction = action;
  const modal = document.getElementById("employeeModal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("employeeForm");
  const qrCodeInput = document.getElementById("qr_code");

  if (!modal || !modalTitle || !form) return;

  form.reset();
  const employeeIdInput = document.getElementById("employee_id");
  if (employeeIdInput) employeeIdInput.value = "";

  const fileLabel = document.querySelector(".file-upload-label");
  if (fileLabel && action === "add") {
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
  }

  if (action === "add") {
    modalTitle.innerHTML = `<i class="fas fa-id-card"></i> Add Proximity Code`;
    const statusGroup = document.getElementById("statusToggleGroup");
    if (statusGroup) statusGroup.style.display = "none";

    const toggle = document.getElementById("is_active_toggle");
    const hiddenInput = document.getElementById("is_active");
    const statusLabel = document.getElementById("statusLabel");
    if (toggle) toggle.checked = true;
    if (hiddenInput) hiddenInput.value = "1";
    if (statusLabel) {
      statusLabel.textContent = "Enabled";
      statusLabel.style.color = "#16a34a";
    }
  } else if (action === "edit" && employeeId) {
    modalTitle.innerHTML = `<i class="fas fa-edit" style="color:#7c3aed"></i> Edit Proximity`;
    const statusGroup = document.getElementById("statusToggleGroup");
    if (statusGroup) statusGroup.style.display = "block";
    await loadEmployeeData(employeeId);
  }

  modal.style.display = "block";
  if (action === "add") qrCodeInput.focus();
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
      modalTitle.textContent = "⚠️ Delete Filtered Proximity Codes";

      const label = totalRecords > 1 ? "codes" : "code";
      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will delete ${totalRecords} ${label} matching your filters:`;
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
      modalTitle.textContent = "⚠️ Delete All Proximity Codes";

      const label = totalRecords > 1 ? "codes" : "code";
      const msgDiv = document.createElement("div");
      const p1 = document.createElement("p");
      p1.style.marginBottom = "15px";
      const strong = document.createElement("strong");
      strong.textContent = `This will permanently delete ALL ${totalRecords} ${label}.`;
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
    modalTitle.textContent = "Delete Proximity Code";
    modalMessage.textContent =
      "Are you sure you want to delete this proximity code?";
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
    const newInput = confirmationInput.cloneNode(true);
    confirmationInput.parentNode.replaceChild(newInput, confirmationInput);
    newInput.focus();

    newInput.addEventListener("input", () => {
      newConfirmBtn.disabled = newInput.value !== "DELETE ALL";
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

  const count = employees.length;
  const label = count > 1 ? "codes" : "code";
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
    params.set("page", 1);
    params.set("limit", 99999);

    const allRes = await fetch(`${ProxcodeBackend}?${params.toString()}`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
    });

    if (!allRes.ok) throw new Error(`HTTP error! status: ${allRes.status}`);

    const allData = await allRes.json();

    if (
      !allData.success ||
      !Array.isArray(allData.data) ||
      allData.data.length === 0
    ) {
      showAlert("No proximity codes to delete", "warning");
      return;
    }

    const employeeIds = allData.data.map((emp) => emp.id);
    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(employeeIds));
    formData.append("filters", JSON.stringify(activeFilters));

    const response = await fetch(`${ProxcodeBackend}`, {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success) {
      const label = totalRecords > 1 ? "codes" : "code";
      showAlert(
        `Successfully deleted ${totalRecords} ${label} matching your filters.`,
        "success",
      );
      currentPage = 1;
      clearSearch();
    } else {
      showAlert(
        data.message || "Failed to delete filtered proximity codes",
        "error",
      );
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert("Failed to delete filtered proximity codes", "error");
  } finally {
    showLoading(false);
  }
}

function closeModal() {
  ["employeeModal", "deleteModal", "importModal"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const form = document.getElementById("employeeForm");
  if (form) form.reset();
}

async function handleFormSubmit(e) {
  e.preventDefault();

  try {
    const employeeIdField = document.getElementById("employee_id");
    const qrCodeField = document.getElementById("qr_code");

    if (!qrCodeField) {
      showAlert("Form field 'qr_code' not found", "error");
      return;
    }

    const employeeId = employeeIdField?.value || "";
    const qrCode = qrCodeField.value.trim();

    if (!qrCode) {
      showAlert("Please enter a Proximity code", "error");
      return;
    }

    const isDuplicate = employees.some((emp) => {
      if (currentAction === "edit" && employeeId && emp.id == employeeId)
        return false;
      return emp.qr_code.toLowerCase().trim() === qrCode.toLowerCase();
    });

    if (isDuplicate) {
      showAlert(
        `Proximity code "${escapeHtml(qrCode)}" already exists!`,
        "error",
      );
      return;
    }

    showLoading(true);

    const formData = new FormData(e.target);
    formData.append("action", currentAction);

    const response = await fetch(`${ProxcodeBackend}`, {
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
            ? "Proximity code added successfully!"
            : "Proximity code updated successfully!"),
        "success",
      );
      closeModal();

      employeeDataCache = null;
      qrImageMapCache = null;

      const preservePage = currentAction === "edit";
      const filtersToUse = hasActiveFilters() ? getActiveFilters() : {};
      await loadEmployees(filtersToUse, preservePage, true);

      await syncOrphanStatuses();
    } else {
      showAlert(data.message || "Failed to save proximity code", "error");
    }
  } catch (error) {
    console.error("Error:", error);
    showAlert(
      "Failed to save proximity code. Please check your connection.",
      "error",
    );
  } finally {
    showLoading(false);
  }
}

async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch(`${ProxcodeBackend}`, {
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
      await loadEmployees(activeFilters, true, true);
      await syncOrphanStatuses();
    } else {
      showAlert(data.message || "Failed to delete proximity code", "error");
    }
  } catch (error) {
    showAlert("Failed to delete proximity code", "error");
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

    const response = await fetch(`${ProxcodeBackend}`, {
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
    showAlert("Delete all proximity code data", "success");

    currentPage = 1;
    clearSearch();
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

    if (e.target.files.length === 0) {
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

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

    label.innerHTML = `<i class="fas fa-image"></i> ${escapeHtml(file.name)}`;
  });
}

// ── Generic field autocomplete ───────────────────────────────────────────────
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
  list.dataset.suggestionList = "1";
  list.dataset.ownerInput = inputId;
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
window.onclick = function (event) {
  const modal = document.getElementById("employeeModal");
  if (event.target === modal) {
    closeModal();
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function () {
  const ready = await resolveEndpoints();
  if (!ready) return;

  loadCurrentUserId();
  await loadEmployees();
  updateDeleteButtonState();
  setupEventListeners();
  syncOrphanStatuses();
  updateStatsPanel();
  bindSortHeaders();

  _lastManpowerFingerprint = _buildManpowerFingerprint(employeeDataCache || []);
  startManpowerLiveSync();
});