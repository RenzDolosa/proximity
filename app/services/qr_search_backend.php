<?php
// qr_search_backend.php

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
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, Authorization');
header('Access-Control-Max-Age: 86400');

require_once __DIR__ . '/../../config/config.php';

if (isset($_GET['serve_file'])) {
  header('Cache-Control: public, max-age=3600');
  header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 3600) . ' GMT');
}

ob_clean();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(200);
  exit();
}

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
              (employee_id, qr_code, fullname, check_type, scan_timestamp,
               ip_address, user_agent)
            VALUES
              (:employee_id, :qr_code, :fullname, :check_type, :scan_timestamp,
               :ip_address, :user_agent)";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute([
        ':employee_id' => $employeeId,
        ':qr_code'     => $qrCode,
        ':fullname'    => $fullname,
        ':check_type'  => $checkType,
        ':scan_timestamp' => $now,
        ':ip_address'  => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent'  => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
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
      $sql = "INSERT INTO employee_access_log
                (employee_id, fullname, position, brand, status, shift,
                 violation, image, qr_code, check_status,
                 access_type, ip_address, user_agent, access_timestamp)
              VALUES
                (:employee_id, :fullname, :position, :brand, :status, :shift,
                 :violation, :image, :qr_code, :check_status,
                 :access_type, :ip_address, :user_agent, NOW())";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute([
        ':employee_id'  => $employeeData['id']           ?? null,
        ':fullname'     => $employeeData['fullname']      ?? null,
        ':position'     => $employeeData['position']      ?? null,
        ':brand'        => $employeeData['brand']         ?? null,
        ':status'       => $employeeData['status']        ?? null,
        ':shift'        => $employeeData['shift']         ?? null,
        ':violation'    => $employeeData['violation']     ?? null,
        ':image'        => $employeeData['image']         ?? null,
        ':qr_code'      => $employeeData['qr_code']       ?? null,
        ':check_status' => $employeeData['check_status']  ?? null,
        ':access_type'  => $accessType,
        ':ip_address'   => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent'   => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
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
    $resultsData,
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
        ':results_data'      => json_encode($resultsData),
        ':ip_address'        => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent'        => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
        ':execution_time'    => $executionTime,
        ':success'           => $success ? 1 : 0,
        ':error_message'     => $errorMessage,
      ]);

      logSystemAction($this->userId, 'SEARCH_QUERY', json_encode([
        'query_type'    => $queryType,
        'search_term'   => $searchTerm,
        'results_count' => $resultsCount,
        'success'       => $success,
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

  // ─────────────────────────────────────────────────────────────────
  //  FIX 1: batchCheckStatuses — now correctly handles BOTH an array
  //  of employee rows AND a single employee row (associative array).
  //  Uses ROW_NUMBER() window function instead of a correlated subquery
  //  for better performance at scale.
  // ─────────────────────────────────────────────────────────────────
  private function batchCheckStatuses(array $employees): array
  {
    if (empty($employees) || !$this->conn) {
      // Single row (associative): has string keys, not numeric outer keys
      if (isset($employees['id'])) {
        $employees['check_status'] = 'OUT';
        return $employees;
      }
      foreach ($employees as &$e) $e['check_status'] = 'OUT';
      unset($e);
      return $employees;
    }

    // Detect single-row call: associative array with an 'id' key at the top level
    $isSingleRow = isset($employees['id']);
    $rows        = $isSingleRow ? [$employees] : $employees;

    try {
      $ids = array_column($rows, 'id');

      if (empty($ids)) {
        foreach ($rows as &$r) $r['check_status'] = 'OUT';
        unset($r);
        return $isSingleRow ? $rows[0] : $rows;
      }

      // ── FIX: ROW_NUMBER() window function replaces correlated subquery ──
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

      // batchCheckStatuses now correctly handles an array of rows
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
      $this->logger->logSearchQuery(
        'live_search',
        $searchTerm,
        $searchParams,
        count($results),
        [],
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
      $sql  = "SELECT * FROM {$this->employeesTable} WHERE qr_code = :qr_code LIMIT 1";
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
            // ── FIX 2: wrap single row correctly for batchCheckStatuses ──
            $result = $this->batchCheckStatuses($result);
            $result['status_changed'] = false;
          }
        } else {
          // ── FIX 2: same fix here ──
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
      $this->logger->logSearchQuery(
        $queryType,
        $qr_code,
        ['qr_code' => $qr_code],
        $result ? 1 : 0,
        $result ? [$result] : [],
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
      $sql  = "SELECT * FROM {$this->employeesTable} WHERE id = :id LIMIT 1";
      $stmt = $this->conn->prepare($sql);
      $stmt->bindParam(':id', $id);
      $stmt->execute();
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      if ($result) {
        $result = $this->cleanEmployee($result);
        // ── FIX 2: single-row call now handled correctly ──
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
      $this->logger->logSearchQuery(
        $queryType,
        (string)$id,
        ['id' => $id],
        $result ? 1 : 0,
        $result ? [$result] : [],
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
    throw new Exception("Failed to connect to user database. Please try again.");
  }

  $logger        = new QueryLogger($db, $currentUserId);
  $searchHandler = new LiveSearchHandler($db, $logger, $currentUserId);
  $response      = ['success' => false, 'message' => '', 'data' => []];

  if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $searchParams = [];

    $q = isset($_GET['q']) ? trim($_GET['q']) : '';

    if ($q === '') {
      foreach (['fullname', 'position', 'brand', 'status', 'shift', 'qr_code'] as $p) {
        $v = isset($_GET[$p]) ? trim($_GET[$p]) : '';
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
      $employees = $searchHandler->searchEmployees($searchParams);
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
        $qr_code    = trim($input['qr_code'] ?? '');
        $autoToggle = isset($input['auto_toggle']) ? (bool)$input['auto_toggle'] : true;

        if (empty($qr_code)) {
          $response['message'] = 'QR code is required';
          break;
        }

        $employee = $searchHandler->getEmployeeByQR($qr_code, $autoToggle);

        if ($employee) {
          $response['success'] = true;
          $response['data']    = $employee;

          if (!empty($employee['status_changed'])) {
            $prev = $employee['previous_status'] ?? '–';
            $curr = $employee['check_status'];
            $response['message'] = "Employee checked {$curr}. (was {$prev})";
          } else {
            $response['message'] = 'Employee found. Current status: ' . $employee['check_status'];
          }
        } else {
          $response['message'] = 'No employee found with QR code: ' . htmlspecialchars($qr_code);
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
          $response['message'] = 'Employee not found with ID: ' . $employee_id;
        }
        break;

      case 'toggle_status':
        $employee_id = intval($input['employee_id'] ?? 0);
        $qr_code     = trim($input['qr_code']      ?? '');
        $fullname    = trim($input['fullname']      ?? '');

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
        $response['message'] = 'Invalid or missing action parameter: ' . htmlspecialchars($action);
        break;
    }
  } else {
    $response['message'] = 'Invalid request method: ' . $_SERVER['REQUEST_METHOD'];
  }
} catch (Exception $e) {
  $response = [
    'success' => false,
    'message' => 'Server error: ' . $e->getMessage(),
    'data'    => [],
  ];
  error_log("Critical server error: " . $e->getMessage());
  http_response_code(500);
}

echo json_encode($response, JSON_PRETTY_PRINT);
exit;
