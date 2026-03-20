<?php
// proxcode_backend.php - Proximity Management System Backend

require_once 'config.php';

// Database management class
class Database
{
  private $mainConn;
  private $userConn;
  private $currentUserId;

  public function __construct()
  {
    // Check if user is logged in
    if (!isset($_SESSION['user_id'])) {
      throw new Exception("User not authenticated. Please log in.");
    }

    $this->currentUserId = $_SESSION['user_id'];
  }

  // Get main database connection (for user management)
  public function getMainConnection()
  {
    if (!$this->mainConn) {
      $this->mainConn = getMainDBConnection();
    }
    return $this->mainConn;
  }

  // Get user-specific database connection
  public function getUserConnection()
  {
    if (!$this->userConn) {
      // Check if user database exists, create if not
      if (!userDatabaseExists($this->currentUserId)) {
        if (!createUserDatabase($this->currentUserId)) {
          throw new Exception("Failed to initialize user database");
        }
      }

      $this->userConn = getUserDBConnection($this->currentUserId);
    }
    return $this->userConn;
  }

  // Legacy method for backward compatibility
  public function connect()
  {
    return $this->getUserConnection();
  }

  public function getCurrentUserId()
  {
    return $this->currentUserId;
  }
}

// Proximity Management Class with user-specific database support
class EmployeeManager
{
  private $conn;
  private $table = 'code';
  private $userId;

  public function __construct($db)
  {
    if ($db instanceof Database) {
      $this->conn = $db->getUserConnection();
      $this->userId = $db->getCurrentUserId();
    } else {
      // Legacy support for direct PDO connection
      $this->conn = $db;
      $this->userId = $_SESSION['user_id'] ?? null;
    }
  }

  // Create new employee
  public function createEmployee($data)
  {
    $query = "INSERT INTO " . $this->table . " 
                      (qr_code) 
                      VALUES (:qr_code)";

    $stmt = $this->conn->prepare($query);

    // Bind parameters
    $stmt->bindParam(':qr_code', $data['qr_code']);

    if ($stmt->execute()) {
      $employeeId = $this->conn->lastInsertId();

      // Log the action
      if ($this->userId) {
        logSystemAction($this->userId, 'EMPLOYEE_CREATED', "Created employee: " . $data['qr_code']);
      }

      return $employeeId;
    }
    return false;
  }

  // Read all proximity codes with filters
  public function getEmployees($filters = [])
  {
    $query = "SELECT * FROM " . $this->table . " WHERE 1=1";
    $params = [];

    if (!empty($filters['qr_code'])) {
      $query .= " AND qr_code LIKE :qr_code";
      $params[':qr_code'] = '%' . $filters['qr_code'] . '%';
    }

    if (!empty($filters['created_at'])) {
      $query .= " AND created_at LIKE :created_at";
      $params[':created_at'] = '%' . $filters['created_at'] . '%';
    }

    if (!empty($filters['updated_at'])) {
      $query .= " AND updated_at LIKE :updated_at";
      $params[':updated_at'] = '%' . $filters['updated_at'] . '%';
    }

    $query .= " ORDER BY id DESC";

    $stmt = $this->conn->prepare($query);
    foreach ($params as $key => $value) {
      $stmt->bindValue($key, $value);
    }

    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
  }

  // Update employee
  public function updateEmployee($id, $data)
  {

    $query = "UPDATE " . $this->table . " 
                      SET qr_code = :qr_code, updated_at = NOW()
                      WHERE id = :id";

    $stmt = $this->conn->prepare($query);

    $stmt->bindParam(':id', $id);
    $stmt->bindParam(':qr_code', $data['qr_code']);

    $result = $stmt->execute();

    if ($result && $this->userId) {
      logSystemAction($this->userId, 'EMPLOYEE_UPDATED', "Updated employee: " . $data['qr_code']);
    }

    return $result;
  }

  // Delete employee
  public function deleteEmployee($id)
  {
    $employee = $this->getEmployee($id);

    $query = "DELETE FROM " . $this->table . " WHERE id = :id";
    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':id', $id);
    $result = $stmt->execute();

    if ($result && $this->userId && $employee) {
      logSystemAction($this->userId, 'EMPLOYEE_DELETED', "Deleted employee: " . $employee['qr_code']);
    }

    return $result;
  }

  // Get single employee
  public function getEmployee($id)
  {
    $query = "SELECT * FROM " . $this->table . " WHERE id = :id";
    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':id', $id);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // Get proximity by code
  public function getEmployeeByQR($qr_code)
  {
    $query = "SELECT * FROM " . $this->table . " WHERE qr_code = :qr_code";
    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':qr_code', $qr_code);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // Delete all proximity codes (enhanced with logging)
  public function deleteAllEmployees()
  {
    try {
      // Get count for logging
      $countQuery = "SELECT COUNT(*) as total FROM " . $this->table;
      $countStmt = $this->conn->prepare($countQuery);
      $countStmt->execute();
      $count = $countStmt->fetch(PDO::FETCH_ASSOC)['total'];

      // Delete all records
      $query = "DELETE FROM " . $this->table;
      $stmt = $this->conn->prepare($query);
      $result = $stmt->execute();

      if ($result) {
        // Reset auto increment
        $resetQuery = "ALTER TABLE " . $this->table . " AUTO_INCREMENT = 1";
        $this->conn->prepare($resetQuery)->execute();

        if ($this->userId) {
          logSystemAction($this->userId, 'ALL_EMPLOYEES_DELETED', "Deleted all employees (total: $count)");
        }
      }

      return $result;
    } catch (Exception $e) {
      error_log("Error deleting all employees: " . $e->getMessage());
      return false;
    }
  }

    // Get table name (helper method for delete all functionality)
  public function getTableName()
  {
    return $this->table;
  }

  // Get proximity code statistics
  public function getProxcodeStats()
  {
    $stats = [];

    // Total proximity codes
    $query = "SELECT COUNT(*) as total FROM " . $this->table;
    $stmt = $this->conn->prepare($query);
    $stmt->execute();
    $stats['total'] = $stmt->fetch(PDO::FETCH_ASSOC)['total'];

    return $stats;
  }
}

// File Upload Handler with user-specific directories
class FileUploader
{
  private $upload_dir;
  private $allowed_types = ['jpg', 'jpeg', 'png', 'gif'];
  private $max_size = 5 * 1024 * 1024; // 5MB
  private $userId;

  public function __construct($userId = null)
  {
    $this->userId = $userId ?? $_SESSION['user_id'] ?? 'default';
    $this->upload_dir = '../../uploads/user_' . $this->userId . '/';

    if (!file_exists($this->upload_dir)) {
      mkdir($this->upload_dir, 0777, true);
    }
  }

  public function uploadImage($file)
  {
    if (!isset($file['tmp_name']) || $file['error'] !== UPLOAD_ERR_OK) {
      return false;
    }

    $file_extension = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));

    if (!in_array($file_extension, $this->allowed_types)) {
      throw new Exception("Invalid file type. Only JPG, JPEG, PNG, and GIF allowed.");
    }

    if ($file['size'] > $this->max_size) {
      throw new Exception("File too large. Maximum size is 5MB.");
    }

    $filename = uniqid() . '.' . $file_extension;
    $filepath = $this->upload_dir . $filename;

    if (move_uploaded_file($file['tmp_name'], $filepath)) {
      return $filename;
    }

    return false;
  }

  public function deleteImage($filename)
  {
    if ($filename && file_exists($this->upload_dir . $filename)) {
      return unlink($this->upload_dir . $filename);
    }
    return false;
  }

  public function getImagePath($filename)
  {
    return $this->upload_dir . $filename;
  }
}

// QR Code Generator (enhanced with user-specific prefixes)
class QRCodeGenerator
{
  const QR_CODE_LENGTH = 41;

  public static function generateQRCode($userId = null, $length = self::QR_CODE_LENGTH)
  {
    $userId = $userId ?? $_SESSION['user_id'] ?? '0';
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    // Start with user ID prefix to ensure uniqueness across users
    $result = '1' . $userId . '_';

    // Add random alphanumeric characters
    $remainingLength = $length - strlen($result) - 8;
    for ($i = 0; $i < $remainingLength; $i++) {
      $result .= $chars[rand(0, strlen($chars) - 1)];
    }

    // Add timestamp-based number to ensure uniqueness
    $uniquePart = str_pad((time() % 100000000), 8, '0', STR_PAD_LEFT);
    $result .= $uniquePart;

    return $result;
  }
}

// Main Application Handler
try {
  // Check authentication
  if (!isset($_SESSION['user_id'])) {
    $response = ['success' => false, 'message' => 'Authentication required. Please log in.'];

    if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest') {
      header('Content-Type: application/json');
      echo json_encode($response);
      exit;
    }

    // Redirect to login page
    header('Location: ../../index.php');
    exit;
  }

  $database = new Database();
  $employeeManager = new EmployeeManager($database);
  $fileUploader = new FileUploader($database->getCurrentUserId());

  $response = ['success' => false, 'message' => '', 'data' => null];

  // Handle different actions
  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    switch ($action) {
      case 'add':
      case 'create':
        $image_filename = null;

        // Handle image upload
        if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
          try {
            $image_filename = $fileUploader->uploadImage($_FILES['image']);
          } catch (Exception $e) {
            $response['message'] = $e->getMessage();
            break;
          }
        }

        // Use provided QR code or generate one
        $qr_code = !empty($_POST['qr_code'])
          ? sanitizeInput($_POST['qr_code'])
          : QRCodeGenerator::generateQRCode($database->getCurrentUserId());

        $employee_data = ['qr_code' => $qr_code];

        // Validate required fields
        if (empty($employee_data['qr_code'])) {
          $response['message'] = 'Please fill in all required fields (Proximity code is required)';
          break;
        }

        $employee_id = $employeeManager->createEmployee($employee_data);

        if ($employee_id) {
          $response['success'] = true;
          $response['message'] = 'Proximity code created successfully';
          $response['data'] = ['id' => $employee_id, 'qr_code' => $qr_code];
        } else {
          $response['message'] = 'Failed to create proximity code. Please check your input data.';
        }
        break;

      case 'edit':
      case 'update':
        $employee_id = $_POST['id'] ?? 0;
        $current_employee = $employeeManager->getEmployee($employee_id);

        if (!$current_employee) {
          $response['message'] = 'Proximity code not found';
          break;
        }

        $image_filename = $current_employee['image'] ?? null;

        // Handle new image upload
        if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
          try {
            $new_image = $fileUploader->uploadImage($_FILES['image']);

            // Delete old image if upload successful
            if ($new_image && $current_employee['image']) {
              $fileUploader->deleteImage($current_employee['image']);
            }

            $image_filename = $new_image;
          } catch (Exception $e) {
            $response['message'] = $e->getMessage();
            break;
          }
        }

        // Use provided QR code or keep existing
        $qr_code = !empty($_POST['qr_code'])
          ? sanitizeInput($_POST['qr_code'])
          : $current_employee['qr_code'];

        $employee_data = ['qr_code' => $qr_code];

        if ($employeeManager->updateEmployee($employee_id, $employee_data)) {
          $response['success'] = true;
          $response['message'] = 'Proximity code updated successfully';
        } else {
          $response['message'] = 'Failed to update proximity code';
        }
        break;

      case 'delete':
        $employee_id = $_POST['id'] ?? 0;
        $employee = $employeeManager->getEmployee($employee_id);

        if ($employee && $employeeManager->deleteEmployee($employee_id)) {
          // Delete associated image
          if (!empty($employee['image'])) {
            $fileUploader->deleteImage($employee['image']);
          }

          $response['success'] = true;
          $response['message'] = 'Proximity code deleted successfully';
        } else {
          $response['message'] = 'Failed to delete proximity code';
        }
        break;

      case 'delete_all':
        try {
          // Get all proximity codes first to delete their images
          $all_employees = $employeeManager->getEmployees($employee_id);

          // Start transaction
          $db = $database->getUserConnection();
          $db->beginTransaction();

          if ($employeeManager->deleteAllEmployees()) {

            $db->commit();

            $response['success'] = true;
            $response['message'] = 'All proximity code deleted successfully. ' . count($all_employees) . ' proximity codes ';
          } else {
            $db->rollBack();
            $response['message'] = 'Failed to delete proximity code';
          }
        } catch (Exception $e) {
          if (isset($db)) {
            $db->rollBack();
          }
          $response['message'] = 'Error deleting all data: ' . $e->getMessage();
        }
        break;

      case 'import':
        // ✅ FIXED: Now expecting 'code' parameter instead of 'proximity_code' for import to avoid confusion with single record creation
        $employees_json = $_POST['code'] ?? '';

        if (empty($employees_json)) {
          $response['message'] = 'No proximity code provided';
          break;
        }

        $employees_data = json_decode($employees_json, true);

        if (!is_array($employees_data) || empty($employees_data)) {
          $response['message'] = 'Invalid proximity code format';
          break;
        }

        $imported_count = 0;
        $duplicate_count = 0;
        $errors = [];

        try {
          // Start transaction
          $db = $database->getUserConnection();
          $db->beginTransaction();

          foreach ($employees_data as $index => $employee_data) {
            try {
              // Extract QR code from the data
              // ✅ FIXED: Handle 'qr_code' field properly
              $qr_code = '';
              if (!empty($employee_data['qr_code']) && trim($employee_data['qr_code']) !== '') {
                $qr_code = trim($employee_data['qr_code']);
              } else if (!empty($employee_data['qr']) && trim($employee_data['qr']) !== '') {
                $qr_code = trim($employee_data['qr']);
              } else {
                // Auto-generate if not provided
                $qr_code = QRCodeGenerator::generateQRCode($database->getCurrentUserId());
              }

              // ✅ FIXED: Validate QR code is not empty
              if (empty($qr_code)) {
                $errors[] = "Row " . ($index + 1) . ": Could not generate proximity code";
                continue;
              }

              // Check for duplicates
              $existingEmployee = $employeeManager->getEmployeeByQR($qr_code);
              if ($existingEmployee) {
                $duplicate_count++;
                // Skip this record as it already exists
                continue;
              }

              // Prepare proximity code with sanitization
              $employee_record = [
                'qr_code' => sanitizeInput(trim($employee_data['qr_code'] ?? $qr_code))
              ];

              // Validate required fields
              if (empty($employee_record['qr_code'])) {
                $errors[] = "Row " . ($index + 1) . ": Missing required fields";
                continue;
              }

              $employee_id = $employeeManager->createEmployee($employee_record);

              if ($employee_id) {
                $imported_count++;
              } else {
                $errors[] = "Row " . ($index + 1) . ": Failed to create proximity code record";
              }
            } catch (Exception $e) {
              $errors[] = "Row " . ($index + 1) . ": " . $e->getMessage();
            }
          }

          if ($imported_count > 0 || $duplicate_count > 0) {
            $db->commit();
            $response['success'] = true;
            $response['message'] = "Import completed successfully. $imported_count proximity codes imported.";
            $response['imported_count'] = $imported_count;
            $response['duplicates_count'] = $duplicate_count;

            if ($duplicate_count > 0) {
              $response['message'] .= " $duplicate_count duplicate codes were skipped.";
            }

            if (!empty($errors)) {
              $response['message'] .= " " . count($errors) . " records had errors.";
              $response['errors'] = array_slice($errors, 0, 10); // Return first 10 errors
              $response['warnings'] = array_slice($errors, 0, 5); // For compatibility
            }

            logSystemAction($database->getCurrentUserId(), 'DATA_IMPORTED', "Imported $imported_count proximity codes. $duplicate_count duplicates skipped.");
          } else {
            $db->rollBack();
            $response['message'] = 'Import failed. No valid proximity code records were processed.';
            $response['errors'] = $errors;
          }
        } catch (Exception $e) {
          if (isset($db)) {
            $db->rollBack();
          }
          $response['message'] = 'Import error: ' . $e->getMessage();
          error_log("Import error: " . $e->getMessage());
        }
        break;

      case 'search_qr':
        $qr_code = $_POST['qr_code'] ?? '';

        if (empty($qr_code)) {
          $response['message'] = 'Proximity code is required';
          break;
        }

        try {
          $employee = $employeeManager->getEmployeeByQR($qr_code);

          if ($employee) {
            $response['success'] = true;
            $response['data'] = $employee;
            $response['message'] = 'Proximity code found';

            // Log QR scan
            logSystemAction($database->getCurrentUserId(), 'PROXIMITY_SCAN', "Proximity scan for proximity code: " . $employee['qr_code']);
          } else {
            $response['message'] = 'No proximity code found with this code';
          }
        } catch (Exception $e) {
          $response['message'] = 'Proximity code search error: ' . $e->getMessage();
        }
        break;

      default:
        $response['message'] = 'Invalid action specified: ' . htmlspecialchars($action);
        break;
    }
  } elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';

    switch ($action) {
      case 'get':
      case 'list':
        $filters = [];

        // Parse filters from GET parameters
        if (!empty($_GET['qr_code'])) {
          $filters['qr_code'] = $_GET['qr_code'];
        }

        if (!empty($_GET['created_at'])) {
          $filters['created_at'] = $_GET['created_at'];
        }

        if (!empty($_GET['updated_at'])) {
          $filters['updated_at'] = $_GET['updated_at'];
        }

        try {
          $employees = $employeeManager->getEmployees($filters);
          $response['success'] = true;
          $response['data'] = $employees;
          $response['total'] = count($employees);
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving proximity codes: ' . $e->getMessage();
        }
        break;

      case 'get_single':
        $employee_id = $_GET['id'] ?? 0;

        if ($employee_id) {
          try {
            $employee = $employeeManager->getEmployee($employee_id);

            if ($employee) {
              $response['success'] = true;
              $response['data'] = $employee;
            } else {
              $response['message'] = 'Proximity code not found';
            }
          } catch (Exception $e) {
            $response['message'] = 'Error retrieving proximity code: ' . $e->getMessage();
          }
        } else {
          $response['message'] = 'Proximity Code is required';
        }
        break;

      case 'check_qr':
        $qr_code = $_GET['qr_code'] ?? '';

        if (!empty($qr_code)) {
          try {
            $employee = $employeeManager->getEmployeeByQR($qr_code);

            if ($employee) {
              $response['success'] = true;
              $response['data'] = $employee;
              $response['exists'] = true;
            } else {
              $response['success'] = true;
              $response['exists'] = false;
              $response['message'] = 'Proximity code available';
            }
          } catch (Exception $e) {
            $response['message'] = 'Error checking proximity code: ' . $e->getMessage();
          }
        } else {
          $response['message'] = 'Proximity code parameter is required';
        }
        break;

      case 'stats':
        try {
          $stats = $employeeManager->getProxcodeStats();
          $response['success'] = true;
          $response['data'] = $stats;
        } catch (Exception $e) {
          $response['message'] = 'Error getting statistics: ' . $e->getMessage();
        }
        break;

      case 'user_info':
        $response['success'] = true;
        $response['data'] = [
          'user_id' => $database->getCurrentUserId(),
          'username' => $_SESSION['username'] ?? 'Unknown',
          'email' => $_SESSION['email'] ?? '',
          'first_name' => $_SESSION['first_name'] ?? '',
          'last_name' => $_SESSION['last_name'] ?? ''
        ];
        break;

      default:
        $response['message'] = 'Invalid GET action specified: ' . htmlspecialchars($action);
        break;
    }
  } else {
    $response['message'] = 'Invalid request method. Use GET or POST.';
  }

  // Output JSON response for AJAX requests
  if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest') {
    header('Content-Type: application/json');
    echo json_encode($response);
    exit;
  }

  // For non-AJAX requests, redirect or handle differently
  if ($response['success']) {
    $_SESSION['success_message'] = $response['message'];
  } else {
    $_SESSION['error_message'] = $response['message'];
  }
} catch (Exception $e) {
  $error_response = [
    'success' => false,
    'message' => 'System error: ' . $e->getMessage()
  ];

  // Log system error
  error_log("Proximity Management System Error: " . $e->getMessage());

  if (isset($_SESSION['user_id'])) {
    logSystemAction($_SESSION['user_id'], 'SYSTEM_ERROR', $e->getMessage());
  }

  if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest') {
    header('Content-Type: application/json');
    echo json_encode($error_response);
    exit;
  }

  $_SESSION['error_message'] = $error_response['message'];
}

// API endpoint information
function getAPIInfo()
{
  return [
    'version' => '2.0',
    'name' => 'Proximity Management System',
    'description' => 'Multi-user proximity management system with user-specific databases',
    'endpoints' => [
      'POST' => [
        'add/create' => 'Create new proximity code',
        'edit/update' => 'Update existing proximity code',
        'delete' => 'Delete proximity code',
        'delete_all' => 'Delete all proximity codes',
        'search_qr' => 'Search proximity code by Proximity code'
      ],
      'GET' => [
        'get/list' => 'Get proximity codes with optional filters',
        'get_single' => 'Get single proximity code by ID',
        'check_qr' => 'Check if Proximity code exists',
        'stats' => 'Get proximity code statistics',
        'user_info' => 'Get current user information'
      ]
    ],
    'authentication' => 'Session-based (user must be logged in)',
    'database' => 'User-specific databases'
  ];
}

// API info endpoint
if (isset($_GET['api_info'])) {
  header('Content-Type: application/json');
  echo json_encode(getAPIInfo(), JSON_PRETTY_PRINT);
  exit;
}

// Health check endpoint
if (isset($_GET['health_check'])) {
  $health = [
    'status' => 'OK',
    'timestamp' => date('Y-m-d H:i:s'),
    'user_authenticated' => isset($_SESSION['user_id']),
    'user_id' => $_SESSION['user_id'] ?? null,
  ];

  try {
    $database = new Database();
    $database->getMainConnection();
    $database->getUserConnection();
    $health['user_database'] = 'OK';
  } catch (Exception $e) {
    $health['status'] = 'ERROR';
    $health['user_database'] = 'ERROR: ' . $e->getMessage();
  }

  header('Content-Type: application/json');
  echo json_encode($health, JSON_PRETTY_PRINT);
  exit;
}