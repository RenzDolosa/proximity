<?php
// db.php

require_once 'config.php';

// Redirect to login if not authenticated
if (!isset($_SESSION['user_id'])) {
  header('Location: ../../login.php');
  exit();
}

$userId = $_SESSION['user_id'];
$myDatabase = $_SESSION['my_database'] ?? 'My Database';
$userDbName = USER_DB_PREFIX . $userId;
$username = $_SESSION['username'] ?? 'User';
$email = $_SESSION['email'] ?? '';
$phoneNum = $_SESSION['phone'] ?? '';

// Handle logout
if (isset($_GET['logout'])) {
  logSystemAction($userId, 'USER_LOGOUT', 'User logged out');
  session_destroy();
  header('Location: ../../login.php');
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

?>