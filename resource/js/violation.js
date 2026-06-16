// resource/js/violation.js --> violation table

let ViolationBackend = null;

// ── State ────────────────────────────────────────────────────────────
let allVio = [];
let filteredVio = [];
let currentPage = 1;
const PER_PAGE = 25;
let deleteTargetId = null;

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

// ── Load ─────────────────────────────────────────────────────────────
async function loadViolations() {
  setControlButtonsDisabled(true);
  try {
    const res = await fetch(`${ViolationBackend}?action=list`, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    const data = await res.json();

    if (data.success && Array.isArray(data.data)) {
      allVio = data.data;
      buildTypeSuggestions();
      applyFilters();
      refreshStats();
    } else {
      showNoData();
    }
  } catch (e) {
    showAlert("Failed to load violations.", "error");
    showNoData();
  } finally {
    setControlButtonsDisabled(false);
  }
}

// ─────────────────────────────────────────────────────────────────────
//  FILTER SUGGESTIONS  (mirrors system.js setupFieldSuggestions)
// ─────────────────────────────────────────────────────────────────────
function setupFieldSuggestions(inputId, listId, getValues, options = {}) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const hidden = options.hiddenId
    ? document.getElementById(options.hiddenId)
    : null;

  // Remove any stale list from a previous call
  document.getElementById(listId)?.remove();

  const list = document.createElement("ul");
  list.id = listId;
  list.dataset.suggestionList = "1";
  list.dataset.ownerInput = inputId;
  list.style.cssText = `
    display:none;position:fixed;z-index:99999;
    background:#fff;border:1px solid #cbd5e1;
    border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15);
    list-style:none;margin:0;padding:0;
    max-height:260px;overflow:hidden;overflow-y:auto;min-width:160px;
  `;
  document.body.appendChild(list);

  let idx = -1;

  // ── helpers ──────────────────────────────────────────────────────
  function positionList() {
    const rect = input.getBoundingClientRect();
    list.style.top = rect.bottom + 4 + "px";
    list.style.left = rect.left + "px";
    list.style.width = Math.max(rect.width, 200) + "px";
  }

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

  function show(q) {
    const lower = q.trim().toLowerCase();
    const raw = getValues();

    // Build item list: header options first, then real values
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
      items.push({ display: toProperCase(v), raw: v });
    });

    // When user is typing, drop the header specials — show matches only
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
          const re = new RegExp(
            `(${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
          );
          hl = safeDisplay.replace(
            re,
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
          .forEach((l) => (l.style.background = l === li ? "#f0f9ff" : ""));
        idx = [...list.querySelectorAll("li")].indexOf(li);
      });
    });

    positionList();
    list.style.display = "block";
    idx = -1;
  }

  // ── event wiring ────────────────────────────────────────────────
  input.addEventListener("focus", () => show(input.value));
  input.addEventListener("click", () => show(input.value));

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (!list.contains(document.activeElement)) {
        list.style.display = "none";
        idx = -1;
      }
    }, 150);
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

  // Close when clicking outside
  if (input._vioOutsideClick) {
    document.removeEventListener("click", input._vioOutsideClick);
  }
  input._vioOutsideClick = (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) {
      list.style.display = "none";
      idx = -1;
    }
  };
  document.addEventListener("click", input._vioOutsideClick);
}

// ── Wire up each filter field ─────────────────────────────────────
function setupFilterSuggestions() {
  // Employee name — free-text with floating suggestions (no hidden partner)
  setupFieldSuggestions(
    "f_name",
    "vio-name-suggestions",
    () =>
      [
        ...new Map(
          allVio.map((v) => [
            (v.employee_name || "").toLowerCase(),
            v.employee_name,
          ]),
        ).values(),
      ].filter(Boolean),
    { onSelect: () => applyFilters() },
  );

  // Type — readonly display + hidden value (exact mirror of system.php fields)
  setupFieldSuggestions(
    "f_type_display",
    "vio-type-suggestions",
    () => allVio.map((v) => v.violation_type),
    {
      hiddenId: "f_type_val",
      noneLabel: "No Type",
      onSelect: () => applyFilters(),
    },
  );
}

function buildTypeSuggestions() {
  setupFilterSuggestions();
}

// ── Apply / clear ─────────────────────────────────────────────────
function applyFilters() {
  const name = document.getElementById("f_name").value.trim().toLowerCase();
  const typeRaw = document.getElementById("f_type_val").value;

  const from = (document.getElementById("f_from")?.value || "").trim();
  const to = (document.getElementById("f_to")?.value || "").trim();

  filteredVio = allVio.filter((v) => {
    if (name && !(v.employee_name || "").toLowerCase().includes(name))
      return false;

    if (typeRaw) {
      if (typeRaw === "__none__") {
        if ((v.violation_type || "").trim()) return false;
      } else {
        if (v.violation_type !== typeRaw) return false;
      }
    }

    if (from && (v.violation_date || "") < from) return false;
    if (to && (v.violation_date || "") > to) return false;

    return true;
  });

  currentPage = 1;
  renderTable();
  updateFilterStatus();
}

function clearFilters() {
  document.getElementById("f_name").value = "";
  document.getElementById("f_type_display").value = "";
  document.getElementById("f_type_val").value = "";

  if (typeof clearDateRange === "function") {
    clearDateRange();
  }

  document
    .querySelectorAll("ul[data-suggestion-list]")
    .forEach((ul) => (ul.style.display = "none"));

  const filterStatus = document.getElementById("filter-status");
  if (filterStatus) filterStatus.innerHTML = "";

  applyFilters();
}

function getActiveFilters() {
  const filters = {};
  const name = document.getElementById("f_name").value.trim();
  const typeVal = document.getElementById("f_type_val").value;
  const from = document.getElementById("f_from")?.value || "";
  const to = document.getElementById("f_to")?.value || "";
  if (name) filters["Employee"] = name;
  if (typeVal) filters["Type"] = typeVal === "__none__" ? "No Type" : typeVal;
  if (from) filters["Date from"] = from;
  if (to) filters["Date to"] = to;
  return filters;
}

function updateFilterStatus() {
  const el = document.getElementById("filter-status");
  if (!el) return;

  const filters = getActiveFilters();
  const active = Object.keys(filters).length > 0;

  if (!active) {
    el.innerHTML = "";
    return;
  }

  const filterInfo = document.createElement("div");
  filterInfo.style.cssText = `
    background:#e3f2fd;border-left:4px solid #2196F3;
    padding:12px 16px;margin-left:16px;border-radius:4px;
    font-size:14px;color:#1565c0;
    display:inline-flex;flex-wrap:wrap;justify-content:space-between;align-items:center;
  `;

  const label = document.createElement("span");
  label.style.cssText = "display:inline-flex;align-items:center;gap:8px;";

  const icon = document.createElement("i");
  icon.className = "fas fa-filter";
  label.appendChild(icon);

  const text = document.createElement("span");
  text.appendChild(document.createTextNode("Active Filters: "));

  Object.entries(filters).forEach(([key, value], i) => {
    if (i > 0) text.appendChild(document.createTextNode(" | "));
    const strong = document.createElement("strong");
    strong.textContent = `${key}:`;
    text.appendChild(strong);
    text.appendChild(document.createTextNode(` ${value}`));
  });

  label.appendChild(text);
  filterInfo.appendChild(label);

  el.innerHTML = "";
  el.appendChild(filterInfo);
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
      renderTable();
    });
  });
}

// ── Render table ──────────────────────────────────────────────────
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
  
  if (sortCol) {
    filteredVio.sort((a, b) => {
      let va = a[sortCol] ?? "";
      let vb = b[sortCol] ?? "";

      // Dates: compare as strings (ISO format sorts correctly)
      // Strings: locale-aware, case-insensitive
      const cmp =
        typeof va === "string" && typeof vb === "string"
          ? va.localeCompare(vb, undefined, { sensitivity: "base" })
          : va > vb
            ? 1
            : va < vb
              ? -1
              : 0;

      return sortDir === "asc" ? cmp : -cmp;
    });
  }

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
      <tr class="row">
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
        <td style="position:relative;width:160px;overflow:visible;">
          <button
            data-emp-id="${safeId}"
            class="actions-toggle-btn actions-item"
            tabindex="-1"
            onclick="toggleActionsPanel(this)">
            ACTIONS
          </button>

          <div class="actions-panel">
            <small style="background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);
                          text-align:center;color:#fff;">${safeFullname}</small>
            <button
              data-emp-id="${safeId}"
              data-name="${safeFullname}"
              data-type="${safeViolation}"
              class="view-delete"
              tabindex="-1"
              onclick="openDeleteFromBtn(this)">
              <i class="fas fa-trash-alt"></i> DELETE
            </button>
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

// ── Actions panel (identical to system.js) ────────────────────────
function toggleActionsPanel(btn) {
  const allPanels = document.querySelectorAll(".actions-panel");
  const allBtns = document.querySelectorAll(".actions-toggle-btn");
  const panel = btn.parentElement.querySelector(".actions-panel");
  const isOpen = panel.classList.contains("actions-open");

  allPanels.forEach((p) => {
    p.classList.remove("actions-open");
    p.style.display = "none";
    if (p._originalParent && p.parentElement === document.body) {
      p._originalParent.appendChild(p);
    }
  });
  allBtns.forEach((b) => b.classList.remove("actions-active"));

  if (isOpen) return;

  panel._originalParent = btn.parentElement;
  document.body.appendChild(panel);

  const rect = btn.getBoundingClientRect();
  const panelW = 160;
  const panelH = panel.scrollHeight || 180;

  let left = rect.right - panelW;
  left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));

  const top = rect.top >= panelH + 8 ? rect.top - panelH - 4 : rect.bottom + 4;

  panel.style.cssText += `
    position:fixed;
    top:${Math.round(top)}px;
    left:${Math.round(left)}px;
    width:${panelW}px;
    bottom:auto;
    transform:none;
    z-index:99999;
  `;

  panel.classList.add("actions-open");
  btn.classList.add("actions-active");
}

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
  openDeleteModal(btn.dataset.empId, btn.dataset.name, btn.dataset.type);
}

// ── Badges ────────────────────────────────────────────────────────
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

// ── Pagination ───────────────────────────────────────────────────
function renderPagination(totalPages) {
  const pg = document.getElementById("pagination");
  if (!pg) return;

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
    html += `<button class="page-num-btn ${currentPage === p ? "active" : ""}"
               tabindex="-1" onclick="goTo(${p})">${p}</button>`;
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

function previousPage() {
  if (currentPage > 1) {
    currentPage--;
    renderTable();
  }
}

function nextPage() {
  const totalPages = Math.ceil(filteredVio.length / PER_PAGE);
  if (currentPage < totalPages) {
    currentPage++;
    renderTable();
  }
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

// ── Delete ────────────────────────────────────────────────────────
function openDeleteModal(id, name, type) {
  closeAllActionsPanels();
  deleteTargetId = id;
  document.getElementById("deleteModalMessage").innerHTML =
    `Delete the <strong>${escapeHtml(type)}</strong> violation for
     <strong>${escapeHtml(name)}</strong>?
     <br><strong style="color:#d63031;">This cannot be undone.</strong>`;
  document.getElementById("deleteModal").style.display = "flex";
}

function closeModal() {
  document.getElementById("deleteModal").style.display = "none";
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
      headers: { "X-Requested-With": "XMLHttpRequest" },
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

// ── Utils ──────────────────────────────────────────────────────────────
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
      : { year: "numeric", month: "short", day: "numeric" };
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

function setControlButtonsDisabled(disabled) {
  const selectors = [".search-btn .btn", ".clear-btn .btn"];
  selectors.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.disabled = disabled;
    el.style.opacity = disabled ? "0.4" : "";
    el.style.cursor = disabled ? "not-allowed" : "";
  });
}

// ── Init ─────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async function () {
  const ready = await resolveEndpoints();
  if (!ready) return;

  initDateRangePicker();
  loadViolations();
  setupFilterSuggestions();
  bindSortHeaders();

  window.onDateRangeChange = function () {
    applyFilters();
  };
});
