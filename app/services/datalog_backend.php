<?php
// app/services/datalog_backend.php --> datalog table backend

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

// ── Whitelists ────────────────────────────────────────────────────────────────
const ALLOWED_POST_ACTIONS = [
  'delete',
  'delete_filtered',
  'delete_all',
  'get_stats',
  'get_checkinout_history',
  'search_qr',
  'backup_data',
];

const ALLOWED_GET_ACTIONS = [
  'get',
  'list',
  'get_single',
  'current_status',
  'check_qr',
  'stats',
  'user_info',
  'health_check',
];

// ── Safe json_decode wrapper ──────────────────────────────────────────────────
function safeJsonDecode(mixed $json, bool $assoc = true, int $depth = 32)
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
        $result = createUserDatabase($this->currentUserId);
        if (!$result['success']) {
          throw new Exception("Failed to initialize user database: " . $result['error']);
        }
      }
      $this->userConn = getUserDBConnection($this->currentUserId);
      $this->userConn->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");
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

// ─────────────────────────────────────────────────────────────────────────────
// AccessLogManager — CRUD for employee_access_log only
// ─────────────────────────────────────────────────────────────────────────────
class AccessLogManager
{
  private PDO $conn;
  private $logTable    = 'employee_access_log';
  private $checkTable  = 'check_in_out';
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

  // ── List logs with optional filters & pagination ───────────────────────
  public function getLogs($filters = [], $page = 1, $limit = 25)
  {
    $where  = "WHERE 1=1";
    $params = [];

    if (!empty($filters['employee_id'])) {
      $where .= " AND l.employee_id = :employee_id";
      $params[':employee_id']       = $filters['employee_id'];
    }
    if (!empty($filters['fullname'])) {
      $where .= " AND l.fullname LIKE :fullname";
      $params[':fullname'] = '%' . $filters['fullname'] . '%';
    }
    if (!empty($filters['position'])) {
      $where .= " AND l.position LIKE :position";
      $params[':position'] = $filters['position'];
    }
    if (!empty($filters['position_none'])) {
      $where .= " AND (l.position IS NULL OR TRIM(l.position) = '' OR LOWER(TRIM(l.position)) = 'none')";
    }
    if (!empty($filters['brand'])) {
      $where .= " AND l.brand LIKE :brand";
      $params[':brand'] = $filters['brand'];
    }
    if (!empty($filters['brand_none'])) {
      $where .= " AND (l.brand IS NULL OR TRIM(l.brand) = '' OR LOWER(TRIM(l.brand)) = 'none')";
    }
    if (!empty($filters['status'])) {
      $where .= " AND l.status  = :status";
      $params[':status']        = $filters['status'];
    }
    if (!empty($filters['status_none'])) {
      $where .= " AND (l.status IS NULL OR TRIM(l.status) = '' OR LOWER(TRIM(l.status)) = 'none')";
    }
    if (!empty($filters['shift'])) {
      $where .= " AND l.shift = :shift";
      $params[':shift']       = $filters['shift'];
    }
    if (!empty($filters['shift_none'])) {
      $where .= " AND (l.shift IS NULL OR TRIM(l.shift) = '' OR LOWER(TRIM(l.shift)) = 'none')";
    }
    if (!empty($filters['violation'])) {
      $where .= " AND l.violation LIKE :violation";
      $params[':violation'] = '%' . $filters['violation'] . '%';
    }
    if (!empty($filters['violation_none'])) {
      $where .= " AND (l.violation IS NULL OR TRIM(l.violation) = '' OR LOWER(TRIM(l.violation)) = 'none')";
    }
    if (!empty($filters['qr_code'])) {
      $where .= " AND l.qr_code = :qr_code";
      $params[':qr_code']       = $filters['qr_code'];
    }
    if (!empty($filters['check_status'])) {
      $where .= " AND l.check_status = :check_status";
      $params[':check_status'] = $filters['check_status'];
    }
    if (!empty($filters['user_id'])) {
      $where .= " AND l.user_id LIKE :user_id";
      $params[':user_id'] = '%' . $filters['user_id'] . '%';
    }
    if (!empty($filters['gate_name'])) {
      $where .= " AND l.user_id IN (SELECT id FROM " . DB_NAME . ".users WHERE first_name LIKE :gate_name)";
      $params[':gate_name'] = '%' . $filters['gate_name'] . '%';
    }
    if (!empty($filters['user_id_none'])) {
      $where .= " AND (l.user_id IS NULL OR TRIM(l.user_id) = '' OR LOWER(TRIM(l.user_id)) = 'none')";
    }
    if (!empty($filters['access_type'])) {
      $where .= " AND l.access_type LIKE :access_type";
      $params[':access_type'] = '%' . $filters['access_type'] . '%';
    }
    if (!empty($filters['access_timestamp'])) {
      $where .= " AND l.access_timestamp LIKE :access_timestamp";
      $params[':access_timestamp'] = '%' . $filters['access_timestamp'] . '%';
    }
    if (!empty($filters['date_from'])) {
      $where .= " AND l.access_timestamp >= :date_from";
      $params[':date_from'] = $filters['date_from'] . ' 00:00:00';
    }
    if (!empty($filters['date_to'])) {
      $where .= " AND l.access_timestamp < :date_to";
      $params[':date_to'] = date('Y-m-d', strtotime($filters['date_to'] . ' +1 day')) . ' 00:00:00';
    }

    // ── Build ORDER BY ────────────────────────────────────────────────
    $allowed_sort_cols = ['employee_id', 'fullname', 'brand', 'shift', 'violation', 'access_timestamp', 'check_status', 'gate_name'];
    $sort_col = (isset($filters['sort_col']) && in_array($filters['sort_col'], $allowed_sort_cols, true))
      ? $filters['sort_col'] : 'access_timestamp';
    $sort_dir = (isset($filters['sort_dir']) && strtolower($filters['sort_dir']) === 'asc')
      ? 'ASC' : 'DESC';

    $order = $sort_col === 'gate_name'
      ? "ORDER BY u.first_name {$sort_dir}"
      : "ORDER BY l.{$sort_col} {$sort_dir}";

    $joinUsers = "LEFT JOIN " . DB_NAME . ".users u ON u.id = l.user_id";

    if ($page === null) {
      $stmt = $this->conn->prepare(
        "SELECT l.*, u.first_name AS gate_name
         FROM {$this->logTable} l
         $joinUsers
         $where
         $order"
      );
      foreach ($params as $key => $value) {
        $stmt->bindValue($key, $value);
      }
      $stmt->execute();
      $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      return $rows;
    }

    $countStmt = $this->conn->prepare(
      "SELECT COUNT(*) FROM {$this->logTable} l $where"
    );
    foreach ($params as $key => $value) {
      $countStmt->bindValue($key, $value);
    }
    $countStmt->execute();
    $total = (int) $countStmt->fetchColumn();

    $offset = ($page - 1) * $limit;
    $dataStmt = $this->conn->prepare(
      "SELECT l.*, u.first_name AS gate_name
      FROM {$this->logTable} l
      $joinUsers
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
    $logs = $dataStmt->fetchAll(PDO::FETCH_ASSOC);

    return ['data' => $logs, 'total' => $total];
  }

  // ── FILTER OPTIONS — single query for all distinct dropdown values ─────
  public function getFilterOptions($baseFilters = [])
  {
    $cacheKey = 'filter_options_' . md5(json_encode([
      'date_from' => $baseFilters['date_from'] ?? '',
      'date_to'   => $baseFilters['date_to']   ?? '',
      'qr_code'   => $baseFilters['qr_code']   ?? '',
    ]));

    if (
      isset($_SESSION[$cacheKey]) &&
      (time() - $_SESSION[$cacheKey]['time']) < 60
    ) {
      return $_SESSION[$cacheKey]['data'];
    }

    $where  = "WHERE 1=1";
    $params = [];

    if (!empty($baseFilters['date_from'])) {
      $where .= " AND access_timestamp >= :date_from";
      $params[':date_from'] = $baseFilters['date_from'] . ' 00:00:00';
    }
    if (!empty($baseFilters['date_to'])) {
      $where .= " AND access_timestamp < :date_to";
      $params[':date_to'] = date('Y-m-d', strtotime($baseFilters['date_to'] . ' +1 day')) . ' 00:00:00';
    } elseif (empty($baseFilters['date_from'])) {
      $where .= " AND access_timestamp >= :default_bound";
      $params[':default_bound'] = date('Y-m-d', strtotime('-90 days'));
    }
    if (!empty($baseFilters['qr_code'])) {
      $where .= " AND qr_code LIKE :qr_code";
      $params[':qr_code'] = $baseFilters['qr_code'];
    }

    $stmt = $this->conn->prepare(
      "SELECT
            DISTINCT employee_id,
            fullname,
            position,
            brand,
            status,
            shift,
            violation,
            check_status,
            user_id
         FROM {$this->logTable}
         $where"
    );
    foreach ($params as $key => $value) {
      $stmt->bindValue($key, $value);
    }
    $stmt->execute();
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Hydrate gate_name
    $userIds = array_unique(array_filter(array_column($rows, 'user_id')));
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
        error_log("Filter options gate_name lookup failed: " . $e->getMessage());
      }
    }
    foreach ($rows as &$row) {
      $uid = (int)($row['user_id'] ?? 0);
      $row['gate_name'] = $uid && isset($userNameMap[$uid]) ? $userNameMap[$uid] : null;
    }
    unset($row);

    $_SESSION[$cacheKey] = ['data' => $rows, 'time' => time()];

    return $rows;
  }

  // ── Single log entry ───────────────────────────────────────────────────
  public function getLog(int $id)
  {
    $stmt = $this->conn->prepare(
      "SELECT * FROM {$this->logTable} WHERE id = :id"
    );
    $stmt->bindParam(':id', $id);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // ── Log entry by QR code ───────────────────────────────────────────────
  public function getLogByQR(string $qr_code)
  {
    $stmt = $this->conn->prepare(
      "SELECT * FROM {$this->logTable} WHERE qr_code = :qr_code ORDER BY id DESC LIMIT 1"
    );
    $stmt->bindParam(':qr_code', $qr_code);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // ── IN/OUT history for one employee from check_in_out ─────────────────
  public function getCheckInOutHistory(int $employeeId)
  {
    $stmt = $this->conn->prepare(
      "SELECT * FROM {$this->checkTable}
       WHERE employee_id = :employee_id
       ORDER BY scan_timestamp DESC"
    );
    $stmt->bindParam(':employee_id', $employeeId);
    $stmt->execute();
    return $stmt->fetchAll(PDO::FETCH_ASSOC);
  }

  // ── Current IN/OUT status for one employee (most recent check_in_out row)
  public function getCurrentCheckStatus(int $employeeId, string $qrCode = null)
  {
    if ($qrCode) {
      $stmt = $this->conn->prepare(
        "SELECT check_type FROM {$this->checkTable}
         WHERE employee_id = :employee_id OR qr_code = :qr_code
         ORDER BY scan_timestamp DESC, id DESC
         LIMIT 1"
      );
      $stmt->execute([':employee_id' => $employeeId, ':qr_code' => $qrCode]);
    } else {
      $stmt = $this->conn->prepare(
        "SELECT check_type FROM {$this->checkTable}
         WHERE employee_id = :employee_id
         ORDER BY scan_timestamp DESC, id DESC
         LIMIT 1"
      );
      $stmt->execute([':employee_id' => $employeeId]);
    }

    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ? $row['check_type'] : 'OUT';
  }

  // ── DELETE: single log entry ───────────────────────────────────────────
  public function deleteLog(int $id)
  {
    $log = $this->getLog($id);

    $stmt = $this->conn->prepare(
      "DELETE FROM {$this->logTable} WHERE id = :id"
    );
    $stmt->bindParam(':id', $id);
    $result = $stmt->execute();

    if ($result && $this->userId && $log) {
      logSystemAction(
        $this->userId,
        'ACCESS_LOG_DELETED',
        "Deleted access log entry #{$id} for: " . ($log['fullname'] ?? 'unknown')
      );
    }

    return $result;
  }

  // ── DELETE: multiple log entries by ID list ───────────────────────────────
  public function deleteLogsByIds(array $logIds)
  {
    if (empty($logIds)) return 0;

    $placeholders = implode(',', array_fill(0, count($logIds), '?'));

    $stmt = $this->conn->prepare(
      "DELETE FROM {$this->logTable} WHERE id IN ({$placeholders})"
    );
    $stmt->execute($logIds);
    $deleted = $stmt->rowCount();

    return $deleted;
  }

  // ── DELETE: all log entries (employee_access_log + check_in_out) ─────────────
  public function deleteAllLogs()
  {
    $this->conn->exec("DELETE FROM {$this->checkTable}");
    try {
      $this->conn->exec("ALTER TABLE {$this->checkTable} AUTO_INCREMENT = 1");
    } catch (Exception $e) {
      error_log("AUTO_INCREMENT reset warning (check_in_out): " . $e->getMessage());
    }

    $this->conn->exec("DELETE FROM {$this->logTable}");
    try {
      $this->conn->exec("ALTER TABLE {$this->logTable} AUTO_INCREMENT = 1");
    } catch (Exception $e) {
      error_log("AUTO_INCREMENT reset warning: " . $e->getMessage());
    }

    if ($this->userId) {
      logSystemAction($this->userId, 'ALL_LOGS_DELETED', 'Cleared log entries');
    }

    return true;
  }

  // ── STATS ──────────────────────────────────────────────────────────────
  public function getStats()
  {
    $stats = [
      'total' => 0,
      'active' => 0,
      'inactive' => 0,
      'check_counts' => [],
      'by_shift' => [],
      'by_access_type' => [],
      'today' => 0,
      'today_in' => 0,
      'today_out' => 0,
    ];

    try {
      $stmt = $this->conn->prepare(
        "SELECT COUNT(*) AS total, SUM(status = 'Active') AS active FROM {$this->logTable}"
      );
      $stmt->execute();
      $row = $stmt->fetch(PDO::FETCH_ASSOC);
      $stats['total']    = (int) $row['total'];
      $stats['active']   = (int) $row['active'];
      $stats['inactive'] = $stats['total'] - $stats['active'];
    } catch (Exception $e) {
      error_log("getStats total/active error: " . $e->getMessage());
    }

    try {
      $stmt = $this->conn->prepare(
        "SELECT check_type, COUNT(*) as cnt FROM {$this->checkTable} GROUP BY check_type"
      );
      $stmt->execute();
      foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $check) {
        $stats['check_counts'][$check['check_type']] = $check['cnt'];
      }
    } catch (Exception $e) {
      error_log("getStats check_counts error: " . $e->getMessage());
    }

    try {
      $stmt = $this->conn->prepare(
        "SELECT shift, COUNT(*) as count FROM {$this->logTable} GROUP BY shift"
      );
      $stmt->execute();
      foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $shift) {
        $stats['by_shift'][$shift['shift']] = $shift['count'];
      }
    } catch (Exception $e) {
      error_log("getStats by_shift error: " . $e->getMessage());
    }

    try {
      $stmt = $this->conn->prepare(
        "SELECT access_type, COUNT(*) as count FROM {$this->logTable} GROUP BY access_type"
      );
      $stmt->execute();
      foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $access) {
        $stats['by_access_type'][$access['access_type']] = $access['count'];
      }
    } catch (Exception $e) {
      error_log("getStats by_access_type error: " . $e->getMessage());
    }

    try {
      $todayStart = date('Y-m-d');
      $todayEnd   = date('Y-m-d', strtotime('+1 day'));

      $stmt = $this->conn->prepare(
        "SELECT
          SUM(access_timestamp >= :today_start1 AND access_timestamp < :today_end1) AS today,
          SUM(check_status = 'IN'  AND access_timestamp >= :today_start2 AND access_timestamp < :today_end2) AS today_in,
          SUM(check_status = 'OUT' AND access_timestamp >= :today_start3 AND access_timestamp < :today_end3) AS today_out
        FROM {$this->logTable}"
      );
      $stmt->execute([
        ':today_start1' => $todayStart,
        ':today_end1' => $todayEnd,
        ':today_start2' => $todayStart,
        ':today_end2' => $todayEnd,
        ':today_start3' => $todayStart,
        ':today_end3' => $todayEnd,
      ]);
      $row = $stmt->fetch(PDO::FETCH_ASSOC);
      $stats['today']     = (int) $row['today'];
      $stats['today_in']  = (int) $row['today_in'];
      $stats['today_out'] = (int) $row['today_out'];
    } catch (Exception $e) {
      error_log("getStats today error: " . $e->getMessage());
    }

    return $stats;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FileUploader — only used here for serving/deleting images referenced in logs
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeFilename(string $filename)
{
  return preg_replace('/[^a-zA-Z0-9_\.-]/', '', $filename);
}

class FileUploader
{
  private string $upload_dir;
  private array $allowed_types = ['jpg', 'jpeg', 'png', 'gif'];
  private int $max_size      = 5 * 1024 * 1024;

  public function __construct(?int $userId = null)
  {
    $this->upload_dir = rtrim($_SERVER['DOCUMENT_ROOT'], '/') . '/public/uploads/user/';

    if (!is_dir($this->upload_dir)) {
      if (!mkdir($this->upload_dir, 0755, true)) {
        throw new Exception("Failed to create upload directory: " . $this->upload_dir);
      }
    }

    if (!is_writable($this->upload_dir)) {
      throw new Exception("Upload directory is not writable: " . $this->upload_dir);
    }
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

// ─────────────────────────────────────────────────────────────────────────────
// Main request handler
// ─────────────────────────────────────────────────────────────────────────────
try {
  if (!isset($_SESSION['user_id'])) {
    $response = ['success' => false, 'message' => 'Authentication required. Please log in.'];

    if (
      !empty($_SERVER['HTTP_X_REQUESTED_WITH']) &&
      strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest'
    ) {
      header('Content-Type: application/json');
      echo json_encode($response);
      exit;
    }

    header('Location:', ROUTE_LOGIN);
    exit;
  }

  $database   = new Database();
  $logManager = new AccessLogManager($database);
  $fileUploader = new FileUploader($database->getCurrentUserId());

  $response = ['success' => false, 'message' => '', 'data' => null];

  // ── POST actions ─────────────────────────────────────────────────────────────
  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = sanitizeInput($_POST['action'] ?? '');

    if (!in_array($action, ALLOWED_POST_ACTIONS, true)) {
      $response['message'] = 'Invalid action specified.';
      goto send_response;
    }

    switch ($action) {

      case 'delete':
        $log_id = sanitizeInput($_POST['id'] ?? 0);

        if (!$log_id) {
          $response['message'] = 'Log entry ID is required';
          break;
        }

        try {
          $deleted = $logManager->deleteLog($log_id);

          if ($deleted) {
            $response['success'] = true;
            $response['message'] = 'Log entry deleted successfully';
          } else {
            $response['message'] = 'Failed to delete log entry';
          }
        } catch (Exception $e) {
          $response['message'] = 'Delete error: ' . $e->getMessage();
        }
        break;

      case 'delete_filtered':
        $log_ids = safeJsonDecode($_POST['employee_ids'] ?? '[]') ?: [];
        $filters = safeJsonDecode($_POST['filters']      ?? '{}') ?: [];

        if (empty($log_ids)) {
          $response['message'] = 'No log entries to delete';
          break;
        }

        try {
          $db = $database->getUserConnection();
          $db->beginTransaction();

          $deleted_count = $logManager->deleteLogsByIds($log_ids);

          if ($deleted_count > 0) {
            $db->commit();

            $filterStr = implode(', ', array_map(
              fn($k, $v) => sanitizeInput($k) . ': ' . sanitizeInput($v),
              array_keys($filters),
              $filters
            )) ?: 'All';

            $response['success']       = true;
            $response['message']       = "Deleted $deleted_count log entry/entries matching filters: $filterStr";
            $response['deleted_count'] = $deleted_count;

            logSystemAction(
              $database->getCurrentUserId(),
              'FILTERED_LOGS_DELETED',
              "Deleted $deleted_count log entries — filters: $filterStr"
            );
          } else {
            $db->rollBack();
            $response['message'] = 'Failed to delete log entries';
          }
        } catch (Exception $e) {
          if (isset($db)) $db->rollBack();
          $response['message'] = 'Delete filtered error: ' . $e->getMessage();
        }
        break;

      case 'delete_all':
        try {
          $result    = $logManager->getLogs([], 1, 1);
          $log_count = $result['total'];

          if ($log_count === 0) {
            $response['success'] = false;
            $response['message'] = 'No log data to delete';
            break;
          }

          $db = $database->getUserConnection();
          $db->beginTransaction();

          $logManager->deleteAllLogs();

          $db->commit();

          $log_label   = $log_count > 1 ? "record's" : "record";

          $response['success'] = true;
          $response['message'] = "All log data deleted successfully. $log_count $log_label removed.";
        } catch (Exception $e) {
          if (isset($db)) {
            try {
              $db->rollBack();
            } catch (Exception $re) {
              error_log("Rollback failed: " . $re->getMessage());
            }
          }
          $response['message'] = 'Delete all error: ' . $e->getMessage();
        }
        break;

      case 'get_stats':
        try {
          $response['success'] = true;
          $response['data']    = $logManager->getStats();
        } catch (Exception $e) {
          $response['message'] = 'Error getting statistics: ' . $e->getMessage();
        }
        break;

      case 'get_checkinout_history':
        $employee_id = sanitizeInput($_POST['employee_id'] ?? 0);

        if (!$employee_id) {
          $response['message'] = 'Employee ID is required';
          break;
        }

        try {
          $history = $logManager->getCheckInOutHistory($employee_id);
          $response['success'] = true;
          $response['data']    = $history;
        } catch (Exception $e) {
          $response['message'] = 'Error getting check-in/out history: ' . $e->getMessage();
        }
        break;

      case 'search_qr':
        $qr_code = sanitizeInput($_POST['qr_code'] ?? '');

        if (empty($qr_code)) {
          $response['message'] = 'QR code is required';
          break;
        }

        try {
          $log = $logManager->getLogByQR($qr_code);

          if ($log) {
            $response['success'] = true;
            $response['data']    = $log;
            $response['message'] = 'Log entry found';
          } else {
            $response['message'] = 'No log entry found for this employee';
          }
        } catch (Exception $e) {
          $response['message'] = 'QR search error: ' . $e->getMessage();
        }
        break;

      case 'backup_data':
        try {
          $logs  = $logManager->getLogs([]);
          $stats = $logManager->getStats();

          $backup_data = [
            'timestamp'    => date('Y-m-d H:i:s'),
            'user_id'      => $database->getCurrentUserId(),
            'total_logs'   => count($logs),
            'logs'         => $logs,
            'statistics'   => $stats,
          ];

          $filename = 'DataLog_User' . $database->getCurrentUserId() . '_' . date('Y-m-d_H-i-s') . '.json';

          header('Content-Type: application/json');
          header('Content-Disposition: attachment; filename="' . $filename . '"');

          echo json_encode($backup_data, JSON_PRETTY_PRINT);

          logSystemAction(
            $database->getCurrentUserId(),
            'DATALOG_BACKUP',
            'Exported ' . count($logs) . ' log entries'
          );
          exit;
        } catch (Exception $e) {
          $response['message'] = 'Backup error: ' . $e->getMessage();
        }
        break;

      default:
        $response['message'] = 'Invalid action: ' . $action;
        break;
    }

    // ── GET actions ───────────────────────────────────────────────────────────────
  } elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = sanitizeInput($_GET['action'] ?? '');

    if (!empty($action) && !in_array($action, ALLOWED_GET_ACTIONS, true)) {
      $response['message'] = 'Invalid GET action.';
      goto send_response;
    }

    switch ($action) {

      case 'get':
      case 'list':
        $filters = [];

        if (!empty($_GET['employee_id']))       $filters['employee_id']      = sanitizeInput($_GET['employee_id']);
        if (!empty($_GET['fullname']))          $filters['fullname']         = sanitizeInput($_GET['fullname']);
        if (!empty($_GET['position']))          $filters['position']         = sanitizeInput($_GET['position']);
        if (!empty($_GET['position_none']))     $filters['position_none']    = '1';
        if (!empty($_GET['brand']))             $filters['brand']            = sanitizeInput($_GET['brand']);
        if (!empty($_GET['brand_none']))        $filters['brand_none']       = '1';
        if (!empty($_GET['status']))            $filters['status']           = sanitizeInput($_GET['status']);
        if (!empty($_GET['status_none']))       $filters['status_none']      = '1';
        if (!empty($_GET['shift']))             $filters['shift']            = sanitizeInput($_GET['shift']);
        if (!empty($_GET['shift_none']))        $filters['shift_none']       = '1';
        if (!empty($_GET['violation']))         $filters['violation']        = sanitizeInput($_GET['violation']);
        if (!empty($_GET['violation_none']))    $filters['violation_none']   = '1';
        if (!empty($_GET['qr_code']))           $filters['qr_code']          = sanitizeInput($_GET['qr_code']);
        if (!empty($_GET['check_status']))      $filters['check_status']     = sanitizeInput($_GET['check_status']);
        if (!empty($_GET['user_id']))           $filters['user_id']          = sanitizeInput($_GET['user_id']);
        if (!empty($_GET['gate_name']))         $filters['gate_name']        = sanitizeInput($_GET['gate_name']);
        if (!empty($_GET['user_id_none']))      $filters['user_id_none']     = '1';
        if (!empty($_GET['access_type']))       $filters['access_type']      = sanitizeInput($_GET['access_type']);
        if (!empty($_GET['access_timestamp'])) {
          $d = sanitizeInput($_GET['access_timestamp']);
          if (preg_match('/^\d{4}-\d{2}(-\d{2})?$/', $d)) $filters['access_timestamp'] = $d;
        }
        if (!empty($_GET['date_from'])) {
          $d = sanitizeInput($_GET['date_from']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}?$/', $d)) $filters['date_from'] = $d;
        }
        if (!empty($_GET['date_to'])) {
          $d = sanitizeInput($_GET['date_to']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}?$/', $d)) $filters['date_to'] = $d;
        }
        if (!empty($_GET['sort_col'])) $filters['sort_col'] = sanitizeInput($_GET['sort_col']);
        if (!empty($_GET['sort_dir'])) $filters['sort_dir'] = sanitizeInput($_GET['sort_dir']);

        $page  = max(1, (int)($_GET['page']  ?? 1));
        $limit = max(1, (int)($_GET['limit'] ?? 25));

        $isSilent = (
          !empty($_SERVER['HTTP_X_SILENT_REQUEST']) &&
          strtolower($_SERVER['HTTP_X_SILENT_REQUEST']) === 'true'
        );

        // ── Only run the expensive DISTINCT filter-options scan when it's
        //    actually needed: the caller is applying a filter, or explicitly
        //    asked for it (e.g. first page load, to seed the filter dropdowns).
        //    Plain pagination / sorting / silent auto-update polls skip it.
        $filterFieldKeys  = array_diff(array_keys($filters), ['sort_col', 'sort_dir']);
        $hasFilterFields  = !empty($filterFieldKeys);
        $filterOptionsReq = $_GET['filter_options'] ?? null;
        $wantFilterOptions = $filterOptionsReq === '0'
          ? false
          : ($filterOptionsReq === '1' ? true : ($hasFilterFields && !$isSilent));

        try {
          $result = $logManager->getLogs($filters, $page, $limit);

          $response['success'] = true;
          $response['data']    = $result['data'];
          $response['total']   = $result['total'];
          $response['page']    = $page;
          $response['pages']   = ceil($result['total'] / $limit);

          if ($wantFilterOptions) {
            $filterOptions = $logManager->getFilterOptions($filters);

            $fieldFilterOptions = [
              'employee_id'   => [],
              'fullname'      => [],
              'position'      => [],
              'brand'         => [],
              'status'        => [],
              'shift'         => [],
              'violation'     => [],
              'check_status'  => [],
              'user_id'       => [],
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

          try {
            $response['stats'] = $logManager->getStats();
          } catch (Exception $statsError) {
            error_log("getStats error: " . $statsError->getMessage());
            $response['stats'] = null;
          }
        } catch (Exception $e) {
          error_log("getLogs error: " . $e->getMessage());
          $response['message'] = 'Error retrieving logs: ' . $e->getMessage();
        }
        break;

      case 'get_single':
        $log_id = sanitizeInput($_GET['id'] ?? 0);

        if (!$log_id) {
          $response['message'] = 'Log entry ID is required';
          break;
        }

        try {
          $log = $logManager->getLog($log_id);
          if ($log) {
            $response['success'] = true;
            $response['data']    = $log;
          } else {
            $response['message'] = 'Log entry not found';
          }
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving log entry: ' . $e->getMessage();
        }
        break;

      case 'current_status':
        $employee_id = sanitizeInput($_GET['employee_id'] ?? 0);
        $qr_code     = sanitizeInput($_GET['qr_code']     ?? null);

        if (!$employee_id) {
          $response['message'] = 'Employee ID is required';
          break;
        }

        try {
          $status = $logManager->getCurrentCheckStatus($employee_id, $qr_code);
          $response['success'] = true;
          $response['data']    = ['check_status' => $status];
        } catch (Exception $e) {
          $response['message'] = 'Error getting status: ' . $e->getMessage();
        }
        break;

      case 'check_qr':
        $qr_code = sanitizeInput($_GET['qr_code'] ?? '');

        if (empty($qr_code)) {
          $response['message'] = 'Proximity code parameter is required';
          break;
        }

        try {
          $log = $logManager->getLogByQR($qr_code);

          $response['success'] = true;
          $response['exists']  = (bool)$log;
          $response['data']    = $log ?: null;
          $response['message'] = $log ? 'Log entry found' : 'No log entry for this employee';
        } catch (Exception $e) {
          $response['message'] = 'Error checking Proximity code: ' . $e->getMessage();
        }
        break;

      case 'stats':
        try {
          $response['success'] = true;
          $response['data']    = $logManager->getStats();
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

  if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest') {
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
    'message' => 'System error: ' . $e->getMessage(),
  ];

  error_log("DataLog System Error: " . $e->getMessage());

  if (isset($_SESSION['user_id'])) {
    logSystemAction($_SESSION['user_id'], 'SYSTEM_ERROR', $e->getMessage());
  }

  if (!empty($_SERVER['HTTP_X_REQUESTED_WITH']) && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest') {
    header('Content-Type: application/json');
    echo json_encode($error_response);
    exit;
  }

  $_SESSION['error_message'] = $error_response['message'];
}

// ─────────────────────────────────────────────────────────────────────────────
// File-serving helper (for images referenced in log rows)
// ─────────────────────────────────────────────────────────────────────────────
function serveFile(string $filepath, string $filename = null)
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

  header('Content-Type: ' . $content_type);
  header('Content-Disposition: attachment; filename="' . $filename . '"');
  header('Content-Length: ' . filesize($filepath));
  header('Cache-Control: no-cache, must-revalidate');
  header('Expires: 0');

  readfile($filepath);
  exit;
}

if (isset($_GET['serve_file'])) {
  $userId = sanitizeInput($_SESSION['user_id'] ?? null);

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
    'name'        => 'Datalog Management System',
    'description' => 'Read / delete access for employee_access_log and check_in_out; gate_name resolved from main users table',
    'features'    => [
      'Transaction Support'       => 'Database transactions on filtered delete and delete-all',
      'Audit Logging'             => 'Full audit trail via logSystemAction() on every mutating operation',
      'Filtered Delete'           => 'Delete log entries by explicit ID list derived from active search filters',
      'Gate Name Hydration'       => 'user_id values in log rows are resolved to first_name from the main users table',
      'Check-In/Out History'      => 'Per-employee IN/OUT scan history from check_in_out table',
      'Stats'                     => 'Total, active/inactive, today counts, today IN/OUT counts, shift and access-type breakdowns',
      'Backup'                    => 'POST backup_data streams a timestamped JSON export of all log rows + stats',
    ],
    'endpoints' => [
      'POST' => [
        'delete'                  => 'Delete a single log entry by id',
        'delete_filtered'         => 'Delete log entries by explicit ID list',
        'delete_all'              => 'Truncate both employee_access_log and check_in_out; resets AUTO_INCREMENT',
        'get_stats'               => 'Return log statistics (total, active, inactive, today, today_in, today_out, by_shift, check_counts, by_access_type)',
        'get_checkinout_history'  => 'Return all check_in_out rows for a given employee_id',
        'search_qr'               => 'Find employee by exact proximity value',
        'backup_data'             => 'Stream all log rows as a downloadable JSON backup file',
      ],
      'GET' => [
        'get / list'              => 'Paginated log list with server-side filters, sort, gate_name hydration, and field_filter_options',
        'get_single'              => 'Fetch one employee log by id',
        'current_status'          => 'Return the most recent check_type (IN/OUT) for an employee from check_in_out',
        'check_qr'                => 'Check whether a proximity is already assigned to an employee',
        'stats'                   => 'Same as POST get_stats',
        'user_info'               => 'Return session user_id, username, email, first_name, last_name',
        'health_check'            => 'Verify main DB and user DB connectivity; returns JSON (bypasses XHR check)',
      ],
    ],
    'query_parameters' => [
      'Filters'                   => 'fullname, position, brand, status, shift, violation, qr_code, check_status, user_id, gate_name, access_type, access_timestamp, date_from, date_to',
      'None filters'              => 'position_none, brand_none, status_none, shift_none, violation_none, user_id_none',
      'Sorting'                   => 'sort_col (fullname|brand|shift|violation|access_timestamp|check_status|gate_name), sort_dir (asc|desc)',
      'Paging'                    => 'page (default 1), limit (default 25)',
    ],
    'authentication'              => 'Session-based ($_SESSION[user_id] required for every request)',
    'database'                    => 'Per-user databases; main DB holds users table for gate-name resolution',
  ];
}

if (isset($_GET['api_info'])) {
  header('Content-Type: application/json');
  echo json_encode(getAPIInfo(), JSON_PRETTY_PRINT);
  exit;
}