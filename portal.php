<?php
// portal.php --> portal iframe for main.php

require_once 'config/config.php';
require_once 'config/db.php';
require_once 'config/req.php';

requireAccess('portal', 'proximity.php', true);
$access = getMenuAccess();

$user = getCurrentUser();
$message = '';
$messageType = '';

try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
  $requiredTables = ['employees', 'code', 'employee_access_log', 'check_in_out'];
  $missingTables = [];

  if ($databaseConnected) {
    try {
      foreach ($requiredTables as $table) {
        $stmt = $userDb->prepare("
        SELECT COUNT(*) FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ");
        $stmt->execute([$table]);
        if ((int)$stmt->fetchColumn() === 0) {
          $missingTables[] = $table;
        }
      }

      if (!empty($missingTables)) {
        $databaseConnected = false;
      }
    } catch (PDOException $e) {
      $databaseConnected = false;
      $dbError = "Error checking tables: " . $e->getMessage();
    }
  }
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError = $e->getMessage();
}

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  if (isset($_POST['change_password'])) {
    $currentPassword = $_POST['current_password'];
    $newPassword     = $_POST['new_password'];
    $confirmPassword = $_POST['confirm_password'];

    $errors = [];

    if (empty($currentPassword) || empty($newPassword) || empty($confirmPassword)) {
      $errors[] = "All password fields are required";
    }

    if ($newPassword !== $confirmPassword) {
      $errors[] = "New passwords do not match";
    }

    if (!isValidPassword($newPassword)) {
      $errors[] = "Password must be at least 8 characters with uppercase, lowercase, and number";
    }

    if (empty($errors)) {
      try {
        $pdo  = getMainDBConnection();
        $stmt = $pdo->prepare("SELECT password FROM users WHERE id = ?");
        $stmt->execute([$user['id']]);
        $currentHash = $stmt->fetchColumn();

        if (password_verify($currentPassword, $currentHash)) {
          // Prevent reusing the same password
          if (password_verify($newPassword, $currentHash)) {
            $message     = 'New password must be different from your current password.';
            $messageType = 'error';
          } else {
            $newHash     = password_hash($newPassword, PASSWORD_DEFAULT);
            $updateStmt  = $pdo->prepare("UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?");
            $updateStmt->execute([$newHash, $user['id']]);

            logSystemAction($user['id'], 'PASSWORD_CHANGED', 'User changed password via portal');

            $message     = 'Password changed successfully!';
            $messageType = 'success';
          }
        } else {
          $message     = 'Current password is incorrect.';
          $messageType = 'error';
        }
      } catch (PDOException $e) {
        error_log("Password change error: " . $e->getMessage());
        $message     = 'An error occurred while changing your password.';
        $messageType = 'error';
      }
    } else {
      $message     = implode(', ', $errors);
      $messageType = 'error';
    }
  }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'My Database'); ?> - Portal</title>
  <link rel="preload" href="resource/icon/database-icon.png" as="image">
  <link rel="icon" href="resource/assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    *,
    *::before,
    *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :root {
      --sidebar-w: 54px;
      --sidebar-expanded: 220px;
      --topbar-h: 50px;
      --accent: #2563eb;
      --accent-light: #eff6ff;
      --bg: #f0f2f5;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #1e293b;
      --text-muted: #64748b;
      --sidebar-bg: #1e2433;
      --sidebar-text: #cbd5e1;
      --sidebar-hover: rgba(255, 255, 255, 0.08);
      --sidebar-active: rgba(37, 99, 235, 0.25);
      --sidebar-active-text: #60a5fa;
      --radius: 8px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      display: flex;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: var(--sidebar-w);
      background: var(--sidebar-bg);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      height: 100vh;
      position: fixed;
      left: 0;
      top: 0;
      z-index: 100;
      overflow: hidden;
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .sidebar:hover {
      width: var(--sidebar-expanded);
    }

    .sidebar-logo {
      height: var(--topbar-h);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .sidebar-logo img {
      width: 26px;
      height: 26px;
      object-fit: contain;
      flex-shrink: 0;
    }

    .sidebar-logo-text {
      font-size: 15px;
      font-weight: 600;
      color: #f1f5f9;
      opacity: 0;
      transition: opacity 0.2s ease 0.05s;
      overflow: hidden;
    }

    .sidebar:hover .sidebar-logo-text {
      opacity: 1;
    }

    .sidebar-nav {
      flex: 1;
      padding: 12px 0;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .nav-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #475569;
      padding: 12px 16px 4px;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.2s ease 0.05s;
    }

    .sidebar:hover .nav-section-label {
      opacity: 1;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 0;
      padding-left: 12px;
      color: var(--sidebar-text);
      text-decoration: none;
      cursor: pointer;
      border-radius: 6px;
      margin: 1px 8px;
      transition: background 0.15s, color 0.15s;
      font-size: 13.5px;
      white-space: nowrap;
      overflow: hidden;
    }

    .nav-item:hover {
      background: var(--sidebar-hover);
      color: #f1f5f9;
    }

    .nav-item i {
      width: 16px;
      text-align: center;
      font-size: 14px;
      flex-shrink: 0;
    }

    .nav-item-label {
      opacity: 0;
      transition: opacity 0.2s ease 0.05s;
    }

    .sidebar:hover .nav-item-label {
      opacity: 1;
    }

    .sidebar-footer {
      padding: 5px 0;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      overflow: hidden;
    }

    /* ── Top bar ── */
    .topbar {
      position: fixed;
      top: 0;
      left: var(--sidebar-w);
      right: 0;
      height: var(--topbar-h);
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      z-index: 150;
      transition: left 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .sidebar:hover ~ .topbar,
    .sidebar:hover ~ * .topbar {
      left: var(--sidebar-expanded);
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .breadcrumb {
      font-size: 13px;
      color: var(--text-muted);
    }

    .breadcrumb strong {
      color: var(--text);
      font-weight: 600;
    }

    .topbar-right {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .db-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      padding: 4px 10px;
      border-radius: 20px;
      font-weight: 500;
    }

    .db-badge.ok {
      background: #dcfce7;
      color: #166534;
    }

    .db-badge.err {
      background: #fee2e2;
      color: #991b1b;
    }

    .db-badge i {
      font-size: 10px;
    }

    /* ── User wrapper & dropdown ── */
    .user-wrapper {
      position: relative;
    }

    .user-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text);
      padding: 5px 12px 5px 6px;
      border-radius: 20px;
      border: 1px solid var(--border);
      cursor: pointer;
      transition: background 0.15s;
      user-select: none;
    }

    .user-pill:hover {
      background: #f8fafc;
    }

    .user-avatar {
      width: 28px;
      height: 28px;
      background: var(--accent);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .user-chevron {
      font-size: 10px;
      color: var(--text-muted);
      transition: transform 0.2s;
      margin-left: 2px;
    }

    .user-chevron.open {
      transform: rotate(180deg);
    }

    .user-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      min-width: 200px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
      display: none;
      z-index: 9999;
      overflow: hidden;
    }

    .user-dropdown.open {
      display: block;
    }

    .dropdown-header {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
    }

    .dropdown-header .dh-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }

    .dropdown-header .dh-sub {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .dropdown-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      font-size: 13px;
      color: var(--text);
      cursor: pointer;
      transition: background 0.12s;
      text-decoration: none;
    }

    .dropdown-item:hover {
      background: var(--accent-light);
      color: var(--accent);
    }

    .dropdown-item i {
      width: 14px;
      font-size: 13px;
      color: var(--text-muted);
    }

    .dropdown-item:hover i {
      color: var(--accent);
    }

    .dropdown-divider {
      border: none;
      border-top: 1px solid var(--border);
      margin: 4px 0;
    }

    .dropdown-item.danger {
      color: #dc2626;
    }

    .dropdown-item.danger i {
      color: #dc2626;
    }

    .dropdown-item.danger:hover {
      background: #fee2e2;
      color: #991b1b;
    }

    /* ── Change Password Modal ── */
    .cp-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    }

    .cp-overlay.open {
      display: flex;
    }

    .cp-modal {
      background: var(--surface);
      border-radius: var(--radius);
      border: 1px solid var(--border);
      width: 380px;
      max-width: 95vw;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
    }

    .cp-modal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
    }

    .cp-modal-head h3 {
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
    }

    .cp-close {
      background: none;
      border: none;
      font-size: 16px;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
    }

    .cp-close:hover {
      background: #f1f5f9;
      color: var(--text);
    }

    .cp-modal-body {
      padding: 18px;
    }

    .cp-field {
      margin-bottom: 14px;
    }

    .cp-field label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      margin-bottom: 5px;
    }

    .cp-field input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 13px;
      color: var(--text);
      background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s;
      outline: none;
    }

    .cp-field input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .cp-msg {
      font-size: 12px;
      padding: 8px 10px;
      border-radius: 6px;
      display: none;
      margin-top: 4px;
    }

    .cp-msg.err {
      background: #fee2e2;
      color: #991b1b;
      display: block;
    }

    .cp-msg.ok {
      background: #dcfce7;
      color: #166534;
      display: block;
    }

    .cp-modal-foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 18px;
      border-top: 1px solid var(--border);
    }

    .cp-btn-cancel {
      padding: 7px 16px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--surface);
      font-size: 13px;
      cursor: pointer;
      color: var(--text);
      transition: background 0.15s;
    }

    .cp-btn-cancel:hover {
      background: #f8fafc;
    }

    .cp-btn-confirm {
      padding: 7px 16px;
      border: none;
      border-radius: 6px;
      background: var(--accent);
      color: #fff;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }

    .cp-btn-confirm:hover {
      background: #1d4ed8;
    }

    .cp-btn-confirm:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* ── Main content ── */
    .main-wrap {
      margin-left: var(--sidebar-w);
      margin-top: var(--topbar-h);
      height: calc(100vh - var(--topbar-h));
      width: calc(100vw - var(--sidebar-w));
      overflow: hidden;
      transition: margin-left 0.25s cubic-bezier(0.4, 0, 0.2, 1),
        width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .main-wrap iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }

    .version-tag {
      font-size: 11px;
      color: #475569;
      text-align: center;
      padding: 8px;
      white-space: nowrap;
      opacity: 0;
      transition: opacity 0.2s ease 0.05s;
    }

    .sidebar:hover .version-tag {
      opacity: 1;
    }
  </style>
</head>

<body>

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <img src="resource/assets/logo/mysql.svg" alt="Logo" style="color: white; filter: invert(1);">
      <span class="sidebar-logo-text"><?= htmlspecialchars($myDatabase ?? 'My Database'); ?></span>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section-label">Main</div>

      <div class="nav-item" onclick="document.querySelector('.frames').src='resource/views/iframe/main.php';">
        <i class="fas fa-home"></i> <span class="nav-item-label">Home</span>
      </div>

      <?php if ($access['proximity']): ?>
        <div class="nav-item" onclick="window.location.href='proximity.php';">
          <img src="../../../resource/assets/icon/nfc-icon.svg" alt="NFC Icon" loading="lazy" style="width: 20px; filter: invert(0.8);"> <span class="nav-item-label">Proximity</span>
        </div>
      <?php endif; ?>

      <?php if ($access['employee dashboard']): ?>
        <div class="nav-item" onclick="document.querySelector('.frames').src='resource/views/iframe/main.php?page=employee dashboard';">
          <i class="fas fa-chart-bar"></i> <span class="nav-item-label">Employee Dashboard</span>
        </div>
      <?php endif; ?>

      <?php if ($access['admin panel']): ?>
        <div class="nav-item" onclick="document.querySelector('.frames').src='resource/views/iframe/main.php?page=admin panel';">
          <i class="fas fa-user-shield"></i> <span class="nav-item-label">Admin Panel</span>
        </div>
      <?php endif; ?>
    </nav>

    <div class="sidebar-footer">
      <version_compare>
        <div class="version-tag" id="version"></div>
      </version_compare>
      <div class="nav-item" onclick="document.querySelector('.frames').src='resource/views/iframe/main.php?page=settings';">
        <i class="fas fa-cog"></i> <span class="nav-item-label">Settings</span>
      </div>
    </div>
  </aside>

  <!-- Top bar -->
  <header class="topbar">
    <div class="topbar-left">
      <div class="breadcrumb">
        <strong>Portal</strong> <span>&nbsp;/ Management Panel</span>
      </div>
    </div>
    <div class="topbar-right">

      <?php if ($databaseConnected): ?>
        <div class="db-badge ok"><i class="fas fa-circle"></i> DB Connected</div>
      <?php else: ?>
        <div class="db-badge err"><i class="fas fa-exclamation-circle"></i> DB Error</div>
      <?php endif; ?>

      <!-- User pill with dropdown -->
      <div class="user-wrapper" id="userWrapper">
        <div class="user-pill" id="userPill">
          <div class="user-avatar"><?= strtoupper(substr($username ?? 'U', 0, 1)); ?></div>
          <?= htmlspecialchars($username ?? 'User'); ?>
          <i class="fas fa-chevron-down user-chevron" id="userChevron"></i>
        </div>

        <div class="user-dropdown" id="userDropdown">
          <div class="dropdown-header" <?php if ($access['account info']): ?> onclick="document.querySelector('.frames').src='resource/views/iframe/main.php?page=account';" <?php endif; ?>>
            <div class="dh-name"><i class="fas fa-user-circle"></i> <?= htmlspecialchars($username ?? 'User'); ?></div>
            <div class="dh-sub"><?= htmlspecialchars($user['user_group'] ?? 'User'); ?></div>
          </div>
          <div class="dropdown-item" id="changePassBtn">
            <i class="fas fa-lock"></i> Change Password
          </div>
          <hr class="dropdown-divider">
          <a class="dropdown-item danger" href="?logout=1">
            <i class="fas fa-sign-out-alt"></i> Logout
          </a>
        </div>
      </div>

    </div>
  </header>

  <!-- Change Password Modal — submits as a normal POST form to portal.php -->
  <div class="cp-overlay" id="cpOverlay">
    <div class="cp-modal">
      <div class="cp-modal-head">
        <h3><i class="fas fa-lock" style="margin-right:6px;font-size:13px;"></i>Change Password</h3>
        <button class="cp-close" id="cpClose" type="button">&#x2715;</button>
      </div>

      <form method="POST" action="portal.php" id="cpForm">
        <div class="cp-modal-body">
          <div class="cp-field">
            <label for="current_password">Current Password</label>
            <input type="password" name="current_password" id="cpOld"
                   autocomplete="current-password" placeholder="Enter current password">
          </div>
          <div class="cp-field">
            <label for="new_password">New Password</label>
            <input type="password" name="new_password" id="cpNew"
                   autocomplete="new-password" placeholder="Min. 8 chars, upper, lower, number">
          </div>
          <div class="cp-field">
            <label for="confirm_password">Confirm New Password</label>
            <input type="password" name="confirm_password" id="cpConfirm"
                   autocomplete="new-password" placeholder="Re-enter new password">
          </div>

          <!-- Feedback shown client-side before submit, and server result after reload -->
          <div class="cp-msg <?= $messageType === 'error' ? 'err' : ($messageType === 'success' ? 'ok' : ''); ?>"
               id="cpMsg">
            <?= htmlspecialchars($message); ?>
          </div>
        </div>

        <div class="cp-modal-foot">
          <button type="button" class="cp-btn-cancel" id="cpCancel">Cancel</button>
          <button type="submit" name="change_password" class="cp-btn-confirm" id="cpConfirmBtn">
            Confirm
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- Main iframe -->
  <div class="main-wrap">
    <iframe src="resource/views/iframe/main.php" class="frames" allowfullscreen="allowfullscreen"></iframe>
  </div>

  <script src="resource/js/req.js"></script>
  <script src="resource/js/ver.js"></script>
  <script>
    // ── Iframe session guard ──
    const mainFrame = document.querySelector('.frames');
    if (mainFrame) {
      mainFrame.addEventListener('load', function () {
        try {
          const frameUrl = this.contentWindow.location.href;
          if (frameUrl.includes('index.php') || frameUrl.includes('login')) {
            window.top.location.href = frameUrl;
          }
        } catch (e) {
          window.top.location.href = 'index.php';
        }
      });
    }

    // ── User dropdown ──
    const userPill     = document.getElementById('userPill');
    const userDropdown = document.getElementById('userDropdown');
    const userChevron  = document.getElementById('userChevron');

    function openDropdown() {
      userDropdown.classList.add('open');
      userChevron.classList.add('open');
    }

    function closeDropdown() {
      userDropdown.classList.remove('open');
      userChevron.classList.remove('open');
    }

    userPill.addEventListener('mouseenter', openDropdown);

    document.getElementById('userWrapper').addEventListener('mouseleave', function () {
      setTimeout(function () {
        if (!document.getElementById('userWrapper').matches(':hover')) closeDropdown();
      }, 100);
    });

    userPill.addEventListener('click', function (e) {
      e.stopPropagation();
      userDropdown.classList.contains('open') ? closeDropdown() : openDropdown();
    });

    document.addEventListener('click', closeDropdown);
  </script>
</body>

</html>