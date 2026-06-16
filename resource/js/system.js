// resource/js/system.js --> system table

let EmployeesBackend = null;
let ProxcodeBackend = null;
let GlobalAudioBackend = null;

let currentAction = "add";
let employees = [];

let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;
let totalRecords = 0;

let currentAudio = null;

let activeFilters = {};
let allEmployeesUnfiltered = [];

const count = employees.length;
const label = count > 1 ? "employee's" : "employee";

// ── Global-audio endpoint ─────────────────────────────────────────
const AUDIO_TYPE_MAP = {
  success: "successSound",
  checkout: "checkoutSound",
  not_found: "noResultSound",
  violations: "warningSound",
  inactive: "inactiveSound",
};

// ── Controls CSS helper ───────────────────────────────────────────
const controls = document.querySelector('.controls');
const sentinel = document.createElement('div');
sentinel.style.cssText = 'position:absolute;top:0;height:1px;pointer-events:none';
controls.before(sentinel);

new IntersectionObserver(([e]) => {
  controls.classList.toggle('is-stuck', !e.isIntersecting);
}).observe(sentinel);

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
    document.getElementById("importModal")?.style.display === "block" ||
    document.getElementById("logsModal")?.style.display === "block" ||
    document.getElementById("violationsModal")?.style.display === "block";
  return !anyModalOpen;
}

function isAnySuggestionOpen() {
  return [...document.querySelectorAll("ul[data-suggestion-list]")].some(
    (el) => el.style.display === "block",
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

// ─────────────────────────────────────────────────────────────────
//  Load global audio from DB; fall back to bundled files if absent
// ─────────────────────────────────────────────────────────────────
async function loadGlobalAudio() {
  try {
    const res = await fetch(`${GlobalAudioBackend}`, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();

    if (!json.success) throw new Error("Server returned success:false");

    Object.entries(AUDIO_TYPE_MAP).forEach(([audioType, elementId]) => {
      const el = document.getElementById(elementId);
      if (!el) return;

      const entry = json.audio?.[audioType];

      if (entry?.data && entry.data.length > 0) {
        el.src = entry.data;
        el.preload = "auto";
      } else {
        const fallback = el.dataset.fallback;
        if (fallback) {
          el.src = fallback;
          el.preload = "auto";
        }
      }
    });
  } catch (e) {
    console.warn("Could not load global audio; using bundled fallbacks.", e);

    Object.values(AUDIO_TYPE_MAP).forEach((elementId) => {
      const el = document.getElementById(elementId);
      if (el && !el.src && el.dataset.fallback) {
        el.src = el.dataset.fallback;
        el.preload = "auto";
      }
    });
  }
}

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

  const proximityInput = document.getElementById("search_qr");

  function autoFocusProximity() {
    const modalOpen =
      document.getElementById("employeeModal")?.style.display === "block" ||
      document.getElementById("deleteModal")?.style.display === "flex" ||
      document.getElementById("importModal")?.style.display === "block" ||
      document.getElementById("logsModal")?.style.display === "block" ||
      document.getElementById("violationsModal")?.style.display === "block";

    if (modalOpen) return;

    if (isAnySuggestionOpen()) return;

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
    "search_fullname",
    "fullname-suggestions",
    () =>
      [...allEmployees]
        .sort((a, b) => {
          const lastName = (name) => {
            const parts = (name || "").trim().split(/\s+/);
            return parts[parts.length - 1].toLowerCase();
          };
          return lastName(a.fullname).localeCompare(lastName(b.fullname));
        })
        .map((e) => e.fullname),
    {
      requireInput: false,
      onSelect: () => searchEmployees(),
    },
  );

  setupModalSuggestions();
}

// ─────────────────────────────────────────────────────────────────
// MODAL-ONLY AUTOCOMPLETE
// ─────────────────────────────────────────────────────────────────
const _modalSuggestionTeardowns = [];

function setupModalSuggestions() {
  _teardownModalSuggestions();

  // ── helper ────────────────────────────────────────────────────
  function attachModalSuggestion(inputId, listId, getValues, opts = {}) {
    const input = document.getElementById(inputId);
    if (!input) return;

    document.getElementById(listId)?.remove();

    const list = document.createElement("ul");
    list.id = listId;
    list.dataset.modalSuggestion = "1";
    list.dataset.ownerModalInput = inputId;
    list.style.cssText = `
      display:none;position:fixed;z-index:99999;
      background:#fff;border:1px solid #cbd5e1;
      border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);
      list-style:none;margin:0;padding:0;
      max-height:260px;overflow:hidden;overflow-y:auto;min-width:160px;
    `;
    document.body.appendChild(list);

    let idx = -1;

    // ── only show while employeeModal is open ──────────────────────────────────
    function isModalOpen() {
      const m = document.getElementById("employeeModal");
      return m && (m.style.display === "block" || m.style.display === "flex");
    }

    function positionList() {
      const rect = input.getBoundingClientRect();
      list.style.top = rect.bottom + 4 + "px";
      list.style.left = rect.left + "px";
      list.style.width = Math.max(rect.width, 200) + "px";
    }

    function selectItem(value) {
      input.value = opts.raw ? value : toProperCase(value);
      list.style.display = "none";
      idx = -1;
      if (opts.onSelect) opts.onSelect(value);
    }

    function show(q) {
      if (!isModalOpen()) {
        list.style.display = "none";
        idx = -1;
        return;
      }

      const lower = opts.alwaysShowAll ? "" : q.trim().toLowerCase();

      if (opts.requireInput && !lower) {
        list.style.display = "none";
        idx = -1;
        return;
      }

      const raw = getValues();
      const seen = new Map();

      raw
        .map((v) => (v || "").trim())
        .filter((v) => v)
        .filter((v) => !lower || v.toLowerCase().includes(lower))
        .forEach((v) => {
          const key = v.toLowerCase();
          if (!seen.has(key)) seen.set(key, v);
        });

      const items = [...seen.values()];

      if (!items.length) {
        list.style.display = "none";
        idx = -1;
        return;
      }

      list.innerHTML = items
        .map((v, i) => {
          const display = opts.raw ? v : toProperCase(v);
          const safeDisplay = escapeHtml(display);

          let hl = safeDisplay;
          if (lower) {
            const regex = new RegExp(
              `(${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
              "gi",
            );
            hl = safeDisplay.replace(
              regex,
              '<mark style="background:#fef08a;border-radius:2px;">$1</mark>',
            );
          }

          const iconHtml = opts.icon
            ? `<img src="${escapeHtml(opts.icon)}" style="width:14px;height:14px;margin-right:6px;vertical-align:middle;">`
            : "";
          const badgeHtml = opts.badge
            ? `<span style="margin-left:6px;font-size:10px;padding:1px 6px;border-radius:10px;
                background:#d1fae5;color:#065f46;font-weight:600;">${escapeHtml(opts.badge)}</span>`
            : "";

          return `<li
            data-value="${escapeHtml(v)}"
            data-index="${i}"
            style="padding:8px 12px;cursor:pointer;font-size:13px;
                   border-bottom:1px solid #f1f5f9;
                   display:flex;align-items:center;">
            ${iconHtml}${hl}${badgeHtml}
          </li>`;
        })
        .join("");

      list.querySelectorAll("li[data-value]").forEach((li) => {
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectItem(li.dataset.value);
        });
        li.addEventListener("mouseover", () => {
          list.querySelectorAll("li").forEach((l) => (l.style.background = ""));
          li.style.background = "#f0f9ff";
          idx = [...list.querySelectorAll("li")].indexOf(li);
        });
      });

      positionList();
      list.style.display = "block";
      idx = -1;
    }

    // ── event handlers ───────────────────────────────────────────
    const onFocus = async () => {
      if (opts.requireInput && !input.value.trim()) return;
      setTimeout(() => show(input.value), 0);
      if (opts.onFocus) {
        await opts.onFocus();
        show(input.value);
      }
    };

    const onBlur = () => {
      setTimeout(() => {
        if (!list.contains(document.activeElement)) {
          list.style.display = "none";
          idx = -1;
        }
      }, 150);
    };

    const onInput = () => show(input.value);

    const onKeydown = (e) => {
      const liItems = [...list.querySelectorAll("li[data-value]")];
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
        selectItem(liItems[idx].dataset.value);
      } else if (e.key === "Escape") {
        list.style.display = "none";
        idx = -1;
      }
    };

    const onScroll = () => {
      if (list.style.display !== "none") positionList();
    };

    const onResize = () => {
      if (list.style.display !== "none") positionList();
    };

    const outsideClick = (e) => {
      if (!input.contains(e.target) && !list.contains(e.target)) {
        list.style.display = "none";
        idx = -1;
      }
    };

    const onClick = () => {
      setTimeout(() => show(input.value), 0);
    };

    input.addEventListener("focus", onFocus);
    input.addEventListener("click", onClick);
    input.addEventListener("blur", onBlur);
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKeydown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    document.addEventListener("click", outsideClick);

    _modalSuggestionTeardowns.push(() => {
      input.removeEventListener("focus", onFocus);
      input.removeEventListener("click", onClick);
      input.removeEventListener("blur", onBlur);
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeydown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("click", outsideClick);
      list.remove();
    });
  }

  // ── EMPID — numeric desc, raw values ──────────────────────────
  attachModalSuggestion(
    "employee_id",
    "modal-empid-suggestions",
    () =>
      [...allEmployeesUnfiltered]
        .sort((a, b) => Number(b.id) - Number(a.id))
        .map((e) => String(e.id)),
    { raw: true, requireInput: true },
  );

  // FULLNAME — sorted by last name, proper-cased ─────────────────
  attachModalSuggestion(
    "fullname",
    "modal-fullname-suggestions",
    () =>
      [...allEmployeesUnfiltered]
        .sort((a, b) => {
          const lastName = (name) => {
            const parts = (name || "").trim().split(/\s+/);
            return parts[parts.length - 1].toLowerCase();
          };
          return lastName(a.fullname).localeCompare(lastName(b.fullname));
        })
        .map((e) => e.fullname),
    { requireInput: true, raw: false },
  );

  // ── POSITION — sorted alphabetically, proper-cased ──────────────
  attachModalSuggestion(
    "position",
    "modal-position-suggestions",
    () =>
      [...allEmployeesUnfiltered]
        .sort((a, b) => (a.position || "").localeCompare(b.position || ""))
        .map((e) => e.position)
        .filter(Boolean),
    { requireInput: false, raw: false },
  );

  // ── BRAND — sorted alphabetically, proper-cased ──────────────────
  attachModalSuggestion(
    "brand",
    "modal-brand-suggestions",
    () =>
      [...allEmployeesUnfiltered]
        .sort((a, b) => (a.brand || "").localeCompare(b.brand || ""))
        .map((e) => e.brand)
        .filter(Boolean),
    { requireInput: false, raw: false },
  );

  // ── SHIFT — set of values, not drawn from employee data ──────────────
  const SHIFT_OPTIONS = ["Day Shift", "Night Shift", "Graveyard Shift"];

  attachModalSuggestion(
    "shift",
    "modal-shift-suggestions",
    () => SHIFT_OPTIONS,
    {
      raw: true,
      requireInput: false,
      alwaysShowAll: true,
      onSelect: (val) => {
        const el = document.getElementById("shift");
        if (el) el.classList.toggle("has-value", !!val);
      },
    },
  );

  // ── QR / PROXIMITY CODE — fetched on focus, shows available codes ────────
  let _availableModalCodes = [];

  attachModalSuggestion(
    "qr_code",
    "modal-qrcode-suggestions",
    () => _availableModalCodes,
    {
      raw: true,
      requireInput: false,
      icon: `/config/asset.php?t=gnks2`,
      badge: "Available",
      onFocus: async () => {
        try {
          const [proxRes, allEmpRes] = await Promise.all([
            fetch(`${ProxcodeBackend}?action=get`, {
              headers: { "X-Requested-With": "XMLHttpRequest" },
            }),
            fetch(`${EmployeesBackend}?action=get&page=1&limit=1`, {
              headers: {
                "X-Requested-With": "XMLHttpRequest",
                "X-Silent-Request": "true",
              },
            }),
          ]);

          const proxJson = await proxRes.json();
          const allEmpJson = await allEmpRes.json();

          if (!proxJson.success || !Array.isArray(proxJson.data)) return;

          const currentCode =
            document.getElementById("qr_code")?.value.trim().toLowerCase() ||
            "";

          const empList =
            allEmpJson.success && Array.isArray(allEmpJson.filter_options)
              ? allEmpJson.filter_options
              : employees;

          const assignedSet = new Set(
            empList
              .map((e) => (e.qr_code || "").trim().toLowerCase())
              .filter(Boolean),
          );

          _availableModalCodes = proxJson.data
            .filter((c) => {
              const cLower = (c.qr_code || "").trim().toLowerCase();
              return (
                c.is_active == 1 &&
                (!assignedSet.has(cLower) || cLower === currentCode)
              );
            })
            .map((c) => c.qr_code)
            .sort((a, b) => {
              const numA = Number(a);
              const numB = Number(b);
              const bothNumeric = !isNaN(numA) && !isNaN(numB);
              return bothNumeric
                ? numA - numB
                : String(a).localeCompare(String(b));
            });
        } catch (e) {
          console.warn("Modal QR suggestions: failed to load", e);
        }
      },
    },
  );

  // ── VIOLATION / REMARKS — drawn from existing employee remarks ────────────
  attachModalSuggestion(
    "violation",
    "modal-violation-suggestions",
    () =>
      [...allEmployees].map((e) => (e.violation || "").trim()).filter(Boolean),
    { requireInput: false, raw: false },
  );
}

function _teardownModalSuggestions() {
  while (_modalSuggestionTeardowns.length) {
    _modalSuggestionTeardowns.pop()();
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

  const from = document.getElementById("f_from")?.value || "";
  const to = document.getElementById("f_to")?.value || "";
  if (from) filters["date_from"] = from;
  if (to) filters["date_to"] = to;

  delete filters["created_at"];

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
const playCheckoutSound = () => playSound("checkoutSound");
const playInactiveSound = () => playSound("inactiveSound");
const playNoResultSound = () => playSound("noResultSound");
const playWarningSound = () => playSound("warningSound");

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
      await loadEmployees(
        hasActiveFilters() ? getActiveFilters() : {},
        true,
        true,
      );
      await updateActiveEmployees();
    }
  } catch (error) {
    console.warn("[system] syncOrphanStatuses failed:", error);
  }
}

async function loadEmployeeData(employeeId) {
  try {
    const response = await fetch(
      `${EmployeesBackend}?action=get_single&id=${encodeURIComponent(employeeId)}`,
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

      document.getElementById("user_id").value = employee.user_id;
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
        const imagePath = `${window.location.origin}/../public/uploads/user/${escapeHtml(employee.image)}`;
        const altText = escapeHtml(employee.fullname);

        fileLabel.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <img id="existingImagePreview" src="${imagePath}" alt="${altText}" loading="lazy"
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

async function updateTotalEmployees() {
  const el = document.getElementById("total_employees");
  if (el) el.textContent = totalRecords;
}

async function updateActiveEmployees() {
  try {
    const res = await fetch(`${EmployeesBackend}?action=stats`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success) {
      const el1 = document.getElementById("active_employees");
      const el2 = document.getElementById("inactive_employees");
      if (el1) el1.textContent = data.data.active;
      if (el2) el2.textContent = data.data.inactive;
    }
  } catch (e) {
    console.error("Error updating employee counts", e);
  }
}

async function addToLog(employeeId, checkStatus = "IN", triggerElement = null) {
  if (!["IN", "OUT"].includes(checkStatus)) {
    console.error("Invalid checkStatus value:", checkStatus);
    return;
  }

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
    const hasCheckedOut = checkStatus === "OUT";

    if (hasInactive) {
      playInactiveSound();
      showAlert("Access denied. Employee is inactive.", "error");
      return;
    }

    const logData = {
      user_id: employee.user_id,
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
      access_timestamp: new Date().toLocaleString("sv-SE", {
        timeZone: "Asia/Manila",
      }),
    };

    const response = await fetch("../http/middleware/add_to_log.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logData),
    });

    const result = await response.json();

    if (result.success) {
      if (hasViolations) playWarningSound();
      else if (hasInactive) playInactiveSound();
      else if (hasCheckedOut) playCheckoutSound();
      else playSuccessSound();

      showAlert(
        `Employee marked as ${escapeHtml(checkStatus)} successfully!`,
        "success",
      );
    } else {
      throw new Error(result.message || "Failed to add employee to log");
    }
  } catch (error) {
    console.error("Error adding to log:", error);
    showAlert("Error: " + escapeHtml(error.message), "error");
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

  const currentEmployees = employees;
  const startIndex = (currentPage - 1) * itemsPerPage;

  tbody.innerHTML = currentEmployees
    .map((employee, index) => {
      const safeFullname = escapeHtml(toProperCase(employee.fullname));
      const safePosition = escapeHtml(toProperCase(employee.position));
      const safeBrand = escapeHtml(toProperCase(employee.brand));
      const safeStatus = escapeHtml(employee.status);
      const safeShift = escapeHtml(employee.shift);
      const safeGender = escapeHtml(employee.gender || "—");
      const safeBirth = formatDateDisplay(employee.birth || "—");
      const safeHired = formatDateDisplay(employee.hired || "—");
      const safeViolation = escapeHtml(employee.violation);
      const safeQrCode = escapeHtml(employee.qr_code);
      const safeImage = escapeHtml(employee.image);
      const safeId = escapeHtml(String(employee.id));
      const safeCreatedAt = escapeHtml(employee.created_at);
      const safeUpdatedAt = escapeHtml(employee.updated_at);

      const fullnameInitials = (employee.fullname || "UN")
        .split(" ")
        .map((name) => name.charAt(0))
        .join("")
        .substring(0, 2)
        .toUpperCase();

      const isAboveFold = index < 5;

      const thumbSrc = `${window.location.origin}/../public/uploads/user/thumb_${safeImage}`;
      const imageSrc = `${window.location.origin}/../public/uploads/user/${safeImage}`;

      const numericId = parseInt(employee.id, 10);

      return `
          <tr class="row">
            <td class="sn-cell">${startIndex + index + 1}</td>
            <td>
              <div class="emp-name"><strong>${safeFullname}</strong></div>
              <div class="emp-id"><strong>EMPID: ${safeId}</strong></div>
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
                      data-emp-id="${safeId}"
                      data-fullname="${safeFullname}"
                      data-violation="${safeViolation}"
                      class="remarks-item"
                      tabindex="-1"
                      onclick="openViolationPopupFromBtn(this)"
                      title="${escapeHtml(safeViolation)}">
                      <i class="fas fa-exclamation-triangle" style="font-size:10px;"></i>
                    </button>`
                    : ""
                }
                ${
                  parseInt(employee.violation_count) > 0
                    ? `<button
                      data-emp-id="${safeId}"
                      data-fullname="${safeFullname}"
                      class="seemore-item"
                      tabindex="-1"
                      onclick="openViolationsModalFromBtn(this)"
                      title="View All Remarks">
                      See more. . .
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
                      ${isAboveFold ? 'fetchpriority="high"' : ""}
                      onload="this.classList.add('loaded');this.previousElementSibling.classList.add('hidden');"
                      onerror="if(this.src !== '${imageSrc}'){this.src='${imageSrc}';}else{this.onerror=null;this.closest('.img-skeleton-wrap').innerHTML='<div class=\\'ph-cont\\'><div class=\\'employee-ph\\'>${escapeHtml(fullnameInitials)}</div></div>';}">
                    <div class="employee-ph-fallback ph-cont" style="display:none;">
                      <div class="employee-ph">${escapeHtml(fullnameInitials)}</div>
                    </div>
                  </div>`
                : `<div class="ph-cont"><div class="employee-ph">${escapeHtml(fullnameInitials)}</div></div>`
            }</td>
            <td data-qr="${safeQrCode}" class="emp-proximity" onclick="copyQRCodeFromCell(this)" title="Copy Proximity code" style="cursor:pointer;">
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 512 512">
                <path d="M0 0 C1.8671875 1.1328125 1.8671875 1.1328125 3.6875 2.4375 C4.32945312 2.88867188 4.97140625 3.33984375 5.6328125 3.8046875 C12.06627036 8.87576605 16.39227202 15.57014088 20.6875 22.4375 C21.34621094 23.46746094 22.00492187 24.49742187 22.68359375 25.55859375 C51.23747477 74.33574664 50.67378716 139.45530043 36.90576172 192.44628906 C32.19944267 209.92529327 25.88960765 232.01237335 9.6875 242.4375 C2.18206673 245.55178766 -6.35065802 244.93076013 -13.875 241.9375 C-19.14967759 239.24807732 -23.73112419 235.58208816 -28.37744141 231.94384766 C-31.42555165 229.5710442 -34.50536176 227.24019229 -37.58105469 224.90332031 C-40.30508099 222.83314006 -43.02599356 220.75892945 -45.74609375 218.68359375 C-51.09985975 214.5993256 -56.45591129 210.51806505 -61.8125 206.4375 C-63.56251122 205.10418139 -65.3125112 203.77084803 -67.0625 202.4375 C-67.92875 201.7775 -68.795 201.1175 -69.6875 200.4375 C-72.3125 198.4375 -74.9375 196.4375 -77.5625 194.4375 C-78.42907227 193.7772583 -79.29564453 193.1170166 -80.18847656 192.43676758 C-81.9352363 191.10589527 -83.68198114 189.7750034 -85.42871094 188.4440918 C-89.85316371 185.07294264 -94.27788987 181.70215338 -98.703125 178.33203125 C-106.74477361 172.20728725 -114.78445594 166.08006898 -122.8125 159.9375 C-124.89869859 158.34220087 -126.98498216 156.74701295 -129.07128906 155.15185547 C-130.64134924 153.95087915 -132.21097407 152.74933357 -133.78027344 151.54736328 C-139.06420007 147.50114011 -144.35941498 143.47036492 -149.66503906 139.45263672 C-152.30619108 137.44230209 -154.93073125 135.41161082 -157.5546875 133.37890625 C-159.22341526 132.10605854 -160.89266422 130.83389376 -162.5625 129.5625 C-163.31192871 128.973479 -164.06135742 128.38445801 -164.83349609 127.77758789 C-169.81057833 124.0261219 -174.12716029 122.26475737 -180.3125 121.4375 C-183.02071018 131.93181446 -180.27502005 142.64420844 -178.4375 153.0625 C-169.81571431 202.54806425 -169.81571431 202.54806425 -179.3125 216.4375 C-183.81158383 221.30840894 -188.4569437 223.48711211 -195 223.875 C-202.53024915 223.69570835 -208.61065492 220.30643654 -214.0625 215.25 C-235.32229346 192.09379304 -236.87144312 154.02810893 -236.64868164 124.47436523 C-236.62489127 121.10962175 -236.62817992 117.74566707 -236.63476562 114.38085938 C-236.61485561 98.21599681 -235.96840475 82.30978699 -232 66.5625 C-231.7827124 65.68174805 -231.5654248 64.80099609 -231.34155273 63.89355469 C-228.32415574 52.08493076 -224.01327523 38.4774837 -213.3125 31.4375 C-207.94979312 28.26702055 -202.32020821 28.27153031 -196.3125 29.4375 C-192.09096398 31.83748382 -188.60139581 34.76885808 -184.98046875 37.98339844 C-182.20688021 40.40135706 -179.28405319 42.62373022 -176.375 44.875 C-175.19827495 45.79958133 -174.02249634 46.72536844 -172.84765625 47.65234375 C-169.33864683 50.41751679 -165.82593816 53.17795747 -162.3125 55.9375 C-158.85820963 58.65086594 -155.40433949 61.36475356 -151.953125 64.08203125 C-145.42264114 69.22176392 -138.87500641 74.33870342 -132.3125 79.4375 C-125.18920722 84.97200443 -118.08553308 90.5305816 -110.99804688 96.11083984 C-108.10441177 98.38836203 -105.20833448 100.66277541 -102.3125 102.9375 C-98.85822649 105.65088743 -95.40433952 108.36475354 -91.953125 111.08203125 C-85.42264114 116.22176392 -78.87500641 121.33870342 -72.3125 126.4375 C-66.88571801 130.65388559 -61.46481919 134.87730466 -56.0625 139.125 C-55.50264404 139.56497314 -54.94278809 140.00494629 -54.3659668 140.45825195 C-51.48061532 142.72725785 -48.59952425 145.00149711 -45.72265625 147.28125 C-40.27313516 151.59474817 -34.80485176 155.88519191 -29.25 160.0625 C-28.41339844 160.69414062 -27.57679688 161.32578125 -26.71484375 161.9765625 C-24.19631168 163.50815761 -22.21601235 164.0545055 -19.3125 164.4375 C-9.10480357 144.85115863 -9.46577344 119.72535392 -13.3125 98.4375 C-13.44188965 97.72094238 -13.5712793 97.00438477 -13.70458984 96.26611328 C-16.41204935 82.09248627 -21.16605208 68.59405778 -26.03466797 55.04760742 C-36.42156063 25.92954697 -36.42156063 25.92954697 -31.3125 11.4375 C-28.62882779 5.94656542 -25.48071594 1.42886825 -19.71484375 -0.97265625 C-13.28256384 -2.551964 -6.11637655 -2.78675144 0 0 Z " transform="translate(236.3125,130.5625)"/>
                <path d="M0 0 C7.26898446 5.49051451 11.12104728 13.12410054 14.86499023 21.22119141 C15.38407959 22.3255957 15.90316895 23.43 16.43798828 24.56787109 C20.45869356 33.24832584 24.00310046 42.01248934 27.07055664 51.07080078 C27.89188276 53.48783179 28.74235191 55.89333608 29.59545898 58.29931641 C40.66219268 89.95873469 47.45564462 123.20833432 51.86499023 156.40869141 C52.01597168 157.46862305 52.16695313 158.52855469 52.32250977 159.62060547 C57.62579224 197.87060185 57.53667483 239.22115111 51.86499023 277.40869141 C51.75328491 278.17000366 51.64157959 278.93131592 51.52648926 279.71569824 C44.84488014 324.89943161 34.52877403 370.10531454 15.23999023 411.72119141 C14.71791992 412.85935303 14.71791992 412.85935303 14.18530273 414.02050781 C10.73888282 421.22680468 6.8187842 427.9459778 -0.38500977 431.84619141 C-1.23579102 432.31927734 -2.08657227 432.79236328 -2.96313477 433.27978516 C-9.56903839 436.7134293 -17.95627341 436.58533559 -25.10375977 434.57275391 C-34.22746272 430.37697693 -39.07560744 423.70052165 -42.60375977 414.51025391 C-44.26729381 404.79815073 -40.52962578 396.01127593 -37.19750977 387.03369141 C-36.69985116 385.66426811 -36.20345328 384.29438606 -35.70825195 382.92407227 C-34.44084721 379.42358825 -33.16170697 375.92754294 -31.87823486 372.43292236 C-4.95643159 299.10931181 6.14218564 223.84268686 -7.13500977 146.40869141 C-7.33046387 145.26513184 -7.52591797 144.12157227 -7.72729492 142.94335938 C-12.97285106 113.28242678 -22.1294479 84.52830799 -32.95629883 56.46923828 C-34.90837902 51.40062245 -36.81137668 46.3146536 -38.69750977 41.22119141 C-39.03226318 40.34213135 -39.3670166 39.46307129 -39.71191406 38.55737305 C-42.8745721 30.01394836 -44.20515601 22.22660004 -41.13500977 13.40869141 C-37.00136999 6.07564003 -30.98784591 0.31936144 -22.82641602 -2.08349609 C-15.41735805 -3.48143156 -6.60210421 -4.24441332 0 0 Z " transform="translate(457.135009765625,39.59130859375)"/>
                <path d="M0 0 C7.7953733 6.55087912 11.53280265 15.42090184 15.76171875 24.48046875 C16.21248779 25.42623779 16.21248779 25.42623779 16.67236328 26.39111328 C32.79347085 60.37055554 41.01469222 99.12019718 43.76171875 136.48046875 C43.84784424 137.63232666 43.93396973 138.78418457 44.02270508 139.97094727 C44.70961576 149.9186128 44.96372734 159.82288009 44.94921875 169.79296875 C44.9486145 170.57115967 44.94801025 171.34935059 44.9473877 172.15112305 C44.86205494 213.03175637 39.27908005 253.78261823 25.76171875 292.48046875 C25.54225586 293.12983398 25.32279297 293.77919922 25.09667969 294.44824219 C22.06669035 303.37564745 18.30612776 311.93862076 14.32421875 320.48046875 C13.66063354 321.93211426 13.66063354 321.93211426 12.98364258 323.41308594 C8.16614773 333.51922856 2.51180624 340.64351445 -8.23828125 344.48046875 C-15.51757393 346.36861293 -22.88142079 345.56051826 -29.66015625 342.32421875 C-36.6807156 338.08361243 -40.72768524 332.46294914 -43.61328125 324.85546875 C-44.82485584 318.31296596 -44.11503764 313.00984918 -41.92578125 306.79296875 C-41.66651855 306.03169678 -41.40725586 305.2704248 -41.14013672 304.48608398 C-39.03740869 298.44503522 -36.674312 292.51824245 -34.28662109 286.58520508 C-25.49835099 264.71401966 -18.71381467 242.82167184 -15.23828125 219.48046875 C-15.12790527 218.75907715 -15.0175293 218.03768555 -14.90380859 217.29443359 C-12.61763113 202.16245899 -11.99860109 187.1316376 -11.98828125 171.85546875 C-11.98760651 170.9523999 -11.98693176 170.04933105 -11.98623657 169.11889648 C-12.004413 153.72566925 -12.76618222 138.70236989 -15.23828125 123.48046875 C-15.40457031 122.45179688 -15.57085937 121.423125 -15.7421875 120.36328125 C-20.15914921 94.12325688 -28.74989237 69.44819755 -38.22216797 44.68334961 C-38.54515366 43.83860077 -38.86813934 42.99385193 -39.20091248 42.12350464 C-39.81211422 40.52893154 -40.42580218 38.93530844 -41.04237366 37.34280396 C-44.73911997 27.728458 -45.20499335 20.16167797 -41.23828125 10.48046875 C-37.39094926 2.85330181 -31.0596262 -0.57634285 -23.23828125 -3.51953125 C-15.04641976 -5.32005608 -6.94554092 -5.02952963 0 0 Z " transform="translate(358.23828125,85.51953125)"/>
              </svg>
            </td>
            <td><small>${safeCreatedAt}</small></td>
            <td class="emp-updatedAt"><small>${safeUpdatedAt}</small></td>

            ${
              window.PERMISSIONS.manualInOut ||
              window.PERMISSIONS.logs ||
              window.PERMISSIONS.edit ||
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
                <small style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); text-align: center; color: #fff;">${safeFullname}</small>

                ${
                  window.PERMISSIONS.manualInOut
                    ? `
                <!-- IN / OUT -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #e2e8f0;">
                  <button
                    data-emp-id="${numericId}"
                    data-check-status="IN"
                    class="manual-checkin"
                    tabindex="-1"
                    onclick="addToLogFromBtn(this)"
                    title="Check: IN">
                    <span class="check-dot"></span> IN
                  </button>
                  <button
                    data-emp-id="${numericId}"
                    data-check-status="OUT"
                    class="manual-checkout"
                    tabindex="-1"
                    onclick="addToLogFromBtn(this)"
                    title="Check: OUT">
                    <span class="check-dot"></span> OUT
                  </button>
                </div>
                `
                    : ""
                }

                ${
                  window.PERMISSIONS.logs
                    ? `
                <!-- LOGS -->
                <button
                  data-emp-id="${safeId}"
                  data-fullname="${safeFullname}"
                  class="view-logs"
                  tabindex="-1"
                  onclick="openLogsModalFromBtn(this)">
                  <i class="fas fa-history"></i> LOGS
                </button>
                `
                    : ""
                }

                ${
                  window.PERMISSIONS.edit
                    ? `
                <!-- EDIT -->
                <button
                  data-emp-id="${numericId}"
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

function addToLogFromBtn(btn) {
  const empId = parseInt(btn.dataset.empId, 10);
  const checkStatus = btn.dataset.checkStatus;
  if (!empId || !["IN", "OUT"].includes(checkStatus)) return;
  addToLog(empId, checkStatus, btn);
}

function openLogsModalFromBtn(btn) {
  openLogsModal(btn.dataset.empId, btn.dataset.fullname);
}

function openEditFromBtn(btn) {
  openModal("edit", parseInt(btn.dataset.empId, 10));
}

function openDeleteFromBtn(btn) {
  openDeleteModal(btn.dataset.empId, false);
}

function openViolationsModalFromBtn(btn) {
  openViolationsModal(btn.dataset.empId, btn.dataset.fullname);
}

function openViolationPopupFromBtn(btn) {
  const empId = btn.dataset.empId;
  const employee = employees.find((e) => String(e.id) === String(empId));
  if (!employee) return;
  openViolationPopup(employee.fullname, employee.violation, employee.id);
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
        .then(() => showAlert("Proximity code copied to clipboard!"))
        .catch(() => showAlert("Failed to copy Proximity code"));
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
  if (typeof clearDateRange === "function") {
    clearDateRange();
  }

  [
    ["search_position", "search_position_val"],
    ["search_brand", "search_brand_val"],
    ["search_status", "search_status_val"],
    ["search_shift", "search_shift_val"],
    ["search_violation", "search_violation_val"],
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

// ── Generic field autocomplete (filter bar only) ──────────────────
function setupFieldSuggestions(inputId, listId, getValues, options = {}) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const hidden = options.hiddenId
    ? document.getElementById(options.hiddenId)
    : null;

  const stale = document.getElementById(listId);
  if (stale) stale.remove();

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
      if (li.style.pointerEvents === "none") return;
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

const violation = document.getElementById("violation");

function updateViolationPadding() {
  const hasData = violation.value.trim();
  violation.style.paddingTop = hasData ? "" : "40px";
  violation.style.paddingBottom = "";
}

violation.addEventListener("blur", updateViolationPadding);

violation.addEventListener("input", function () {
  if (violation.value.trim()) {
    violation.style.paddingTop = "";
    violation.style.paddingBottom = "40px";
  }
});

violation.addEventListener("focus", function () {
  violation.style.paddingTop = "";
  violation.style.paddingBottom = "40px";
});

let _lastValue = violation.value;
setInterval(function () {
  if (violation.value !== _lastValue) {
    _lastValue = violation.value;
    if (document.activeElement !== violation) updateViolationPadding();
  }
}, 100);

// ── Open modal ──────────────────────────────────────────────────────
async function openModal(action, employeeId = null) {
  closeAllActionsPanels();
  currentAction = action;
  const modal = document.getElementById("employeeModal");
  const modalTitle = document.getElementById("modalTitle");
  const form = document.getElementById("employeeForm");
  const qrCodeInput = document.getElementById("qr_code");

  if (!modal || !modalTitle || !form) {
    console.error("Modal elements not found");
    return;
  }

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
    updateViolationPadding();
    setupModalSuggestions();
    qrCodeInput.focus();
  } else if (action === "edit" && employeeId) {
    modalTitle.innerHTML = `<i class="fas fa-edit" style="color:#7c3aed"></i> Edit Employee`;
    modal.style.display = "block";
    await loadEmployeeData(employeeId);
    updateViolationPadding();
    setupModalSuggestions();
    const idField = document.getElementById("employee_id");
    if (idField) {
      idField.focus();
      idField.select();
    }
  }
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
      } else {
        params.append(key, value);
      }
    }

    const allRes = await fetch(`${EmployeesBackend}?${params.toString()}`, {
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
      showAlert("No employees to delete", "warning");
      return;
    }

    const employeeIds = allData.data.map((emp) => emp.id);

    const formData = new FormData();
    formData.append("action", "delete_filtered");
    formData.append("employee_ids", JSON.stringify(employeeIds));
    formData.append("filters", JSON.stringify(activeFilters));

    const response = await fetch(`${EmployeesBackend}`, {
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

async function openLogsModal(employeeId, fullname) {
  closeAllActionsPanels();
  const modal = document.getElementById("logsModal");
  const title = document.getElementById("logsModalTitle");

  title.innerHTML = `<i class="fas fa-history"></i> Logs — `;
  const nameSpan = document.createElement("span");
  nameSpan.textContent = fullname;
  title.appendChild(nameSpan);

  _renderLogsModal(modal, employeeId);
  modal.style.display = "block";

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}

function _renderLogsModal(modal, employeeId) {
  const tab = modal.querySelector(".modal-tab");
  const body = modal.querySelector(".modal-body");

  tab.innerHTML = `
    <div style="display:flex;gap:0;border-bottom:1px solid var(--color-border-tertiary);">
      <button id="logsTabAccess" tabindex="-1" onclick="_switchLogsTab('access','${employeeId}')"
        style="padding:8px 20px;font-size:13px;font-weight:600;border:none;border-bottom:2px solid #3b82f6;
               background:none;color:#3b82f6;cursor:pointer;">
        <i class="fas fa-history"></i> Access Log
      </button>
      <button id="logsTabStatus" tabindex="-1" onclick="_switchLogsTab('status','${employeeId}')"
        style="padding:8px 20px;font-size:13px;font-weight:600;border:none;border-bottom:2px solid transparent;
               background:none;color:#94a3b8;cursor:pointer;">
        <i class="fas fa-exchange-alt"></i> Status Log
      </button>
      <button id="logsTabRemarks" tabindex="-1" onclick="_switchLogsTab('remarks','${employeeId}')"
        style="padding:8px 20px;font-size:13px;font-weight:600;border:none;border-bottom:2px solid transparent;
              background:none;color:#94a3b8;cursor:pointer;">
        <i class="fas fa-exclamation-triangle"></i> Remarks Log
      </button>
    </div>
  `;

  body.innerHTML = `<div id="logsTabContent"></div>`;

  _switchLogsTab("access", employeeId);
}

let _logsCache = {};
let _statusHistoryCache = {};
let _remarksCache = {};

async function _switchLogsTab(tab, employeeId) {
  const accessBtn = document.getElementById("logsTabAccess");
  const statusBtn = document.getElementById("logsTabStatus");
  const remarksBtn = document.getElementById("logsTabRemarks");
  const content = document.getElementById("logsTabContent");

  const active =
    "padding:8px 20px;font-size:13px;font-weight:600;border:none;border-bottom:2px solid #3b82f6;background:none;color:#3b82f6;cursor:pointer;";
  const inactive =
    "padding:8px 20px;font-size:13px;font-weight:600;border:none;border-bottom:2px solid transparent;background:none;color:#94a3b8;cursor:pointer;";

  accessBtn.style.cssText = inactive;
  statusBtn.style.cssText = inactive;
  remarksBtn.style.cssText = inactive;

  if (tab === "access") {
    accessBtn.style.cssText = active;
    await _renderAccessTab(content, employeeId);
  } else if (tab === "status") {
    statusBtn.style.cssText = active;
    await _renderStatusTab(content, employeeId);
  } else if (tab === "remarks") {
    remarksBtn.style.cssText = active;
    await _renderRemarksTab(content, employeeId);
  }
}

async function _renderAccessTab(container, employeeId) {
  container.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:16px;">
      <div style="flex:1;background:#ede9fe;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#5b21b6;" id="logCountTotal">—</div>
        <div style="font-size:13px;color:#5b21b6;font-weight:600;">Total Scans</div>
      </div>
      <div style="flex:1;background:#d1fae5;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#065f46;" id="logCountIn">—</div>
        <div style="font-size:13px;color:#065f46;font-weight:600;">Total IN</div>
      </div>
      <div style="flex:1;background:#fee2e2;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#991b1b;" id="logCountOut">—</div>
        <div style="font-size:13px;color:#991b1b;font-weight:600;">Total OUT</div>
      </div>
    </div>
    <div style="max-height:320px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8f9fa;border-bottom:2px solid #e9ecef;">
            <th style="padding:10px 12px;text-align:left;width:50px;">SN</th>
            <th style="padding:10px 12px;text-align:left;">Status</th>
            <th style="padding:10px 12px;text-align:left;">Gate</th>
            <th style="padding:10px 12px;text-align:left;">Timestamp</th>
          </tr>
        </thead>
        <tbody id="logsTableBody">
          <tr><td colspan="4" style="text-align:center;padding:24px;color:#aaa;">Loading…</td></tr>
        </tbody>
      </table>
    </div>`;

  if (!_logsCache[employeeId]) {
    try {
      const res = await fetch(
        `${EmployeesBackend}?action=get_access_logs&id=${encodeURIComponent(employeeId)}`,
        { headers: { "X-Requested-With": "XMLHttpRequest" } },
      );
      const data = await res.json();
      _logsCache[employeeId] = data.success ? data.logs : null;
    } catch (e) {
      _logsCache[employeeId] = null;
    }
  }

  const tbody = document.getElementById("logsTableBody");
  if (!tbody) return;

  const logs = _logsCache[employeeId];
  if (logs === null) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#ef4444;padding:24px;">Error loading logs.</td></tr>`;
    return;
  }

  const inCount = logs.filter((l) => l.check_status === "IN").length;
  const outCount = logs.filter((l) => l.check_status === "OUT").length;

  const elIn = document.getElementById("logCountIn");
  const elOut = document.getElementById("logCountOut");
  const elTotal = document.getElementById("logCountTotal");
  if (elIn) elIn.textContent = inCount;
  if (elOut) elOut.textContent = outCount;
  if (elTotal) elTotal.textContent = logs.length;

  tbody.innerHTML = logs.length
    ? logs
        .map(
          (log, i) => `
            <tr style="border-bottom:1px solid #f0f0f0;">
              <td style="padding:9px 12px;color:#aaa;">${i + 1}</td>
              <td style="padding:9px 12px;">
                <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
                  background:${log.check_status === "IN" ? "#d1fae5" : "#fee2e2"};
                  color:${log.check_status === "IN" ? "#065f46" : "#991b1b"};">
                  ${escapeHtml(log.check_status)}
                </span>
              </td>
              <td style="padding:9px 12px;">${escapeHtml(log.gate_name || log.user_id || "N/A")}</td>
              <td style="padding:9px 12px;color:#aaa;font-size:11px;white-space:nowrap;">${escapeHtml(log.access_timestamp)}</td>
            </tr>`,
            )
        .join("")
    : `<tr><td colspan="4" style="text-align:center;padding:24px;color:#aaa;">No log records found.</td></tr>`;
}

async function _renderStatusTab(container, employeeId) {
  container.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:16px;">
      <div style="flex:1;background:#ede9fe;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#5b21b6;" id="statCountTotal">—</div>
        <div style="font-size:13px;color:#5b21b6;font-weight:600;">Total Changes</div>
      </div>
      <div style="flex:1;background:#d1fae5;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#065f46;" id="statCountActive">—</div>
        <div style="font-size:13px;color:#065f46;font-weight:600;">→ Active</div>
      </div>
      <div style="flex:1;background:#fee2e2;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#991b1b;" id="statCountInactive">—</div>
        <div style="font-size:13px;color:#991b1b;font-weight:600;">→ Inactive</div>
      </div>
    </div>
    <div style="max-height:320px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8f9fa;border-bottom:2px solid #e9ecef;">
            <th style="padding:10px 12px;text-align:left;width:50px;">SN</th>
            <th style="padding:10px 12px;text-align:left;">From</th>
            <th style="padding:10px 12px;text-align:left;">To</th>
            <th style="padding:10px 12px;text-align:left;">Operator</th>
            <th style="padding:10px 12px;text-align:left;">Reason</th>
            <th style="padding:10px 12px;text-align:left;">Date</th>
          </tr>
        </thead>
        <tbody id="statusHistoryBody">
          <tr><td colspan="6" style="text-align:center;padding:24px;color:#aaa;">Loading…</td></tr>
        </tbody>
      </table>
    </div>`;

  if (!_statusHistoryCache[employeeId]) {
    try {
      const res = await fetch(
        `${EmployeesBackend}?action=get_status_history&id=${encodeURIComponent(employeeId)}`,
        { headers: { "X-Requested-With": "XMLHttpRequest" } },
      );
      const data = await res.json();
      _statusHistoryCache[employeeId] = data.success ? data.history : [];
    } catch (e) {
      _statusHistoryCache[employeeId] = null;
    }
  }

  const tbody = document.getElementById("statusHistoryBody");
  if (!tbody) return;

  const rows = _statusHistoryCache[employeeId];
  if (rows === null) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:24px;">Error loading status history.</td></tr>`;
    return;
  }

  const toActive = rows.filter((r) => r.new_status === "Active").length;
  const toInactive = rows.filter((r) => r.new_status === "Inactive").length;
  const elTotal = document.getElementById("statCountTotal");
  const elActive = document.getElementById("statCountActive");
  const elInactive = document.getElementById("statCountInactive");
  if (elTotal) elTotal.textContent = rows.length;
  if (elActive) elActive.textContent = toActive;
  if (elInactive) elInactive.textContent = toInactive;

  const statusPill = (s) => {
    const isActive = s === "Active";
    return `<span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
      background:${isActive ? "#d1fae5" : "#fee2e2"};
      color:${isActive ? "#065f46" : "#991b1b"};">${escapeHtml(s || "—")}</span>`;
  };

  tbody.innerHTML = rows.length
    ? rows
        .map(
          (r, i) => `
        <tr style="border-bottom:1px solid #f0f0f0;">
          <td style="padding:9px 12px;color:#aaa;">${i + 1}</td>
          <td style="padding:9px 12px;">${statusPill(r.old_status)}</td>
          <td style="padding:9px 12px;">${statusPill(r.new_status)}</td>
          <td style="padding:9px 12px;color:#555;">${escapeHtml(r.changed_by || "System")}</td>
          <td style="padding:9px 12px;color:#555;max-width:200px;word-break:break-word;">${escapeHtml(r.change_reason || "—")}</td>
          <td style="padding:9px 12px;color:#aaa;font-size:11px;white-space:nowrap;">${escapeHtml(r.created_at || "—")}</td>
        </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" style="text-align:center;padding:24px;color:#aaa;">No status changes recorded.</td></tr>`;
}

async function _renderRemarksTab(container, employeeId) {
  container.innerHTML = `
    <div style="display:flex;gap:16px;margin-bottom:16px;">
      <div style="flex:1;background:#fff5f5;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#c53030;" id="remCountTotal">—</div>
        <div style="font-size:13px;color:#c53030;font-weight:600;">Total Records</div>
      </div>
      <div style="flex:1;background:#fffbeb;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#b7791f;" id="remCountUpdates">—</div>
        <div style="font-size:13px;color:#b7791f;font-weight:600;">Updates</div>
      </div>
      <div style="flex:1;background:#f0fff4;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#276749;" id="remCountCleared">—</div>
        <div style="font-size:13px;color:#276749;font-weight:600;">Cleared</div>
      </div>
    </div>
    <div style="max-height:320px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8f9fa;border-bottom:2px solid #e9ecef;">
            <th style="padding:10px 12px;text-align:left;width:50px;">SN</th>
            <th style="padding:10px 12px;text-align:left;">Type</th>
            <th style="padding:10px 12px;text-align:left;">Description</th>
            <th style="padding:10px 12px;text-align:left;">Date</th>
            <th style="padding:10px 12px;text-align:left;">Recorded</th>
          </tr>
        </thead>
        <tbody id="remarksHistoryBody">
          <tr><td colspan="5" style="text-align:center;padding:24px;color:#aaa;">Loading…</td></tr>
        </tbody>
      </table>
    </div>`;

  if (!_remarksCache[employeeId]) {
    try {
      const res = await fetch(
        `${EmployeesBackend}?action=get_violations&id=${encodeURIComponent(employeeId)}`,
        { headers: { "X-Requested-With": "XMLHttpRequest" } },
      );
      const data = await res.json();
      _remarksCache[employeeId] = data.success ? data.violations : null;
    } catch (e) {
      _remarksCache[employeeId] = null;
    }
  }

  const tbody = document.getElementById("remarksHistoryBody");
  if (!tbody) return;

  const rows = _remarksCache[employeeId];
  if (rows === null) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:24px;">Error loading remarks history.</td></tr>`;
    return;
  }

  const updates = rows.filter(
    (r) => r.violation_type === "Remarks Updated",
  ).length;
  const cleared = rows.filter(
    (r) => r.violation_type === "Remarks Cleared",
  ).length;

  const elTotal = document.getElementById("remCountTotal");
  const elUpdates = document.getElementById("remCountUpdates");
  const elCleared = document.getElementById("remCountCleared");
  if (elTotal) elTotal.textContent = rows.length;
  if (elUpdates) elUpdates.textContent = updates;
  if (elCleared) elCleared.textContent = cleared;

  const typeBadge = (type) => {
    if (type === "Remarks Cleared") return { bg: "#f0fff4", color: "#276749" };
    if (type === "Remarks Updated") return { bg: "#fffbeb", color: "#b7791f" };
    return { bg: "#fff5f5", color: "#c53030" };
  };

  tbody.innerHTML = rows.length
    ? rows
        .map((v, i) => {
          const { bg, color } = typeBadge(v.violation_type);
          return `
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:9px 12px;color:#aaa;">${i + 1}</td>
            <td style="padding:9px 12px;">
              <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
                background:${escapeHtml(bg)};color:${escapeHtml(color)};">
                ${escapeHtml(v.violation_type || "—")}
              </span>
            </td>
            <td style="padding:9px 12px;color:#555;max-width:220px;word-break:break-word;">
              ${escapeHtml(v.violation_description || "—")}
            </td>
            <td style="padding:9px 12px;white-space:nowrap;">${escapeHtml(v.violation_date || "—")}</td>
            <td style="padding:9px 12px;color:#aaa;font-size:11px;white-space:nowrap;">${escapeHtml(v.created_at || "—")}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="5" style="text-align:center;padding:24px;color:#aaa;">No remarks history found.</td></tr>`;
}

async function openViolationsModal(employeeId, fullname) {
  closeAllActionsPanels();
  const modal = document.getElementById("violationsModal");
  const title = document.getElementById("violationsModalTitle");
  const tbody = document.getElementById("violationsTableBody");

  document.getElementById("vioCountTotal").textContent = "—";
  document.getElementById("vioCountUpdates").textContent = "—";
  document.getElementById("vioCountCleared").textContent = "—";

  title.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#e53e3e;"></i> Violation History — `;
  const nameSpan = document.createElement("span");
  nameSpan.textContent = fullname;
  title.appendChild(nameSpan);

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#aaa;">Loading…</td></tr>`;
  modal.style.display = "block";

  try {
    const res = await fetch(
      `${EmployeesBackend}?action=get_violations&id=${encodeURIComponent(employeeId)}`,
      { headers: { "X-Requested-With": "XMLHttpRequest" } },
    );
    const data = await res.json();

    if (data.success) {
      const rows = data.violations;
      const updates = rows.filter(
        (r) => r.violation_type === "Remarks Updated",
      ).length;
      const cleared = rows.filter(
        (r) => r.violation_type === "Remarks Cleared",
      ).length;

      document.getElementById("vioCountTotal").textContent = rows.length;
      document.getElementById("vioCountUpdates").textContent = updates;
      document.getElementById("vioCountCleared").textContent = cleared;

      const typeBg = (type) => {
        if (type === "Remarks Cleared")
          return { bg: "#f0fff4", color: "#276749" };
        if (type === "Remarks Updated")
          return { bg: "#fffbeb", color: "#b7791f" };
        return { bg: "#fff5f5", color: "#c53030" };
      };

      tbody.innerHTML = rows.length
        ? rows
            .map((v, i) => {
              const { bg, color } = typeBg(v.violation_type);
              return `
              <tr style="border-bottom:1px solid #f0f0f0;">
                <td style="padding:9px 12px;color:#aaa;">${i + 1}</td>
                <td style="padding:9px 12px;">
                  <span style="padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;
                    background:${escapeHtml(bg)};color:${escapeHtml(color)};">
                    ${escapeHtml(v.violation_type || "—")}
                  </span>
                </td>
                <td style="padding:9px 12px;color:#555;max-width:220px;word-break:break-word;">
                  ${escapeHtml(v.violation_description || "—")}
                </td>
                <td style="padding:9px 12px;white-space:nowrap;">${escapeHtml(v.violation_date || "—")}</td>
                <td style="padding:9px 12px;color:#aaa;font-size:11px;white-space:nowrap;">
                  ${escapeHtml(v.created_at || "—")}
                </td>
              </tr>`;
            })
            .join("")
        : `<tr><td colspan="5" style="text-align:center;padding:24px;color:#aaa;">No violation records found.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:24px;">${escapeHtml(data.message || "Failed to load.")}</td></tr>`;
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:24px;">Error loading records.</td></tr>`;
  }

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}

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
      } else {
        params.append(key, value);
      }
    }

    const response = await fetch(`${EmployeesBackend}?${params.toString()}`, {
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

      if (Object.keys(filters).length === 0) {
        allEmployeesUnfiltered = data.filter_options ?? data.data ?? [];
      } else if (allEmployeesUnfiltered.length === 0) {
        fetch(`${EmployeesBackend}?action=get&page=1&limit=99999`, {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-Silent-Request": "true",
          },
        })
          .then((r) => r.json())
          .then((d) => {
            if (d.success && Array.isArray(d.filter_options))
              allEmployeesUnfiltered = d.filter_options;
          })
          .catch(() => {});
      }

      if (!preservePage && Object.keys(filters).length === 0) {
        currentPage = 1;
      }

      await renderEmployeeTable();
      await updateTotalEmployees();
      await updateActiveEmployees();
      await updateDeleteButtonState();
      await syncOrphanStatuses();

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
    // if (!silent) showLoading(false);
    setControlButtonsDisabled(false);
    updateDeleteButtonState();
  }
}

function closeModal() {
  const employeeModal = document.getElementById("employeeModal");
  const deleteModal = document.getElementById("deleteModal");
  const importModal = document.getElementById("importModal");
  const logsModal = document.getElementById("logsModal");
  const violationModal = document.getElementById("violationsModal");
  if (
    !employeeModal ||
    !deleteModal ||
    !importModal ||
    !logsModal ||
    !violationModal
  )
    return;

  employeeModal.style.display = "none";
  deleteModal.style.display = "none";
  importModal.style.display = "none";
  logsModal.style.display = "none";
  violationModal.style.display = "none";

  _teardownModalSuggestions();

  const form = document.getElementById("employeeForm");
  if (form) form.reset();

  const fileLabel = document.querySelector(".file-upload-label");
  const imageInput = document.getElementById("image");

  if (fileLabel)
    fileLabel.innerHTML = `<i class="fas fa-file-image"></i> Click to select image (Max 5MB)`;
  if (imageInput) imageInput.value = "";

  _logsCache = {};
  _statusHistoryCache = {};
  _remarksCache = {};
}

// ── Field error highlight ────────────────────────────────────────────────────
function markFieldError(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.style.borderColor = "#ef4444";
  el.style.boxShadow = "0 0 0 2px rgba(239,68,68,0.2)";
  el.addEventListener(
    "input",
    function clearErr() {
      el.style.borderColor = "";
      el.style.boxShadow = "";
      el.removeEventListener("input", clearErr);
    },
    { once: true },
  );
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

    try {
      const checkRes = await fetch(
        `${EmployeesBackend}?action=get&page=1&limit=1` +
          `&id=${encodeURIComponent(empid)}`,
        {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-Silent-Request": "true",
          },
        },
      );
      const checkData = await checkRes.json();

      if (checkData.success && checkData.total > 0) {
        const conflict = checkData.data.find(
          (e) =>
            String(e.id) === String(empid) &&
            String(e.id) !== String(originalId),
        );
        if (conflict) {
          showAlert(
            `Employee ID "${escapeHtml(empid)}" is already in use.`,
            "error",
          );
          markFieldError("employee_id");
          document.getElementById("employee_id").focus();
          return;
        }
      }
    } catch (e) {
      console.warn("EMPID check failed, falling back to local check:", e);
      if (currentAction === "edit" && empid !== originalId) {
        const idTaken = employees.some(
          (emp) => String(emp.id) === String(empid),
        );
        if (idTaken) {
          showAlert(
            `Employee ID "${escapeHtml(empid)}" is already in use.`,
            "error",
          );
          markFieldError("employee_id");
          document.getElementById("employee_id").focus();
          return;
        }
      }
    }

    try {
      const nameRes = await fetch(
        `${EmployeesBackend}?action=get&page=1&limit=1` +
          `&fullname=${encodeURIComponent(fullname)}`,
        {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
            "X-Silent-Request": "true",
          },
        },
      );
      const nameData = await nameRes.json();

      if (nameData.success && nameData.total > 0) {
        const conflict = nameData.data.find(
          (e) =>
            e.fullname.toLowerCase().trim() === fullname.toLowerCase().trim() &&
            String(e.id) !== String(originalId),
        );
        if (conflict) {
          showAlert(
            `Employee "${escapeHtml(fullname)}" already exists.`,
            "error",
          );
          markFieldError("fullname");
          document.getElementById("fullname").focus();
          return;
        }
      }
    } catch (e) {
      console.warn("Fullname check failed, falling back to local check:", e);
      const isDuplicate = employees.some((emp) => {
        if (
          currentAction === "edit" &&
          originalId &&
          String(emp.id) === String(originalId)
        )
          return false;
        return (
          emp.fullname.toLowerCase().trim() === fullname.toLowerCase().trim()
        );
      });
      if (isDuplicate) {
        showAlert(
          `Employee "${escapeHtml(fullname)}" already exists.`,
          "error",
        );
        markFieldError("fullname");
        document.getElementById("fullname").focus();
        return;
      }
    }

    const qrCode = document.getElementById("qr_code").value.trim();
    if (qrCode) {
      try {
        const qrRes = await fetch(
          `${EmployeesBackend}?action=check_qr&qr_code=${encodeURIComponent(qrCode)}`,
          {
            headers: {
              "X-Requested-With": "XMLHttpRequest",
              "X-Silent-Request": "true",
            },
          },
        );
        const qrData = await qrRes.json();

        if (qrData.success && qrData.exists) {
          if (String(qrData.data?.id) !== String(originalId)) {
            showAlert(
              `Proximity Code "${escapeHtml(qrCode)}" is already assigned to another employee.`,
              "error",
            );
            markFieldError("qr_code");
            document.getElementById("qr_code").focus();
            return;
          }
        }
      } catch (e) {
        console.warn("Proximity code check failed:", e);
      }
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
    formData.set("action", currentAction);
    formData.set("id", empid);

    if (currentAction === "edit") {
      formData.set("original_id", originalId);
    }

    const response = await fetch(`${EmployeesBackend}`, {
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
      await loadEmployees(filtersToUse, preservePage, true);

      await updateTotalEmployees();
      await updateActiveEmployees();
      await syncOrphanStatuses();
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

async function convertImageToWebP(file, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;

      const ctx = canvas.getContext("2d");
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
            resolve(file);
          }
        },
        "image/webp",
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

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

async function deleteEmployee(employeeId) {
  try {
    showLoading(true);

    const formData = new FormData();
    formData.append("action", "delete");
    formData.append("id", employeeId);

    const response = await fetch(`${EmployeesBackend}`, {
      method: "POST",
      body: formData,
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    const data = await response.json();

    if (data.success) {
      showAlert(data.message, "success");
      await loadEmployees(activeFilters, true, true);
      await updateTotalEmployees();
      await updateActiveEmployees();
      await syncOrphanStatuses();
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

    const response = await fetch(`${EmployeesBackend}`, {
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
  const spaced = String(str).replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.replace(/[^\s,\-]+/g, function (txt) {
    return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
  });
}

function formatDateDisplay(dateStr) {
  if (!dateStr || dateStr === "—") return "—";
  const [y, m, d] = String(dateStr).split("-");
  if (!y || !m || !d) return escapeHtml(dateStr);
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (isNaN(date.getTime())) return escapeHtml(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function calcAge(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  let age = today.getFullYear() - y;
  const notYetThisYear =
    today.getMonth() + 1 < m ||
    (today.getMonth() + 1 === m && today.getDate() < d);
  if (notYetThisYear) age--;
  return age >= 0 ? age : null;
}

function calcTenure(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  let years = today.getFullYear() - y;
  let months = today.getMonth() + 1 - m;
  if (today.getDate() < d) months--;
  if (months < 0) {
    years--;
    months += 12;
  }
  if (years < 0) return null;
  if (years === 0 && months === 0) return "< 1 mo";
  if (years === 0) return `${months} mo${months !== 1 ? "s" : ""}`;
  if (months === 0) return `${years} yr${years !== 1 ? "s" : ""}`;
  return `${years} yr${years !== 1 ? "s" : ""} ${months} mo${months !== 1 ? "s" : ""}`;
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
    '.search-btn .btn',
    '.clear-btn .btn',
    '.delete-all-btn .btn-danger',
  ];
  selectors.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.disabled = disabled;
    el.style.opacity = disabled ? '0.4' : '';
    el.style.cursor = disabled ? 'not-allowed' : '';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function () {
  const ready = await resolveEndpoints();
  if (!ready) return;

  loadGlobalAudio();
  loadEmployees();
  updateDeleteButtonState();
  setupEventListeners();
  syncOrphanStatuses();
});
