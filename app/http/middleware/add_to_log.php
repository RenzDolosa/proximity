<?php
// app/http/middleware/add_to_log.php --> manual input log in/out trigger

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
require_once '../../../config/config.php';

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
    'error_code' => 'AUTH_REQUIRED'
  ]);
  exit();
}

$currentUserId = $_SESSION['user_id'];

// Employee Log Manager Class (integrates with QR Search Backend)
class EmployeeLogManager
{
  private $conn;
  private $userId;
  private $db_name;

  public function __construct($userId)
  {
    $this->userId = $userId;
    $this->db_name = USER_DB_PREFIX; // USER_DB_PREFIX . $userId;
    $this->connect();
  }

  private function connect()
  {
    try {
      // Ensure user database exists
      if (!userDatabaseExists($this->userId)) {
        if (!createUserDatabase($this->userId)) {
          throw new Exception("Failed to create user database");
        }
      }

      $this->conn = new PDO(
        "mysql:host=" . USER_DB_HOST . ";dbname=" . $this->db_name . ";charset=utf8mb4",
        USER_DB_USER,
        USER_DB_PASS,
        [
          PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
          PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
          PDO::ATTR_EMULATE_PREPARES => false
        ]
      );

      // Sync MySQL session timezone with PHP/app timezone (Asia/Manila, +08:00)
      $this->conn->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");

      // Create necessary tables if they don't exist
      $this->createTables();
    } catch (PDOException $e) {
      error_log("Employee Log DB Connection error: " . $e->getMessage());
      throw new Exception("Database connection failed");
    }
  }

  private function createTables()
  {
    try {
      // Create employee_access_log table (compatible with QR Search Backend logging)
      $query = "CREATE TABLE IF NOT EXISTS employee_access_log (
                id INT AUTO_INCREMENT PRIMARY KEY,
                employee_id INT,
                fullname VARCHAR(255) NOT NULL,
                position VARCHAR(100),
                brand VARCHAR(100),
                status VARCHAR(50),
                shift VARCHAR(50),
                violation TEXT,
                image TEXT,
                qr_code VARCHAR(255),
                check_status ENUM('IN', 'OUT') DEFAULT 'IN',
                access_type VARCHAR(50) DEFAULT 'manual_entry',
                access_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ip_address VARCHAR(45),
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_employee_id (employee_id),
                INDEX idx_qr_code (qr_code),
                INDEX idx_fullname (fullname),
                INDEX idx_access_timestamp (access_timestamp),
                INDEX idx_check_status (check_status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

      $this->conn->exec($query);

      $checkinoutTable = "CREATE TABLE IF NOT EXISTS check_in_out (
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

      $this->conn->exec($checkinoutTable);

      // Create search_queries table (for compatibility with QR Search Backend)
      $searchQueriesTable = "CREATE TABLE IF NOT EXISTS search_queries (
                id INT AUTO_INCREMENT PRIMARY KEY,
                query_type VARCHAR(50) NOT NULL,
                search_term VARCHAR(255),
                search_parameters TEXT,
                results_count INT DEFAULT 0,
                results_data LONGTEXT,
                execution_time_ms DECIMAL(10,3),
                success BOOLEAN DEFAULT TRUE,
                error_message TEXT,
                ip_address VARCHAR(45),
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_query_type (query_type),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

      $this->conn->exec($searchQueriesTable);
    } catch (PDOException $e) {
      error_log("Failed to create tables: " . $e->getMessage());
      throw new Exception("Failed to initialize database tables");
    }
  }

  // Add employee to access log
  public function addToLog($logData)
  {
    try {
      // Validate required fields
      if (empty($logData['fullname']) || empty($logData['qr_code'])) {
        throw new Exception("Missing required fields: fullname, qr_code");
      }
      $now = date('Y-m-d H:i:s');

      $query = "INSERT INTO employee_access_log
            (employee_id, fullname, position, brand, status, shift,
            violation, image, qr_code, check_status, user_id,
            access_type, ip_address, user_agent, access_timestamp)
          VALUES
            (:employee_id, :fullname, :position, :brand, :status, :shift,
            :violation, :image, :qr_code, :check_status, :user_id,
            :access_type, :ip_address, :user_agent, :access_timestamp)";

      $checkinoutTable = "INSERT INTO check_in_out
              (employee_id, qr_code, fullname, check_type, scan_timestamp, user_id,
                ip_address, user_agent)
            VALUES
              (:employee_id, :qr_code, :fullname, :check_type, :scan_timestamp, :user_id,
                :ip_address, :user_agent)";

      // Start transaction to ensure data consistency
      $this->conn->beginTransaction();

      // Prepare and execute FIRST insert
      $stmt = $this->conn->prepare($query);
      $result = $stmt->execute([
        ':user_id'          => $this->userId,
        ':employee_id'      => $logData['employee_id'] ?? null,
        ':fullname'         => $logData['fullname'],
        ':position'         => $logData['position'] ?? null,
        ':brand'            => $logData['brand'] ?? null,
        ':status'           => $logData['status'] ?? null,
        ':shift'            => $logData['shift'] ?? null,
        ':violation'        => $logData['violation'] ?? '',
        ':image'            => $logData['image'] ?? '',
        ':qr_code'          => $logData['qr_code'],
        ':check_status'     => $logData['check_status'] ?? 'IN',
        ':access_type'      => $logData['access_type'] ?? 'manual_entry',
        ':access_timestamp' => $now,
        ':ip_address'       => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent'       => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown'
      ]);

      if (!$result) {
        throw new Exception("Failed to insert into employee_access_log");
      }

      // Get the ID from the first insert
      $logId = $this->conn->lastInsertId();

      // Prepare and execute SECOND insert (different statement)
      $stmt2 = $this->conn->prepare($checkinoutTable);
      $resultCheck = $stmt2->execute([
        ':user_id'         => $this->userId,
        ':employee_id'     => $logData['employee_id'] ?? null,
        ':qr_code'         => $logData['qr_code'],
        ':fullname'        => $logData['fullname'],
        ':check_type'      => $logData['check_status'] ?? 'IN',
        ':scan_timestamp'  => $now,
        ':ip_address'      => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        ':user_agent'      => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown'
      ]);

      if (!$resultCheck) {
        throw new Exception("Failed to insert into check_in_out");
      }

      // Commit transaction if both inserts succeeded
      $this->conn->commit();

      logSystemAction($this->userId, 'MANUAL', json_encode([
        'employee_id' => $logData['employee_id']   ?? null,
        'fullname' => $logData['fullname']         ?? null,
        'qr_code' => $logData['qr_code']           ?? null,
        'check_status' => $logData['check_status'] ?? 'IN'
      ]));


      return $logId;
    } catch (PDOException $e) {
      // Rollback transaction on database error
      if ($this->conn->inTransaction()) {
        $this->conn->rollBack();
      }
      error_log("Add to log error: " . $e->getMessage());
      throw new Exception("Failed to add employee to log: " . $e->getMessage());
    } catch (Exception $e) {
      // Rollback transaction on any other error
      if ($this->conn->inTransaction()) {
        $this->conn->rollBack();
      }
      error_log("Add to log error: " . $e->getMessage());
      throw $e;
    }
  }

  // Get employee from main employees table (for validation)
  public function getEmployeeByQR($qrCode)
  {
    try {
      $query = "SELECT * FROM employees WHERE qr_code = :qr_code";
      $stmt = $this->conn->prepare($query);
      $stmt->execute([':qr_code' => $qrCode]);
      return $stmt->fetch(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
      error_log("Get employee by QR error: " . $e->getMessage());
      return false;
    }
  }

  // Get recent log entries
  public function getRecentLogEntries($limit = 50)
  {
    try {
      $query = "SELECT * FROM employee_access_log 
                      ORDER BY access_timestamp DESC 
                      LIMIT :limit";
      $stmt = $this->conn->prepare($query);
      $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
      $stmt->execute();
      return $stmt->fetchAll(PDO::FETCH_ASSOC);
    } catch (PDOException $e) {
      error_log("Get recent log entries error: " . $e->getMessage());
      return [];
    }
  }

  // Update existing log entry
  public function updateLogEntry($logId, $updateData)
  {
    try {
      $setParts = [];
      $params = [':id' => $logId];

      $allowedFields = [
        'fullname',
        'position',
        'brand',
        'status',
        'shift',
        'violation',
        'image',
        'check_status',
        'access_type'
      ];

      foreach ($allowedFields as $field) {
        if (isset($updateData[$field])) {
          $setParts[] = "$field = :$field";
          $params[":$field"] = $updateData[$field];
        }
      }

      if (empty($setParts)) {
        throw new Exception("No valid fields to update");
      }

      $query = "UPDATE employee_access_log SET " . implode(', ', $setParts) . " WHERE id = :id";
      $stmt = $this->conn->prepare($query);

      $result = $stmt->execute($params);

      if ($result) {
        logSystemAction($this->userId, 'employee_log_update', json_encode([
          'log_id' => $logId,
          'updated_fields' => array_keys($updateData)
        ]));
      }

      return $result;
    } catch (PDOException $e) {
      error_log("Update log entry error: " . $e->getMessage());
      throw new Exception("Failed to update log entry: " . $e->getMessage());
    }
  }

  // Delete log entry
  public function deleteLogEntry($logId)
  {
    try {
      $query = "DELETE FROM employee_access_log WHERE id = :id";
      $stmt = $this->conn->prepare($query);
      $result = $stmt->execute([':id' => $logId]);

      if ($result) {
        logSystemAction($this->userId, 'employee_log_delete', json_encode([
          'log_id' => $logId
        ]));
      }

      return $result;
    } catch (PDOException $e) {
      error_log("Delete log entry error: " . $e->getMessage());
      throw new Exception("Failed to delete log entry: " . $e->getMessage());
    }
  }
}

// Main execution
try {
  // Initialize response
  $response = [
    'success' => false,
    'message' => '',
    'data' => []
  ];

  // Check request method
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    throw new Exception("Invalid request method. Only POST requests are allowed.");
  }

  // Get JSON input
  $input = json_decode(file_get_contents('php://input'), true);

  if (!$input) {
    // Fallback to POST data
    $input = $_POST;
  }

  if (empty($input)) {
    throw new Exception("No data received. Please provide valid JSON or form data.");
  }

  // Get action
  $action = $input['action'] ?? 'add_to_log';

  // Initialize employee log manager
  $logManager = new EmployeeLogManager($currentUserId);

  switch ($action) {
    case 'add_to_log':
      // Validate required fields for adding to log
      $requiredFields = ['fullname', 'position', 'brand', 'status', 'shift', 'qr_code'];
      foreach ($requiredFields as $field) {
        if (!isset($input[$field]) || trim($input[$field]) === '') {
          throw new Exception("Missing or empty required field: $field");
        }
      }

      // Optional: Validate against existing employee (if QR code exists in employees table)
      if (!empty($input['qr_code']) && isset($input['validate_employee']) && $input['validate_employee']) {
        $existingEmployee = $logManager->getEmployeeByQR($input['qr_code']);
        if (!$existingEmployee) {
          throw new Exception("Employee with QR code '{$input['qr_code']}' not found in employee database");
        }
        // Use employee ID if found
        $input['employee_id'] = $existingEmployee['id'];
      }

      // Prepare log data
      $logData = [
        'employee_id' => $input['employee_id'] ?? null,
        'fullname' => trim($input['fullname']),
        'position' => trim($input['position']),
        'brand' => trim($input['brand']),
        'status' => trim($input['status']),
        'shift' => trim($input['shift']),
        'violation' => trim($input['violation'] ?? ''),
        'image' => trim($input['image'] ?? ''),
        'qr_code' => trim($input['qr_code']),
        'check_status' => $input['check_status'] ?? 'IN',
        'access_type' => $input['access_type'] ?? 'manual_entry'
      ];

      // Add to log
      $logId = $logManager->addToLog($logData);

      if ($logId) {
        $response['success'] = true;
        $response['message'] = 'Employee added to log successfully';
        $response['data'] = [
          'log_id' => $logId,
          'fullname' => $logData['fullname'],
          'qr_code' => $logData['qr_code'],
          'check_status' => $logData['check_status']
        ];
      } else {
        throw new Exception("Failed to add employee to log");
      }
      break;

    case 'get_recent_logs':
      $limit = isset($input['limit']) ? intval($input['limit']) : 50;
      $limit = max(1, min($limit, 200)); // Limit between 1 and 200

      $logs = $logManager->getRecentLogEntries($limit);

      $response['success'] = true;
      $response['message'] = count($logs) . " log entries retrieved";
      $response['data'] = $logs;
      break;

    case 'update_log_entry':
      $logId = isset($input['log_id']) ? intval($input['log_id']) : 0;
      if ($logId <= 0) {
        throw new Exception("Valid log ID is required for update");
      }

      $updateData = array_intersect_key($input, array_flip([
        'fullname',
        'position',
        'brand',
        'status',
        'shift',
        'violation',
        'image',
        'check_status',
        'access_type'
      ]));

      if (empty($updateData)) {
        throw new Exception("No valid fields provided for update");
      }

      $result = $logManager->updateLogEntry($logId, $updateData);

      if ($result) {
        $response['success'] = true;
        $response['message'] = 'Log entry updated successfully';
        $response['data'] = ['log_id' => $logId, 'updated_fields' => array_keys($updateData)];
      } else {
        throw new Exception("Failed to update log entry");
      }
      break;

    case 'delete_log_entry':
      $logId = isset($input['log_id']) ? intval($input['log_id']) : 0;
      if ($logId <= 0) {
        throw new Exception("Valid log ID is required for deletion");
      }

      $result = $logManager->deleteLogEntry($logId);

      if ($result) {
        $response['success'] = true;
        $response['message'] = 'Log entry deleted successfully';
        $response['data'] = ['log_id' => $logId];
      } else {
        throw new Exception("Failed to delete log entry");
      }
      break;

    default:
      throw new Exception("Invalid action: $action");
  }
} catch (Exception $e) {
  http_response_code(400);
  $response = [
    'success' => false,
    'message' => $e->getMessage(),
    'error_details' => [
      'file' => $e->getFile(),
      'line' => $e->getLine()
    ]
  ];
  error_log("Add to log error: " . $e->getMessage());
}

// Remove error details in production unless debug mode
if (!isset($_GET['debug']) && !isset($_POST['debug'])) {
  unset($response['error_details']);
}

echo json_encode($response, JSON_PRETTY_PRINT);
exit;