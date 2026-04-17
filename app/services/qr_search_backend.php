<?php
// app/services/qr_search_backend.php --> qr proximity scanner backend

// ── Buffer output so stray warnings never corrupt JSON ──────
ob_start();

// ── Session before anything else ───────────────────────────
if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

// ── Suppress display_errors — log to file, never to output ─
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// ── Headers ─────────────────────────────────────────────────
header('Content-Type: application/json');

// SECURITY: Restrict CORS to your own origin only.
// Replace 'https://yourdomain.com' with your actual domain.
// Wildcard (*) has been removed — it allowed any site to probe this endpoint.
$allowedOrigin = 'https://yourdomain.com'; // <-- CHANGE THIS to your real domain
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($requestOrigin === $allowedOrigin) {
  header("Access-Control-Allow-Origin: $allowedOrigin");
  header('Access-Control-Allow-Credentials: true');
}
// SECURITY: Removed 'Authorization' — we use sessions, not bearer tokens.
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, X-CSRF-Token');
header('Access-Control-Max-Age: 86400');

require_once __DIR__ . '/../../config/config.php';

if (!defined('APP_TIMEZONE')) {
  define('APP_TIMEZONE',    'Asia/Manila');
  define('APP_TIMEZONE_TZ', '+08:00');
}
date_default_timezone_set(APP_TIMEZONE);

if (isset($_GET['serve_file'])) {
  header('Cache-Control: public, max-age=3600');
  header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 3600) . ' GMT');
}

ob_clean();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(200);
  exit();
}

// ── Authentication check ─────────────────────────────────────
if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode([
    'success'    => false,
    'message'    => 'Authentication required. Please log in to access this service.',
    'error_code' => 'AUTH_REQUIRED',
    'data'       => []
  ]);
  exit();
}

$currentUserId = $_SESSION['user_id'];

// ── SECURITY: CSRF validation for all state-changing POST requests ──
// Every POST (toggle status, get_by_qr, get_by_id) must include the
// X-CSRF-Token header matching the token stored in the user's session.
// This prevents cross-site request forgery attacks.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $submittedToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
  $sessionToken   = $_SESSION['csrf_token'] ?? '';

  // hash_equals() prevents timing attacks during comparison
  if (empty($sessionToken) || !hash_equals($sessionToken, $submittedToken)) {
    http_response_code(403);
    echo json_encode([
      'success' => false,
      'message' => 'Invalid request. Please refresh the page and try again.',
      'data'    => []
    ]);
    exit();
  }
}

// ── SECURITY: Rate limiting — max 120 search requests per minute per session ──
// This prevents brute-force QR enumeration and database exhaustion.
$rateBucket = 'search_rate_' . date('YmdHi');
$_SESSION[$rateBucket] = ($_SESSION[$rateBucket] ?? 0) + 1;
if ($_SESSION[$rateBucket] > 120) {
  http_response_code(429);
  echo json_encode([
    'success' => false,
    'message' => 'Too many requests. Please slow down.',
    'data'    => []
  ]);
  exit();
}

// ─────────────────────────────────────────────────────────────────
//  SECURITY: Sanitize User-Agent before storing to database.
//  Strips non-printable characters and limits length to prevent
//  log injection attacks.
// ─────────────────────────────────────────────────────────────────
function sanitizeUserAgent(?string $ua): string
{
  if (!$ua) return 'unknown';
  $ua = preg_replace('/[^\x20-\x7E]/', '', $ua);
  return mb_substr($ua, 0, 255);
}

// ─────────────────────────────────────────────────────────────────
//  IMAGE PATH HELPER
// ─────────────────────────────────────────────────────────────────
function normalizeImageFilename(?string $image): ?string
{
  if ($image === null || trim($image) === '') {
    return null;
  }

  $image = trim($image);
  $image = basename($image);

  if ($image === '' || $image === '.' || $image === '..') {
    return null;
  }

  return $image;
}

function verifyImageExists(?string $filename): ?string
{
  if ($filename === null) return null;

  $uploadDir = __DIR__ . '/../../public/uploads/user/';
  $fullPath  = $uploadDir . $filename;

  return file_exists($fullPath) ? $filename : null;
}

function resolveImage(?string $raw): ?string
{
  return verifyImageExists(normalizeImageFilename($raw));
}

class Database
{
  private $conn;
  private $userId;

  public function __construct($userId)
  {
    $this->userId = $userId;
  }

  public function connect()
  {
    try {
      if (!userDatabaseExists($this->userId)) {
        if (!createUserDatabase($this->userId)) {
          throw new Exception("Failed to create user database");
        }
      }

      $this->conn = getUserDBConnection($this->userId);
      $this->conn->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");

      $this->createCheckInOutTable();
      return $this->conn;
    } catch (Exception $e) {
      error_log("User DB Connection error: " . $e->getMessage());
      return null;
    }
  }

  private function createCheckInOutTable()
  {
    try {
      $sql = "CREATE TABLE IF NOT EXISTS check_in_out (
                id            INT AUTO_INCREMENT PRIMARY KEY,
                user_id       int(11) DEFAULT NULL,
                employee_id   VARCHAR(100) NOT NULL,
                qr_code       VARCHAR(255) NOT NULL,
                fullname      VARCHAR(255) NOT NULL,
                check_type    ENUM('IN','OUT') NOT NULL,
                scan_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ip_address    VARCHAR(45),
                user_agent    TEXT,
                INDEX idx_employee_id   (employee_id),
                INDEX idx_qr_code       (qr_code),
                INDEX idx_timestamp     (scan_timestamp)
              ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

      $this->conn->exec($sql);
    } catch (PDOException $e) {
      error_log("Failed to create check_in_out table: " . $e->getMessage());
    }
  }

  public function getUserId()
  {
    return $this->userId;
  }

  public function getConnection()
  {
    return $this->conn;
  }
}

class QueryLogger
{
  private $conn;
  private $userId;

  public function __construct($db, $userId)
  {
    $this->conn   = $db;
    $this->userId = $userId;
  }

  public function getEmployeeCheckStatus($employeeId, $qrCode = null)
  {
    if (!$this->conn) return 'OUT';

    try {
      if ($qrCode) {
        $sql = "SELECT check_type FROM check_in_out
                WHERE employee_id = :employee_id OR qr_code = :qr_code
                ORDER BY scan_timestamp DESC, id DESC
                LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':employee_id' => $employeeId, ':qr_code' => $qrCode]);
      } else {
        $sql = "SELECT check_type FROM check_in_out
                WHERE employee_id = :employee_id
                ORDER BY scan_timestamp DESC, id DESC
                LIMIT 1";
        $stmt = $this->conn->prepare($sql);
        $stmt->execute([':employee_id' => $employeeId]);
      }

      $row = $stmt->fetch(PDO::FETCH_ASSOC);
      return $row ? $row['check_type'] : 'OUT';
    } catch (PDOException $e) {
      error_log("Get check status error: " . $e->getMessage());
      return 'OUT';
    }
  }

  public function logCheckInOut($employeeId, $qrCode, $fullname, $checkType)
  {
    if (!$this->conn) return false;

    try {
      $now = date('Y-m-d H:i:s');

      $sql = "INSERT INTO check_in_out
              (employee_id, qr_code, fullname, check_type, scan_timestamp, user_id,
                ip_address, user_agent)
            VALUES
              (:employee_id, :qr_code, :fullname, :check_type, :scan_timestamp, :user_id,
                :ip_address, :user_agent)";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute([
        ':user_id'         => $this->userId,
        ':employee_id'     => $employeeId,
        ':qr_code'         => $qrCode,
        ':fullname'        => $fullname,
        ':check_type'      => $checkType,
        ':scan_timestamp'  => $now,
        ':ip_address'      => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        // SECURITY: Sanitized to prevent log injection
        ':user_agent'      => sanitizeUserAgent($_SERVER['HTTP_USER_AGENT'] ?? null),
      ]);

      return true;
    } catch (PDOException $e) {
      error_log("Check-in/out logging error: " . $e->getMessage());
      return false;
    }
  }

  public function toggleEmployeeStatus($employeeId, $qrCode, $fullname)
  {
    $lastStatus = $this->getEmployeeCheckStatus($employeeId, $qrCode);
    $newStatus  = ($lastStatus === 'IN') ? 'OUT' : 'IN';

    if ($this->logCheckInOut($employeeId, $qrCode, $fullname, $newStatus)) {
      return $newStatus;
    }

    return false;
  }

  public function logEmployeeAccess($employeeData, $accessType)
  {
    if (!$this->conn) return false;

    try {
      $now = date('Y-m-d H:i:s');

      $sql = "INSERT INTO employee_access_log
          (employee_id, fullname, position, brand, status, shift,
           violation, image, qr_code, check_status, user_id,
           access_type, ip_address, user_agent, access_timestamp)
        VALUES
          (:employee_id, :fullname, :position, :brand, :status, :shift,
           :violation, :image, :qr_code, :check_status, :user_id,
           :access_type, :ip_address, :user_agent, :access_timestamp)";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute([
        ':user_id'          => $this->userId,
        ':employee_id'      => $employeeData['id']           ?? null,
        ':fullname'         => $employeeData['fullname']      ?? null,
        ':position'         => $employeeData['position']      ?? null,
        ':brand'            => $employeeData['brand']         ?? null,
        ':status'           => $employeeData['status']        ?? null,
        ':shift'            => $employeeData['shift']         ?? null,
        ':violation'        => $employeeData['violation']     ?? null,
        ':image'            => $employeeData['image']         ?? null,
        ':qr_code'          => $employeeData['qr_code']       ?? null,
        ':check_status'     => $employeeData['check_status']  ?? null,
        ':access_type'      => $accessType,
        ':access_timestamp' => $now,
        ':ip_address'       => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        // SECURITY: Sanitized to prevent log injection
        ':user_agent'       => sanitizeUserAgent($_SERVER['HTTP_USER_AGENT'] ?? null),
      ]);

      return true;
    } catch (PDOException $e) {
      error_log("Employee access logging error: " . $e->getMessage());
      return false;
    }
  }

  public function logSearchQuery(
    $queryType,
    $searchTerm,
    $searchParams,
    $resultsCount,
    $auditData,       // SECURITY: Now receives minimal audit data only, not full PII
    $executionTime,
    $success,
    $errorMessage = null
  ) {
    if (!$this->conn) return false;

    try {
      $sql = "INSERT INTO search_queries
                (query_type, search_term, search_parameters, results_count, results_data,
                 ip_address, user_agent, execution_time_ms, success, error_message)
              VALUES
                (:query_type, :search_term, :search_parameters, :results_count, :results_data,
                 :ip_address, :user_agent, :execution_time, :success, :error_message)";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute([
        ':query_type'        => $queryType,
        ':search_term'       => $searchTerm,
        ':search_parameters' => json_encode($searchParams),
        ':results_count'     => $resultsCount,
        ':results_data'      => json_encode($auditData),
        ':ip_address'        => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        // SECURITY: Sanitized to prevent log injection
        ':user_agent'        => sanitizeUserAgent($_SERVER['HTTP_USER_AGENT'] ?? null),
        ':execution_time'    => $executionTime,
        ':success'           => $success ? 1 : 0,
        ':error_message'     => $errorMessage,
      ]);

      logSystemAction($this->userId, 'SEARCH_QUERY', json_encode([
        'employee_id'  => $auditData['employee_id']  ?? null,
        'fullname'     => $auditData['fullname']      ?? null,
        'qr_code'      => $auditData['qr_code']       ?? null,
        'check_status' => $auditData['check_status']  ?? 'IN'
      ]));

      return true;
    } catch (PDOException $e) {
      error_log("Query logging error: " . $e->getMessage());
      return false;
    }
  }
}

class LiveSearchHandler
{
  private $conn;
  private $logger;
  private $userId;
  private $employeesTable = 'employees';

  public function __construct($db, $logger, $userId)
  {
    $this->conn   = $db;
    $this->logger = $logger;
    $this->userId = $userId;
  }

  private function cleanEmployee(array $employee): array
  {
    $employee['image'] = resolveImage($employee['image'] ?? null);
    return $employee;
  }

  private function batchCheckStatuses(array $employees): array
  {
    if (empty($employees) || !$this->conn) {
      if (isset($employees['id'])) {
        $employees['check_status'] = 'OUT';
        return $employees;
      }
      foreach ($employees as &$e) $e['check_status'] = 'OUT';
      unset($e);
      return $employees;
    }

    $isSingleRow = isset($employees['id']);
    $rows        = $isSingleRow ? [$employees] : $employees;

    try {
      $ids = array_column($rows, 'id');

      if (empty($ids)) {
        foreach ($rows as &$r) $r['check_status'] = 'OUT';
        unset($r);
        return $isSingleRow ? $rows[0] : $rows;
      }

      $placeholders = implode(',', array_fill(0, count($ids), '?'));
      $sql = "SELECT employee_id, check_type
                FROM (
                  SELECT employee_id, check_type,
                         ROW_NUMBER() OVER (
                           PARTITION BY employee_id ORDER BY id DESC
                         ) AS rn
                  FROM check_in_out
                  WHERE employee_id IN ($placeholders)
                ) ranked
                WHERE rn = 1";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute($ids);
      $statusRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      $statusMap = [];
      foreach ($statusRows as $row) {
        $statusMap[(string)$row['employee_id']] = $row['check_type'];
      }

      foreach ($rows as &$row) {
        $row['check_status'] = $statusMap[(string)$row['id']] ?? 'OUT';
      }
      unset($row);
    } catch (PDOException $e) {
      error_log("batchCheckStatuses error: " . $e->getMessage());
      foreach ($rows as &$r) $r['check_status'] = 'OUT';
      unset($r);
    }

    return $isSingleRow ? $rows[0] : $rows;
  }

  public function searchEmployees($searchParams = [])
  {
    $startTime    = microtime(true);
    $searchTerm   = '';
    $results      = [];
    $success      = true;
    $errorMessage = null;

    try {
      // SECURITY: Only select the specific columns the UI needs.
      // SELECT * was removed to prevent accidental exposure of sensitive
      // columns that may be added to the employees table in the future.
      $sql    = "SELECT id, fullname, position, brand, status, shift,
                          violation, image, qr_code
                   FROM {$this->employeesTable} WHERE 1=1";
      $params = [];

      $searchableFields = ['qr_code', 'fullname', 'position', 'brand', 'shift', 'status'];
      foreach ($searchableFields as $field) {
        if (!empty($searchParams[$field])) {
          $searchTerm = $searchParams[$field];
          break;
        }
      }

      if ($searchTerm !== '') {
        $likeFields = ['fullname', 'position', 'qr_code', 'brand', 'shift', 'status', 'violation'];
        $conditions = array_map(fn($f) => "$f LIKE :search_term", $likeFields);

        $sql .= " AND (" . implode(' OR ', $conditions) . ")";
        $params[':search_term'] = '%' . $searchTerm . '%';

        $sql .= " ORDER BY
                        CASE
                          WHEN qr_code  = :exact_term THEN 1
                          WHEN fullname = :exact_term THEN 2
                          WHEN qr_code  LIKE :starts_term THEN 3
                          WHEN fullname LIKE :starts_term THEN 4
                          ELSE 5
                        END,
                        fullname ASC";

        $params[':exact_term']  = $searchTerm;
        $params[':starts_term'] = $searchTerm . '%';
      } else {
        foreach (['status', 'shift', 'brand'] as $f) {
          if (!empty($searchParams[$f])) {
            $sql .= " AND $f = :$f";
            $params[":$f"] = $searchParams[$f];
          }
        }
        $sql .= " ORDER BY fullname ASC";
      }

      $sql .= " LIMIT 100";

      $stmt = $this->conn->prepare($sql);
      foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
      }
      $stmt->execute();
      $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      foreach ($rows as &$row) {
        $row = $this->cleanEmployee($row);
      }
      unset($row);

      $rows = $this->batchCheckStatuses($rows);

      foreach ($rows as $employee) {
        $results[] = $employee;
        if ($this->logger) {
          $this->logger->logEmployeeAccess($employee, 'search_result');
        }
      }
    } catch (PDOException $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("Search error: " . $e->getMessage());
    } catch (Exception $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("General search error: " . $e->getMessage());
    }

    $executionTime = (microtime(true) - $startTime) * 1000;

    if ($this->logger) {
      // SECURITY: Pass minimal audit data to logger — not the full employee records.
      // This prevents sensitive PII (shift, violation, image path, etc.) from being
      // duplicated into the search_queries log table.
      $firstEmployee = $results[0] ?? [];
      $auditData = $firstEmployee ? [
        'employee_id'  => $firstEmployee['id']           ?? null,
        'fullname'     => $firstEmployee['fullname']     ?? null,
        'qr_code'      => $firstEmployee['qr_code']      ?? null,
        'check_status' => $firstEmployee['check_status'] ?? null,
      ] : [];

      $this->logger->logSearchQuery(
        'live_search',
        $searchTerm,
        $searchParams,
        count($results),
        $auditData,
        $executionTime,
        $success,
        $errorMessage
      );
    }

    return $results;
  }

  public function getEmployeeByQR($qr_code, $autoToggle = true)
  {
    $startTime    = microtime(true);
    $queryType    = 'get_by_qr';
    $success      = true;
    $errorMessage = null;
    $result       = null;

    try {
      // SECURITY: Explicit column list — no SELECT *
      $sql  = "SELECT id, fullname, position, brand, status, shift,
                      violation, image, qr_code
               FROM {$this->employeesTable} WHERE qr_code = :qr_code LIMIT 1";
      $stmt = $this->conn->prepare($sql);
      $stmt->bindParam(':qr_code', $qr_code);
      $stmt->execute();
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      if ($result) {
        $result = $this->cleanEmployee($result);

        if ($autoToggle && $this->logger) {
          $previousStatus = $this->logger->getEmployeeCheckStatus(
            $result['id'],
            $result['qr_code']
          );

          $newStatus = $this->logger->toggleEmployeeStatus(
            $result['id'],
            $result['qr_code'],
            $result['fullname']
          );

          if ($newStatus !== false) {
            $result['check_status']    = $newStatus;
            $result['previous_status'] = $previousStatus;
            $result['status_changed']  = true;
          } else {
            $result = $this->batchCheckStatuses($result);
            $result['status_changed'] = false;
          }
        } else {
          $result = $this->batchCheckStatuses($result);
          $result['status_changed'] = false;
        }

        if ($this->logger) {
          $this->logger->logEmployeeAccess($result, 'qr_code_scan');
        }
      }
    } catch (PDOException $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("Get employee by QR error: " . $e->getMessage());
    }

    $executionTime = (microtime(true) - $startTime) * 1000;

    if ($this->logger) {
      // SECURITY: Minimal audit data only — not full employee record
      $auditData = $result ? [
        'employee_id'  => $result['id']           ?? null,
        'fullname'     => $result['fullname']      ?? null,
        'qr_code'      => $result['qr_code']       ?? null,
        'check_status' => $result['check_status']  ?? null,
      ] : [];

      $this->logger->logSearchQuery(
        $queryType,
        $qr_code,
        ['qr_code' => $qr_code],
        $result ? 1 : 0,
        $auditData,
        $executionTime,
        $success,
        $errorMessage
      );
    }

    return $result;
  }

  public function getEmployee($id)
  {
    $startTime    = microtime(true);
    $queryType    = 'get_by_id';
    $success      = true;
    $errorMessage = null;
    $result       = null;

    try {
      // SECURITY: Explicit column list — no SELECT *
      $sql  = "SELECT id, fullname, position, brand, status, shift,
                      violation, image, qr_code
               FROM {$this->employeesTable} WHERE id = :id LIMIT 1";
      $stmt = $this->conn->prepare($sql);
      $stmt->bindParam(':id', $id);
      $stmt->execute();
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      if ($result) {
        $result = $this->cleanEmployee($result);
        $result = $this->batchCheckStatuses($result);

        if ($this->logger) {
          $this->logger->logEmployeeAccess($result, 'direct_access_by_id');
        }
      }
    } catch (PDOException $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("Get employee error: " . $e->getMessage());
    }

    $executionTime = (microtime(true) - $startTime) * 1000;

    if ($this->logger) {
      // SECURITY: Minimal audit data only — not full employee record
      $auditData = $result ? [
        'employee_id'  => $result['id']      ?? null,
        'fullname'     => $result['fullname'] ?? null,
        'qr_code'      => $result['qr_code']  ?? null,
        'check_status' => $result['check_status'] ?? null,
      ] : [];

      $this->logger->logSearchQuery(
        $queryType,
        (string)$id,
        ['id' => $id],
        $result ? 1 : 0,
        $auditData,
        $executionTime,
        $success,
        $errorMessage
      );
    }

    return $result;
  }
}

// ─────────────────────────────────────────────────────────────────
//  Main request handler
// ─────────────────────────────────────────────────────────────────
try {
  $database = new Database($currentUserId);
  $db       = $database->connect();

  if (!$db) {
    throw new Exception("Database connection failed");
  }

  $logger        = new QueryLogger($db, $currentUserId);
  $searchHandler = new LiveSearchHandler($db, $logger, $currentUserId);
  $response      = ['success' => false, 'message' => '', 'data' => []];

  if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $searchParams = [];

    // SECURITY: Enforce max input length of 255 characters to prevent
    // oversized payloads from being passed into SQL LIKE queries or logs.
    $q = mb_substr(trim($_GET['q'] ?? ''), 0, 255);

    if ($q === '') {
      foreach (['fullname', 'position', 'brand', 'status', 'shift', 'qr_code'] as $p) {
        $v = mb_substr(trim($_GET[$p] ?? ''), 0, 255);
        if ($v !== '') {
          $q = $v;
          break;
        }
      }
    }

    if ($q !== '') {
      $searchParams['qr_code'] = $q;
    }

    if (empty($searchParams)) {
      $response['message'] = 'No search parameters provided';
      $response['data']    = [];
    } else {
      $employees           = $searchHandler->searchEmployees($searchParams);
      $response['success'] = true;
      $response['data']    = $employees;
      $response['count']   = count($employees);
      $response['message'] = empty($employees)
        ? 'No employees found matching your search criteria.'
        : count($employees) . ' employee(s) found.';
    }
  } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input) {
      $input = $_POST;
    }

    $action = $input['action'] ?? '';

    switch ($action) {

      case 'get_by_qr':
        // SECURITY: Enforce max input length on QR code input
        $qr_code    = mb_substr(trim($input['qr_code'] ?? ''), 0, 100);

        // SECURITY: autoToggle is only permitted when the request explicitly
        // identifies itself as coming from a physical scanner (source = 'scanner').
        // Manual text searches from the keyboard must never trigger a status toggle.
        // Note: For stronger security, use a dedicated scanner-only endpoint instead.
        $source     = $input['source'] ?? 'manual';
        $autoToggle = ($source === 'scanner') && (isset($input['auto_toggle']) ? (bool)$input['auto_toggle'] : true);

        if (empty($qr_code)) {
          $response['message'] = 'QR code is required';
          break;
        }

        $employee = $searchHandler->getEmployeeByQR($qr_code, $autoToggle);

        if ($employee) {
          $response['success'] = true;
          $response['data']    = $employee;

          if (!empty($employee['status_changed'])) {
            $curr = $employee['check_status'];
            // SECURITY: Do not echo back user input — use a fixed message
            $response['message'] = "Employee checked {$curr}.";
          } else {
            $response['message'] = 'Employee found. Current status: ' . $employee['check_status'];
          }
        } else {
          // SECURITY: Do not echo the user's QR code back in the response.
          // This prevents reflected XSS if the message is ever rendered as HTML.
          $response['message'] = 'No employee found for the provided QR code.';
        }
        break;

      case 'get_by_id':
        $employee_id = intval($input['id'] ?? 0);

        if ($employee_id <= 0) {
          $response['message'] = 'Valid Employee ID is required';
          break;
        }

        $employee = $searchHandler->getEmployee($employee_id);

        if ($employee) {
          $response['success'] = true;
          $response['data']    = $employee;
          $response['message'] = 'Employee found. Current status: ' . $employee['check_status'];
        } else {
          // SECURITY: Do not echo back user-supplied input
          $response['message'] = 'Employee not found.';
        }
        break;

      case 'toggle_status':
        $employee_id = intval($input['employee_id'] ?? 0);
        // SECURITY: Enforce max input length
        $qr_code     = mb_substr(trim($input['qr_code']   ?? ''), 0, 100);
        $fullname    = mb_substr(trim($input['fullname']   ?? ''), 0, 255);

        if ($employee_id <= 0 || empty($qr_code) || empty($fullname)) {
          $response['message'] = 'Employee ID, QR code, and fullname are required';
          break;
        }

        $newStatus = $logger->toggleEmployeeStatus($employee_id, $qr_code, $fullname);

        if ($newStatus !== false) {
          $response['success'] = true;
          $response['data']    = ['new_status' => $newStatus];
          $response['message'] = 'Employee status changed to: ' . $newStatus;
        } else {
          $response['message'] = 'Failed to change employee status';
        }
        break;

      default:
        // SECURITY: Do not echo back the action value — could enable reflected XSS
        $response['message'] = 'Invalid or missing action parameter.';
        break;
    }
  } else {
    $response['message'] = 'Invalid request method.';
  }
} catch (Exception $e) {
  // SECURITY: Log the real error internally — never expose it to the client.
  // Detailed error messages leak database structure, table names, and
  // file paths that attackers can use to craft targeted attacks.
  error_log("Critical server error: " . $e->getMessage());

  $response = [
    'success' => false,
    'message' => 'An unexpected error occurred. Please try again.',
    'data'    => [],
  ];
  http_response_code(500);
}

echo json_encode($response, JSON_PRETTY_PRINT);
exit;