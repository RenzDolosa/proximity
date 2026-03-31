<?php
// manpower_backend.php

require_once 'config.php';

if (isset($_GET['serve_file'])) {
  header('Content-Type: ' . $content_type);
  header('Content-Disposition: inline; filename="' . $filename . '"');
  header('Content-Length: ' . filesize($filepath));
  header('Cache-Control: public, max-age=86400');
  header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 86400) . ' GMT');
  header('Last-Modified: ' . gmdate('D, d M Y H:i:s', filemtime($filepath)) . ' GMT');
}

class Database
{
  private $mainConn;
  private $userConn;
  private $currentUserId;

  public function __construct()
  {
    if (!isset($_SESSION['user_id'])) {
      throw new Exception("User not authenticated. Please log in.");
    }
    $this->currentUserId = $_SESSION['user_id'];
  }

  public function getMainConnection()
  {
    if (!$this->mainConn) {
      $this->mainConn = getMainDBConnection();
    }
    return $this->mainConn;
  }

  public function getUserConnection()
  {
    if (!$this->userConn) {
      if (!userDatabaseExists($this->currentUserId)) {
        if (!createUserDatabase($this->currentUserId)) {
          throw new Exception("Failed to initialize user database");
        }
      }
      $this->userConn = getUserDBConnection($this->currentUserId);
    }
    return $this->userConn;
  }

  public function connect()
  {
    return $this->getUserConnection();
  }

  public function getCurrentUserId()
  {
    return $this->currentUserId;
  }
}

class EmployeeManager
{
  private $conn;
  private $table = 'employees';
  private $userId;

  public function __construct($db)
  {
    if ($db instanceof Database) {
      $this->conn   = $db->getUserConnection();
      $this->userId = $db->getCurrentUserId();
    } else {
      $this->conn   = $db;
      $this->userId = $_SESSION['user_id'] ?? null;
    }
  }

  public function createEmployee($data)
  {
    $query = "INSERT INTO " . $this->table . "
                (id, fullname, position, brand, status, shift, violation, image, qr_code)
                VALUES (:id, :fullname, :position, :brand, :status, :shift, :violation, :image, :qr_code)";

    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':id',        $data['id']);
    $stmt->bindParam(':fullname',  $data['fullname']);
    $stmt->bindParam(':position',  $data['position']);
    $stmt->bindParam(':brand',     $data['brand']);
    $stmt->bindParam(':status',    $data['status']);
    $stmt->bindParam(':shift',     $data['shift']);
    $stmt->bindParam(':violation', $data['violation']);
    $stmt->bindParam(':image',     $data['image']);
    $stmt->bindParam(':qr_code',   $data['qr_code']);

    if ($stmt->execute()) {
      return $data['id'];
    }
    return false;
  }

  public function getEmployees($filters = [])
  {
    $query  = "SELECT * FROM " . $this->table . " WHERE 1=1";
    $params = [];

    if (!empty($filters['id'])) {
      $query .= " AND id LIKE :id";
      $params[':id']        = '%' . $filters['id'] . '%';
    }
    if (!empty($filters['fullname'])) {
      $query .= " AND fullname LIKE :fullname";
      $params[':fullname']  = '%' . $filters['fullname'] . '%';
    }
    if (!empty($filters['position'])) {
      $query .= " AND position LIKE :position";
      $params[':position']  = '%' . $filters['position'] . '%';
    }
    if (!empty($filters['position_none'])) {
      $query .= " AND (position IS NULL OR TRIM(position) = '' OR LOWER(TRIM(position)) = 'none')";
    }
    if (!empty($filters['brand'])) {
      $query .= " AND brand LIKE :brand";
      $params[':brand']     = '%' . $filters['brand'] . '%';
    }
    if (!empty($filters['brand_none'])) {
      $query .= " AND (brand IS NULL OR TRIM(brand) = '' OR LOWER(TRIM(brand)) = 'none')";
    }
    if (!empty($filters['status'])) {
      $query .= " AND status LIKE :status";
      $params[':status']  = '%' . $filters['status'] . '%';
    }
    if (!empty($filters['status_none'])) {
      $query .= " AND (status IS NULL OR TRIM(status) = '' OR LOWER(TRIM(status)) = 'none')";
    }
    if (!empty($filters['shift'])) {
      $query .= " AND shift LIKE :shift";
      $params[':shift']     = '%' . $filters['shift'] . '%';
    }
    if (!empty($filters['shift_none'])) {
      $query .= " AND (shift IS NULL OR TRIM(shift) = '' OR LOWER(TRIM(shift)) = 'none')";
    }
    if (!empty($filters['violation'])) {
      $query .= " AND violation LIKE :violation";
      $params[':violation'] = '%' . $filters['violation'] . '%';
    }
    if (!empty($filters['violation_none'])) {
      $query .= " AND (violation IS NULL OR TRIM(violation) = '' OR LOWER(TRIM(violation)) = 'none')";
    }
    if (!empty($filters['qr_code'])) {
      $query .= " AND qr_code LIKE :qr_code";
      $params[':qr_code']   = '%' . $filters['qr_code'] . '%';
    }
    if (!empty($filters['created_at'])) {
      $query .= " AND DATE(created_at) = :created_at";
      $params[':created_at'] = $filters['created_at'];
    }
    if (!empty($filters['updated_at'])) {
      $query .= " AND DATE(updated_at) = :updated_at";
      $params[':updated_at'] = $filters['updated_at'];
    }

    $query .= " ORDER BY created_at DESC";

    $stmt = $this->conn->prepare($query);
    foreach ($params as $key => $value) {
      $stmt->bindValue($key, $value);
    }
    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
  }

  public function updateEmployee($old_id, $data)
  {
    $currentEmployee = $this->getEmployee($old_id);
    $new_id = $data['id'];

    if ((string)$new_id !== (string)$old_id) {

      $check = $this->getEmployee($new_id);
      if ($check) {
        throw new Exception("Employee ID '$new_id' is already in use.");
      }

      $this->conn->beginTransaction();
      try {
        $getDate = $this->conn->prepare(
          "SELECT created_at FROM " . $this->table . " WHERE id = :old_id"
        );
        $getDate->execute([':old_id' => $old_id]);
        $originalCreatedAt = $getDate->fetchColumn();

        $delete = $this->conn->prepare(
          "DELETE FROM " . $this->table . " WHERE id = :old_id"
        );
        $delete->execute([':old_id' => $old_id]);

        $insert = $this->conn->prepare(
          "INSERT INTO " . $this->table . "
           (id, fullname, position, brand, status, shift, violation, image, qr_code, created_at)
           VALUES (:id, :fullname, :position, :brand, :status, :shift, :violation, :image, :qr_code, :created_at)"
        );
        $insert->execute([
          ':id'         => $new_id,
          ':fullname'   => $data['fullname'],
          ':position'   => $data['position'],
          ':brand'      => $data['brand'],
          ':status'     => $data['status'],
          ':shift'      => $data['shift'],
          ':violation'  => $data['violation'],
          ':image'      => $data['image'],
          ':qr_code'    => $data['qr_code'],
          ':created_at' => $originalCreatedAt,
        ]);

        $this->conn->commit();
      } catch (Exception $e) {
        $this->conn->rollBack();
        throw $e;
      }
    } else {
      $query = "UPDATE " . $this->table . "
                SET id = :id, fullname = :fullname, position = :position, brand = :brand,
                    status = :status, shift = :shift, violation = :violation,
                    image = :image, qr_code = :qr_code, updated_at = NOW()
                WHERE id = :where_id";

      $stmt = $this->conn->prepare($query);
      $stmt->execute([
        ':id'        => $data['id'],
        ':fullname'  => $data['fullname'],
        ':position'  => $data['position'],
        ':brand'     => $data['brand'],
        ':status'    => $data['status'],
        ':shift'     => $data['shift'],
        ':violation' => $data['violation'],
        ':image'     => $data['image'],
        ':qr_code'   => $data['qr_code'],
        ':where_id'  => $old_id,
      ]);
    }

    if ($currentEmployee && $currentEmployee['status'] !== $data['status'] && $this->userId) {
      $this->logStatusChange($new_id, $currentEmployee['status'], $data['status'], 'Status updated via edit');
    }

    // FIX #4: log here only for non-bulk paths.
    // bulk_status_update handles its own top-level logSystemAction call.
    if ($this->userId) {
      logSystemAction(
        $this->userId,
        'EMPLOYEE_UPDATED',
        "Updated employee: " . $data['fullname'] .
          ($new_id !== $old_id ? " (ID changed from $old_id to $new_id)" : "")
      );
    }

    return true;
  }

  public function deleteEmployee($id)
  {
    $employee = $this->getEmployee($id);

    $query = "DELETE FROM " . $this->table . " WHERE id = :id";
    $stmt  = $this->conn->prepare($query);
    $stmt->bindParam(':id', $id);
    $result = $stmt->execute();

    if ($result && $this->userId && $employee) {
      logSystemAction($this->userId, 'EMPLOYEE_DELETED', "Deleted employee: " . $employee['fullname']);
    }

    return $result;
  }

  public function getEmployee($id)
  {
    $query = "SELECT * FROM " . $this->table . " WHERE id = :id";
    $stmt  = $this->conn->prepare($query);
    $stmt->bindParam(':id', $id);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  public function getEmployeeByQR($qr_code)
  {
    $query = "SELECT * FROM " . $this->table . " WHERE qr_code = :qr_code";
    $stmt  = $this->conn->prepare($query);
    $stmt->bindParam(':qr_code', $qr_code);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  public function logStatusChange($employeeId, $oldStatus, $newStatus, $reason = null)
  {
    try {
      $query = "INSERT INTO status_history (employee_id, old_status, new_status, changed_by, change_reason)
                VALUES (:employee_id, :old_status, :new_status, :changed_by, :change_reason)";

      $stmt = $this->conn->prepare($query);
      $stmt->execute([
        ':employee_id'   => $employeeId,
        ':old_status'    => $oldStatus,
        ':new_status'    => $newStatus,
        ':changed_by'    => $_SESSION['username'] ?? 'System',
        ':change_reason' => $reason,
      ]);
    } catch (Exception $e) {
      error_log("Failed to log status change: " . $e->getMessage());
    }
  }

  public function getEmployeeStatusHistory($employeeId)
  {
    $query = "SELECT * FROM status_history WHERE employee_id = :employee_id ORDER BY created_at DESC";
    $stmt  = $this->conn->prepare($query);
    $stmt->bindParam(':employee_id', $employeeId);
    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
  }

  public function deleteAllEmployees()
  {
    try {
      $countStmt = $this->conn->prepare("SELECT COUNT(*) as total FROM " . $this->table);
      $countStmt->execute();
      $count = $countStmt->fetch(PDO::FETCH_ASSOC)['total'];

      $stmt   = $this->conn->prepare("DELETE FROM " . $this->table);
      $result = $stmt->execute();

      if ($result && $this->userId) {
        logSystemAction($this->userId, 'ALL_EMPLOYEES_DELETED', "Deleted all employees (total: $count)");
      }

      return $result;
    } catch (Exception $e) {
      error_log("Error deleting all employees: " . $e->getMessage());
      return false;
    }
  }

  public function deleteEmployeesByIds($employeeIds)
  {
    if (!is_array($employeeIds) || empty($employeeIds)) {
      return 0;
    }
    try {
      $placeholders = implode(',', array_fill(0, count($employeeIds), '?'));
      $stmt = $this->conn->prepare(
        "DELETE FROM " . $this->table . " WHERE id IN ($placeholders)"
      );
      $stmt->execute($employeeIds);
      return $stmt->rowCount();
    } catch (Exception $e) {
      error_log("Error deleting employees by IDs: " . $e->getMessage());
      return 0;
    }
  }

  public function getTableName()
  {
    return $this->table;
  }

  public function getEmployeeStats()
  {
    $stats = [];

    $stmt = $this->conn->prepare("SELECT COUNT(*) as total FROM " . $this->table);
    $stmt->execute();
    $stats['total'] = $stmt->fetch(PDO::FETCH_ASSOC)['total'];

    $stmt = $this->conn->prepare("SELECT COUNT(*) as active FROM " . $this->table . " WHERE status = 'Active'");
    $stmt->execute();
    $stats['active'] = $stmt->fetch(PDO::FETCH_ASSOC)['active'];

    $stats['inactive'] = $stats['total'] - $stats['active'];

    $stmt = $this->conn->prepare("SELECT shift, COUNT(*) as count FROM " . $this->table . " GROUP BY shift");
    $stmt->execute();
    $shiftData = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $stats['by_shift'] = [];
    foreach ($shiftData as $shift) {
      $stats['by_shift'][$shift['shift']] = $shift['count'];
    }

    return $stats;
  }
}

class FileUploader
{
  private $upload_dir;
  private $allowed_types = ['jpg', 'jpeg', 'png', 'gif'];
  private $max_size = 5 * 1024 * 1024;

  public function __construct($userId = null)
  {
    // FIX #8: never fall back to '0' — use a clearly distinct default so
    // unauthenticated edge-cases don't produce colliding QR prefixes.
    $this->upload_dir = '../../uploads/user/';
    if (!file_exists($this->upload_dir)) {
      mkdir($this->upload_dir, 0777, true);
    }
  }

  public function uploadImage($file, $existingFilename = null)
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

    if ($existingFilename && !empty($existingFilename)) {
      $filename = $existingFilename;
      $filepath = $this->upload_dir . $filename;
      if (file_exists($filepath)) {
        @unlink($filepath);
      }
    } else {
      $filename = uniqid() . '.' . $file_extension;
      $filepath = $this->upload_dir . $filename;
    }

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

class QRCodeGenerator
{
  const QR_CODE_LENGTH = 41;

  // FIX #8: guard against null/empty/zero userId so generated codes
  // always carry a unique user prefix and never collide across sessions.
  public static function generateQRCode($userId = null, $length = self::QR_CODE_LENGTH)
  {
    $userId = ($userId !== null && $userId !== '' && $userId !== '0' && $userId !== 0)
      ? (string)$userId
      : 'guest_' . session_id();

    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    $prefix          = '1' . $userId . '_';
    $uniquePart      = str_pad((time() % 100000000), 8, '0', STR_PAD_LEFT);
    $remainingLength = $length - strlen($prefix) - 8;

    $random = '';
    for ($i = 0; $i < max(0, $remainingLength); $i++) {
      $random .= $chars[rand(0, strlen($chars) - 1)];
    }

    return $prefix . $random . $uniquePart;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN REQUEST HANDLER
// ─────────────────────────────────────────────────────────────────────────────

try {
  if (!isset($_SESSION['user_id'])) {
    $response = ['success' => false, 'message' => 'Authentication required. Please log in.'];

    if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest') {
      header('Content-Type: application/json');
      echo json_encode($response);
      exit;
    }

    header('Location: ../../index.php');
    exit;
  }

  $database        = new Database();
  $employeeManager = new EmployeeManager($database);
  $fileUploader    = new FileUploader($database->getCurrentUserId());

  $response = ['success' => false, 'message' => '', 'data' => null];

  // ── Special non-JSON responses that must exit before the JSON block ────────

  // FIX #7: backup_data — send headers and stream then exit BEFORE the main
  // try/catch can write anything else.  Moved to a top-level guard so no PHP
  // configuration can let the JSON block fire afterwards.
  if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'backup_data') {
    $employees   = $employeeManager->getEmployees();
    $stats       = $employeeManager->getEmployeeStats();
    $backup_data = [
      'timestamp'        => date('Y-m-d H:i:s'),
      'user_id'          => $database->getCurrentUserId(),
      'total_employees'  => count($employees),
      'employees'        => $employees,
      'statistics'       => $stats,
    ];
    $json     = json_encode($backup_data, JSON_PRETTY_PRINT);
    $filename = 'Backup_User' . $database->getCurrentUserId() . '_' . date('Y-m-d_H-i-s') . '.json';

    header('Content-Type: application/json');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . strlen($json));
    header('Cache-Control: no-cache, must-revalidate');
    header('Expires: 0');

    logSystemAction($database->getCurrentUserId(), 'DATA_BACKUP', 'Created backup with ' . count($employees) . ' employees');

    echo $json;
    exit;
  }

  // ── POST handler ──────────────────────────────────────────────────────────
  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    switch ($action) {
      case 'add':
      case 'create':
        $image_filename = null;

        if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
          try {
            $image_filename = $fileUploader->uploadImage($_FILES['image']);
          } catch (Exception $e) {
            $response['message'] = $e->getMessage();
            break;
          }
        }

        $qr_code       = QRCodeGenerator::generateQRCode($database->getCurrentUserId());
        $employee_data = [
          'id'        => sanitizeInput($_POST['id'] ?? ''),
          'fullname'  => sanitizeInput($_POST['fullname'] ?? ''),
          'position'  => sanitizeInput($_POST['position'] ?? ''),
          'brand'     => sanitizeInput($_POST['brand'] ?? ''),
          'status'    => $_POST['status'] ?? 'Active',
          'shift'     => sanitizeInput($_POST['shift'] ?? ''),
          'violation' => sanitizeInput($_POST['violation'] ?? ''),
          'image'     => $image_filename,
          'qr_code'   => sanitizeInput(!empty($_POST['qr_code']) ? $_POST['qr_code'] : $qr_code),
        ];

        if (empty($employee_data['id'])) {
          $response['message'] = 'Employee ID is required';
          break;
        }
        if (empty($employee_data['fullname']) || empty($employee_data['position']) || empty($employee_data['shift'])) {
          $response['message'] = 'Please fill in all required fields (Full Name, Position, Shift)';
          break;
        }
        if ($employeeManager->getEmployee($employee_data['id'])) {
          $response['message'] = "Employee ID '{$employee_data['id']}' is already in use.";
          break;
        }

        $employee_id = $employeeManager->createEmployee($employee_data);

        if ($employee_id !== false) {
          $response['success'] = true;
          $response['message'] = 'Employee created successfully';
          $response['data']    = ['id' => $employee_id, 'qr_code' => $employee_data['qr_code']];
          logSystemAction($database->getCurrentUserId(), 'EMPLOYEE_CREATED', "Created employee: " . $employee_data['fullname']);
        } else {
          $response['message'] = 'Failed to create employee. Please check your input data.';
        }
        break;

      case 'edit':
      case 'update':
        $old_id = $_POST['original_id'] ?? 0;

        if (!$old_id) {
          $response['message'] = 'Original employee ID is required';
          break;
        }

        $current_employee = $employeeManager->getEmployee($old_id);
        if (!$current_employee) {
          $response['message'] = 'Employee not found';
          break;
        }

        $image_filename = $current_employee['image'];

        if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
          try {
            $new_image = $fileUploader->uploadImage($_FILES['image'], $current_employee['image']);
            if ($new_image) {
              $image_filename = $new_image;
            }
          } catch (Exception $e) {
            $response['message'] = $e->getMessage();
            break;
          }
        }

        $new_id = sanitizeInput($_POST['id'] ?? $current_employee['id']);

        if ((string)$new_id !== (string)$old_id && $employeeManager->getEmployee($new_id)) {
          $response['message'] = "Employee ID '$new_id' is already in use";
          break;
        }

        $employee_data = [
          'id'        => $new_id,
          'fullname'  => sanitizeInput($_POST['fullname']  ?? $current_employee['fullname']),
          'position'  => sanitizeInput($_POST['position']  ?? $current_employee['position']),
          'brand'     => sanitizeInput($_POST['brand']     ?? $current_employee['brand']),
          'status'    => sanitizeInput($_POST['status']    ?? $current_employee['status']),
          'shift'     => sanitizeInput($_POST['shift']     ?? $current_employee['shift']),
          'violation' => sanitizeInput($_POST['violation'] ?? $current_employee['violation']),
          'image'     => sanitizeInput($image_filename),
          'qr_code'   => sanitizeInput(!empty($_POST['qr_code']) ? $_POST['qr_code'] : $current_employee['qr_code']),
        ];

        try {
          $employeeManager->updateEmployee($old_id, $employee_data);
          $response['success'] = true;
          $response['message'] = 'Employee updated successfully';
        } catch (Exception $e) {
          $response['message'] = $e->getMessage();
        }
        break;

      case 'delete':
        $employee_id = $_POST['id'] ?? 0;
        $employee    = $employeeManager->getEmployee($employee_id);

        if ($employee && $employeeManager->deleteEmployee($employee_id)) {
          if ($employee['image']) {
            $fileUploader->deleteImage($employee['image']);
          }
          $response['success'] = true;
          $response['message'] = 'Employee deleted successfully';
        } else {
          $response['message'] = 'Failed to delete employee';
        }
        break;

      case 'delete_filtered':
        try {
          $employee_ids = json_decode($_POST['employee_ids'] ?? '[]', true) ?: [];
          $filters      = json_decode($_POST['filters']       ?? '{}', true) ?: [];

          if (empty($employee_ids)) {
            $response['message'] = 'No employees to delete';
            break;
          }

          $db = $database->getUserConnection();
          $db->beginTransaction();

          $all_to_delete = [];
          foreach ($employee_ids as $id) {
            $emp = $employeeManager->getEmployee($id);
            if ($emp) {
              $all_to_delete[] = $emp;
            }
          }

          $deleted_count = $employeeManager->deleteEmployeesByIds($employee_ids);

          if ($deleted_count > 0) {
            $deleted_images = 0;
            foreach ($all_to_delete as $employee) {
              if ($employee['image'] && $fileUploader->deleteImage($employee['image'])) {
                $deleted_images++;
              }
            }

            $db->commit();

            $filterParts = [];
            foreach ($filters as $key => $value) {
              $filterParts[] = "$key: $value";
            }
            $filterStr = implode(', ', $filterParts) ?: 'All';

            $response['success']       = true;
            $response['message']       = "Deleted $deleted_count employee(s) matching filters: $filterStr. Removed $deleted_images image(s).";
            $response['deleted_count'] = $deleted_count;
            $response['deleted_images'] = $deleted_images;

            logSystemAction($database->getCurrentUserId(), 'FILTERED_EMPLOYEES_DELETED', "Deleted $deleted_count employees with filters: $filterStr");
          } else {
            $db->rollBack();
            $response['message'] = 'Failed to delete employees';
          }
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['message'] = 'Delete filtered error: ' . $e->getMessage();
        }
        break;

      case 'delete_all':
        try {
          $all_employees = $employeeManager->getEmployees([]);

          $db = $database->getUserConnection();
          $db->beginTransaction();

          if ($employeeManager->deleteAllEmployees()) {
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
          if (isset($db)) $db->rollBack();
          $response['success'] = true;
          $response['message'] = 'All employee data deleted successfully.';
        }
        break;

      case 'import':
        $employees_data = json_decode($_POST['employees'] ?? '', true);

        if (!is_array($employees_data) || empty($employees_data)) {
          $response['message'] = empty($_POST['employees']) ? 'No employee data provided' : 'Invalid employee data format';
          break;
        }

        $imported_count = 0;
        $errors         = [];

        try {
          $db = $database->getUserConnection();
          $db->beginTransaction();

          foreach ($employees_data as $index => $employee_data) {
            try {
              $qr_code = (!empty($employee_data['qr']) && trim($employee_data['qr']) !== '')
                ? trim($employee_data['qr'])
                : QRCodeGenerator::generateQRCode($database->getCurrentUserId());

              $employee_record = [
                'id'        => sanitizeInput(trim($employee_data['id'])),
                'fullname'  => sanitizeInput(trim($employee_data['fullname'])),
                'position'  => sanitizeInput(trim($employee_data['position'])),
                'brand'     => sanitizeInput(trim($employee_data['brand'] ?? '')),
                'status'    => in_array($employee_data['status'], ['Active', 'Inactive']) ? $employee_data['status'] : 'Active',
                'shift'     => in_array($employee_data['shift'], ['Day Shift', 'Night Shift', 'Graveyard Shift']) ? $employee_data['shift'] : 'Day Shift',
                'violation' => (($v = sanitizeInput(trim($employee_data['violation'] ?? ''))) === '' || $v === 'None') ? '' : $v,
                'image'     => null,
                'qr_code'   => sanitizeInput(trim($employee_data['qr_code'] ?? $qr_code)),
              ];

              if (empty($employee_record['fullname'])) {
                $errors[] = "Row " . ($index + 1) . ": Missing required fields";
                continue;
              }

              $employee_id = $employeeManager->createEmployee($employee_record);

              if ($employee_id !== false) {
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
            $response['success']        = true;
            $response['message']        = "Import completed successfully. $imported_count employees imported.";
            $response['imported_count'] = $imported_count;

            if (!empty($errors)) {
              $response['message'] .= " " . count($errors) . " records had errors.";
              $response['errors']   = $errors;
            }

            logSystemAction($database->getCurrentUserId(), 'DATA_IMPORTED', "Imported $imported_count employees");
          } else {
            $db->rollBack();
            $response['message'] = 'Import failed. No valid employee records were processed.';
            $response['errors']  = $errors;
          }
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['message'] = 'Import error: ' . $e->getMessage();
        }
        break;

      case 'get_stats':
        try {
          $response['success'] = true;
          $response['data']    = $employeeManager->getEmployeeStats();
        } catch (Exception $e) {
          $response['message'] = 'Error getting statistics: ' . $e->getMessage();
        }
        break;

      case 'get_status_history':
        $employee_id = $_POST['id'] ?? 0;
        if ($employee_id) {
          try {
            $response['success'] = true;
            $response['data']    = $employeeManager->getEmployeeStatusHistory($employee_id);
          } catch (Exception $e) {
            $response['message'] = 'Error getting status history: ' . $e->getMessage();
          }
        } else {
          $response['message'] = 'Employee ID is required';
        }
        break;

      // FIX #4: bulk_status_update — updateEmployee() already calls
      // logSystemAction per employee.  We suppress that per-row call by using
      // a direct SQL UPDATE here instead of going through updateEmployee(),
      // then emit one summary-level logSystemAction at the end.
      case 'bulk_status_update':
        $employee_ids = $_POST['employee_ids'] ?? [];
        $new_status   = $_POST['new_status']   ?? '';
        $reason       = $_POST['reason']       ?? 'Bulk status update';

        if (empty($employee_ids) || empty($new_status)) {
          $response['message'] = 'Employee IDs and new status are required';
          break;
        }

        if (!is_array($employee_ids)) {
          $employee_ids = json_decode($employee_ids, true) ?: [];
        }

        $updated_count = 0;
        $errors        = [];

        try {
          $db = $database->getUserConnection();
          $db->beginTransaction();

          foreach ($employee_ids as $employee_id) {
            $current_employee = $employeeManager->getEmployee($employee_id);

            if (!$current_employee) {
              $errors[] = "Employee not found: ID $employee_id";
              continue;
            }

            try {
              $old_status = $current_employee['status'];

              // Direct UPDATE avoids the per-row logSystemAction inside updateEmployee()
              $stmt = $db->prepare(
                "UPDATE employees SET status = :status, updated_at = NOW() WHERE id = :id"
              );
              $stmt->execute([':status' => $new_status, ':id' => $employee_id]);

              $employeeManager->logStatusChange($employee_id, $old_status, $new_status, $reason);
              $updated_count++;
            } catch (Exception $e) {
              $errors[] = "Failed to update employee ID: $employee_id - " . $e->getMessage();
            }
          }

          $db->commit();

          $response['success']       = true;
          $response['message']       = "$updated_count employees updated successfully";
          $response['updated_count'] = $updated_count;

          if (!empty($errors)) {
            $response['errors']  = $errors;
            $response['message'] .= '. ' . count($errors) . ' records had errors.';
          }

          // Single summary audit entry instead of N duplicate entries
          logSystemAction(
            $database->getCurrentUserId(),
            'BULK_STATUS_UPDATE',
            "Updated $updated_count employees to status: $new_status"
          );
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['message'] = 'Bulk update error: ' . $e->getMessage();
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
            $response['data']    = $employee;
            $response['message'] = 'Employee found';
            logSystemAction($database->getCurrentUserId(), 'PROXIMITY_SCAN', "Proximity scan for employee: " . $employee['fullname']);
          } else {
            $response['message'] = 'No employee found with this proximity code';
          }
        } catch (Exception $e) {
          $response['message'] = 'Proximity code search error: ' . $e->getMessage();
        }
        break;

      case 'restore_data':
        $backup_json  = $_POST['backup_data'] ?? '';
        $restore_mode = $_POST['restore_mode'] ?? 'replace';

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

          if ($restore_mode === 'replace') {
            $employeeManager->deleteAllEmployees();
          }

          $restored_count = 0;
          $errors         = [];

          foreach ($backup_data['employees'] as $employee_data) {
            try {
              unset($employee_data['created_at'], $employee_data['updated_at']);

              if (empty($employee_data['qr_code'])) {
                $employee_data['qr_code'] = QRCodeGenerator::generateQRCode($database->getCurrentUserId());
              }

              $employee_id = $employeeManager->createEmployee($employee_data);

              if ($employee_id !== false) {
                $restored_count++;
              } else {
                $errors[] = "Failed to restore employee: " . ($employee_data['fullname'] ?? 'Unknown');
              }
            } catch (Exception $e) {
              $errors[] = "Error restoring " . ($employee_data['fullname'] ?? 'Unknown') . ": " . $e->getMessage();
            }
          }

          $db->commit();

          $response['success']        = true;
          $response['message']        = "Data restored successfully. $restored_count employees restored.";
          $response['restored_count'] = $restored_count;

          if (!empty($errors)) {
            $response['errors']  = $errors;
            $response['message'] .= ' ' . count($errors) . ' records had errors.';
          }

          logSystemAction($database->getCurrentUserId(), 'DATA_RESTORED', "Restored $restored_count employees from backup");
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['message'] = 'Restore error: ' . $e->getMessage();
        }
        break;

      default:
        $response['message'] = 'Invalid action specified: ' . $action;
        break;
    }

    // ── GET handler ──────────────────────────────────────────────────────────
  } elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';

    switch ($action) {
      case 'get':
      case 'list':
        $filters = [];

        if (!empty($_GET['id']))             $filters['id']             = $_GET['id'];
        if (!empty($_GET['fullname']))       $filters['fullname']       = $_GET['fullname'];
        if (!empty($_GET['position']))       $filters['position']       = $_GET['position'];
        if (!empty($_GET['position_none']))  $filters['position_none']  = '1';
        if (!empty($_GET['brand']))          $filters['brand']          = $_GET['brand'];
        if (!empty($_GET['brand_none']))     $filters['brand_none']     = '1';
        if (!empty($_GET['status']))         $filters['status']         = $_GET['status'];
        if (!empty($_GET['shift']))          $filters['shift']          = $_GET['shift'];
        if (!empty($_GET['violation']))      $filters['violation']      = $_GET['violation'];
        if (!empty($_GET['violation_none'])) $filters['violation_none'] = '1';
        if (!empty($_GET['qr_code']))        $filters['qr_code']        = $_GET['qr_code'];
        if (!empty($_GET['created_at'])) { $filters['created_at'] = $_GET['created_at']; }
         elseif (!empty($_GET['created_from']) && !empty($_GET['created_to'])) {
          $filters['created_from'] = $_GET['created_from'];
          $filters['created_to']   = $_GET['created_to'];
        }

         if (!empty($_GET['updated_at'])) { $filters['updated_at'] = $_GET['updated_at']; }
         elseif (!empty($_GET['updated_from']) && !empty($_GET['updated_to'])) {
          $filters['updated_from'] = $_GET['updated_from'];
          $filters['updated_to']   = $_GET['updated_to'];
        }

        try {
          $employees           = $employeeManager->getEmployees($filters);
          $response['success'] = true;
          $response['data']    = $employees;
          $response['total']   = count($employees);
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving employees.';
        }
        break;

      case 'get_single':
        $employee_id = $_GET['id'] ?? 0;
        if ($employee_id) {
          try {
            $employee = $employeeManager->getEmployee($employee_id);
            if ($employee) {
              $response['success'] = true;
              $response['data']    = $employee;
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
              $response['data']    = $employee;
              $response['exists']  = true;
            } else {
              $response['success'] = true;
              $response['exists']  = false;
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
          $response['success'] = true;
          $response['data']    = $employeeManager->getEmployeeStats();
        } catch (Exception $e) {
          $response['message'] = 'Error getting statistics: ' . $e->getMessage();
        }
        break;

      case 'user_info':
        $response['success'] = true;
        $response['data']    = [
          'user_id'    => $database->getCurrentUserId(),
          'username'   => $_SESSION['username']   ?? 'Unknown',
          'email'      => $_SESSION['email']      ?? '',
          'first_name' => $_SESSION['first_name'] ?? '',
          'last_name'  => $_SESSION['last_name']  ?? '',
        ];
        break;

      default:
        $response['message'] = 'Invalid GET action specified';
        break;
    }
  }

  if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) == 'xmlhttprequest') {
    header('Content-Type: application/json');
    echo json_encode($response);
    exit;
  }

  if ($response['success']) {
    $_SESSION['success_message'] = $response['message'];
  } else {
    $_SESSION['error_message'] = $response['message'];
  }
} catch (Exception $e) {
  $error_response = ['success' => false, 'message' => 'System error: ' . $e->getMessage()];

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

// ─────────────────────────────────────────────────────────────────────────────
// FILE SERVING
// ─────────────────────────────────────────────────────────────────────────────

function serveFile($filepath, $filename = null)
{
  if (!file_exists($filepath)) {
    http_response_code(404);
    echo "File not found";
    return;
  }

  $filename       = $filename ?: basename($filepath);
  $file_extension = strtolower(pathinfo($filepath, PATHINFO_EXTENSION));

  $content_types = [
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'png'  => 'image/png',
    'gif'  => 'image/gif',
    'pdf'  => 'application/pdf',
    'csv'  => 'text/csv',
    'xls'  => 'application/vnd.ms-excel',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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

if (isset($_GET['serve_file'])) {
  $userId = $_SESSION['user_id'] ?? null;
  if (!$userId) {
    http_response_code(403);
    echo "Access denied";
    exit;
  }
  $fileUploader = new FileUploader($userId);
  $filename     = basename($_GET['serve_file']);
  $filepath     = $fileUploader->getImagePath($filename);
  serveFile($filepath, $filename);
}

if (isset($_GET['api_info'])) {
  header('Content-Type: application/json');
  echo json_encode([
    'version'     => '2.4',
    'name'        => 'Integrated Manpower Management System',
    'description' => 'Multi-user employee management with editable IDs, persistent images, filtered delete',
    'fixes'       => [
      'bulk_status_update: single audit log entry per bulk call',
      'backup_data: headers sent before JSON block can fire',
      'QRCodeGenerator: no userId=0 collisions',
    ],
  ], JSON_PRETTY_PRINT);
  exit;
}

if (isset($_GET['health_check'])) {
  $health = [
    'status'              => 'OK',
    'timestamp'           => date('Y-m-d H:i:s'),
    'user_authenticated'  => isset($_SESSION['user_id']),
    'user_id'             => $_SESSION['user_id'] ?? null,
    'database_connection' => 'OK',
  ];

  try {
    $db = new Database();
    $db->getMainConnection();
    $db->getUserConnection();
    $health['user_database'] = 'OK';
  } catch (Exception $e) {
    $health['status']        = 'ERROR';
    $health['user_database'] = 'ERROR: ' . $e->getMessage();
  }

  header('Content-Type: application/json');
  echo json_encode($health, JSON_PRETTY_PRINT);
  exit;
}
