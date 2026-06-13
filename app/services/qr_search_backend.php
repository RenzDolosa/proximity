<?php
// app/services/qr_search_backend.php --> qr proximity scanner backend

ob_start();

if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

header('Content-Type: application/json');

$allowedOrigin = 'https://yourdomain.com'; // <-- CHANGE THIS
$requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($requestOrigin === $allowedOrigin) {
  header("Access-Control-Allow-Origin: $allowedOrigin");
  header('Access-Control-Allow-Credentials: true');
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, X-CSRF-Token');
header('Access-Control-Max-Age: 86400');

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';

if (!defined('APP_TIMEZONE')) {
  define('APP_TIMEZONE',    'Asia/Manila');
  define('APP_TIMEZONE_TZ', '+08:00');
}
date_default_timezone_set(APP_TIMEZONE);

ob_clean();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(200);
  exit();
}

if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode([
    'success'    => false,
    'message'    => 'Authentication required. Please log in.',
    'error_code' => 'AUTH_REQUIRED',
    'data'       => []
  ]);
  exit();
}

$currentUserId = $_SESSION['user_id'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $submittedToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
  $sessionToken   = $_SESSION['csrf_token'] ?? '';
  if (empty($sessionToken) || !hash_equals($sessionToken, $submittedToken)) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Invalid request. Please refresh and try again.', 'data' => []]);
    exit();
  }
}

$rateBucket = 'search_rate_' . date('YmdHi');
$_SESSION[$rateBucket] = ($_SESSION[$rateBucket] ?? 0) + 1;
if ($_SESSION[$rateBucket] > 120) {
  http_response_code(429);
  echo json_encode(['success' => false, 'message' => 'Too many requests. Please slow down.', 'data' => []]);
  exit();
}

// ── Card number normalizer ─────────────────────────────────────────────────────
function normalizeCardNo(string $raw): string
{
  $raw = trim($raw);
  if ($raw === '') return $raw;
  if (ctype_digit($raw)) {
    return ltrim($raw, '0') ?: '0';
  }
  return $raw;
}

function sanitizeUserAgent(?string $ua): string
{
  if (!$ua) return 'unknown';
  $ua = preg_replace('/[^\x20-\x7E]/', '', $ua);
  return mb_substr($ua, 0, 255);
}

function normalizeImageFilename(?string $image): ?string
{
  if ($image === null || trim($image) === '') return null;
  $image = trim(basename($image));
  return ($image === '' || $image === '.' || $image === '..') ? null : $image;
}

function verifyImageExists(?string $filename): ?string
{
  if ($filename === null) return null;
  $fullPath = __DIR__ . '/../../public/uploads/user/' . $filename;
  return file_exists($fullPath) ? $filename : null;
}

function resolveImage(?string $raw): ?string
{
  return verifyImageExists(normalizeImageFilename($raw));
}

// ─────────────────────────────────────────────────────────────────────────────

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
        if (!createUserDatabase($this->userId)) throw new Exception("Failed to create user database");
      }
      $this->conn = getUserDBConnection($this->userId);
      $this->conn->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");
      $this->ensureCheckInOutTable();
      return $this->conn;
    } catch (Exception $e) {
      error_log("User DB Connection error: " . $e->getMessage());
      return null;
    }
  }

  private function ensureCheckInOutTable()
  {
    $this->conn->exec("CREATE TABLE IF NOT EXISTS check_in_out (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      user_id        INT(11) DEFAULT NULL,
      employee_id    VARCHAR(100) NOT NULL,
      qr_code        VARCHAR(255) NOT NULL,
      fullname       VARCHAR(255) NOT NULL,
      check_type     ENUM('IN','OUT') NOT NULL,
      scan_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ip_address     VARCHAR(45),
      user_agent     TEXT,
      INDEX idx_employee_id (employee_id),
      INDEX idx_qr_code     (qr_code),
      INDEX idx_timestamp   (scan_timestamp)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
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

  public function __construct($conn, $userId)
  {
    $this->conn   = $conn;
    $this->userId = $userId;
  }

  // ── getEmployeeCheckStatus ─────────────────────────────────────────────────
  public function getEmployeeCheckStatus(string $qrCode): string
  {
    if (!$this->conn) return 'OUT';
    try {
      $normalized = normalizeCardNo($qrCode);
      $stmt = $this->conn->prepare(
        "SELECT check_type FROM check_in_out
          WHERE qr_code = :qr
             OR employee_id = :qr2
             OR (qr_code REGEXP '^[0-9]+$'     AND TRIM(LEADING '0' FROM qr_code)     = :norm)
             OR (employee_id REGEXP '^[0-9]+$'  AND TRIM(LEADING '0' FROM employee_id) = :norm2)
          ORDER BY scan_timestamp DESC, id DESC
          LIMIT 1"
      );
      $stmt->execute([':qr' => $qrCode, ':qr2' => $qrCode, ':norm' => $normalized, ':norm2' => $normalized]);
      $row = $stmt->fetch(PDO::FETCH_ASSOC);
      return $row ? $row['check_type'] : 'OUT';
    } catch (PDOException $e) {
      error_log("getEmployeeCheckStatus error: " . $e->getMessage());
      return 'OUT';
    }
  }

  public function logCheckInOut(string $qrCode, string $fullname, string $checkType): bool
  {
    if (!$this->conn) return false;
    try {
      $stmt = $this->conn->prepare(
        "INSERT INTO check_in_out
           (user_id, employee_id, qr_code, fullname, check_type, scan_timestamp, ip_address, user_agent)
         VALUES
           (:uid, :eid, :qr, :name, :type, NOW(), :ip, :ua)"
      );
      return $stmt->execute([
        ':uid'  => $this->userId,
        ':eid'  => $qrCode,
        ':qr'   => $qrCode,
        ':name' => $fullname,
        ':type' => $checkType,
        ':ip'   => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':ua'   => sanitizeUserAgent($_SERVER['HTTP_USER_AGENT'] ?? null),
      ]);
    } catch (PDOException $e) {
      error_log("logCheckInOut error: " . $e->getMessage());
      return false;
    }
  }

  public function toggleEmployeeStatus(string $qrCode, string $fullname): string|false
  {
    $last      = $this->getEmployeeCheckStatus($qrCode);
    $newStatus = ($last === 'IN') ? 'OUT' : 'IN';
    return $this->logCheckInOut($qrCode, $fullname, $newStatus) ? $newStatus : false;
  }

  public function logEmployeeAccess(array $employeeData, string $accessType): bool
  {
    if (!$this->conn) return false;
    try {
      $stmt = $this->conn->prepare(
        "INSERT INTO employee_access_log
           (employee_id, fullname, position, brand, status, shift,
            violation, image, qr_code, check_status, user_id,
            access_type, ip_address, user_agent, access_timestamp)
         VALUES
           (:eid, :name, :pos, :brand, :status, :shift,
            :vio, :img, :qr, :cs, :uid,
            :atype, :ip, :ua, NOW())"
      );
      return $stmt->execute([
        ':uid'   => $this->userId,
        ':eid'   => $employeeData['id']           ?? null,
        ':name'  => $employeeData['fullname']      ?? null,
        ':pos'   => $employeeData['position']      ?? null,
        ':brand' => $employeeData['brand']         ?? null,
        ':status' => $employeeData['status']        ?? null,
        ':shift' => $employeeData['shift']         ?? null,
        ':vio'   => $employeeData['violation']     ?? null,
        ':img'   => $employeeData['image']         ?? null,
        ':qr'    => $employeeData['qr_code']       ?? null,
        ':cs'    => $employeeData['check_status']  ?? null,
        ':atype' => $accessType,
        ':ip'    => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':ua'    => sanitizeUserAgent($_SERVER['HTTP_USER_AGENT'] ?? null),
      ]);
    } catch (PDOException $e) {
      error_log("logEmployeeAccess error: " . $e->getMessage());
      return false;
    }
  }

  public function logSearchQuery($queryType, $searchTerm, $searchParams, $resultsCount, $auditData, $executionTime, $success, $errorMessage = null): bool
  {
    if (!$this->conn) return false;
    try {
      $stmt = $this->conn->prepare(
        "INSERT INTO search_queries
           (query_type, search_term, search_parameters, results_count, results_data,
            ip_address, user_agent, execution_time_ms, success, error_message)
         VALUES
           (:qt, :st, :sp, :rc, :rd, :ip, :ua, :et, :s, :em)"
      );
      $stmt->execute([
        ':qt'  => $queryType,
        ':st'  => $searchTerm,
        ':sp'  => json_encode($searchParams),
        ':rc'  => $resultsCount,
        ':rd'  => json_encode($auditData),
        ':ip'  => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':ua'  => sanitizeUserAgent($_SERVER['HTTP_USER_AGENT'] ?? null),
        ':et'  => $executionTime,
        ':s'   => $success ? 1 : 0,
        ':em'  => $errorMessage,
      ]);

      logSystemAction($this->userId, 'SEARCH_QUERY', json_encode([
        'employee_id'  => $auditData['employee_id']  ?? null,
        'fullname'     => $auditData['fullname']      ?? null,
        'qr_code'      => $auditData['qr_code']       ?? null,
        'check_status' => $auditData['check_status']  ?? null,
      ]));

      return true;
    } catch (PDOException $e) {
      error_log("logSearchQuery error: " . $e->getMessage());
      return false;
    }
  }
}

class LiveSearchHandler
{
  private $conn;
  private $logger;
  private $userId;

  public function __construct($conn, $logger, $userId)
  {
    $this->conn   = $conn;
    $this->logger = $logger;
    $this->userId = $userId;
  }

  private function cleanEmployee(array $emp): array
  {
    $emp['image'] = resolveImage($emp['image'] ?? null);
    return $emp;
  }

  // ── batchCheckStatuses ─────────────────────────────────────────────────────
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

    $isSingle = isset($employees['id']);
    $rows     = $isSingle ? [$employees] : $employees;

    try {
      $qrCodes = array_filter(array_column($rows, 'qr_code'));
      if (empty($qrCodes)) {
        foreach ($rows as &$r) $r['check_status'] = 'OUT';
        unset($r);
        return $isSingle ? $rows[0] : $rows;
      }

      $placeholders = implode(',', array_fill(0, count($qrCodes), '?'));

      $sql = "SELECT qr_code, check_type
                FROM (
                  SELECT qr_code, check_type,
                         ROW_NUMBER() OVER (PARTITION BY qr_code ORDER BY scan_timestamp DESC, id DESC) AS rn
                  FROM check_in_out
                  WHERE qr_code IN ($placeholders)
                ) ranked
               WHERE rn = 1";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute(array_values($qrCodes));
      $statusRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      $statusMap = [];
      foreach ($statusRows as $sr) {
        $statusMap[$sr['qr_code']] = $sr['check_type'];
      }

      $normalizedMap = [];
      foreach ($statusMap as $qr => $type) {
        $normalizedMap[normalizeCardNo($qr)] = $type;
      }

      foreach ($rows as &$row) {
        $qr = $row['qr_code'] ?? '';
        if (isset($statusMap[$qr])) {
          $row['check_status'] = $statusMap[$qr];
        } elseif (isset($normalizedMap[normalizeCardNo($qr)])) {
          $row['check_status'] = $normalizedMap[normalizeCardNo($qr)];
        } else {
          $row['check_status'] = 'OUT';
        }
      }
      unset($row);
    } catch (PDOException $e) {
      error_log("batchCheckStatuses error: " . $e->getMessage());
      foreach ($rows as &$r) $r['check_status'] = 'OUT';
      unset($r);
    }

    return $isSingle ? $rows[0] : $rows;
  }

  public function searchEmployees(array $searchParams = []): array
  {
    $startTime    = microtime(true);
    $searchTerm   = '';
    $results      = [];
    $success      = true;
    $errorMessage = null;

    try {
      $sql    = "SELECT id, fullname, position, brand, status, shift,
                        violation, image, qr_code
                   FROM employees WHERE 1=1";
      $params = [];

      foreach (['qr_code', 'fullname', 'position', 'brand', 'shift', 'status'] as $field) {
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
                    END, fullname ASC";
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
      foreach ($params as $k => $v) $stmt->bindValue($k, $v, PDO::PARAM_STR);
      $stmt->execute();
      $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      foreach ($rows as &$row) $row = $this->cleanEmployee($row);
      unset($row);

      $rows = $this->batchCheckStatuses($rows);

      foreach ($rows as $employee) {
        $results[] = $employee;
        if ($this->logger) $this->logger->logEmployeeAccess($employee, 'search_result');
      }
    } catch (Exception $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("Search error: " . $e->getMessage());
    }

    $executionTime = (microtime(true) - $startTime) * 1000;
    if ($this->logger) {
      $first     = $results[0] ?? [];
      $auditData = $first ? ['employee_id' => $first['id'] ?? null, 'fullname' => $first['fullname'] ?? null, 'qr_code' => $first['qr_code'] ?? null, 'check_status' => $first['check_status'] ?? null] : [];
      $this->logger->logSearchQuery('live_search', $searchTerm, $searchParams, count($results), $auditData, $executionTime, $success, $errorMessage);
    }

    return $results;
  }

  public function getEmployeeByQR(string $qr_code, bool $autoToggle = true): array|null
  {
    $startTime    = microtime(true);
    $success      = true;
    $errorMessage = null;
    $result       = null;

    try {
      $normalized = normalizeCardNo($qr_code);

      $stmt = $this->conn->prepare(
        "SELECT id, fullname, position, brand, status, shift,
                violation, image, qr_code
           FROM employees
          WHERE qr_code = :exact
             OR (qr_code REGEXP '^[0-9]+$' AND TRIM(LEADING '0' FROM qr_code) = :norm)
          LIMIT 1"
      );
      $stmt->execute([':exact' => $qr_code, ':norm' => $normalized]);
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      if ($result) {
        $result = $this->cleanEmployee($result);

        if (isset($result['status']) && strtolower(trim($result['status'])) === 'inactive') {
          return ['__inactive__' => true];
        }

        $canonicalQr = $result['qr_code'];

        if ($autoToggle && $this->logger) {
          $previousStatus        = $this->logger->getEmployeeCheckStatus($canonicalQr);
          $newStatus             = $this->logger->toggleEmployeeStatus($canonicalQr, $result['fullname']);
          $result['check_status']    = ($newStatus !== false) ? $newStatus : $previousStatus;
          $result['previous_status'] = $previousStatus;
          $result['status_changed']  = ($newStatus !== false);
        } else {
          $result = $this->batchCheckStatuses($result);
          $result['status_changed'] = false;
        }

        if ($this->logger) $this->logger->logEmployeeAccess($result, 'proximity_scan');
      }
    } catch (PDOException $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("getEmployeeByQR error: " . $e->getMessage());
    }

    $executionTime = (microtime(true) - $startTime) * 1000;
    if ($this->logger) {
      $auditData = $result ? ['employee_id' => $result['id'] ?? null, 'fullname' => $result['fullname'] ?? null, 'qr_code' => $result['qr_code'] ?? null, 'check_status' => $result['check_status'] ?? null] : [];
      $this->logger->logSearchQuery('get_by_qr', $qr_code, ['qr_code' => $qr_code], $result ? 1 : 0, $auditData, $executionTime, $success, $errorMessage);
    }

    return $result;
  }

  public function getEmployee(int $id): array|null
  {
    $startTime    = microtime(true);
    $success      = true;
    $errorMessage = null;
    $result       = null;

    try {
      $stmt = $this->conn->prepare(
        "SELECT id, fullname, position, brand, status, shift,
                violation, image, qr_code
           FROM employees WHERE id = :id LIMIT 1"
      );
      $stmt->execute([':id' => $id]);
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      if ($result) {
        $result = $this->cleanEmployee($result);
        $result = $this->batchCheckStatuses($result);
        if ($this->logger) $this->logger->logEmployeeAccess($result, 'direct_access_by_id');
      }
    } catch (PDOException $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("getEmployee error: " . $e->getMessage());
    }

    $executionTime = (microtime(true) - $startTime) * 1000;
    if ($this->logger) {
      $auditData = $result ? ['employee_id' => $result['id'] ?? null, 'fullname' => $result['fullname'] ?? null, 'qr_code' => $result['qr_code'] ?? null, 'check_status' => $result['check_status'] ?? null] : [];
      $this->logger->logSearchQuery('get_by_id', (string)$id, ['id' => $id], $result ? 1 : 0, $auditData, $executionTime, $success, $errorMessage);
    }

    return $result;
  }
}

// ── Main request handler ───────────────────────────────────────────────────────
try {
  $database = new Database($currentUserId);
  $db       = $database->connect();
  if (!$db) throw new Exception("Database connection failed");

  $logger        = new QueryLogger($db, $currentUserId);
  $searchHandler = new LiveSearchHandler($db, $logger, $currentUserId);
  $response      = ['success' => false, 'message' => '', 'data' => []];

  if ($_SERVER['REQUEST_METHOD'] === 'GET') {

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

    if ($q === '') {
      $response['message'] = 'No search parameters provided';
    } else {
      $employees           = $searchHandler->searchEmployees(['qr_code' => $q]);
      $response['success'] = true;
      $response['data']    = $employees;
      $response['count']   = count($employees);
      $response['message'] = empty($employees)
        ? 'No employees found matching your search criteria.'
        : count($employees) . ' employee(s) found.';
    }
  } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {

    $input  = json_decode(file_get_contents('php://input'), true) ?: $_POST;
    $action = $input['action'] ?? '';

    switch ($action) {

      case 'get_by_qr':
        $qr_code    = mb_substr(trim($input['qr_code'] ?? ''), 0, 100);
        $source     = $input['source'] ?? 'manual';
        $autoToggle = ($source === 'scanner') && (bool)($input['auto_toggle'] ?? true);

        if (empty($qr_code)) {
          $response['message'] = 'QR code is required';
          break;
        }

        $employee = $searchHandler->getEmployeeByQR($qr_code, $autoToggle);

        if (isset($employee['__inactive__'])) {
          $response['success']    = false;
          $response['error_code'] = 'EMPLOYEE_INACTIVE';
          $response['message']    = 'Access denied. Employee is inactive.';
          break;
        }

        if ($employee) {
          $response['success'] = true;
          $response['data']    = $employee;
          $response['message'] = !empty($employee['status_changed'])
            ? "Employee checked {$employee['check_status']}."
            : 'Employee found. Current status: ' . $employee['check_status'];
        } else {
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
          $response['message'] = 'Employee not found.';
        }
        break;

      case 'toggle_status':
        $qr_code  = mb_substr(trim($input['qr_code']  ?? ''), 0, 100);
        $fullname = mb_substr(trim($input['fullname']  ?? ''), 0, 255);

        if (empty($qr_code) || empty($fullname)) {
          $response['message'] = 'QR code and fullname are required';
          break;
        }

        $newStatus = $logger->toggleEmployeeStatus($qr_code, $fullname);
        if ($newStatus !== false) {
          $response['success'] = true;
          $response['data']    = ['new_status' => $newStatus];
          $response['message'] = 'Employee status changed to: ' . $newStatus;
        } else {
          $response['message'] = 'Failed to change employee status';
        }
        break;

      default:
        $response['message'] = 'Invalid or missing action parameter.';
    }
  } else {
    $response['message'] = 'Invalid request method.';
  }
} catch (Exception $e) {
  error_log("Critical server error: " . $e->getMessage());
  $response = ['success' => false, 'message' => 'An unexpected error occurred. Please try again.', 'data' => []];
  http_response_code(500);
}

echo json_encode($response, JSON_PRETTY_PRINT);
exit;
