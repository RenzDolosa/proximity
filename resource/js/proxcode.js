// resource/js/proxcode.js --> proximity table

const EmployeesBackend = "manpower_backend.php";
const ProxcodeBackend = "proxcode_backend.php";

let currentAction = "add";
let employees = [];
let currentUserId = null;
let employeeDataCache = null;
let qrImageMapCache = null;
let systemQRCodesCache = null;

let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;
let totalRecords = 0;

let activeFilters = {};

const count = employees.length;
const label = count > 1 ? "code's" : "code";

// ─── Suggestion visibility helpers ───────────────────────────────
function isInputVisible(input) {
  const parentModal = input.closest(".modal, .modal-overlay");
  if (parentModal) {
    const d = parentModal.style.display;
    return d === "block" || d === "flex";
  }

  const anyModalOpen =
    document.getElementById("employeeModal")?.style.display === "block" ||
    document.getElementById("deleteModal")?.style.display === "flex" ||
    document.getElementById("importModal")?.style.display === "block";

  return !anyModalOpen;
}

document.addEventListener("DOMContentLoaded", function () {
  loadCurrentUserId();
  loadEmployees();
  updateDeleteButtonState();
  setupEventListeners();
  updateTotalAvailable();
  syncOrphanStatuses();
});

async function loadCurrentUserId() {
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

async function getManpowerEmployeeData() {
  try {
    if (employeeDataCache) {
      return employeeDataCache;
    }

    const response = await fetch(
      `${EmployeesBackend}?action=get&page=1&limit=1`,
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
        console.log(
          `[proxcode] manpower cache loaded: ${data.filter_options.length} employees`,
        );
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
        id: emp.id,
        fullname: emp.fullname,
        position: emp.position,
        brand: emp.brand,
        status: emp.status,
        shift: emp.shift,
      };
    }
  });

  qrImageMapCache = qrImageMap;
  return qrImageMap;
}

async function getSystemEmployeeQRCodes() {
  const manpowerEmployees = await getManpowerEmployeeData();
  return manpowerEmployees
    .map((emp) => emp.qr_code)
    .filter((qr) => qr)
    .map((qr) => qr.trim().toLowerCase());
}

async function updateTotalAvailable() {
  try {
    const qrImageMap = await buildQRToImageMap();
    const occupiedCount = employees.filter(
      (emp) =>
        emp.qr_code &&
        Object.prototype.hasOwnProperty.call(
          qrImageMap,
          String(emp.qr_code).trim().toLowerCase(),
        ),
    ).length;

    const availableCount = employees.length - occupiedCount;

    const totalAvailableElement = document.getElementById("total_available");
    const totalOccupiedElement = document.getElementById("total_occupied");

    if (totalAvailableElement)
      totalAvailableElement.textContent = availableCount;
    if (totalOccupiedElement) totalOccupiedElement.textContent = occupiedCount;
  } catch (error) {
    console.error("Error updating total available:", error);
  }
}

async function updateTotalEmployees() {
  try {
    const el = document.getElementById("total_employees");
    if (el) el.textContent = employees.length;
  } catch (error) {
    console.error("Error updating total employees:", error);
  }
}

function setupEventListeners() {
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

  const dateInput = document.getElementById("search_date");
  if (dateInput) {
    dateInput.addEventListener("change", function () {
      const clearBtn = document.getElementById("clear_date_btn");
      if (clearBtn) clearBtn.style.display = this.value ? "block" : "none";
    });
  }

  const proximityInput = document.getElementById("search_qr");

  function autoFocusProximity() {
    const modalOpen =
      document.getElementById("employeeModal")?.style.display === "block" ||
      document.getElementById("deleteModal")?.style.display === "flex" ||
      document.getElementById("importModal")?.style.display === "block";

    if (modalOpen) return;

    const anySuggestionOpen = [
      "search-remarks-suggestions",
      "search-status-suggestions",
    ].some((id) => document.getElementById(id)?.style.display === "block");

    if (anySuggestionOpen) return;

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

  setupFieldSuggestions(
    "search_remarks",
    "search-remarks-suggestions",
    () => {
      const map = qrImageMapCache || {};
      return employees.map((e) => {
        const isOccupied = Object.prototype.hasOwnProperty.call(
          map,
          String(e.qr_code).trim().toLowerCase(),
        );
        return isOccupied ? "Occupied" : "Available";
      });
    },
    {
      hiddenId: "search_remarks_val",
      noneLabel: "No Remarks",
      onSelect: () => searchEmployees(),
    },
  );

  setupFieldSuggestions(
    "search_status",
    "search-status-suggestions",
    () => employees.map((e) => (e.is_active == 1 ? "Enabled" : "Disabled")),
    {
      hiddenId: "search_status_val",
      noneLabel: "No Status",
      onSelect: () => searchEmployees(),
    },
  );
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

  return filters;
}

function hasActiveFilters() {
  const filters = getActiveFilters();
  return Object.keys(filters).length > 0;
}

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

async function syncOrphanStatuses() {
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
      await updateTotalAvailable();
    }
  } catch (error) {
    console.warn("[proxcode] syncOrphanStatuses failed:", error);
  }
}

async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `${ProxcodeBackend}?action=get_single&id=${employeeId}`,
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

async function renderEmployeeError(message = "Failed to load employee data.") {
  const tbody = document.getElementById("employeeTableBody");
  const pagination = document.getElementById("pagination");
  const noData = document.getElementById("no-data");

  if (!tbody) return;

  if (!employees || employees.length === 0) {
    tbody.innerHTML = "";
    if (pagination) pagination.style.display = "none";
    if (noData) noData.style.display = "block";
    return;
  }

  if (noData) noData.style.display = "none";

  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align:center;padding:20px;color:#c0392b;">
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

  totalPages = Math.ceil(employees.length / itemsPerPage);
  if (currentPage > totalPages && totalPages > 0) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentEmployees = employees.slice(startIndex, endIndex);

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
      const safeEmpId = matchedEmployeeData ? String(matchedEmployeeData.id) : "";
      const qrLower = employee.qr_code.trim().toLowerCase();
      const isOccupied = Object.prototype.hasOwnProperty.call(
        qrImageMap,
        qrLower,
      );

      const displayRemarks = isOccupied ? "Occupied" : "Available";

      if (matchedEmployeeData && matchedEmployeeData.image) {
        imageUrl = `${window.location.origin}/../public/uploads/user/${matchedEmployeeData.image}`;
        displayName = matchedEmployeeData.fullname || employee.qr_code;
        tooltipText = `${toProperCase(matchedEmployeeData.fullname)}\n${toProperCase(matchedEmployeeData.position)}\n${toProperCase(matchedEmployeeData.brand)}`;
      } else if (employee.image) {
        imageUrl = `${window.location.origin}/../public/uploads/user/${employee.image}`;
        tooltipText = `${toProperCase(employee.fullname)}\n${toProperCase(employee.position)}\n${toProperCase(employee.brand)}`;
      }

      const displayInitials = (displayName || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const isAboveFold = index < 5;

      return `
        <tr>
          <td class="sn-cell">${startIndex + index + 1}</td>
          <td class="emp-img">
            ${
              imageUrl
                ? `<img src="${imageUrl}" alt="${safeName}" class="employee-image"
                      width="48" height="48"
                      loading="${isAboveFold ? "eager" : "lazy"}"
                      decoding="async"
                      title="${tooltipText}"
                      ${isAboveFold ? 'fetchpriority="high"' : ""}
                      onerror="this.onerror=null;this.style.display='none';this.parentElement.querySelector('.employee-ph-fallback').style.display='flex';">
                    <div class="employee-ph-fallback ph-cont" style="display:none;" title="${tooltipText}">
                      <div class="employee-ph">${escapeHtml(displayInitials)}</div>
                    </div>`
                : `<div class="ph-cont" title="${tooltipText}"><div class="employee-ph">${escapeHtml(displayInitials)}</div></div>`
            }
          </td>
          <td data-qr="${safeQrCode}" class="emp-proximity" onclick="copyQRCodeFromCell(this)" title="Copy Proximity code" style="cursor:pointer;">
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 512 512">
              <path d="M0 0 C1.8671875 1.1328125 1.8671875 1.1328125 3.6875 2.4375 C4.32945312 2.88867188 4.97140625 3.33984375 5.6328125 3.8046875 C12.06627036 8.87576605 16.39227202 15.57014088 20.6875 22.4375 C21.34621094 23.46746094 22.00492187 24.49742187 22.68359375 25.55859375 C51.23747477 74.33574664 50.67378716 139.45530043 36.90576172 192.44628906 C32.19944267 209.92529327 25.88960765 232.01237335 9.6875 242.4375 C2.18206673 245.55178766 -6.35065802 244.93076013 -13.875 241.9375 C-19.14967759 239.24807732 -23.73112419 235.58208816 -28.37744141 231.94384766 C-31.42555165 229.5710442 -34.50536176 227.24019229 -37.58105469 224.90332031 C-40.30508099 222.83314006 -43.02599356 220.75892945 -45.74609375 218.68359375 C-51.09985975 214.5993256 -56.45591129 210.51806505 -61.8125 206.4375 C-63.56251122 205.10418139 -65.3125112 203.77084803 -67.0625 202.4375 C-67.92875 201.7775 -68.795 201.1175 -69.6875 200.4375 C-72.3125 198.4375 -74.9375 196.4375 -77.5625 194.4375 C-78.42907227 193.7772583 -79.29564453 193.1170166 -80.18847656 192.43676758 C-81.9352363 191.10589527 -83.68198114 189.7750034 -85.42871094 188.4440918 C-89.85316371 185.07294264 -94.27788987 181.70215338 -98.703125 178.33203125 C-106.74477361 172.20728725 -114.78445594 166.08006898 -122.8125 159.9375 C-124.89869859 158.34220087 -126.98498216 156.74701295 -129.07128906 155.15185547 C-130.64134924 153.95087915 -132.21097407 152.74933357 -133.78027344 151.54736328 C-139.06420007 147.50114011 -144.35941498 143.47036492 -149.66503906 139.45263672 C-152.30619108 137.44230209 -154.93073125 135.41161082 -157.5546875 133.37890625 C-159.22341526 132.10605854 -160.89266422 130.83389376 -162.5625 129.5625 C-163.31192871 128.973479 -164.06135742 128.38445801 -164.83349609 127.77758789 C-169.81057833 124.0261219 -174.12716029 122.26475737 -180.3125 121.4375 C-183.02071018 131.93181446 -180.27502005 142.64420844 -178.4375 153.0625 C-169.81571431 202.54806425 -169.81571431 202.54806425 -179.3125 216.4375 C-183.81158383 221.30840894 -188.4569437 223.48711211 -195 223.875 C-202.53024915 223.69570835 -208.61065492 220.30643654 -214.0625 215.25 C-235.32229346 192.09379304 -236.87144312 154.02810893 -236.64868164 124.47436523 C-236.62489127 121.10962175 -236.62817992 117.74566707 -236.63476562 114.38085938 C-236.61485561 98.21599681 -235.96840475 82.30978699 -232 66.5625 C-231.7827124 65.68174805 -231.5654248 64.80099609 -231.34155273 63.89355469 C-228.32415574 52.08493076 -224.01327523 38.4774837 -213.3125 31.4375 C-207.94979312 28.26702055 -202.32020821 28.27153031 -196.3125 29.4375 C-192.09096398 31.83748382 -188.60139581 34.76885808 -184.98046875 37.98339844 C-182.20688021 40.40135706 -179.28405319 42.62373022 -176.375 44.875 C-175.19827495 45.79958133 -174.02249634 46.72536844 -172.84765625 47.65234375 C-169.33864683 50.41751679 -165.82593816 53.17795747 -162.3125 55.9375 C-158.85820963 58.65086594 -155.40433949 61.36475356 -151.953125 64.08203125 C-145.42264114 69.22176392 -138.87500641 74.33870342 -132.3125 79.4375 C-125.18920722 84.97200443 -118.08553308 90.5305816 -110.99804688 96.11083984 C-108.10441177 98.38836203 -105.20833448 100.66277541 -102.3125 102.9375 C-98.85822649 105.65088743 -95.40433952 108.36475354 -91.953125 111.08203125 C-85.42264114 116.22176392 -78.87500641 121.33870342 -72.3125 126.4375 C-66.88571801 130.65388559 -61.46481919 134.87730466 -56.0625 139.125 C-55.50264404 139.56497314 -54.94278809 140.00494629 -54.3659668 140.45825195 C-51.48061532 142.72725785 -48.59952425 145.00149711 -45.72265625 147.28125 C-40.27313516 151.59474817 -34.80485176 155.88519191 -29.25 160.0625 C-28.41339844 160.69414062 -27.57679688 161.32578125 -26.71484375 161.9765625 C-24.19631168 163.50815761 -22.21601235 164.0545055 -19.3125 164.4375 C-9.10480357 144.85115863 -9.46577344 119.72535392 -13.3125 98.4375 C-13.44188965 97.72094238 -13.5712793 97.00438477 -13.70458984 96.26611328 C-16.41204935 82.09248627 -21.16605208 68.59405778 -26.03466797 55.04760742 C-36.42156063 25.92954697 -36.42156063 25.92954697 -31.3125 11.4375 C-28.62882779 5.94656542 -25.48071594 1.42886825 -19.71484375 -0.97265625 C-13.28256384 -2.551964 -6.11637655 -2.78675144 0 0 Z " transform="translate(236.3125,130.5625)"/>
              <path d="M0 0 C7.26898446 5.49051451 11.12104728 13.12410054 14.86499023 21.22119141 C15.38407959 22.3255957 15.90316895 23.43 16.43798828 24.56787109 C20.45869356 33.24832584 24.00310046 42.01248934 27.07055664 51.07080078 C27.89188276 53.48783179 28.74235191 55.89333608 29.59545898 58.29931641 C40.66219268 89.95873469 47.45564462 123.20833432 51.86499023 156.40869141 C52.01597168 157.46862305 52.16695313 158.52855469 52.32250977 159.62060547 C57.62579224 197.87060185 57.53667483 239.22115111 51.86499023 277.40869141 C51.75328491 278.17000366 51.64157959 278.93131592 51.52648926 279.71569824 C44.84488014 324.89943161 34.52877403 370.10531454 15.23999023 411.72119141 C14.71791992 412.85935303 14.71791992 412.85935303 14.18530273 414.02050781 C10.73888282 421.22680468 6.8187842 427.9459778 -0.38500977 431.84619141 C-1.23579102 432.31927734 -2.08657227 432.79236328 -2.96313477 433.27978516 C-9.56903839 436.7134293 -17.95627341 436.58533559 -25.10375977 434.57275391 C-34.22746272 430.37697693 -39.07560744 423.70052165 -42.60375977 414.51025391 C-44.26729381 404.79815073 -40.52962578 396.01127593 -37.19750977 387.03369141 C-36.69985116 385.66426811 -36.20345328 384.29438606 -35.70825195 382.92407227 C-34.44084721 379.42358825 -33.16170697 375.92754294 -31.87823486 372.43292236 C-4.95643159 299.10931181 6.14218564 223.84268686 -7.13500977 146.40869141 C-7.33046387 145.26513184 -7.52591797 144.12157227 -7.72729492 142.94335938 C-12.97285106 113.28242678 -22.1294479 84.52830799 -32.95629883 56.46923828 C-34.90837902 51.40062245 -36.81137668 46.3146536 -38.69750977 41.22119141 C-39.03226318 40.34213135 -39.3670166 39.46307129 -39.71191406 38.55737305 C-42.8745721 30.01394836 -44.20515601 22.22660004 -41.13500977 13.40869141 C-37.00136999 6.07564003 -30.98784591 0.31936144 -22.82641602 -2.08349609 C-15.41735805 -3.48143156 -6.60210421 -4.24441332 0 0 Z " transform="translate(457.135009765625,39.59130859375)"/>
              <path d="M0 0 C7.7953733 6.55087912 11.53280265 15.42090184 15.76171875 24.48046875 C16.21248779 25.42623779 16.21248779 25.42623779 16.67236328 26.39111328 C32.79347085 60.37055554 41.01469222 99.12019718 43.76171875 136.48046875 C43.84784424 137.63232666 43.93396973 138.78418457 44.02270508 139.97094727 C44.70961576 149.9186128 44.96372734 159.82288009 44.94921875 169.79296875 C44.9486145 170.57115967 44.94801025 171.34935059 44.9473877 172.15112305 C44.86205494 213.03175637 39.27908005 253.78261823 25.76171875 292.48046875 C25.54225586 293.12983398 25.32279297 293.77919922 25.09667969 294.44824219 C22.06669035 303.37564745 18.30612776 311.93862076 14.32421875 320.48046875 C13.66063354 321.93211426 13.66063354 321.93211426 12.98364258 323.41308594 C8.16614773 333.51922856 2.51180624 340.64351445 -8.23828125 344.48046875 C-15.51757393 346.36861293 -22.88142079 345.56051826 -29.66015625 342.32421875 C-36.6807156 338.08361243 -40.72768524 332.46294914 -43.61328125 324.85546875 C-44.82485584 318.31296596 -44.11503764 313.00984918 -41.92578125 306.79296875 C-41.66651855 306.03169678 -41.40725586 305.2704248 -41.14013672 304.48608398 C-39.03740869 298.44503522 -36.674312 292.51824245 -34.28662109 286.58520508 C-25.49835099 264.71401966 -18.71381467 242.82167184 -15.23828125 219.48046875 C-15.12790527 218.75907715 -15.0175293 218.03768555 -14.90380859 217.29443359 C-12.61763113 202.16245899 -11.99860109 187.1316376 -11.98828125 171.85546875 C-11.98760651 170.9523999 -11.98693176 170.04933105 -11.98623657 169.11889648 C-12.004413 153.72566925 -12.76618222 138.70236989 -15.23828125 123.48046875 C-15.40457031 122.45179688 -15.57085937 121.423125 -15.7421875 120.36328125 C-20.15914921 94.12325688 -28.74989237 69.44819755 -38.22216797 44.68334961 C-38.54515366 43.83860077 -38.86813934 42.99385193 -39.20091248 42.12350464 C-39.81211422 40.52893154 -40.42580218 38.93530844 -41.04237366 37.34280396 C-44.73911997 27.728458 -45.20499335 20.16167797 -41.23828125 10.48046875 C-37.39094926 2.85330181 -31.0596262 -0.57634285 -23.23828125 -3.51953125 C-15.04641976 -5.32005608 -6.94554092 -5.02952963 0 0 Z " transform="translate(358.23828125,85.51953125)"/>
            </svg>
          </td>
          <td class="emp-remark">
            <div>${displayRemarks.toLowerCase() == "occupied" ? `<small class="remarks-occupied">Occupied</small>` : `<span class="remarks-available">Available</span>`}</div>
            ${safeEmpId ? `<div class="emp-id"><strong>EMPID: ${escapeHtml(safeEmpId)}</strong></div>` : ""}
          </td>
          <td>
            <span class="status-${employee.is_active == 1 ? "enabled" : "disabled"}">
              ${escapeHtml(employee.is_active == 1 ? "Enabled" : "Disabled")}
            </span>
          </td>
          <td><small>${escapeHtml(employee.created_at || "")}</small></td>
          <td class="emp-updatedAt"><small>${escapeHtml(employee.updated_at || "")}</small></td>

          ${
            window.PERMISSIONS.edit || window.PERMISSIONS.delete
              ? `
          <td style="position: relative; width: 160px; overflow: visible;">

            <!-- ACTIONS TOGGLE -->
            <button
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
                data-emp-id="${escapeHtml(String(employee.id))}"
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
                data-emp-id="${escapeHtml(String(employee.id))}"
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
  await updateTotalAvailable();
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

function copyQRCodeFromCell(td) {
  copyQRCode(td.dataset.qr);
}

function copyQRCode(code) {
  const tempTextArea = document.createElement("textarea");
  tempTextArea.value = code;
  tempTextArea.style.cssText = "position:fixed;opacity:0;";
  document.body.appendChild(tempTextArea);

  try {
    tempTextArea.select();
    tempTextArea.setSelectionRange(0, 99999);

    if (document.execCommand("copy")) {
      showAlert("Proximity code copied to clipboard!");
    } else {
      throw new Error("execCommand failed");
    }
  } catch (err) {
    if (navigator.clipboard) {
      navigator.clipboard
        .writeText(code)
        .then(() => showAlert("Proximity code copied to clipboard!"))
        .catch(() => showAlert("Failed to copy Proximity code", "error"));
    } else {
      showAlert("Failed to copy Proximity code", "error");
    }
  } finally {
    document.body.removeChild(tempTextArea);
  }
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
  const range = new Set([1, totalPages]);
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
    buttonsHTML += `<button class="page-num-btn ${currentPage === p ? "active" : ""}" tabindex="-1" onclick="goToPage(${p})">${p}</button>`;
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

function clearDateFilter() {
  const dateInput = document.getElementById("search_date");
  const clearBtn = document.getElementById("clear_date_btn");
  if (dateInput) dateInput.value = "";
  if (clearBtn) clearBtn.style.display = "none";
  searchEmployees();
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

    // ── Build item list ──────────────────────────────────────────
    const items = [];

    items.push({ display: "Default: ALL", raw: "", special: "all" });

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

    const visibleItems = lower ? items.filter((i) => !i.special) : items;

    const hasRealItems = visibleItems.some((i) => !i.special);
    if (!visibleItems.length || (lower && !hasRealItems)) {
      list.style.display = "none";
      idx = -1;
      return;
    }

    list.innerHTML = visibleItems
      .map((item, i) => {
        if (item.special === "divider") {
          return `<li data-raw="" data-display=""
            style="padding:4px 12px;font-size:11px;color:#94a3b8;
                   pointer-events:none;user-select:none;border-bottom:1px solid #f1f5f9;">
            ──────────
          </li>`;
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

        return `<li
          data-raw="${escapeHtml(item.raw ?? "")}"
          data-display="${safeDisplay}"
          data-index="${i}"
          style="padding:8px 12px;cursor:pointer;font-size:13px;
                 border-bottom:1px solid #f1f5f9;
                 display:flex;align-items:center;${specialStyle}">
          ${hl}
        </li>`;
      })
      .join("");

    list.querySelectorAll("li[data-raw]").forEach((li) => {
      if (li.style.pointerEvents === "none") return; // divider
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        selectItem(li.dataset.display, li.dataset.raw);
      });
      li.addEventListener("mouseover", () => {
        list
          .querySelectorAll("li")
          .forEach(
            (l) =>
              (l.style.background =
                l === li ? "#f0f9ff" : l.dataset.raw === undefined ? "" : ""),
          );
        idx = [...list.querySelectorAll("li")].indexOf(li);
      });
    });

    positionList();
    list.style.display = "block";
    idx = -1;
  }

  input.addEventListener("focus", async () => {
    if (options.requireInput && !input.value.trim()) return;
    show(input.value);
    if (options.onFocus) {
      await options.onFocus();
      show(input.value);
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

  input.addEventListener("input", () => {
    show(input.value);
  });

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
  document.removeEventListener("click", input._outsideClickHandler);
  document.addEventListener("click", input._outsideClickHandler);
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
        keyStrong.textContent = key + ":";
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

    const employeeIds = employees.map((emp) => emp.id);
    const currentFilters = getActiveFilters();

    if (employeeIds.length === 0) {
      showAlert("No proximity codes to delete", "warning");
      return;
    }

    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(employeeIds));
    formData.append("filters", JSON.stringify(currentFilters));

    const response = await fetch(`${ProxcodeBackend}`, {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success) {
      const deletedCount = data.deleted_count || employeeIds.length;
      const deletedLabel = deletedCount > 1 ? "code's" : "code";
      showAlert(
        `Successfully deleted ${escapeHtml(String(deletedCount))} ${deletedLabel} matching your filters.`,
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

function updateSelectColor(select) {
  if (!select) return;
  select.style.color = select.selectedIndex === 0 ? "#999" : "#000";
  [...select.options].forEach((opt) => {
    opt.style.color = "#000";
  });
}

function updateColor() {
  updateSelectColor(document.getElementById("search_remarks"));
  updateSelectColor(document.getElementById("search_status"));
}

async function populateFilter(employeeList) {
  const remarks = document.getElementById("search_remarks");
  const statusSelect = document.getElementById("search_status");
  if (!remarks && !statusSelect) return;

  const qrImageMap = await buildQRToImageMap();

  const remarksSet = new Set();
  const statusSet = new Set();

  for (const emp of employeeList) {
    const isOccupied = Object.prototype.hasOwnProperty.call(
      qrImageMap,
      String(emp.qr_code).trim().toLowerCase(),
    );
    remarksSet.add(isOccupied ? "Occupied" : "Available");
    statusSet.add(emp.is_active == 1 ? "Enabled" : "Disabled");
  }

  function buildSelect(select, placeholder, noneLabel, values) {
    if (!select) return;
    const current = select.value;
    select.innerHTML =
      `<option value="" disabled selected hidden>${placeholder}</option>` +
      `<option value="">Default: ALL</option>` +
      `<option value="__none__">${noneLabel}</option>`;

    if (values.size > 0) {
      select.innerHTML += "<option disabled>──────────</option>";
      [...values].sort().forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      });
    }

    if (current && [...select.options].some((o) => o.value === current)) {
      select.value = current;
    }
  }

  buildSelect(remarks, "Remarks", "No Remarks", remarksSet);
  buildSelect(statusSelect, "Status", "No Status", statusSet);
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

    const {
      remarks: remarksFilter,
      status: statusFilter,
      ...backendFilters
    } = filters;

    const params = new URLSearchParams({ action: "get", ...backendFilters });

    if (statusFilter) {
      if (statusFilter === "Enabled") params.set("is_active", "1");
      else if (statusFilter === "Disabled") params.set("is_active", "0");
    }

    const response = await fetch(`${ProxcodeBackend}?${params.toString()}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

    const data = await response.json();

    if (data.success && Array.isArray(data.data)) {
      employees = data.data;

      populateFilter(employees);

      if (remarksFilter) {
        const qrImageMap = await buildQRToImageMap();
        employees = employees.filter((emp) => {
          const isOccupied = Object.prototype.hasOwnProperty.call(
            qrImageMap,
            String(emp.qr_code).trim().toLowerCase(),
          );
          const displayRemarks = isOccupied ? "Occupied" : "Available";
          return displayRemarks.toLowerCase() === remarksFilter.toLowerCase();
        });
      }

      if (statusFilter) {
        const wantEnabled = statusFilter.toLowerCase() === "enabled";
        employees = employees.filter((emp) =>
          wantEnabled ? emp.is_active == 1 : emp.is_active == 0,
        );
      }

      if (!preservePage && Object.keys(filters).length === 0) {
        currentPage = 1;
      }

      await renderEmployeeTable();
      await updateTotalEmployees();
      await syncOrphanStatuses();

      if (Object.keys(filters).length > 0) displayFilterStatus();
    } else {
      await renderEmployeeError("Network error. Please try again.");
      showAlert(data.message || "Error loading proximity codes", "error");
    }
  } catch (error) {
    console.error("Error loading employees:", error);
    await renderEmployeeError("Network error. Please try again.");
    showAlert(
      "Failed to load proximity codes. Please check your connection.",
      "error",
    );
  } finally {
    if (!silent) showLoading(false);
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
      await updateTotalEmployees();
      await updateTotalAvailable();
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
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
    ];

    if (file.size > maxSize) {
      showAlert("File size must be less than 5MB", "error");
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    if (!allowedTypes.includes(file.type)) {
      showAlert("Only image files are allowed", "error");
      e.target.value = "";
      label.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
      return;
    }

    label.innerHTML = `<i class="fas fa-image"></i> ${escapeHtml(file.name)}`;
  });
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
      await updateTotalEmployees();
      await syncOrphanStatuses();
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

window.onclick = function (event) {
  const modal = document.getElementById("employeeModal");
  if (event.target === modal) {
    closeModal();
  }
};
