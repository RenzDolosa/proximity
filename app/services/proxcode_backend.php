<?php
// app/services/proxcode_backend.php --> proximity table backend

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';

// ── Security headers ──────────────────────────────────────────────────────────
if (!isset($_GET['serve_file']) && !isset($_GET['api_info']) && !isset($_GET['health_check'])) {
  header('X-Content-Type-Options: nosniff');
  header('X-Frame-Options: DENY');
  header('Referrer-Policy: strict-origin-when-cross-origin');
  header("Content-Security-Policy: default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' https://cdnjs.cloudflare.com https://fonts.gstatic.com;");
}

// ── Safe fallback sanitizeInput() ─────────────────────────────────────────────
if (!function_exists('sanitizeInput')) {
  function sanitizeInput($input)
  {
    if (is_null($input)) return '';
    return htmlspecialchars(strip_tags(trim((string)$input)), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
  }
}

if (!defined('APP_TIMEZONE')) {
  define('APP_TIMEZONE',    'Asia/Manila');
  define('APP_TIMEZONE_TZ', '+08:00');
}
date_default_timezone_set(APP_TIMEZONE);

// ── Safe json_decode wrapper ──────────────────────────────────────────────────
function safeJsonDecode($json, $assoc = true, $depth = 32)
{
  if (!is_string($json) || $json === '') return null;
  try {
    $decoded = json_decode($json, $assoc, $depth, JSON_THROW_ON_ERROR);
    return $decoded;
  } catch (JsonException $e) {
    error_log("safeJsonDecode error: " . $e->getMessage());
    return null;
  }
}

if (isset($_GET['serve_file'])) {
  header('Content-Type: ' . ($content_type ?? 'application/octet-stream'));
  if (!empty($filename)) header('Content-Disposition: inline; filename="' . $filename . '"');
  if (!empty($filepath) && file_exists($filepath)) {
    header('Content-Length: ' . filesize($filepath));
    header('Cache-Control: public, max-age=86400');
    header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 86400) . ' GMT');
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', filemtime($filepath)) . ' GMT');
  }
}

const ALLOWED_GET_ACTIONS = [
  'get',
  'list',
  'get_single',
  'check_qr',
  'stats',
  'user_info',
  'sync_orphans',
];

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
  private $table = 'code';
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
                      (qr_code, is_active) 
                      VALUES (:qr_code, :is_active)";

    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':qr_code', $data['qr_code']);
    $stmt->bindValue(':is_active', isset($data['is_active']) ? (int)$data['is_active'] : 1);

    if ($stmt->execute()) {
      $employeeId = $this->conn->lastInsertId();
      if ($this->userId) {
        logSystemAction($this->userId, 'CODE_CREATED', "Created code: " . $data['qr_code']);
      }
      return $employeeId;
    }
    return false;
  }

  public function getEmployees($filters = [])
  {
    $where  = "SELECT * FROM " . $this->table . " WHERE 1=1";
    $params = [];

    if (!empty($filters['qr_code'])) {
      $where .= " AND qr_code LIKE :qr_code";
      $params[':qr_code'] = '%' . $filters['qr_code'] . '%';
    }
    if (isset($filters['is_active']) && $filters['is_active'] !== '') {
      $where .= " AND is_active = :is_active";
      $params[':is_active'] = (int)$filters['is_active'];
    }
    if (!empty($filters['created_at'])) {
      $where .= " AND created_at LIKE :created_at";
      $params[':created_at'] = '%' . $filters['created_at'] . '%';
    }
    if (!empty($filters['date_from'])) {
      $where .= " AND DATE(created_at) >= :date_from";
      $params[':date_from'] = $filters['date_from'];
    }
    if (!empty($filters['date_to'])) {
      $where .= " AND DATE(created_at) <= :date_to";
      $params[':date_to'] = $filters['date_to'];
    }
    if (!empty($filters['updated_at'])) {
      $where .= " AND updated_at LIKE :updated_at";
      $params[':updated_at'] = '%' . $filters['updated_at'] . '%';
    }

    $where .= " ORDER BY id DESC";

    $stmt = $this->conn->prepare($where);
    foreach ($params as $key => $value) {
      $stmt->bindValue($key, $value);
    }

    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
  }

  public function updateEmployee($id, $data)
  {
    $query = "UPDATE " . $this->table . " 
                      SET qr_code = :qr_code, is_active = :is_active, updated_at = :updated_at
                      WHERE id = :id";

    $stmt = $this->conn->prepare($query);

    $stmt->bindParam(':id',         $id);
    $stmt->bindParam(':qr_code',    $data['qr_code']);
    $stmt->bindValue(':is_active',  isset($data['is_active']) ? (int)$data['is_active'] : 1);
    $stmt->bindValue(':updated_at', date('Y-m-d H:i:s'));

    $result = $stmt->execute();
    if ($result && $this->userId) {
      logSystemAction($this->userId, 'CODE_UPDATED', "Updated code: " . $data['qr_code']);
    }
    return $result;
  }

  public function toggleStatus($id)
  {
    $query = "UPDATE " . $this->table . " 
            SET is_active = NOT is_active, updated_at = :updated_at
            WHERE id = :id";

    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':id', $id);
    $stmt->bindValue(':updated_at', date('Y-m-d H:i:s'));

    $result = $stmt->execute();

    if ($result) {
      $employee = $this->getEmployee($id);
      if ($this->userId) {
        $status = $employee['is_active'] ? 'ENABLED' : 'DISABLED';
        logSystemAction(
          $this->userId,
          'PROXIMITY_STATUS_CHANGED',
          "Proximity code {$status}: " . $employee['qr_code']
        );
      }

      $syncResult = $this->syncEmployeeStatusWithCode(
        $employee['qr_code'],
        $employee['is_active']
      );
      if (!$syncResult['success']) {
        error_log("Failed to sync employee status: " . $syncResult['message']);
      } else {
        error_log("Employee synced: " . $syncResult['message']);
      }

      return $employee;
    }
    return false;
  }

  private function syncEmployeeStatusWithCode($qr_code, $codeIsActive)
  {
    try {
      $userConn = getUserDBConnection($this->userId);

      // Find employee by QR code
      $stmt = $userConn->prepare(
        "SELECT id, fullname, status
         FROM employees
         WHERE LOWER(TRIM(qr_code)) = LOWER(TRIM(:qr_code))
         LIMIT 1"
      );
      $stmt->execute([':qr_code' => $qr_code]);
      $employee = $stmt->fetch(PDO::FETCH_ASSOC);

      if (!$employee) {
        return [
          'success' => true,
          'message' => "No employee assigned to QR: $qr_code — nothing to sync",
        ];
      }

      if ((int)$codeIsActive === 0) {
        if ($employee['status'] === 'Inactive') {
          return [
            'success' => true,
            'message' => "Employee {$employee['fullname']} already Inactive",
          ];
        }

        $oldStatus = $employee['status'];
        $now       = date('Y-m-d H:i:s');

        $upd = $userConn->prepare(
          "UPDATE employees
           SET status = 'Inactive', updated_at = :ts
           WHERE id = :id"
        );
        $upd->execute([':ts' => $now, ':id' => $employee['id']]);

        try {
          $hist = $userConn->prepare(
            "INSERT INTO status_history
               (employee_id, old_status, new_status, changed_by, change_reason, created_at)
             VALUES (:eid, :old, 'Inactive', :by, :reason, :ts)"
          );
          $hist->execute([
            ':eid'    => $employee['id'],
            ':old'    => $oldStatus,
            ':by'     => $_SESSION['username'] ?? 'System',
            ':reason' => 'Auto-disabled: Proximity code was disabled',
            ':ts'     => $now,
          ]);
        } catch (Exception $e) {
          error_log("status_history insert failed (syncEmployeeStatusWithCode): " . $e->getMessage());
        }

        logSystemAction(
          $this->userId,
          'EMPLOYEE_AUTO_DISABLED',
          "Employee {$employee['fullname']} set Inactive — proximity code disabled (QR: $qr_code)"
        );

        return [
          'success'       => true,
          'message'       => "Employee {$employee['fullname']} set Inactive ($oldStatus → Inactive)",
          'employee_id'   => $employee['id'],
          'employee_name' => $employee['fullname'],
          'old_status'    => $oldStatus,
          'new_status'    => 'Inactive',
        ];
      }

      if ($employee['status'] === 'Active') {
        return [
          'success' => true,
          'message' => "Employee {$employee['fullname']} already Active",
        ];
      }

      $oldStatus = $employee['status'];
      $now       = date('Y-m-d H:i:s');

      $upd = $userConn->prepare(
        "UPDATE employees SET status = 'Active', updated_at = :ts WHERE id = :id"
      );
      $upd->execute([':ts' => $now, ':id' => $employee['id']]);

      try {
        $hist = $userConn->prepare(
          "INSERT INTO status_history
       (employee_id, old_status, new_status, changed_by, change_reason, created_at)
     VALUES (:eid, :old, 'Active', :by, :reason, :ts)"
        );
        $hist->execute([
          ':eid'    => $employee['id'],
          ':old'    => $oldStatus,
          ':by'     => $_SESSION['username'] ?? 'System',
          ':reason' => 'Auto-enabled: Proximity code was re-enabled',
          ':ts'     => $now,
        ]);
      } catch (Exception $e) {
        error_log("status_history insert failed (syncEmployeeStatusWithCode enable): " . $e->getMessage());
      }

      logSystemAction(
        $this->userId,
        'EMPLOYEE_AUTO_ENABLED',
        "Employee {$employee['fullname']} set Active — proximity code re-enabled (QR: $qr_code)"
      );

      return [
        'success'       => true,
        'message'       => "Employee {$employee['fullname']} restored to Active ($oldStatus → Active)",
        'employee_id'   => $employee['id'],
        'employee_name' => $employee['fullname'],
        'old_status'    => $oldStatus,
        'new_status'    => 'Active',
      ];
    } catch (Exception $e) {
      error_log("syncEmployeeStatusWithCode error: " . $e->getMessage());
      return ['success' => false, 'message' => 'Sync error: ' . $e->getMessage()];
    }
  }

  public function deleteEmployee($id)
  {
    $employee = $this->getEmployee($id);

    $query = "DELETE FROM " . $this->table . " WHERE id = :id";
    $stmt  = $this->conn->prepare($query);
    $stmt->bindParam(':id', $id);
    $result = $stmt->execute();

    if ($result && $this->userId && $employee) {
      logSystemAction($this->userId, 'EMPLOYEE_DELETED', "Deleted employee: " . $employee['qr_code']);
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

  public function deleteAllEmployees()
  {
    try {
      $countQuery = "SELECT COUNT(*) as total FROM " . $this->table;
      $countStmt  = $this->conn->prepare($countQuery);
      $countStmt->execute();
      $count = $countStmt->fetch(PDO::FETCH_ASSOC)['total'];

      $query = "DELETE FROM " . $this->table;
      $stmt  = $this->conn->prepare($query);
      $result = $stmt->execute();

      if ($result) {
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

  public function deleteEmployeesByIds($employeeIds)
  {
    if (!is_array($employeeIds) || empty($employeeIds)) {
      return 0;
    }

    try {
      $placeholders = implode(',', array_fill(0, count($employeeIds), '?'));
      $query = "DELETE FROM " . $this->table . " WHERE id IN ($placeholders)";
      $stmt  = $this->conn->prepare($query);
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

  public function getProxcodeStats()
  {
    $stats = [];

    $query = "SELECT COUNT(*) as total FROM " . $this->table;
    $stmt  = $this->conn->prepare($query);
    $stmt->execute();
    $stats['total'] = $stmt->fetch(PDO::FETCH_ASSOC)['total'];

    return $stats;
  }
}

class FileUploader
{
  private $upload_dir;
  private $allowed_types = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  private $max_size = 5 * 1024 * 1024;
  private $userId;

  public function __construct($userId = null)
  {
    $this->userId     = $userId ?? $_SESSION['user_id'] ?? 'default';
    $this->upload_dir = '../../public/uploads/user/';

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

class QRCodeGenerator
{
  const QR_CODE_LENGTH = 41;

  public static function generateQRCode($userId = null, $length = self::QR_CODE_LENGTH)
  {
    $userId = $userId ?? $_SESSION['user_id'] ?? '0';
    $chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    $result          = '1' . $userId . '_';
    $remainingLength = $length - strlen($result) - 8;

    for ($i = 0; $i < $remainingLength; $i++) {
      $result .= $chars[rand(0, strlen($chars) - 1)];
    }

    $uniquePart = str_pad((time() % 100000000), 8, '0', STR_PAD_LEFT);
    $result    .= $uniquePart;

    return $result;
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

        $qr_code = !empty($_POST['qr_code'])
          ? sanitizeInput($_POST['qr_code'])
          : QRCodeGenerator::generateQRCode($database->getCurrentUserId());

        $employee_data = ['qr_code' => $qr_code];

        if (empty($employee_data['qr_code'])) {
          $response['message'] = 'Please fill in all required fields (Proximity code is required)';
          break;
        }

        $employee_id = $employeeManager->createEmployee($employee_data);

        if ($employee_id) {
          $response['success'] = true;
          $response['message'] = 'Proximity code created successfully';
          $response['data']    = ['id' => $employee_id, 'qr_code' => $qr_code];
        } else {
          $response['message'] = 'Failed to create proximity code. Please check your input data.';
        }
        break;

      case 'edit':
      case 'update':
        $employee_id      = $_POST['id'] ?? 0;
        $current_employee = $employeeManager->getEmployee($employee_id);

        if (!$current_employee) {
          $response['message'] = 'Proximity code not found';
          break;
        }

        $image_filename = $current_employee['image'] ?? null;

        if (isset($_FILES['image']) && $_FILES['image']['error'] === UPLOAD_ERR_OK) {
          try {
            $new_image = $fileUploader->uploadImage($_FILES['image']);

            if ($new_image && $current_employee['image']) {
              $fileUploader->deleteImage($current_employee['image']);
            }

            $image_filename = $new_image;
          } catch (Exception $e) {
            $response['message'] = $e->getMessage();
            break;
          }
        }

        $qr_code = !empty($_POST['qr_code'])
          ? sanitizeInput($_POST['qr_code'])
          : $current_employee['qr_code'];

        $employee_data = [
          'qr_code'   => $qr_code,
          'is_active' => isset($_POST['is_active']) ? (int)$_POST['is_active'] : 1,
        ];

        if ($employeeManager->updateEmployee($employee_id, $employee_data)) {
          $response['success'] = true;
          $response['message'] = 'Proximity code updated successfully';
        } else {
          $response['message'] = 'Failed to update proximity code';
        }
        break;

      case 'delete_filtered':
        try {
          $employee_ids_json = $_POST['employee_ids'] ?? '[]';
          $filters_json      = $_POST['filters']      ?? '{}';

          $raw_ids      = json_decode($employee_ids_json, true) ?: [];
          $filters      = json_decode($filters_json, true)      ?: [];
          $employee_ids = array_values(array_filter(array_map('intval', $raw_ids)));

          if (empty($employee_ids)) {
            $response['message'] = 'No employees to delete';
            break;
          }

          $db = $database->getUserConnection();
          $db->beginTransaction();

          $all_employees_to_delete = [];
          foreach ($employee_ids as $id) {
            $emp = $employeeManager->getEmployee($id);
            if ($emp && is_array($emp)) {
              $all_employees_to_delete[] = $emp;
            }
          }

          $deleted_count = $employeeManager->deleteEmployeesByIds($employee_ids);

          if ($deleted_count > 0) {
            $deleted_images = 0;
            foreach ($all_employees_to_delete as $employee) {
              if (!empty($employee['image']) && $fileUploader->deleteImage($employee['image'])) {
                $deleted_images++;
              }
            }

            $db->commit();

            $filterDescriptions = [];
            foreach ($filters as $key => $value) {
              $filterDescriptions[] = "$key: $value";
            }
            $filterStr = implode(', ', $filterDescriptions) ?: 'All';

            $response['success']        = true;
            $response['message']        = "Deleted $deleted_count code(s) matching filters: $filterStr.";
            $response['deleted_count']  = $deleted_count;
            $response['deleted_images'] = $deleted_images;

            logSystemAction($database->getCurrentUserId(), 'FILTERED_CODE_DELETED', "Deleted $deleted_count proximity codes with filters: $filterStr");
          } else {
            $db->rollBack();
            $response['message'] = 'Failed to delete proximity codes';
          }
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['message'] = 'Delete filtered error: ' . $e->getMessage();
        }
        break;

      case 'delete':
        $employee_id = $_POST['id'] ?? 0;
        $employee    = $employeeManager->getEmployee($employee_id);

        if ($employee && $employeeManager->deleteEmployee($employee_id)) {
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
          $all_employees = $employeeManager->getEmployees([]);

          $db = $database->getUserConnection();
          $db->beginTransaction();

          if ($employeeManager->deleteAllEmployees()) {
            $db->commit();

            $response['success'] = true;
            $response['message'] = 'All proximity code deleted successfully. ' . count($all_employees) . ' proximity codes removed.';
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

        $imported_count  = 0;
        $duplicate_count = 0;
        $errors          = [];

        try {
          $db = $database->getUserConnection();
          $db->beginTransaction();

          foreach ($employees_data as $index => $employee_data) {
            try {
              $qr_code = '';
              if (!empty($employee_data['qr_code']) && trim($employee_data['qr_code']) !== '') {
                $qr_code = trim($employee_data['qr_code']);
              } elseif (!empty($employee_data['qr']) && trim($employee_data['qr']) !== '') {
                $qr_code = trim($employee_data['qr']);
              } else {
                $qr_code = QRCodeGenerator::generateQRCode($database->getCurrentUserId());
              }

              if (empty($qr_code)) {
                $errors[] = "Row " . ($index + 1) . ": Could not generate proximity code";
                continue;
              }

              $existingEmployee = $employeeManager->getEmployeeByQR($qr_code);
              if ($existingEmployee) {
                $duplicate_count++;
                continue;
              }

              $employee_record = [
                'qr_code' => sanitizeInput(trim($employee_data['qr_code'] ?? $qr_code))
              ];

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
            $response['success']          = true;
            $response['message']          = "Import completed successfully. $imported_count proximity codes imported.";
            $response['imported_count']   = $imported_count;
            $response['duplicates_count'] = $duplicate_count;

            if ($duplicate_count > 0) {
              $response['message'] .= " $duplicate_count duplicate codes were skipped.";
            }

            if (!empty($errors)) {
              $response['message']  .= " " . count($errors) . " records had errors.";
              $response['errors']    = array_slice($errors, 0, 10);
              $response['warnings']  = array_slice($errors, 0, 5);
            }

            logSystemAction($database->getCurrentUserId(), 'DATA_IMPORTED', "Imported $imported_count proximity codes. $duplicate_count duplicates skipped.");
          } else {
            $db->rollBack();
            $response['message'] = 'Import failed. No valid proximity code records were processed.';
            $response['errors']  = $errors;
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
            if (!$employee['is_active']) {
              $response['success'] = false;
              $response['message'] = 'This proximity code is disabled';
              $response['disabled'] = true;
              break;
            }

            $response['success'] = true;
            $response['data']    = $employee;
            $response['message'] = 'Proximity code found';
            logSystemAction(
              $database->getCurrentUserId(),
              'PROXIMITY_SCAN',
              "Proximity scan for proximity code: " . $employee['qr_code']
            );
          } else {
            $response['message'] = 'No proximity code found with this code';
          }
        } catch (Exception $e) {
          $response['message'] = 'Proximity code search error: ' . $e->getMessage();
        }
        break;

      case 'toggle_status':
        $employee_id = $_POST['id'] ?? 0;

        if (!$employee_id) {
          $response['message'] = 'Proximity code ID is required';
          break;
        }

        $result = $employeeManager->toggleStatus($employee_id);

        if ($result) {
          $statusLabel = $result['is_active'] ? 'enabled' : 'disabled';
          $response['success'] = true;
          $response['message'] = "Proximity code {$statusLabel} successfully";

          $response['message'] .= $result['is_active']
            ? " (Employee auto-enabled → Active)"
            : " (Employee auto-disabled → Inactive)";
          $response['employee_synced'] = true;

          $response['data'] = $result;
          $response['is_active'] = (int)$result['is_active'];
        } else {
          $response['message'] = 'Failed to toggle proximity code status';
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

        unset($filters['remarks']);

        if (!empty($_GET['qr_code'])) $filters['qr_code'] = sanitizeInput($_GET['qr_code']);
        if (isset($_GET['is_active']) && $_GET['is_active'] !== '') {$filters['is_active'] = (int)$_GET['is_active'];}
        if (!empty($_GET['created_at'])) {
          $d = $_GET['created_at'];
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['created_at'] = $d;
        }
        if (!empty($_GET['date_from'])) {
          $d = $_GET['date_from'];
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['date_from'] = $d;
        }
        if (!empty($_GET['date_to'])) {
          $d = $_GET['date_to'];
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['date_to'] = $d;
        }
        if (!empty($_GET['updated_at'])) {
          $filters['updated_at'] = $_GET['updated_at'];
        } elseif (!empty($_GET['updated_from']) && !empty($_GET['updated_to'])) {
          $filters['updated_from'] = $_GET['updated_from'];
          $filters['updated_to']   = $_GET['updated_to'];
        }

        try {
          $employees           = $employeeManager->getEmployees($filters);
          $response['success'] = true;
          $response['data']    = $employees;
          $response['total']   = count($employees);
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving proximity codes.';
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
          $stats               = $employeeManager->getProxcodeStats();
          $response['success'] = true;
          $response['data']    = $stats;
        } catch (Exception $e) {
          $response['message'] = 'Error getting statistics: ' . $e->getMessage();
        }
        break;

      case 'user_info':
        $response['success'] = true;
        $response['data']    = [
          'user_id'    => $database->getCurrentUserId(),
          'username'   => $_SESSION['username']   ?? 'Unknown',
          'email'      => $_SESSION['email']       ?? '',
          'first_name' => $_SESSION['first_name']  ?? '',
          'last_name'  => $_SESSION['last_name']   ?? '',
        ];
        break;

      case 'sync_orphans':
        try {
          $userConn = $database->getUserConnection();

          $stmtMissing = $userConn->prepare(
            "SELECT e.id, e.fullname, e.status, e.qr_code
             FROM employees e
             WHERE e.qr_code IS NOT NULL
               AND TRIM(e.qr_code) <> ''
               AND e.status <> 'Inactive'
               AND NOT EXISTS (
                 SELECT 1
                 FROM code c
                 WHERE LOWER(TRIM(c.qr_code)) = LOWER(TRIM(e.qr_code))
               )"
          );
          $stmtMissing->execute();
          $missing = $stmtMissing->fetchAll(PDO::FETCH_ASSOC);

          $stmtDisabled = $userConn->prepare(
            "SELECT e.id, e.fullname, e.status, e.qr_code
             FROM employees e
             INNER JOIN code c
               ON LOWER(TRIM(c.qr_code)) = LOWER(TRIM(e.qr_code))
             WHERE c.is_active = 0
               AND e.status <> 'Inactive'"
          );
          $stmtDisabled->execute();
          $disabled = $stmtDisabled->fetchAll(PDO::FETCH_ASSOC);

          $seen       = [];
          $toProcess  = [];
          foreach (array_merge($missing, $disabled) as $row) {
            if (!isset($seen[$row['id']])) {
              $seen[$row['id']] = true;
              $toProcess[]      = $row;
            }
          }

          $synced  = 0;
          $details = [];
          $now     = date('Y-m-d H:i:s');

          foreach ($toProcess as $emp) {
            $updStmt = $userConn->prepare(
              "UPDATE employees
               SET status = 'Inactive', updated_at = :ts
               WHERE id = :id AND status <> 'Inactive'"
            );
            $updStmt->execute([':ts' => $now, ':id' => $emp['id']]);

            if ($updStmt->rowCount() > 0) {
              $isMissing = !in_array(
                $emp['id'],
                array_column($disabled, 'id'),
                true
              );
              $reason = $isMissing
                ? 'Auto-disabled: Proximity code not registered in code table'
                : 'Auto-disabled: Proximity code is disabled';

              try {
                $histStmt = $userConn->prepare(
                  "INSERT INTO status_history
                     (employee_id, old_status, new_status, changed_by, change_reason, created_at)
                   VALUES (:eid, :old, 'Inactive', :by, :reason, :ts)"
                );
                $histStmt->execute([
                  ':eid'    => $emp['id'],
                  ':old'    => $emp['status'],
                  ':by'     => $_SESSION['username'] ?? 'System',
                  ':reason' => $reason,
                  ':ts'     => $now,
                ]);
              } catch (Exception $e) {
                error_log("status_history insert failed (sync_orphans): " . $e->getMessage());
              }

              logSystemAction(
                $database->getCurrentUserId(),
                'EMPLOYEE_ORPHAN_SYNCED',
                "Employee {$emp['fullname']} → Inactive — $reason (QR: {$emp['qr_code']})"
              );

              $details[] = [
                'employee_id'  => $emp['id'],
                'fullname'     => $emp['fullname'],
                'qr_code'      => $emp['qr_code'],
                'old_status'   => $emp['status'],
                'new_status'   => 'Inactive',
                'reason'       => $reason,
              ];
              $synced++;
            }
          }

          $stmtRestore = $userConn->prepare(
            "SELECT e.id, e.fullname, e.status, e.qr_code
              FROM employees e
              INNER JOIN code c
                ON LOWER(TRIM(c.qr_code)) = LOWER(TRIM(e.qr_code))
              WHERE c.is_active = 1
                AND e.status = 'Inactive'"
          );
          $stmtRestore->execute();
          $toRestore = $stmtRestore->fetchAll(PDO::FETCH_ASSOC);

          foreach ($toRestore as $emp) {
            $histStmt = $userConn->prepare(
              "SELECT change_reason FROM status_history
                WHERE employee_id = :id
                ORDER BY created_at DESC LIMIT 1"
            );
            $histStmt->execute([':id' => $emp['id']]);
            $lastReason = $histStmt->fetchColumn();

            if (!$lastReason || strpos($lastReason, 'Auto-disabled') === false) {
              continue;
            }

            $updStmt = $userConn->prepare(
              "UPDATE employees SET status = 'Active', updated_at = :ts WHERE id = :id AND status = 'Inactive'"
            );
            $updStmt->execute([':ts' => $now, ':id' => $emp['id']]);

            if ($updStmt->rowCount() > 0) {
              try {
                $histInsert = $userConn->prepare(
                  "INSERT INTO status_history
           (employee_id, old_status, new_status, changed_by, change_reason, created_at)
         VALUES (:eid, 'Inactive', 'Active', :by, :reason, :ts)"
                );
                $histInsert->execute([
                  ':eid'    => $emp['id'],
                  ':by'     => $_SESSION['username'] ?? 'System',
                  ':reason' => 'Auto-enabled: Proximity code is active and registered',
                  ':ts'     => $now,
                ]);
              } catch (Exception $e) {
                error_log("status_history insert failed (sync_orphans restore): " . $e->getMessage());
              }

              logSystemAction(
                $database->getCurrentUserId(),
                'EMPLOYEE_ORPHAN_RESTORED',
                "Employee {$emp['fullname']} → Active — code re-enabled (QR: {$emp['qr_code']})"
              );

              $details[] = [
                'employee_id'  => $emp['id'],
                'fullname'     => $emp['fullname'],
                'qr_code'      => $emp['qr_code'],
                'old_status'   => 'Inactive',
                'new_status'   => 'Active',
                'reason'       => 'Auto-enabled: code exists and is active',
              ];
              $synced++;
            }
          }

          $response['success']      = true;
          $response['synced_count'] = $synced;
          $response['details']      = $details;
          $response['message']      = $synced > 0
            ? "Synced $synced employee(s) to Inactive."
            : "All employees are in sync — no changes needed.";
        } catch (Exception $e) {
          $response['message'] = 'sync_orphans error: ' . $e->getMessage();
          error_log("sync_orphans error: " . $e->getMessage());
        }
        break;

      default:
        $response['message'] = 'Invalid GET action specified: ' . htmlspecialchars($action);
        break;
    }
  } else {
    $response['message'] = 'Invalid request method. Use GET or POST.';
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
  $error_response = [
    'success' => false,
    'message' => 'System error: ' . $e->getMessage()
  ];

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

function getAPIInfo()
{
  return [
    'version'     => '2.2',
    'name'        => 'Proximity Management System',
    'description' => 'Multi-user proximity management system with user-specific databases',
    'features'    => [
      'Transaction Support' => 'Database transactions for critical operations',
      'Audit Logging'       => 'Complete audit trail of all operations',
      'Filtered Delete'     => 'Delete employees based on active search filters',
    ],
    'endpoints' => [
      'POST' => [
        'add/create'     => 'Create new proximity code',
        'edit/update'    => 'Update existing proximity code',
        'delete'         => 'Delete proximity code',
        'delete_all'     => 'Delete all proximity codes',
        'search_qr'      => 'Search proximity code by Proximity code',
      ],
      'GET' => [
        'get/list'   => 'Get proximity codes with optional filters',
        'get_single' => 'Get single proximity code by ID',
        'check_qr'   => 'Check if Proximity code exists',
        'stats'      => 'Get proximity code statistics',
        'user_info'  => 'Get current user information',
      ],
    ],
    'authentication' => 'Session-based (user must be logged in)',
    'database'       => 'User-specific databases',
  ];
}

if (isset($_GET['api_info'])) {
  header('Content-Type: application/json');
  echo json_encode(getAPIInfo(), JSON_PRETTY_PRINT);
  exit;
}

if (isset($_GET['health_check'])) {
  $health = [
    'status'             => 'OK',
    'timestamp'          => date('Y-m-d H:i:s'),
    'timezone'           => date_default_timezone_get(),
    'user_authenticated' => isset($_SESSION['user_id']),
    'user_id'            => $_SESSION['user_id'] ?? null,
  ];

  try {
    $database = new Database();
    $database->getMainConnection();
    $database->getUserConnection();
    $health['user_database'] = 'OK';
  } catch (Exception $e) {
    $health['status']        = 'ERROR';
    $health['user_database'] = 'ERROR: ' . $e->getMessage();
  }

  header('Content-Type: application/json');
  echo json_encode($health, JSON_PRETTY_PRINT);
  exit;
}
