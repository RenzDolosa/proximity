<?php
// scanTest_search_backend.php

// ── Buffer output so stray warnings never corrupt JSON ──────
ob_start();

// ── Session before anything else ───────────────────────────
if (session_status() === PHP_SESSION_NONE) {
  session_start();
}

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

ob_clean();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(200);
  exit();
}

if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode([
    'success' => false,
    'message' => 'Authentication required. Please log in.',
    'error_code' => 'AUTH_REQUIRED',
    'data' => []
  ]);
  exit();
}

$currentUserId = $_SESSION['user_id'];

class Database
{
  private $host;
  private $db_name;
  private $username;
  private $password;
  private $conn;
  private $userId;

  public function __construct($userId)
  {
    $this->userId   = $userId;
    $this->db_name  = USER_DB_PREFIX;
    $this->host     = USER_DB_HOST;
    $this->username = USER_DB_USER;
    $this->password = USER_DB_PASS;
  }

  public function connect()
  {
    $this->conn = null;
    try {
      if (!userDatabaseExists($this->userId)) {
        $result = createUserDatabase($this->userId);
        if (!$result['success']) {
          throw new Exception("Failed to create user database: " . ($result['error'] ?? ''));
        }
      }

      $this->conn = new PDO(
        "mysql:host={$this->host};dbname={$this->db_name};charset=utf8mb4",
        $this->username,
        $this->password,
        [
          PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
          PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
          PDO::ATTR_EMULATE_PREPARES   => false,
        ]
      );
    } catch (PDOException $e) {
      error_log("User DB Connection error: " . $e->getMessage());
      return null;
    }
    return $this->conn;
  }

  public function getUserId()     { return $this->userId; }
  public function getDatabaseName() { return $this->db_name; }
}

class LiveSearchHandler
{
  private $conn;
  private $table = 'employees';
  private $userId;

  public function __construct($db, $userId)
  {
    $this->conn   = $db;
    $this->userId = $userId;
  }

  /**
   * Exact QR code lookup — returns a single employee or null.
   */
  public function getEmployeeByQR($qr_code)
  {
    try {
      $stmt = $this->conn->prepare(
        "SELECT * FROM `{$this->table}` WHERE qr_code = :qr_code LIMIT 1"
      );
      // Use bindValue with explicit string type to avoid any type-coercion quirks
      $stmt->bindValue(':qr_code', trim($qr_code), PDO::PARAM_STR);
      $stmt->execute();
      return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (PDOException $e) {
      error_log("getEmployeeByQR error: " . $e->getMessage());
      return null;
    }
  }

  /**
   * Fuzzy search across name/position/brand/shift/status/violation.
   * Used as fallback when the input doesn't match a QR exactly.
   */
  public function searchEmployees($searchParams = [])
  {
    try {
      $q = '';
      foreach (['qr_code', 'fullname', 'position', 'brand', 'shift', 'status'] as $p) {
        if (!empty($searchParams[$p])) { $q = $searchParams[$p]; break; }
      }

      if ($q === '') return [];

      $fields = ['fullname', 'position', 'qr_code', 'brand', 'shift', 'status', 'violation'];
      $conditions = array_map(fn($f) => "`$f` LIKE :term", $fields);

      $query = "SELECT * FROM `{$this->table}`
                WHERE (" . implode(' OR ', $conditions) . ")
                ORDER BY
                  CASE
                    WHEN qr_code  = :exact THEN 1
                    WHEN fullname = :exact THEN 2
                    WHEN qr_code  LIKE :starts THEN 3
                    WHEN fullname LIKE :starts THEN 4
                    ELSE 5
                  END,
                  fullname ASC
                LIMIT 100";

      $stmt = $this->conn->prepare($query);
      $stmt->bindValue(':term',   '%' . $q . '%', PDO::PARAM_STR);
      $stmt->bindValue(':exact',  $q,             PDO::PARAM_STR);
      $stmt->bindValue(':starts', $q . '%',       PDO::PARAM_STR);
      $stmt->execute();

      return $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
      error_log("searchEmployees error: " . $e->getMessage());
      return [];
    }
  }

  public function getEmployee($id)
  {
    try {
      $stmt = $this->conn->prepare(
        "SELECT * FROM `{$this->table}` WHERE id = :id LIMIT 1"
      );
      $stmt->bindValue(':id', intval($id), PDO::PARAM_INT);
      $stmt->execute();
      return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    } catch (PDOException $e) {
      error_log("getEmployee error: " . $e->getMessage());
      return null;
    }
  }
}

// ── Main execution ───────────────────────────────────────────────────────────
try {
  $database = new Database($currentUserId);
  $db = $database->connect();

  if (!$db) {
    throw new Exception("Failed to connect to user database.");
  }

  $searchHandler = new LiveSearchHandler($db, $currentUserId);
  $response = ['success' => false, 'message' => '', 'data' => []];

  if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    // Build search param from ?q= (preferred) or legacy individual params
    $q = trim($_GET['q'] ?? '');
    if ($q === '') {
      foreach (['fullname', 'position', 'brand', 'status', 'shift', 'qr_code'] as $p) {
        $v = trim($_GET[$p] ?? '');
        if ($v !== '') { $q = $v; break; }
      }
    }

    if ($q === '') {
      $response['message'] = 'No search parameters provided';
    } else {
      $employees = $searchHandler->searchEmployees(['qr_code' => $q]);
      $response['success'] = true;
      $response['data']    = $employees;
      $response['count']   = count($employees);
      $response['message'] = count($employees)
        ? count($employees) . ' employee(s) found.'
        : 'No employees found matching your search criteria.';
    }

  } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {

    $input  = json_decode(file_get_contents('php://input'), true) ?: $_POST;
    $action = trim($input['action'] ?? '');

    switch ($action) {

      case 'get_by_qr':
        $qr = trim($input['qr_code'] ?? '');
        if ($qr === '') {
          $response['message'] = 'QR code is required';
          break;
        }
        $employee = $searchHandler->getEmployeeByQR($qr);
        if ($employee) {
          $response['success'] = true;
          $response['data']    = $employee;   // single object, not array
          $response['message'] = 'Employee found';
        } else {
          $response['success'] = false;
          $response['message'] = 'No employee found with QR code: ' . htmlspecialchars($qr);
        }
        break;

      case 'get_by_id':
        $id = intval($input['id'] ?? 0);
        if ($id <= 0) {
          $response['message'] = 'Valid Employee ID is required';
          break;
        }
        $employee = $searchHandler->getEmployee($id);
        if ($employee) {
          $response['success'] = true;
          $response['data']    = $employee;
          $response['message'] = 'Employee found';
        } else {
          $response['message'] = 'Employee not found with ID: ' . $id;
        }
        break;

      default:
        $response['message'] = 'Invalid or missing action: ' . htmlspecialchars($action);
        break;
    }

  } else {
    $response['message'] = 'Invalid request method';
  }

} catch (Exception $e) {
  error_log("Critical server error: " . $e->getMessage());
  http_response_code(500);
  $response = [
    'success' => false,
    'message' => 'Server error: ' . $e->getMessage(),
    'data'    => []
  ];
}

// Debug mode (add ?debug=1 to URL)
if (!isset($_GET['debug'])) {
  unset($response['error_details']);
}

echo json_encode($response, JSON_PRETTY_PRINT);
exit;