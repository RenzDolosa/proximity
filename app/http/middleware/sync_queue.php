<?php
// app/http/middleware/sync_queue.php
//
// Offline Scan Queue Drain Endpoint
// ──────────────────────────────────────────────────────────────────────────────
// Called exclusively by resource/js/sync.js when the browser comes back online.
//
// Contract (matches sync.js exactly):
//
//   POST /app/http/middleware/sync_queue.php
//   Content-Type: application/json
//   X-Requested-With: XMLHttpRequest
//
//   Body:
//   {
//     "scans": [
//       {
//         "_queue_id":  <IndexedDB autoincrement id — echoed back for client ACK>,
//         "_endpoint":  "/app/services/qr_search_backend.php"
//                    OR "/app/http/middleware/add_to_log.php",
//         "_queued_at": <epoch ms — used as authoritative scan timestamp>,
//         ...original POST fields from the intercepted request...
//       },
//       ...
//     ]
//   }
//
//   Response (HTTP 207 Multi-Status):
//   {
//     "success": true,
//     "processed": 3,
//     "synced": 2,
//     "failed": 1,
//     "results": [
//       { "queue_id": 1, "success": true,  "message": "Logged" },
//       { "queue_id": 2, "success": false, "message": "Missing qr_code" },
//       ...
//     ]
//   }
//
// Each scan is processed in chronological order (_queued_at ASC) so that
// IN/OUT toggle logic in check_in_out stays consistent.
//
// Both intercepted endpoints ultimately write to the same two tables:
//   • employee_access_log
//   • check_in_out
// so this file owns that insert logic directly (no internal HTTP re-dispatch).
// ──────────────────────────────────────────────────────────────────────────────

ob_start();

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With');

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';

if (!defined('APP_TIMEZONE')) {
  define('APP_TIMEZONE',    'Asia/Manila');
  define('APP_TIMEZONE_TZ', '+08:00');
}
date_default_timezone_set(APP_TIMEZONE);

ob_clean();

// ── CORS preflight ────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(200);
  exit();
}

// ── Auth guard ────────────────────────────────────────────────────────────────
if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode([
    'success'    => false,
    'message'    => 'Authentication required.',
    'error_code' => 'AUTH_REQUIRED',
  ]);
  exit();
}

$currentUserId = (int) $_SESSION['user_id'];

// ── Method guard ──────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['success' => false, 'message' => 'Method not allowed.']);
  exit();
}

// ── AJAX guard ────────────────────────────────────────────────────────────────
$requestedWith = $_SERVER['HTTP_X_REQUESTED_WITH'] ?? '';
if (strtolower($requestedWith) !== 'xmlhttprequest') {
  http_response_code(403);
  echo json_encode(['success' => false, 'message' => 'Direct access not allowed.']);
  exit();
}

// ── Parse body ────────────────────────────────────────────────────────────────
$rawBody = file_get_contents('php://input');
$body    = json_decode($rawBody, true);

if (!is_array($body) || !isset($body['scans']) || !is_array($body['scans'])) {
  http_response_code(400);
  echo json_encode(['success' => false, 'message' => 'Invalid payload: expected {"scans":[…]}.']);
  exit();
}

$scans = $body['scans'];

if (count($scans) === 0) {
  echo json_encode([
    'success'   => true,
    'processed' => 0,
    'synced'    => 0,
    'failed'    => 0,
    'results'   => [],
  ]);
  exit();
}

// ── Known endpoints ───────────────────────────────────────────────────────────
const ENDPOINT_QR     = '/app/services/qr_search_backend.php';
const ENDPOINT_MANUAL = '/app/http/middleware/add_to_log.php';

// ── DB connection (reuse the same pattern as EmployeeLogManager) ──────────────
function getSyncConnection(): PDO
{
  $dsn = 'mysql:host=' . USER_DB_HOST
    . ';dbname='    . USER_DB_PREFIX
    . ';charset=utf8mb4';

  $pdo = new PDO($dsn, USER_DB_USER, USER_DB_PASS, [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
  ]);
  $pdo->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");
  return $pdo;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitizeUA(?string $ua): string
{
  if (!$ua) return 'offline-sync';
  $ua = preg_replace('/[^\x20-\x7E]/', '', $ua);
  return mb_substr($ua, 0, 255);
}

/**
 * Convert _queued_at (epoch ms from IndexedDB) to a MySQL DATETIME string.
 * Falls back to NOW() if missing or malformed.
 */
function queuedAtToDatetime(?float $queuedAt): string
{
  if ($queuedAt && is_numeric($queuedAt)) {
    $ts = (int) round($queuedAt / 1000);
    if ($ts > 0) {
      return date('Y-m-d H:i:s', $ts);
    }
  }
  return date('Y-m-d H:i:s');
}

/**
 * Determine the current IN/OUT status for an employee from check_in_out,
 * then return the toggled value.
 *
 * Mirrors CheckInOutLogger::toggleEmployeeStatus() in qr_search_backend.php.
 */
function resolveToggleStatus(PDO $pdo, string $qrCode): string
{
  try {
    $stmt = $pdo->prepare(
      "SELECT check_type FROM check_in_out
              WHERE qr_code = :qr
           ORDER BY scan_timestamp DESC
              LIMIT 1"
    );
    $stmt->execute([':qr' => $qrCode]);
    $row = $stmt->fetch();
    $last = $row ? strtoupper($row['check_type']) : 'OUT';
    return ($last === 'IN') ? 'OUT' : 'IN';
  } catch (PDOException $e) {
    error_log('[sync_queue] resolveToggleStatus error: ' . $e->getMessage());
    return 'IN';
  }
}

/**
 * Write one scan entry into employee_access_log + check_in_out,
 * exactly mirroring EmployeeLogManager::addToLog() and
 * CheckInOutLogger::logEmployeeAccess() + logCheckInOut().
 *
 * Returns ['success'=>bool, 'message'=>string]
 */
function persistScan(PDO $pdo, int $userId, array $scan): array
{
  // ── Required field validation ─────────────────────────────────────────────
  $qrCode   = trim($scan['qr_code']   ?? $scan['card_no'] ?? '');
  $fullname = trim($scan['fullname']  ?? '');

  if ($qrCode === '' || $fullname === '') {
    return [
      'success' => false,
      'message' => 'Missing required fields: qr_code (or card_no), fullname.',
    ];
  }

  $endpoint  = $scan['_endpoint']  ?? '';
  $queuedAt  = $scan['_queued_at'] ?? null;
  $timestamp = queuedAtToDatetime($queuedAt);

  // ── Determine check_status ────────────────────────────────────────────────
  // • add_to_log sends check_status explicitly (manual IN/OUT buttons)
  // • qr_search_backend auto-toggles; replicate that here
  if (isset($scan['check_status']) && in_array(strtoupper($scan['check_status']), ['IN', 'OUT'], true)) {
    $checkStatus = strtoupper($scan['check_status']);
  } else {
    // QR scan path: toggle based on last recorded state
    $checkStatus = resolveToggleStatus($pdo, $qrCode);
  }

  // ── Determine access_type ─────────────────────────────────────────────────
  if ($endpoint === ENDPOINT_MANUAL) {
    $accessType = $scan['access_type'] ?? 'manual_entry';
  } else {
    // qr_search_backend uses 'qr_scan', 'nfc_scan', etc.
    $accessType = $scan['access_type'] ?? 'qr_scan';
  }

  $ip = $_SERVER['REMOTE_ADDR']     ?? 'offline-sync';
  $ua = sanitizeUA($_SERVER['HTTP_USER_AGENT'] ?? null);

  try {
    $pdo->beginTransaction();

    // ── employee_access_log ───────────────────────────────────────────────
    $stmtLog = $pdo->prepare(
      "INSERT INTO employee_access_log
               (employee_id, fullname, position, brand, status, shift,
                violation, image, qr_code, check_status, user_id,
                access_type, ip_address, user_agent, access_timestamp)
             VALUES
               (:employee_id, :fullname, :position, :brand, :status, :shift,
                :violation, :image, :qr_code, :check_status, :user_id,
                :access_type, :ip_address, :user_agent, :access_timestamp)"
    );
    $stmtLog->execute([
      ':user_id'          => $userId,
      ':employee_id'      => $scan['employee_id'] ?? null,
      ':fullname'         => $fullname,
      ':position'         => trim($scan['position']  ?? ''),
      ':brand'            => trim($scan['brand']     ?? ''),
      ':status'           => trim($scan['status']    ?? ''),
      ':shift'            => trim($scan['shift']     ?? ''),
      ':violation'        => trim($scan['violation'] ?? ''),
      ':image'            => trim($scan['image']     ?? ''),
      ':qr_code'          => $qrCode,
      ':check_status'     => $checkStatus,
      ':access_type'      => $accessType,
      ':ip_address'       => $ip,
      ':user_agent'       => $ua,
      ':access_timestamp' => $timestamp,
    ]);
    $logId = $pdo->lastInsertId();

    // ── check_in_out ──────────────────────────────────────────────────────
    $stmtCIO = $pdo->prepare(
      "INSERT INTO check_in_out
               (employee_id, qr_code, fullname, check_type, scan_timestamp, user_id,
                ip_address, user_agent)
             VALUES
               (:employee_id, :qr_code, :fullname, :check_type, :scan_timestamp, :user_id,
                :ip_address, :user_agent)"
    );
    $stmtCIO->execute([
      ':user_id'        => $userId,
      ':employee_id'    => $scan['employee_id'] ?? null,
      ':qr_code'        => $qrCode,
      ':fullname'       => $fullname,
      ':check_type'     => $checkStatus,
      ':scan_timestamp' => $timestamp,
      ':ip_address'     => $ip,
      ':user_agent'     => $ua,
    ]);

    $pdo->commit();

    // ── Audit trail ───────────────────────────────────────────────────────
    logSystemAction($userId, 'OFFLINE_SYNC', json_encode([
      'log_id'       => $logId,
      'queue_id'     => $scan['_queue_id'] ?? null,
      'qr_code'      => $qrCode,
      'fullname'     => $fullname,
      'check_status' => $checkStatus,
      'access_type'  => $accessType,
      'queued_at'    => $timestamp,
      'endpoint'     => $endpoint,
    ]));

    return [
      'success' => true,
      'message' => "Logged ({$checkStatus}) — log_id {$logId}",
      'log_id'  => (int) $logId,
    ];
  } catch (PDOException $e) {
    if ($pdo->inTransaction()) {
      $pdo->rollBack();
    }
    $msg = $e->getMessage();
    error_log("[sync_queue] persistScan DB error (qr={$qrCode}): {$msg}");
    return [
      'success' => false,
      'message' => 'DB error: ' . $msg,
    ];
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Main processing loop
// ═════════════════════════════════════════════════════════════════════════════

$results  = [];
$synced   = 0;
$failed   = 0;

try {
  $pdo = getSyncConnection();

  // Sort chronologically so IN/OUT toggling stays correct across queued scans
  usort($scans, fn($a, $b) => ($a['_queued_at'] ?? 0) <=> ($b['_queued_at'] ?? 0));

  foreach ($scans as $scan) {
    $queueId = $scan['_queue_id'] ?? null;
    $endpoint = $scan['_endpoint'] ?? '';

    // Guard: only replay the two known endpoints
    if (!in_array($endpoint, [ENDPOINT_QR, ENDPOINT_MANUAL], true)) {
      $results[] = [
        'queue_id' => $queueId,
        'success'  => false,
        'message'  => "Unknown endpoint: {$endpoint}",
      ];
      $failed++;
      continue;
    }

    $outcome = persistScan($pdo, $currentUserId, $scan);

    $results[] = array_merge(
      ['queue_id' => $queueId],
      $outcome
    );

    if ($outcome['success']) {
      $synced++;
    } else {
      $failed++;
    }
  }
} catch (Exception $e) {
  // Fatal DB connection failure — return a server error so sync.js backs off
  error_log('[sync_queue] Fatal error: ' . $e->getMessage());
  http_response_code(500);
  echo json_encode([
    'success' => false,
    'message' => 'Sync service unavailable: ' . $e->getMessage(),
  ]);
  exit();
}

// ── Response ──────────────────────────────────────────────────────────────────
// HTTP 207 Multi-Status signals partial success to sync.js
$httpCode = ($failed > 0 && $synced > 0) ? 207
  : ($failed > 0 && $synced === 0 ? 422 : 200);

http_response_code($httpCode);
echo json_encode([
  'success'   => $failed === 0,
  'processed' => count($scans),
  'synced'    => $synced,
  'failed'    => $failed,
  'results'   => $results,
], JSON_PRETTY_PRINT);
exit();
