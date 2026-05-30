<?php
// app/services/violation_log.php --> Violation Log Table

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code') && !canAccess($permissions, 'remarks')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('remarks', 'system.php');
$access = getMenuAccess();

$stats = [
  'total_violations'   => 0,
  'employees_affected' => 0,
  'this_month'         => 0,
];

if ($databaseConnected) {
  try {
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM violations");
    $stmt->execute();
    $stats['total_violations'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(DISTINCT employee_id) FROM violations");
    $stmt->execute();
    $stats['employees_affected'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare(
      "SELECT COUNT(*) FROM violations
       WHERE MONTH(violation_date) = MONTH(CURDATE())
         AND YEAR(violation_date)  = YEAR(CURDATE())"
    );
    $stmt->execute();
    $stats['this_month'] = $stmt->fetchColumn();
  } catch (PDOException $e) {
    error_log("Violation stats error: " . $e->getMessage());
  }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Remarks Log</title>
  <link rel="icon" href="../../resource/assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../../resource/css/system.css">
  <link rel="stylesheet" href="../../resource/css/ptl.css">
  <link rel="stylesheet" href="../../resource/css/modal.css">
  <link rel="stylesheet" href="../../resource/css/btn.css">
  <link rel="stylesheet" href="../../resource/css/pg.css">
  <link rel="stylesheet" href="../../resource/css/loading.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    /* ── Data table card ──────────────────────────────────────────── */
    .stat-dot {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
    }

    .stat-dot.total {
      background: rgba(255, 255, 255, .25);
    }

    .stat-dot.monthly {
      background: rgba(255, 220, 100, .35);
    }

    .stat-dot.people {
      background: rgba(100, 255, 180, .25);
    }

    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-red {
      background: #fff5f5;
      color: #c53030;
      border: 1px solid #fecaca;
    }

    .badge-warn {
      background: #fffbeb;
      color: #b7791f;
      border: 1px solid #fde68a;
    }

    .badge-green {
      background: #f0fff4;
      color: #276749;
      border: 1px solid #9ae6b4;
    }

    .badge-blue {
      background: #ebf8ff;
      color: #2b6cb0;
      border: 1px solid #bee3f8;
    }

    .desc-cell {
      max-width: 260px;
      word-break: break-word;
      line-height: 1.5;
      color: #4a5568;
    }

    /* ── Delete confirmation modal ────────────────────────────────── */
    .modal-overlay.open {
      display: flex;
    }

    .modal-footer {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .f-group {
      position: relative;
    }

    .f-group:has(input[type="date"]) {
      border-radius: 8px;
    }

    .f-group input[type="date"] {
      position: relative;
      z-index: 0;
    }

    .f-group input[type="date"]:focus {
      box-shadow: none;
      outline: none;
    }

    .f-group:has(input[type="date"]:focus) {
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
      border-radius: 8px;
    }

    .f-group input[type="date"]~.fl-label {
      top: 0;
      transform: translateY(-50%);
      font-size: 0.75rem;
      color: #667eea;
      background: linear-gradient(to bottom, transparent 52%, #fff 50%);
      z-index: 10;
      position: absolute;
    }
  </style>
</head>

<body>
  <div class="container">

    <!-- ── Controls ──────────────────────────────────────────────────── -->
    <div class="controls">
      <div class="search-row">
        <div class="search-group" style="position:relative;">
          <input type="text" id="f_name" placeholder="Employee name…"
            oninput="showNameSuggestions(this.value); applyFilters()"
            onkeydown="handleNameSuggestionNav(event)"
            onfocus="showNameSuggestions(this.value)"
            autocomplete="off"
            style="width:100%;">
          <ul id="name-suggestions" style="
            display:none;
            position:absolute;
            top:100%;
            left:0;
            right:0;
            z-index:9999;
            background:#fff;
            border:1px solid #cbd5e1;
            border-top:none;
            border-radius:0 0 8px 8px;
            box-shadow:0 4px 12px rgba(0,0,0,0.1);
            list-style:none;
            margin:0;
            padding:0;
            max-height:220px;
            overflow-y:auto;
          "></ul>
        </div>
        <div class="search-group">
          <select id="f_type" onchange="applyFilters()">
            <option value="">Default: ALL Types</option>
          </select>
        </div>
        <div class="search-group f-group">
          <input type="date" id="f_from" onchange="applyFilters()" title="Date from" placeholder=" ">
          <label class="fl-label" for="f_from">From</label>
        </div>
        <div class="search-group f-group">
          <input type="date" id="f_to" onchange="applyFilters()" title="Date to" placeholder=" ">
          <label class="fl-label" for="f_to">To</label>
        </div>
      </div>
      <div class="form-row-btn">
        <div class="form-row">
          <div>
            <button type="button" class="btn btn-primary" tabindex="-1" onclick="applyFilters()">
              <i class="fas fa-search"></i> Search
            </button>
          </div>
          <div>
            <button type="button" class="btn btn-secondary" tabindex="-1" onclick="clearFilters()">
              <i class="fas fa-search-minus"></i> Clear
            </button>
          </div>
          <div id="filter-status"></div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer"></div>

    <!-- ── Data table ─────────────────────────────────────────────── -->
    <div class="data-table">
      <div class="table-header">
        <h3>Remarks Records</h3>
        <div class="emp-records">
          <div style="display: flex; gap: 10px;">
            <div class="stat-dot total"><i class="fas fa-gavel" style="font-size:10px;"></i></div>
            <p>Total</p>
            <h3 id="statTotal"><?= $stats['total_violations'] ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-dot people"><i class="fas fa-users" style="font-size:10px;"></i></div>
            <p>Violators</p>
            <h3 id="statAffected"><?= $stats['employees_affected'] ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-dot monthly"><i class="fas fa-calendar-alt" style="font-size:10px;"></i></div>
            <p>This Month</p>
            <h3 id="statMonth"><?= $stats['this_month'] ?></h3>
          </div>
        </div>
      </div>

      <div class="table-scroll-wrap">
        <table>
          <thead>
            <tr>
              <th class="sn-cell">SN</th>
              <th>Employee</th>
              <th>Type</th>
              <th>Description</th>
              <th>Violation Date</th>
              <th>Recorded</th>
              <?php if (canAccess($permissions, 'delete-remarks')) : ?>
                <th>Actions</th>
              <?php endif; ?>
            </tr>
          </thead>
          <tbody id="violationTableBody">
            <tr>
              <td colspan="15" style="text-align:center;padding:40px;color:#aaa;">
                Loading…
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div id="no-data" class="no-data" style="display:none;">
        <div class="no-data-icon">📋</div>
        <h3>No Violation Records Found</h3>
        <p>Try adjusting your search criteria.</p>
      </div>
    </div>
  </div>

  <div class="pagination" id="pagination" style="display: none;">
    <button onclick="previousPage()" id="prev-btn"><i class="fas fa-arrow-left"></i> Previous</button>
    <span id="page-info">Page 1 of 1</span>
    <button onclick="nextPage()" id="next-btn">Next <i class="fas fa-arrow-right"></i></button>
  </div>

  <!-- ── Delete confirm modal ───────────────────────────────────────── -->
  <!-- <div class="modal-overlay" id="confirmModal">
    <div class="modal-delete-content">
      <h2><i class="fas fa-trash-alt" style="color:#e53e3e;"></i> Delete Violation</h2>
      <p id="confirmMsg">
        Are you sure you want to delete this violation record?
        <strong>This cannot be undone.</strong>
      </p>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeConfirm()">
          <i class="fas fa-times"></i> Cancel
        </button>
        <button class="btn btn-danger" id="confirmDeleteBtn" onclick="executeDelete()">
          <i class="fas fa-trash-alt"></i> Delete
        </button>
      </div>
    </div>
  </div> -->

  <!-- Delete Modal -->
  <div id="deleteModal" class="modal-overlay">
    <div class="modal-delete-content">
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <div class="modal-header">
        <h2 id="deleteModalTitle">Delete Remarks</h2>
      </div>
      <div class="modal-body">
        <p id="deleteModalMessage">Are you sure you want to delete this remarks?</p>
        <div id="confirmationContainer" style="display: none; margin-top: 20px;">
          <label for="confirmationInput" style="display: block; margin-bottom: 10px; font-weight: bold;">Type "DELETE ALL" to confirm:</label>
          <input type="text" id="confirmationInput" placeholder="Type DELETE ALL" style="margin-bottom: 10px;" />
        </div>
      </div>
      <button type="button" id="confirmDeleteBtn" class="btn btn-danger" tabindex="-1" onclick="executeDelete()">Delete</button>
      <button type="button" class="btn btn-secondary" tabindex="-1" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
    </div>
  </div>

  <script>
    window.PERMISSIONS = {
      delete: <?= json_encode(canAccess($permissions, 'delete-remarks')) ?>
    };
  </script>

  <script src="../../resource/js/btn.js"></script>
  <script>
    // ── State ────────────────────────────────────────────────────────────
    const BACKEND = 'violation_log_backend.php';
    let allVio = [];
    let filteredVio = [];
    let currentPage = 1;
    const PER_PAGE = 25;
    let deleteTargetId = null;

    function toProperCase(str) {
      if (!str) return "";
      return String(str).replace(/[^\s,\-]+/g, function(txt) {
        return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
      });
    }

    // ── Init ─────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', loadViolations);

    // ── Load ─────────────────────────────────────────────────────────────
    async function loadViolations() {
      try {
        const res = await fetch(`${BACKEND}?action=list`, {
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
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
        console.error('loadViolations:', e);
        showAlert('Failed to load violations.', 'error');
        showNoData();
      }
    }

    // ── Filters ───────────────────────────────────────────────────────────
    function buildTypeFilter() {
      const types = [...new Set(allVio.map(v => v.violation_type).filter(Boolean))].sort();
      const sel = document.getElementById('f_type');
      const cur = sel.value;
      sel.innerHTML = '<option value="">Default: ALL Types</option>';
      types.forEach(t => {
        const o = document.createElement('option');
        o.value = t;
        o.textContent = t;
        sel.appendChild(o);
      });
      if (cur) sel.value = cur;
    }

    // ── Fullname suggestions ─────────────────────────────────────────
    let nameSuggestionIndex = -1;

    function showNameSuggestions(query) {
      const list = document.getElementById('name-suggestions');
      if (!list) return;

      const q = query.trim().toLowerCase();

      const matches = [
        ...new Map(
          allVio
          .filter(v => !q || (v.employee_name || '').toLowerCase().includes(q))
          .map(v => [(v.employee_name || '').toLowerCase(), v.employee_name])
        ).values(),
      ].filter(Boolean);

      if (!matches.length || !q) {
        list.style.display = 'none';
        nameSuggestionIndex = -1;
        return;
      }

      list.innerHTML = matches.map((name, i) => {
        const safeName = esc(name);
        const properName = esc(toProperCase(name));
        const regex = new RegExp(
          `(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'
        );
        const highlighted = properName.replace(
          regex,
          '<mark style="background:#fef08a;border-radius:2px;">$1</mark>'
        );
        return `
      <li data-value="${properName}" data-index="${i}"
          onmousedown="selectNameSuggestion(this.dataset.value)"
          onmouseover="highlightNameSuggestion(${i})"
          style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #f1f5f9;">
        ${highlighted}
      </li>`;
      }).join('');

      list.style.display = 'block';
      nameSuggestionIndex = -1;
    }

    function selectNameSuggestion(name) {
      const input = document.getElementById('f_name');
      const list = document.getElementById('name-suggestions');
      if (input) input.value = name;
      if (list) list.style.display = 'none';
      nameSuggestionIndex = -1;
      applyFilters();
    }

    function highlightNameSuggestion(index) {
      const items = document.querySelectorAll('#name-suggestions li');
      items.forEach((li, i) => {
        li.style.background = i === index ? '#f0f9ff' : '';
      });
      nameSuggestionIndex = index;
    }

    function handleNameSuggestionNav(e) {
      const list = document.getElementById('name-suggestions');
      const items = list ? list.querySelectorAll('li') : [];
      if (!items.length || list.style.display === 'none') return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        nameSuggestionIndex = Math.min(nameSuggestionIndex + 1, items.length - 1);
        highlightNameSuggestion(nameSuggestionIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        nameSuggestionIndex = Math.max(nameSuggestionIndex - 1, 0);
        highlightNameSuggestion(nameSuggestionIndex);
      } else if (e.key === 'Enter' && nameSuggestionIndex >= 0) {
        e.preventDefault();
        selectNameSuggestion(items[nameSuggestionIndex].dataset.value);
      } else if (e.key === 'Escape') {
        list.style.display = 'none';
        nameSuggestionIndex = -1;
      }
    }

    document.addEventListener('click', function(e) {
      const list = document.getElementById('name-suggestions');
      const input = document.getElementById('f_name');
      if (list && input && !input.contains(e.target) && !list.contains(e.target)) {
        list.style.display = 'none';
        nameSuggestionIndex = -1;
      }
    });

    function applyFilters() {
      const name = document.getElementById('f_name').value.trim().toLowerCase();
      const type = document.getElementById('f_type').value;
      const from = document.getElementById('f_from').value;
      const to = document.getElementById('f_to').value;

      filteredVio = allVio.filter(v => {
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
      ['f_name', 'f_from', 'f_to'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      document.getElementById('f_type').selectedIndex = 0;
      applyFilters();
    }

    function updateFilterStatus() {
      const el = document.getElementById('filter-status');
      const name = document.getElementById('f_name').value.trim();
      const type = document.getElementById('f_type').value;
      const from = document.getElementById('f_from').value;
      const to = document.getElementById('f_to').value;
      const active = [name, type, from, to].some(Boolean);

      el.innerHTML = active ?
        `<span style="
              background:#e3f2fd;border-left:4px solid #2196F3;
              padding:6px 12px;border-radius:4px;font-size:12px;
              color:#1565c0;display:inline-flex;align-items:center;gap:6px;">
            <i class="fas fa-filter"></i> Filters active — ${filteredVio.length} record${filteredVio.length !== 1 ? 's' : ''}
           </span>` :
        '';
    }

    // ── Render ────────────────────────────────────────────────────────────
    function renderTable() {
      const tbody = document.getElementById('violationTableBody');
      const noData = document.getElementById('no-data');
      const pagination = document.getElementById('pagination');

      if (!filteredVio.length) {
        tbody.innerHTML = '';
        noData.style.display = 'block';
        pagination.style.display = 'none';
        return;
      }

      noData.style.display = 'none';

      const totalPages = Math.ceil(filteredVio.length / PER_PAGE);
      if (currentPage > totalPages) currentPage = totalPages;
      if (currentPage < 1) currentPage = 1;

      const start = (currentPage - 1) * PER_PAGE;
      const slice = filteredVio.slice(start, start + PER_PAGE);

      tbody.innerHTML = slice.map((v, i) => {
        const sn = start + i + 1;
        const badge = getBadgeClass(v.violation_type);
        const vDate = formatDate(v.violation_date);
        const created = formatDate(v.created_at, true);

        return `
          <tr>
            <td class="sn-cell">${sn}</td>
            <td>
              <div class="emp-name">${esc(v.employee_name || 'Unknown')}</div>
              <div class="emp-id"><strong>EMPID: ${esc(String(v.employee_id))}</strong></div>
            </td>
            <td><span class="badge ${badge}">${esc(v.violation_type || '—')}</span></td>
            <td class="desc-cell">${esc(v.violation_description || '—')}</td>
            <td><small>${vDate}</small></td>
            <td><small style="color:#aaa;">${created}</small></td>

            ${window.PERMISSIONS.delete ? `
            <td>
              <button
                class="btn btn-danger"
                tabindex="-1"
                style="padding:5px 12px;font-size:12px;"
                onclick="openConfirm(${v.id}, '${esc(v.employee_name || '')}', '${esc(v.violation_type || '')}')"
                title="Delete">
                <i class="fas fa-trash-alt"></i> Delete
              </button>
            </td>
            ` : ''}
          </tr>`;
      }).join('');

      renderPagination(totalPages);
    }

    function getBadgeClass(type) {
      if (!type) return 'badge-blue';
      const t = type.toLowerCase();
      if (t.includes('cleared')) return 'badge-green';
      if (['misconduct', 'insubordination', 'harassment', 'violence', 'theft', 'fraud']
        .some(k => t.includes(k))) return 'badge-red';
      if (['tardiness', 'absenteeism', 'absence', 'late', 'negligence', 'policy', 'updated', 'initial']
        .some(k => t.includes(k))) return 'badge-warn';
      return 'badge-blue';
    }

    function renderPagination(totalPages) {
      const pg = document.getElementById('pagination');

      if (totalPages <= 1) {
        pg.style.display = 'none';
        return;
      }

      pg.style.display = 'flex';

      const delta = 2;
      const range = new Set([1, totalPages]);
      for (let p = Math.max(2, currentPage - delta); p <= Math.min(totalPages - 1, currentPage + delta); p++) {
        range.add(p);
      }

      const sorted = [...range].sort((a, b) => a - b);
      let prev = null,
        html = '';

      html += `<button class="page-arrow-btn" tabindex="-1" onclick="goTo(${currentPage - 1})"
                 ${currentPage <= 1 ? 'disabled' : ''}>
                 <i class="fas fa-arrow-left"></i>
               </button>`;

      for (const p of sorted) {
        if (prev !== null && p - prev > 1) {
          html += `<span class="page-ellipsis">…</span>`;
        }
        html += `<button class="page-num-btn ${currentPage === p ? 'active' : ''}" tabindex="-1"
                   onclick="goTo(${p})">${p}</button>`;
        prev = p;
      }

      html += `<button class="page-arrow-btn" tabindex="-1" onclick="goTo(${currentPage + 1})"
                 ${currentPage >= totalPages ? 'disabled' : ''}>
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
      document.getElementById('violationTableBody').innerHTML = '';
      document.getElementById('no-data').style.display = 'block';
      document.getElementById('pagination').style.display = 'none';
    }

    function refreshStats() {
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth() + 1;

      document.getElementById('statTotal').textContent = allVio.length;
      document.getElementById('statAffected').textContent =
        new Set(allVio.map(v => v.employee_id)).size;
      document.getElementById('statMonth').textContent =
        allVio.filter(v => {
          if (!v.violation_date) return false;
          const [vy, vm] = v.violation_date.split('-').map(Number);
          return vy === y && vm === m;
        }).length;
    }

    // ── Delete ────────────────────────────────────────────────────────────
    function openConfirm(id, name, type) {
      deleteTargetId = id;
      document.getElementById('deleteModalMessage').innerHTML =
        `Delete the <strong>${esc(type)}</strong> violation for
         <strong>${esc(name)}</strong>?
         <strong>This cannot be undone.</strong>`;
      document.getElementById('deleteModal').classList.add('open');
    }

    function closeModal() {
      document.getElementById('deleteModal').classList.remove('open');
      deleteTargetId = null;
    }

    async function executeDelete() {
      if (!deleteTargetId) return;

      const fd = new FormData();
      fd.append('action', 'delete');
      fd.append('id', deleteTargetId);

      try {
        const res = await fetch(BACKEND, {
          method: 'POST',
          body: fd,
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
        });
        const data = await res.json();

        if (data.success) {
          showAlert(data.message || 'Deleted successfully.', 'success');
          closeModal();
          await loadViolations();
        } else {
          showAlert(data.message || 'Failed to delete.', 'error');
        }
      } catch (err) {
        console.error(err);
        showAlert('Server error.', 'error');
      }
    }

    document.getElementById('deleteModal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });

    // ── Utils ─────────────────────────────────────────────────────────────
    function esc(str) {
      return String(str ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatDate(str, withTime = false) {
      if (!str) return '—';
      try {
        const d = new Date(withTime ? str : str + 'T00:00:00');
        const opts = withTime ? {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        } : {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        };
        return d.toLocaleDateString('en-PH', opts);
      } catch {
        return str;
      }
    }

    function showAlert(msg, type = 'info') {
      document.querySelectorAll('.alert').forEach(a => a.remove());
      const a = document.createElement('div');
      a.className = `alert alert-${type}`;
      a.innerHTML = `${msg}
        <button onclick="this.parentElement.remove()"
          style="background:none;border:none;cursor:pointer;
                 margin-left:8px;font-size:16px;color:inherit;">×</button>`;
      document.body.appendChild(a);
      setTimeout(() => {
        if (a.parentElement) a.remove();
      }, 5000);
    }
  </script>
</body>

</html>