<?php
// scanTest_search_backend.php

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

if (isset($_GET['serve_file'])) {
  header('Cache-Control: public, max-age=3600');
  header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 3600) . ' GMT');
}

// ── Discard any stray output before we echo JSON ────────────
ob_clean();

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
    } catch (PDOException $e) {
      error_log("User DB Connection error: " . $e->getMessage());
      return null;
    }
    return $this->conn;
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

// Simplified Live Search Handler - No automatic logging
class LiveSearchHandler
{
  private $conn;
  private $table = 'employees';
  private $userId;

  public function __construct($db, $userId)
  {
    $this->conn = $db;
    $this->userId = $userId;
  }

  public function searchEmployees($searchParams = [])
  {
    try {
      // Base query - simple employee search
      $query = "SELECT * FROM " . $this->table . " WHERE 1=1";
      $params = [];

      $searchConditions = [];
      $hasSearchTerm = false;
      $searchTerm = '';

      foreach ($searchParams as $field => $value) {
        if (!empty($value) && in_array($field, ['qr_code', 'fullname', 'position', 'brand', 'shift', 'status'])) {
          $hasSearchTerm = true;
          $searchTerm = $value;
          break;
        }
      }

      if ($hasSearchTerm && !empty($searchTerm)) {
        $searchFields = ['fullname', 'position', 'qr_code', 'brand', 'shift', 'status', 'violation'];

        foreach ($searchFields as $field) {
          $searchConditions[] = "$field LIKE :search_term";
        }

        if (!empty($searchConditions)) {
          $query .= " AND (" . implode(" OR ", $searchConditions) . ")";
          $params[':search_term'] = '%' . $searchTerm . '%';
        }

        $query .= " ORDER BY 
                    CASE 
                        WHEN qr_code = :exact_term THEN 1
                        WHEN fullname = :exact_term THEN 2
                        WHEN qr_code LIKE :starts_term THEN 3
                        WHEN fullname LIKE :starts_term THEN 4
                        ELSE 5
                    END,
                    fullname ASC";

        $params[':exact_term'] = $searchTerm;
        $params[':starts_term'] = $searchTerm . '%';
      } else {
        // Apply specific filters
        if (!empty($searchParams['status'])) {
          $query .= " AND status = :status";
          $params[':status'] = $searchParams['status'];
        }

        if (!empty($searchParams['shift'])) {
          $query .= " AND shift = :shift";
          $params[':shift'] = $searchParams['shift'];
        }

        if (!empty($searchParams['brand'])) {
          $query .= " AND brand = :brand";
          $params[':brand'] = $searchParams['brand'];
        }

        $query .= " ORDER BY fullname ASC";
      }

      $query .= " LIMIT 100";

      $stmt = $this->conn->prepare($query);

      foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value, PDO::PARAM_STR);
      }

      $stmt->execute();
      $results = $stmt->fetchAll(PDO::FETCH_ASSOC);

      return $results;
    } catch (PDOException $e) {
      error_log("Search error: " . $e->getMessage());
      return [];
    } catch (Exception $e) {
      error_log("General search error: " . $e->getMessage());
      return [];
    }
  }

  public function getEmployeeByQR($qr_code)
  {
    try {
      $query = "SELECT * FROM " . $this->table . " WHERE qr_code = :qr_code";

      $stmt = $this->conn->prepare($query);
      $stmt->bindParam(':qr_code', $qr_code);
      $stmt->execute();
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      return $result;
    } catch (PDOException $e) {
      error_log("Get employee by QR error: " . $e->getMessage());
      return null;
    }
  }

  // Get employee by ID
  public function getEmployee($id)
  {
    try {
      $query = "SELECT * FROM " . $this->table . " WHERE id = :id";

      $stmt = $this->conn->prepare($query);
      $stmt->bindParam(':id', $id);
      $stmt->execute();
      $result = $stmt->fetch(PDO::FETCH_ASSOC);

      return $result;
    } catch (PDOException $e) {
      error_log("Get employee error: " . $e->getMessage());
      return null;
    }
  }
}

// Main execution
try {
  $database = new Database($currentUserId);
  $db = $database->connect();

  if (!$db) {
    throw new Exception("Failed to connect to user database. Please try again.");
  }

  $searchHandler = new LiveSearchHandler($db, $currentUserId);
  $response = ['success' => false, 'message' => '', 'data' => [], 'debug' => []];

  $response['debug'] = [
    'user_id' => $currentUserId,
    'database' => $database->getDatabaseName(),
    'request_method' => $_SERVER['REQUEST_METHOD'],
    'timestamp' => date('Y-m-d H:i:s')
  ];

  if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $searchParams = [];

    // Unified single param — JS sends ?q= instead of repeating all 6 fields
    $q = isset($_GET['q']) ? trim($_GET['q']) : '';

    // Legacy individual params still supported as fallback
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
      $searchParams['qr_code'] = $q; // searchEmployees fans this out to all fields
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
  } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!$input) {
      $input = $_POST;
    }

    $action = $input['action'] ?? '';
    $response['debug']['action'] = $action;

    switch ($action) {
      case 'get_by_qr':
        $qr_code = trim($input['qr_code'] ?? '');

        if (empty($qr_code)) {
          $response['message'] = 'QR code is required';
          break;
        }

        $employee = $searchHandler->getEmployeeByQR($qr_code);
        if ($employee) {
          $response['success'] = true;
          $response['data'] = $employee;
          $response['message'] = 'Employee found';
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
          $response['message'] = 'Employee found';
        } else {
          $response['message'] = 'Employee not found with ID: ' . $employee_id;
        }
        break;

      default:
        $response['message'] = 'Invalid or missing action parameter: ' . $action;
        break;
    }
  } else {
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
