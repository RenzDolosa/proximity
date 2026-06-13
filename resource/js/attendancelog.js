// resource/js/attendancelog.js --> attendance log table

let EmployeesBackend = null;
let AttendanceBackend = null;

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

    const response = await fetch(`${AttendanceBackend}?${params.toString()}`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        "X-Silent-Request": "true",
      },
      signal: AbortSignal.timeout(10000),
    });

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
      error.message.includes("Auto-update timeout")
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
    const response = await fetch(`${EmployeesBackend}?action=get`, {
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

      if (matchedEmployeeData && matchedEmployeeData.image) {
        imageUrl = `${window.location.origin}/../public/uploads/user/${matchedEmployeeData.image}`; // imageUrl = `../../uploads/user_${currentUserId}/${matchedEmployeeData.image}`;
        displayName = matchedEmployeeData.fullname || safeFullname;
        tooltipText = `${toProperCase(matchedEmployeeData.fullname)}\n${toProperCase(matchedEmployeeData.position)}\n${toProperCase(matchedEmployeeData.brand)}`;
      } else if (employee.image) {
        imageUrl = `${window.location.origin}/../public/uploads/user/${employee.image}`; // imageUrl = `../../uploads/user_${currentUserId}/${employee.image}`;
        tooltipText = `${safeFullname}\n${safePosition}\n${safeBrand}`;
      }

      const fullnameInitials = (employee.fullname || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const isAboveFold = index < 5;

      const thumbSrc = `${window.location.origin}/../public/uploads/user/thumb_${safeImage}`;
      const imageSrc = `${window.location.origin}/../public/uploads/user/${safeImage}`;

      return `
        <tr class="row">
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
            employee.image
              ? `<div class="img-skeleton-wrap">
                  <div class="img-skel-shimmer"></div>
                  <img src="${thumbSrc}" alt="${safeFullname}" class="employee-image"
                    width="45" height="45"
                    loading="${isAboveFold ? "eager" : "lazy"}"
                    decoding="async"
                    title="${tooltipText}"
                    ${isAboveFold ? 'fetchpriority="high"' : ""}
                    onload="this.classList.add('loaded');this.previousElementSibling.classList.add('hidden');"
                    onerror="if(this.src !== '${imageSrc}'){this.src='${imageSrc}';}else{this.onerror=null;this.closest('.img-skeleton-wrap').innerHTML='<div class=\\'ph-cont\\'title=\\'${tooltipText.replace(/'/g,"\\'").replace(/\n/g,' ')}\\'><div class=\\'employee-ph\\'>${escapeHtml(fullnameInitials)}</div></div>';}">
                  <div class="employee-ph-fallback ph-cont" style="display:none;" title="${tooltipText}">
                    <div class="employee-ph">${escapeHtml(fullnameInitials)}</div>
                  </div>
                </div>`
              : `<div class="ph-cont" title="${tooltipText}"><div class="employee-ph">${escapeHtml(fullnameInitials)}</div></div>`
          }</td>
          <td data-qr="${safeQrCode}" class="emp-proximity" onclick="copyQRCodeFromCell(this)" title="Copy Proximity code" style="cursor:pointer;">
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 512 512">
              <path d="M0 0 C1.8671875 1.1328125 1.8671875 1.1328125 3.6875 2.4375 C4.32945312 2.88867188 4.97140625 3.33984375 5.6328125 3.8046875 C12.06627036 8.87576605 16.39227202 15.57014088 20.6875 22.4375 C21.34621094 23.46746094 22.00492187 24.49742187 22.68359375 25.55859375 C51.23747477 74.33574664 50.67378716 139.45530043 36.90576172 192.44628906 C32.19944267 209.92529327 25.88960765 232.01237335 9.6875 242.4375 C2.18206673 245.55178766 -6.35065802 244.93076013 -13.875 241.9375 C-19.14967759 239.24807732 -23.73112419 235.58208816 -28.37744141 231.94384766 C-31.42555165 229.5710442 -34.50536176 227.24019229 -37.58105469 224.90332031 C-40.30508099 222.83314006 -43.02599356 220.75892945 -45.74609375 218.68359375 C-51.09985975 214.5993256 -56.45591129 210.51806505 -61.8125 206.4375 C-63.56251122 205.10418139 -65.3125112 203.77084803 -67.0625 202.4375 C-67.92875 201.7775 -68.795 201.1175 -69.6875 200.4375 C-72.3125 198.4375 -74.9375 196.4375 -77.5625 194.4375 C-78.42907227 193.7772583 -79.29564453 193.1170166 -80.18847656 192.43676758 C-81.9352363 191.10589527 -83.68198114 189.7750034 -85.42871094 188.4440918 C-89.85316371 185.07294264 -94.27788987 181.70215338 -98.703125 178.33203125 C-106.74477361 172.20728725 -114.78445594 166.08006898 -122.8125 159.9375 C-124.89869859 158.34220087 -126.98498216 156.74701295 -129.07128906 155.15185547 C-130.64134924 153.95087915 -132.21097407 152.74933357 -133.78027344 151.54736328 C-139.06420007 147.50114011 -144.35941498 143.47036492 -149.66503906 139.45263672 C-152.30619108 137.44230209 -154.93073125 135.41161082 -157.5546875 133.37890625 C-159.22341526 132.10605854 -160.89266422 130.83389376 -162.5625 129.5625 C-163.31192871 128.973479 -164.06135742 128.38445801 -164.83349609 127.77758789 C-169.81057833 124.0261219 -174.12716029 122.26475737 -180.3125 121.4375 C-183.02071018 131.93181446 -180.27502005 142.64420844 -178.4375 153.0625 C-169.81571431 202.54806425 -169.81571431 202.54806425 -179.3125 216.4375 C-183.81158383 221.30840894 -188.4569437 223.48711211 -195 223.875 C-202.53024915 223.69570835 -208.61065492 220.30643654 -214.0625 215.25 C-235.32229346 192.09379304 -236.87144312 154.02810893 -236.64868164 124.47436523 C-236.62489127 121.10962175 -236.62817992 117.74566707 -236.63476562 114.38085938 C-236.61485561 98.21599681 -235.96840475 82.30978699 -232 66.5625 C-231.7827124 65.68174805 -231.5654248 64.80099609 -231.34155273 63.89355469 C-228.32415574 52.08493076 -224.01327523 38.4774837 -213.3125 31.4375 C-207.94979312 28.26702055 -202.32020821 28.27153031 -196.3125 29.4375 C-192.09096398 31.83748382 -188.60139581 34.76885808 -184.98046875 37.98339844 C-182.20688021 40.40135706 -179.28405319 42.62373022 -176.375 44.875 C-175.19827495 45.79958133 -174.02249634 46.72536844 -172.84765625 47.65234375 C-169.33864683 50.41751679 -165.82593816 53.17795747 -162.3125 55.9375 C-158.85820963 58.65086594 -155.40433949 61.36475356 -151.953125 64.08203125 C-145.42264114 69.22176392 -138.87500641 74.33870342 -132.3125 79.4375 C-125.18920722 84.97200443 -118.08553308 90.5305816 -110.99804688 96.11083984 C-108.10441177 98.38836203 -105.20833448 100.66277541 -102.3125 102.9375 C-98.85822649 105.65088743 -95.40433952 108.36475354 -91.953125 111.08203125 C-85.42264114 116.22176392 -78.87500641 121.33870342 -72.3125 126.4375 C-66.88571801 130.65388559 -61.46481919 134.87730466 -56.0625 139.125 C-55.50264404 139.56497314 -54.94278809 140.00494629 -54.3659668 140.45825195 C-51.48061532 142.72725785 -48.59952425 145.00149711 -45.72265625 147.28125 C-40.27313516 151.59474817 -34.80485176 155.88519191 -29.25 160.0625 C-28.41339844 160.69414062 -27.57679688 161.32578125 -26.71484375 161.9765625 C-24.19631168 163.50815761 -22.21601235 164.0545055 -19.3125 164.4375 C-9.10480357 144.85115863 -9.46577344 119.72535392 -13.3125 98.4375 C-13.44188965 97.72094238 -13.5712793 97.00438477 -13.70458984 96.26611328 C-16.41204935 82.09248627 -21.16605208 68.59405778 -26.03466797 55.04760742 C-36.42156063 25.92954697 -36.42156063 25.92954697 -31.3125 11.4375 C-28.62882779 5.94656542 -25.48071594 1.42886825 -19.71484375 -0.97265625 C-13.28256384 -2.551964 -6.11637655 -2.78675144 0 0 Z " transform="translate(236.3125,130.5625)"/>
              <path d="M0 0 C7.26898446 5.49051451 11.12104728 13.12410054 14.86499023 21.22119141 C15.38407959 22.3255957 15.90316895 23.43 16.43798828 24.56787109 C20.45869356 33.24832584 24.00310046 42.01248934 27.07055664 51.07080078 C27.89188276 53.48783179 28.74235191 55.89333608 29.59545898 58.29931641 C40.66219268 89.95873469 47.45564462 123.20833432 51.86499023 156.40869141 C52.01597168 157.46862305 52.16695313 158.52855469 52.32250977 159.62060547 C57.62579224 197.87060185 57.53667483 239.22115111 51.86499023 277.40869141 C51.75328491 278.17000366 51.64157959 278.93131592 51.52648926 279.71569824 C44.84488014 324.89943161 34.52877403 370.10531454 15.23999023 411.72119141 C14.71791992 412.85935303 14.71791992 412.85935303 14.18530273 414.02050781 C10.73888282 421.22680468 6.8187842 427.9459778 -0.38500977 431.84619141 C-1.23579102 432.31927734 -2.08657227 432.79236328 -2.96313477 433.27978516 C-9.56903839 436.7134293 -17.95627341 436.58533559 -25.10375977 434.57275391 C-34.22746272 430.37697693 -39.07560744 423.70052165 -42.60375977 414.51025391 C-44.26729381 404.79815073 -40.52962578 396.01127593 -37.19750977 387.03369141 C-36.69985116 385.66426811 -36.20345328 384.29438606 -35.70825195 382.92407227 C-34.44084721 379.42358825 -33.16170697 375.92754294 -31.87823486 372.43292236 C-4.95643159 299.10931181 6.14218564 223.84268686 -7.13500977 146.40869141 C-7.33046387 145.26513184 -7.52591797 144.12157227 -7.72729492 142.94335938 C-12.97285106 113.28242678 -22.1294479 84.52830799 -32.95629883 56.46923828 C-34.90837902 51.40062245 -36.81137668 46.3146536 -38.69750977 41.22119141 C-39.03226318 40.34213135 -39.3670166 39.46307129 -39.71191406 38.55737305 C-42.8745721 30.01394836 -44.20515601 22.22660004 -41.13500977 13.40869141 C-37.00136999 6.07564003 -30.98784591 0.31936144 -22.82641602 -2.08349609 C-15.41735805 -3.48143156 -6.60210421 -4.24441332 0 0 Z " transform="translate(457.135009765625,39.59130859375)"/>
              <path d="M0 0 C7.7953733 6.55087912 11.53280265 15.42090184 15.76171875 24.48046875 C16.21248779 25.42623779 16.21248779 25.42623779 16.67236328 26.39111328 C32.79347085 60.37055554 41.01469222 99.12019718 43.76171875 136.48046875 C43.84784424 137.63232666 43.93396973 138.78418457 44.02270508 139.97094727 C44.70961576 149.9186128 44.96372734 159.82288009 44.94921875 169.79296875 C44.9486145 170.57115967 44.94801025 171.34935059 44.9473877 172.15112305 C44.86205494 213.03175637 39.27908005 253.78261823 25.76171875 292.48046875 C25.54225586 293.12983398 25.32279297 293.77919922 25.09667969 294.44824219 C22.06669035 303.37564745 18.30612776 311.93862076 14.32421875 320.48046875 C13.66063354 321.93211426 13.66063354 321.93211426 12.98364258 323.41308594 C8.16614773 333.51922856 2.51180624 340.64351445 -8.23828125 344.48046875 C-15.51757393 346.36861293 -22.88142079 345.56051826 -29.66015625 342.32421875 C-36.6807156 338.08361243 -40.72768524 332.46294914 -43.61328125 324.85546875 C-44.82485584 318.31296596 -44.11503764 313.00984918 -41.92578125 306.79296875 C-41.66651855 306.03169678 -41.40725586 305.2704248 -41.14013672 304.48608398 C-39.03740869 298.44503522 -36.674312 292.51824245 -34.28662109 286.58520508 C-25.49835099 264.71401966 -18.71381467 242.82167184 -15.23828125 219.48046875 C-15.12790527 218.75907715 -15.0175293 218.03768555 -14.90380859 217.29443359 C-12.61763113 202.16245899 -11.99860109 187.1316376 -11.98828125 171.85546875 C-11.98760651 170.9523999 -11.98693176 170.04933105 -11.98623657 169.11889648 C-12.004413 153.72566925 -12.76618222 138.70236989 -15.23828125 123.48046875 C-15.40457031 122.45179688 -15.57085937 121.423125 -15.7421875 120.36328125 C-20.15914921 94.12325688 -28.74989237 69.44819755 -38.22216797 44.68334961 C-38.54515366 43.83860077 -38.86813934 42.99385193 -39.20091248 42.12350464 C-39.81211422 40.52893154 -40.42580218 38.93530844 -41.04237366 37.34280396 C-44.73911997 27.728458 -45.20499335 20.16167797 -41.23828125 10.48046875 C-37.39094926 2.85330181 -31.0596262 -0.57634285 -23.23828125 -3.51953125 C-15.04641976 -5.32005608 -6.94554092 -5.02952963 0 0 Z " transform="translate(358.23828125,85.51953125)"/>
            </svg>
          </td>
          <td class="emp-timestamp"><small>${employee.access_timestamp || "N/A"}</small></td>
          <td><small>${escapeHtml(employee.gate_name || employee.user_id || "N/A")}</small></td>
          ${
            window.PERMISSIONS.delete
              ? `
          <td style="position: relative; width: 160px; overflow: visible;">

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
              <small style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);text-align:center;color:#fff;">${safeFullname}</small>
              
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
  if (typeof clearDateRange === "function") {
    clearDateRange();
  }

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

    const response = await fetch(`${AttendanceBackend}?${params.toString()}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

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

    const allRes = await fetch(`${AttendanceBackend}?${params.toString()}`, {
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

    const logIds = allData.data.map((emp) => emp.id);
    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(logIds));
    formData.append("filters", JSON.stringify(activeFilters));

    const response = await fetch(`${AttendanceBackend}`, {
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

    const response = await fetch(`${AttendanceBackend}`, {
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

    const response = await fetch(`${AttendanceBackend}`, {
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
    '.search-btn .btn',
    '.clear-btn .btn',
    '.delete-all-btn .btn-danger',
    '.fRefresh-btn',
  ];
  selectors.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.disabled = disabled;
    el.style.opacity = disabled ? '0.4' : '';
    el.style.cursor = disabled ? 'not-allowed' : '';
  });
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
window.addEventListener("beforeunload", () => {
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

  setTimeout(() => {
    initializeAutoUpdate();
  }, 1000);
});
