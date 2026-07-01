// resource/js/pagination.js --> paginations

let currentPage = 1;
const itemsPerPage = 25;
let totalPages = 1;

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

// ── Per-tab pagination state ──────────────────────────────────────────────────
const _tabPagination = {
  access: { page: 1, limit: 25 },
  status: { page: 1, limit: 25 },
  remarks: { page: 1, limit: 25 },
};

// ── Shared pagination renderer ────────────────────────────────────────────────
function _renderTabPagination(
  containerId,
  tab,
  employeeId,
  total,
  page,
  limit,
) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const totalPages = Math.ceil(total / limit);

  if (totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  const delta = 2;
  const range = new Set([1, totalPages]);
  for (
    let i = Math.max(2, page - delta);
    i <= Math.min(totalPages - 1, page + delta);
    i++
  ) {
    range.add(i);
  }

  const sorted = [...range].sort((a, b) => a - b);
  let prev = null;
  let buttonsHTML = "";

  for (const p of sorted) {
    if (prev !== null && p - prev > 1) {
      buttonsHTML += `<span style="padding:0 4px;color:#94a3b8;align-self:center;">…</span>`;
    }
    buttonsHTML += `
      <button
        tabindex="-1"
        onclick="_goToTabPage('${tab}','${employeeId}',${p})"
        style="min-width:30px;height:30px;border-radius:6px;border:1px solid ${p === page ? "#3b82f6" : "#e2e8f0"};
               background:${p === page ? "#3b82f6" : "#fff"};color:${p === page ? "#fff" : "#374151"};
               font-size:12px;font-weight:600;cursor:${p === page ? "default" : "pointer"};padding:0 6px;">
        ${p}
      </button>`;
    prev = p;
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;justify-content:center;padding:12px 0 4px;flex-wrap:wrap;">
      <button
        tabindex="-1"
        onclick="_goToTabPage('${tab}','${employeeId}',${page - 1})"
        ${page <= 1 ? "disabled" : ""}
        style="min-width:30px;height:30px;border-radius:6px;border:1px solid #e2e8f0;
               background:#fff;color:#374151;font-size:12px;cursor:${page <= 1 ? "not-allowed" : "pointer"};
               opacity:${page <= 1 ? "0.4" : "1"};padding:0 8px;">
        ‹
      </button>
      ${buttonsHTML}
      <button
        tabindex="-1"
        onclick="_goToTabPage('${tab}','${employeeId}',${page + 1})"
        ${page >= totalPages ? "disabled" : ""}
        style="min-width:30px;height:30px;border-radius:6px;border:1px solid #e2e8f0;
               background:#fff;color:#374151;font-size:12px;cursor:${page >= totalPages ? "not-allowed" : "pointer"};
               opacity:${page >= totalPages ? "0.4" : "1"};padding:0 8px;">
        ›
      </button>
      <span style="font-size:11px;color:#94a3b8;margin-left:4px;">
        ${total} total &nbsp;|&nbsp; Page ${page} of ${totalPages}
      </span>
    </div>`;
}

function _goToTabPage(tab, employeeId, page) {
  const state = _tabPagination[tab];
  if (!state) return;
  const total = _getTabTotal(tab, employeeId);
  const totalPages = Math.ceil(total / state.limit);
  if (page < 1 || page > totalPages) return;
  state.page = page;

  const content = document.getElementById("logsTabContent");
  if (!content) return;

  if (tab === "access") _renderAccessTab(content, employeeId);
  if (tab === "status") _renderStatusTab(content, employeeId);
  if (tab === "remarks") _renderRemarksTab(content, employeeId);
}

function _getTabTotal(tab, employeeId) {
  if (tab === "access") return (_logsCache[employeeId] || []).length;
  if (tab === "status") return (_statusHistoryCache[employeeId] || []).length;
  if (tab === "remarks") return (_remarksCache[employeeId] || []).length;
  return 0;
}