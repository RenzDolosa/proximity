<?php
// qr_search_backend.php

session_start();

error_reporting(E_ALL);
ini_set('display_errors', 1);

// QR Pass Live Search Backend with Query Logging and IN/OUT Tracking
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, Authorization');
header('Access-Control-Max-Age: 86400');

// Include config.php for database functions
require_once 'config.php';

// Handle OPTIONS request for CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(200);
  exit();
}

// Check if user is logged in
if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode([
    'success' => false,
    'message' => 'Authentication required. Please log in to access this service.',
    'error_code' => 'AUTH_REQUIRED',
    'data' => []
  ]);
  exit();
}

$currentUserId = $_SESSION['user_id'];

// User Database configuration - connects to current user's database
class Database
{
  private $host = DB_HOST;
  private $db_name = USER_DB_PREFIX;
  private $username = DB_USER;
  private $password = DB_PASS;
  private $conn;
  private $userId;

  public function __construct($userId)
  {
    $this->userId = $userId;
    $this->db_name = USER_DB_PREFIX; // USER_DB_PREFIX . $userId;
    $this->host = USER_DB_HOST;
    $this->username = USER_DB_USER;
    $this->password = USER_DB_PASS;
  }

  public function connect()
  {
    $this->conn = null;
    try {
      if (!userDatabaseExists($this->userId)) {
        if (!createUserDatabase($this->userId)) {
          throw new Exception("Failed to create user database");
        }
      }

      $this->conn = new PDO(
        "mysql:host=" . $this->host . ";dbname=" . $this->db_name . ";charset=utf8mb4",
        $this->username,
        $this->password,
        [
          PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
          PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
          PDO::ATTR_EMULATE_PREPARES => false
        ]
      );
      
      // Create check_in_out table if it doesn't exist
      $this->createCheckInOutTable();
      
    } catch (PDOException $e) {
      error_log("User DB Connection error: " . $e->getMessage());
      return null;
    }
    return $this->conn;
  }

  // Create check_in_out table for tracking employee IN/OUT status
  private function createCheckInOutTable()
  {
    try {
      $query = "CREATE TABLE IF NOT EXISTS check_in_out (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT NOT NULL,
        qr_code VARCHAR(255) NOT NULL,
        fullname VARCHAR(255) NOT NULL,
        check_type ENUM('IN', 'OUT') NOT NULL,
        scan_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        user_agent TEXT,
        INDEX idx_employee_id (employee_id),
        INDEX idx_qr_code (qr_code),
        INDEX idx_timestamp (scan_timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
      
      $this->conn->exec($query);
    } catch (PDOException $e) {
      error_log("Failed to create check_in_out table: " . $e->getMessage());
    }
  }

  public function getUserId()
  {
    return $this->userId;
  }

  public function getDatabaseName()
  {
    return $this->db_name;
  }
}

// Updated Query Logger Class with IN/OUT tracking
class QueryLogger
{
  private $conn;
  private $userId;

  public function __construct($db, $userId)
  {
    $this->conn = $db;
    $this->userId = $userId;
  }

  // Log check-in/out activity
  public function logCheckInOut($employeeId, $qrCode, $fullname, $checkType)
  {
    if (!$this->conn) return false;

    try {
      $query = "INSERT INTO check_in_out 
                (employee_id, qr_code, fullname, check_type, ip_address, user_agent) 
                VALUES (:employee_id, :qr_code, :fullname, :check_type, :ip_address, :user_agent)";
      
      $stmt = $this->conn->prepare($query);
      $stmt->execute([
        ':employee_id' => $employeeId,
        ':qr_code' => $qrCode,
        ':fullname' => $fullname,
        ':check_type' => $checkType,
        ':ip_address' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown'
      ]);

      // Log system action
      logSystemAction($this->userId, 'check_in_out', json_encode([
        'employee_id' => $employeeId,
        'fullname' => $fullname,
        'qr_code' => $qrCode,
        'check_type' => $checkType
      ]));

      return true;
    } catch (PDOException $e) {
      error_log("Check-in/out logging error: " . $e->getMessage());
      return false;
    }
  }

  // Get employee's current check status
  public function getEmployeeCheckStatus($employeeId, $qrCode = null)
  {
    if (!$this->conn) return 'IN'; // Default to OUT if no connection

    try {
      $query = "SELECT check_type FROM check_in_out 
                WHERE employee_id = :employee_id";
      $params = [':employee_id' => $employeeId];

      if ($qrCode) {
        $query .= " OR qr_code = :qr_code";
        $params[':qr_code'] = $qrCode;
      }

      $query .= " ORDER BY scan_timestamp DESC LIMIT 1";

      $stmt = $this->conn->prepare($query);
      $stmt->execute($params);
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      return $result ? $result['check_type'] : 'IN';
    } catch (PDOException $e) {
      error_log("Get check status error: " . $e->getMessage());
      return 'OUT';
    }
  }

  // Toggle employee check status (IN -> OUT, OUT -> IN)
  public function toggleEmployeeStatus($employeeId, $qrCode, $fullname)
  {
    $currentStatus = $this->getEmployeeCheckStatus($employeeId, $qrCode);
    $newStatus = ($currentStatus === 'OUT') ? 'IN' : 'OUT';
    
    if ($this->logCheckInOut($employeeId, $qrCode, $fullname, $newStatus)) {
      return $newStatus;
    }
    
    return false;
  }

  // Original logging methods (keeping existing functionality)
  public function logSearchQuery($queryType, $searchTerm, $searchParams, $resultsCount, $resultsData, $executionTime, $success, $errorMessage = null)
  {
    if (!$this->conn) return false;

    $query = "INSERT INTO search_queries 
              (query_type, search_term, search_parameters, results_count, results_data, 
               ip_address, user_agent, execution_time_ms, success, error_message) 
              VALUES 
              (:query_type, :search_term, :search_parameters, :results_count, :results_data, 
               :ip_address, :user_agent, :execution_time, :success, :error_message)";

    try {
      $stmt = $this->conn->prepare($query);
      $stmt->execute([
        ':query_type' => $queryType,
        ':search_term' => $searchTerm,
        ':search_parameters' => json_encode($searchParams),
        ':results_count' => $resultsCount,
        ':results_data' => json_encode($resultsData),
        ':ip_address' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
        ':execution_time' => $executionTime,
        ':success' => $success ? 1 : 0,
        ':error_message' => $errorMessage
      ]);

      logSystemAction($this->userId, 'search_query', json_encode([
        'query_type' => $queryType,
        'search_term' => $searchTerm,
        'results_count' => $resultsCount,
        'success' => $success
      ]));

      return true;
    } catch (PDOException $e) {
      error_log("Query logging error: " . $e->getMessage());
      return false;
    }
  }

  public function logEmployeeAccess($employeeData, $accessType)
  {
    if (!$this->conn) return false;

    $query = "INSERT INTO employee_access_log 
              (employee_id, fullname, position, brand, status, shift, violation, image, qr_code, access_type, ip_address, user_agent, check_status) 
              VALUES 
              (:employee_id, :fullname, :position, :brand, :status, :shift, :violation, :image, :qr_code, :access_type, :ip_address, :user_agent, :check_status)";

    try {
      $stmt = $this->conn->prepare($query);
      $stmt->execute([
        ':employee_id' => $employeeData['id'] ?? null,
        ':fullname' => $employeeData['fullname'] ?? null,
        ':position' => $employeeData['position'] ?? null,
        ':brand' => $employeeData['brand'] ?? null,
        ':status' => $employeeData['status'] ?? null,
        ':shift' => $employeeData['shift'] ?? null,
        ':violation' => $employeeData['violation'] ?? null,
        ':image' => $employeeData['image'] ?? null,
        ':qr_code' => $employeeData['qr_code'] ?? null,
        ':check_status' => $employeeData['check_status'] ?? null,
        ':access_type' => $accessType,
        ':ip_address' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown'
      ]);

      logSystemAction($this->userId, 'employee_access', json_encode([
        'employee_id' => $employeeData['id'] ?? null,
        'fullname' => $employeeData['fullname'] ?? null,
        'access_type' => $accessType
      ]));

      return true;
    } catch (PDOException $e) {
      error_log("Employee access logging error: " . $e->getMessage());
      return false;
    }
  }
}

// Updated Live Search Handler with IN/OUT status integration
class LiveSearchHandler
{
  private $conn;
  private $logger;
  private $table = 'employees';
  private $userId;

  public function __construct($db, $logger, $userId)
  {
    $this->conn = $db;
    $this->logger = $logger;
    $this->userId = $userId;
  }

  // Enhanced search with IN/OUT status
  public function searchEmployees($searchParams = [])
  {
    $startTime = microtime(true);
    $queryType = 'live_search';
    $searchTerm = '';
    $results = [];
    $success = true;
    $errorMessage = null;

    try {
      // Base query with subquery to get current check status
      $query = "SELECT e.*, 
                COALESCE(
                  (SELECT cio.check_type 
                   FROM check_in_out cio 
                   WHERE cio.employee_id = e.id 
                   ORDER BY cio.scan_timestamp DESC 
                   LIMIT 1), 
                  'IN'
                ) as check_status
                FROM " . $this->table . " e WHERE 1=1";
      $params = [];

      $searchConditions = [];
      $hasSearchTerm = false;

      foreach ($searchParams as $field => $value) {
        if (!empty($value) && in_array($field, ['qr_code', 'fullname', 'position', 'brand', 'shift', 'status'])) {
          $hasSearchTerm = true;
          $searchTerm = $value;
          break;
        }
      }

      if ($hasSearchTerm && !empty($searchTerm)) {
        $searchFields = ['e.fullname', 'e.position', 'e.qr_code', 'e.brand', 'e.shift', 'e.status', 'e.violation'];

        foreach ($searchFields as $field) {
          $searchConditions[] = "$field LIKE :search_term";
        }

        if (!empty($searchConditions)) {
          $query .= " AND (" . implode(" OR ", $searchConditions) . ")";
          $params[':search_term'] = '%' . $searchTerm . '%';
        }

        $query .= " ORDER BY 
                    CASE 
                        WHEN e.qr_code = :exact_term THEN 1
                        WHEN e.fullname = :exact_term THEN 2
                        WHEN e.qr_code LIKE :starts_term THEN 3
                        WHEN e.fullname LIKE :starts_term THEN 4
                        ELSE 5
                    END,
                    e.fullname ASC";

        $params[':exact_term'] = $searchTerm;
        $params[':starts_term'] = $searchTerm . '%';
      } else {
        if (!empty($searchParams['status'])) {
          $query .= " AND e.status = :status";
          $params[':status'] = $searchParams['status'];
        }

        if (!empty($searchParams['shift'])) {
          $query .= " AND e.shift = :shift";
          $params[':shift'] = $searchParams['shift'];
        }

        if (!empty($searchParams['brand'])) {
          $query .= " AND e.brand = :brand";
          $params[':brand'] = $searchParams['brand'];
        }

        $query .= " ORDER BY e.fullname ASC";
      }

      $query .= "";

      $stmt = $this->conn->prepare($query);

      foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
      }

      $stmt->execute();
      $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

      if ($this->logger && !empty($results)) {
        foreach ($results as $employee) {
          $this->logger->logEmployeeAccess($employee, 'search_result');
        }
      }

    } catch (PDOException $e) {
      $success = false;
      $errorMessage = $e->getMessage();
      error_log("Search error: " . $e->getMessage());
      $results = [];
    } catch (Exception $e) {
      $success = false;
      $errorMessage = $e->getMessage();
      error_log("General search error: " . $e->getMessage());
      $results = [];
    }

    $executionTime = (microtime(true) - $startTime) * 1000;

    if ($this->logger) {
      $this->logger->logSearchQuery(
        $queryType,
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

  // Get employee by QR code with IN/OUT status and auto-toggle
  public function getEmployeeByQR($qr_code, $autoToggle = true)
  {
    $startTime = microtime(true);
    $queryType = 'get_by_qr';
    $success = true;
    $errorMessage = null;
    $result = null;

    try {
      // Get employee with current check status
      $query = "SELECT e.*, 
                COALESCE(
                  (SELECT cio.check_type 
                   FROM check_in_out cio 
                   WHERE cio.employee_id = e.id 
                   ORDER BY cio.scan_timestamp DESC 
                   LIMIT 1), 
                  'IN'
                ) as check_status
                FROM " . $this->table . " e WHERE e.qr_code = :qr_code";
      
      $stmt = $this->conn->prepare($query);
      $stmt->bindParam(':qr_code', $qr_code);
      $stmt->execute();
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      if ($result && $this->logger) {
        // Log employee access
        $this->logger->logEmployeeAccess($result, 'qr_code_scan');
        
        // Auto-toggle status if enabled
        if ($autoToggle) {
          $newStatus = $this->logger->toggleEmployeeStatus(
            $result['id'], 
            $result['qr_code'], 
            $result['fullname']
          );
          
          if ($newStatus) {
            $result['check_status'] = $newStatus;
            $result['status_changed'] = true;
            $result['previous_status'] = ($newStatus === 'IN') ? 'IN' : 'OUT';
          }
        }
      }
    } catch (PDOException $e) {
      $success = false;
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

  // Get employee by ID with current check status
  public function getEmployee($id)
  {
    $startTime = microtime(true);
    $queryType = 'get_by_id';
    $success = true;
    $errorMessage = null;
    $result = null;

    try {
      $query = "SELECT e.*, 
                COALESCE(
                  (SELECT cio.check_type 
                   FROM check_in_out cio 
                   WHERE cio.employee_id = e.id 
                   ORDER BY cio.scan_timestamp DESC 
                   LIMIT 1), 
                  'IN'
                ) as check_status
                FROM " . $this->table . " e WHERE e.id = :id";
      
      $stmt = $this->conn->prepare($query);
      $stmt->bindParam(':id', $id);
      $stmt->execute();
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      if ($result && $this->logger) {
        $this->logger->logEmployeeAccess($result, 'direct_access_by_id');
      }
    } catch (PDOException $e) {
      $success = false;
      $errorMessage = $e->getMessage();
      error_log("Get employee error: " . $e->getMessage());
    }

    $executionTime = (microtime(true) - $startTime) * 1000;

    if ($this->logger) {
      $this->logger->logSearchQuery(
        $queryType,
        (string) $id,
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

// Main execution (keeping existing structure with enhanced functionality)
try {
    $database = new Database($currentUserId);
    $db = $database->connect();

    if (!$db) {
        throw new Exception("Failed to connect to user database. Please try again.");
    }

    $logger = new QueryLogger($db, $currentUserId);
    $searchHandler = new LiveSearchHandler($db, $logger, $currentUserId);
    $response = ['success' => false, 'message' => '', 'data' => [], 'debug' => []];

    $response['debug'] = [
        'user_id' => $currentUserId,
        'database' => $database->getDatabaseName(),
        'request_method' => $_SERVER['REQUEST_METHOD'],
        'timestamp' => date('Y-m-d H:i:s')
    ];

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $searchParams = [];
        $allowedParams = ['fullname', 'position', 'brand', 'status', 'shift', 'qr_code'];
        
        foreach ($allowedParams as $param) {
            $value = isset($_GET[$param]) ? trim($_GET[$param]) : '';
            if ($value !== '') {
                $searchParams[$param] = $value;
            }
        }

        $response['debug']['search_params'] = $searchParams;

        if (empty($searchParams)) {
            $response['message'] = 'No search parameters provided';
            $response['data'] = [];
        } else {
            $employees = $searchHandler->searchEmployees($searchParams);

            $response['success'] = true;
            $response['data'] = $employees;
            $response['count'] = count($employees);

            if (empty($employees)) {
                $response['message'] = 'No employees found matching your search criteria.';
            } else {
                $response['message'] = count($employees) . ' employee(s) found.';
            }
        }
    }
    elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        if (!$input) {
            $input = $_POST;
        }
        
        $action = $input['action'] ?? '';
        $response['debug']['action'] = $action;

        switch ($action) {
            case 'get_by_qr':
                $qr_code = trim($input['qr_code'] ?? '');
                $autoToggle = isset($input['auto_toggle']) ? (bool)$input['auto_toggle'] : true;
                
                if (empty($qr_code)) {
                    $response['message'] = 'QR code is required';
                    break;
                }

                $employee = $searchHandler->getEmployeeByQR($qr_code, $autoToggle);
                if ($employee) {
                    $response['success'] = true;
                    $response['data'] = $employee;
                    
                    if (isset($employee['status_changed']) && $employee['status_changed']) {
                        $response['message'] = 'Employee found and status changed to: ' . $employee['check_status'];
                    } else {
                        $response['message'] = 'Employee found - Current status: ' . $employee['check_status'];
                    }
                } else {
                    $response['message'] = 'No employee found with QR code: ' . $qr_code;
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
                    $response['data'] = $employee;
                    $response['message'] = 'Employee found - Current status: ' . $employee['check_status'];
                } else {
                    $response['message'] = 'Employee not found with ID: ' . $employee_id;
                }
                break;

            case 'toggle_status':
                $employee_id = intval($input['employee_id'] ?? 0);
                $qr_code = trim($input['qr_code'] ?? '');
                $fullname = trim($input['fullname'] ?? '');
                
                if ($employee_id <= 0 || empty($qr_code) || empty($fullname)) {
                    $response['message'] = 'Employee ID, QR code, and fullname are required';
                    break;
                }

                $newStatus = $logger->toggleEmployeeStatus($employee_id, $qr_code, $fullname);
                if ($newStatus) {
                    $response['success'] = true;
                    $response['data'] = ['new_status' => $newStatus];
                    $response['message'] = 'Employee status changed to: ' . $newStatus;
                } else {
                    $response['message'] = 'Failed to change employee status';
                }
                break;

            default:
                $response['message'] = 'Invalid or missing action parameter: ' . $action;
                break;
        }
    }
    else {
        $response['message'] = 'Invalid request method: ' . $_SERVER['REQUEST_METHOD'];
    }

} catch (Exception $e) {
    $response = [
        'success' => false,
        'message' => 'Server error: ' . $e->getMessage(),
        'data' => [],
        'error_details' => [
            'file' => $e->getFile(),
            'line' => $e->getLine(),
            'trace' => $e->getTraceAsString()
        ]
    ];
    error_log("Critical server error: " . $e->getMessage());
    http_response_code(500);
}

// Remove debug info in production
if (isset($_GET['debug']) || isset($_POST['debug'])) {
    // Keep debug info
} else {
    unset($response['debug']);
    unset($response['error_details']);
}

echo json_encode($response, JSON_PRETTY_PRINT);
exit;
?>