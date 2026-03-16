<?php
// datalog_backend.php

require_once 'config.php';

// Database datalog_backend.php configuration
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

// Employee Management Class
class EmployeeManager
{
  private $conn;
  private $table = 'employee_access_log';
  private $table2 = 'check_in_out';
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
                      (fullname, position, brand, status, shift, violation, image, qr_code, check_status, access_timestamp) 
                      VALUES (:fullname, :position, :brand, :status, :shift, :violation, :image, :qr_code, :check_status, :access_timestamp)";

    $stmt = $this->conn->prepare($query);

    // Bind parameters
    $stmt->bindParam(':fullname', $data['fullname']);
    $stmt->bindParam(':position', $data['position']);
    $stmt->bindParam(':brand', $data['brand']);
    $stmt->bindParam(':status', $data['status']);
    $stmt->bindParam(':shift', $data['shift']);
    $stmt->bindParam(':violation', $data['violation']);
    $stmt->bindParam(':image', $data['image']);
    $stmt->bindParam(':qr_code', $data['qr_code']);
    $stmt->bindParam(':check_status', $data['check_status']);
    $stmt->bindParam(':access_timestamp', $data['access_timestamp']);

    if ($stmt->execute()) {
      $employeeId = $this->conn->lastInsertId();

      // Log the action
      if ($this->userId) {
        logSystemAction($this->userId, 'EMPLOYEE_CREATED', "Created employee: " . $data['fullname']);
      }

      return $employeeId;
    }
    return false;
  }

  // Read all employees with filters
  public function getEmployees($filters = [])
  {
    $query = "SELECT * FROM " . $this->table . " WHERE 1=1";
    $params = [];

    if (!empty($filters['fullname'])) {
      $query .= " AND fullname LIKE :fullname";
      $params[':fullname'] = '%' . $filters['fullname'] . '%';
    }

    if (!empty($filters['position'])) {
      $query .= " AND position LIKE :position";
      $params[':position'] = '%' . $filters['position'] . '%';
    }

    if (!empty($filters['brand'])) {
      $query .= " AND brand = :brand";
      $params[':brand'] = $filters['brand'];
    }

    if (!empty($filters['status'])) {
      $query .= " AND status = :status";
      $params[':status'] = $filters['status'];
    }

    if (!empty($filters['shift'])) {
      $query .= " AND shift = :shift";
      $params[':shift'] = $filters['shift'];
    }

    if (!empty($filters['qr_code'])) {
      $query .= " AND qr_code LIKE :qr_code";
      $params[':qr_code'] = '%' . $filters['qr_code'] . '%';
    }

    if (!empty($filters['check_status'])) {
      $query .= " AND check_status LIKE :check_status";
      $params[':check_status'] = '%' . $filters['check_status'] . '%';
    }

    if (!empty($filters['access_timestamp'])) {
      $query .= " AND access_timestamp LIKE :access_timestamp";
      $params[':access_timestamp'] = '%' . $filters['access_timestamp'] . '%';
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
    // Get current employee data for logging
    $currentEmployee = $this->getEmployee($id);

    $query = "UPDATE " . $this->table . " 
                      SET fullname = :fullname, position = :position, brand = :brand, 
                          status = :status, shift = :shift, violation = :violation, 
                          image = :image, qr_code = :qr_code, check_status = :check_status, updated_at = NOW()
                      WHERE id = :id";

    $stmt = $this->conn->prepare($query);

    $stmt->bindParam(':id', $id);
    $stmt->bindParam(':fullname', $data['fullname']);
    $stmt->bindParam(':position', $data['position']);
    $stmt->bindParam(':brand', $data['brand']);
    $stmt->bindParam(':status', $data['status']);
    $stmt->bindParam(':shift', $data['shift']);
    $stmt->bindParam(':violation', $data['violation']);
    $stmt->bindParam(':image', $data['image']);
    $stmt->bindParam(':qr_code', $data['qr_code']);
    $stmt->bindParam(':check_status', $data['check_status']);

    $result = $stmt->execute();

    if ($result && $this->userId) {
      // Log status changes
      if ($currentEmployee && $currentEmployee['status'] !== $data['status']) {
        $this->logStatusChange($id, $currentEmployee['status'], $data['status'], 'Status updated via edit');
      }

      logSystemAction($this->userId, 'EMPLOYEE_UPDATED', "Updated employee: " . $data['fullname']);
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
      logSystemAction($this->userId, 'EMPLOYEE_DELETED', "Deleted employee: " . $employee['fullname']);
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

  // Get employee by QR code
  public function getEmployeeByQR($qr_code)
  {
    $query = "SELECT * FROM " . $this->table . " WHERE qr_code = :qr_code";
    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':qr_code', $qr_code);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // Log status changes
  public function logStatusChange($employeeId, $oldStatus, $newStatus, $reason = null)
  {
    try {
      $query = "INSERT INTO status_history (id, old_status, new_status, changed_by, change_reason) 
                      VALUES (:id, :old_status, :new_status, :changed_by, :change_reason)";

      $stmt = $this->conn->prepare($query);
      $stmt->execute([
        ':id' => $employeeId,
        ':old_status' => $oldStatus,
        ':new_status' => $newStatus,
        ':changed_by' => $_SESSION['username'] ?? 'System',
        ':change_reason' => $reason
      ]);
    } catch (Exception $e) {
      error_log("Failed to log status change: " . $e->getMessage());
    }
  }

  // Get employee status history
  public function getEmployeeStatusHistory($employeeId)
  {
    $query = "SELECT * FROM status_history WHERE id = :id ORDER BY created_at DESC";
    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':id', $employeeId);
    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
  }

  // Delete all employees (enhanced with logging)
  public function deleteAllEmployees()
  {
    try {
      // Get count for logging
      $countQuery = "SELECT COUNT(*) as total FROM " . $this->table;
      $countQuery2 = "SELECT COUNT(*) as total FROM " . $this->table2;
      $countStmt = $this->conn->prepare($countQuery);
      $countStmt2 = $this->conn->prepare($countQuery2);
      $countStmt->execute();
      $countStmt2->execute();
      $count = $countStmt->fetch(PDO::FETCH_ASSOC)['total'];
      $count = $countStmt2->fetch(PDO::FETCH_ASSOC)['total'];

      // Delete all records
      $query = "DELETE FROM " . $this->table;
      $query2 = "DELETE FROM " . $this->table2;
      $stmt = $this->conn->prepare($query);
      $stmt2 = $this->conn->prepare($query2);
      $result = $stmt->execute();
      $result2 = $stmt2->execute();

      if ($result) {
        // Reset auto increment
        $resetQuery = "ALTER TABLE " . $this->table . " AUTO_INCREMENT = 1";
        $this->conn->prepare($resetQuery)->execute();

        if ($this->userId) {
          logSystemAction($this->userId, 'ALL_EMPLOYEES_DELETED', "Deleted all employees (total: $count)");
        }
      }

      if ($result2) {
        // Reset auto increment
        $resetQuery2 = "ALTER TABLE " . $this->table2 . " AUTO_INCREMENT = 1";
        $this->conn->prepare($resetQuery2)->execute();

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

  // Get employee statistics
  public function getEmployeeStats()
  {
    $stats = [];

    // Total employees
    $query = "SELECT COUNT(*) as total FROM " . $this->table;
    $stmt = $this->conn->prepare($query);
    $stmt->execute();
    $stats['total'] = $stmt->fetch(PDO::FETCH_ASSOC)['total'];

    // Active employees
    $query = "SELECT COUNT(*) as active FROM " . $this->table . " WHERE status = 'Active'";
    $stmt = $this->conn->prepare($query);
    $stmt->execute();
    $stats['active'] = $stmt->fetch(PDO::FETCH_ASSOC)['active'];

    // Inactive employees
    $stats['inactive'] = $stats['total'] - $stats['active'];

    // By shift
    $query = "SELECT shift, COUNT(*) as count FROM " . $this->table . " GROUP BY shift";
    $stmt = $this->conn->prepare($query);
    $stmt->execute();
    $shiftData = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stats['by_shift'] = [];
    foreach ($shiftData as $shift) {
      $stats['by_shift'][$shift['shift']] = $shift['count'];
    }

    return $stats;
  }
}

// File Upload Handler
class FileUploader
{
  private $upload_dir;
  private $allowed_types = ['jpg', 'jpeg', 'png', 'gif'];
  private $max_size = 5 * 1024 * 1024; // 5MB
  private $userId;

  public function __construct()
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
}

// QR Code Generator (simple implementation)
class QRCodeGenerator
{
  const QR_CODE_LENGTH = 41; // Default length for QR codes

  public static function generateQRCode($fullname, $userId = null, $length = self::QR_CODE_LENGTH)
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

// Example usage:
// $qrCode = QRCodeGenerator::generateQRCode("John Doe");
// echo $qrCode;

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
    header('Location: ../../login.php');
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

        // Generate QR code with user context
        $qr_code = QRCodeGenerator::generateQRCode($_POST['fullname'] ?? '', $database->getCurrentUserId());

        $employee_data = [
          'fullname' => sanitizeInput($_POST['fullname'] ?? ''),
          'position' => sanitizeInput($_POST['position'] ?? ''),
          'brand' => sanitizeInput($_POST['brand'] ?? ''),
          'status' => $_POST['status'] ?? 'Active',
          'shift' => sanitizeInput($_POST['shift'] ?? ''),
          'violation' => sanitizeInput($_POST['violation'] ?? ''),
          'image' => $image_filename,
          'qr_code' => $qr_code,
          'check_status' => $_POST['check_status'] ?? '',
        ];

        // Validate required fields
        if (empty($employee_data['fullname']) || empty($employee_data['position']) || empty($employee_data['shift'])) {
          $response['message'] = 'Please fill in all required fields (Full Name, Position, Shift)';
          break;
        }

        $employee_id = $employeeManager->createEmployee($employee_data);

        if ($employee_id) {
          $response['success'] = true;
          $response['message'] = 'Employee created successfully';
          $response['data'] = ['id' => $employee_id, 'qr_code' => $qr_code];
        } else {
          $response['message'] = 'Failed to create employee. Please check your input data.';
        }
        break;

      case 'edit':
      case 'update':
        $employee_id = $_POST['id'] ?? 0;
        $current_employee = $employeeManager->getEmployee($employee_id);

        if (!$current_employee) {
          $response['message'] = 'Employee not found';
          break;
        }

        $image_filename = $current_employee['image'];

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

        $employee_data = [
          'fullname' => sanitizeInput($_POST['fullname'] ?? $current_employee['fullname']),
          'position' => sanitizeInput($_POST['position'] ?? $current_employee['position']),
          'brand' => sanitizeInput($_POST['brand'] ?? $current_employee['brand']),
          'status' => $_POST['status'] ?? $current_employee['status'],
          'shift' => sanitizeInput($_POST['shift'] ?? $current_employee['shift']),
          'violation' => sanitizeInput($_POST['violation'] ?? $current_employee['violation']),
          'image' => $image_filename,
          'qr_code' => $current_employee['qr_code'],
          'check_status' => $_POST['check_status'] ?? $current_employee['check_status'],
          'updated_at' => date('Y-m-d H:i:s'),  // Set current timestamp
        ];

        if ($employeeManager->updateEmployee($employee_id, $employee_data)) {
          $response['success'] = true;
          $response['message'] = 'Employee updated successfully';
        } else {
          $response['message'] = 'Failed to update employee';
        }
        break;

      case 'delete':
        $employee_id = $_POST['id'] ?? 0;
        $employee = $employeeManager->getEmployee($employee_id);

        if ($employee && $employeeManager->deleteEmployee($employee_id)) {
          // Delete associated image
          if ($employee['image']) {
            $fileUploader->deleteImage($employee['image']);
          }

          $response['success'] = true;
          $response['message'] = 'Employee deleted successfully';
        } else {
          $response['message'] = 'Failed to delete employee';
        }
        break;

      case 'delete_all':
        try {
          // Get all employees first to delete their images
          $all_employees = $employeeManager->getEmployees();

          // Start transaction
          $db = $database->getUserConnection();
          $db->beginTransaction();

          if ($employeeManager->deleteAllEmployees()) {
            // Delete all uploaded images
            $deleted_images = 0;
            foreach ($all_employees as $employee) {
              if ($employee['image'] && $fileUploader->deleteImage($employee['image'])) {
                $deleted_images++;
              }
            }

            $db->commit();

            $response['success'] = true;
            $response['message'] = 'All employee data deleted successfully. ' . count($all_employees) . ' employees and ' . $deleted_images . ' images removed.';
          } else {
            $db->rollBack();
            $response['message'] = 'Failed to delete employee data';
          }
        } catch (Exception $e) {
          if (isset($db)) {
            $db->rollBack();
          }
          $response['message'] = 'Error deleting all data: ' . $e->getMessage();
        }
        break;

      case 'import':
        $employees_json = $_POST['employees'] ?? '';

        if (empty($employees_json)) {
          $response['message'] = 'No employee data provided';
          break;
        }

        $employees_data = json_decode($employees_json, true);

        if (!is_array($employees_data) || empty($employees_data)) {
          $response['message'] = 'Invalid employee data format';
          break;
        }

        $imported_count = 0;
        $errors = [];

        try {
          // Start transaction
          $db = $database->getUserConnection();
          $db->beginTransaction();

          foreach ($employees_data as $index => $employee_data) {
            try {
              // Generate or use provided QR code
              $qr_code = '';
              if (!empty($employee_data['qr']) && trim($employee_data['qr']) !== '') {
                $qr_code = trim($employee_data['qr']);
              } else {
                $qr_code = QRCodeGenerator::generateQRCode($employee_data['fullname'], $database->getCurrentUserId());
              }

              // Prepare employee data with sanitization
              $employee_record = [
                'fullname' => sanitizeInput(trim($employee_data['fullname'])),
                'position' => sanitizeInput(trim($employee_data['position'])),
                'brand' => sanitizeInput(trim($employee_data['brand'] ?? '')),
                'status' => in_array($employee_data['status'], ['Active', 'Inactive']) ? $employee_data['status'] : 'Active',
                'shift' => sanitizeInput(trim($employee_data['shift'])),
                'violation' => sanitizeInput(trim($employee_data['violation'] ?? '')),
                'image' => null,
                'qr_code' => $qr_code,
                'check_status' => in_array($employee_data['check_status'], ['OUT', 'IN']) ? $employee_data['check_status'] : 'OUT',
                'access_timestamp' => date('Y-m-d H:i:s'), // Set current timestamp
              ];

              // Validate required fields
              if (empty($employee_record['fullname'])) {
                $errors[] = "Row " . ($index + 1) . ": Missing required fields";
                continue;
              }

              $employee_id = $employeeManager->createEmployee($employee_record);

              if ($employee_id) {
                $imported_count++;
              } else {
                $errors[] = "Row " . ($index + 1) . ": Failed to create employee record";
              }
            } catch (Exception $e) {
              $errors[] = "Row " . ($index + 1) . ": " . $e->getMessage();
            }
          }

          if ($imported_count > 0) {
            $db->commit();
            $response['success'] = true;
            $response['message'] = "Import completed successfully. $imported_count employees imported.";
            $response['imported_count'] = $imported_count;

            if (!empty($errors)) {
              $response['message'] .= " " . count($errors) . " records had errors.";
              $response['errors'] = $errors;
            }

            logSystemAction($database->getCurrentUserId(), 'DATA_IMPORTED', "Imported $imported_count employees");
          } else {
            $db->rollBack();
            $response['message'] = 'Import failed. No valid employee records were processed.';
            $response['errors'] = $errors;
          }
        } catch (Exception $e) {
          if (isset($db)) {
            $db->rollBack();
          }
          $response['message'] = 'Import error: ' . $e->getMessage();
        }
        break;

      case 'get_stats':
        try {
          $stats = $employeeManager->getEmployeeStats();
          $response['success'] = true;
          $response['data'] = $stats;
        } catch (Exception $e) {
          $response['message'] = 'Error getting statistics: ' . $e->getMessage();
        }
        break;

      case 'get_status_history':
        $employee_id = $_POST['id'] ?? 0;

        if ($employee_id) {
          try {
            $history = $employeeManager->getEmployeeStatusHistory($employee_id);
            $response['success'] = true;
            $response['data'] = $history;
          } catch (Exception $e) {
            $response['message'] = 'Error getting status history: ' . $e->getMessage();
          }
        } else {
          $response['message'] = 'Employee ID is required';
        }
        break;

      case 'bulk_status_update':
        $employee_ids = $_POST['employee_ids'] ?? [];
        $new_status = $_POST['new_status'] ?? '';
        $reason = $_POST['reason'] ?? 'Bulk status update';

        if (empty($employee_ids) || empty($new_status)) {
          $response['message'] = 'Employee IDs and new status are required';
          break;
        }

        if (!is_array($employee_ids)) {
          $employee_ids = json_decode($employee_ids, true) ?: [];
        }

        $updated_count = 0;
        $errors = [];

        try {
          $db = $database->getUserConnection();
          $db->beginTransaction();

          foreach ($employee_ids as $employee_id) {
            $current_employee = $employeeManager->getEmployee($employee_id);

            if ($current_employee) {
              $employee_data = $current_employee;
              $old_status = $employee_data['status'];
              $employee_data['status'] = $new_status;

              if ($employeeManager->updateEmployee($employee_id, $employee_data)) {
                // Log status change
                $employeeManager->logStatusChange($employee_id, $old_status, $new_status, $reason);
                $updated_count++;
              } else {
                $errors[] = "Failed to update employee ID: $employee_id";
              }
            } else {
              $errors[] = "Employee not found: ID $employee_id";
            }
          }

          $db->commit();

          $response['success'] = true;
          $response['message'] = "$updated_count employees updated successfully";
          $response['updated_count'] = $updated_count;

          if (!empty($errors)) {
            $response['errors'] = $errors;
            $response['message'] .= '. ' . count($errors) . ' records had errors.';
          }

          logSystemAction($database->getCurrentUserId(), 'BULK_STATUS_UPDATE', "Updated $updated_count employees to status: $new_status");
        } catch (Exception $e) {
          if (isset($db)) {
            $db->rollBack();
          }
          $response['message'] = 'Bulk update error: ' . $e->getMessage();
        }
        break;

      case 'search_qr':
        $qr_code = $_POST['qr_code'] ?? '';

        if (empty($qr_code)) {
          $response['message'] = 'QR code is required';
          break;
        }

        try {
          $employee = $employeeManager->getEmployeeByQR($qr_code);

          if ($employee) {
            $response['success'] = true;
            $response['data'] = $employee;
            $response['message'] = 'Employee found';

            // Log QR scan
            logSystemAction($database->getCurrentUserId(), 'QR_SCAN', "QR scan for employee: " . $employee['fullname']);
          } else {
            $response['message'] = 'No employee found with this QR code';
          }
        } catch (Exception $e) {
          $response['message'] = 'QR search error: ' . $e->getMessage();
        }
        break;

      case 'backup_data':
        try {
          $employees = $employeeManager->getEmployees();
          $stats = $employeeManager->getEmployeeStats();

          $backup_data = [
            'timestamp' => date('Y-m-d H:i:s'),
            'user_id' => $database->getCurrentUserId(),
            'total_employees' => count($employees),
            'employees' => $employees,
            'statistics' => $stats
          ];

          $filename = 'Backup_User' . $database->getCurrentUserId() . '_' . date('Y-m-d_H-i-s') . '.json';

          header('Content-Type: application/json');
          header('Content-Disposition: attachment; filename="' . $filename . '"');
          header('Content-Length: ' . strlen(json_encode($backup_data, JSON_PRETTY_PRINT)));

          echo json_encode($backup_data, JSON_PRETTY_PRINT);

          logSystemAction($database->getCurrentUserId(), 'DATA_BACKUP', 'Created backup with ' . count($employees) . ' employees');
          exit;
        } catch (Exception $e) {
          $response['message'] = 'Backup error: ' . $e->getMessage();
        }
        break;

      case 'restore_data':
        $backup_json = $_POST['backup_data'] ?? '';
        $restore_mode = $_POST['restore_mode'] ?? 'replace'; // 'replace' or 'merge'

        if (empty($backup_json)) {
          $response['message'] = 'No backup data provided';
          break;
        }

        try {
          $backup_data = json_decode($backup_json, true);

          if (!$backup_data || !isset($backup_data['employees'])) {
            $response['message'] = 'Invalid backup data format';
            break;
          }

          $db = $database->getUserConnection();
          $db->beginTransaction();

          // If replace mode, delete existing data
          if ($restore_mode === 'replace') {
            $employeeManager->deleteAllEmployees();
          }

          $restored_count = 0;
          $errors = [];

          foreach ($backup_data['employees'] as $employee_data) {
            try {
              // Remove ID for restoration
              unset($employee_data['id']);
              unset($employee_data['created_at']);
              unset($employee_data['updated_at']);

              // Generate new QR code if needed
              if (empty($employee_data['qr_code'])) {
                $employee_data['qr_code'] = QRCodeGenerator::generateQRCode($employee_data['fullname'], $database->getCurrentUserId());
              }

              $employee_id = $employeeManager->createEmployee($employee_data);

              if ($employee_id) {
                $restored_count++;
              } else {
                $errors[] = "Failed to restore employee: " . ($employee_data['fullname'] ?? 'Unknown');
              }
            } catch (Exception $e) {
              $errors[] = "Error restoring " . ($employee_data['fullname'] ?? 'Unknown') . ": " . $e->getMessage();
            }
          }

          $db->commit();

          $response['success'] = true;
          $response['message'] = "Data restored successfully. $restored_count employees restored.";
          $response['restored_count'] = $restored_count;

          if (!empty($errors)) {
            $response['errors'] = $errors;
            $response['message'] .= ' ' . count($errors) . ' records had errors.';
          }

          logSystemAction($database->getCurrentUserId(), 'DATA_RESTORED', "Restored $restored_count employees from backup");
        } catch (Exception $e) {
          if (isset($db)) {
            $db->rollBack();
          }
          $response['message'] = 'Restore error: ' . $e->getMessage();
        }
        break;

      default:
        $response['message'] = 'Invalid action specified ' . $action;
        break;
    }
  } elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';

    switch ($action) {
      case 'get':
      case 'list':
        $filters = [];

        // Parse filters from GET parameters
        if (!empty($_GET['fullname'])) {
          $filters['fullname'] = $_GET['fullname'];
        }
        if (!empty($_GET['position'])) {
          $filters['position'] = $_GET['position'];
        }
        if (!empty($_GET['brand'])) {
          $filters['brand'] = $_GET['brand'];
        }
        if (!empty($_GET['status'])) {
          $filters['status'] = $_GET['status'];
        }
        if (!empty($_GET['shift'])) {
          $filters['shift'] = $_GET['shift'];
        }
        if (!empty($_GET['qr_code'])) {
          $filters['qr_code'] = $_GET['qr_code'];
        }
        if (!empty($_GET['access_timestamp'])) {
          $filters['access_timestamp'] = $_GET['access_timestamp'];
        }

        try {
          $employees = $employeeManager->getEmployees($filters);
          $response['success'] = true;
          $response['data'] = $employees;
          $response['total'] = count($employees);
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving employees: ' . $e->getMessage();
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
              $response['message'] = 'Employee not found';
            }
          } catch (Exception $e) {
            $response['message'] = 'Error retrieving employee: ' . $e->getMessage();
          }
        } else {
          $response['message'] = 'Employee ID is required';
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
              $response['message'] = 'QR code available';
            }
          } catch (Exception $e) {
            $response['message'] = 'Error checking QR code: ' . $e->getMessage();
          }
        } else {
          $response['message'] = 'QR code parameter is required';
        }
        break;

      case 'stats':
        try {
          $stats = $employeeManager->getEmployeeStats();
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
        $response['message'] = 'Invalid GET action specified';
        break;
    }
  }

  // Output JSON response for AJAX requests
  if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest') {
    header('Content-Type: application/json');
    echo json_encode($response);
    exit;
  }

  // For non-AJAX requests, you might want to redirect or handle differently
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
  error_log("Manpower System Error: " . $e->getMessage());

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

// Utility function to handle file downloads
function serveFile($filepath, $filename = null)
{
  if (!file_exists($filepath)) {
    http_response_code(404);
    echo "File not found";
    return;
  }

  $filename = $filename ?: basename($filepath);
  $file_extension = strtolower(pathinfo($filepath, PATHINFO_EXTENSION));

  // Set appropriate content type
  $content_types = [
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'gif' => 'image/gif',
    'pdf' => 'application/pdf',
    'csv' => 'text/csv',
    'xls' => 'application/vnd.ms-excel',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];

  $content_type = $content_types[$file_extension] ?? 'application/octet-stream';

  header('Content-Type: ' . $content_type);
  header('Content-Disposition: attachment; filename="' . $filename . '"');
  header('Content-Length: ' . filesize($filepath));
  header('Cache-Control: no-cache, must-revalidate');
  header('Expires: 0');

  readfile($filepath);
  exit;
}

// Handle file serving requests
if (isset($_GET['serve_file'])) {
  $userId = $_SESSION['user_id'] ?? null;

  if (!$userId) {
    http_response_code(403);
    echo "Access denied";
    exit;
  }

  $fileUploader = new FileUploader($userId);
  $filename = basename($_GET['serve_file']);
  $filepath = $fileUploader->getImagePath($filename);

  serveFile($filepath, $filename);
}

// API endpoint information
function getAPIInfo()
{
  return [
    'version' => '2.0',
    'name' => 'Integrated Manpower Management System',
    'description' => 'Multi-user employee management system with user-specific databases',
    'endpoints' => [
      'POST' => [
        'add/create' => 'Create new employee',
        'edit/update' => 'Update existing employee',
        'delete' => 'Delete employee',
        'delete_all' => 'Delete all employees',
        'import' => 'Import employees from JSON',
        'export' => 'Export employees to CSV/Excel',
        'bulk_status_update' => 'Update status for multiple employees',
        'search_qr' => 'Search employee by QR code',
        'backup_data' => 'Create data backup',
        'restore_data' => 'Restore from backup'
      ],
      'GET' => [
        'get/list' => 'Get employees with optional filters',
        'get_single' => 'Get single employee by ID',
        'check_qr' => 'Check if QR code exists',
        'stats' => 'Get employee statistics',
        'user_info' => 'Get current user information'
      ]
    ],
    'authentication' => 'Session-based (user must be logged in)',
    'database' => 'User-specific databases with prefix: ' . USER_DB_PREFIX
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
    'database_connection' => 'OK'
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
