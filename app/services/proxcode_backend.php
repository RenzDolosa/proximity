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

// ── Whitelists ────────────────────────────────────────────────────────────────
const ALLOWED_POST_ACTIONS = [
  'add',
  'create',
  'edit',
  'update',
  'delete',
  'delete_filtered',
  'delete_all',
  'import',
  'search_qr',
  'toggle_status',
  'reserve_code',
  'release_code',
  'restore_data',
];

const ALLOWED_GET_ACTIONS = [
  'get',
  'list',
  'get_single',
  'check_qr',
  'stats',
  'user_info',
  'sync_orphans',
  'health_check',
];

const RESERVATION_TTL_SECONDS = 300;

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

// ─────────────────────────────────────────────────────────────────────────────
// Database — connection manager
// ─────────────────────────────────────────────────────────────────────────────
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

  public function getEmployees($filters = [], $page = null, $limit = 25)
  {
    $where  = "WHERE 1=1";
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

    // ── Remarks filter (Occupied / Available) ──────────────────────────
    if (!empty($filters['remarks'])) {
      $manpowerDb = DB_NAME . '.employees';
      if ($filters['remarks'] === 'Occupied') {
        $where .= " AND EXISTS (SELECT 1 FROM {$manpowerDb} e WHERE LOWER(TRIM(e.qr_code)) = LOWER(TRIM({$this->table}.qr_code)))";
      } elseif ($filters['remarks'] === 'Available') {
        $where .= " AND NOT EXISTS (SELECT 1 FROM {$manpowerDb} e WHERE LOWER(TRIM(e.qr_code)) = LOWER(TRIM({$this->table}.qr_code)))";
      }
    }

    // ── Build ORDER BY ────────────────────────────────────────────────
    $client_only_cols   = ['remarks'];
    $allowed_sort_cols  = ['status', 'created_at', 'updated_at'];

    $raw_sort = $filters['sort_col'] ?? '';
    $sort_col = in_array($raw_sort, $client_only_cols, true)
      ? 'created_at'
      : (in_array($raw_sort, $allowed_sort_cols, true) ? $raw_sort : 'created_at');

    $sort_dir = (isset($filters['sort_dir']) && strtolower($filters['sort_dir']) === 'asc')
      ? 'ASC' : 'DESC';

    $sql_col = $sort_col === 'status' ? 'is_active' : $sort_col;

    $order = "ORDER BY {$sql_col} {$sort_dir}";

    if ($page === null) {
      $stmt = $this->conn->prepare(
        "SELECT * FROM {$this->table} {$where} {$order}"
      );
      foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
      }
      $stmt->execute();
      return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    $countStmt = $this->conn->prepare(
      "SELECT COUNT(*) FROM {$this->table} {$where}"
    );
    foreach ($params as $key => $value) {
      $countStmt->bindValue($key, $value);
    }
    $countStmt->execute();
    $total = (int) $countStmt->fetchColumn();

    $offset = ($page - 1) * $limit;
    $dataStmt = $this->conn->prepare(
      "SELECT * FROM {$this->table} {$where} {$order} LIMIT :limit OFFSET :offset"
    );
    foreach ($params as $key => $value) {
      $dataStmt->bindValue($key, $value);
    }
    $dataStmt->bindValue(':limit',  $limit,  PDO::PARAM_INT);
    $dataStmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $dataStmt->execute();

    return [
      'data'  => $dataStmt->fetchAll(PDO::FETCH_ASSOC),
      'total' => $total,
    ];
  }

  public function updateEmployee($id, $data)
  {
    $current = $this->getEmployee($id);

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

    if ($result && $current) {
      $oldIsActive = (int)$current['is_active'];
      $newIsActive = isset($data['is_active']) ? (int)$data['is_active'] : 1;

      if ($oldIsActive !== $newIsActive || $current['qr_code'] !== $data['qr_code']) {
        $this->syncEmployeeStatusWithCode($data['qr_code'], $newIsActive);
      }
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
          'message' => "No employee assigned to Proximity code: $qr_code — nothing to sync",
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
    $manpowerDb = DB_NAME . '.employees';

    $stmt = $this->conn->prepare("SELECT COUNT(*) as total FROM " . $this->table);
    $stmt->execute();
    $stats['total'] = (int)$stmt->fetch(PDO::FETCH_ASSOC)['total'];

    $stmt = $this->conn->prepare(
      "SELECT COUNT(*) as cnt FROM {$this->table}
     WHERE EXISTS (
       SELECT 1 FROM {$manpowerDb} e
       WHERE LOWER(TRIM(e.qr_code)) = LOWER(TRIM({$this->table}.qr_code))
     )"
    );
    $stmt->execute();
    $stats['occupied'] = (int)$stmt->fetch(PDO::FETCH_ASSOC)['cnt'];

    $stats['available'] = $stats['total'] - $stats['occupied'];

    return $stats;
  }

  public function clearStaleReservations()
  {
    $staleCutoff = date('Y-m-d H:i:s', time() - RESERVATION_TTL_SECONDS);
    $stmt = $this->conn->prepare(
      "UPDATE " . $this->table . "
       SET reserved_by = NULL, reserved_at = NULL
       WHERE reserved_at IS NOT NULL AND reserved_at < :stale"
    );
    $stmt->execute([':stale' => $staleCutoff]);
  }

  public function reserveCode($qr_code, $reservedBy)
  {
    $this->clearStaleReservations();

    $stmt = $this->conn->prepare(
      "UPDATE " . $this->table . "
       SET reserved_by = :reserved_by, reserved_at = :now
       WHERE qr_code = :qr_code
         AND is_active = 1
         AND (reserved_by IS NULL OR reserved_by = :reserved_by_check)"
    );
    $stmt->execute([
      ':reserved_by'       => $reservedBy,
      ':now'               => date('Y-m-d H:i:s'),
      ':qr_code'           => $qr_code,
      ':reserved_by_check' => $reservedBy,
    ]);

    return $stmt->rowCount() > 0;
  }

  public function releaseCode($qr_code, $reservedBy)
  {
    $stmt = $this->conn->prepare(
      "UPDATE " . $this->table . "
       SET reserved_by = NULL, reserved_at = NULL
       WHERE qr_code = :qr_code AND reserved_by = :reserved_by"
    );
    $stmt->execute([':qr_code' => $qr_code, ':reserved_by' => $reservedBy]);

    return $stmt->rowCount() > 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FileUploader — only used here for serving/deleting images referenced in logs
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeFilename($filename)
{
  return preg_replace('/[^a-zA-Z0-9_\.-]/', '', $filename);
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

    header('Location:', ROUTE_LOGIN);
    exit;
  }

  $database         = new Database();
  $employeeManager  = new EmployeeManager($database);
  $reservationKey   = $database->getCurrentUserId() . '_' . session_id();
  $fileUploader     = new FileUploader($database->getCurrentUserId());

  $response = ['success' => false, 'message' => '', 'data' => null];

  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = sanitizeInput($_POST['action'] ?? '');

    if (!in_array($action, ALLOWED_POST_ACTIONS, true)) {
      $response['message'] = 'Invalid action specified.';
      goto send_response;
    }

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
        $employee_id      = sanitizeInput($_POST['id'] ?? 0);
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

      case 'delete':
        $employee_id = sanitizeInput($_POST['id'] ?? 0);
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

      case 'delete_filtered':
        try {
          $raw_ids      = safeJsonDecode($_POST['employee_ids'] ?? '[]') ?: [];
          $filters      = safeJsonDecode($_POST['filters']      ?? '{}') ?: [];
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
              $filterDescriptions[] = sanitizeInput($key) . ': ' . sanitizeInput($value);
            }
            $filterStr = implode(', ', $filterDescriptions) ?: 'All';

            $response['success']        = true;
            $response['message']        = "Deleted $deleted_count code(s) matching filters: $filterStr.";
            $response['deleted_count']  = $deleted_count;
            $response['deleted_images'] = $deleted_images;

            logSystemAction(
              $database->getCurrentUserId(),
              'FILTERED_CODE_DELETED',
              "Deleted $deleted_count proximity codes with filters: $filterStr");
          } else {
            $db->rollBack();
            $response['message'] = 'Failed to delete proximity codes';
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

        $employees_data = safeJsonDecode($employees_json);

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
        $qr_code = sanitizeInput($_POST['qr_code'] ?? '');

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
        $employee_id = sanitizeInput($_POST['id'] ?? 0);

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

      case 'reserve_code':
        $qr_code = sanitizeInput($_POST['qr_code'] ?? '');

        if (empty($qr_code)) {
          $response['message'] = 'Proximity code is required';
          break;
        }

        $reserved = $employeeManager->reserveCode($qr_code, $reservationKey);

        $response['success'] = $reserved;
        $response['message'] = $reserved
          ? 'Code reserved'
          : 'This code was just taken by another user';
        break;

      case 'release_code':
        $qr_code = sanitizeInput($_POST['qr_code'] ?? '');

        if (!empty($qr_code)) {
          $employeeManager->releaseCode($qr_code, $reservationKey);
        }

        $response['success'] = true;
        break;
    }

    // ── GET handler ──────────────────────────────────────────────────────────
  } elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = sanitizeInput($_GET['action'] ?? '');

    if (!empty($action) && !in_array($action, ALLOWED_GET_ACTIONS, true)) {
      $response['message'] = 'Invalid GET action.';
      goto send_response;
    }

    switch ($action) {
      case 'get':
      case 'list':
        $employeeManager->clearStaleReservations();
        $filters = [];

        if (!empty($_GET['qr_code'])) $filters['qr_code'] = sanitizeInput($_GET['qr_code']);
        if (isset($_GET['is_active']) && $_GET['is_active'] !== '') {
          $filters['is_active'] = sanitizeInput((int)$_GET['is_active']);
        }
        if (!empty($_GET['remarks']) && in_array($_GET['remarks'], ['Occupied', 'Available'], true)) {
          $filters['remarks'] = sanitizeInput($_GET['remarks']);
        }
        if (!empty($_GET['created_at'])) {
          $d = sanitizeInput($_GET['created_at']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['created_at'] = $d;
        }
        if (!empty($_GET['date_from'])) {
          $d = sanitizeInput($_GET['date_from']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['date_from'] = $d;
        }
        if (!empty($_GET['date_to'])) {
          $d = sanitizeInput($_GET['date_to']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['date_to'] = $d;
        }
        if (!empty($_GET['updated_at'])) {
          $d = sanitizeInput($_GET['updated_at']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['updated_at'] = $d;
        }
        if (!empty($_GET['sort_col'])) $filters['sort_col'] = sanitizeInput($_GET['sort_col']);
        if (!empty($_GET['sort_dir'])) $filters['sort_dir'] = sanitizeInput($_GET['sort_dir']);

        $page  = max(1, (int)($_GET['page']  ?? 1));
        $limit = max(1, (int)($_GET['limit'] ?? 25));

        try {
          $result   = $employeeManager->getEmployees($filters, $page, $limit);
          $allRows  = $employeeManager->getEmployees($filters, null);

          $filterableFields = ['remarks', 'status'];
          $fieldOptions = [];
          foreach ($filterableFields as $field) {
            $fieldFilters = $filters;
            unset($fieldFilters[$field], $fieldFilters["{$field}_none"]);
            if ($field === 'status') {
              unset($fieldFilters['is_active']);
            }
            $fieldOptions[$field] = $employeeManager->getEmployees($fieldFilters, null);
          }

          $response['success']              = true;
          $response['data']                 = $result['data'];
          $response['total']                = $result['total'];
          $response['page']                 = $page;
          $response['pages']                = ceil($result['total'] / $limit);
          $response['filter_options']       = $allRows;
          $response['field_filter_options'] = $fieldOptions;
          $response['reservation_key']      = $reservationKey;
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving proximity codes.';
        }
        break;

      case 'get_single':
        $employee_id = sanitizeInput($_GET['id'] ?? 0);

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
        $qr_code = sanitizeInput($_GET['qr_code'] ?? '');

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
          'username'   => sanitizeInput($_SESSION['username']    ?? 'Unknown'),
          'email'      => sanitizeInput($_SESSION['email']       ?? ''),
          'first_name' => sanitizeInput($_SESSION['first_name']  ?? ''),
          'last_name'  => sanitizeInput($_SESSION['last_name']   ?? ''),
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

            $isAutoInactive = $lastReason && (
              strpos($lastReason, 'Auto-disabled') !== false ||
              strpos($lastReason, 'Auto-set Inactive') !== false
            );

            if (!$isAutoInactive) {
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
      
      case 'health_check':
        $health = [
          'status'              => 'OK',
          'timestamp'           => date('Y-m-d H:i:s'),
          'timezone'            => date_default_timezone_get(),
          'user_authenticated'  => isset($_SESSION['user_id']),
          'user_id'             => sanitizeInput($_SESSION['user_id'] ?? ''),
        ];

        try {
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

      default:
        $response['message'] = 'Invalid GET action: ' . $action;
        break;
    }
  } 
  
  send_response:

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

  error_log("Proximity System Error: " . $e->getMessage());

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
    'webp' => 'image/webp',
    'pdf'  => 'application/pdf',
    'csv'  => 'text/csv',
    'xls'  => 'application/vnd.ms-excel',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  $content_type = $content_types[$file_extension] ?? 'application/octet-stream';
  $image_types  = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

  if (in_array($file_extension, $image_types)) {
    header('Content-Disposition: inline; filename="' . $filename . '"');
    header('Cache-Control: public, max-age=31536000, immutable');
    header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 31536000) . ' GMT');
  } else {
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Cache-Control: no-cache, must-revalidate');
    header('Expires: 0');
  }

  header('Content-Type: ' . $content_type);
  header('Content-Length: ' . filesize($filepath));
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
  $filename     = sanitizeFilename(basename($_GET['serve_file']));
  $filepath     = $fileUploader->getImagePath($filename);

  serveFile($filepath, $filename);
}

function getAPIInfo()
{
  return [
    'version'     => '2.6',
    'name'        => 'Proximity Code Management System',
    'description' => 'CRUD for the code table; toggling a code\'s is_active syncs the linked employee\'s status automatically',
    'features'    => [
      'Transaction Support'     => 'Database transactions on filtered delete and delete-all',
      'Audit Logging'           => 'Full audit trail via logSystemAction() on every mutating operation',
      'Filtered Delete'         => 'Delete codes by explicit ID list derived from active search filters',
      'Status Auto-Sync'        => 'toggle_status and update write to status_history and flip employee.status via syncEmployeeStatusWithCode()',
      'Orphan Sync'             => 'sync_orphans GET action sets employees Inactive when their Proximity is missing/disabled; restores Active when re-enabled',
      'Code Reservation'        => 'Time-limited (300 s TTL) reserve_code / release_code prevent concurrent assignment; stale reservations cleared on each list request',
      'Remarks Filter'          => 'Occupied / Available filter resolved server-side by EXISTS check against the employees table',
      'Import'                  => 'Bulk-import array of proximity strings; duplicate codes are skipped',
    ],
    'endpoints' => [
      'POST' => [
        'add / create'          => 'Create a proximity code entry; defaults to enabled',
        'edit / update'         => 'Update proximity and/or is_active; triggers syncEmployeeStatusWithCode()',
        'delete'                => 'Delete a single code row',
        'delete_filtered'       => 'Delete codes by explicit ID list',
        'delete_all'            => 'Delete all code rows; resets AUTO_INCREMENT',
        'import'                => 'Bulk-import array of proximity objects; skips duplicates',
        'toggle_status'         => 'Flip is_active for a code and sync the linked employee\'s status',
        'reserve_code'          => 'Mark a code as reserved by the current session (300 s TTL)',
        'release_code'          => 'Release the current session\'s reservation on a code',
        'search_qr'             => 'Find an active code by exact proximity value',
        'restore_data'          => '(declared in ALLOWED_POST_ACTIONS; handler not yet implemented)',
      ],
      'GET' => [
        'get / list'            => 'Paginated code list with filters, sort, Occupied/Available remarks, reservation_key, and field_filter_options',
        'get_single'            => 'Fetch one code row by id',
        'check_qr'              => 'Check whether a proximity is already assigned to an employee',
        'stats'                 => 'Return total, occupied, and available counts',
        'sync_orphans'          => 'Reconcile employee statuses against the code table (disable orphans, restore re-enabled)',
        'user_info'             => 'Return session user_id, username, email, first_name, last_name',
        'health_check'          => 'Verify main DB and user DB connectivity; returns JSON (bypasses XHR check)',
      ],
    ],
    'query_parameters' => [
      'Filters'                 => 'proximity, status (Enabled|Disabled), remarks (Occupied|Available), created_at, date_from, date_to, updated_at',
      'Sorting'                 => 'sort_col (status|created_at|updated_at — "remarks" falls back to created_at), sort_dir (asc|desc)',
      'Paging'                  => 'page (default 1), limit (default 25)',
    ],
    'authentication'            => 'Session-based ($_SESSION[user_id] required for every request)',
    'database'                  => 'Per-user databases; cross-DB EXISTS query references DB_NAME.employees for Occupied/Available',
  ];
}

if (isset($_GET['api_info'])) {
  header('Content-Type: application/json');
  echo json_encode(getAPIInfo(), JSON_PRETTY_PRINT);
  exit;
}
