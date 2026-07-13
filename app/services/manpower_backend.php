<?php
// app/services/manpower_backend.php --> system table backend

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
  /**
   * Sanitize input for safe output.
   *
   * @param mixed $input
   * @return string
   */
  function sanitizeInput($input): string
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

// ── QR scanner cache invalidation ─────────────────────────────────────────────
function invalidateQrEmployeeCache(): void
{
  if (file_exists(QR_EMP_CACHE_FILE)) @unlink(QR_EMP_CACHE_FILE);
}

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
  'get_stats',
  'bulk_status_update',
  'search_qr',
  'restore_data',
  'backup_data',
];

const ALLOWED_GET_ACTIONS = [
  'get',
  'list',
  'get_single',
  'get_access_logs',
  'check_qr',
  'stats',
  'user_info',
  'get_violations',
  'get_status_history',
  'get_statuses',
  'health_check',
];

const ALLOWED_STATUSES   = ['Active', 'Inactive'];
const ALLOWED_SHIFTS     = ['Day Shift', 'Night Shift', 'Graveyard Shift'];
const ALLOWED_RESTORE    = ['replace', 'merge'];
const MAX_BULK_DELETE    = 5000;
const MAX_IMPORT_ROWS    = 2000;

// ── MIME-type validation helper ───────────────────────────────────────────────
function validateImageMime(string $tmpPath): bool
{
  $allowed_mimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

  if (function_exists('finfo_open')) {
    $finfo = finfo_open(FILEINFO_MIME_TYPE);
    $mime  = finfo_file($finfo, $tmpPath);
    finfo_close($finfo);
  } elseif (function_exists('mime_content_type')) {
    $mime = mime_content_type($tmpPath);
  } else {
    $info = @getimagesize($tmpPath);
    $mime = $info ? $info['mime'] : '';
  }

  return in_array($mime, $allowed_mimes, true);
}

// ── Safe json_decode wrapper ──────────────────────────────────────────────────
function safeJsonDecode(string $json, bool $assoc = true, int $depth = 32)
{
  if (!is_string($json) || $json === '') return null;
  try {
    return json_decode($json, $assoc, $depth, JSON_THROW_ON_ERROR);
  } catch (JsonException $e) {
    error_log("safeJsonDecode error: " . $e->getMessage());
    return null;
  }
}

function syncStatusByQR(PDO $conn, int $employeeId, string $qrCode, string $changedBy = 'System'): string
{
  $qrTrimmed = trim((string)$qrCode);

  if ($qrTrimmed === '') {
    $newStatus = 'Inactive';
  } else {
    $stmt = $conn->prepare(
      "SELECT is_active FROM code
       WHERE LOWER(TRIM(qr_code)) = LOWER(TRIM(:qr))
       LIMIT 1"
    );
    $stmt->execute([':qr' => $qrTrimmed]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    $newStatus = ($row && (int)$row['is_active'] === 1) ? 'Active' : 'Inactive';
  }

  $now = date('Y-m-d H:i:s');

  $cur = $conn->prepare("SELECT status FROM employees WHERE id = :id");
  $cur->execute([':id' => $employeeId]);
  $oldStatus = $cur->fetchColumn() ?: 'Active';

  if ($oldStatus !== $newStatus) {
    $upd = $conn->prepare(
      "UPDATE employees SET status = :status, updated_at = :ts WHERE id = :id"
    );
    $upd->execute([':status' => $newStatus, ':ts' => $now, ':id' => $employeeId]);

    try {
      $hist = $conn->prepare(
        "INSERT INTO status_history
           (employee_id, old_status, new_status, changed_by, change_reason, created_at)
         VALUES (:eid, :old, :new, :by, :reason, :ts)"
      );
      $hist->execute([
        ':eid'    => $employeeId,
        ':old'    => $oldStatus,
        ':new'    => $newStatus,
        ':by'     => $changedBy,
        ':reason' => $newStatus === 'Active'
          ? 'Auto-enabled: QR code is registered and enabled'
          : 'Auto-disabled: QR code is missing or disabled',
        ':ts'     => $now,
      ]);
    } catch (Exception $e) {
      error_log("syncStatusByQR – status_history insert failed: " . $e->getMessage());
    }
  }

  return $newStatus;
}

function clearCodeReservation(PDO $conn, string $qrCode)
{
  $qrCode = trim((string)$qrCode);
  if ($qrCode === '') return;

  try {
    $stmt = $conn->prepare(
      "UPDATE code SET reserved_by = NULL, reserved_at = NULL WHERE qr_code = :qr"
    );
    $stmt->execute([':qr' => $qrCode]);
  } catch (Exception $e) {
    error_log("clearCodeReservation failed: " . $e->getMessage());
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
  private ?PDO $mainConn = null;
  private ?PDO $userConn = null;
  private ?int $currentUserId = null;

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
  private ?PDO $conn = null;
  private string $table = 'employees';
  private ?int $userId = null;

  public function __construct(Database|PDO $db)
  {
    if ($db instanceof Database) {
      $this->conn   = $db->getUserConnection();
      $this->userId = $db->getCurrentUserId();
    } else {
      $this->conn   = $db;
      $this->userId = $_SESSION['user_id'] ?? null;
    }
  }

  public function createEmployee(array $data): mixed
  {
    $query = "INSERT INTO " . $this->table . "
            (id, fullname, position, brand, gender, birth, hired, status, shift, violation, image, qr_code, user_id)
            VALUES (:id, :fullname, :position, :brand, :gender, :birth, :hired, :status, :shift, :violation, :image, :qr_code, :user_id)";

    $stmt = $this->conn->prepare($query);
    $stmt->bindParam(':user_id',   $data['user_id']);
    $stmt->bindParam(':id',        $data['id']);
    $stmt->bindParam(':fullname',  $data['fullname']);
    $stmt->bindParam(':position',  $data['position']);
    $stmt->bindParam(':brand',     $data['brand']);
    $stmt->bindParam(':gender',    $data['gender']);
    $stmt->bindParam(':birth',     $data['birth']);
    $stmt->bindParam(':hired',     $data['hired']);
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

  public function getEmployees($filters = [], $page = 1, $limit = 25)
  {
    $where  = "WHERE 1=1";
    $params = [];

    if (!empty($filters['user_id'])) {
      $where .= " AND user_id LIKE :user_id";
      $params[':user_id']    = '%' . $filters['user_id'] . '%';
    }
    if (!empty($filters['id'])) {
      $where .= " AND id = :id";
      $params[':id']     = $filters['id'];
    }
    if (!empty($filters['fullname'])) {
      $where .= " AND fullname LIKE :fullname";
      $params[':fullname']   = '%' . $filters['fullname'] . '%';
    }
    if (!empty($filters['position'])) {
      $where .= " AND position LIKE :position";
      $params[':position']   = $filters['position'];
    }
    if (!empty($filters['position_none'])) {
      $where .= " AND (position IS NULL OR TRIM(position) = '' OR LOWER(TRIM(position)) = 'none')";
    }
    if (!empty($filters['brand'])) {
      $where .= " AND brand LIKE :brand";
      $params[':brand']      = $filters['brand'];
    }
    if (!empty($filters['brand_none'])) {
      $where .= " AND (brand IS NULL OR TRIM(brand) = '' OR LOWER(TRIM(brand)) = 'none')";
    }
    if (!empty($filters['status'])) {
      $where .= " AND status = :status";
      $params[':status']     = $filters['status'];
    }
    if (!empty($filters['status_none'])) {
      $where .= " AND (status IS NULL OR TRIM(status) = '' OR LOWER(TRIM(status)) = 'none')";
    }
    if (!empty($filters['shift'])) {
      $where .= " AND shift = :shift";
      $params[':shift']     = $filters['shift'];
    }
    if (!empty($filters['shift_none'])) {
      $where .= " AND (shift IS NULL OR TRIM(shift) = '' OR LOWER(TRIM(shift)) = 'none')";
    }
    if (!empty($filters['violation'])) {
      $where .= " AND violation LIKE :violation";
      $params[':violation']  = '%' . $filters['violation'] . '%';
    }
    if (!empty($filters['violation_none'])) {
      $where .= " AND (violation IS NULL OR TRIM(violation) = '' OR LOWER(TRIM(violation)) = 'none')";
    }
    if (!empty($filters['qr_code'])) {
      $where .= " AND qr_code = :qr_code";
      $params[':qr_code']     = $filters['qr_code'];
    }
    if (!empty($filters['created_at'])) {
      $where .= " AND DATE(created_at) = :created_at";
      $params[':created_at'] = $filters['created_at'];
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
      $where .= " AND DATE(updated_at) = :updated_at";
      $params[':updated_at'] = $filters['updated_at'];
    }

    // ── Build ORDER BY ────────────────────────────────────────────────
    $allowed_sort_cols = ['id', 'fullname', 'brand', 'shift', 'violation', 'created_at', 'updated_at'];
    $sort_col = (isset($filters['sort_col']) && in_array($filters['sort_col'], $allowed_sort_cols, true))
      ? $filters['sort_col'] : 'created_at';
    $sort_dir = (isset($filters['sort_dir']) && strtolower($filters['sort_dir']) === 'asc')
      ? 'ASC' : 'DESC';
    $order = "ORDER BY e.{$sort_col} {$sort_dir}";

    if ($page === null) {
      $stmt = $this->conn->prepare(
        "SELECT e.*,
                (SELECT COUNT(*) FROM violations v WHERE v.employee_id = e.id) AS violation_count
            FROM {$this->table} e $where $order"
      );
      foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
      }
      $stmt->execute();
      return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    $countStmt = $this->conn->prepare(
      "SELECT COUNT(*) FROM {$this->table} e $where"
    );
    foreach ($params as $key => $value) {
      $countStmt->bindValue($key, $value);
    }
    $countStmt->execute();
    $total = (int) $countStmt->fetchColumn();

    $offset   = ($page - 1) * $limit;
    $dataStmt = $this->conn->prepare(
      "SELECT e.*,
            (SELECT COUNT(*) FROM violations v WHERE v.employee_id = e.id) AS violation_count
        FROM {$this->table} e
        $where
        $order
        LIMIT :limit OFFSET :offset"
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

  // ── FILTER OPTIONS — single query for all distinct dropdown values ─────
  public function getFilterOptions($baseFilters = [])
  {
    $where  = "WHERE 1=1";
    $params = [];

    if (!empty($baseFilters['date_from'])) {
      $where .= " AND DATE(created_at) >= :date_from";
      $params[':date_from'] = $baseFilters['date_from'];
    }
    if (!empty($baseFilters['date_to'])) {
      $where .= " AND DATE(created_at) <= :date_to";
      $params[':date_to'] = $baseFilters['date_to'];
    }
    if (!empty($baseFilters['updated_at'])) {
      $where .= " AND DATE(updated_at) = :updated_at";
      $params[':updated_at'] = $baseFilters['updated_at'];
    }
    if (!empty($baseFilters['qr_code'])) {
      $where .= " AND qr_code LIKE :qr_code";
      $params[':qr_code'] = $baseFilters['qr_code'];
    }

    $stmt = $this->conn->prepare(
      "SELECT 
            DISTINCT id,
            fullname,
            position, 
            brand,
            status,
            shift,
            violation,
            image,
            qr_code,
            updated_at
         FROM {$this->table} e
         $where"
    );
    foreach ($params as $key => $value) {
      $stmt->bindValue($key, $value);
    }
    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
  }

  public function updateEmployee(int $old_id, array $data)
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
            (id, fullname, position, brand, gender, birth, hired, status, shift, violation, image, qr_code, user_id, created_at)
            VALUES (:id, :fullname, :position, :brand, :gender, :birth, :hired, :status, :shift, :violation, :image, :qr_code, :user_id, :created_at)"
        );

        $insert->execute([
          ':user_id'    => $this->userId,
          ':id'         => $new_id,
          ':fullname'   => $data['fullname'],
          ':position'   => $data['position'],
          ':brand'      => $data['brand'],
          ':gender'     => $data['gender'],
          ':birth'      => $data['birth'],
          ':hired'      => $data['hired'],
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
                gender = :gender, birth = :birth, hired = :hired,
                status = :status, shift = :shift, violation = :violation,
                image = :image, qr_code = :qr_code, user_id = :user_id, updated_at = :updated_at
            WHERE id = :where_id";

      $stmt = $this->conn->prepare($query);
      $stmt->execute([
        ':user_id'    => $this->userId,
        ':id'         => $data['id'],
        ':fullname'   => $data['fullname'],
        ':position'   => $data['position'],
        ':brand'      => $data['brand'],
        ':gender'     => $data['gender'],
        ':birth'      => $data['birth'],
        ':hired'      => $data['hired'],
        ':status'     => $data['status'],
        ':shift'      => $data['shift'],
        ':violation'  => $data['violation'],
        ':image'      => $data['image'],
        ':qr_code'    => $data['qr_code'],
        ':updated_at' => date('Y-m-d H:i:s'),
        ':where_id'   => $old_id,
      ]);
    }

    if ($currentEmployee && $currentEmployee['status'] !== $data['status'] && $this->userId) {
      $this->logStatusChange($new_id, $currentEmployee['status'], $data['status'], 'Status updated via edit');
    }

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

  public function deleteEmployee(int $id)
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

  public function getEmployee(int $id)
  {
    $query = "SELECT * FROM " . $this->table . " WHERE id = :id";
    $stmt  = $this->conn->prepare($query);
    $stmt->bindParam(':id', $id);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  public function getEmployeeByQR(string $qr_code)
  {
    $query = "SELECT * FROM " . $this->table . " WHERE qr_code = :qr_code";
    $stmt  = $this->conn->prepare($query);
    $stmt->bindParam(':qr_code', $qr_code);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  public function logStatusChange(int $employeeId, string $oldStatus, string $newStatus, ?string $reason = null)
  {
    try {
      $query = "INSERT INTO status_history (employee_id, old_status, new_status, changed_by, change_reason, created_at)
          VALUES (:employee_id, :old_status, :new_status, :changed_by, :change_reason, :created_at)";

      $stmt = $this->conn->prepare($query);
      $stmt->execute([
        ':employee_id'   => $employeeId,
        ':old_status'    => $oldStatus,
        ':new_status'    => $newStatus,
        ':changed_by'    => $_SESSION['username'] ?? 'System',
        ':change_reason' => $reason,
        ':created_at'    => date('Y-m-d H:i:s'),
      ]);
    } catch (Exception $e) {
      error_log("Failed to log status change: " . $e->getMessage());
    }
  }

  public function getEmployeeStatusHistory(int $employeeId)
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

  public function deleteEmployeesByIds(array $employeeIds)
  {
    if (!is_array($employeeIds) || empty($employeeIds)) {
      return 0;
    }
    $employeeIds = array_slice($employeeIds, 0, MAX_BULK_DELETE);

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

    $stmt = $this->conn->prepare(
      "SELECT COUNT(*) as total FROM " . $this->table
    );
    $stmt->execute();
    $stats['total'] = $stmt->fetch(PDO::FETCH_ASSOC)['total'];

    $stmt = $this->conn->prepare(
      "SELECT COUNT(*) as active FROM " . $this->table . " WHERE status = 'Active'"
    );
    $stmt->execute();
    $stats['active'] = $stmt->fetch(PDO::FETCH_ASSOC)['active'];
    $stats['inactive'] = $stats['total'] - $stats['active'];

    $stmt = $this->conn->prepare(
      "SELECT shift, COUNT(*) as count FROM " . $this->table . " GROUP BY shift"
    );
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
  private ?string $upload_dir = null;
  private array $allowed_types = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  private int $max_size = 5 * 1024 * 1024;

  public function __construct(?int $userId = null)
  {
    $this->upload_dir = '../../public/uploads/user/';
    if (!file_exists($this->upload_dir)) {
      mkdir($this->upload_dir, 0777, true);
    }
  }

  public function uploadImage(array $file, ?string $existingFilename = null)
  {
    if (!isset($file['tmp_name']) || $file['error'] !== UPLOAD_ERR_OK) {
      return false;
    }

    if (!validateImageMime($file['tmp_name'])) {
      throw new Exception("Invalid file type. The uploaded file does not appear to be a valid image.");
    }

    $file_extension = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $allowed_types  = $this->allowed_types;

    if (!in_array($file_extension, $allowed_types, true)) {
      throw new Exception("Invalid file extension. Only JPG, JPEG, PNG, GIF and WebP allowed.");
    }

    if ($file['size'] > $this->max_size) {
      throw new Exception("File too large. Maximum size is 5MB.");
    }

    if ($existingFilename && !empty($existingFilename)) {
      $filename = preg_replace('/\.[^.]+$/', '.webp', $existingFilename);
      $filepath = $this->upload_dir . $filename;
      if (file_exists($filepath)) {
        @unlink($filepath);
      }
      $oldPath = $this->upload_dir . $existingFilename;
      if ($oldPath !== $filepath && file_exists($oldPath)) {
        @unlink($oldPath);
      }
    } else {
      $filename = bin2hex(random_bytes(16)) . '.webp';
      $filepath = $this->upload_dir . $filename;
    }

    $converted = $this->convertToWebP($file['tmp_name'], $file_extension, $filepath);

    if (!$converted) {
      $fallbackName = preg_replace('/\.webp$/', '.' . $file_extension, $filename);
      $fallbackPath = $this->upload_dir . $fallbackName;
      if (move_uploaded_file($file['tmp_name'], $fallbackPath)) {
        return $fallbackName;
      }
      return false;
    }

    if ($converted) {
      $thumbPath = $this->upload_dir . 'thumb_' . $filename;
      $this->convertToWebP($file['tmp_name'], $file_extension, $thumbPath, 75, 80);
    }

    return $filename;
  }

  private function convertToWebP(string $tmpPath, string $srcExtension, string $destPath, int $quality = 82, int $maxWidth = 800)
  {
    if (!function_exists('imagewebp')) {
      return false;
    }

    switch ($srcExtension) {
      case 'jpg':
      case 'jpeg':
        $src = @imagecreatefromjpeg($tmpPath);
        break;
      case 'png':
        $src = @imagecreatefrompng($tmpPath);
        break;
      case 'gif':
        $src = @imagecreatefromgif($tmpPath);
        break;
      case 'webp':
        $src = @imagecreatefromwebp($tmpPath);
        break;
      default:
        return false;
    }

    if (!$src) return false;

    $origW = imagesx($src);
    $origH = imagesy($src);

    if ($origW > $maxWidth) {
      $newW  = $maxWidth;
      $newH  = (int) round($origH * ($maxWidth / $origW));
      $resized = imagecreatetruecolor($newW, $newH);

      imagealphablending($resized, false);
      imagesavealpha($resized, true);
      $transparent = imagecolorallocatealpha($resized, 0, 0, 0, 127);
      imagefilledrectangle($resized, 0, 0, $newW, $newH, $transparent);

      imagecopyresampled($resized, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
      imagedestroy($src);
      $src = $resized;
    }

    $result = imagewebp($src, $destPath, $quality);
    imagedestroy($src);

    return $result;
  }

  public function deleteImage(?string $filename): bool
  {
    if (!$filename) return false;

    $filename = basename($filename);

    $deleted = false;
    $main  = $this->upload_dir . $filename;
    $thumb = $this->upload_dir . 'thumb_' . $filename;

    if (file_exists($main)) {
      unlink($main);
      $deleted = true;
    }
    if (file_exists($thumb)) {
      unlink($thumb);
    }

    return $deleted;
  }

  public function getImagePath(?string $filename): string
  {
    return $this->upload_dir . basename($filename);
  }

  public function imageExists(?string $filename): bool
  {
    if (empty($filename)) return false;
    $filepath = $this->getImagePath($filename);
    return file_exists($filepath) && is_readable($filepath);
  }
}

class QRCodeGenerator
{
  const QR_CODE_LENGTH = 41;

  public static function generateQRCode(?int $userId = null, int $length = self::QR_CODE_LENGTH)
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
      $random .= $chars[random_int(0, strlen($chars) - 1)];
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

    header('Location:', ROUTE_LOGIN);
    exit;
  }

  $database        = new Database();
  $employeeManager = new EmployeeManager($database);
  $fileUploader    = new FileUploader($database->getCurrentUserId());

  $response = ['success' => false, 'message' => '', 'data' => null];

  // ── backup_data ───────────────────────────────────────────────────────────
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

        $qr_code = QRCodeGenerator::generateQRCode($database->getCurrentUserId());

        $raw_status = sanitizeInput($_POST['status'] ?? 'Active');
        $raw_shift  = sanitizeInput($_POST['shift']  ?? '');
        $status     = in_array($raw_status, ALLOWED_STATUSES, true) ? $raw_status : 'Active';
        $shift      = in_array($raw_shift,  ALLOWED_SHIFTS,   true) ? $raw_shift  : '';
        $raw_gender = sanitizeInput($_POST['gender'] ?? '');
        $gender     = in_array($raw_gender, ['Male', 'Female'], true) ? $raw_gender : null;

        $employee_data = [
          'user_id'   => $database->getCurrentUserId(),
          'id'        => sanitizeInput($_POST['id']        ?? ''),
          'fullname'  => sanitizeInput($_POST['fullname']  ?? ''),
          'position'  => sanitizeInput($_POST['position']  ?? ''),
          'brand'     => sanitizeInput($_POST['brand']     ?? ''),
          'gender'    => $gender,
          'birth'     => sanitizeInput(!empty($_POST['birth'])  ? $_POST['birth']  : null),
          'hired'     => sanitizeInput(!empty($_POST['hired'])  ? $_POST['hired']  : null),
          'status'    => $status,
          'shift'     => $shift,
          'violation' => sanitizeInput($_POST['violation'] ?? ''),
          'image'     => sanitizeInput($image_filename),
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
          $conn       = $database->getUserConnection();
          $changedBy  = $_SESSION['username'] ?? 'System';
          $finalStatus = syncStatusByQR($conn, $employee_id, $employee_data['qr_code'], $changedBy);

          $response['success'] = true;
          $response['message'] = 'Employee created successfully';
          $response['data']    = [
            'id'      => $employee_id,
            'qr_code' => $employee_data['qr_code'],
            'status'  => $finalStatus,
          ];
          logSystemAction($database->getCurrentUserId(), 'EMPLOYEE_CREATED', "Created employee: " . $employee_data['fullname']);
          invalidateQrEmployeeCache();

          if (!empty($employee_data['violation'])) {
            try {
              $stmt = $conn->prepare(
                "INSERT INTO violations (employee_id, violation_type, violation_description, violation_date)
                 VALUES (?, 'Initial Remarks', ?, ?)"
              );
              $stmt->execute([$employee_id, $employee_data['violation'], date('Y-m-d')]);
            } catch (Exception $e) {
              error_log("Violation log on create failed: " . $e->getMessage());
            }
          }
        } else {
          $response['message'] = 'Failed to create employee. Please check your input data.';
        }
        break;

      case 'edit':
      case 'update':
        $old_id = sanitizeInput($_POST['original_id'] ?? 0);

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

        $raw_status       = sanitizeInput($_POST['status'] ?? $current_employee['status']);
        $raw_shift        = sanitizeInput($_POST['shift']  ?? $current_employee['shift']);
        $status           = in_array($raw_status, ALLOWED_STATUSES, true) ? $raw_status : $current_employee['status'];
        $shift            = in_array($raw_shift,  ALLOWED_SHIFTS,   true) ? $raw_shift  : $current_employee['shift'];
        $new_qr_code      = sanitizeInput(!empty($_POST['qr_code']) ? $_POST['qr_code'] : $current_employee['qr_code']);
        $raw_gender_edit  = sanitizeInput($_POST['gender'] ?? $current_employee['gender'] ?? '');
        $gender_edit      = in_array($raw_gender_edit, ['Male', 'Female'], true) ? $raw_gender_edit : null;

        $employee_data = [
          'user_id'   => $database->getCurrentUserId(),
          'id'        => $new_id,
          'fullname'  => sanitizeInput($_POST['fullname']  ?? $current_employee['fullname']),
          'position'  => sanitizeInput($_POST['position']  ?? $current_employee['position']),
          'brand'     => sanitizeInput($_POST['brand']     ?? $current_employee['brand']),
          'gender'    => $gender_edit,
          'birth'     => sanitizeInput(!empty($_POST['birth']) ? $_POST['birth'] : ($current_employee['birth'] ?? null)),
          'hired'     => sanitizeInput(!empty($_POST['hired']) ? $_POST['hired'] : ($current_employee['hired'] ?? null)),
          'status'    => $status,
          'shift'     => $shift,
          'violation' => sanitizeInput($_POST['violation'] ?? $current_employee['violation']),
          'image'     => sanitizeInput($image_filename),
          'qr_code'   => $new_qr_code,
        ];

        try {
          $employeeManager->updateEmployee($old_id, $employee_data);

          $conn         = $database->getUserConnection();
          $changedBy    = $_SESSION['username'] ?? 'System';
          $finalStatus  = syncStatusByQR($conn, $new_id, $new_qr_code, $changedBy);

          $response['success'] = true;
          $response['message'] = 'Employee updated successfully';
          $response['data']    = ['status' => $finalStatus];
          invalidateQrEmployeeCache();

          $oldViolation = trim($current_employee['violation'] ?? '');
          $newViolation = trim($employee_data['violation'] ?? '');

          if ($oldViolation !== $newViolation) {
            try {
              if (!empty($newViolation)) {
                $stmt = $conn->prepare(
                  "INSERT INTO violations (employee_id, violation_type, violation_description, violation_date)
                   VALUES (?, 'Remarks Updated', ?, ?)"
                );
                $stmt->execute([$new_id, $newViolation, date('Y-m-d')]);
              } elseif (!empty($oldViolation) && empty($newViolation)) {
                $stmt = $conn->prepare(
                  "INSERT INTO violations (employee_id, violation_type, violation_description, violation_date)
                   VALUES (?, 'Remarks Cleared', ?, ?)"
                );
                $stmt->execute([$new_id, "Previous: $oldViolation", date('Y-m-d')]);
              }
            } catch (Exception $e) {
              error_log("Violation log on update failed: " . $e->getMessage());
            }
          }
        } catch (Exception $e) {
          $response['message'] = $e->getMessage();
        }
        break;

      case 'delete':
        $employee_id = sanitizeInput($_POST['id'] ?? 0);
        $employee    = $employeeManager->getEmployee($employee_id);

        if ($employee && $employeeManager->deleteEmployee($employee_id)) {
          if ($employee['image']) {
            $fileUploader->deleteImage($employee['image']);
          }
          $response['success'] = true;
          $response['message'] = 'Employee deleted successfully';
          invalidateQrEmployeeCache();
        } else {
          $response['message'] = 'Failed to delete employee';
        }
        break;

      case 'delete_filtered':
        try {
          $employee_ids = safeJsonDecode($_POST['employee_ids'] ?? '[]');
          $filters      = safeJsonDecode($_POST['filters']       ?? '{}');

          if (!is_array($employee_ids)) $employee_ids = [];
          if (!is_array($filters))      $filters      = [];

          if (count($employee_ids) > MAX_BULK_DELETE) {
            $response['message'] = 'Too many IDs in a single request.';
            break;
          }

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
              $filterParts[] = sanitizeInput($key) . ": " . sanitizeInput($value);
            }
            $filterStr = implode(', ', $filterParts) ?: 'All';

            $emp_label   = $deleted_count > 1 ? "employee's" : "employee";
            $img_label   = $deleted_images > 1 ? "images" : "image";

            $response['success']        = true;
            $response['message']        = "Deleted $deleted_count $emp_label matching filters: $filterStr. Removed $deleted_images $img_label.";
            $response['deleted_count']  = $deleted_count;
            $response['deleted_images'] = $deleted_images;

            logSystemAction($database->getCurrentUserId(), 'FILTERED_EMPLOYEES_DELETED', "Deleted $deleted_count $emp_label with filters: $filterStr");
            invalidateQrEmployeeCache();
          } else {
            $db->rollBack();
            $response['message'] = "Failed to delete employee(s)";
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

            $emp_count   = count($all_employees);
            $emp_label   = $emp_count > 1 ? "employee's" : "employee";
            $img_label   = $deleted_images > 1 ? "images" : "image";

            $response['success'] = true;
            $response['message'] = "All employee data deleted successfully. $emp_count $emp_label and $deleted_images $img_label removed.";
            invalidateQrEmployeeCache();
          } else {
            $db->rollBack();
            $response['message'] = "Failed to delete employee data";
          }
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['success'] = true;
          $response['message'] = 'All employee data deleted successfully.';
          invalidateQrEmployeeCache();
        }
        break;

      case 'import':
        $employees_data = safeJsonDecode($_POST['employees'] ?? '');

        if (!is_array($employees_data) || empty($employees_data)) {
          $response['message'] = empty($_POST['employees']) ? 'No employee data provided' : 'Invalid employee data format';
          break;
        }

        if (count($employees_data) > MAX_IMPORT_ROWS) {
          $response['message'] = 'Import exceeds maximum allowed rows (' . MAX_IMPORT_ROWS . ').';
          break;
        }

        $imported_count = 0;
        $errors         = [];
        $changedBy      = $_SESSION['username'] ?? 'System';

        try {
          $db = $database->getUserConnection();
          $db->beginTransaction();

          foreach ($employees_data as $index => $employee_data) {
            try {
              $qr_code = (!empty($employee_data['qr']) && trim($employee_data['qr']) !== '')
                ? trim($employee_data['qr'])
                : QRCodeGenerator::generateQRCode($database->getCurrentUserId());

              $row_status = in_array($employee_data['status'] ?? '', ALLOWED_STATUSES, true) ? $employee_data['status'] : 'Active';
              $row_shift  = in_array($employee_data['shift']  ?? '', ALLOWED_SHIFTS,   true) ? $employee_data['shift']  : 'Day Shift';
              $import_gender = $employee_data['gender'] ?? '';
              $import_gender = in_array($import_gender, ['Male', 'Female'], true) ? $import_gender : null;

              $employee_record = [
                'user_id'   => $database->getCurrentUserId(),
                'id'        => sanitizeInput(trim($employee_data['id'])),
                'fullname'  => sanitizeInput(trim($employee_data['fullname'])),
                'position'  => sanitizeInput(trim($employee_data['position'])),
                'brand'     => sanitizeInput(trim($employee_data['brand'] ?? '')),
                'gender'    => $import_gender,
                'birth'     => !empty($employee_data['birth']) ? sanitizeInput(trim($employee_data['birth'])) : null,
                'hired'     => !empty($employee_data['hired']) ? sanitizeInput(trim($employee_data['hired'])) : null,
                'status'    => $row_status,
                'shift'     => $row_shift,
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
                syncStatusByQR($db, $employee_id, $employee_record['qr_code'], $changedBy);
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
            invalidateQrEmployeeCache();
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

      case 'bulk_status_update':
        $employee_ids = $_POST['employee_ids'] ?? [];
        $new_status   = sanitizeInput($_POST['new_status'] ?? '');
        $reason       = sanitizeInput($_POST['reason'] ?? 'Bulk status update');

        if (!in_array($new_status, ALLOWED_STATUSES, true)) {
          $response['message'] = 'Invalid status value.';
          break;
        }

        if (empty($employee_ids)) {
          $response['message'] = 'Employee IDs are required';
          break;
        }

        if (!is_array($employee_ids)) {
          $employee_ids = safeJsonDecode($employee_ids) ?: [];
        }

        $employee_ids  = array_slice($employee_ids, 0, MAX_BULK_DELETE);
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

              $stmt = $db->prepare(
                "UPDATE employees SET status = :status, updated_at = :updated_at WHERE id = :id"
              );
              $stmt->execute([
                ':status'     => $new_status,
                ':updated_at' => date('Y-m-d H:i:s'),
                ':id'         => $employee_id,
              ]);

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

          logSystemAction(
            $database->getCurrentUserId(),
            'BULK_STATUS_UPDATE',
            "Updated $updated_count employees to status: $new_status"
          );
          invalidateQrEmployeeCache();
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['message'] = 'Bulk update error: ' . $e->getMessage();
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
        $raw_mode     = sanitizeInput($_POST['restore_mode'] ?? 'replace');
        $restore_mode = in_array($raw_mode, ALLOWED_RESTORE, true) ? $raw_mode : 'replace';

        if (empty($backup_json)) {
          $response['message'] = 'No backup data provided';
          break;
        }

        try {
          $backup_data = safeJsonDecode($backup_json);

          if (!$backup_data || !isset($backup_data['employees']) || !is_array($backup_data['employees'])) {
            $response['message'] = 'Invalid backup data format';
            break;
          }

          if (count($backup_data['employees']) > MAX_IMPORT_ROWS) {
            $response['message'] = 'Backup exceeds maximum allowed rows (' . MAX_IMPORT_ROWS . ').';
            break;
          }

          $db = $database->getUserConnection();
          $db->beginTransaction();

          if ($restore_mode === 'replace') {
            $employeeManager->deleteAllEmployees();
          }

          $restored_count = 0;
          $errors         = [];
          $changedBy      = $_SESSION['username'] ?? 'System';

          foreach ($backup_data['employees'] as $employee_data) {
            try {
              unset($employee_data['created_at'], $employee_data['updated_at']);

              if (empty($employee_data['qr_code'])) {
                $employee_data['qr_code'] = QRCodeGenerator::generateQRCode($database->getCurrentUserId());
              }

              $employee_data['status'] = in_array($employee_data['status'] ?? '', ALLOWED_STATUSES, true)
                ? $employee_data['status'] : 'Active';
              $employee_data['shift']  = in_array($employee_data['shift']  ?? '', ALLOWED_SHIFTS,   true)
                ? $employee_data['shift']  : 'Day Shift';

              $import_gender_restore = $employee_data['gender'] ?? '';
              $employee_data = [
                'user_id'   => $database->getCurrentUserId(),
                'id'        => sanitizeInput(trim((string)($employee_data['id']        ?? ''))),
                'fullname'  => sanitizeInput(trim((string)($employee_data['fullname']  ?? ''))),
                'position'  => sanitizeInput(trim((string)($employee_data['position']  ?? ''))),
                'brand'     => sanitizeInput(trim((string)($employee_data['brand']     ?? ''))),
                'gender'    => in_array($import_gender_restore, ['Male', 'Female'], true) ? $import_gender_restore : null,
                'birth'     => !empty($employee_data['birth'])     ? sanitizeInput(trim($employee_data['birth']))     : null,
                'hired'     => !empty($employee_data['hired'])     ? sanitizeInput(trim($employee_data['hired']))     : null,
                'status'    => $employee_data['status'],
                'shift'     => $employee_data['shift'],
                'violation' => sanitizeInput(trim((string)($employee_data['violation'] ?? ''))),
                'image'     => null,
                'qr_code'   => sanitizeInput(trim((string)($employee_data['qr_code']  ?? ''))),
              ];

              $employee_id = $employeeManager->createEmployee($employee_data);

              if ($employee_id !== false) {
                syncStatusByQR($db, $employee_id, $employee_data['qr_code'], $changedBy);
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
          invalidateQrEmployeeCache();
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['message'] = 'Restore error: ' . $e->getMessage();
        }
        break;
    }

    // ── GET handler ──────────────────────────────────────────────────────────
  } elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = sanitizeInput($_GET['action'] ?? '');

    if (!empty($action) && !in_array($action, ALLOWED_GET_ACTIONS, true)) {
      $response['message'] = 'Invalid GET action specified.';
      goto send_response;
    }

    switch ($action) {
      case 'get':
      case 'list':
        $filters = [];

        if (!empty($_GET['user_id']))        $filters['user_id']        = sanitizeInput($_GET['user_id']);
        if (!empty($_GET['id']))             $filters['id']             = sanitizeInput($_GET['id']);
        if (!empty($_GET['fullname']))       $filters['fullname']       = sanitizeInput($_GET['fullname']);
        if (!empty($_GET['position']))       $filters['position']       = sanitizeInput($_GET['position']);
        if (!empty($_GET['position_none']))  $filters['position_none']  = '1';
        if (!empty($_GET['brand']))          $filters['brand']          = sanitizeInput($_GET['brand']);
        if (!empty($_GET['brand_none']))     $filters['brand_none']     = '1';
        if (!empty($_GET['status']))         $filters['status']         = sanitizeInput($_GET['status']);
        if (!empty($_GET['status_none']))    $filters['status_none']    = '1';
        if (!empty($_GET['shift']))          $filters['shift']          = sanitizeInput($_GET['shift']);
        if (!empty($_GET['shift_none']))     $filters['shift_none']     = '1';
        if (!empty($_GET['violation']))      $filters['violation']      = sanitizeInput($_GET['violation']);
        if (!empty($_GET['violation_none'])) $filters['violation_none'] = '1';
        if (!empty($_GET['qr_code']))        $filters['qr_code']        = sanitizeInput($_GET['qr_code']);
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

        // ── Only run the expensive DISTINCT filter-options scan when it's
        //    actually needed: the caller is applying a filter, or explicitly
        //    asked for it (e.g. first page load, to seed autocomplete lists).
        //    Plain pagination / sorting / silent polls skip it entirely.
        $filterFieldKeys  = array_diff(array_keys($filters), ['sort_col', 'sort_dir']);
        $hasFilterFields  = !empty($filterFieldKeys);
        $filterOptionsReq = $_GET['filter_options'] ?? null;
        $wantFilterOptions = $filterOptionsReq === '0'
          ? false
          : ($filterOptionsReq === '1' ? true : $hasFilterFields);

        try {
          $result = $employeeManager->getEmployees($filters, $page, $limit);

          $response['success'] = true;
          $response['data']    = $result['data'];
          $response['total']   = $result['total'];
          $response['page']    = $page;
          $response['pages']   = ceil($result['total'] / $limit);

          if ($wantFilterOptions) {
            $filterOptions = $employeeManager->getFilterOptions($filters);

            foreach ($filterOptions as &$fo) {
              $fo['image_exists'] = !empty($fo['image']) && $fileUploader->imageExists($fo['image']);
            }
            unset($fo);

            $fieldFilterOptions = [
              'id'          => [],
              'fullname'    => [],
              'position'    => [],
              'brand'       => [],
              'status'      => [],
              'shift'       => [],
              'violation'   => [],
              'qr_code'     => [],
            ];
            foreach ($filterOptions as $row) {
              foreach ($fieldFilterOptions as $field => $_) {
                $val = $row[$field] ?? null;
                if ($val !== null && $val !== '') {
                  $fieldFilterOptions[$field][] = $row;
                }
              }
            }
            foreach ($fieldFilterOptions as $field => &$bucket) {
              $seen = [];
              $bucket = array_values(array_filter($bucket, function ($r) use ($field, &$seen) {
                $v = $r[$field] ?? '';
                if (isset($seen[$v])) return false;
                $seen[$v] = true;
                return true;
              }));
            }
            unset($bucket);

            $response['filter_options']       = $filterOptions;
            $response['field_filter_options'] = $fieldFilterOptions;
          }
        } catch (Exception $e) {
          error_log("getEmployees error: " . $e->getMessage());
          $response['message'] = 'Error retrieving employees.';
        }
        break;

      case 'get_single':
        $employee_id = sanitizeInput($_GET['id'] ?? '');

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

      case 'get_access_logs':
        $id = intval($_GET['id'] ?? 0);

        if (!$id) {
          $response['message'] = 'Employee ID required';
          break;
        }
        try {
          $conn = getUserDBConnection($_SESSION['user_id']);
          $stmt = $conn->prepare(
            "SELECT DISTINCT check_status, access_type, user_id, access_timestamp FROM employee_access_log
             WHERE employee_id = :id
             ORDER BY access_timestamp DESC
             LIMIT 1000"
          );
          $stmt->execute([':id' => $id]);
          $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

          $userIds    = array_unique(array_filter(array_column($logs, 'user_id')));
          $userNameMap = [];

          if (!empty($userIds)) {
            try {
              $mainConn = getMainDBConnection();
              $ph = implode(',', array_fill(0, count($userIds), '?'));
              $uStmt = $mainConn->prepare(
                "SELECT id, first_name FROM users WHERE id IN ($ph)"
              );
              $uStmt->execute(array_values($userIds));
              foreach ($uStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
                $userNameMap[(int)$row['id']] = $row['first_name'];
              }
            } catch (Exception $e) {
              error_log("Gate name lookup failed: " . $e->getMessage());
            }
          }

          foreach ($logs as &$log) {
            $uid = (int)($log['user_id'] ?? 0);
            $log['gate_name'] = ($uid && isset($userNameMap[$uid]))
              ? $userNameMap[$uid]
              : null;
          }
          unset($log);

          $response['success'] = true;
          $response['logs']    = $logs;
        } catch (Exception $e) {
          $response['message'] = 'Error fetching logs: ' . $e->getMessage();
          error_log("get_access_logs error: " . $e->getMessage());
        }
        break;

      case 'get_status_history':
        $emp_id = intval($_GET['id'] ?? 0);

        if (!$emp_id) {
          $response['message'] = 'Employee ID required';
          break;
        }
        try {
          $conn = $database->getUserConnection();
          $stmt = $conn->prepare(
            "SELECT id, old_status, new_status, changed_by, change_reason, created_at
             FROM status_history
             WHERE employee_id = :id
             ORDER BY created_at DESC
             LIMIT 200"
          );
          $stmt->execute([':id' => $emp_id]);
          $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

          $response['success'] = true;
          $response['history'] = $rows;
        } catch (Exception $e) {
          $response['message'] = 'Error fetching status history: ' . $e->getMessage();
          error_log("get_status_history error: " . $e->getMessage());
        }
        break;

      case 'get_statuses':
        try {
          $conn = $database->getUserConnection();
          $stmt = $conn->prepare("SELECT id, status FROM employees");
          $stmt->execute();

          $response['success']  = true;
          $response['statuses'] = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving statuses: ' . $e->getMessage();
        }
        break;

      case 'get_violations':
        $emp_id = intval($_GET['id'] ?? 0);

        if (!$emp_id) {
          $response['message'] = 'Employee ID required';
          break;
        }
        try {
          $conn = $database->getUserConnection();

          $conn->exec("CREATE TABLE IF NOT EXISTS `violations` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `employee_id` INT NOT NULL,
            `violation_type` VARCHAR(100) DEFAULT NULL,
            `violation_description` TEXT DEFAULT NULL,
            `violation_date` DATE DEFAULT NULL,
            `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

          $stmt = $conn->prepare(
            "SELECT id, violation_type, violation_description, violation_date, created_at
             FROM violations
             WHERE employee_id = :id
             ORDER BY created_at DESC
             LIMIT 200"
          );
          $stmt->execute([':id' => $emp_id]);
          $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

          $response['success']    = true;
          $response['violations'] = $rows;
        } catch (Exception $e) {
          $response['message'] = 'Error fetching violations: ' . $e->getMessage();
          error_log("get_violations error: " . $e->getMessage());
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
          'username'   => sanitizeInput($_SESSION['username']    ?? 'Unknown'),
          'email'      => sanitizeInput($_SESSION['email']       ?? ''),
          'first_name' => sanitizeInput($_SESSION['first_name']  ?? ''),
          'last_name'  => sanitizeInput($_SESSION['last_name']   ?? ''),
        ];
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
  $error_response = ['success' => false, 'message' => 'A system error occurred. Please try again.'];

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
function serveFile(string $filepath, ?string $filename = null)
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
  $filename     = basename($_GET['serve_file']);
  $filepath     = $fileUploader->getImagePath($filename);

  serveFile($filepath, $filename);
}

function getAPIInfo()
{
  return [
    'version'     => '2.6',
    'name'        => 'Manpower Management System',
    'description' => 'Multi-user employee management — employee status auto-derived from the code table via syncStatusByQR()',
    'features'    => [
      'Transaction Support'   => 'Database transactions on ID-change edits, filtered delete, delete-all, import, restore, and bulk status update',
      'Audit Logging'         => 'Full audit trail via logSystemAction() on every mutating operation',
      'Filtered Delete'       => 'Delete employees by explicit ID list derived from active search filters',
      'Image Handling'        => 'Upload → WebP conversion (max 800 px, 82 % quality) + thumbnail; MIME-validated; served via ?serve_file=',
      'QR Reservation'        => 'Time-limited (300 s) proximity-code reservation with heartbeat to prevent concurrent assignment',
      'Status Auto-Sync'      => 'syncStatusByQR() writes to status_history and adjusts employee.status on add/edit',
      'Orphan Sync'           => 'sync_orphans GET action reconciles employees whose Proximity code is missing or disabled in the code table',
      'Import / Restore'      => 'Bulk-import up to 2000 rows; restore from JSON backup in replace or merge mode',
      'Backup'                => 'POST backup_data streams a timestamped JSON file containing all employees + stats',
      'Scanner Cache Sync'    => 'invalidateQrEmployeeCache() clears the qr_search_backend.php employee cache on every mutation so the scanner never serves stale data',
    ],
    'endpoints' => [
      'POST' => [
        'add / create'        => 'Create employee; auto-generates QR if omitted; calls syncStatusByQR()',
        'edit / update'       => 'Update employee; supports ID change via delete-insert; calls syncStatusByQR()',
        'delete'              => 'Delete single employee and associated image file',
        'delete_filtered'     => 'Delete employees by explicit ID list (max ' . MAX_BULK_DELETE . '); deletes associated images',
        'delete_all'          => 'Delete all employees and all associated images',
        'import'              => 'Bulk-import array of employee objects (max ' . MAX_IMPORT_ROWS . ' rows)',
        'get_stats'           => 'Return total / active / inactive counts and shift breakdown',
        'bulk_status_update'  => 'Set status for a list of employee IDs; logs each change to status_history',
        'search_qr'           => 'Find employee by exact proximity value',
        'restore_data'        => 'Restore from JSON backup; mode: replace (wipe first) or merge (skip existing)',
        'backup_data'         => 'Stream all employees as a downloadable JSON backup file',
      ],
      'GET' => [
        'get / list'          => 'Paginated employee list with server-side filters, sort, and field_filter_options',
        'get_single'          => 'Fetch one employee by id',
        'get_access_logs'     => 'Fetch up to 1000 employee_access_log rows for an employee; hydrates gate_name from users table',
        'get_status_history'  => 'Fetch up to 200 status_history rows for an employee',
        'get_violations'      => 'Fetch up to 200 violations rows for an employee',
        'get_statuses'        => 'Return id + status for every employee (used by cross-tab live-sync polling)',
        'check_qr'            => 'Check whether a proximity is already assigned to an employee',
        'stats'               => 'Same as POST get_stats',
        'user_info'           => 'Return session user_id, username, email, first_name, last_name',
        'health_check'        => 'Verify main DB and user DB connectivity; returns JSON (bypasses XHR check)',
      ],
    ],
    'query_parameters' => [
      'Filters'               => 'id, fullname, position, brand, status, shift, violation, qr_code, created_at, date_from, date_to, updated_at (all optional)',
      'None filters'          => 'position_none, brand_none, status_none, shift_none, violation_none — match NULL / empty / "none" values',
      'Sorting'               => 'sort_col (fullname|brand|shift|violation|created_at|updated_at), sort_dir (asc|desc)',
      'Paging'                => 'page (default 1), limit (default 25)',
    ],
    'authentication'          => 'Session-based ($_SESSION[user_id] required for every request)',
    'database'                => 'Per-user databases; main DB holds users table used for gate-name lookup',
  ];
}

if (isset($_GET['api_info'])) {
  header('Content-Type: application/json');
  echo json_encode(getAPIInfo(), JSON_PRETTY_PRINT);
  exit;
}