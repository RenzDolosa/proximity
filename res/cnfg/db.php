<?php
//db.php - handles database connection for user sessions and portal access

require_once 'config.php';

// ── Auth guard FIRST (before anything else) ───────────────────────────────────
if (!isset($_SESSION['user_id']) || !isLoggedIn()) {
  $isEmbedded = isset($_SERVER['HTTP_SEC_FETCH_DEST']) && $_SERVER['HTTP_SEC_FETCH_DEST'] === 'iframe';

  if ($isEmbedded) {
    echo '<!DOCTYPE html><html><body><script>window.top.location.href = "../../index.php";</script></body></html>';
  } else {
    header('Location: ../../index.php');
  }
  exit;
}

$group          = $_SESSION['user_group'] ?? '';
$isAdminSession = ($group === 'Administrator');
$userId         = $_SESSION['user_id'];
$myDatabase     = $_SESSION['my_database'] ?? 'My Database';
$userDbName     = USER_DB_PREFIX . $userId;
$username       = $_SESSION['username'] ?? 'User';
$email          = $_SESSION['email'] ?? '';
$phoneNum       = $_SESSION['phone'] ?? '';

// Handle logout
if (isset($_GET['logout'])) {
  logSystemAction($userId, 'USER_LOGOUT', 'User logged out');
  session_destroy();
  $isEmbedded = isset($_SERVER['HTTP_SEC_FETCH_DEST']) && $_SERVER['HTTP_SEC_FETCH_DEST'] === 'iframe';
  if ($isEmbedded) {
    echo '<!DOCTYPE html><html><body><script>window.top.location.href = "../../index.php";</script></body></html>';
  } else {
    header('Location: ../../index.php');
  }
  exit;
}

// Get user database connection
try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError = $e->getMessage();
}

$isAdmin       = ($group === 'Administrator');
$sessionUserId = (int)$userId;