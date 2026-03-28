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
ini_set('display_errors', 0);   // NEVER echo errors into the JSON stream
ini_set('log_errors', 1);

// ── Headers ─────────────────────────────────────────────────
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, Authorization');
header('Access-Control-Max-Age: 86400');

// ── Config (already guards session_start internally) ────────
require_once 'config.php';

// ── Discard any stray output before we echo JSON ────────────
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

// ─────────────────────────────────────────────
//  Database — connects to the user's database
//  (same approach as manpower_backend.php)
// ─────────────────────────────────────────────
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
      // Ensure the user database exists (mirrors manpower_backend.php)
      if (!userDatabaseExists($this->userId)) {
        if (!createUserDatabase($this->userId)) {
          throw new Exception("Failed to create user database");
        }
      }

      $this->conn = getUserDBConnection($this->userId);

      // Guarantee the check_in_out table is present
      $this->createCheckInOutTable();

      return $this->conn;
    } catch (Exception $e) {
      error_log("User DB Connection error: " . $e->getMessage());
      return null;
    }
  }

  // Create check_in_out table if it doesn't exist
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

  public function getUserId()   { return $this->userId; }
  public function getConnection() { return $this->conn; }
}

// ─────────────────────────────────────────────
//  QueryLogger — logs access & IN/OUT events
// ─────────────────────────────────────────────
class QueryLogger
{
  private $conn;
  private $userId;

  public function __construct($db, $userId)
  {
    $this->conn   = $db;
    $this->userId = $userId;
  }

  // ── Core IN/OUT logic ──────────────────────
  //
  //  Rule:
  //    No previous record  → first scan  → IN
  //    Last record = IN    → next scan   → OUT
  //    Last record = OUT   → next scan   → IN
  //
  //  i.e. the NEW status is always the OPPOSITE of the last one,
  //  with a default of OUT (so the first toggle produces IN).
  // ───────────────────────────────────────────

  /**
   * Returns the most-recent check_type for this employee,
   * or 'OUT' when no record exists yet (so first scan → IN).
   */
  public function getEmployeeCheckStatus($employeeId, $qrCode = null)
  {
    if (!$this->conn) return 'OUT';

    try {
      // Match by employee_id OR qr_code (whichever is available)
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

      // No record → default OUT (so first scan produces IN)
      return $row ? $row['check_type'] : 'OUT';
    } catch (PDOException $e) {
      error_log("Get check status error: " . $e->getMessage());
      return 'OUT';
    }
  }

  /**
   * Inserts a new check_in_out row with the given check_type.
   */
  public function logCheckInOut($employeeId, $qrCode, $fullname, $checkType)
  {
    if (!$this->conn) return false;

    try {
      $sql = "INSERT INTO check_in_out
                (employee_id, qr_code, fullname, check_type, ip_address, user_agent)
              VALUES
                (:employee_id, :qr_code, :fullname, :check_type, :ip_address, :user_agent)";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute([
        ':employee_id' => $employeeId,
        ':qr_code'     => $qrCode,
        ':fullname'    => $fullname,
        ':check_type'  => $checkType,
        ':ip_address'  => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent'  => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
      ]);

      logSystemAction($this->userId, 'check_in_out', json_encode([
        'employee_id' => $employeeId,
        'fullname'    => $fullname,
        'qr_code'     => $qrCode,
        'check_type'  => $checkType,
      ]));

      return true;
    } catch (PDOException $e) {
      error_log("Check-in/out logging error: " . $e->getMessage());
      return false;
    }
  }

  /**
   * Toggles the employee's status (IN→OUT or OUT→IN) and persists it.
   * Returns the NEW status string, or false on failure.
   *
   *  Scan 1 (no record) : last='OUT' → new='IN'
   *  Scan 2             : last='IN'  → new='OUT'
   *  Scan 3             : last='OUT' → new='IN'
   *  Scan 4             : last='IN'  → new='OUT'
   */
  public function toggleEmployeeStatus($employeeId, $qrCode, $fullname)
  {
    $lastStatus = $this->getEmployeeCheckStatus($employeeId, $qrCode);
    $newStatus  = ($lastStatus === 'IN') ? 'OUT' : 'IN';

    if ($this->logCheckInOut($employeeId, $qrCode, $fullname, $newStatus)) {
      return $newStatus;
    }

    return false;
  }

  // ── Access log (employee_access_log) ───────

  /**
   * Logs a row to employee_access_log, which mirrors the structure
   * used by datalog_backend.php.
   */
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
        ':employee_id' => $employeeData['id']           ?? null,
        ':fullname'    => $employeeData['fullname']      ?? null,
        ':position'    => $employeeData['position']      ?? null,
        ':brand'       => $employeeData['brand']         ?? null,
        ':status'      => $employeeData['status']        ?? null,
        ':shift'       => $employeeData['shift']         ?? null,
        ':violation'   => $employeeData['violation']     ?? null,
        ':image'       => $employeeData['image']         ?? null,
        ':qr_code'     => $employeeData['qr_code']       ?? null,
        ':check_status'=> $employeeData['check_status']  ?? null,
        ':access_type' => $accessType,
        ':ip_address'  => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent'  => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
      ]);

      logSystemAction($this->userId, 'employee_access', json_encode([
        'employee_id' => $employeeData['id'] ?? null,
        'fullname'    => $employeeData['fullname'] ?? null,
        'access_type' => $accessType,
      ]));

      return true;
    } catch (PDOException $e) {
      error_log("Employee access logging error: " . $e->getMessage());
      return false;
    }
  }

  // ── Generic search-query audit log ─────────

  public function logSearchQuery(
    $queryType, $searchTerm, $searchParams,
    $resultsCount, $resultsData, $executionTime,
    $success, $errorMessage = null
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
        ':query_type'       => $queryType,
        ':search_term'      => $searchTerm,
        ':search_parameters'=> json_encode($searchParams),
        ':results_count'    => $resultsCount,
        ':results_data'     => json_encode($resultsData),
        ':ip_address'       => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent'       => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
        ':execution_time'   => $executionTime,
        ':success'          => $success ? 1 : 0,
        ':error_message'    => $errorMessage,
      ]);

      logSystemAction($this->userId, 'search_query', json_encode([
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

// ─────────────────────────────────────────────
//  LiveSearchHandler — reads from `employees`
//  (the manpower_backend.php source of truth)
// ─────────────────────────────────────────────
class LiveSearchHandler
{
  private $conn;
  private $logger;
  private $userId;

  // Source-of-truth table (managed by manpower_backend.php — DO NOT write here)
  private $employeesTable = 'employees';

  public function __construct($db, $logger, $userId)
  {
    $this->conn   = $db;
    $this->logger = $logger;
    $this->userId = $userId;
  }

  // ── Helpers ────────────────────────────────

  /**
   * Enriches an employee row with its current IN/OUT check_status
   * by looking up the most recent check_in_out record.
   *
   * We do this via a sub-select so the caller gets a single flat array.
   */
  private function attachCheckStatus(array $employee): array
  {
    if (!$this->conn) {
      $employee['check_status'] = 'OUT';
      return $employee;
    }

    try {
      $sql = "SELECT check_type
              FROM check_in_out
              WHERE employee_id = :employee_id OR qr_code = :qr_code
              ORDER BY scan_timestamp DESC, id DESC
              LIMIT 1";

      $stmt = $this->conn->prepare($sql);
      $stmt->execute([
        ':employee_id' => $employee['id'],
        ':qr_code'     => $employee['qr_code'],
      ]);

      $row = $stmt->fetch(PDO::FETCH_ASSOC);

      // No record → default OUT (first scan will produce IN)
      $employee['check_status'] = $row ? $row['check_type'] : 'OUT';
    } catch (PDOException $e) {
      error_log("attachCheckStatus error: " . $e->getMessage());
      $employee['check_status'] = 'OUT';
    }

    return $employee;
  }

  // ── Public API ─────────────────────────────

  /**
   * Full-text live search across the `employees` table.
   * Returns employees with their current check_status attached.
   */
  public function searchEmployees($searchParams = [])
  {
    $startTime    = microtime(true);
    $queryType    = 'live_search';
    $searchTerm   = '';
    $results      = [];
    $success      = true;
    $errorMessage = null;

    try {
      $sql    = "SELECT * FROM {$this->employeesTable} WHERE 1=1";
      $params = [];

      // Detect a free-text search term from any of the recognised fields
      $searchableFields = ['qr_code', 'fullname', 'position', 'brand', 'shift', 'status'];
      foreach ($searchableFields as $field) {
        if (!empty($searchParams[$field])) {
          $searchTerm = $searchParams[$field];
          break;
        }
      }

      if ($searchTerm !== '') {
        $likeFields = [
          'fullname', 'position', 'qr_code',
          'brand', 'shift', 'status', 'violation', 'id'
        ];
        $conditions = [];
        foreach ($likeFields as $f) {
          $conditions[] = "$f LIKE :search_term";
        }

        $sql .= " AND (" . implode(' OR ', $conditions) . ")";
        $params[':search_term'] = '%' . $searchTerm . '%';

        // Rank exact/prefix matches first
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
        // Structured filters
        if (!empty($searchParams['status'])) {
          $sql .= " AND status = :status";
          $params[':status'] = $searchParams['status'];
        }
        if (!empty($searchParams['shift'])) {
          $sql .= " AND shift = :shift";
          $params[':shift'] = $searchParams['shift'];
        }
        if (!empty($searchParams['brand'])) {
          $sql .= " AND brand = :brand";
          $params[':brand'] = $searchParams['brand'];
        }

        $sql .= " ORDER BY fullname ASC";
      }

      $stmt = $this->conn->prepare($sql);
      foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
      }
      $stmt->execute();
      $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      // Attach check_status and log each result
      foreach ($rows as $employee) {
        $employee = $this->attachCheckStatus($employee);
        $results[] = $employee;

        if ($this->logger) {
          $this->logger->logEmployeeAccess($employee, 'search_result');
        }
      }
    } catch (PDOException $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("Search error: " . $e->getMessage());
      $results = [];
    } catch (Exception $e) {
      $success      = false;
      $errorMessage = $e->getMessage();
      error_log("General search error: " . $e->getMessage());
      $results = [];
    }

    $executionTime = (microtime(true) - $startTime) * 1000;

    if ($this->logger) {
      $this->logger->logSearchQuery(
        $queryType, $searchTerm, $searchParams,
        count($results), [], $executionTime,
        $success, $errorMessage
      );
    }

    return $results;
  }

  /**
   * Fetch a single employee by QR code, then toggle their IN/OUT status.
   *
   *  Scan sequence per employee:
   *    1st scan  → IN
   *    2nd scan  → OUT
   *    3rd scan  → IN
   *    4th scan  → OUT   … and so on
   *
   * @param string $qr_code     QR / proximity code scanned
   * @param bool   $autoToggle  Set false to skip the toggle (read-only lookup)
   */
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
        if ($autoToggle && $this->logger) {
          // Determine the NEW status before attaching it
          $previousStatus = $this->logger->getEmployeeCheckStatus(
            $result['id'], $result['qr_code']
          );

          $newStatus = $this->logger->toggleEmployeeStatus(
            $result['id'], $result['qr_code'], $result['fullname']
          );

          if ($newStatus !== false) {
            $result['check_status']    = $newStatus;
            $result['previous_status'] = $previousStatus;
            $result['status_changed']  = true;
          } else {
            // Toggle failed; attach read-only status
            $result = $this->attachCheckStatus($result);
            $result['status_changed'] = false;
          }
        } else {
          // Read-only path
          $result = $this->attachCheckStatus($result);
          $result['status_changed'] = false;
        }

        // Log the access with the resolved check_status
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
        $queryType, $qr_code, ['qr_code' => $qr_code],
        $result ? 1 : 0, $result ? [$result] : [],
        $executionTime, $success, $errorMessage
      );
    }

    return $result;
  }

  /**
   * Fetch a single employee by their primary key ID (read-only, no toggle).
   */
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
        $result = $this->attachCheckStatus($result);

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
        $queryType, (string)$id, ['id' => $id],
        $result ? 1 : 0, $result ? [$result] : [],
        $executionTime, $success, $errorMessage
      );
    }

    return $result;
  }
}

// ─────────────────────────────────────────────
//  Main request handler
// ─────────────────────────────────────────────
try {
  $database = new Database($currentUserId);
  $db       = $database->connect();

  if (!$db) {
    throw new Exception("Failed to connect to user database. Please try again.");
  }

  $logger        = new QueryLogger($db, $currentUserId);
  $searchHandler = new LiveSearchHandler($db, $logger, $currentUserId);
  $response      = ['success' => false, 'message' => '', 'data' => [], 'debug' => []];

  $response['debug'] = [
    'user_id'        => $currentUserId,
    'request_method' => $_SERVER['REQUEST_METHOD'],
    'timestamp'      => date('Y-m-d H:i:s'),
  ];

  // ── GET — live search ──────────────────────
  if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $searchParams    = [];
    $allowedParams   = ['fullname', 'position', 'brand', 'status', 'shift', 'qr_code'];

    foreach ($allowedParams as $param) {
      $value = isset($_GET[$param]) ? trim($_GET[$param]) : '';
      if ($value !== '') {
        $searchParams[$param] = $value;
      }
    }

    $response['debug']['search_params'] = $searchParams;

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
  }

  // ── POST — action-based ────────────────────
  elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input) {
      $input = $_POST;
    }

    $action = $input['action'] ?? '';
    $response['debug']['action'] = $action;

    switch ($action) {

      // Scan QR code → toggle IN/OUT, log to employee_access_log
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
            // Build a human-friendly direction message
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

      // Read-only lookup by employee primary key
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

      // Explicit manual toggle (e.g. from UI button)
      case 'toggle_status':
        $employee_id = intval($input['employee_id'] ?? 0);
        $qr_code     = trim($input['qr_code']     ?? '');
        $fullname    = trim($input['fullname']     ?? '');

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
    'success'       => false,
    'message'       => 'Server error: ' . $e->getMessage(),
    'data'          => [],
    'error_details' => [
      'file'  => $e->getFile(),
      'line'  => $e->getLine(),
      'trace' => $e->getTraceAsString(),
    ],
  ];
  error_log("Critical server error: " . $e->getMessage());
  http_response_code(500);
}

// Strip debug/error details in production (pass ?debug=1 to keep them)
if (empty($_GET['debug']) && empty($_POST['debug'])) {
  unset($response['debug']);
  unset($response['error_details']);
}

echo json_encode($response, JSON_PRETTY_PRINT);
exit;