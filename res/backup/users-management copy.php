<?php
// users_management.php
require_once '../cnfg/config.php';

// ── AJAX handlers ────────────────────────────────────────────────────────────
if (isset($_GET['action'])) {
  header('Content-Type: application/json');

  try {
    $pdo = getMainDBConnection();

    // ── Administrator guard – applies to ALL mutating actions ─────────────────
    if (($_SESSION['user_group'] ?? '') !== 'Administrator') {
      echo json_encode(['success' => false, 'message' => 'Access denied. Administrators only.']);
      exit;
    }

    // ── Fetch users ───────────────────────────────────────────────────────────
    if ($_GET['action'] === 'fetch') {
      $where  = "WHERE 1=1";
      $params = [];

      if (!empty($_GET['search_user'])) {
        $where .= " AND username LIKE :search_user";
        $params[':search_user'] = '%' . $_GET['search_user'] . '%';
      }

      if (!empty($_GET['search_email'])) {
        $where .= " AND email LIKE :search_email";
        $params[':search_email'] = '%' . $_GET['search_email'] . '%';
      }

      $stmt = $pdo->prepare("
        SELECT id, username, email, first_name, last_name,
               phone, my_database, user_group, created_at, last_login
        FROM   users
        $where
        ORDER  BY id ASC
      ");
      $stmt->execute($params);
      $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

      $stats = $pdo->query("
        SELECT
          COUNT(*)                    AS total,
          SUM(last_login IS NOT NULL) AS logged_in,
          SUM(last_login IS NULL)     AS never_logged
        FROM users
      ")->fetch(PDO::FETCH_ASSOC);

      echo json_encode(['success' => true, 'users' => $users, 'stats' => $stats]);
      exit;
    }

    // ── Add user ──────────────────────────────────────────────────────────────
    if ($_GET['action'] === 'add') {
      $data = json_decode(file_get_contents('php://input'), true);

      $username   = sanitizeInput($data['username']    ?? '');
      $email      = sanitizeInput($data['email']       ?? '');
      $password   = $data['password'] ?? '';
      $first_name = sanitizeInput($data['first_name']  ?? '');
      $last_name  = sanitizeInput($data['last_name']   ?? '');
      $phone      = sanitizeInput($data['phone']       ?? '');
      $my_db      = sanitizeInput($data['my_database'] ?? '');
      $user_group = sanitizeInput($data['user_group']  ?? '');

      $allowedGroups = ['Administrator', 'Employee', 'HR'];

      $errors = [];
      if (strlen($username) < 3)                        $errors[] = 'Username must be at least 3 characters.';
      if (!isValidEmail($email))                        $errors[] = 'Invalid email address.';
      if (!isValidPassword($password))                  $errors[] = 'Password: 8+ chars, uppercase, lowercase, number.';
      if (!$first_name || !$last_name)                  $errors[] = 'First and last name are required.';
      if (!$my_db)                                      $errors[] = 'My database name is required.';
      if (!in_array($user_group, $allowedGroups, true)) $errors[] = 'Invalid user group selected.';

      if ($errors) {
        echo json_encode(['success' => false, 'errors' => $errors]);
        exit;
      }

      $chk = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = ? OR email = ?");
      $chk->execute([$username, $email]);
      if ($chk->fetchColumn() > 0) {
        echo json_encode(['success' => false, 'errors' => ['Username or email already exists.']]);
        exit;
      }

      $hashed = password_hash($password, PASSWORD_DEFAULT);

      $stmt = $pdo->prepare("
        INSERT INTO users (username, email, password, first_name, last_name, phone, my_database, user_group, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ");
      $stmt->execute([$username, $email, $hashed, $first_name, $last_name, $phone ?: null, $my_db, $user_group]);
      $newId = $pdo->lastInsertId();

      createUserDatabase($newId);
      logSystemAction($_SESSION['user_id'] ?? null, 'USER_REGISTERED', "Admin created user: $username (ID: $newId)");
      echo json_encode(['success' => true, 'message' => 'User added successfully.', 'id' => $newId]);
      exit;
    }

    // ── Get single user (for edit pre-fill) ───────────────────────────────────
    if ($_GET['action'] === 'get' && isset($_GET['id'])) {
      $id   = (int) $_GET['id'];
      $stmt = $pdo->prepare("
        SELECT id, username, email, first_name, last_name, phone, my_database, user_group
        FROM   users WHERE id = ?
      ");
      $stmt->execute([$id]);
      $user = $stmt->fetch(PDO::FETCH_ASSOC);

      echo $user
        ? json_encode(['success' => true, 'user' => $user])
        : json_encode(['success' => false, 'message' => 'User not found.']);
      exit;
    }

    // ── Update user ───────────────────────────────────────────────────────────
    if ($_GET['action'] === 'update' && isset($_GET['id'])) {
      $id   = (int) $_GET['id'];
      $self = (int) ($_SESSION['user_id'] ?? 0);

      $data = json_decode(file_get_contents('php://input'), true);

      $username   = sanitizeInput($data['username']    ?? '');
      $email      = sanitizeInput($data['email']       ?? '');
      $password   = $data['password'] ?? '';
      $first_name = sanitizeInput($data['first_name']  ?? '');
      $last_name  = sanitizeInput($data['last_name']   ?? '');
      $phone      = sanitizeInput($data['phone']       ?? '');
      $my_db      = sanitizeInput($data['my_database'] ?? '');
      $user_group = sanitizeInput($data['user_group']  ?? '');

      $allowedGroups = ['Administrator', 'Employee', 'HR'];

      $errors = [];
      if (strlen($username) < 3)                        $errors[] = 'Username must be at least 3 characters.';
      if (!isValidEmail($email))                        $errors[] = 'Invalid email address.';
      if ($password && !isValidPassword($password))     $errors[] = 'Password: 8+ chars, uppercase, lowercase, number.';
      if (!$first_name || !$last_name)                  $errors[] = 'First and last name are required.';
      if (!$my_db)                                      $errors[] = 'My database name is required.';
      if (!in_array($user_group, $allowedGroups, true)) $errors[] = 'Invalid user group selected.';

      if ($errors) {
        echo json_encode(['success' => false, 'errors' => $errors]);
        exit;
      }

      // Prevent an admin from stripping their own Administrator role
      if ($id === $self && $user_group !== 'Administrator') {
        echo json_encode(['success' => false, 'errors' => ['You cannot remove your own Administrator role.']]);
        exit;
      }

      // Duplicate check (exclude the user being updated)
      $chk = $pdo->prepare("SELECT COUNT(*) FROM users WHERE (username = ? OR email = ?) AND id != ?");
      $chk->execute([$username, $email, $id]);
      if ($chk->fetchColumn() > 0) {
        echo json_encode(['success' => false, 'errors' => ['Username or email already taken.']]);
        exit;
      }

      if ($password) {
        $hashed = password_hash($password, PASSWORD_DEFAULT);
        $stmt   = $pdo->prepare("
          UPDATE users
          SET    username=?, email=?, password=?, first_name=?, last_name=?,
                 phone=?, my_database=?, user_group=?, updated_at=NOW()
          WHERE  id=?
        ");
        $stmt->execute([
          $username,
          $email,
          $hashed,
          $first_name,
          $last_name,
          $phone ?: null,
          $my_db,
          $user_group,
          $id
        ]);
      } else {
        $stmt = $pdo->prepare("
          UPDATE users
          SET    username=?, email=?, first_name=?, last_name=?,
                 phone=?, my_database=?, user_group=?, updated_at=NOW()
          WHERE  id=?
        ");
        $stmt->execute([
          $username,
          $email,
          $first_name,
          $last_name,
          $phone ?: null,
          $my_db,
          $user_group,
          $id
        ]);
      }

      logSystemAction($_SESSION['user_id'] ?? null, 'USER_UPDATED', "Updated user ID: $id ($username)");
      echo json_encode(['success' => true, 'message' => 'User updated successfully.']);
      exit;
    }

    // ── Delete user ───────────────────────────────────────────────────────────
    if ($_GET['action'] === 'delete' && isset($_GET['id'])) {
      $id = (int) $_GET['id'];

      // Prevent self-deletion
      if ((int) ($_SESSION['user_id'] ?? 0) === $id) {
        echo json_encode(['success' => false, 'message' => 'You cannot delete your own account.']);
        exit;
      }

      $chk = $pdo->prepare("SELECT username, user_group FROM users WHERE id = ?");
      $chk->execute([$id]);
      $user = $chk->fetch(PDO::FETCH_ASSOC);

      if (!$user) {
        echo json_encode(['success' => false, 'message' => 'User not found.']);
        exit;
      }

      // Protect the root admin account (id=1, Administrator)
      if ($id === 1 && $user['user_group'] === 'Administrator') {
        echo json_encode(['success' => false, 'message' => 'The root Administrator account cannot be deleted.']);
        exit;
      }

      $stmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
      $stmt->execute([$id]);

      logSystemAction(
        $_SESSION['user_id'] ?? null,
        'USER_DELETED',
        "Deleted user: {$user['username']} (ID: $id)"
      );
      echo json_encode(['success' => true, 'message' => 'User deleted successfully.']);
      exit;
    }

    echo json_encode(['success' => false, 'message' => 'Unknown action.']);
  } catch (PDOException $e) {
    error_log("users_management.php error: " . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
  }
  exit;
}

// ── Auth guard ────────────────────────────────────────────────────────────────
if (!isLoggedIn()) {
  header('Location: ../../portal.php');
  exit;
}

$isAdmin      = ($_SESSION['user_group'] ?? '') === 'Administrator';
$sessionUserId = (int) ($_SESSION['user_id'] ?? 0);
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Users Management</title>
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

    .toolbar input,
    .toolbar select {
      padding: 6px 12px;
      border: 1px solid #ccc;
      border-radius: 5px;
      font-size: 13px;
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

    .btn-add {
      background: #7c3aed;
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

    .refresh-indicator {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-left: auto;
      color: rgba(255, 255, 255, .75);
      font-size: 12px;
      font-weight: 500;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
      box-shadow: 0 0 0 0 rgba(74, 222, 128, .7);
      animation: pulse-ring 2s ease-in-out infinite;
      flex-shrink: 0;
    }

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
      table-layout: fixed;
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
      overflow: hidden;
      text-overflow: ellipsis;
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

    /* ── Action buttons ── */
    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 11px;
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

    .action-btn:disabled {
      opacity: .5;
      cursor: not-allowed;
      filter: none;
    }

    .btn-edit-row {
      background: #6d28d9;
      color: #fff;
    }

    .btn-del-row {
      background: #ef4444;
      color: #fff;
    }

    /* Tooltip wrapper for locked buttons */
    .lock-wrap {
      position: relative;
      display: inline-block;
    }

    .lock-wrap .tip {
      display: none;
      position: absolute;
      bottom: 110%;
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: #fff;
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      z-index: 20;
      pointer-events: none;
    }

    .lock-wrap:hover .tip {
      display: block;
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

    /* Empty / Spinner */
    .empty-row td {
      text-align: center;
      padding: 36px;
      color: #adb5bd;
      font-style: italic;
    }

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

    /* ── Modals ── */
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
      width: 480px;
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
      font-size: 16px;
      margin-bottom: 16px;
      color: #1f2937;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .modal-box p {
      font-size: 13.5px;
      color: #6b7280;
      margin-bottom: 20px;
    }

    /* ── Form ── */
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
    }

    .form-row {
      margin-bottom: 12px;
    }

    .form-row label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 4px;
    }

    .form-row input,
    .form-row select {
      width: 100%;
      padding: 7px 10px;
      font-size: 13px;
      border: 1px solid #d1d5db;
      border-radius: 5px;
      outline: none;
      transition: border-color .15s;
      background: #fff;
    }

    .form-row input:focus,
    .form-row select:focus {
      border-color: #7c3aed;
      box-shadow: 0 0 0 3px rgba(124, 58, 237, .1);
    }

    .form-hint {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 3px;
    }

    .err-box {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 5px;
      padding: 8px 12px;
      font-size: 12px;
      color: #b91c1c;
      margin-bottom: 12px;
      display: none;
    }

    .modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 16px;
    }

    .modal-actions button {
      padding: 8px 18px;
      border: none;
      border-radius: 5px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-cancel {
      background: #e5e7eb;
      color: #374151;
    }

    .btn-confirm {
      background: #7c3aed;
      color: #fff;
    }

    .btn-danger {
      background: #ef4444;
      color: #fff;
    }

    /* ── Toast ── */
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

  <!-- ── Toolbar ── -->
  <div class="toolbar">
    <button class="btn btn-search" onclick="loadUsers()">
      <i class="fas fa-search"></i> Search
    </button>
    <button class="btn btn-clear" onclick="clearSearch()">
      <i class="fas fa-times"></i> Clear
    </button>

    <input id="searchUser" type="text" placeholder="Filter by username…"
      oninput="debounceLoad()" style="width:180px;" autocomplete="off"
      readonly onfocus="this.removeAttribute('readonly')">

    <input id="searchEmail" type="text" placeholder="Filter by email…"
      oninput="debounceLoad()" style="width:200px;" autocomplete="off">

    <?php if ($isAdmin): ?>
      <button class="btn btn-add" onclick="openAdd()">
        <i class="fas fa-user-plus"></i> Add User
      </button>
    <?php endif; ?>
  </div>

  <!-- ── Panel ── -->
  <div class="panel">

    <!-- Stats header -->
    <div class="stats-header">
      <span class="stats-title">Users</span>
      <span class="stat-item"><i class="fas fa-users"></i> Total <strong id="statTotal">—</strong></span>
      <span class="stat-item"><i class="fas fa-sign-in-alt"></i> Logged in <strong id="statLoggedIn">—</strong></span>
      <span class="stat-item"><i class="fas fa-user-clock"></i> Never logged <strong id="statNever">—</strong></span>
      <span class="refresh-indicator">
        <span class="pulse-dot" id="pulseDot"></span> Live
      </span>
    </div>

    <div class="countdown-bar-wrap">
      <div class="countdown-bar" id="countdownBar"></div>
    </div>

    <!-- Table -->
    <div class="table-wrap">
      <table>
        <colgroup>
          <col style="width:46px">
          <col style="width:190px">
          <col style="width:190px">
          <col style="width:110px">
          <col style="width:110px">
          <col style="width:120px">
          <col style="width:145px">
          <col style="width:145px">
          <col style="width:155px">
        </colgroup>
        <thead>
          <tr>
            <th>SN</th>
            <th>User</th>
            <th>Email</th>
            <th>User Group</th>
            <th>Phone</th>
            <th>Database</th>
            <th>Created At</th>
            <th>Last Login</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="userTableBody">
          <tr class="empty-row">
            <td colspan="9"><span class="spinner"></span> Loading users…</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination" id="paginationWrap"></div>
  </div>

  <!-- ── Add / Edit Modal ── -->
  <div class="modal-overlay" id="formModal">
    <div class="modal-box">
      <h3 id="formModalTitle">
        <i class="fas fa-user-plus" style="color:#7c3aed"></i> Add New User
      </h3>

      <div class="err-box" id="formErr"></div>

      <div class="form-grid">
        <div class="form-row">
          <label>First name <span style="color:#ef4444">*</span></label>
          <input type="text" id="fFirstName" placeholder="Firstname">
        </div>
        <div class="form-row">
          <label>Last name <span style="color:#ef4444">*</span></label>
          <input type="text" id="fLastName" placeholder="Lastname">
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label>Username <span style="color:#ef4444">*</span></label>
          <input type="text" id="fUsername" placeholder="Minimum 3 characters">
        </div>
        <div class="form-row">
          <label>Email <span style="color:#ef4444">*</span></label>
          <input type="email" id="fEmail" placeholder="user@example.com">
        </div>
      </div>
      <div class="form-row">
        <label>User Group <span style="color:#ef4444">*</span></label>
        <select id="fUsergroup">
          <option value="">— Select group —</option>
          <option value="Administrator">Administrator</option>
          <option value="Employee">Employee</option>
          <option value="HR">HR</option>
        </select>
      </div>

      <div class="form-row">
        <label>Password
          <span id="pwHint" style="font-weight:400;color:#9ca3af">
            (min 8 chars, upper, lower, number)
          </span>
        </label>
        <input type="password" id="fPassword" placeholder="Password">
      </div>

      <div class="form-grid">
        <div class="form-row">
          <label>Phone</label>
          <input type="text" id="fPhone" placeholder="09XXXXXXXXX">
        </div>
        <div class="form-row">
          <label>My database <span style="color:#ef4444">*</span></label>
          <input type="text" id="fDatabase" placeholder="e.g. AdminServer">
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal('formModal')">Cancel</button>
        <button class="btn-confirm" id="btnFormSubmit" onclick="submitForm()">
          <i class="fas fa-save"></i> Register User
        </button>
      </div>
    </div>
  </div>

  <!-- ── Delete Confirm Modal ── -->
  <div class="modal-overlay" id="deleteModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;
                  display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center">
        <i class="fas fa-exclamation-triangle"></i> Delete User?
      </h3>
      <p id="deleteConfirmMsg">Are you sure? This action cannot be undone.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-cancel" onclick="closeModal('deleteModal')">Cancel</button>
        <button class="btn-danger" id="btnConfirmDelete" onclick="confirmDelete()">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  </div>

  <!-- ── Toast ── -->
  <div class="toast" id="toast">
    <i class="fas fa-check-circle" id="toastIcon"></i>
    <span id="toastMsg">Done</span>
  </div>

  <script src="../src/btn.js"></script>
  <script>
    /* ── Server-provided constants ── */
    const IS_ADMIN = <?= $isAdmin ? 'true' : 'false' ?>;
    const SESSION_UID = <?= $sessionUserId ?>;
    const AUTO_REFRESH_INTERVAL = 30; // seconds

    const COLORS = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922', '#BA7517'];

    /* ── State ── */
    let allUsers = [];
    let currentPage = 1;
    const PER_PAGE = 10;
    let editingId = null;
    let pendingDelId = null;
    let debounceTimer = null;
    let modalOpen = false;

    /* ── Countdown ── */
    let countdownLeft = AUTO_REFRESH_INTERVAL;
    let countdownTick = null;
    let autoRefreshTimer = null;

    function startCountdown() {
      stopCountdown();
      countdownLeft = AUTO_REFRESH_INTERVAL;
      updateCountdownUI();

      countdownTick = setInterval(() => {
        if (modalOpen) return;
        countdownLeft = Math.max(0, countdownLeft - 1);
        updateCountdownUI();
      }, 1000);

      autoRefreshTimer = setTimeout(async () => {
        if (!modalOpen) await loadUsers(true);
        startCountdown();
      }, AUTO_REFRESH_INTERVAL * 1000);
    }

    function stopCountdown() {
      clearInterval(countdownTick);
      clearTimeout(autoRefreshTimer);
    }

    function updateCountdownUI() {
      const pct = (countdownLeft / AUTO_REFRESH_INTERVAL) * 100;
      document.getElementById('countdownBar').style.width = pct + '%';
      document.getElementById('pulseDot').classList.toggle('paused', modalOpen);
    }

    /* ── Load users ── */
    async function loadUsers(silent = false) {
      const su = document.getElementById('searchUser').value.trim();
      const se = document.getElementById('searchEmail').value.trim();
      const params = new URLSearchParams({
        action: 'fetch'
      });
      if (su) params.append('search_user', su);
      if (se) params.append('search_email', se);

      if (!silent) {
        document.getElementById('userTableBody').innerHTML =
          `<tr class="empty-row"><td colspan="9"><span class="spinner"></span> Loading…</td></tr>`;
      }

      try {
        const res = await fetch('?' + params.toString());
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Fetch failed');
        allUsers = data.users;
        renderTable();
        updateStats(data.stats);
      } catch (err) {
        if (!silent) {
          showToast('Failed to load users: ' + err.message, true);
          document.getElementById('userTableBody').innerHTML =
            `<tr class="empty-row"><td colspan="9">
              <i class="fas fa-exclamation-circle" style="color:#ef4444"></i>
              ${escHtml(err.message)}
            </td></tr>`;
        }
      }
    }

    /* ── Render table ── */
    function renderTable() {
      const tbody = document.getElementById('userTableBody');
      const total = allUsers.length;
      const pages = Math.max(1, Math.ceil(total / PER_PAGE));
      if (currentPage > pages) currentPage = pages;

      const slice = allUsers.slice((currentPage - 1) * PER_PAGE, currentPage * PER_PAGE);

      if (!slice.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="9">
          <i class="fas fa-users" style="font-size:24px;display:block;margin-bottom:6px;opacity:.4"></i>
          No users found.
        </td></tr>`;
        document.getElementById('paginationWrap').innerHTML = '';
        return;
      }

      tbody.innerHTML = slice.map((u, i) => {
        const idx = (currentPage - 1) * PER_PAGE + i;
        const color = COLORS[(u.id - 1) % COLORS.length];
        const initial = ((u.first_name || u.username)[0] || '?').toUpperCase();
        const isSelf = +u.id === SESSION_UID;
        const isRoot = +u.id === 1 && u.user_group === 'Administrator';

        /* ── Edit button ── */
        let editBtn;
        if (!IS_ADMIN) {
          editBtn = `<div class="lock-wrap">
            <button class="action-btn btn-edit-row" disabled>
              <i class="fas fa-lock" style="opacity:.5"></i> Edit
            </button>
            <span class="tip">Administrators only</span>
          </div>`;
        } else {
          editBtn = `<button class="action-btn btn-edit-row" onclick="openEdit(${u.id})">
            <i class="fas fa-edit"></i> Edit
          </button>`;
        }

        /* ── Delete button ── */
        let delBtn;
        if (!IS_ADMIN) {
          delBtn = `<div class="lock-wrap">
            <button class="action-btn btn-del-row" disabled>
              <i class="fas fa-lock" style="opacity:.5"></i> Delete
            </button>
            <span class="tip">Administrators only</span>
          </div>`;
        } else if (isSelf) {
          delBtn = `<div class="lock-wrap">
            <button class="action-btn btn-del-row" disabled>
              <i class="fas fa-trash"></i> Delete
            </button>
            <span class="tip">Cannot delete your own account</span>
          </div>`;
        } else if (isRoot) {
          delBtn = `<div class="lock-wrap">
            <button class="action-btn btn-del-row" disabled>
              <i class="fas fa-trash"></i> Delete
            </button>
            <span class="tip">Root Administrator cannot be deleted</span>
          </div>`;
        } else {
          delBtn = `<button class="action-btn btn-del-row"
              onclick="openDelete(${u.id}, '${escHtml(u.username)}')">
              <i class="fas fa-trash"></i> Delete
            </button>`;
        }

        return `
        <tr>
          <td style="color:#aaa">${idx + 1}</td>
          <td>
            <div class="user-cell">
              <div class="avatar" style="background:${color}">${initial}</div>
              <div>
                <div style="font-weight:600;color:#1f2937">
                  ${escHtml(u.username)}${isSelf ? ' <em style="font-size:11px;color:#9ca3af">(you)</em>' : ''}
                </div>
                <div style="font-size:11px;color:#9ca3af">
                  ${escHtml(u.first_name)} ${escHtml(u.last_name)}
                </div>
              </div>
            </div>
          </td>
          <td title="${escHtml(u.email)}">${escHtml(u.email || '—')}</td>
          <td>${escHtml(u.user_group || '—')}</td>
          <td>${escHtml(u.phone || '—')}</td>
          <td>${escHtml(u.my_database || '—')}</td>
          <td>${escHtml(u.created_at ? u.created_at.slice(0,16) : '—')}</td>
          <td>${u.last_login
                ? escHtml(u.last_login.slice(0,16))
                : '<span style="color:#d1d5db">—</span>'}</td>
          <td>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${editBtn}
              ${delBtn}
            </div>
          </td>
        </tr>`;
      }).join('');

      const pgWrap = document.getElementById('paginationWrap');
      pgWrap.innerHTML =
        `<span>${total} record${total !== 1 ? 's' : ''}</span>` +
        Array.from({
            length: pages
          }, (_, i) =>
          `<button class="page-btn${currentPage === i+1 ? ' active' : ''}"
                   onclick="goPage(${i+1})">${i+1}</button>`
        ).join('');
    }

    function goPage(p) {
      currentPage = p;
      renderTable();
    }

    /* ── Stats ── */
    function updateStats(s) {
      document.getElementById('statTotal').textContent = s.total ?? 0;
      document.getElementById('statLoggedIn').textContent = s.logged_in ?? 0;
      document.getElementById('statNever').textContent = s.never_logged ?? 0;
    }

    /* ── Add modal ── */
    function openAdd() {
      if (!IS_ADMIN) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      editingId = null;
      clearForm();
      document.getElementById('formModalTitle').innerHTML =
        '<i class="fas fa-user-plus" style="color:#7c3aed"></i> Add New User';
      document.getElementById('pwHint').textContent = '(min 8 chars, upper, lower, number)';
      document.getElementById('btnFormSubmit').innerHTML = '<i class="fas fa-save"></i> Register User';
      document.getElementById('fPassword').placeholder = 'Password';
      openModal('formModal');
    }

    /* ── Edit modal ── */
    async function openEdit(id) {
      if (!IS_ADMIN) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      editingId = id;
      clearForm();
      document.getElementById('formModalTitle').innerHTML =
        '<i class="fas fa-edit" style="color:#7c3aed"></i> Edit User';
      document.getElementById('pwHint').textContent = '(leave blank to keep current)';
      document.getElementById('btnFormSubmit').innerHTML = '<i class="fas fa-save"></i> Save Changes';
      document.getElementById('fPassword').placeholder = 'Leave blank to keep current password';
      openModal('formModal');

      try {
        const res = await fetch(`?action=get&id=${id}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const u = data.user;
        document.getElementById('fFirstName').value = u.first_name || '';
        document.getElementById('fLastName').value = u.last_name || '';
        document.getElementById('fUsername').value = u.username || '';
        document.getElementById('fEmail').value = u.email || '';
        document.getElementById('fEmail').setAttribute('data-original', u.email || '');
        document.getElementById('fEmail').disabled = u.user_group === 'Administrator';
        document.getElementById('fPhone').value = u.phone || '';
        document.getElementById('fDatabase').value = u.my_database || '';
        document.getElementById('fUsergroup').value = u.user_group || '';
        document.getElementById('fUsergroup').setAttribute('data-original', u.user_group || '');
        document.getElementById('fUsergroup').disabled = u.user_group === 'Administrator';
      } catch (err) {
        showToast('Failed to load user: ' + err.message, true);
        closeModal('formModal');
      }
    }

    /* ── Submit add/edit ── */
    async function submitForm() {
      if (!IS_ADMIN) {
        showToast('Access denied.', true);
        return;
      }

      const payload = {
        first_name: document.getElementById('fFirstName').value.trim(),
        last_name: document.getElementById('fLastName').value.trim(),
        username: document.getElementById('fUsername').value.trim(),
        email: document.getElementById('fEmail').value.trim(),
        user_group: document.getElementById('fUsergroup').value,
        password: document.getElementById('fPassword').value,
        phone: document.getElementById('fPhone').value.trim(),
        my_database: document.getElementById('fDatabase').value.trim(),
      };

      const errBox = document.getElementById('formErr');
      errBox.style.display = 'none';

      const btn = document.getElementById('btnFormSubmit');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving…';

      const url = editingId ? `?action=update&id=${editingId}` : `?action=add`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (!data.success) {
          errBox.style.display = 'block';
          errBox.innerHTML = (data.errors || [data.message]).join('<br>');
          return;
        }

        closeModal('formModal');
        showToast(data.message);
        currentPage = 1;
        stopCountdown();
        await loadUsers();
        startCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = editingId ?
          '<i class="fas fa-save"></i> Save Changes' :
          '<i class="fas fa-save"></i> Register User';
      }
    }

    /* ── Delete ── */
    function openDelete(id, username) {
      if (!IS_ADMIN) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      pendingDelId = id;
      document.getElementById('deleteConfirmMsg').innerHTML =
        `Delete <strong>${escHtml(username)}</strong>? This cannot be undone.`;
      openModal('deleteModal');
    }

    async function confirmDelete() {
      if (!IS_ADMIN || !pendingDelId) return;
      const btn = document.getElementById('btnConfirmDelete');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';

      try {
        const res = await fetch(`?action=delete&id=${pendingDelId}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        pendingDelId = null;
        closeModal('deleteModal');
        showToast(data.message);
        stopCountdown();
        await loadUsers();
        startCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    }

    /* ── Debounce ── */
    function debounceLoad() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentPage = 1;
        stopCountdown();
        loadUsers().then(startCountdown);
      }, 380);
    }

    function clearSearch() {
      document.getElementById('searchUser').value = '';
      document.getElementById('searchEmail').value = '';
      currentPage = 1;
      stopCountdown();
      loadUsers().then(startCountdown);
    }

    /* ── Form helpers ── */
    function clearForm() {
      ['fFirstName', 'fLastName', 'fUsername', 'fEmail', 'fPassword', 'fPhone', 'fDatabase']
      .forEach(id => {
        document.getElementById(id).value = '';
      });
      document.getElementById('fUsergroup').value = '';
      const e = document.getElementById('formErr');
      e.style.display = 'none';
      e.innerHTML = '';
    }

    /* ── Modal helpers ── */
    function openModal(id) {
      modalOpen = true;
      document.getElementById(id).classList.add('show');
      updateCountdownUI();
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('show');
      modalOpen = false;
      updateCountdownUI();
    }

    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target === el) closeModal(el.id);
      });
    });

    /* ── Toast ── */
    let toastTimer = null;

    function showToast(msg, isError = false) {
      const t = document.getElementById('toast');
      const ic = document.getElementById('toastIcon');
      document.getElementById('toastMsg').textContent = msg;
      ic.className = isError ? 'fas fa-times-circle' : 'fas fa-check-circle';
      t.classList.toggle('error', isError);
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
    }

    /* ── Escape HTML ── */
    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /* ── Init ── */
    loadUsers().then(startCountdown);
  </script>
</body>

</html>