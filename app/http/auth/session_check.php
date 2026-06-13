<?php
// app/http/auth/session_check.php --> login sessions checker

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';

header('Content-Type: application/json');

$rootUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http')
         . '://' . $_SERVER['HTTP_HOST'] . ROUTE_LOGIN;

if (!isset($_SESSION['user_id']) || !isLoggedIn()) {
  http_response_code(401);
  echo json_encode([
    'success'         => false,
    'unauthenticated' => true,
    'message'         => 'Session expired.',
    'redirect'        => $rootUrl,
  ]);
  exit;
}

echo json_encode(['success' => true, 'user_id' => (int)$_SESSION['user_id']]);