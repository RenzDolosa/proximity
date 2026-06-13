<?php
// config/resolve.php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/paths.php';

header('Content-Type: application/json');

$body  = json_decode(file_get_contents('php://input'), true);
$token = $body['token'] ?? '';

// Guard in case constants aren't defined
if (!defined('ROUTE_TOKENS') || !defined('PUBLIC_TOKENS')) {
  http_response_code(500);
  echo json_encode(['error' => 'Route config not loaded']);
  exit;
}

if (isset(PUBLIC_TOKENS[$token])) {
  echo json_encode(['url' => PUBLIC_TOKENS[$token]]);
  exit;
}

if (!isset($_SESSION['user_id'])) {
  http_response_code(403);
  echo json_encode(['error' => 'unauthenticated']);
  exit;
}

if (!isset(ROUTE_TOKENS[$token])) {
  http_response_code(404);
  echo json_encode(['error' => 'not found']);
  exit;
}

echo json_encode(['url' => ROUTE_TOKENS[$token]]);