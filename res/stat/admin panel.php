<?php
// admin-panel.php
require_once '../cnfg/config.php';
require_once '../cnfg/db.php';

// ════════════════════════════════════════════════════════════════════════════
// AJAX HANDLERS
// ════════════════════════════════════════════════════════════════════════════
if (isset($_GET['action'])) {
  if ($_GET['action'] !== 'export_db') {
    header('Content-Type: application/json');
  }

  try {
    $pdo = getMainDBConnection();

    // ── USERS MANAGEMENT ACTIONS ─────────────────────────────────────────────

    // Fetch users (non-admin can see this for read-only)
    if ($_GET['action'] === 'fetch_users') {
      if (!$isAdminSession) {
        echo json_encode(['success' => false, 'message' => 'Access denied. Administrators only.']);
        exit;
      }
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
        FROM   users $where
        ORDER  BY id ASC
      ");
      $stmt->execute($params);
      $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

      $stats = $pdo->query("
        SELECT COUNT(*) AS total,
               SUM(last_login IS NOT NULL) AS logged_in,
               SUM(last_login IS NULL)     AS never_logged
        FROM users
      ")->fetch(PDO::FETCH_ASSOC);

      echo json_encode(['success' => true, 'users' => $users, 'stats' => $stats]);
      exit;
    }

    // All mutating user actions require Administrator
    if (in_array($_GET['action'], ['add_user', 'get_user', 'update_user', 'delete_user'], true)) {
      if (!$isAdminSession) {
        echo json_encode(['success' => false, 'message' => 'Access denied. Administrators only.']);
        exit;
      }

      // ── Add user ──────────────────────────────────────────────────────────
      if ($_GET['action'] === 'add_user') {
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
        if (!$my_db)                                      $errors[] = 'Database name is required.';
        if (!in_array($user_group, $allowedGroups, true)) $errors[] = 'Invalid user group.';

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
        $stmt   = $pdo->prepare("
          INSERT INTO users (username,email,password,first_name,last_name,phone,my_database,user_group,created_at)
          VALUES (?,?,?,?,?,?,?,?,NOW())
        ");
        $stmt->execute([$username, $email, $hashed, $first_name, $last_name, $phone ?: null, $my_db, $user_group]);
        $newId = $pdo->lastInsertId();

        createUserDatabase($newId);
        logSystemAction($_SESSION['user_id'] ?? null, 'USER_REGISTERED', "Admin created user: $username (ID: $newId)");
        echo json_encode(['success' => true, 'message' => 'User added successfully.', 'id' => $newId]);
        exit;
      }

      // ── Get single user ───────────────────────────────────────────────────
      if ($_GET['action'] === 'get_user' && isset($_GET['id'])) {
        $id   = (int) $_GET['id'];
        $stmt = $pdo->prepare("
          SELECT id,username,email,first_name,last_name,phone,my_database,user_group
          FROM users WHERE id = ?
        ");
        $stmt->execute([$id]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        echo $user
          ? json_encode(['success' => true, 'user' => $user])
          : json_encode(['success' => false, 'message' => 'User not found.']);
        exit;
      }

      // ── Update user ───────────────────────────────────────────────────────
      if ($_GET['action'] === 'update_user' && isset($_GET['id'])) {
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
        if (!$my_db)                                      $errors[] = 'Database name is required.';
        if (!in_array($user_group, $allowedGroups, true)) $errors[] = 'Invalid user group.';

        if ($errors) {
          echo json_encode(['success' => false, 'errors' => $errors]);
          exit;
        }

        if ($id === $self && $user_group !== 'Administrator') {
          echo json_encode(['success' => false, 'errors' => ['You cannot remove your own Administrator role.']]);
          exit;
        }

        $chk = $pdo->prepare("SELECT COUNT(*) FROM users WHERE (username = ? OR email = ?) AND id != ?");
        $chk->execute([$username, $email, $id]);
        if ($chk->fetchColumn() > 0) {
          echo json_encode(['success' => false, 'errors' => ['Username or email already taken.']]);
          exit;
        }

        if ($password) {
          $hashed = password_hash($password, PASSWORD_DEFAULT);
          $stmt   = $pdo->prepare("UPDATE users SET username=?,email=?,password=?,first_name=?,last_name=?,phone=?,my_database=?,user_group=?,updated_at=NOW() WHERE id=?");
          $stmt->execute([$username, $email, $hashed, $first_name, $last_name, $phone ?: null, $my_db, $user_group, $id]);
        } else {
          $stmt = $pdo->prepare("UPDATE users SET username=?,email=?,first_name=?,last_name=?,phone=?,my_database=?,user_group=?,updated_at=NOW() WHERE id=?");
          $stmt->execute([$username, $email, $first_name, $last_name, $phone ?: null, $my_db, $user_group, $id]);
        }

        logSystemAction($_SESSION['user_id'] ?? null, 'USER_UPDATED', "Updated user ID: $id ($username)");
        echo json_encode(['success' => true, 'message' => 'User updated successfully.']);
        exit;
      }

      // ── Delete user ───────────────────────────────────────────────────────
      if ($_GET['action'] === 'delete_user' && isset($_GET['id'])) {
        $id = (int) $_GET['id'];

        if ((int)($_SESSION['user_id'] ?? 0) === $id) {
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
        if ($id === 1 && $user['user_group'] === 'Administrator') {
          echo json_encode(['success' => false, 'message' => 'The root Administrator account cannot be deleted.']);
          exit;
        }

        $stmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
        $stmt->execute([$id]);
        logSystemAction($_SESSION['user_id'] ?? null, 'USER_DELETED', "Deleted user: {$user['username']} (ID: $id)");
        echo json_encode(['success' => true, 'message' => 'User deleted successfully.']);
        exit;
      }
    }

    // ── SYSTEM LOG ACTIONS ───────────────────────────────────────────────────

    if (in_array($_GET['action'], ['fetch_logs', 'fetch_log_actions', 'delete_log', 'delete_all_logs'], true)) {
      if (!$isAdminSession) {
        echo json_encode(['success' => false, 'message' => 'Access denied.']);
        exit;
      }

      if ($_GET['action'] === 'fetch_log_actions') {
        $stmt = $pdo->query("SELECT DISTINCT action FROM system_logs ORDER BY action ASC");
        $actions = $stmt->fetchAll(PDO::FETCH_COLUMN);
        echo json_encode(['success' => true, 'actions' => $actions]);
        exit;
      }

      // Fetch logs
      if ($_GET['action'] === 'fetch_logs') {
        $where  = "WHERE 1=1";
        $params = [];

        if (!empty($_GET['search'])) {
          $where .= " AND (sl.action LIKE :s OR sl.details LIKE :s2 OR sl.ip_address LIKE :s3 OR u.username LIKE :s4)";
          $like = '%' . $_GET['search'] . '%';
          $params[':s'] = $params[':s2'] = $params[':s3'] = $params[':s4'] = $like;
        }
        if (!empty($_GET['action_filter'])) {
          $where .= " AND sl.action = :af";
          $params[':af'] = $_GET['action_filter'];
        }

        $stmt = $pdo->prepare("
          SELECT sl.id, sl.user_id,
                 COALESCE(u.username,'System') AS username,
                 sl.action, sl.details, sl.ip_address, sl.user_agent, sl.created_at
          FROM   system_logs sl
          LEFT   JOIN users u ON u.id = sl.user_id
          $where
          ORDER  BY sl.created_at DESC
        ");
        $stmt->execute($params);
        $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stats = $pdo->query("
          SELECT COUNT(*) AS total,
                 SUM(action='USER_LOGIN' OR action='LOGIN') AS logins,
                 SUM(action LIKE '%UPDATED%')               AS updates,
                 SUM(action LIKE '%DELETED%')               AS deletes
          FROM system_logs
        ")->fetch(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'logs' => $logs, 'stats' => $stats]);
        exit;
      }

      // Delete single log
      if ($_GET['action'] === 'delete_log' && isset($_GET['id'])) {
        $id   = (int) $_GET['id'];
        $stmt = $pdo->prepare("DELETE FROM system_logs WHERE id = :id");
        $stmt->execute([':id' => $id]);
        echo $stmt->rowCount()
          ? json_encode(['success' => true])
          : json_encode(['success' => false, 'message' => 'Log not found.']);
        exit;
      }

      // Delete all logs
      if ($_GET['action'] === 'delete_all_logs') {
        $count = $pdo->query("SELECT COUNT(*) FROM system_logs")->fetchColumn();
        $pdo->exec("DELETE FROM system_logs");
        echo json_encode(['success' => true, 'deleted' => $count]);
        exit;
      }
    }

    // ── PHP MYADMIN — EXPORT SQL ─────────────────────────────────────────────
    if ($_GET['action'] === 'export_db') {
      if (!$isAdminSession) {
        echo json_encode(['success' => false, 'message' => 'Access denied. Administrators only.']);
        exit;
      }

      $mode = $_GET['mode'] ?? 'full'; // structure | data | full
      $dbName = $pdo->query("SELECT DATABASE()")->fetchColumn();

      // Remove JSON header — we'll stream SQL
      header('Content-Type: application/octet-stream');
      header('Content-Disposition: attachment; filename="' . $dbName . '_' . date('Ymd_His') . '.sql"');
      header('Cache-Control: no-cache');

      $out = fopen('php://output', 'w');

      fwrite($out, "-- ============================================================\n");
      fwrite($out, "-- Database: `$dbName`\n");
      fwrite($out, "-- Exported: " . date('Y-m-d H:i:s') . "\n");
      fwrite($out, "-- Mode: $mode\n");
      fwrite($out, "-- ============================================================\n\n");
      fwrite($out, "SET FOREIGN_KEY_CHECKS=0;\n\n");

      $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);

      foreach ($tables as $table) {
        fwrite($out, "-- -----------------------------------------------------------\n");
        fwrite($out, "-- Table: `$table`\n");
        fwrite($out, "-- -----------------------------------------------------------\n\n");

        // Structure
        if ($mode === 'structure' || $mode === 'full') {
          fwrite($out, "DROP TABLE IF EXISTS `$table`;\n");
          $create = $pdo->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_ASSOC);
          fwrite($out, $create['Create Table'] . ";\n\n");
        }

        // Data
        if ($mode === 'data' || $mode === 'full') {
          $rows = $pdo->query("SELECT * FROM `$table`")->fetchAll(PDO::FETCH_ASSOC);
          if ($rows) {
            $cols = '`' . implode('`, `', array_keys($rows[0])) . '`';
            foreach ($rows as $row) {
              $vals = array_map(function ($v) use ($pdo) {
                return $v === null ? 'NULL' : $pdo->quote($v);
              }, array_values($row));
              fwrite($out, "INSERT INTO `$table` ($cols) VALUES (" . implode(', ', $vals) . ");\n");
            }
            fwrite($out, "\n");
          }
        }
      }

      fwrite($out, "SET FOREIGN_KEY_CHECKS=1;\n");
      fclose($out);
      exit;
    }

    echo json_encode(['success' => false, 'message' => 'Unknown action.']);
  } catch (PDOException $e) {
    error_log("admin_panel.php error: " . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
  }
  exit;
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin Panel</title>
  <link rel="preload" href="../icon/database-icon.png" as="image">
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/btn.css">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet" />

  <style>
    /* ── Reset & Base ── */
    *,
    *::before,
    *::after {
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

    /* ════════════════════════════════════
       TAB NAVIGATION
    ════════════════════════════════════ */
    .tab-nav {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      margin-bottom: 0;
      padding: 0 4px;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 11px 22px 12px;
      border: none;
      border-radius: 8px 8px 0 0;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background .18s, color .18s, box-shadow .18s;
      background: #d1d5db;
      color: #6b7280;
      position: relative;
      bottom: 0;
      letter-spacing: .2px;
      user-select: none;
    }

    .tab-btn i {
      font-size: 14px;
    }

    .tab-btn:hover:not(.active) {
      background: #e5e7eb;
      color: #374151;
    }

    .tab-btn.active {
      background: #7c3aed;
      color: #fff;
      box-shadow: 0 -2px 8px rgba(124, 58, 237, .25);
      z-index: 2;
    }

    .tab-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      background: rgba(255, 255, 255, .25);
      color: inherit;
      transition: background .18s;
    }

    .tab-btn:not(.active) .tab-badge {
      background: rgba(0, 0, 0, .1);
    }

    /* ── Tab panels ── */
    .tab-panel {
      display: none;
    }

    .tab-panel.active {
      display: block;
    }

    /* ════════════════════════════════════
       SHARED TOOLBAR
    ════════════════════════════════════ */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      background: #e9ecef;
      padding: 12px 16px;
      border-radius: 0 8px 0 0;
      /* top-right only when tab is selected */
      border-bottom: 1px solid #dee2e6;
    }

    .toolbar input,
    .toolbar select {
      padding: 6px 12px;
      border: 1px solid #ccc;
      border-radius: 5px;
      font-size: 13px;
    }

    /* ── Buttons ── */
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

    /* ── Pulse dot ── */
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
      box-shadow: 0 0 0 0 rgba(74, 222, 128, .7);
      animation: pulse-ring 2s ease-in-out infinite;
      flex-shrink: 0;
    }

    .pulse-dot2 {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #dc3545;
      box-shadow: 0 0 0 0 rgba(74, 222, 128, .7);
      animation: pulse-ring2 2s ease-in-out infinite;
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

    @keyframes pulse-ring2 {
      0% {
        box-shadow: 0 0 0 0 rgba(222, 74, 74, 0.7);
      }

      70% {
        box-shadow: 0 0 0 7px rgba(222, 74, 74, 0);
      }

      100% {
        box-shadow: 0 0 0 0 rgba(222, 74, 99, 0);
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

    .btn-view-log {
      background: #6d28d9;
      color: #fff;
    }

    .btn-del-log {
      background: #ef4444;
      color: #fff;
    }

    /* Tooltip wrapper */
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

    /* ── Empty / Spinner ── */
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

    /* ── Badges (logs) ── */
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

    /* ════════════════════════════════════
       MODALS
    ════════════════════════════════════ */
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

    /* Form */
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

    /* Log detail grid */
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

  <!-- ══════════════════════════════════════════
       TAB NAVIGATION
  ══════════════════════════════════════════ -->
  <div class="tab-nav">
    <button class="tab-btn active" id="tabBtnUsers" onclick="switchTab('users')">
      <i class="fas fa-users-cog"></i>
      Users Management
      <span class="tab-badge" id="tabBadgeUsers">—</span>
    </button>
    <button class="tab-btn" id="tabBtnGroup" onclick="switchTab('group')">
      <i class="fas fa-layer-group"></i>
      Users Group
      <span class="tab-badge" id="tabBadgeGroup">—</span>
    </button>
    <button class="tab-btn" id="tabBtnLogs" onclick="switchTab('logs')">
      <i class="fas fa-history"></i>
      System Logs
      <span class="tab-badge" id="tabBadgeLogs">—</span>
    </button>
    <?php if ($isAdmin): ?>
      <button class="tab-btn" id="tabBtnMyAdmin" onclick="switchTab('myadmin')">
        <i class="fas fa-database"></i>
        PHP MyAdmin
        <span class="tab-badge" id="tabBadgeMyAdmin">—</span>
      </button>
    <?php endif; ?>
  </div>

  <!-- ══════════════════════════════════════════
       TAB: USERS MANAGEMENT
  ══════════════════════════════════════════ -->
  <div class="tab-panel active" id="panelUsers">

    <!-- Toolbar -->
    <div class="toolbar" style="border-radius:0 8px 0 0;">
      <button class="btn btn-search" onclick="loadUsers()">
        <i class="fas fa-search"></i> Search
      </button>
      <button class="btn btn-clear" onclick="clearUsersSearch()">
        <i class="fas fa-times"></i> Clear
      </button>
      <input id="searchUser" type="text" placeholder="Username"
        oninput="debounceUsers()" style="width:180px;" autocomplete="off"
        readonly onfocus="this.removeAttribute('readonly')">
      <input id="searchEmail" type="text" placeholder="Email"
        oninput="debounceUsers()" style="width:200px;" autocomplete="off">
      <?php if ($isAdmin): ?>
        <button class="btn btn-add" onclick="openAddUser()">
          <i class="fas fa-user-plus"></i> Add User
        </button>
      <?php endif; ?>
    </div>

    <!-- Panel -->
    <div class="panel">
      <div class="stats-header">
        <span class="stats-title">Users</span>
        <span class="stat-item"><i class="fas fa-users"></i> Total <strong id="uStatTotal">—</strong></span>
        <span class="stat-item"><i class="fas fa-sign-in-alt"></i> Logged in <strong id="uStatLoggedIn">—</strong></span>
        <span class="stat-item"><i class="fas fa-user-clock"></i> Never logged <strong id="uStatNever">—</strong></span>
        <span class="refresh-indicator">
          <?php if ($isAdmin): ?>
            <span class="pulse-dot" id="uPulseDot"></span>
            <span>Live</span>
          <?php else: ?>
            <span class="pulse-dot2" id="uPulseDot"></span>
            <span>✗ Disconnected</span>
          <?php endif; ?>
        </span>
      </div>
      <div class="countdown-bar-wrap">
        <div class="countdown-bar" id="uCountdownBar"></div>
      </div>
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
              <th>Username</th>
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
              <td colspan="10"><span class="spinner"></span> Loading users…</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" id="uPaginationWrap"></div>
    </div>
  </div><!-- /panelUsers -->

  <!-- ══════════════════════════════════════════
       TAB: USERS GROUP
  ══════════════════════════════════════════ -->
  <div class="tab-panel" id="panelGroup">

    <!-- Toolbar -->
    <div class="toolbar" style="border-radius:0 8px 0 0;">
      <button class="btn btn-search" onclick="loadGroups()">
        <i class="fas fa-search"></i> Search
      </button>
      <button class="btn btn-clear" onclick="clearGroupsSearch()">
        <i class="fas fa-times"></i> Clear
      </button>
      <input id="groupSearchInput" type="text" placeholder="Usergroup"
        oninput="debounceGroups()" style="width:220px;" autocomplete="off"
        readonly onfocus="this.removeAttribute('readonly')">
      <?php if ($isAdmin): ?>
        <button class="btn btn-add" onclick="openAddGroup()">
          <i class="fas fa-user-plus"></i> Add Group
        </button>
      <?php endif; ?>
    </div>

    <!-- Panel -->
    <div class="panel">
      <div class="stats-header">
        <span class="stats-title">User Groups</span>
        <span class="stat-item"><i class="fas fa-list"></i> Total <strong id="gStatTotal">—</strong></span>
        <span class="refresh-indicator">
          <?php if ($isAdmin): ?>
            <span class="pulse-dot" id="uPulseDot"></span>
            <span>Live</span>
          <?php else: ?>
            <span class="pulse-dot2" id="uPulseDot"></span>
            <span>✗ Disconnected</span>
          <?php endif; ?>
        </span>
      </div>
      <div class="countdown-bar-wrap">
        <div class="countdown-bar" id="gCountdownBar"></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SN</th>
              <th>Groupname</th>
              <th>Bound user</th>
              <th>Created At</th>
              <th>Last update</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="groupTableBody">
            <tr class="empty-row">
              <td colspan="10"><span class="spinner"></span> Loading groups…</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" id="gPaginationWrap"></div>
    </div>
  </div><!-- /panelGroup -->

  <!-- ══════════════════════════════════════════
       TAB: SYSTEM LOGS
  ══════════════════════════════════════════ -->
  <div class="tab-panel" id="panelLogs">

    <!-- Toolbar -->
    <div class="toolbar" style="border-radius:0 8px 0 0;">
      <button class="btn btn-search" onclick="loadLogs()">
        <i class="fas fa-search"></i> Search
      </button>
      <button class="btn btn-clear" onclick="clearLogsSearch()">
        <i class="fas fa-times"></i> Clear
      </button>
      <input id="logSearchInput" type="text"
        placeholder="Search action, user, IP, details…"
        oninput="debounceLogs()"
        style="padding:6px 12px;border:1px solid #ccc;border-radius:5px;font-size:13px;width:220px;">
      <select id="logActionFilter" onchange="loadLogs()"
        style="padding:6px 10px;border:1px solid #ccc;border-radius:5px;font-size:13px;">
        <option value="">All Actions</option>
      </select>
      <?php if ($isAdmin): ?>
        <button class="btn btn-delete-all" onclick="confirmDeleteAllLogs()">
          <i class="fas fa-trash"></i> Delete All Data
        </button>
      <?php endif; ?>
    </div>

    <!-- Panel -->
    <div class="panel">
      <div class="stats-header">
        <span class="stats-title">System Logs</span>
        <span class="stat-item"><i class="fas fa-list"></i> Total <strong id="lStatTotal">—</strong></span>
        <span class="stat-item"><i class="fas fa-sign-in-alt"></i> Logins <strong id="lStatLogins">—</strong></span>
        <span class="stat-item"><i class="fas fa-user-edit"></i> Updates <strong id="lStatUpdates">—</strong></span>
        <span class="stat-item"><i class="fas fa-trash-alt"></i> Deletions <strong id="lStatDeletes">—</strong></span>
        <span class="refresh-indicator">
          <?php if ($isAdmin): ?>
            <span class="pulse-dot" id="uPulseDot"></span>
            <span>Live</span>
          <?php else: ?>
            <span class="pulse-dot2" id="uPulseDot"></span>
            <span>✗ Disconnected</span>
          <?php endif; ?>
        </span>
      </div>
      <div class="countdown-bar-wrap">
        <div class="countdown-bar" id="lCountdownBar"></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>SN</th>
              <th>Username</th>
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
              <td colspan="10"><span class="spinner"></span> Loading logs…</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" id="lPaginationWrap"></div>
    </div>
  </div><!-- /panelLogs -->

  <!-- ══════════════════════════════════════════
     TAB: PHP MYADMIN
  ══════════════════════════════════════════ -->
  <div class="tab-panel" id="panelMyadmin">
    <div class="toolbar" style="border-radius:0 8px 0 0;">
      <span style="font-size:13px;font-weight:600;color:#374151;">
        <i class="fas fa-database" style="color:#7c3aed;margin-right:6px;"></i>
        Database Export
      </span>
    </div>
    <div class="panel" style="padding:28px 28px 24px;">
      <div style="max-width:520px;">

        <h3 style="font-size:15px;color:#1f2937;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
          <i class="fas fa-file-export" style="color:#7c3aed;"></i> Export SQL Dump
        </h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:20px;">
          Export the current database as a <code>.sql</code> file. Choose what to include below.
        </p>

        <div style="margin-bottom:18px;">
          <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">
            Export Mode
          </label>
          <div style="display:flex;flex-direction:column;gap:9px;">
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
              <input type="radio" name="exportMode" value="full" checked style="accent-color:#7c3aed;">
              <span><strong>Structure + Data</strong> — Full export (recommended)</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
              <input type="radio" name="exportMode" value="structure" style="accent-color:#7c3aed;">
              <span><strong>Structure only</strong> — CREATE TABLE statements, no rows</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
              <input type="radio" name="exportMode" value="data" style="accent-color:#7c3aed;">
              <span><strong>Data only</strong> — INSERT statements, no schema</span>
            </label>
          </div>
        </div>

        <button class="btn btn-add" style="margin-left:0;" onclick="exportDatabase()">
          <i class="fas fa-download"></i> Download SQL
        </button>

        <div id="exportStatus" style="display:none;margin-top:14px;font-size:13px;color:#6b7280;">
          <span class="spinner"></span> Preparing export…
        </div>
      </div>
    </div>
  </div><!-- /panelMyadmin -->

  <!-- ══════════════════════════════════════════
       MODALS — USER FORM (Add / Edit)
  ══════════════════════════════════════════ -->
  <div class="modal-overlay" id="userFormModal">
    <div class="modal-box">
      <h3 id="userFormTitle">
        <i class="fas fa-user-plus" style="color:#7c3aed"></i> Add New User
      </h3>
      <div class="err-box" id="userFormErr"></div>
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
          <span id="pwHint" style="font-weight:400;color:#9ca3af">(min 8 chars, upper, lower, number)</span>
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
        <button class="btn-cancel" onclick="closeModal('userFormModal')">Cancel</button>
        <button class="btn-confirm" id="btnUserFormSubmit" onclick="submitUserForm()">
          <i class="fas fa-save"></i> Register User
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL — Delete User Confirm -->
  <div class="modal-overlay" id="deleteUserModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;
                  display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Delete User?</h3>
      <p id="deleteUserMsg">Are you sure? This action cannot be undone.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-cancel" onclick="closeModal('deleteUserModal')">Cancel</button>
        <button class="btn-danger" id="btnConfirmDeleteUser" onclick="confirmDeleteUser()">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════
       MODALS — SYSTEM LOG 
  ══════════════════════════════════════════ -->

  <div class="modal-overlay" id="viewLogModal">
    <div class="modal-box">
      <h3><i class="fas fa-info-circle" style="color:#6d28d9"></i> Log Details</h3>
      <div class="log-detail-grid" id="viewLogContent"></div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal('viewLogModal')">Close</button>
      </div>
    </div>
  </div>

  <!-- MODAL — Delete Single Log -->
  <div class="modal-overlay" id="deleteSingleLogModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;
                  display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Confirm Delete</h3>
      <p id="deleteSingleLogMsg">Delete this log entry? This cannot be undone.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-cancel" onclick="closeModal('deleteSingleLogModal')">Cancel</button>
        <button class="btn-danger" id="btnConfirmDeleteLog" onclick="deleteSingleLog()">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL — Delete All Logs -->
  <div class="modal-overlay" id="deleteAllLogsModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;
                  display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Confirm Delete All</h3>
      <p>Delete <strong>all system log records</strong>? This <strong>cannot be undone</strong>.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn-cancel" onclick="closeModal('deleteAllLogsModal')">Cancel</button>
        <button class="btn-danger" id="btnConfirmDeleteAllLogs" onclick="deleteAllLogs()">
          <i class="fas fa-trash"></i> Yes, Delete All
        </button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast">
    <i class="fas fa-check-circle" id="toastIcon"></i>
    <span id="toastMsg">Done</span>
  </div>

  <script src="../src/btn.js"></script>
  <script>
    /* ── Server constants ── */
    const IS_ADMIN = <?= $isAdmin ? 'true' : 'false' ?>;
    const SESSION_UID = <?= $sessionUserId ?>;

    const COLORS = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922', '#BA7517'];

    /* ══════════════════════════════════════════════════════════════════
       TAB SWITCHING
    ══════════════════════════════════════════════════════════════════ */
    let activeTab = 'users';

    function switchTab(tab) {
      activeTab = tab;
      ['users', 'group', 'logs', 'myadmin'].forEach(t => {
        document.getElementById('tabBtn' + cap(t)).classList.toggle('active', t === tab);
        document.getElementById('panel' + cap(t)).classList.toggle('active', t === tab);
      });

      if (tab === 'logs' && allLogs.length === 0) {
        loadLogActionOptions();
        loadLogs().then(startLogsCountdown);
      }
    }

    const TAB_IDS = {
      users: {
        btn: 'tabBtnUsers',
        panel: 'panelUsers'
      },
      group: {
        btn: 'tabBtnGroup',
        panel: 'panelGroup'
      },
      logs: {
        btn: 'tabBtnLogs',
        panel: 'panelLogs'
      },
      myadmin: {
        btn: 'tabBtnMyAdmin',
        panel: 'panelMyadmin'
      },
    };

    function switchTab(tab) {
      activeTab = tab;
      Object.entries(TAB_IDS).forEach(([t, ids]) => {
        document.getElementById(ids.btn).classList.toggle('active', t === tab);
        document.getElementById(ids.panel).classList.toggle('active', t === tab);
      });
      if (tab === 'logs' && allLogs.length === 0) {
        loadLogActionOptions();
        loadLogs().then(startLogsCountdown);
      }
    }

    /* ══════════════════════════════════════════════════════════════════
       SHARED HELPERS
    ══════════════════════════════════════════════════════════════════ */
    let anyModalOpen = false;

    function openModal(id) {
      anyModalOpen = true;
      document.getElementById(id).classList.add('show');
      updateUsersCountdownUI();
      updateLogsCountdownUI();
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('show');
      anyModalOpen = false;
      updateUsersCountdownUI();
      updateLogsCountdownUI();
    }

    /* ── Event Listener ── */
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target === el) closeModal(el.id);
      });
    });

    document.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        const openModal = document.querySelector(".modal-overlay.show");
        if (!openModal) return;

        if (openModal.id === "userFormModal") {
          submitUserForm();
        } else if (openModal.id === "deleteUserModal") {
          confirmDeleteUser();
        } else if (openModal.id === "deleteSingleLogModal") {
          deleteSingleLog();
        } else if (openModal.id === "deleteAllLogsModal") {
          deleteAllLogs();
        }
      }
    });

    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        const openModal = document.querySelector(".modal-overlay.show");
        if (openModal) {
          closeModal(openModal.id);
        }
      }
    });

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function hashStr(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
      return h >>> 0;
    }

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

    function paginate(items, page, perPage) {
      const pages = Math.max(1, Math.ceil(items.length / perPage));
      if (page > pages) page = pages;
      return {
        slice: items.slice((page - 1) * perPage, page * perPage),
        pages,
        page
      };
    }

    function paginationHTML(total, pages, currentPage, fn) {
      if (pages <= 1) return `<span>${total} record${total !== 1 ? 's' : ''}</span>`;

      const buttons = [];
      const delta = 2; // pages shown around the current page

      const range = new Set();
      range.add(1);
      range.add(pages);
      for (let i = Math.max(2, currentPage - delta); i <= Math.min(pages - 1, currentPage + delta); i++) {
        range.add(i);
      }

      const sorted = [...range].sort((a, b) => a - b);
      let prev = null;
      for (const p of sorted) {
        if (prev !== null && p - prev > 1) {
          buttons.push(`<span style="padding:0 4px;color:#aaa;line-height:30px;">…</span>`);
        }
        buttons.push(
          `<button class="page-btn${currentPage === p ? ' active' : ''}" onclick="${fn}(${p})">${p}</button>`
        );
        prev = p;
      }

      return `<span>${total} record${total !== 1 ? 's' : ''}</span>
      <button class="page-btn" onclick="${fn}(${Math.max(1, currentPage - 1)})"
      ${currentPage === 1 ? 'disabled style="opacity:.4;cursor:default"' : ''}>‹</button>
      ${buttons.join('')}
      <button class="page-btn" onclick="${fn}(${Math.min(pages, currentPage + 1)})"
      ${currentPage === pages ? 'disabled style="opacity:.4;cursor:default"' : ''}>›</button>`;
    }

    /* ══════════════════════════════════════════════════════════════════
       USERS TAB
    ══════════════════════════════════════════════════════════════════ */
    const U_REFRESH = 30; // seconds
    let allUsers = [];
    let uPage = 1;
    const U_PER = 10;
    let editingUserId = null;
    let pendingDelUserId = null;
    let uDebounce = null;
    let uCountdownLeft = U_REFRESH;
    let uTick = null,
      uRefreshTimer = null;

    function startUsersCountdown() {
      stopUsersCountdown();
      uCountdownLeft = U_REFRESH;
      updateUsersCountdownUI();
      uTick = setInterval(() => {
        if (anyModalOpen) return;
        uCountdownLeft = Math.max(0, uCountdownLeft - 1);
        updateUsersCountdownUI();
      }, 1000);
      uRefreshTimer = setTimeout(async () => {
        if (!anyModalOpen) await loadUsers(true);
        startUsersCountdown();
      }, U_REFRESH * 1000);
    }

    function stopUsersCountdown() {
      clearInterval(uTick);
      clearTimeout(uRefreshTimer);
    }

    function updateUsersCountdownUI() {
      const pct = (uCountdownLeft / U_REFRESH) * 100;
      document.getElementById('uCountdownBar').style.width = pct + '%';
      document.getElementById('uPulseDot').classList.toggle('paused', anyModalOpen);
    }

    async function loadUsers(silent = false) {
      const su = document.getElementById('searchUser').value.trim();
      const se = document.getElementById('searchEmail').value.trim();
      const params = new URLSearchParams({
        action: 'fetch_users'
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
        document.getElementById('tabBadgeUsers').textContent = data.stats.total ?? 0;
        renderUsersTable();
        updateUsersStats(data.stats);
      } catch (err) {
        if (!silent) {
          showToast('Failed to load users: ' + err.message, true);
          document.getElementById('userTableBody').innerHTML =
            `<tr class="empty-row"><td colspan="9"><i class="fas fa-exclamation-circle" style="color:#ef4444"></i> ${escHtml(err.message)}</td></tr>`;
        }
      }
    }

    function renderUsersTable() {
      const tbody = document.getElementById('userTableBody');
      const {
        slice,
        pages,
        page
      } = paginate(allUsers, uPage, U_PER);
      uPage = page;

      if (!slice.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="9">
          <i class="fas fa-users" style="font-size:24px;display:block;margin-bottom:6px;opacity:.4"></i>
          No users found.</td></tr>`;
        document.getElementById('uPaginationWrap').innerHTML = '';
        return;
      }

      tbody.innerHTML = slice.map((u, i) => {
        const idx = (uPage - 1) * U_PER + i;
        const color = COLORS[(u.id - 1) % COLORS.length];
        const init = ((u.first_name || u.username)[0] || '?').toUpperCase();
        const isSelf = +u.id === SESSION_UID;
        const isRoot = +u.id === 1 && u.user_group === 'Administrator';

        const editBtn = !IS_ADMIN ?
          `<div class="lock-wrap">
               <button class="action-btn btn-edit-row" disabled><i class="fas fa-lock" style="opacity:.5"></i> Edit</button>
               <span class="tip">Administrators only</span></div>` :
          `<button class="action-btn btn-edit-row" onclick="openEditUser(${u.id})"><i class="fas fa-edit"></i> Edit</button>`;

        const delBtn = !IS_ADMIN ?
          `<div class="lock-wrap">
               <button class="action-btn btn-del-row" disabled><i class="fas fa-lock" style="opacity:.5"></i> Delete</button>
               <span class="tip">Administrators only</span></div>` :
          isSelf ?
          `<div class="lock-wrap">
               <button class="action-btn btn-del-row" disabled><i class="fas fa-trash"></i> Delete</button></div>` :
          isRoot ?
          `<div class="lock-wrap">
               <button class="action-btn btn-del-row" disabled><i class="fas fa-trash"></i> Delete</button>
               <span class="tip">Root Administrator cannot be deleted</span></div>` :
          `<button class="action-btn btn-del-row" onclick="openDeleteUser(${u.id},'${escHtml(u.username)}')"><i class="fas fa-trash"></i> Delete</button>`;

        return `<tr>
          <td style="color:#aaa">${idx+1}</td>
          <td><div class="user-cell">
            <div class="avatar" style="background:${color}">${init}</div>
            <div>
              <div style="font-weight:600;color:#1f2937">
                ${escHtml(u.username)}${isSelf?' <em style="font-size:11px;color:#9ca3af">(you)</em>':''}
              </div>
              <div style="font-size:11px;color:#9ca3af">${escHtml(u.first_name)} ${escHtml(u.last_name)}</div>
            </div>
          </div></td>
          <td title="${escHtml(u.email)}">${escHtml(u.email||'—')}</td>
          <td>${escHtml(u.user_group||'—')}</td>
          <td>${escHtml(u.phone||'—')}</td>
          <td>${escHtml(u.my_database||'—')}</td>
          <td>${escHtml(u.created_at ? u.created_at.slice(0,16) : '—')}</td>
          <td>${u.last_login ? escHtml(u.last_login.slice(0,16)) : '<span style="color:#d1d5db">—</span>'}</td>
          <td><div style="display:flex;gap:6px;flex-wrap:wrap">${editBtn}${delBtn}</div></td>
        </tr>`;
      }).join('');

      document.getElementById('uPaginationWrap').innerHTML =
        paginationHTML(allUsers.length, pages, uPage, 'uGoPage');
    }

    function uGoPage(p) {
      uPage = p;
      renderUsersTable();
    }

    function updateUsersStats(s) {
      document.getElementById('uStatTotal').textContent = s.total ?? 0;
      document.getElementById('uStatLoggedIn').textContent = s.logged_in ?? 0;
      document.getElementById('uStatNever').textContent = s.never_logged ?? 0;
    }

    function debounceUsers() {
      clearTimeout(uDebounce);
      uDebounce = setTimeout(() => {
        uPage = 1;
        stopUsersCountdown();
        loadUsers().then(startUsersCountdown);
      }, 380);
    }

    function clearUsersSearch() {
      document.getElementById('searchUser').value = '';
      document.getElementById('searchEmail').value = '';
      uPage = 1;
      stopUsersCountdown();
      loadUsers().then(startUsersCountdown);
    }

    /* ── User form ── */
    function clearUserForm() {
      ['fFirstName', 'fLastName', 'fUsername', 'fEmail', 'fPassword', 'fPhone', 'fDatabase']
      .forEach(id => document.getElementById(id).value = '');
      document.getElementById('fUsergroup').value = '';
      const e = document.getElementById('userFormErr');
      e.style.display = 'none';
      e.innerHTML = '';
      ['fFirstName', 'fLastName', 'fUsername', 'fEmail', 'fPhone', 'fDatabase', 'fUsergroup', 'fPassword']
      .forEach(id => document.getElementById(id).disabled = false);
    }

    function openAddUser() {
      if (!IS_ADMIN) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      editingUserId = null;
      clearUserForm();
      document.getElementById('userFormTitle').innerHTML = '<i class="fas fa-user-plus" style="color:#7c3aed"></i> Add New User';
      document.getElementById('pwHint').textContent = '(min 8 chars, upper, lower, number)';
      document.getElementById('btnUserFormSubmit').innerHTML = '<i class="fas fa-save"></i> Register User';
      document.getElementById('fPassword').placeholder = 'Password';
      openModal('userFormModal');
    }

    async function openEditUser(id) {
      if (!IS_ADMIN) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      editingUserId = id;
      clearUserForm();

      document.getElementById('userFormTitle').innerHTML =
        '<i class="fas fa-edit" style="color:#7c3aed"></i> Edit User';
      document.getElementById('pwHint').textContent = '(leave blank to keep current)';
      document.getElementById('fPassword').placeholder = 'Leave blank to keep current password';

      const btn = document.getElementById('btnUserFormSubmit');
      btn.innerHTML = '<span class="spinner"></span> Loading…';
      btn.disabled = true;

      openModal('userFormModal');

      try {
        const res = await fetch(`?action=get_user&id=${id}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const u = data.user;

        document.getElementById('fFirstName').value = u.first_name || '';
        document.getElementById('fLastName').value = u.last_name || '';
        document.getElementById('fUsername').value = u.username || '';
        document.getElementById('fEmail').value = u.email || '';
        document.getElementById('fPhone').value = u.phone || '';
        document.getElementById('fDatabase').value = u.my_database || '';
        document.getElementById('fUsergroup').value = u.user_group || '';

        if (+id === SESSION_UID) {
          document.getElementById('fEmail').disabled = true;
          document.getElementById('fUsergroup').disabled = true;
          document.getElementById('fUsergroup').title = 'You cannot change your own group';
        }

        btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        btn.disabled = false;
      } catch (err) {
        showToast('Failed to load user: ' + err.message, true);
        closeModal('userFormModal');
      }
    }

    async function submitUserForm() {
      if (!IS_ADMIN) {
        showToast("Access denied.", true);
        return;
      }

      const payload = {
        first_name: document.getElementById("fFirstName").value.trim(),
        last_name: document.getElementById("fLastName").value.trim(),
        username: document.getElementById("fUsername").value.trim(),
        email: document.getElementById("fEmail").value.trim(),
        user_group: document.getElementById("fUsergroup").value,
        password: document.getElementById("fPassword").value,
        phone: document.getElementById("fPhone").value.trim(),
        my_database: document.getElementById("fDatabase").value.trim(),
      };

      const errBox = document.getElementById("userFormErr");

      const showError = (msg) => {
        errBox.style.display = "block";
        errBox.textContent = msg;
      };

      if (!payload.user_group) {
        showError("Please select a User Group.");
        return;
      }

      errBox.style.display = "none";

      const btn = document.getElementById("btnUserFormSubmit");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving…';

      const url = editingUserId ?
        `?action=update_user&id=${editingUserId}` :
        `?action=add_user`;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!data.success) {
          showError((data.errors || [data.message]).join("\n"));
          return;
        }

        closeModal("userFormModal");
        showToast(data.message);
        uPage = 1;
        stopUsersCountdown();
        await loadUsers();
        startUsersCountdown();
      } catch (err) {
        showToast("Error: " + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = editingUserId ?
          '<i class="fas fa-save"></i> Save Changes' :
          '<i class="fas fa-save"></i> Register User';
      }
    }

    function openDeleteUser(id, username) {
      if (!IS_ADMIN) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      pendingDelUserId = id;
      document.getElementById('deleteUserMsg').innerHTML =
        `Delete <strong>${escHtml(username)}</strong>? This cannot be undone.`;
      openModal('deleteUserModal');
    }

    async function confirmDeleteUser() {
      if (!IS_ADMIN || !pendingDelUserId) return;
      const btn = document.getElementById('btnConfirmDeleteUser');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';
      try {
        const res = await fetch(`?action=delete_user&id=${pendingDelUserId}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        pendingDelUserId = null;
        closeModal('deleteUserModal');
        showToast(data.message);
        stopUsersCountdown();
        await loadUsers();
        startUsersCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    }

    /* ══════════════════════════════════════════════════════════════════
       LOGS TAB
    ══════════════════════════════════════════════════════════════════ */
    const L_REFRESH = 10; // seconds
    let allLogs = [];
    let lPage = 1;
    const L_PER = 10;
    let pendingDelLogId = null;
    let lDebounce = null;
    let lCountdownLeft = L_REFRESH;
    let lTick = null,
      lRefreshTimer = null;

    function startLogsCountdown() {
      stopLogsCountdown();
      lCountdownLeft = L_REFRESH;
      updateLogsCountdownUI();
      lTick = setInterval(() => {
        if (anyModalOpen) return;
        lCountdownLeft = Math.max(0, lCountdownLeft - 1);
        updateLogsCountdownUI();
      }, 1000);
      lRefreshTimer = setTimeout(async () => {
        if (!anyModalOpen) await loadLogs(true);
        startLogsCountdown();
      }, L_REFRESH * 1000);
    }

    function stopLogsCountdown() {
      clearInterval(lTick);
      clearTimeout(lRefreshTimer);
    }

    function updateLogsCountdownUI() {
      const pct = (lCountdownLeft / L_REFRESH) * 100;
      document.getElementById('lCountdownBar').style.width = pct + '%';
      const dot = document.getElementById('lPulseDot');
      if (dot) dot.classList.toggle('paused', anyModalOpen);
    }

    function badgeClass(action) {
      const a = action.toUpperCase();
      if (a.includes('LOGIN') && !a.includes('OUT')) return 'badge-login';
      if (a.includes('LOGOUT') || a.includes('_OUT')) return 'badge-logout';
      if (a.includes('CREATED') || a.includes('REGISTERED')) return 'badge-create';
      if (a.includes('UPDATED')) return 'badge-update';
      if (a.includes('DELETED')) return 'badge-delete';
      return 'badge-default';
    }

    async function loadLogs(silent = false) {
      const search = document.getElementById('logSearchInput').value.trim();
      const action = document.getElementById('logActionFilter').value;
      const params = new URLSearchParams({
        action: 'fetch_logs'
      });
      if (search) params.append('search', search);
      if (action) params.append('action_filter', action);

      if (!silent) {
        document.getElementById('logTableBody').innerHTML =
          `<tr class="empty-row"><td colspan="8"><span class="spinner"></span> Loading…</td></tr>`;
      }
      try {
        const res = await fetch('?' + params.toString());
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Fetch failed');
        allLogs = data.logs;
        document.getElementById('tabBadgeLogs').textContent = data.stats.total ?? 0;
        renderLogsTable();
        updateLogsStats(data.stats);
      } catch (err) {
        if (!silent) {
          showToast('Failed to load logs: ' + err.message, true);
          document.getElementById('logTableBody').innerHTML =
            `<tr class="empty-row"><td colspan="8"><i class="fas fa-exclamation-circle" style="color:#ef4444"></i> ${escHtml(err.message)}</td></tr>`;
        }
      }
    }

    function renderLogsTable() {
      const tbody = document.getElementById('logTableBody');
      const {
        slice,
        pages,
        page
      } = paginate(allLogs, lPage, L_PER);
      lPage = page;

      if (!slice.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8">
          <i class="fas fa-inbox" style="font-size:24px;display:block;margin-bottom:6px;opacity:.4"></i>
          No log records found.</td></tr>`;
        document.getElementById('lPaginationWrap').innerHTML = '';
        return;
      }

      tbody.innerHTML = slice.map((log, i) => {
        const idx = (lPage - 1) * L_PER + i;
        const colorKey = log.user_id ? log.user_id : log.username;
        const color = COLORS[Math.abs(hashStr(String(colorKey))) % COLORS.length];
        const init = (log.username[0] || '?').toUpperCase();
        return `<tr>
          <td>${idx+1}</td>
          <td><div class="user-cell">
            <div class="avatar" style="background:${color}">${init}</div>
            <span>${escHtml(log.username||'—')}</span>
          </div></td>
          <td><span class="badge ${badgeClass(log.action)}">${escHtml(log.action)}</span></td>
          <td class="details-cell" title="${escHtml(log.details||'')}">${escHtml(log.details||'—')}</td>
          <td>${escHtml(log.ip_address||'—')}</td>
          <td class="details-cell" title="${escHtml(log.user_agent||'')}">${escHtml(log.user_agent||'—')}</td>
          <td>${escHtml(log.created_at||'—')}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="action-btn btn-view-log" onclick="viewLog(${log.id})"><i class="fas fa-eye"></i> View</button>
            <button class="action-btn btn-del-log"  onclick="openDeleteLog(${log.id},'${escHtml(log.username||'this entry')}')"><i class="fas fa-trash"></i> Delete</button>
          </td>
        </tr>`;
      }).join('');

      document.getElementById('lPaginationWrap').innerHTML =
        paginationHTML(allLogs.length, pages, lPage, 'lGoPage');
    }

    function lGoPage(p) {
      lPage = p;
      renderLogsTable();
    }

    function updateLogsStats(s) {
      document.getElementById('lStatTotal').textContent = s.total ?? 0;
      document.getElementById('lStatLogins').textContent = s.logins ?? 0;
      document.getElementById('lStatUpdates').textContent = s.updates ?? 0;
      document.getElementById('lStatDeletes').textContent = s.deletes ?? 0;
    }

    function debounceLogs() {
      clearTimeout(lDebounce);
      lDebounce = setTimeout(() => {
        lPage = 1;
        stopLogsCountdown();
        loadLogs().then(startLogsCountdown);
      }, 400);
    }

    function clearLogsSearch() {
      document.getElementById('logSearchInput').value = '';
      document.getElementById('logActionFilter').value = '';
      lPage = 1;
      stopLogsCountdown();
      loadLogs().then(startLogsCountdown);
    }

    function viewLog(id) {
      const log = allLogs.find(l => +l.id === +id);
      if (!log) return;
      document.getElementById('viewLogContent').innerHTML = `
        <div class="log-detail-row"><span class="ldr-label">Log ID</span><span class="ldr-val">#${escHtml(String(log.id))}</span></div>
        <div class="log-detail-row"><span class="ldr-label">User</span><span class="ldr-val">${escHtml(log.username||'—')} (ID: ${escHtml(String(log.user_id||'—'))})</span></div>
        <div class="log-detail-row"><span class="ldr-label">Action</span><span class="ldr-val"><span class="badge ${badgeClass(log.action)}">${escHtml(log.action)}</span></span></div>
        <div class="log-detail-row"><span class="ldr-label">Details</span><span class="ldr-val">${escHtml(log.details||'—')}</span></div>
        <div class="log-detail-row"><span class="ldr-label">IP Address</span><span class="ldr-val">${escHtml(log.ip_address||'—')}</span></div>
        <div class="log-detail-row"><span class="ldr-label">User Agent</span><span class="ldr-val">${escHtml(log.user_agent||'—')}</span></div>
        <div class="log-detail-row"><span class="ldr-label">Created At</span><span class="ldr-val">${escHtml(log.created_at||'—')}</span></div>
      `;
      openModal('viewLogModal');
    }

    function openDeleteLog(id, username) {
      pendingDelLogId = id;
      document.getElementById('deleteSingleLogMsg').innerHTML =
        `Delete log entry for <strong>${escHtml(username)}</strong>? This cannot be undone.`;
      openModal('deleteSingleLogModal');
    }

    async function deleteSingleLog() {
      if (!pendingDelLogId) return;
      const btn = document.getElementById('btnConfirmDeleteLog');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';
      try {
        const res = await fetch(`?action=delete_log&id=${pendingDelLogId}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Delete failed');
        pendingDelLogId = null;
        closeModal('deleteSingleLogModal');
        showToast('Log entry deleted successfully.');
        stopLogsCountdown();
        await loadLogs();
        loadLogActionOptions();
        startLogsCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    }

    function confirmDeleteAllLogs() {
      openModal('deleteAllLogsModal');
    }

    async function deleteAllLogs() {
      const btn = document.getElementById('btnConfirmDeleteAllLogs');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';
      try {
        const res = await fetch(`?action=delete_all_logs`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Delete all failed');
        closeModal('deleteAllLogsModal');
        showToast(`All log records deleted (${data.deleted} total).`);
        stopLogsCountdown();
        await loadLogs();
        loadLogActionOptions();
        startLogsCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Yes, Delete All';
      }
    }

    /* ══════════════════════════════════════════════════════════════════
       EXPORT DATABASE
    ══════════════════════════════════════════════════════════════════ */

    function exportDatabase() {
      const mode = document.querySelector('input[name="exportMode"]:checked')?.value || 'full';
      const status = document.getElementById('exportStatus');
      status.style.display = 'flex';
      status.style.alignItems = 'center';
      status.style.gap = '8px';

      // Trigger file download via hidden link
      const link = document.createElement('a');
      link.href = `?action=export_db&mode=${mode}`;
      link.click();

      setTimeout(() => {
        status.style.display = 'none';
      }, 3000);
    }

    /* ══════════════════════════════════════════════════════════════════
       INIT
    ══════════════════════════════════════════════════════════════════ */
    async function loadLogActionOptions() {
      try {
        const res = await fetch('?action=fetch_log_actions');
        const data = await res.json();
        if (!data.success) return;
        const sel = document.getElementById('logActionFilter');
        // Keep only the "All Actions" default option
        sel.innerHTML = '<option value="">All Actions</option>';
        data.actions.forEach(action => {
          const opt = document.createElement('option');
          opt.value = action;
          opt.textContent = action;
          sel.appendChild(opt);
        });
      } catch (err) {
        console.warn('Could not load log action options:', err);
      }
    }

    loadUsers().then(startUsersCountdown);
    // Logs load lazily when tab is first opened
  </script>
</body>

</html>