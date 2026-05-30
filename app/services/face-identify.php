<?php
// app/services/face-identify.php
// AJAX endpoint: receive a matched employee qr_code, look up from employees table,
// write employee_attendance_log exactly like existing QR/manual middleware.
// POST JSON: { qr_code, check_status, csrf_token }
// Returns:   { success, result, employee }

ob_start();

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

header('Content-Type: application/json');

require_once __DIR__ . '/../../config/config.php';

ob_clean();

// ── Auth ─────────────────────────────────────────────────────────────────────
if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode(['success' => false, 'message' => 'Authentication required.']);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['success' => false, 'message' => 'Method not allowed.']);
  exit;
}

$userId = (int) $_SESSION['user_id'];
$input  = json_decode(file_get_contents('php://input'), true) ?: [];

// ── CSRF ─────────────────────────────────────────────────────────────────────
$csrfToken = $input['csrf_token'] ?? '';
if (!hash_equals($_SESSION['csrf_token'] ?? '', $csrfToken)) {
  http_response_code(403);
  echo json_encode(['success' => false, 'message' => 'Invalid CSRF token.']);
  exit;
}

// ── Inputs ───────────────────────────────────────────────────────────────────
$qrCode = trim($input['qr_code'] ?? '');

if ($qrCode === '') {
  echo json_encode(['success' => false, 'message' => 'qr_code is required.']);
  exit;
}

try {
  $db = getUserDBConnection($userId);
  $db->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");

  // ── Fetch employee from employees table ───────────────────────────────────
  $stmt = $db->prepare(
    "SELECT id, fullname, position, brand, status, shift, violation, image, qr_code
         FROM employees
         WHERE qr_code = ?
         LIMIT 1"
  );
  $stmt->execute([$qrCode]);
  $emp = $stmt->fetch(PDO::FETCH_ASSOC);

  if (!$emp) {
    echo json_encode([
      'success' => false,
      'result'  => 'not_found',
      'message' => 'Employee not found.'
    ]);
    exit;
  }

  $now = date('Y-m-d H:i:s');

  // ── Ensure table exists ───────────────────────────────────────────────────
  $db->exec("CREATE TABLE IF NOT EXISTS employee_attendance_log (
        `id` INT AUTO_INCREMENT PRIMARY KEY,
        `user_id` int(11) DEFAULT NULL,
        `employee_id` INT DEFAULT NULL,
        `fullname` VARCHAR(100) DEFAULT NULL,
        `position` VARCHAR(50) DEFAULT NULL,
        `brand` VARCHAR(50) DEFAULT NULL,
        `status` ENUM ('Active', 'Inactive') DEFAULT NULL,
        `shift` ENUM ('Day Shift', 'Night Shift', 'Graveyard Shift') DEFAULT NULL,
        `violation` TEXT DEFAULT NULL,
        `image` VARCHAR(255) DEFAULT NULL,
        `qr_code` VARCHAR(100) DEFAULT NULL,
        `access_type` VARCHAR(50) DEFAULT NULL,
        `ip_address` VARCHAR(45) DEFAULT NULL,
        `user_agent` TEXT DEFAULT NULL,
        `access_timestamp` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_employee_id (employee_id),
        INDEX idx_qr_code (qr_code),
        INDEX idx_access_timestamp (access_timestamp),
        INDEX idx_access_type (access_type)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;");

  $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
  $ua = mb_substr($_SERVER['HTTP_USER_AGENT'] ?? 'unknown', 0, 255);

  // ── Write log ─────────────────────────────────────────────────────────────
  $db->beginTransaction();

  $stmt = $db->prepare(
    "INSERT INTO employee_attendance_log
            (employee_id, fullname, position, brand, status, shift,
             violation, image, qr_code, user_id,
             access_type, access_timestamp, ip_address, user_agent)
         VALUES
            (:employee_id, :fullname, :position, :brand, :status, :shift,
             :violation, :image, :qr_code, :user_id,
             :access_type, :access_timestamp, :ip_address, :user_agent)"
  );
  $stmt->execute([
    ':employee_id'      => $emp['id'],
    ':fullname'         => $emp['fullname'],
    ':position'         => $emp['position'],
    ':brand'            => $emp['brand'],
    ':status'           => $emp['status'],
    ':shift'            => $emp['shift'],
    ':violation'        => $emp['violation'] ?? '',
    ':image'            => $emp['image'] ?? '',
    ':qr_code'          => $emp['qr_code'],
    ':user_id'          => $userId,
    ':access_type'      => 'facial_recognition',
    ':access_timestamp' => $now,
    ':ip_address'       => $ip,
    ':user_agent'       => $ua,
  ]);

  $db->commit();

  logSystemAction($userId, 'FACIAL_ID', json_encode([
    'employee_id' => $emp['id'],
    'fullname'    => $emp['fullname'],
    'qr_code'     => $emp['qr_code'],
  ]));

  echo json_encode([
    'success'  => true,
    'result'   => 'matched',
    'employee' => $emp,
  ]);
} catch (PDOException $e) {
  if (isset($db) && $db->inTransaction()) {
    $db->rollBack();
  }
  error_log('face-identify PDO error: ' . $e->getMessage());
  echo json_encode(['success' => false, 'message' => 'Database error.']);
} catch (Exception $e) {
  error_log('face-identify error: ' . $e->getMessage());
  echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}