// resource/js/violation.js --> vilation table

const ViolationBackend = "violation_log_backend.php";

// ── State ────────────────────────────────────────────────────────────
let allVio = [];
let filteredVio = [];
let currentPage = 1;
const PER_PAGE = 25;
let deleteTargetId = null;

// ── Init ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", loadViolations);

// ── Load ─────────────────────────────────────────────────────────────
async function loadViolations() {
  try {
    const res = await fetch(`${ViolationBackend}?action=list`, {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const data = await res.json();

    if (data.success && Array.isArray(data.data)) {
      allVio = data.data;
      buildTypeFilter();
      applyFilters();
      refreshStats();
    } else {
      showNoData();
    }
  } catch (e) {
    console.error("loadViolations:", e);
    showAlert("Failed to load violations.", "error");
    showNoData();
  }
}

// ── Filters ───────────────────────────────────────────────────────────
function buildTypeFilter() {
  const types = [
    ...new Set(allVio.map((v) => v.violation_type).filter(Boolean)),
  ].sort();
  const sel = document.getElementById("f_type");
  const cur = sel.value;
  sel.innerHTML = '<option value="">Default: ALL Types</option>';
  types.forEach((t) => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

// ── Fullname suggestions ─────────────────────────────────────────
let nameSuggestionIndex = -1;

function showNameSuggestions(query) {
  const list = document.getElementById("name-suggestions");
  if (!list) return;

  const q = query.trim().toLowerCase();

  const matches = [
    ...new Map(
      allVio
        .filter((v) => !q || (v.employee_name || "").toLowerCase().includes(q))
        .map((v) => [(v.employee_name || "").toLowerCase(), v.employee_name]),
    ).values(),
  ].filter(Boolean);

  if (!matches.length || !q) {
    list.style.display = "none";
    nameSuggestionIndex = -1;
    return;
  }

  list.innerHTML = matches
    .map((name, i) => {
      const safeFullname = escapeHtml(name);
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
          onmousedown="selectNameSuggestion(this.dataset.value)"
          onmouseover="highlightNameSuggestion(${i})"
          style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;">
        ${highlighted}
      </li>`;
    })
    .join("");

  list.style.display = "block";
  nameSuggestionIndex = -1;
}

function selectNameSuggestion(name) {
  const input = document.getElementById("f_name");
  const list = document.getElementById("name-suggestions");
  if (input) input.value = name;
  if (list) list.style.display = "none";
  nameSuggestionIndex = -1;
  applyFilters();
}

function highlightNameSuggestion(index) {
  const items = document.querySelectorAll("#name-suggestions li");
  items.forEach((li, i) => {
    li.style.background = i === index ? "#f0f9ff" : "";
  });
  nameSuggestionIndex = index;
}

function handleNameSuggestionNav(e) {
  const list = document.getElementById("name-suggestions");
  const items = list ? list.querySelectorAll("li") : [];
  if (!items.length || list.style.display === "none") return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    nameSuggestionIndex = Math.min(nameSuggestionIndex + 1, items.length - 1);
    highlightNameSuggestion(nameSuggestionIndex);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    nameSuggestionIndex = Math.max(nameSuggestionIndex - 1, 0);
    highlightNameSuggestion(nameSuggestionIndex);
  } else if (e.key === "Enter" && nameSuggestionIndex >= 0) {
    e.preventDefault();
    selectNameSuggestion(items[nameSuggestionIndex].dataset.value);
  } else if (e.key === "Escape") {
    list.style.display = "none";
    nameSuggestionIndex = -1;
  }
}

document.addEventListener("click", function (e) {
  const list = document.getElementById("name-suggestions");
  const input = document.getElementById("f_name");
  if (list && input && !input.contains(e.target) && !list.contains(e.target)) {
    list.style.display = "none";
    nameSuggestionIndex = -1;
  }
});

function applyFilters() {
  const name = document.getElementById("f_name").value.trim().toLowerCase();
  const type = document.getElementById("f_type").value;
  const from = document.getElementById("f_from").value;
  const to = document.getElementById("f_to").value;

  filteredVio = allVio.filter((v) => {
    if (name && !v.employee_name?.toLowerCase().includes(name)) return false;
    if (type && v.violation_type !== type) return false;
    if (from && v.violation_date < from) return false;
    if (to && v.violation_date > to) return false;
    return true;
  });

  currentPage = 1;
  renderTable();
  updateFilterStatus();
}

function clearFilters() {
  ["f_name", "f_from", "f_to"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("f_type").selectedIndex = 0;
  applyFilters();
}

function updateFilterStatus() {
  const el = document.getElementById("filter-status");
  const name = document.getElementById("f_name").value.trim();
  const type = document.getElementById("f_type").value;
  const from = document.getElementById("f_from").value;
  const to = document.getElementById("f_to").value;
  const active = [name, type, from, to].some(Boolean);

  el.innerHTML = active
    ? `<span style="
              background:#e3f2fd;border-left:4px solid #2196F3;
              padding:6px 12px;border-radius:4px;font-size:12px;
              color:#1565c0;display:inline-flex;align-items:center;gap:6px;">
            <i class="fas fa-filter"></i> Filters active — ${filteredVio.length} record${filteredVio.length !== 1 ? "s" : ""}
           </span>`
    : "";
}

// ── Render ────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById("violationTableBody");
  const paginationDiv = document.getElementById("pagination");
  const noDataDiv = document.getElementById("no-data");

  if (!filteredVio || filteredVio.length === 0) {
    tbody.innerHTML = "";
    if (paginationDiv) paginationDiv.style.display = "none";
    if (noDataDiv) noDataDiv.style.display = "block";
    return;
  }

  if (noDataDiv) noDataDiv.style.display = "none";

  const totalPages = Math.ceil(filteredVio.length / PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;

  const startIndex = (currentPage - 1) * PER_PAGE;
  const slice = filteredVio.slice(startIndex, startIndex + PER_PAGE);

  tbody.innerHTML = slice
    .map((v, index) => {
      const safeFullname = escapeHtml(toProperCase(v.employee_name));
      const safeViolation = escapeHtml(v.violation_type);
      const safeDescription = escapeHtml(v.violation_description);
      const safeId = escapeHtml(String(v.id));
      const safeEmpId = escapeHtml(String(v.employee_id));
      const badge = getBadgeClass(v.violation_type);
      const safeDate = formatDate(v.violation_date);
      const safeCreatedAt = formatDate(v.created_at, true);

      return `
          <tr>
            <td class="sn-cell">${startIndex + index + 1}</td>
            <td>
              <div class="emp-name"><strong>${safeFullname}</strong></div>
              <div class="emp-id"><strong>EMPID: ${safeEmpId}</strong></div>
            </td>
            <td><span class="badge ${badge}">${safeViolation || "—"}</span></td>
            <td class="desc-cell"><small>${safeDescription || "—"}</small></td>
            <td><small>${safeDate}</small></td>
            <td class="emp-createdAt"><small>${safeCreatedAt}</small></td>

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
                <small style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); text-align: center; color: #fff;">${safeFullname}</small>

                ${
                  window.PERMISSIONS.delete
                    ? `
                <!-- DELETE -->
                <button
                  data-emp-id="${safeId}"
                  data-name="${safeFullname || ''}"
                  data-type="${safeViolation || ''}"
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

  renderPagination(totalPages);
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
    document.querySelectorAll(".actions-toggle-btn").forEach((b) =>
      b.classList.remove("actions-active")
    );
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
  document.querySelectorAll(".actions-toggle-btn").forEach((b) =>
    b.classList.remove("actions-active")
  );
}

function openDeleteFromBtn(btn) {
  openDeleteModal(btn.dataset.empId, btn.dataset.name, btn.dataset.type);
}

function getBadgeClass(type) {
  if (!type) return "badge-blue";
  const t = type.toLowerCase();
  if (t.includes("cleared")) return "badge-green";
  if (
    [
      "misconduct",
      "insubordination",
      "harassment",
      "violence",
      "theft",
      "fraud",
    ].some((k) => t.includes(k))
  )
    return "badge-red";
  if (
    [
      "tardiness",
      "absenteeism",
      "absence",
      "late",
      "negligence",
      "policy",
      "updated",
      "initial",
    ].some((k) => t.includes(k))
  )
    return "badge-warn";
  return "badge-blue";
}

function renderPagination(totalPages) {
  const pg = document.getElementById("pagination");

  if (totalPages <= 1) {
    pg.style.display = "none";
    return;
  }

  pg.style.display = "flex";

  const delta = 2;
  const range = new Set([1, totalPages]);
  for (
    let p = Math.max(2, currentPage - delta);
    p <= Math.min(totalPages - 1, currentPage + delta);
    p++
  ) {
    range.add(p);
  }

  const sorted = [...range].sort((a, b) => a - b);
  let prev = null,
    html = "";

  html += `<button class="page-arrow-btn" tabindex="-1" onclick="goTo(${currentPage - 1})"
                 ${currentPage <= 1 ? "disabled" : ""}>
                 <i class="fas fa-arrow-left"></i>
               </button>`;

  for (const p of sorted) {
    if (prev !== null && p - prev > 1) {
      html += `<span class="page-ellipsis">…</span>`;
    }
    html += `<button class="page-num-btn ${currentPage === p ? "active" : ""}" tabindex="-1"
                   onclick="goTo(${p})">${p}</button>`;
    prev = p;
  }

  html += `<button class="page-arrow-btn" tabindex="-1" onclick="goTo(${currentPage + 1})"
                 ${currentPage >= totalPages ? "disabled" : ""}>
                 <i class="fas fa-arrow-right"></i>
               </button>`;
  html += `<span id="page-info">
                 ${filteredVio.length} total &nbsp;|&nbsp;
                 Page ${currentPage} of ${totalPages}
               </span>`;

  pg.innerHTML = html;
}

function goTo(p) {
  currentPage = p;
  renderTable();
}

function showNoData() {
  document.getElementById("violationTableBody").innerHTML = "";
  document.getElementById("no-data").style.display = "block";
  document.getElementById("pagination").style.display = "none";
}

function refreshStats() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  document.getElementById("statTotal").textContent = allVio.length;
  document.getElementById("statAffected").textContent = new Set(
    allVio.map((v) => v.employee_id),
  ).size;
  document.getElementById("statMonth").textContent = allVio.filter((v) => {
    if (!v.violation_date) return false;
    const [vy, vm] = v.violation_date.split("-").map(Number);
    return vy === y && vm === m;
  }).length;
}

// ── Delete ────────────────────────────────────────────────────────────
function openDeleteModal(id, name, type) {
  closeAllActionsPanels();
  deleteTargetId = id;
  document.getElementById("deleteModalMessage").innerHTML =
    `Delete the <strong>${escapeHtml(type)}</strong> violation for
         <strong>${escapeHtml(name)}</strong>?
         <strong>This cannot be undone.</strong>`;
  document.getElementById("deleteModal").classList.add("open");
}

function closeModal() {
  document.getElementById("deleteModal").classList.remove("open");
  deleteTargetId = null;
}

async function executeDelete() {
  if (!deleteTargetId) return;

  const fd = new FormData();
  fd.append("action", "delete");
  fd.append("id", deleteTargetId);

  try {
    const res = await fetch(`${ViolationBackend}`, {
      method: "POST",
      body: fd,
      headers: {
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    const data = await res.json();

    if (data.success) {
      showAlert(data.message || "Deleted successfully.", "success");
      closeModal();
      await loadViolations();
    } else {
      showAlert(data.message || "Failed to delete.", "error");
    }
  } catch (err) {
    console.error(err);
    showAlert("Server error.", "error");
  }
}

document.getElementById("deleteModal").addEventListener("click", function (e) {
  if (e.target === this) closeModal();
});

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

function formatDate(str, withTime = false) {
  if (!str) return "—";
  try {
    const d = new Date(withTime ? str : str + "T00:00:00");
    const opts = withTime
      ? {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }
      : {
          year: "numeric",
          month: "short",
          day: "numeric",
        };
    return d.toLocaleDateString("en-PH", opts);
  } catch {
    return str;
  }
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
