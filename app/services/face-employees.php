<?php
// app/services/face-employees.php — UNCHANGED
ob_start();
if (session_status() === PHP_SESSION_NONE) session_start();
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
header('Content-Type: application/json');
require_once __DIR__ . '/../../config/config.php';
ob_clean();

if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode(['success' => false, 'message' => 'Authentication required.']);
  exit;
}

$userId   = (int) $_SESSION['user_id'];
$scheme   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host     = $_SERVER['HTTP_HOST'] ?? 'localhost';
$script   = $_SERVER['SCRIPT_NAME'] ?? '';
$rootPath = rtrim(dirname(dirname(dirname($script))), '/');
$baseUrl  = $scheme . '://' . $host . $rootPath . '/public/uploads/user/';
$diskBase = rtrim(dirname(dirname(__DIR__)), '/') . '/public/uploads/user/';

try {
  $db   = getUserDBConnection($userId);
  $stmt = $db->prepare(
    "SELECT id, qr_code, fullname, position, brand, status, shift, image
     FROM employees
     WHERE status = 'Active' AND image IS NOT NULL AND image != ''
     ORDER BY fullname ASC"
  );
  $stmt->execute();
  $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  $employees = [];
  foreach ($rows as $row) {
    $filename = basename(trim($row['image']));
    if ($filename === '' || $filename === '.' || $filename === '..') continue;
    if (!file_exists($diskBase . $filename)) continue;
    $employees[] = [
      'id'        => (int) $row['id'],
      'qr_code'   => $row['qr_code'],
      'fullname'  => $row['fullname'],
      'position'  => $row['position'],
      'brand'     => $row['brand'],
      'status'    => $row['status'],
      'shift'     => $row['shift'],
      'image_url' => $baseUrl . rawurlencode($filename),
    ];
  }
  echo json_encode(['success' => true, 'employees' => $employees, 'count' => count($employees)]);
} catch (Exception $e) {
  error_log('face-employees error: ' . $e->getMessage());
  echo json_encode(['success' => false, 'message' => 'Database error.']);
}
