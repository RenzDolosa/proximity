/*
 * panel.js  (fixed)
 */

/* ═══════════════════════════════════════════════════════════
   1.  TAB CONTROLLER
═══════════════════════════════════════════════════════════ */

const _panelTabsInit = { employees: false, scanned: false, proximity: false };

function switchTab(name) {
  document
    .querySelectorAll(".tab-pane")
    .forEach((p) => p.classList.remove("active"));
  document
    .querySelectorAll(".panel-tab")
    .forEach((t) => t.classList.remove("active"));

  const pane = document.getElementById("pane-" + name);
  const tab  = document.getElementById("tab-" + name);
  if (pane) pane.classList.add("active");
  if (tab)  tab.classList.add("active");

  setTimeout(() => _autoFocusActiveQR(), 100);

  if (!_panelTabsInit[name]) {
    _panelTabsInit[name] = true;
    if (name === "employees") _sys_init();
    if (name === "scanned")   _dtl_init();
    if (name === "proximity") _prx_init();
  }
}

/* ═══════════════════════════════════════════════════════════
   2.  MODULE STATE
═══════════════════════════════════════════════════════════ */

const SYS = {
  currentAction: "add",
  employees: [],
  currentPage: 1,
  itemsPerPage: 25,
  totalPages: 1,
  activeFilters: {},
  currentAudio: null,
};

const DTL = {
  currentAction: "add",
  employees: [],
  employeeDataCache: null,
  autoUpdateInterval: null,
  autoUpdateEnabled: false,
  lastUpdateTimestamp: null,
  userActivityTimer: null,
  isUserActive: false,
  networkErrorCount: 0,
  currentPage: 1,
  itemsPerPage: 25,
  totalPages: 1,
  activeFilters: {},
};

const PRX = {
  currentAction: "add",
  employees: [],
  currentUserId: null,
  employeeDataCache: null,
  currentPage: 1,
  itemsPerPage: 25,
  totalPages: 1,
  activeFilters: {},
  currentAudio: null,
};

/* ═══════════════════════════════════════════════════════════
   3.  SHARED HELPERS
═══════════════════════════════════════════════════════════ */

let _currentAudio = null;

function _stopAudio() {
  if (_currentAudio && !_currentAudio.paused) {
    _currentAudio.pause();
    _currentAudio.currentTime = 0;
  }
  _currentAudio = null;
}
function _playSound(id) {
  _stopAudio();
  const s = document.getElementById(id);
  if (!s) return;
  _currentAudio = s;
  s.currentTime = 0;
  s.play().catch(() => {});
}

function _showAlert(message, type = "info", containerId = null) {
  document.querySelectorAll(".alert").forEach((a) => a.remove());
  const alert = document.createElement("div");
  alert.className = `alert alert-${type}`;
  alert.innerHTML = `<span>${message}</span>
    <button onclick="this.parentElement.remove()" style="float:right;background:none;border:none;font-size:18px;cursor:pointer;margin-left:5px;">
      <i class="fas fa-times"></i></button>`;
  if (containerId) {
    const c = document.getElementById(containerId);
    if (c) {
      c.innerHTML = "";
      c.appendChild(alert);
    } else document.body.insertBefore(alert, document.body.firstChild);
  } else {
    document.body.insertBefore(alert, document.body.firstChild);
  }
  setTimeout(() => { if (alert.parentElement) alert.remove(); }, 5000);
}

function _showLoading(show) {
  document.body.classList.toggle("loading", show);
}

function _escapeHtml(t) {
  return (t || "").replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[m],
  );
}

function _toProperCase(str) {
  return (str || "").replace(
    /[^\s,\-]+/g,
    (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  );
}

/* ═══════════════════════════════════════════════════════════
   3B.  SHARED AUTO-FOCUS — FIX #5
   Detects modals using display:block OR display:flex
   so prx/dtl modals (which use flex) are not missed.
═══════════════════════════════════════════════════════════ */

const _QR_MAP = {
  "pane-employees": "sys-search_qr",
  "pane-scanned":   "dtl-search_qr",
  "pane-proximity": "prx-search_qr",
};

function _autoFocusActiveQR() {
  const a = document.activeElement;
  if (a && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(a.tagName)) return;

  // FIX #5: check for flex modals as well as block modals
  const openModal = document.querySelector(
    '.modal[style*="display: block"], ' +
    '.modal[style*="display:block"], ' +
    '.modal-overlay[style*="display: flex"], ' +
    '.modal-overlay[style*="display:flex"], ' +
    '.camera-modal[style*="display: block"], ' +
    '.camera-modal[style*="display:block"]'
  );
  if (openModal) return;

  const activePane = document.querySelector(".tab-pane.active");
  if (!activePane) return;

  const qrId = _QR_MAP[activePane.id];
  if (!qrId) return;

  const qr = document.getElementById(qrId);
  if (qr && document.activeElement !== qr) qr.focus();
}

/* ═══════════════════════════════════════════════════════════
   4.  FILTER HELPERS
═══════════════════════════════════════════════════════════ */

function _getFilters(formId) {
  const form    = document.getElementById(formId);
  const filters = {};
  if (!form) return filters;
  new FormData(form).forEach((v, k) => {
    if (v && v.trim()) filters[k] = v.trim();
  });
  return filters;
}
function _hasFilters(formId) {
  return Object.keys(_getFilters(formId)).length > 0;
}

function _displayFilterStatus(formId, statusElId, controlsSelector) {
  const filters  = _getFilters(formId);
  const existing = document.getElementById(statusElId);
  if (existing) existing.remove();
  if (!Object.keys(filters).length) return;

  const div   = document.createElement("div");
  div.id      = statusElId;
  div.style.cssText =
    "background:#e3f2fd;border-left:4px solid #2196F3;padding:12px 16px;margin-left:16px;" +
    "border-radius:4px;font-size:14px;color:#1565c0;display:inline-flex;flex-wrap:wrap;" +
    "justify-content:space-between;align-items:center;";
  const label = document.createElement("span");
  label.style.cssText = "display:inline-flex;align-items:center;gap:8px;";
  const icon = document.createElement("i");
  icon.className = "fas fa-filter";
  label.appendChild(icon);
  const text = document.createElement("span");
  text.appendChild(document.createTextNode("Active Filters: "));
  Object.entries(filters).forEach(([k, v], i) => {
    if (i > 0) text.appendChild(document.createTextNode(" | "));
    const strong = document.createElement("strong");
    strong.textContent =
      k.split(/(?=[A-Z])/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ") + ":";
    text.appendChild(strong);
    text.appendChild(document.createTextNode(" " + v));
  });
  label.appendChild(text);
  div.appendChild(label);
  const controls = document.querySelector(controlsSelector);
  if (controls) controls.appendChild(div);
}

function _buildSelect(select, placeholder, noneLabel, values) {
  const cur = select.value;
  select.innerHTML =
    `<option value="" disabled selected hidden>${placeholder}</option>` +
    `<option value="">Default: ALL</option>` +
    `<option value="__none__">${noneLabel}</option>`;
  if (values.size) {
    select.innerHTML += "<option disabled>──────────</option>";
    [...values].sort().forEach((v) => {
      const o = document.createElement("option");
      o.value = o.textContent = v;
      select.appendChild(o);
    });
  }
  if (cur && [...select.options].some((o) => o.value === cur)) select.value = cur;
}

function _updateSelectColor(sel) {
  if (!sel) return;
  sel.style.color = sel.selectedIndex === 0 ? "#999" : "#000";
  [...sel.options].forEach((o) => (o.style.color = "#000"));
}

/* ═══════════════════════════════════════════════════════════
   5.  PAGINATION HELPERS
═══════════════════════════════════════════════════════════ */

function _updatePagination(state, paginationId, prevId, nextId, infoId, label) {
  const div  = document.getElementById(paginationId);
  const prev = document.getElementById(prevId);
  const next = document.getElementById(nextId);
  const info = document.getElementById(infoId);
  if (!div) return;
  if (state.totalPages <= 1) { div.style.display = "none"; return; }
  div.style.display = "flex";
  if (info) info.textContent = `Page ${state.currentPage} of ${state.totalPages} (${state.employees.length} total ${label})`;
  if (prev) prev.disabled = state.currentPage <= 1;
  if (next) next.disabled = state.currentPage >= state.totalPages;
}

/* ═══════════════════════════════════════════════════════════
   6A.  SYSTEM (EMPLOYEES) MODULE
═══════════════════════════════════════════════════════════ */

async function _sys_init() {
  _sys_setupFileUpload();
  document
    .getElementById("sys-employeeForm")
    .addEventListener("submit", sys_handleFormSubmit);
  document
    .querySelectorAll("#sys-searchForm input, #sys-searchForm select")
    .forEach((el) => el.addEventListener("input", _debounce(sys_searchEmployees, 300)));
  _autoFocusActiveQR();
  await sys_loadEmployees();
  _sys_updateDeleteBtn();
}

async function sys_loadEmployees(filters = {}, preservePage = false) {
  try {
    _showLoading(true);
    if (!Object.keys(filters).length && _hasFilters("sys-searchForm"))
      filters = _getFilters("sys-searchForm");
    SYS.activeFilters = filters;
    const params = new URLSearchParams({ action: "get" });
    for (const [k, v] of Object.entries(filters)) {
      if (v === "__none__") params.append(k + "_none", "1");
      else params.append(k, v);
    }
    const res = await fetch(`../cnfg/manpower_backend.php?${params}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      SYS.employees = data.data;
      _sys_populateFilters(SYS.employees);
      if (!preservePage && !Object.keys(filters).length) SYS.currentPage = 1;
      await _sys_renderTable();
      _sys_updateCounts();
      if (Object.keys(filters).length)
        _displayFilterStatus("sys-searchForm", "sys-filter-status", "#pane-employees .controls");
      _updateBadge("badge-employees", SYS.employees.length);
    } else {
      _sys_renderError(data.message || "Error loading employees");
    }
  } catch (e) {
    console.error(e);
    _sys_renderError("Network error. Please try again.");
  } finally {
    _showLoading(false);
  }
}

function _sys_populateFilters(list) {
  const pos = document.getElementById("sys-search_position");
  const brd = document.getElementById("sys-search_brand");
  const vio = document.getElementById("sys-search_violation");
  if (!pos || !brd || !vio) return;
  const ps = new Set(), bs = new Set(), vs = new Set();
  list.forEach((e) => {
    if (e.position  && e.position.toLowerCase()  !== "none") ps.add(e.position.trim());
    if (e.brand     && e.brand.toLowerCase()     !== "none") bs.add(e.brand.trim());
    if (e.violation && e.violation.toLowerCase() !== "none") vs.add(e.violation.trim());
  });
  _buildSelect(pos, "Position",  "No Position",  ps);
  _buildSelect(brd, "Brand",     "No Brand",     bs);
  _buildSelect(vio, "Violation", "No Violation", vs);
  [pos, brd, vio].forEach(_updateSelectColor);
}

async function _sys_renderTable() {
  const tbody  = document.getElementById("sys-employeeTableBody");
  const noData = document.getElementById("sys-no-data");
  const pagDiv = document.getElementById("sys-pagination");
  if (!tbody) return;
  if (!SYS.employees.length) {
    tbody.innerHTML = "";
    if (pagDiv) pagDiv.style.display = "none";
    if (noData) noData.style.display = "block";
    return;
  }
  if (noData) noData.style.display = "none";
  SYS.totalPages  = Math.ceil(SYS.employees.length / SYS.itemsPerPage);
  SYS.currentPage = Math.min(Math.max(SYS.currentPage, 1), SYS.totalPages);
  const start = (SYS.currentPage - 1) * SYS.itemsPerPage;
  const slice = SYS.employees.slice(start, start + SYS.itemsPerPage);
  tbody.innerHTML = slice.map((emp, i) => {
    const initials = (emp.fullname || "UN").split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
    const imgSrc   = `../../uploads/user/${emp.image}?t=${Date.now()}`;
    // FIX #1: coerce emp.id to String in onclick so it always matches
    return `<tr>
      <td>${start + i + 1}</td>
      <td><strong>${_escapeHtml(String(emp.id))}</strong></td>
      <td><strong>${_toProperCase(emp.fullname)}</strong></td>
      <td>${_toProperCase(emp.position)}</td>
      <td>${_toProperCase(emp.brand)}</td>
      <td><span class="status-${(emp.status || "").toLowerCase()}">${emp.status}</span></td>
      <td>${emp.shift}</td>
      <td class="Col7"><div style="height:50px;overflow-y:auto;scrollbar-width:thin;align-content:center;"><small>${emp.violation || "None"}</small></div></td>
      <td class="Col8">${
        emp.image
          ? `<img src="${imgSrc}" alt="${_escapeHtml(emp.fullname)}" class="employee-image" onerror="this.style.display='none';this.nextSibling.style.display='inline'"><span style="display:none">📷</span>`
          : `<div class="ph-cont"><div class="employee-ph">${initials}</div></div>`
      }</td>
      <td class="Col9" onclick="sys_copyQR('${_escapeHtml(emp.qr_code)}')" title="Copy Proximity code" style="cursor:pointer">
        <img src="../icon/nfc-icon.png" style="width:20px;height:20px"></td>
      <td><small>${emp.created_at}</small></td>
      <td><small>${emp.updated_at}</small></td>
      <td>
        <div style="display:flex;gap:.5rem">
          <div style="display:grid;gap:.2rem;flex:.5">
            <button class="btn btn-success btn-sm2" onclick="sys_addToLog('${_escapeHtml(String(emp.id))}','IN',this)"  title="Check IN">🟢 IN</button>
            <button class="btn btn-danger  btn-sm2" onclick="sys_addToLog('${_escapeHtml(String(emp.id))}','OUT',this)" title="Check OUT">🔴 OUT</button>
          </div>
          <button class="btn btn-primary btn-sm" onclick="sys_openModal('edit','${_escapeHtml(String(emp.id))}')" title="Edit"><i class="fas fa-edit"></i> Edit</button>
          <button class="btn btn-danger  btn-sm" onclick="sys_openDeleteModal('${_escapeHtml(String(emp.id))}',false)" title="Delete"><i class="fas fa-trash-alt"></i> Delete</button>
        </div>
      </td>
    </tr>`;
  }).join("");
  _updatePagination(SYS, "sys-pagination", "sys-prev-btn", "sys-next-btn", "sys-page-info", "employees");
}

function _sys_renderError(msg) {
  const tbody = document.getElementById("sys-employeeTableBody");
  if (!tbody) return;
  if (!SYS.employees.length) {
    tbody.innerHTML = "";
    const noData = document.getElementById("sys-no-data");
    if (noData) noData.style.display = "block";
    return;
  }
  tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:20px;color:#c0392b;">⚠️ ${msg}</td></tr>`;
}

function _sys_updateCounts() {
  const total    = document.getElementById("sys-total_employees");
  const active   = document.getElementById("sys-active_employees");
  const inactive = document.getElementById("sys-inactive_employees");
  if (total)    total.textContent    = SYS.employees.length;
  if (active)   active.textContent   = SYS.employees.filter((e) => (e.status || "").toLowerCase() === "active").length;
  if (inactive) inactive.textContent = SYS.employees.filter((e) => (e.status || "").toLowerCase() !== "active").length;
}

function _sys_updateDeleteBtn() {
  const btn = document.querySelector("#pane-employees .delete-all-btn .btn-danger");
  if (!btn) return;
  const has = _hasFilters("sys-searchForm");
  btn.disabled      = !has;
  btn.style.opacity = has ? "1" : "0.4";
  btn.style.cursor  = has ? "pointer" : "not-allowed";
  btn.title         = has ? "Delete filtered employees" : "Apply filters first to enable deletion";
}

function sys_searchEmployees() {
  const qr = document.getElementById("sys-search_qr");
  if (qr && qr.value.trim()) qr.value = "";
  sys_loadEmployees(_getFilters("sys-searchForm"), true);
  _displayFilterStatus("sys-searchForm", "sys-filter-status", "#pane-employees .controls");
  _sys_updateDeleteBtn();
}

function sys_clearSearch() {
  const form = document.getElementById("sys-searchForm");
  if (form) form.reset();
  const fs = document.getElementById("sys-filter-status");
  if (fs) fs.remove();
  SYS.currentPage   = 1;
  SYS.activeFilters = {};
  sys_loadEmployees({}, false);
  _sys_updateDeleteBtn();
}

function sys_previousPage() {
  if (SYS.currentPage > 1) { SYS.currentPage--; _sys_renderTable(); }
}
function sys_nextPage() {
  if (SYS.currentPage < SYS.totalPages) { SYS.currentPage++; _sys_renderTable(); }
}

function sys_copyQR(code) {
  navigator.clipboard
    ? navigator.clipboard.writeText(code).then(() => _showAlert("Proximity code copied!")).catch(() => _showAlert("Failed to copy", "error"))
    : _showAlert("Failed to copy", "error");
}

// FIX #1: employeeId is always a String here (rendered as '${String(emp.id)}' in the table)
async function sys_openModal(action, employeeId = null) {
  SYS.currentAction = action;
  const modal = document.getElementById("sys-employeeModal");
  const title = document.getElementById("sys-modalTitle");
  const form  = document.getElementById("sys-employeeForm");
  if (!modal || !title || !form) return;
  form.reset();
  document.getElementById("sys-employee_id").value = "";
  document.getElementById("sys-original_id").value = "";
  document.querySelector(".sys-file-upload-label").innerHTML =
    '<i class="fas fa-file-image"></i> Click to select image (Max 5MB)';
  if (action === "add") {
    title.innerHTML = '<i class="fas fa-user-plus"></i> Add Employee';
    document.getElementById("sys-status").value = "Active";
    modal.style.display = "block";
    document.getElementById("sys-qr_code").focus();
  } else if (action === "edit" && employeeId) {
    title.innerHTML = '<i class="fas fa-edit" style="color:#7c3aed"></i> Edit Employee';
    modal.style.display = "block";
    await _sys_loadEmployeeData(String(employeeId));
    const idField = document.getElementById("sys-employee_id");
    if (idField) { idField.focus(); idField.select(); }
  }
}

async function _sys_loadEmployeeData(id) {
  try {
    const res  = await fetch(`../cnfg/manpower_backend.php?action=get_single&id=${encodeURIComponent(id)}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success && data.data) {
      const e = data.data;
      document.getElementById("sys-employee_id").value = e.id;
      document.getElementById("sys-original_id").value = e.id;
      document.getElementById("sys-fullname").value    = e.fullname  || "";
      document.getElementById("sys-position").value    = e.position  || "";
      document.getElementById("sys-brand").value       = e.brand     || "";
      document.getElementById("sys-status").value      = e.status    || "Active";
      document.getElementById("sys-shift").value       = e.shift     || "";
      document.getElementById("sys-violation").value   = e.violation || "";
      document.getElementById("sys-qr_code").value     = e.qr_code   || "";
      const lbl = document.querySelector(".sys-file-upload-label");
      if (e.image) {
        const src = `../../uploads/user/${e.image}?t=${Date.now()}`;
        lbl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px">
          <img src="${src}" alt="Current" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:cover">
          </div>`;
      }
    } else {
      _showAlert("Failed to load employee data", "error");
    }
  } catch (e) {
    _showAlert("Failed to load employee data", "error");
  }
}

// FIX #4: duplicate-name check correctly skips the record being edited
async function sys_handleFormSubmit(e) {
  e.preventDefault();
  try {
    const empid      = document.getElementById("sys-employee_id").value.trim();
    const fullname   = document.getElementById("sys-fullname").value.trim();
    const position   = document.getElementById("sys-position").value.trim();
    const brand      = document.getElementById("sys-brand").value.trim();
    const shift      = document.getElementById("sys-shift").value;
    const originalId = document.getElementById("sys-original_id").value.trim();

    if (!empid)    { _showAlert("EMPID is required",    "error"); return; }
    if (!fullname) { _showAlert("Fullname is required", "error"); return; }
    if (!position) { _showAlert("Position is required", "error"); return; }
    if (!brand)    { _showAlert("Brand is required",    "error"); return; }
    if (!shift)    { _showAlert("Shift is required",    "error"); return; }

    if (SYS.currentAction === "edit" && empid !== originalId) {
      if (SYS.employees.some((emp) => String(emp.id) === empid)) {
        _showAlert(`Employee ID "${empid}" is already in use`, "error");
        return;
      }
    }

    // FIX #4: when editing, exclude the record being edited from the name-duplicate check
    const nameDuplicate = SYS.employees.some((emp) => {
      if (SYS.currentAction === "edit" && String(emp.id) === originalId) return false;
      return emp.fullname.toLowerCase().trim() === fullname.toLowerCase().trim();
    });
    if (nameDuplicate) {
      _showAlert(`Employee "${fullname}" already exists!`, "error");
      return;
    }

    const img = document.getElementById("sys-image");
    if (img.files.length) {
      const f = img.files[0];
      if (f.size > 5 * 1024 * 1024) { _showAlert("Image must be < 5MB", "error"); return; }
      if (!["image/jpeg","image/jpg","image/png","image/gif"].includes(f.type)) {
        _showAlert("Only JPEG, PNG, GIF allowed", "error"); return;
      }
    }

    _showLoading(true);
    const fd = new FormData(e.target);
    fd.set("action", SYS.currentAction);
    fd.set("id", empid);
    if (SYS.currentAction === "edit") fd.set("original_id", originalId);

    const res  = await fetch("../cnfg/manpower_backend.php", {
      method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success) {
      _showAlert(
        data.message || (SYS.currentAction === "add" ? "Employee added!" : "Employee updated!"),
        "success",
      );
      sys_closeModal();
      // FIX #2 + #3: bust cross-tab caches so DTL/PRX reflect the change immediately
      _dtl_qrMapCache    = null;
      _prx_systemQRCache = null;
      _prx_qrMapCache    = null;
      await sys_loadEmployees(
        _hasFilters("sys-searchForm") ? _getFilters("sys-searchForm") : {},
        SYS.currentAction === "edit",
      );
    } else {
      _showAlert(data.message || "Failed to save employee", "error");
    }
  } catch (err) {
    _showAlert("Failed to save employee", "error");
  } finally {
    _showLoading(false);
  }
}

function sys_closeModal() {
  ["sys-employeeModal", "sys-deleteModal", "sys-importModal"].forEach((id) => {
    const m = document.getElementById(id);
    if (m) m.style.display = "none";
  });
  const form = document.getElementById("sys-employeeForm");
  if (form) form.reset();
  const lbl = document.querySelector(".sys-file-upload-label");
  if (lbl) lbl.innerHTML = '<i class="fas fa-file-image"></i> Click to select image (Max 5MB)';
  const img = document.getElementById("sys-image");
  if (img) img.value = "";
}

function sys_openDeleteModal(employeeId = null, requireConfirmation = false) {
  const modal      = document.getElementById("sys-deleteModal");
  const confirmBtn = document.getElementById("sys-confirmDeleteBtn");
  const input      = document.getElementById("sys-confirmationInput");
  const container  = document.getElementById("sys-confirmationContainer");
  const title      = document.getElementById("sys-deleteModalTitle");
  const msg        = document.getElementById("sys-deleteModalMessage");
  const hasFilters = _hasFilters("sys-searchForm");

  confirmBtn.dataset.employeeId = employeeId;
  confirmBtn.dataset.req        = requireConfirmation;
  confirmBtn.dataset.hasFilters = hasFilters;

  if (requireConfirmation) {
    title.textContent = hasFilters ? "⚠️ Delete Filtered Employees" : "⚠️ Delete All Employees";
    msg.innerHTML = `<p>This will permanently delete <strong>${SYS.employees.length}</strong> employee(s).</p>
      <p style="color:#d63031;font-weight:bold">This action cannot be undone.</p>`;
    container.style.display  = "block";
    confirmBtn.disabled      = true;
    confirmBtn.style.opacity = "0.5";
    confirmBtn.style.cursor  = "not-allowed";
  } else {
    title.textContent        = "Delete Employee";
    msg.textContent          = "Are you sure you want to delete this employee?";
    container.style.display  = "none";
    confirmBtn.disabled      = false;
    confirmBtn.style.opacity = "1";
    confirmBtn.style.cursor  = "pointer";
  }
  if (input) input.value = "";
  modal.style.display = "flex";

  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

  if (requireConfirmation && input) {
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    newInput.focus();
    newInput.addEventListener("input", () => {
      newBtn.disabled      = newInput.value !== "DELETE ALL";
      newBtn.style.opacity = newBtn.disabled ? "0.5" : "1";
    });
  }

  const handleConfirm = () => {
    const id  = newBtn.dataset.employeeId;
    const req = newBtn.dataset.req === "true";
    const hf  = newBtn.dataset.hasFilters === "true";
    if (req) { hf ? _sys_deleteFiltered() : _showAlert("Apply filters first", "error"); }
    else     { _sys_deleteOne(id); }
    modal.style.display = "none";
  };
  newBtn.addEventListener("click", handleConfirm);
  document.addEventListener("keydown", function ek(e) {
    if (e.key === "Enter" && modal.style.display === "flex") {
      if (!newBtn.disabled) handleConfirm();
      document.removeEventListener("keydown", ek);
    }
  });
}

async function _sys_deleteOne(id) {
  try {
    _showLoading(true);
    const fd = new FormData();
    fd.append("action", "delete");
    fd.append("id", id);
    const res  = await fetch("../cnfg/manpower_backend.php", {
      method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success) {
      _showAlert(data.message, "success");
      // FIX #2 + #3: bust cross-tab caches
      _dtl_qrMapCache    = null;
      _prx_systemQRCache = null;
      _prx_qrMapCache    = null;
      await sys_loadEmployees(SYS.activeFilters, true);
    } else _showAlert(data.message || "Delete failed", "error");
  } catch (e) {
    _showAlert("Delete failed", "error");
  } finally {
    _showLoading(false);
  }
}

async function _sys_deleteFiltered() {
  try {
    _showLoading(true);
    const ids = SYS.employees.map((e) => e.id);
    if (!ids.length) { _showAlert("Nothing to delete", "warning"); return; }
    const fd = new FormData();
    fd.append("action", "delete_filtered");
    fd.append("employee_ids", JSON.stringify(ids));
    fd.append("filters", JSON.stringify(SYS.activeFilters));
    const res  = await fetch("../cnfg/manpower_backend.php", {
      method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success) {
      _showAlert(`Deleted ${data.deleted_count || ids.length} employee(s)`, "success");
      // FIX #2 + #3: bust cross-tab caches
      _dtl_qrMapCache    = null;
      _prx_systemQRCache = null;
      _prx_qrMapCache    = null;
      SYS.currentPage    = 1;
      sys_clearSearch();
    } else _showAlert(data.message || "Delete failed", "error");
  } catch (e) {
    _showAlert("Delete failed", "error");
  } finally {
    _showLoading(false);
  }
}

// FIX #1: employeeId received as String from onclick attribute
async function sys_addToLog(employeeId, checkStatus = "IN", triggerElement = null) {
  _stopAudio();
  const btn  = triggerElement;
  const orig = btn ? btn.innerHTML : "";
  try {
    if (btn) { btn.innerHTML = "⏳ Adding..."; btn.disabled = true; }

    // FIX #1: compare as strings to avoid strict number/string mismatch
    const emp = SYS.employees.find((e) => String(e.id) === String(employeeId));
    if (!emp) throw new Error("Employee not found");

    const logData = {
      employee_id:      emp.id,
      fullname:         emp.fullname,
      position:         emp.position,
      brand:            emp.brand,
      status:           emp.status,
      shift:            emp.shift,
      violation:        emp.violation || "",
      image:            emp.image     || "",
      qr_code:          emp.qr_code,
      check_status:     checkStatus,
      access_timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    };
    const res    = await fetch("../cnfg/add_to_log.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(logData),
    });
    const result = await res.json();
    if (result.success) {
      const hasVio = emp.violation && emp.violation.trim();
      if (hasVio) _playSound("warningSound");
      else if ((emp.status || "").toLowerCase() === "inactive") _playSound("inactiveSound");
      else _playSound("successSound");
      _showAlert(`Marked as ${checkStatus}!`, "success");
    } else throw new Error(result.message || "Failed");
  } catch (e) {
    _showAlert("Error: " + e.message, "error");
  } finally {
    setTimeout(() => {
      sys_searchEmployees();
      if (btn) { btn.innerHTML = orig; btn.disabled = false; }
    }, 1000);
  }
}

function _sys_setupFileUpload() {
  const img = document.getElementById("sys-image");
  if (!img) return;
  img.addEventListener("change", function (e) {
    const lbl = document.querySelector(".sys-file-upload-label");
    if (!lbl) return;
    if (!e.target.files.length) {
      lbl.innerHTML = '<i class="fas fa-file-image"></i> Click to select image (Max 5MB)';
      return;
    }
    const f = e.target.files[0];
    if (f.size > 5 * 1024 * 1024) {
      _showAlert("Image must be < 5MB", "error");
      e.target.value = "";
      lbl.innerHTML  = '<i class="fas fa-file-image"></i> Click to select image (Max 5MB)';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      lbl.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:8px">
        <img src="${ev.target.result}" style="max-width:100%;max-height:200px;border-radius:8px;object-fit:cover">
        <small style="color:#4CAF50">✓ New image selected</small></div>`;
    };
    reader.readAsDataURL(f);
  });
}

function sys_openImportModal()   { const m = document.getElementById("sys-importModal");      if (m) m.style.display = "block"; }
function sys_toggleAddOptions()  { const m = document.getElementById("sys-addOptionsMenu");   if (m) m.style.display = m.style.display === "block" ? "none" : "block"; }
function sys_hideAddOptions()    { const m = document.getElementById("sys-addOptionsMenu");   if (m) m.style.display = "none"; }
function sys_toggleExportOptions(){ const m = document.getElementById("sys-exportOptionsMenu"); if (m) m.style.display = m.style.display === "block" ? "none" : "block"; }
function sys_hideExportOptions() { const m = document.getElementById("sys-exportOptionsMenu"); if (m) m.style.display = "none"; }
function sys_previewFile()       { if (typeof previewFile    === "function") previewFile("sys-"); }
function sys_exportAllData()     { if (typeof exportAllData  === "function") exportAllData(); }
function sys_exportFilteredData(){ if (typeof exportFilteredData === "function") exportFilteredData(); }
function sys_exportWithImages()  { if (typeof exportWithImages === "function") exportWithImages(); }

/* ═══════════════════════════════════════════════════════════
   6B.  DTL (SCANNED LOG) MODULE
═══════════════════════════════════════════════════════════ */

async function _dtl_init() {
  document.getElementById("dtl-autoUpdateToggle")?.addEventListener("change", dtl_toggleAutoUpdate);
  document.getElementById("dtl-updateInterval")?.addEventListener("change", dtl_updateInterval);
  document
    .querySelectorAll("#dtl-searchForm input, #dtl-searchForm select")
    .forEach((el) => el.addEventListener("input", _debounce(dtl_searchEmployees, 300)));
  _autoFocusActiveQR();
  await dtl_loadEmployees();
  _dtl_updateDeleteBtn();
  setTimeout(() => _dtl_startAutoUpdate(_dtl_getInterval()), 1000);
}

function _dtl_getInterval() {
  const sel = document.getElementById("dtl-updateInterval");
  return sel ? parseInt(sel.value) || 1000 : 1000;
}

function _dtl_startAutoUpdate(ms) {
  _dtl_stopAutoUpdate();
  DTL.autoUpdateEnabled = true;
  DTL.autoUpdateInterval = setInterval(() => {
    if (!DTL.isUserActive) dtl_loadEmployees(DTL.activeFilters, true).catch(() => {});
  }, ms);
}
function _dtl_stopAutoUpdate() {
  if (DTL.autoUpdateInterval) { clearInterval(DTL.autoUpdateInterval); DTL.autoUpdateInterval = null; }
  DTL.autoUpdateEnabled = false;
}

function dtl_toggleAutoUpdate() {
  const tog = document.getElementById("dtl-autoUpdateToggle");
  if (tog && tog.checked) { _dtl_startAutoUpdate(_dtl_getInterval()); _dtl_updateUI(); }
  else                    { _dtl_stopAutoUpdate(); _dtl_updateUI(); }
}
function dtl_updateInterval() {
  if (DTL.autoUpdateEnabled) _dtl_startAutoUpdate(_dtl_getInterval());
}

function _dtl_updateUI() {
  const tog    = document.getElementById("dtl-autoUpdateToggle");
  const status = document.getElementById("dtl-autoUpdateStatus");
  const last   = document.getElementById("dtl-lastUpdateTime");
  const sel    = document.getElementById("dtl-updateInterval");
  if (tog)    tog.checked   = DTL.autoUpdateEnabled;
  if (status) { status.textContent = DTL.autoUpdateEnabled ? "ON" : "OFF"; status.className = "auto-update-status " + (DTL.autoUpdateEnabled ? "active" : "inactive"); }
  if (last && DTL.lastUpdateTimestamp) { last.textContent = "Last updated: " + new Date(DTL.lastUpdateTimestamp).toLocaleTimeString(); last.style.display = "block"; }
  if (sel) sel.disabled = !DTL.autoUpdateEnabled;
}

function _dtl_showAutoUpdateNotification() {
  const n = document.getElementById("dtl-autoUpdateNotification");
  if (!n) return;
  n.textContent = `Data updated at ${new Date().toLocaleTimeString()}`;
  n.style.cssText = "display:block;opacity:1;background:#e8f5e8;color:#2d5a2d;padding:4px 8px;border-radius:4px;font-size:12px;border:1px solid #b8e6b8;transition:opacity .3s";
  setTimeout(() => { n.style.opacity = "0"; setTimeout(() => (n.style.display = "none"), 300); }, 3000);
}

// FIX #6: translate the __none__ sentinel into _none suffix params
// so datalog_backend.php receives the same key format manpower_backend.php uses.
async function dtl_loadEmployees(filters = {}, preservePage = false) {
  try {
    _showLoading(false);
    if (!Object.keys(filters).length && _hasFilters("dtl-searchForm"))
      filters = _getFilters("dtl-searchForm");
    DTL.activeFilters = filters;

    const params = new URLSearchParams({ action: "get" });
    for (const [k, v] of Object.entries(filters)) {
      // FIX #6: mirror the same __none__ → _none translation used for manpower
      if (v === "__none__") params.append(k + "_none", "1");
      else                  params.append(k, v);
    }

    const res = await fetch(`../cnfg/datalog_backend.php?${params}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      const hasChanges = preservePage && JSON.stringify(DTL.employees) !== JSON.stringify(data.data);
      DTL.employees        = data.data;
      DTL.employeeDataCache= null;
      _dtl_populateFilters(DTL.employees);
      if (!preservePage && !Object.keys(filters).length) DTL.currentPage = 1;
      await _dtl_renderTable();
      DTL.lastUpdateTimestamp = Date.now();
      if (preservePage && hasChanges) _dtl_showAutoUpdateNotification();
      _dtl_updateUI();
      _updateBadge("badge-scanned", DTL.employees.length);
      if (Object.keys(filters).length)
        _displayFilterStatus("dtl-searchForm", "dtl-filter-status", "#pane-scanned .controls");
    } else {
      _dtl_renderError(data.message || "Error loading employees");
    }
  } catch (e) {
    if (e.name !== "TimeoutError" && e.name !== "AbortError")
      _dtl_renderError("Network error. Please try again.");
  } finally {
    _showLoading(false);
  }
}

function _dtl_populateFilters(list) {
  const pos = document.getElementById("dtl-search_position");
  const brd = document.getElementById("dtl-search_brand");
  const vio = document.getElementById("dtl-search_violation");
  if (!pos || !brd || !vio) return;
  const ps = new Set(), bs = new Set(), vs = new Set();
  list.forEach((e) => {
    if (e.position  && e.position.toLowerCase()  !== "none") ps.add(e.position.trim());
    if (e.brand     && e.brand.toLowerCase()     !== "none") bs.add(e.brand.trim());
    if (e.violation && e.violation.toLowerCase() !== "none") vs.add(e.violation.trim());
  });
  _buildSelect(pos, "Position",  "No Position",  ps);
  _buildSelect(brd, "Brand",     "No Brand",     bs);
  _buildSelect(vio, "Violation", "No Violation", vs);
  [pos, brd, vio, document.getElementById("dtl-search_in-out")].forEach(_updateSelectColor);
}

async function _dtl_renderTable() {
  const tbody  = document.getElementById("dtl-employeeTableBody");
  const noData = document.getElementById("dtl-no-data");
  const pagDiv = document.getElementById("dtl-pagination");
  if (!tbody) return;
  if (!DTL.employees.length) {
    tbody.innerHTML = "";
    if (pagDiv) pagDiv.style.display = "none";
    if (noData) noData.style.display = "block";
    return;
  }
  if (noData) noData.style.display = "none";
  DTL.totalPages  = Math.ceil(DTL.employees.length / DTL.itemsPerPage);
  DTL.currentPage = Math.min(Math.max(DTL.currentPage, 1), DTL.totalPages);
  const start = (DTL.currentPage - 1) * DTL.itemsPerPage;
  const slice = DTL.employees.slice(start, start + DTL.itemsPerPage);
  const qrMap = await _dtl_buildQRMap();
  tbody.innerHTML = slice.map((emp, i) => {
    const matched  = qrMap[(emp.qr_code || "").trim().toLowerCase()];
    const imgUrl   = matched && matched.image ? `../../uploads/user/${matched.image}` : emp.image ? `../../uploads/user/${emp.image}` : null;
    const display  = matched ? matched.fullname : emp.fullname || "N/A";
    const empId    = matched ? matched.id : "";
    const initials = (display || "UN").split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
    const tooltip  = matched ? `${matched.fullname}\n${matched.position}\n${matched.brand}` : emp.fullname || "";
    return `<tr>
      <td>${start + i + 1}</td>
      <td><strong>${_escapeHtml(String(empId))}</strong></td>
      <td><strong>${_toProperCase(display)}</strong></td>
      <td>${_toProperCase(matched ? matched.position : emp.position)}</td>
      <td>${_toProperCase(matched ? matched.brand    : emp.brand)}</td>
      <td><span class="status-${(emp.status || "").toLowerCase()}">${emp.status || "N/A"}</span></td>
      <td>${emp.shift || "N/A"}</td>
      <td class="Col7"><div style="height:50px;overflow-y:auto;scrollbar-width:thin;align-content:center;"><small>${emp.violation || "None"}</small></div></td>
      <td class="Col8">${
        imgUrl
          ? `<img src="${imgUrl}" alt="${_escapeHtml(display)}" class="employee-image" title="${_escapeHtml(tooltip)}" onerror="this.style.display='none';this.nextSibling.style.display='inline'"><span style="display:none" title="${_escapeHtml(tooltip)}">📷</span>`
          : `<div class="ph-cont" title="${_escapeHtml(tooltip)}"><div class="employee-ph">${initials}</div></div>`
      }</td>
      <td class="Col9" onclick="dtl_copyQR('${_escapeHtml(emp.qr_code || "")}')" title="Copy Proximity code" style="cursor:pointer">
        <img src="../icon/nfc-icon.png" style="width:20px;height:20px"></td>
      <td class="employee-timestamp"><small>${emp.access_timestamp || "N/A"}</small></td>
      <td><div class="check-status-${(emp.check_status || "").toLowerCase()}"><div class="employee-ph">${emp.check_status || "N/A"}</div></div></td>
    </tr>`;
  }).join("");
  _updatePagination(DTL, "dtl-pagination", "dtl-prev-btn", "dtl-next-btn", "dtl-page-info", "employees");
}

function _dtl_renderError(msg) {
  const tbody = document.getElementById("dtl-employeeTableBody");
  if (!tbody) return;
  if (!DTL.employees.length) {
    tbody.innerHTML = "";
    const noData = document.getElementById("dtl-no-data");
    if (noData) noData.style.display = "block";
    return;
  }
  tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:20px;color:#c0392b;">⚠️ ${msg}</td></tr>`;
}

// FIX #2: _dtl_qrMapCache is intentionally NOT a const so sys_ mutators can null it
let _dtl_qrMapCache = null;
async function _dtl_buildQRMap() {
  if (_dtl_qrMapCache) return _dtl_qrMapCache;
  try {
    const res  = await fetch("../cnfg/manpower_backend.php?action=get", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      _dtl_qrMapCache = {};
      data.data.forEach((e) => {
        if (e.qr_code) _dtl_qrMapCache[e.qr_code.trim().toLowerCase()] = e;
      });
      return _dtl_qrMapCache;
    }
  } catch (e) {}
  return {};
}

function dtl_copyQR(code) {
  navigator.clipboard
    ? navigator.clipboard.writeText(code).then(() => _showAlert("Proximity code copied!")).catch(() => _showAlert("Failed to copy", "error"))
    : _showAlert("Failed to copy", "error");
}

function dtl_searchEmployees() {
  const qr = document.getElementById("dtl-search_qr");
  if (qr && qr.value.trim()) qr.value = "";
  dtl_loadEmployees(_getFilters("dtl-searchForm"), true);
  _displayFilterStatus("dtl-searchForm", "dtl-filter-status", "#pane-scanned .controls");
  _dtl_updateDeleteBtn();
}

function dtl_clearSearch() {
  const form = document.getElementById("dtl-searchForm");
  if (form) form.reset();
  const fs = document.getElementById("dtl-filter-status");
  if (fs) fs.remove();
  DTL.currentPage   = 1;
  DTL.activeFilters = {};
  dtl_loadEmployees({}, false);
  _dtl_updateDeleteBtn();
}

function dtl_previousPage() { if (DTL.currentPage > 1)                  { DTL.currentPage--; _dtl_renderTable(); } }
function dtl_nextPage()      { if (DTL.currentPage < DTL.totalPages)     { DTL.currentPage++; _dtl_renderTable(); } }

function dtl_forceRefresh() {
  _showLoading(true);
  DTL.isUserActive = true;
  _dtl_qrMapCache  = null;  // FIX #2: always bust on manual refresh
  dtl_loadEmployees()
    .then(() => { _showAlert("Refreshed!", "success"); setTimeout(() => (DTL.isUserActive = false), 2000); })
    .catch(() => _showAlert("Refresh failed", "error"))
    .finally(() => _showLoading(false));
}

function _dtl_updateDeleteBtn() {
  const btn = document.querySelector("#pane-scanned .delete-all-btn .btn-danger");
  if (!btn) return;
  const has = _hasFilters("dtl-searchForm");
  btn.disabled      = !has;
  btn.style.opacity = has ? "1" : "0.4";
  btn.style.cursor  = has ? "pointer" : "not-allowed";
}

function dtl_openDeleteModal(employeeId = null, requireConfirmation = false) {
  const modal      = document.getElementById("dtl-deleteModal");
  const confirmBtn = document.getElementById("dtl-confirmDeleteBtn");
  const input      = document.getElementById("dtl-confirmationInput");
  const container  = document.getElementById("dtl-confirmationContainer");
  const title      = document.getElementById("dtl-deleteModalTitle");
  const msg        = document.getElementById("dtl-deleteModalMessage");
  const hasFilters = _hasFilters("dtl-searchForm");

  confirmBtn.dataset.employeeId = employeeId;
  confirmBtn.dataset.req        = requireConfirmation;
  confirmBtn.dataset.hasFilters = hasFilters;

  if (requireConfirmation) {
    title.textContent        = hasFilters ? "⚠️ Delete Filtered Records" : "⚠️ Delete All Records";
    msg.innerHTML            = `<p>This will permanently delete <strong>${DTL.employees.length}</strong> record(s).</p><p style="color:#d63031;font-weight:bold">This action cannot be undone.</p>`;
    container.style.display  = "block";
    confirmBtn.disabled      = true;
    confirmBtn.style.opacity = "0.5";
  } else {
    title.textContent        = "Delete Record";
    msg.textContent          = "Are you sure you want to delete this record?";
    container.style.display  = "none";
    confirmBtn.disabled      = false;
    confirmBtn.style.opacity = "1";
  }
  if (input) input.value = "";
  modal.style.display = "flex";

  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

  if (requireConfirmation && input) {
    const ni = input.cloneNode(true);
    input.parentNode.replaceChild(ni, input);
    ni.focus();
    ni.addEventListener("input", () => { newBtn.disabled = ni.value !== "DELETE ALL"; newBtn.style.opacity = newBtn.disabled ? "0.5" : "1"; });
  }

  const handle = () => {
    const req = newBtn.dataset.req === "true";
    const hf  = newBtn.dataset.hasFilters === "true";
    if (req) { hf ? _dtl_deleteFiltered() : _showAlert("Apply filters first", "error"); }
    else     { _dtl_deleteOne(newBtn.dataset.employeeId); }
    modal.style.display = "none";
  };
  newBtn.addEventListener("click", handle);
  document.addEventListener("keydown", function ek(e) {
    if (e.key === "Enter" && modal.style.display === "flex") { if (!newBtn.disabled) handle(); document.removeEventListener("keydown", ek); }
  });
}

function dtl_closeModal() {
  const m = document.getElementById("dtl-deleteModal");
  if (m) m.style.display = "none";
}

async function _dtl_deleteOne(id) {
  try {
    _showLoading(true);
    const fd = new FormData();
    fd.append("action", "delete");
    fd.append("id", id);
    const res  = await fetch("../cnfg/datalog_backend.php", {
      method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success) {
      _showAlert(data.message, "success");
      DTL.employeeDataCache = null;
      await dtl_loadEmployees();
    } else _showAlert(data.message || "Delete failed", "error");
  } catch (e) {
    _showAlert("Delete failed", "error");
  } finally {
    _showLoading(false);
  }
}

async function _dtl_deleteFiltered() {
  try {
    _showLoading(true);
    const ids = DTL.employees.map((e) => e.id);
    if (!ids.length) { _showAlert("Nothing to delete", "warning"); return; }
    const fd = new FormData();
    fd.append("action", "delete_filtered");
    fd.append("employee_ids", JSON.stringify(ids));
    fd.append("filters", JSON.stringify(DTL.activeFilters));
    const res  = await fetch("../cnfg/datalog_backend.php", {
      method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success) {
      _showAlert(`Deleted ${data.deleted_count || ids.length} record(s)`, "success");
      DTL.currentPage = 1;
      dtl_clearSearch();
    } else _showAlert(data.message || "Delete failed", "error");
  } catch (e) {
    _showAlert("Delete failed", "error");
  } finally {
    _showLoading(false);
  }
}

function dtl_toggleExportOptions() { const m = document.getElementById("dtl-exportOptionsMenu"); if (m) m.style.display = m.style.display === "block" ? "none" : "block"; }
function dtl_hideExportOptions()   { const m = document.getElementById("dtl-exportOptionsMenu"); if (m) m.style.display = "none"; }
function dtl_exportAllData()       { if (typeof exportAllData       === "function") exportAllData(); }
function dtl_exportFilteredData()  { if (typeof exportFilteredData  === "function") exportFilteredData(); }
function dtl_exportWithImages()    { if (typeof exportWithImages    === "function") exportWithImages(); }

/* ═══════════════════════════════════════════════════════════
   6C.  PROXCODE MODULE
═══════════════════════════════════════════════════════════ */

async function _prx_init() {
  _prx_setupFileUpload();
  document.getElementById("prx-employeeForm")?.addEventListener("submit", prx_handleFormSubmit);
  document
    .querySelectorAll("#prx-searchForm input, #prx-searchForm select")
    .forEach((el) => el.addEventListener("input", _debounce(prx_searchEmployees, 300)));
  _autoFocusActiveQR();
  await _prx_loadUserId();
  await prx_loadEmployees();
  _prx_updateDeleteBtn();
}

async function _prx_loadUserId() {
  try {
    const res = await fetch("../cnfg/proxcode_backend.php?action=user_info", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (res.ok) {
      const d = await res.json();
      if (d.success && d.data) PRX.currentUserId = d.data.user_id || "default";
    }
  } catch (e) {
    PRX.currentUserId = "default";
  }
}

async function prx_loadEmployees(filters = {}, preservePage = false) {
  try {
    _showLoading(true);
    if (!Object.keys(filters).length && _hasFilters("prx-searchForm"))
      filters = _getFilters("prx-searchForm");
    PRX.activeFilters = filters;
    const { remarks: remarksFilter, ...backendFilters } = filters;
    const params = new URLSearchParams({ action: "get", ...backendFilters });
    const res = await fetch(`../cnfg/proxcode_backend.php?${params}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      PRX.employees        = data.data;
      PRX.employeeDataCache= null;
      if (remarksFilter) {
        const systemQRs = await _prx_getSystemQRs();
        PRX.employees = PRX.employees.filter((e) => {
          const occ = systemQRs.includes((e.qr_code || "").trim().toLowerCase());
          return (occ ? "occupied" : "available") === remarksFilter.toLowerCase();
        });
      }
      await _prx_populateFilters(PRX.employees);
      if (!preservePage && !Object.keys(filters).length) PRX.currentPage = 1;
      await _prx_renderTable();
      await _prx_updateCounts();
      _updateBadge("badge-proximity", data.data.length);
      if (Object.keys(filters).length)
        _displayFilterStatus("prx-searchForm", "prx-filter-status", "#pane-proximity .controls");
    } else {
      _prx_renderError(data.message || "Error loading codes");
    }
  } catch (e) {
    console.error(e);
    _prx_renderError("Network error. Please try again.");
  } finally {
    _showLoading(false);
  }
}

// FIX #3: declared with let so sys_ mutators can null them
let _prx_systemQRCache = null;
async function _prx_getSystemQRs() {
  if (_prx_systemQRCache) return _prx_systemQRCache;
  try {
    const res  = await fetch("../cnfg/manpower_backend.php?action=get", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      _prx_systemQRCache = data.data
        .map((e) => (e.qr_code || "").trim().toLowerCase())
        .filter(Boolean);
      return _prx_systemQRCache;
    }
  } catch (e) {}
  return [];
}

let _prx_qrMapCache = null;
async function _prx_buildQRMap() {
  if (_prx_qrMapCache) return _prx_qrMapCache;
  try {
    const res  = await fetch("../cnfg/manpower_backend.php?action=get", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success && Array.isArray(data.data)) {
      _prx_qrMapCache = {};
      data.data.forEach((e) => {
        if (e.qr_code) _prx_qrMapCache[e.qr_code.trim().toLowerCase()] = e;
      });
      return _prx_qrMapCache;
    }
  } catch (e) {}
  return {};
}

async function _prx_renderTable() {
  const tbody  = document.getElementById("prx-employeeTableBody");
  const noData = document.getElementById("prx-no-data");
  const pagDiv = document.getElementById("prx-pagination");
  if (!tbody) return;
  if (!PRX.employees.length) {
    tbody.innerHTML = "";
    if (pagDiv) pagDiv.style.display = "none";
    if (noData) noData.style.display = "block";
    return;
  }
  if (noData) noData.style.display = "none";
  PRX.totalPages  = Math.ceil(PRX.employees.length / PRX.itemsPerPage);
  PRX.currentPage = Math.min(Math.max(PRX.currentPage, 1), PRX.totalPages);
  const start     = (PRX.currentPage - 1) * PRX.itemsPerPage;
  const slice     = PRX.employees.slice(start, start + PRX.itemsPerPage);
  const systemQRs = await _prx_getSystemQRs();
  const qrMap     = await _prx_buildQRMap();
  tbody.innerHTML  = slice.map((emp, i) => {
    const key     = (emp.qr_code || "").trim().toLowerCase();
    const isOcc   = systemQRs.includes(key);
    const remarks = isOcc ? "Occupied" : "Available";
    const matched = qrMap[key];
    const imgUrl  = matched && matched.image ? `../../uploads/user/${matched.image}` : emp.image ? `../../uploads/user/${emp.image}` : null;
    const display = matched ? matched.fullname : emp.qr_code || "";
    const empId   = matched ? matched.id : "";
    const initials= (display || "UN").split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase();
    const tooltip = matched ? `${matched.fullname}\n${matched.position}\n${matched.brand}` : "No matched employee";
    return `<tr>
      <td>${start + i + 1}</td>
      <td class="Col8">${
        imgUrl
          ? `<img src="${imgUrl}" alt="${_escapeHtml(display)}" class="employee-image" title="${_escapeHtml(tooltip)}" onerror="this.style.display='none';this.nextSibling.style.display='inline'"><span style="display:none">📷</span>`
          : `<div class="ph-cont" title="${_escapeHtml(tooltip)}"><div class="employee-ph">${initials}</div></div>`
      }</td>
      <td><strong>${_escapeHtml(String(empId))}</strong></td>
      <td class="Col9" onclick="prx_copyQR('${_escapeHtml(emp.qr_code || "")}')" title="Copy Proximity code" style="cursor:pointer">
        <img src="../icon/nfc-icon.png" style="width:20px;height:20px"></td>
      <td><span class="remarks-${remarks.toLowerCase()}">${remarks}</span></td>
      <td><small>${emp.created_at || ""}</small></td>
      <td><small>${emp.updated_at || ""}</small></td>
      <td>
        <div style="display:flex;gap:.5rem">
          <button class="btn btn-primary btn-sm" onclick="prx_openModal('edit',${emp.id})" title="Edit"><i class="fas fa-edit"></i> Edit</button>
          <button class="btn btn-danger  btn-sm" onclick="prx_openDeleteModal('${emp.id}',false)" title="Delete"><i class="fas fa-trash-alt"></i> Delete</button>
        </div>
      </td>
    </tr>`;
  }).join("");
  _updatePagination(PRX, "prx-pagination", "prx-prev-btn", "prx-next-btn", "prx-page-info", "proximity codes");
}

function _prx_renderError(msg) {
  const tbody = document.getElementById("prx-employeeTableBody");
  if (!tbody) return;
  if (!PRX.employees.length) {
    tbody.innerHTML = "";
    const nd = document.getElementById("prx-no-data");
    if (nd) nd.style.display = "block";
    return;
  }
  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:20px;color:#c0392b;">⚠️ ${msg}</td></tr>`;
}

async function _prx_updateCounts() {
  const total = document.getElementById("prx-total_employees");
  const avail = document.getElementById("prx-total_available");
  const occ   = document.getElementById("prx-total_occupied");
  if (!total || !avail || !occ) return;
  const systemQRs = await _prx_getSystemQRs();
  const occCount  = PRX.employees.filter((e) => systemQRs.includes((e.qr_code || "").trim().toLowerCase())).length;
  total.textContent = PRX.employees.length;
  avail.textContent = PRX.employees.length - occCount;
  occ.textContent   = occCount;
}

async function _prx_populateFilters(list) {
  const rem = document.getElementById("prx-search_remarks");
  if (!rem) return;
  const systemQRs = await _prx_getSystemQRs();
  const remSet = new Set();
  list.forEach((e) => {
    remSet.add(systemQRs.includes((e.qr_code || "").trim().toLowerCase()) ? "Occupied" : "Available");
  });
  _buildSelect(rem, "Remarks", "No Remarks", remSet);
  _updateSelectColor(rem);
}

function prx_copyQR(code) {
  navigator.clipboard
    ? navigator.clipboard.writeText(code).then(() => _showAlert("Proximity code copied!")).catch(() => _showAlert("Failed to copy", "error"))
    : _showAlert("Failed to copy", "error");
}

function prx_searchEmployees() {
  const qr = document.getElementById("prx-search_qr");
  if (qr && qr.value.trim()) qr.value = "";
  prx_loadEmployees(_getFilters("prx-searchForm"), true);
  _displayFilterStatus("prx-searchForm", "prx-filter-status", "#pane-proximity .controls");
  _prx_updateDeleteBtn();
}

function prx_clearSearch() {
  const form = document.getElementById("prx-searchForm");
  if (form) form.reset();
  const fs = document.getElementById("prx-filter-status");
  if (fs) fs.remove();
  PRX.currentPage        = 1;
  PRX.activeFilters      = {};
  _prx_systemQRCache     = null;
  _prx_qrMapCache        = null;
  PRX.employeeDataCache  = null;
  prx_loadEmployees({}, false);
  _prx_updateDeleteBtn();
}

function prx_previousPage() { if (PRX.currentPage > 1)              { PRX.currentPage--; _prx_renderTable(); } }
function prx_nextPage()      { if (PRX.currentPage < PRX.totalPages) { PRX.currentPage++; _prx_renderTable(); } }

function _prx_updateDeleteBtn() {
  const btn = document.querySelector("#pane-proximity .delete-all-btn .btn-danger");
  if (!btn) return;
  const has = _hasFilters("prx-searchForm");
  btn.disabled      = !has;
  btn.style.opacity = has ? "1" : "0.4";
  btn.style.cursor  = has ? "pointer" : "not-allowed";
}

async function prx_openModal(action, employeeId = null) {
  PRX.currentAction = action;
  const modal = document.getElementById("prx-employeeModal");
  const title = document.getElementById("prx-modalTitle");
  const form  = document.getElementById("prx-employeeForm");
  if (!modal || !title || !form) return;
  form.reset();
  document.getElementById("prx-employee_id").value = "";
  if (action === "add") {
    title.innerHTML = "Add Proximity Code";
    modal.style.display = "block";
    document.getElementById("prx-qr_code").focus();
  } else if (action === "edit" && employeeId) {
    title.innerHTML = '<i class="fas fa-edit" style="color:#7c3aed"></i> Edit Proximity';
    modal.style.display = "block";
    await _prx_loadCodeData(employeeId);
  }
}

async function _prx_loadCodeData(id) {
  try {
    const res  = await fetch(`../cnfg/proxcode_backend.php?action=get_single&id=${id}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success && data.data) {
      document.getElementById("prx-employee_id").value = data.data.id       || "";
      document.getElementById("prx-qr_code").value     = data.data.qr_code  || "";
    } else _showAlert("Failed to load proximity code", "error");
  } catch (e) {
    _showAlert("Failed to load proximity code", "error");
  }
}

async function prx_handleFormSubmit(e) {
  e.preventDefault();
  try {
    const idField = document.getElementById("prx-employee_id");
    const qrField = document.getElementById("prx-qr_code");
    if (!qrField) { _showAlert("Form field 'qr_code' not found", "error"); return; }
    const empId  = idField?.value || "";
    const qrCode = qrField.value.trim();
    if (!qrCode) { _showAlert("Please enter a Proximity code", "error"); return; }

    const isDuplicate = PRX.employees.some((emp) => {
      if (PRX.currentAction === "edit" && empId && emp.id == empId) return false;
      return (emp.qr_code || "").toLowerCase().trim() === qrCode.toLowerCase();
    });
    if (isDuplicate) { _showAlert(`Proximity code "${qrCode}" already exists!`, "error"); return; }

    _showLoading(true);
    const fd  = new FormData(e.target);
    fd.append("action", PRX.currentAction);
    const res = await fetch("../cnfg/proxcode_backend.php", {
      method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      _showAlert(
        data.message || (PRX.currentAction === "add" ? "Proximity code added!" : "Proximity code updated!"),
        "success",
      );
      prx_closeModal();
      _prx_systemQRCache = null;
      _prx_qrMapCache    = null;
      await prx_loadEmployees(
        _hasFilters("prx-searchForm") ? _getFilters("prx-searchForm") : {},
        PRX.currentAction === "edit",
      );
      await _prx_updateCounts();
    } else _showAlert(data.message || "Failed to save", "error");
  } catch (e) {
    _showAlert("Failed to save proximity code", "error");
  } finally {
    _showLoading(false);
  }
}

function prx_closeModal() {
  ["prx-employeeModal", "prx-deleteModal", "prx-importModal"].forEach((id) => {
    const m = document.getElementById(id);
    if (m) m.style.display = "none";
  });
  const form = document.getElementById("prx-employeeForm");
  if (form) form.reset();
}

function prx_openDeleteModal(employeeId = null, requireConfirmation = false) {
  const modal      = document.getElementById("prx-deleteModal");
  const confirmBtn = document.getElementById("prx-confirmDeleteBtn");
  const input      = document.getElementById("prx-confirmationInput");
  const container  = document.getElementById("prx-confirmationContainer");
  const title      = document.getElementById("prx-deleteModalTitle");
  const msg        = document.getElementById("prx-deleteModalMessage");
  const hasFilters = _hasFilters("prx-searchForm");

  confirmBtn.dataset.employeeId = employeeId;
  confirmBtn.dataset.req        = requireConfirmation;
  confirmBtn.dataset.hasFilters = hasFilters;

  if (requireConfirmation) {
    title.textContent        = hasFilters ? "⚠️ Delete Filtered Codes" : "⚠️ Delete All Codes";
    msg.innerHTML            = `<p>This will permanently delete <strong>${PRX.employees.length}</strong> code(s).</p><p style="color:#d63031;font-weight:bold">This action cannot be undone.</p>`;
    container.style.display  = "block";
    confirmBtn.disabled      = true;
    confirmBtn.style.opacity = "0.5";
  } else {
    title.textContent        = "Delete Proximity Code";
    msg.textContent          = "Are you sure you want to delete this proximity code?";
    container.style.display  = "none";
    confirmBtn.disabled      = false;
    confirmBtn.style.opacity = "1";
  }
  if (input) input.value = "";
  modal.style.display = "flex";

  const newBtn = confirmBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

  if (requireConfirmation && input) {
    const ni = input.cloneNode(true);
    input.parentNode.replaceChild(ni, input);
    ni.focus();
    ni.addEventListener("input", () => { newBtn.disabled = ni.value !== "DELETE ALL"; newBtn.style.opacity = newBtn.disabled ? "0.5" : "1"; });
  }

  const handle = () => {
    const req = newBtn.dataset.req === "true";
    const hf  = newBtn.dataset.hasFilters === "true";
    if (req) { hf ? _prx_deleteFiltered() : _showAlert("Apply filters first", "error"); }
    else     { _prx_deleteOne(newBtn.dataset.employeeId); }
    modal.style.display = "none";
  };
  newBtn.addEventListener("click", handle);
  document.addEventListener("keydown", function ek(e) {
    if (e.key === "Enter" && modal.style.display === "flex") { if (!newBtn.disabled) handle(); document.removeEventListener("keydown", ek); }
  });
}

async function _prx_deleteOne(id) {
  try {
    _showLoading(true);
    const fd = new FormData();
    fd.append("action", "delete");
    fd.append("id", id);
    const res  = await fetch("../cnfg/proxcode_backend.php", {
      method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();
    if (data.success) {
      _showAlert(data.message, "success");
      _prx_systemQRCache = null;
      await prx_loadEmployees(PRX.activeFilters, true);
    } else _showAlert(data.message || "Delete failed", "error");
  } catch (e) {
    _showAlert("Delete failed", "error");
  } finally {
    _showLoading(false);
  }
}

async function _prx_deleteFiltered() {
  try {
    _showLoading(true);
    const ids = PRX.employees.map((e) => e.id);
    if (!ids.length) { _showAlert("Nothing to delete", "warning"); return; }
    const fd = new FormData();
    fd.append("action", "delete_filtered");
    fd.append("employee_ids", JSON.stringify(ids));
    fd.append("filters", JSON.stringify(_getFilters("prx-searchForm")));
    const res  = await fetch("../cnfg/proxcode_backend.php", {
      method: "POST", body: fd, headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      _showAlert(`Deleted ${data.deleted_count || ids.length} code(s)`, "success");
      PRX.currentPage = 1;
      prx_clearSearch();
    } else _showAlert(data.message || "Delete failed", "error");
  } catch (e) {
    _showAlert("Delete failed", "error");
  } finally {
    _showLoading(false);
  }
}

function _prx_setupFileUpload() {
  const img = document.getElementById("prx-image");
  if (!img) return;
  img.addEventListener("change", function (e) {
    const lbl = document.querySelector("#prx-employeeForm .file-upload-label");
    if (!lbl) return;
    if (!e.target.files.length) { lbl.innerHTML = '<i class="fas fa-file-image"></i> Click to select image (Max 5MB)'; return; }
    const f = e.target.files[0];
    if (f.size > 5 * 1024 * 1024) {
      _showAlert("Image must be < 5MB", "error");
      e.target.value = "";
      lbl.innerHTML  = '<i class="fas fa-file-image"></i> Click to select image (Max 5MB)';
      return;
    }
    lbl.innerHTML = `<i class="fas fa-image"></i> ${f.name}`;
  });
}

function prx_openImportModal()    { const m = document.getElementById("prx-importModal");      if (m) m.style.display = "block"; }
function prx_toggleAddOptions()   { const m = document.getElementById("prx-addOptionsMenu");   if (m) m.style.display = m.style.display === "block" ? "none" : "block"; }
function prx_hideAddOptions()     { const m = document.getElementById("prx-addOptionsMenu");   if (m) m.style.display = "none"; }
function prx_toggleExportOptions(){ const m = document.getElementById("prx-exportOptionsMenu"); if (m) m.style.display = m.style.display === "block" ? "none" : "block"; }
function prx_hideExportOptions()  { const m = document.getElementById("prx-exportOptionsMenu"); if (m) m.style.display = "none"; }
function prx_previewFile()        { if (typeof previewFile       === "function") previewFile("prx-"); }
function prx_exportAllCodes()     { if (typeof exportAllCodes    === "function") exportAllCodes(); }
function prx_exportFilteredCodes(){ if (typeof exportFilteredCodes === "function") exportFilteredCodes(); }
function prx_exportWithImages()   { if (typeof exportWithImages  === "function") exportWithImages(); }

/* ═══════════════════════════════════════════════════════════
   7.  SHARED BADGE UPDATER
═══════════════════════════════════════════════════════════ */

function _updateBadge(id, count) {
  const el = document.getElementById(id);
  if (el) el.textContent = count;
}

/* ═══════════════════════════════════════════════════════════
   8.  UTILITY
═══════════════════════════════════════════════════════════ */

function _debounce(fn, wait) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
}

/* ═══════════════════════════════════════════════════════════
   9.  BOOT
═══════════════════════════════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click",   _autoFocusActiveQR);
  document.addEventListener("focusin", _autoFocusActiveQR);

  _panelTabsInit.employees = true;
  _sys_init();
});

window.addEventListener("beforeunload", () => _dtl_stopAutoUpdate());

document.addEventListener("click", (e) => {
  [
    "sys-addOptionsMenu",
    "sys-exportOptionsMenu",
    "dtl-exportOptionsMenu",
    "prx-addOptionsMenu",
    "prx-exportOptionsMenu",
  ].forEach((id) => {
    const menu    = document.getElementById(id);
    const trigger = menu && menu.previousElementSibling;
    if (menu && menu.style.display === "block" && !menu.contains(e.target) && trigger && !trigger.contains(e.target)) {
      menu.style.display = "none";
    }
  });
});