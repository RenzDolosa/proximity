<?php
// app/http/auth/session_logout.php --> logout sessions

require_once '../../../config/config.php';

header('Content-Type: application/json');

if (isset($_SESSION['user_id'])) {
  logSystemAction($_SESSION['user_id'], 'USER_LOGOUT', 'Session expired — auto logout triggered');
}

// Fully destroy the session
$_SESSION = [];
if (ini_get('session.use_cookies')) {
  $params = session_get_cookie_params();
  setcookie(
    session_name(), '', time() - 42000,
    $params['path'], $params['domain'],
    $params['secure'], $params['httponly']
  );
}
session_destroy();

echo json_encode(['success' => true, 'message' => 'Session destroyed.']);