<?php
// portal.php --> portal iframe for main.php

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/req.php';

requireAccess('portal', $_SERVER['DOCUMENT_ROOT'] . '/proximity.php');
$access = getMenuAccess();

$user = getCurrentUser();
$message = '';
$messageType = '';

try {
  if (!isset($userDb) || !($userDb instanceof PDO)) {
    $userDb = getUserDBConnection($userId);
  }
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
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    body {
      font-family: "roboto", "arial";
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
      animation: delayed-side-in 0.3s 0.3s forwards;
    }

    @keyframes delayed-side-in {
      to {
        width: var(--sidebar-expanded);
      }
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

    .sidebar:hover~.topbar,
    .sidebar:hover~* .topbar {
      animation: delayed-top-in 0.3s 0.3s forwards;
    }

    @keyframes delayed-top-in {
      to {
        left: var(--sidebar-expanded);
      }
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
      background: var(--accent-light);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--accent);
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
      pointer-events: none;
      transition: opacity 0.2s ease 0.05s;
    }

    .sidebar:hover .version-tag {
      opacity: 1;
      pointer-events: auto;
    }

    .bottom-nav {
      display: none;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 56px;
      background: var(--sidebar-bg);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      align-items: center;
      justify-content: space-evenly;
      z-index: 200;
      padding: 0 4px;
      padding-bottom: env(safe-area-inset-bottom);
    }

    .user-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
      display: block;
    }

    @media (max-width: 640px) {

      .sidebar {
        display: none;
      }

      .topbar {
        left: 0;
        padding: 0 12px;
        height: 48px;
        overflow: visible;
      }

      .breadcrumb {
        font-size: 12px;
      }

      .db-badge .db-label {
        display: none;
      }

      .db-badge {
        padding: 4px 8px;
      }

      .main-wrap {
        margin-left: 0;
        margin-top: 48px;
        width: 100vw;
        height: calc(100vh - 48px - 56px);
      }

      /* ── Bottom nav bar ── */
      .bottom-nav {
        display: flex;
      }

    }

    .bn-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      flex: 1;
      padding: 6px 4px;
      color: var(--sidebar-text);
      cursor: pointer;
      border-radius: 8px;
      transition: color 0.15s, background 0.15s;
      border: none;
      background: none;
      -webkit-tap-highlight-color: transparent;
    }

    .bn-item:active {
      background: rgba(255, 255, 255, 0.07);
    }

    .bn-item.active {
      color: #60a5fa;
    }

    .bn-item:focus {
      outline: none;
    }

    .bn-item i {
      font-size: 17px;
      line-height: 1;
    }

    .bn-item img {
      width: 18px;
      height: 18px;
      filter: invert(0.8);
      opacity: 0.7;
    }

    .bn-item.active img {
      filter: invert(1) sepia(1) saturate(3) hue-rotate(190deg);
      opacity: 1;
    }

    .bn-label {
      font-size: 9px;
      font-weight: 500;
      letter-spacing: 0.02em;
      line-height: 1;
    }

    .bn-item.nfc-btn {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
    }

    .bn-nfc-pill {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: #1e2433;
      border: 2px solid rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0;
      margin-top: -18px;
      box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.35);
    }

    .bn-nfc-pill img {
      width: 22px;
      height: 22px;
      margin: 0;
      filter: invert(1);
      opacity: 1;
    }

    /* ── Notification bell ── */
    .notif-wrapper {
      position: relative;
    }

    .notif-btn {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 14px;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
      position: relative;
      flex-shrink: 0;
    }

    .notif-btn:hover {
      background: #f8fafc;
      color: var(--text);
      border-color: var(--accent);
    }

    .notif-btn.has-new {
      color: var(--accent);
      border-color: var(--accent);
    }

    .notif-pip {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #ef4444;
      border: 1.5px solid var(--surface);
      display: none;
    }

    .notif-pip.visible {
      display: block;
    }

    .notif-dropdown {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      width: 360px;
      max-width: 96vw;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
      display: none;
      z-index: 9999;
      overflow: hidden;
      max-height: calc(100vh - 80px);
      flex-direction: column;
    }

    .notif-dropdown.open {
      display: flex;
    }

    /* Sticky top header */
    .notif-dropdown>.nd-head {
      flex-shrink: 0;
    }

    /* Scrollable middle — live alerts + changelog items */
    .nd-scroll-body {
      overflow-y: auto;
      overflow-x: hidden;
      flex: 1 1 auto;
      scrollbar-width: thin;
      scrollbar-color: #cbd5e1 transparent;
    }

    .nd-scroll-body::-webkit-scrollbar {
      width: 4px;
    }

    .nd-scroll-body::-webkit-scrollbar-track {
      background: transparent;
    }

    .nd-scroll-body::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }

    .nd-scroll-body::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }

    /* Sticky footer */
    .notif-dropdown>.nd-footer {
      flex-shrink: 0;
    }

    .nd-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 11px 14px;
      border-bottom: 1px solid var(--border);
      background: #f8fafc;
    }

    .nd-title {
      font-size: 12.5px;
      font-weight: 600;
      color: var(--text);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .nd-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 8px;
      border-radius: 20px;
      background: var(--accent-light);
      border: 1px solid var(--accent-border);
      color: var(--accent);
    }

    .nd-view-all {
      font-size: 11.5px;
      color: var(--accent);
      cursor: pointer;
      font-weight: 500;
      text-decoration: none;
      transition: opacity 0.15s;
    }

    .nd-view-all:hover {
      opacity: 0.75;
    }

    .nd-item {
      display: flex;
      gap: 11px;
      padding: 11px 14px;
      border-bottom: 1px solid var(--border);
      transition: background 0.12s;
      cursor: default;
    }

    .nd-item:last-child {
      border-bottom: none;
    }

    .nd-item:hover {
      background: #f8fafc;
    }

    .nd-item.nd-new {
      background: var(--accent-light);
    }

    .nd-item.nd-new:hover {
      background: #e0ecff;
    }

    .nd-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 4px;
      background: var(--text-faint);
    }

    .nd-dot.green {
      background: #16a34a;
    }

    .nd-dot.blue {
      background: var(--accent);
    }

    .nd-dot.amber {
      background: #d97706;
    }

    .nd-dot.purple {
      background: #7c3aed;
    }

    .nd-dot.gray {
      background: var(--text-faint);
    }

    .nd-content {
      flex: 1;
      min-width: 0;
    }

    .nd-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 3px;
      flex-wrap: wrap;
    }

    .nd-tag {
      font-size: 9.5px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .nd-tag.green {
      background: #f0fdf4;
      color: #16a34a;
      border: 1px solid #bbf7d0;
    }

    .nd-tag.blue {
      background: var(--accent-light);
      color: var(--accent);
      border: 1px solid var(--accent-border);
    }

    .nd-tag.amber {
      background: #fffbeb;
      color: #d97706;
      border: 1px solid #fde68a;
    }

    .nd-tag.purple {
      background: #faf5ff;
      color: #7c3aed;
      border: 1px solid #e9d5ff;
    }

    .nd-tag.gray {
      background: #f8fafc;
      color: var(--text-muted);
      border: 1px solid var(--border);
    }

    .nd-ver {
      font-size: 10.5px;
      font-weight: 600;
      color: var(--text-muted);
      font-family: 'SFMono-Regular', Consolas, monospace;
    }

    .nd-date {
      font-size: 10.5px;
      color: var(--text-faint);
      margin-left: auto;
    }

    .nd-title-text {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .nd-desc {
      font-size: 11.5px;
      color: var(--text-muted);
      line-height: 1.5;
      display: -webkit-box;
      /* -webkit-line-clamp: 2; */
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .nd-footer {
      padding: 9px 14px;
      border-top: 1px solid var(--border);
      background: #f8fafc;
      text-align: center;
    }

    .nd-footer a {
      font-size: 12px;
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
      cursor: pointer;
    }

    .nd-footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>

<body>

  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <img src="/config/asset.php?t=sk4ds" alt="Logo" style="color: white; filter: invert(1);">
      <span class="sidebar-logo-text"><?= htmlspecialchars($myDatabase ?? 'My Database'); ?></span>
    </div>

    <nav class="sidebar-nav">
      <div class="nav-section-label">Main</div>

      <div class="nav-item" data-action="portal-home">
        <i class="fas fa-home"></i> <span class="nav-item-label">Home</span>
      </div>

      <?php if ($access['proximity']): ?>
        <div class="nav-item" data-action-dir="portal-proximity">
          <img src="/config/asset.php?t=gnks2" alt="NFC Icon" loading="lazy" style="width: 20px; filter: invert(0.9);"> <span class="nav-item-label">Proximity</span>
        </div>
      <?php endif; ?>

      <?php if ($access['facial']): ?>
        <div class="nav-item" data-action-dir="portal-facial">
          <img src="/config/asset.php?t=g4ld2" alt="Face ID" loading="lazy" style="width: 20px; filter: invert(1);"> <span class="nav-item-label">Facial Identification</span>
        </div>
      <?php endif; ?>

      <?php if ($access['employee dashboard']): ?>
        <div class="nav-item" data-action="portal-dashboard">
          <i class="fas fa-chart-bar"></i> <span class="nav-item-label">Employee Dashboard</span>
        </div>
      <?php endif; ?>

      <?php if ($access['admin panel']): ?>
        <div class="nav-item" data-action="portal-adminPanel">
          <i class="fas fa-user-shield"></i> <span class="nav-item-label">Admin Panel</span>
        </div>
      <?php endif; ?>
    </nav>

    <div class="sidebar-footer">
      <version_compare>
        <div class="version-tag" id="version"></div>
      </version_compare>
      <div class="nav-item" data-action="portal-settings">
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
        <div class="db-badge ok"><i class="fas fa-circle"></i> <span class="db-label">DB Connected</span></div>
      <?php else: ?>
        <div class="db-badge err"><i class="fas fa-exclamation-circle"></i> <span class="db-label">DB Error</span></div>
      <?php endif; ?>

      <!-- Notification Bell -->
      <div class="notif-wrapper" id="notifWrapper">
        <button class="notif-btn has-new" id="notifBtn" aria-label="Notifications">
          <i class="fas fa-bell"></i>
          <span class="notif-pip visible" id="notifPip"></span>
        </button>

        <div class="notif-dropdown" id="notifDropdown">
          <div class="nd-head">
            <span class="nd-title">
              <i class="fas fa-bell" style="color:#2563eb;font-size:12px;"></i>
              Notification
              <span class="nd-badge" id="ndBadge">1 new</span>
            </span>
            <a class="nd-view-all" data-action="portal-about" onclick="closeNotif();">View all</a>
          </div>

          <div class="nd-scroll-body" id="ndScrollBody">
          </div>

          <div class="nd-footer">
            <a data-action="portal-about" onclick="closeNotif();">
              <i class="fas fa-arrow-right" style="font-size:11px;margin-right:4px;"></i> Open full changelog in About
            </a>
          </div>
        </div>
      </div>

      <!-- User pill -->
      <div class="user-wrapper" id="userWrapper">
        <div class="user-pill" id="userPill">
          <div class="user-avatar" id="topbarAvatar">
            <?php if (!empty($_SESSION['avatar'])): ?>
              <img src="/<?= htmlspecialchars($_SESSION['avatar']); ?>"
                style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
            <?php else: ?>
              <?= strtoupper(substr($firstName, 0, 1)); ?>
            <?php endif; ?>
          </div>
          <?= htmlspecialchars($firstName . " " . $lastName ?? 'User'); ?>
          <i class="fas fa-chevron-down user-chevron" id="userChevron"></i>
        </div>

        <div class="user-dropdown" id="userDropdown">
          <div class="dropdown-header" <?php if ($access['account info']): ?> data-action="portal-account" <?php endif; ?>>
            <div class="dh-name"><i class="fas fa-user-circle"></i> <?= htmlspecialchars($firstName . " " . $lastName ?? 'User'); ?></div>
            <div class="dh-sub"><?= htmlspecialchars($user['user_group'] ?? 'User'); ?></div>
          </div>
          <span style="cursor: not-allowed; display:block;">
            <div class="dropdown-item" id="changePassBtn"
              aria-disabled="true"
              tabindex="-1"
              style="opacity:0.4; pointer-events:none;">
              <i class="fas fa-lock"></i> Change Password
            </div>
          </span>
          <?php if ($access['about']) : ?>
            <div class="dropdown-item" data-action="portal-about">
              <i class="fas fa-info-circle"></i> About Us
            </div>
          <?php endif; ?>
          <?php if ($access['readme']) : ?>
            <div class="dropdown-item" data-action="portal-readme">
              <i class="fas fa-book-open"></i> README
            </div>
          <?php endif; ?>
          <hr class="dropdown-divider">
          <a class="dropdown-item danger" tabindex="-1" href="?logout=1">
            <i class="fas fa-sign-out-alt"></i> Logout
          </a>
        </div>
      </div>

    </div>
  </header>

  <!-- Main iframe -->
  <div class="main-wrap">
    <div id="iframeOverlay" style="display:none;position:absolute;inset:0;z-index:1;cursor:default;"></div>
    <iframe class="frames" allowfullscreen="allowfullscreen"></iframe>
  </div>

  <nav class="bottom-nav" id="bottomNav">

    <!-- Home -->
    <button class="bn-item" id="bn-home"
      data-action="portal-home">
      <i class="fas fa-home"></i>
      <span class="bn-label">Home</span>
    </button>

    <!-- Scanned Log / Employee Dashboard -->
    <button class="bn-item" id="bn-dash"
      data-action="portal-dashboard">
      <i class="fas fa-list-alt"></i>
      <span class="bn-label">Log</span>
    </button>

    <!-- Invisible spacer to hold center slot -->
    <div class="bn-item" style="visibility: hidden; pointer-events: none;" aria-hidden="true"></div>

    <!-- NFC — absolutely centered regardless of sibling count -->
    <button class="bn-item nfc-btn" id="bn-nfc"
      <?php if ($access['proximity']): ?>
      data-action-dir="portal-proximity"
      <?php else: ?>
      disabled style="opacity:0.3; cursor:not-allowed;"
      <?php endif; ?>>
      <div class="bn-nfc-pill">
        <img src="/config/asset.php?t=gnks2" alt="NFC">
      </div>
      <span class="bn-label">NFC</span>
    </button>

    <?php if ($access['facial']): ?>
      <!-- Face ID -->
      <button class="bn-item" id="bn-facial"
        data-action-dir="portal-facial">
        <img src="/config/asset.php?t=g4ld2" alt="Face ID" loading="lazy" style="width: 20px; filter: invert(1);">
        <span class="bn-label">Face ID</span>
      </button>
    <?php else: ?>
      <button class="bn-item" id="bn-facial"
        data-action="portal-proxcode">
        <img src="/config/asset.php?t=cfk4d" alt="Code" loading="lazy" style="width: 20px; filter: invert(1);">
        <span class="bn-label">Code</span>
      </button>
    <?php endif; ?>

    <!-- Settings -->
    <button class="bn-item" id="bn-settings"
      data-action="portal-settings">
      <i class="fas fa-cog"></i>
      <span class="bn-label">Settings</span>
    </button>

  </nav>

  <script src="/config/route-config.php?page=portal"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=jl4ds"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=m9n0o"></script>
  <script src="/config/asset.php?t=ipe4s"></script>
  <script>
    (function() {
      const INTERVAL = 10000;
      let wasOffline = false;

      function checkConnectivity(callback) {
        if (!navigator.onLine) {
          callback(false);
          return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);

        fetch('/config/asset.php?t=s3t4u&_=' + Date.now(), {
            method: 'HEAD',
            cache: 'no-store',
            signal: controller.signal
          })
          .then(res => {
            clearTimeout(timeout);
            callback(res.ok);
          })
          .catch(() => {
            clearTimeout(timeout);
            callback(false);
          });
      }

      function handleConnectivity(isOnline) {
        if (!isOnline && !wasOffline) {
          wasOffline = true;
          showAlert('No internet connection', 'warning');
        } else if (isOnline && wasOffline) {
          wasOffline = false;
          showAlert('Back online', 'success');
        }
      }

      function startPolling() {
        checkConnectivity(handleConnectivity);
        setInterval(() => checkConnectivity(handleConnectivity), INTERVAL);
      }

      window.addEventListener('offline', () => handleConnectivity(false));
      window.addEventListener('online', () => checkConnectivity(handleConnectivity));

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startPolling);
      } else {
        startPolling();
      }
    })();
  </script>
</body>

</html>