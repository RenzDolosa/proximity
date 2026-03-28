<?php
// system-log.php
require_once '../cnfg/config.php';

// ── AJAX handlers ────────────────────────────────────────────────────────────
if (isset($_GET['action'])) {
  header('Content-Type: application/json');

  if (($_SESSION['user_group'] ?? '') !== 'Administrator') {
    echo json_encode(['success' => false, 'message' => 'Access denied.']);
    exit;
  }

  try {
    $pdo = getMainDBConnection();

    // ── Fetch logs ─────────────────────────────────────────────────────────
    if ($_GET['action'] === 'fetch') {
      $where  = "WHERE 1=1";
      $params = [];

      if (!empty($_GET['search'])) {
        $where   .= " AND (sl.action LIKE :search OR sl.details LIKE :search2
                          OR sl.ip_address LIKE :search3 OR u.username LIKE :search4)";
        $like     = '%' . $_GET['search'] . '%';
        $params[':search']  = $like;
        $params[':search2'] = $like;
        $params[':search3'] = $like;
        $params[':search4'] = $like;
      }

      if (!empty($_GET['action_filter'])) {
        $where .= " AND sl.action = :action_filter";
        $params[':action_filter'] = $_GET['action_filter'];
      }

      $stmt = $pdo->prepare("
        SELECT sl.id,
               sl.user_id,
               COALESCE(u.username, 'System') AS username,
               sl.action,
               sl.details,
               sl.ip_address,
               sl.user_agent,
               sl.created_at
        FROM   system_logs sl
        LEFT   JOIN users u ON u.id = sl.user_id
        $where
        ORDER  BY sl.created_at DESC
      ");
      $stmt->execute($params);
      $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

      // Stats
      $statsStmt = $pdo->query("
        SELECT
          COUNT(*)                                              AS total,
          SUM(action = 'USER_LOGIN'  OR action = 'LOGIN')      AS logins,
          SUM(action LIKE '%UPDATED%')                          AS updates,
          SUM(action LIKE '%DELETED%')                          AS deletes
        FROM system_logs
      ");
      $stats = $statsStmt->fetch(PDO::FETCH_ASSOC);

      echo json_encode(['success' => true, 'logs' => $logs, 'stats' => $stats]);
      exit;
    }

    // ── Delete single ──────────────────────────────────────────────────────
    if ($_GET['action'] === 'delete' && isset($_GET['id'])) {
      $id   = (int) $_GET['id'];
      $stmt = $pdo->prepare("DELETE FROM system_logs WHERE id = :id");
      $stmt->execute([':id' => $id]);

      if ($stmt->rowCount()) {
        // logSystemAction($_SESSION['user_id'] ?? null, 'SYSTEM_LOG_DELETED', "Deleted log entry ID: $id");
        echo json_encode(['success' => true]);
      } else {
        echo json_encode(['success' => false, 'message' => 'Log not found.']);
      }
      exit;
    }

    // ── Delete all ─────────────────────────────────────────────────────────
    if ($_GET['action'] === 'delete_all') {
      $count = $pdo->query("SELECT COUNT(*) FROM system_logs")->fetchColumn();
      $pdo->exec("DELETE FROM system_logs");

      // logSystemAction($_SESSION['user_id'] ?? null, 'ALL_SYSTEM_LOGS_DELETED', "Deleted all system logs (total: $count)");
      echo json_encode(['success' => true, 'deleted' => $count]);
      exit;
    }

    echo json_encode(['success' => false, 'message' => 'Unknown action.']);
  } catch (PDOException $e) {
    error_log("system-log.php error: " . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
  }
  exit;
}

// ── Auth guard ────────────────────────────────────────────────────────────────
if (!isLoggedIn()) {
  header('Location: ../../portal.php');
  exit;
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>System Logs</title>
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/btn.css">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet" />
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f0f2f5;
      color: #333;
      min-height: 100vh;
      padding: 20px;
    }

    /* ── Toolbar ── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      background: #e9ecef;
      padding: 12px 16px;
      border-radius: 8px 8px 0 0;
      border-bottom: 1px solid #dee2e6;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border: none;
      border-radius: 5px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: filter .15s, transform .1s;
      white-space: nowrap;
    }

    .btn:hover {
      filter: brightness(.9);
    }

    .btn:active {
      transform: scale(.97);
    }

    .btn:disabled {
      opacity: .6;
      cursor: not-allowed;
    }

    .btn-search {
      background: #6c757d;
      color: #fff;
    }

    .btn-clear {
      background: #343a40;
      color: #fff;
    }

    .btn-delete-all {
      background: #fd7e6a;
      color: #fff;
      margin-left: auto;
    }

    /* ── Panel ── */
    .panel {
      background: #fff;
      border-radius: 0 0 8px 8px;
      overflow: hidden;
      box-shadow: 0 2px 12px rgba(0, 0, 0, .08);
    }

    /* ── Stats header ── */
    .stats-header {
      background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 40%, #5b21b6 100%);
      padding: 12px 18px;
      display: flex;
      align-items: center;
      gap: 28px;
      flex-wrap: wrap;
    }

    .stats-title {
      color: #fff;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: .3px;
      margin-right: 10px;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 7px;
      color: #fff;
      font-size: 13px;
      font-weight: 500;
    }

    .stat-item i {
      font-size: 14px;
      opacity: .85;
    }

    /* ── Auto-refresh indicator ── */
    .refresh-indicator {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-left: auto;
      color: rgba(255, 255, 255, .75);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }

    /* Animated pulse dot */
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
      box-shadow: 0 0 0 0 rgba(74, 222, 128, .7);
      animation: pulse-ring 2s ease-in-out infinite;
      flex-shrink: 0;
    }

    /* Dim the dot while a modal is open */
    .pulse-dot.paused {
      background: #9ca3af;
      box-shadow: none;
      animation: none;
    }

    @keyframes pulse-ring {
      0% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, .7);
      }

      70% {
        box-shadow: 0 0 0 7px rgba(74, 222, 128, 0);
      }

      100% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
      }
    }

    /* Thin countdown bar just below the stats strip */
    .countdown-bar-wrap {
      height: 3px;
      background: rgba(255, 255, 255, .15);
      overflow: hidden;
    }

    .countdown-bar {
      height: 100%;
      background: rgba(255, 255, 255, .55);
      width: 100%;
      transition: width 1s linear;
    }

    /* ── Table ── */
    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    thead tr {
      background: #f8f9fa;
      border-bottom: 2px solid #e9ecef;
    }

    th {
      padding: 11px 14px;
      text-align: left;
      font-weight: 600;
      color: #495057;
      white-space: nowrap;
    }

    tbody tr {
      border-bottom: 1px solid #f0f0f0;
      transition: background .12s;
    }

    tbody tr:hover {
      background: #fafafa;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    td {
      padding: 10px 14px;
      color: #555;
      vertical-align: middle;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 12px;
      font-size: 11.5px;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-login {
      background: #d1fae5;
      color: #065f46;
    }

    .badge-logout {
      background: #fee2e2;
      color: #991b1b;
    }

    .badge-create {
      background: #dbeafe;
      color: #1e40af;
    }

    .badge-update {
      background: #fef3c7;
      color: #92400e;
    }

    .badge-delete {
      background: #ffe4e6;
      color: #9f1239;
    }

    .badge-default {
      background: #e5e7eb;
      color: #374151;
    }

    .details-cell {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #7c3aed, #a78bfa);
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .user-cell {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    /* Action buttons */
    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: filter .15s;
    }

    .action-btn:hover {
      filter: brightness(.88);
    }

    .btn-view-log {
      background: #6d28d9;
      color: #fff;
    }

    .btn-del-log {
      background: #ef4444;
      color: #fff;
    }

    /* ── Pagination ── */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      padding: 12px 16px;
      border-top: 1px solid #f0f0f0;
      font-size: 13px;
      color: #888;
    }

    .page-btn {
      width: 30px;
      height: 30px;
      border-radius: 5px;
      border: 1px solid #dee2e6;
      background: #fff;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background .15s;
    }

    .page-btn.active {
      background: #7c3aed;
      color: #fff;
      border-color: #7c3aed;
    }

    .page-btn:hover:not(.active) {
      background: #f0f0f0;
    }

    /* Empty / loading state */
    .empty-row td {
      text-align: center;
      padding: 36px;
      color: #adb5bd;
      font-style: italic;
    }

    /* Spinner */
    .spinner {
      display: inline-block;
      width: 18px;
      height: 18px;
      border: 2px solid #c4b5fd;
      border-top-color: #7c3aed;
      border-radius: 50%;
      animation: spin .7s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Modals */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, .45);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }

    .modal-overlay.show {
      display: flex;
    }

    .modal-box {
      background: #fff;
      border-radius: 10px;
      padding: 24px 24px 18px;
      width: 460px;
      max-width: 96vw;
      box-shadow: 0 10px 40px rgba(0, 0, 0, .2);
      animation: pop .2s ease;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-box.confirm {
      width: 380px;
      text-align: center;
    }

    @keyframes pop {
      from {
        transform: scale(.9);
        opacity: 0;
      }

      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    .modal-box h3 {
      font-size: 17px;
      margin-bottom: 10px;
      color: #1f2937;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .modal-box h3 i {
      color: #ef4444;
    }

    .modal-box p {
      font-size: 13.5px;
      color: #6b7280;
      margin-bottom: 22px;
    }

    /* View modal detail grid */
    .log-detail-grid {
      display: grid;
      gap: 10px;
      margin-bottom: 22px;
    }

    .log-detail-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 8px;
      font-size: 13px;
    }

    .log-detail-row .ldr-label {
      font-weight: 600;
      color: #374151;
    }

    .log-detail-row .ldr-val {
      color: #555;
      word-break: break-word;
    }

    .log-detail-row .ldr-val .badge {
      font-size: 12px;
    }

    .modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    .modal-actions button {
      padding: 8px 18px;
      border: none;
      border-radius: 5px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-cancel-modal {
      background: #e5e7eb;
      color: #374151;
    }

    .btn-confirm-modal {
      background: #ef4444;
      color: #fff;
    }

    /* Toast */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1f2937;
      color: #fff;
      padding: 12px 20px;
      border-radius: 7px;
      font-size: 13px;
      font-weight: 500;
      opacity: 0;
      transform: translateY(10px);
      transition: all .3s;
      z-index: 2000;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    .toast i {
      color: #34d399;
    }

    .toast.error i {
      color: #f87171;
    }
  </style>
</head>

<body>

  <div id="closeButton"></div>

  <!-- ── Toolbar ────────────────────────────────────────────────────────────── -->
  <div class="toolbar">
    <button class="btn btn-search" onclick="loadLogs()">
      <i class="fas fa-search"></i> Search
    </button>
    <button class="btn btn-clear" onclick="clearSearch()">
      <i class="fas fa-times"></i> Clear
    </button>

    <input id="searchInput" type="text"
      placeholder="Search action, user, IP, details…"
      oninput="debounceLoad()"
      style="padding:6px 12px;border:1px solid #ccc;border-radius:5px;font-size:13px;width:220px;">

    <select id="actionFilter" onchange="loadLogs()"
      style="padding:6px 10px;border:1px solid #ccc;border-radius:5px;font-size:13px;">
      <option value="">All Actions</option>
      <option value="LOGIN">LOGIN</option>
      <option value="USER_LOGIN">USER_LOGIN</option>
      <option value="LOGOUT">LOGOUT</option>
      <option value="USER_LOGOUT">USER_LOGOUT</option>
      <option value="USER_REGISTERED">USER_REGISTERED</option>
      <option value="EMPLOYEE_CREATED">EMPLOYEE_CREATED</option>
      <option value="EMPLOYEE_UPDATED">EMPLOYEE_UPDATED</option>
      <option value="EMPLOYEE_DELETED">EMPLOYEE_DELETED</option>
      <option value="ALL_EMPLOYEES_DELETED">ALL_EMPLOYEES_DELETED</option>
      <option value="SYSTEM_LOG_DELETED">SYSTEM_LOG_DELETED</option>
      <option value="ALL_SYSTEM_LOGS_DELETED">ALL_SYSTEM_LOGS_DELETED</option>
    </select>

    <button class="btn btn-delete-all" onclick="confirmDeleteAll()">
      <i class="fas fa-trash"></i> Delete All Data
    </button>
  </div>

  <!-- ── Panel ─────────────────────────────────────────────────────────────── -->
  <div class="panel">

    <!-- Stats + live indicator -->
    <div class="stats-header">
      <span class="stats-title">System Logs</span>
      <span class="stat-item">
        <i class="fas fa-list"></i>
        Total Logs <strong id="statTotal">—</strong>
      </span>
      <span class="stat-item">
        <i class="fas fa-sign-in-alt"></i>
        Logins <strong id="statLogins">—</strong>
      </span>
      <span class="stat-item">
        <i class="fas fa-user-edit"></i>
        Updates <strong id="statUpdates">—</strong>
      </span>
      <span class="stat-item">
        <i class="fas fa-trash-alt"></i>
        Deletions <strong id="statDeletes">—</strong>
      </span>

      <!-- Live auto-refresh indicator (no button, purely informational) -->
      <span class="refresh-indicator">
        <span class="pulse-dot" id="pulseDot"></span>
        Live <!-- · refreshes in <strong id="countdownNum">10</strong>s -->
      </span>
    </div>

    <!-- Thin countdown progress bar -->
    <div class="countdown-bar-wrap">
      <div class="countdown-bar" id="countdownBar"></div>
    </div>

    <!-- Table -->
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>SN</th>
            <th>User</th>
            <th>Action</th>
            <th>Details</th>
            <th>IP Address</th>
            <th>User Agent</th>
            <th>Created At</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="logTableBody">
          <tr class="empty-row">
            <td colspan="8">
              <span class="spinner"></span> Loading logs…
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination" id="paginationWrap"></div>
  </div>



  <!-- ── View Log Modal ─────────────────────────────────────────────────────── -->
  <div class="modal-overlay" id="viewModal">
    <div class="modal-box">
      <h3><i class="fas fa-info-circle" style="color:#6d28d9"></i> Log Details</h3>
      <div class="log-detail-grid" id="viewModalContent"></div>
      <div class="modal-actions">
        <button class="btn-cancel-modal" onclick="closeModal('viewModal')">Close</button>
      </div>
    </div>
  </div>

  <!-- ── Delete All Modal ───────────────────────────────────────────────────── -->
  <div class="modal-overlay" id="deleteAllModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Confirm Delete All</h3>
      <p id="deleteAllConfirmMsg">Are you sure you want to delete <strong>all system log records</strong>?
        This action <strong>cannot be undone</strong>.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-cancel-modal" onclick="closeModal('deleteAllModal')">Cancel</button>
        <button class="btn-confirm-modal" id="btnConfirmDeleteAll" onclick="deleteAll()">
          <i class="fas fa-trash"></i> Yes, Delete All
        </button>
      </div>
    </div>
  </div>

  <!-- ── Delete Single Modal ────────────────────────────────────────────────── -->
  <div class="modal-overlay" id="deleteSingleModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Confirm Delete</h3>
      <p id="deleteSingleConfirmMsg">Delete this log entry? This action <strong>cannot be undone</strong>.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-cancel-modal" onclick="closeModal('deleteSingleModal')">Cancel</button>
        <button class="btn-confirm-modal" id="btnConfirmDelete" onclick="deleteSingle()">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  </div>

  <!-- ── Toast ──────────────────────────────────────────────────────────────── -->
  <div class="toast" id="toast">
    <i class="fas fa-check-circle" id="toastIcon"></i>
    <span id="toastMsg">Done</span>
  </div>

  <script src="../src/btn.js"></script>
  <script>
    /* ── Config ── */
    const AUTO_REFRESH_INTERVAL = 10; // seconds

    /* ── Avatar color palette (matches config.php user IDs cycling) ── */
    const COLORS = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922', '#BA7517'];

    /* ── State ── */
    let allLogs = [];
    let currentPage = 1;
    const PER_PAGE = 10;
    let pendingDeleteId = null;
    let debounceTimer = null;
    let modalOpen = false;

    /* ── Auto-refresh countdown ── */
    let countdownLeft = AUTO_REFRESH_INTERVAL;
    let countdownTick = null; // 1-second ticker
    let autoRefreshTimer = null; // fires the actual fetch

    function startCountdown() {
      stopCountdown();
      countdownLeft = AUTO_REFRESH_INTERVAL;
      updateCountdownUI();

      // Tick every second to update the bar + number
      countdownTick = setInterval(() => {
        if (modalOpen) return; // freeze while a modal is open
        countdownLeft = Math.max(0, countdownLeft - 1);
        updateCountdownUI();
      }, 1000);

      // Fire the actual refresh after the full interval
      autoRefreshTimer = setTimeout(async () => {
        if (!modalOpen) {
          await loadLogs(true); // silent=true → no spinner
        }
        startCountdown(); // restart cycle
      }, AUTO_REFRESH_INTERVAL * 1000);
    }

    function stopCountdown() {
      clearInterval(countdownTick);
      clearTimeout(autoRefreshTimer);
    }

    function updateCountdownUI() {
      const pct = (countdownLeft / AUTO_REFRESH_INTERVAL) * 100;
      document.getElementById('countdownBar').style.width = pct + '%';

      const dot = document.getElementById('pulseDot');
      dot.classList.toggle('paused', modalOpen);
    }

    /* ── Badge helper ── */
    function badgeClass(action) {
      const a = action.toUpperCase();
      if (a.includes('LOGIN') && !a.includes('OUT')) return 'badge-login';
      if (a.includes('LOGOUT') || a.includes('_OUT')) return 'badge-logout';
      if (a.includes('CREATED') || a.includes('REGISTERED')) return 'badge-create';
      if (a.includes('UPDATED')) return 'badge-update';
      if (a.includes('DELETED')) return 'badge-delete';
      return 'badge-default';
    }

    /* ── Stable string hash (djb2) for consistent avatar colors ── */
    function hashStr(str) {
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        hash = (hash * 33) ^ str.charCodeAt(i);
      }
      return hash >>> 0; // unsigned 32-bit
    }

    /* ── Render table ── */
    function renderTable() {
      const tbody = document.getElementById('logTableBody');
      const total = allLogs.length;
      const pages = Math.max(1, Math.ceil(total / PER_PAGE));
      if (currentPage > pages) currentPage = pages;

      const slice = allLogs.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

      if (!slice.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">
          <i class="fas fa-inbox" style="font-size:24px;display:block;margin-bottom:6px;opacity:.4"></i>
          No log records found.
        </td></tr>`;
        document.getElementById('paginationWrap').innerHTML = '';
        return;
      }

      // buttons are shown for every row so admins can inspect or remove any entry.
      tbody.innerHTML = slice.map((log, i) => {
        const idx = (currentPage - 1) * PER_PAGE + i;
        const colorKey = log.user_id ? log.user_id : log.username;
        const color = COLORS[Math.abs(hashStr(String(colorKey))) % COLORS.length];
        const initial = (log.username[0] || '?').toUpperCase();
        return `
        <tr>
          <td>${idx + 1}</td>
          <td>
            <div class="user-cell">
              <div class="avatar" style="background:${color}">${initial}</div>
              <span>${escHtml(log.username || '—')}</span>
            </div>
          </td>
          <td><span class="badge ${badgeClass(log.action)}">${escHtml(log.action)}</span></td>
          <td class="details-cell" title="${escHtml(log.details || '')}">${escHtml(log.details || '—')}</td>
          <td>${escHtml(log.ip_address || '—')}</td>
          <td class="details-cell" title="${escHtml(log.user_agent || '')}">${escHtml(log.user_agent || '—')}</td>
          <td>${escHtml(log.created_at || '—')}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="action-btn btn-view-log" onclick="viewLog(${log.id})">
              <i class="fas fa-eye"></i> View
            </button>
            <button class="action-btn btn-del-log" onclick="confirmDeleteSingle(${log.id}, '${escHtml(log.username || 'this entry')}')">
              <i class="fas fa-trash"></i> Delete
            </button>
          </td>
        </tr>
        `;
      }).join('');

      /* Pagination buttons */
      const pgWrap = document.getElementById('paginationWrap');
      pgWrap.innerHTML = `<span>${total} record${total !== 1 ? 's' : ''}</span>` +
        Array.from({
            length: pages
          }, (_, i) =>
          `<button class="page-btn${currentPage === i + 1 ? ' active' : ''}"
                   onclick="goPage(${i + 1})">${i + 1}</button>`
        ).join('');
    }

    function goPage(p) {
      currentPage = p;
      renderTable();
    }

    /* ── Update stats bar ── */
    function updateStats(stats) {
      document.getElementById('statTotal').textContent = stats.total ?? 0;
      document.getElementById('statLogins').textContent = stats.logins ?? 0;
      document.getElementById('statUpdates').textContent = stats.updates ?? 0;
      document.getElementById('statDeletes').textContent = stats.deletes ?? 0;
    }

    /* ── Load logs from server ──
         silent=true  → keep existing rows visible (background refresh)
         silent=false → show spinner (first load / manual search)           */
    async function loadLogs(silent = false) {
      const search = document.getElementById('searchInput').value.trim();
      const action = document.getElementById('actionFilter').value;

      const params = new URLSearchParams({
        action: 'fetch'
      });
      if (search) params.append('search', search);
      if (action) params.append('action_filter', action);

      if (!silent) {
        document.getElementById('logTableBody').innerHTML =
          `<tr class="empty-row"><td colspan="8"><span class="spinner"></span> Loading…</td></tr>`;
      }

      try {
        const res = await fetch(`?${params.toString()}`);
        const data = await res.json();

        if (!data.success) throw new Error(data.message || 'Fetch failed');

        allLogs = data.logs;
        renderTable();
        updateStats(data.stats);
      } catch (err) {
        if (!silent) {
          showToast('Failed to load logs: ' + err.message, true);
          document.getElementById('logTableBody').innerHTML =
            `<tr class="empty-row"><td colspan="8">
              <i class="fas fa-exclamation-circle" style="color:#ef4444"></i>
              ${escHtml(err.message)}
            </td></tr>`;
        }
        // On a silent refresh error, just skip quietly — don't disrupt the user
      }
    }

    /* ── Debounced search ───────────────────────────────────────────────────── */
    function debounceLoad() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentPage = 1;
        stopCountdown(); // reset cycle on manual search
        loadLogs().then(startCountdown);
      }, 400);
    }

    function clearSearch() {
      document.getElementById('searchInput').value = '';
      document.getElementById('actionFilter').value = '';
      currentPage = 1;
      stopCountdown();
      loadLogs().then(startCountdown);
    }

    /* ── View modal ─────────────────────────────────────────────────────────── */
    function viewLog(id) {
      const log = allLogs.find(l => +l.id === +id);
      if (!log) return;

      document.getElementById('viewModalContent').innerHTML = `
        <div class="log-detail-row">
          <span class="ldr-label">Log ID</span>
          <span class="ldr-val">#${escHtml(String(log.id))}</span>
        </div>
        <div class="log-detail-row">
          <span class="ldr-label">User</span>
          <span class="ldr-val">${escHtml(log.username || '—')} (ID: ${escHtml(String(log.user_id || '—'))})</span>
        </div>
        <div class="log-detail-row">
          <span class="ldr-label">Action</span>
          <span class="ldr-val"><span class="badge ${badgeClass(log.action)}">${escHtml(log.action)}</span></span>
        </div>
        <div class="log-detail-row">
          <span class="ldr-label">Details</span>
          <span class="ldr-val">${escHtml(log.details || '—')}</span>
        </div>
        <div class="log-detail-row">
          <span class="ldr-label">IP Address</span>
          <span class="ldr-val">${escHtml(log.ip_address || '—')}</span>
        </div>
        <div class="log-detail-row">
          <span class="ldr-label">User Agent</span>
          <span class="ldr-val">${escHtml(log.user_agent || '—')}</span>
        </div>
        <div class="log-detail-row">
          <span class="ldr-label">Created At</span>
          <span class="ldr-val">${escHtml(log.created_at || '—')}</span>
        </div>
      `;
      openModal('viewModal');
    }

    /* ── Delete single ── */
    // FIX: Added `username` parameter — was previously referencing an undefined variable.
    function confirmDeleteSingle(id, username) {
      pendingDeleteId = id;
      document.getElementById('deleteSingleConfirmMsg').innerHTML =
        `Delete log entry for <strong>${escHtml(username)}</strong>? This cannot be undone.`;
      openModal('deleteSingleModal');
    }

    async function deleteSingle() {
      if (!pendingDeleteId) return;

      const btn = document.getElementById('btnConfirmDelete');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';

      try {
        const res = await fetch(`?action=delete&id=${pendingDeleteId}`);
        const data = await res.json();

        if (!data.success) throw new Error(data.message || 'Delete failed');

        pendingDeleteId = null;
        closeModal('deleteSingleModal');
        showToast('Log entry deleted successfully.');
        stopCountdown();
        await loadLogs();
        startCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    }

    /* ── Delete all ── */
    function confirmDeleteAll() {
      openModal('deleteAllModal');
    }

    async function deleteAll() {
      const btn = document.getElementById('btnConfirmDeleteAll');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';

      try {
        // FIX: Was using single-quotes preventing template literal interpolation,
        //      and referencing undefined `pendingDelId`. delete_all needs no ID.
        const res = await fetch(`?action=delete_all`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Delete all failed');

        closeModal('deleteAllModal');
        showToast(`All log records deleted (${data.deleted} total).`);
        stopCountdown();
        await loadLogs();
        startCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Yes, Delete All';
      }
    }

    /* ── Modal helpers ──────────────────────────────────────────────────────── */
    function openModal(id) {
      modalOpen = true;
      document.getElementById(id).classList.add('show');
      updateCountdownUI(); // dim pulse dot immediately
    }

    // FIX: `id` was missing from the function signature — closeModal() calls
    //      with an argument were silently passing `undefined` to getElementById.
    function closeModal(id) {
      document.getElementById(id).classList.remove('show');
      modalOpen = false;
      updateCountdownUI(); // restore pulse dot
    }

    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target === el) closeModal(el.id);
      });
    });

    /* ── Toast ──────────────────────────────────────────────────────────────── */
    let toastTimer = null;

    function showToast(msg, isError = false) {
      const t = document.getElementById('toast');
      const icon = document.getElementById('toastIcon');
      document.getElementById('toastMsg').textContent = msg;
      icon.className = isError ? 'fas fa-times-circle' : 'fas fa-check-circle';
      t.classList.toggle('error', isError);
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
    }

    /* ── Escape HTML ────────────────────────────────────────────────────────── */
    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /* ── Initial load + start auto-refresh ── */
    loadLogs().then(startCountdown);
  </script>

</body>

</html>