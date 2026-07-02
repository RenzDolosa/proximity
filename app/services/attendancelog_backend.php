<?php
// app/services/attendancelog_backend.php --> attendance log table backend

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
  'delete',
  'delete_filtered',
  'delete_all',
  'get_stats',
  'search_qr',
];

const ALLOWED_GET_ACTIONS = [
  'get',
  'list',
  'get_single',
  'check_qr',
  'stats',
  'user_info',
  'health_check',
];

// ── Safe json_decode wrapper ──────────────────────────────────────────────────
function safeJsonDecode($json, $assoc = true, $depth = 32)
{
  if (!is_string($json) || $json === '') return null;
  try {
    return json_decode($json, $assoc, $depth, JSON_THROW_ON_ERROR);
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

// ============================================================================
// AccessLogManager — CRUD for employee_attendance_log only
// ============================================================================
class AccessLogManager
{
  private $conn;
  private $logTable = 'employee_attendance_log';
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

  // ── List logs with optional filters & pagination ───────────────────────
  public function getLogs($filters = [], $page = 1, $limit = 25)
  {
    $where  = "WHERE 1=1";
    $params = [];

    if (!empty($filters['employee_id'])) {
      $where .= " AND employee_id = :employee_id";
      $params[':employee_id']     = $filters['employee_id'];
    }
    if (!empty($filters['fullname'])) {
      $where .= " AND fullname LIKE :fullname";
      $params[':fullname'] = '%' . $filters['fullname'] . '%';
    }
    if (!empty($filters['position'])) {
      $where .= " AND position LIKE :position";
      $params[':position'] = $filters['position'];
    }
    if (!empty($filters['position_none'])) {
      $where .= " AND (position IS NULL OR TRIM(position) = '' OR LOWER(TRIM(position)) = 'none')";
    }
    if (!empty($filters['brand'])) {
      $where .= " AND brand LIKE :brand";
      $params[':brand'] = $filters['brand'];
    }
    if (!empty($filters['brand_none'])) {
      $where .= " AND (brand IS NULL OR TRIM(brand) = '' OR LOWER(TRIM(brand)) = 'none')";
    }
    if (!empty($filters['status'])) {
      $where .= " AND status = :status";
      $params[':status'] = $filters['status'];
    }
    if (!empty($filters['status_none'])) {
      $where .= " AND (status IS NULL OR TRIM(status) = '' OR LOWER(TRIM(status)) = 'none')";
    }
    if (!empty($filters['shift'])) {
      $where .= " AND shift = :shift";
      $params[':shift'] = $filters['shift'];
    }
    if (!empty($filters['shift_none'])) {
      $where .= " AND (shift IS NULL OR TRIM(shift) = '' OR LOWER(TRIM(shift)) = 'none')";
    }
    if (!empty($filters['violation'])) {
      $where .= " AND violation LIKE :violation";
      $params[':violation'] = '%' . $filters['violation'] . '%';
    }
    if (!empty($filters['violation_none'])) {
      $where .= " AND (violation IS NULL OR TRIM(violation) = '' OR LOWER(TRIM(violation)) = 'none')";
    }
    if (!empty($filters['qr_code'])) {
      $where .= " AND qr_code LIKE :qr_code";
      $params[':qr_code'] = $filters['qr_code'];
    }
    if (!empty($filters['user_id'])) {
      $where .= " AND user_id LIKE :user_id";
      $params[':user_id'] = '%' . $filters['user_id'] . '%';
    }
    if (!empty($filters['gate_name'])) {
      $where .= " AND user_id IN (SELECT id FROM " . DB_NAME . ".users WHERE first_name LIKE :gate_name)";
      $params[':gate_name'] = '%' . $filters['gate_name'] . '%';
    }
    if (!empty($filters['user_id_none'])) {
      $where .= " AND (user_id IS NULL OR TRIM(user_id) = '' OR LOWER(TRIM(user_id)) = 'none')";
    }
    if (!empty($filters['access_type'])) {
      $where .= " AND access_type LIKE :access_type";
      $params[':access_type'] = '%' . $filters['access_type'] . '%';
    }
    if (!empty($filters['access_timestamp'])) {
      $where .= " AND access_timestamp LIKE :access_timestamp";
      $params[':access_timestamp'] = '%' . $filters['access_timestamp'] . '%';
    }
    if (!empty($filters['date_from'])) {
      $where .= " AND DATE(access_timestamp) >= :date_from";
      $params[':date_from'] = $filters['date_from'];
    }
    if (!empty($filters['date_to'])) {
      $where .= " AND DATE(access_timestamp) <= :date_to";
      $params[':date_to'] = $filters['date_to'];
    }

    // ── Build ORDER BY ────────────────────────────────────────────────
    $allowed_sort_cols = ['employee_id', 'fullname', 'brand', 'shift', 'violation', 'access_timestamp', 'gate_name'];
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
      $where .= " AND DATE(access_timestamp) >= :date_from";
      $params[':date_from'] = $baseFilters['date_from'];
    }
    if (!empty($baseFilters['date_to'])) {
      $where .= " AND DATE(access_timestamp) <= :date_to";
      $params[':date_to'] = $baseFilters['date_to'];
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
  public function getLog($id)
  {
    $stmt = $this->conn->prepare(
      "SELECT * FROM {$this->logTable} WHERE id = :id"
    );
    $stmt->bindParam(':id', $id);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // ── Log entry by QR code ───────────────────────────────────────────────
  public function getLogByQR($qr_code)
  {
    $stmt = $this->conn->prepare(
      "SELECT * FROM {$this->logTable} WHERE qr_code = :qr_code ORDER BY id DESC LIMIT 1"
    );
    $stmt->bindParam(':qr_code', $qr_code);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // ── DELETE: single log entry ───────────────────────────────────────────
  public function deleteLog($id)
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
        'ATTENDANCE_LOG_DELETED',
        "Deleted attendance log entry #{$id} for: " . ($log['fullname'] ?? 'unknown')
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

  // ── DELETE: all log entries ────────────────────────────────────────────
  public function deleteAllLogs()
  {
    $this->conn->exec("DELETE FROM {$this->logTable}");
    try {
      $this->conn->exec("ALTER TABLE {$this->logTable} AUTO_INCREMENT = 1");
    } catch (Exception $e) {
      error_log("AUTO_INCREMENT reset warning: " . $e->getMessage());
    }

    if ($this->userId) {
      logSystemAction($this->userId, 'ALL_LOGS_DELETED', 'Cleared attendance');
    }

    return true;
  }

  // ── STATS ──────────────────────────────────────────────────────────────
  public function getStats()
  {
    $stats = [];

    $stmt = $this->conn->prepare(
      "SELECT COUNT(*) as total FROM {$this->logTable}"
    );
    $stmt->execute();
    $stats['total'] = (int) $stmt->fetch(PDO::FETCH_ASSOC)['total'];

    $stmt = $this->conn->prepare(
      "SELECT COUNT(*) as active FROM {$this->logTable} WHERE status = 'Active'"
    );
    $stmt->execute();
    $stats['active']   = (int) $stmt->fetch(PDO::FETCH_ASSOC)['active'];
    $stats['inactive'] = $stats['total'] - $stats['active'];

    $stmt = $this->conn->prepare(
      "SELECT shift, COUNT(*) as count FROM {$this->logTable} GROUP BY shift"
    );
    $stmt->execute();
    $shiftData = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $stats['by_shift'] = [];
    foreach ($shiftData as $shift) {
      $stats['by_shift'][$shift['shift']] = $shift['count'];
    }

    $stmt = $this->conn->prepare(
      "SELECT access_type, COUNT(*) AS count FROM {$this->logTable} GROUP BY access_type"
    );
    $stmt->execute();
    $accessData = $stmt->fetchAll(PDO::FETCH_ASSOC);
    $stats['by_access_type'] = [];
    foreach ($accessData as $access) {
      $stats['by_access_type'][$access['access_type']] = $access['count'];
    }

    $stmt = $this->conn->prepare(
      "SELECT COUNT(*) AS today FROM {$this->logTable} WHERE DATE(access_timestamp) = CURDATE()"
    );
    $stmt->execute();
    $stats['today'] = (int) $stmt->fetch(PDO::FETCH_ASSOC)['today'];

    return $stats;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FileUploader — serves/validates images referenced in log rows
// ─────────────────────────────────────────────────────────────────────────────
function sanitizeFilename($filename)
{
  return preg_replace('/[^a-zA-Z0-9_\.-]/', '', $filename);
}

class FileUploader
{
  private $upload_dir;
  private $allowed_types = ['jpg', 'jpeg', 'png', 'gif'];
  private $max_size      = 5 * 1024 * 1024;

  public function __construct($userId = null)
  {
    $this->upload_dir = '/public/uploads/user/';

    if (!is_dir($this->upload_dir)) {
      if (!mkdir($this->upload_dir, 0755, true)) {
        throw new Exception("Failed to create upload directory: " . $this->upload_dir);
      }
    }

    if (!is_writable($this->upload_dir)) {
      throw new Exception("Upload directory is not writable: " . $this->upload_dir);
    }
  }

  public function getImagePath($filename)
  {
    return $this->upload_dir . basename($filename);
  }

  public function imageExists($filename)
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

  $database     = new Database();
  $logManager   = new AccessLogManager($database);
  $fileUploader = new FileUploader($database->getCurrentUserId());

  $response = ['success' => false, 'message' => '', 'data' => null];

  // ── POST actions ───────────────────────────────────────────────────────────
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
            $response['message'] = 'Attendance deleted successfully';
          } else {
            $response['message'] = 'Failed to delete attendance';
          }
        } catch (Exception $e) {
          $response['message'] = 'Delete error: ' . $e->getMessage();
        }
        break;

      case 'delete_filtered':
        $log_ids = safeJsonDecode($_POST['employee_ids'] ?? '[]') ?: [];
        $filters = safeJsonDecode($_POST['filters']      ?? '{}') ?: [];

        if (empty($log_ids)) {
          $response['message'] = 'No attendance to delete';
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
            $response['message']       = "Deleted $deleted_count attendance matching filters: $filterStr";
            $response['deleted_count'] = $deleted_count;

            logSystemAction(
              $database->getCurrentUserId(),
              'FILTERED_LOGS_DELETED',
              "Deleted $deleted_count attendance — filters: $filterStr"
            );
          } else {
            $db->rollBack();
            $response['message'] = 'Failed to delete attendance';
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

          $log_label = $log_count > 1 ? "record's" : "record";

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
            $response['message'] = 'Attendance found';
          } else {
            $response['message'] = 'No attendance found for this employee';
          }
        } catch (Exception $e) {
          $response['message'] = 'QR search error: ' . $e->getMessage();
        }
        break;

      default:
        $response['message'] = 'Invalid action: ' . $action;
        break;
    }

    // ── GET actions ────────────────────────────────────────────────────────────
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
        if (!empty($_GET['user_id']))           $filters['user_id']          = sanitizeInput($_GET['user_id']);
        if (!empty($_GET['gate_name']))         $filters['gate_name']        = sanitizeInput($_GET['gate_name']);
        if (!empty($_GET['user_id_none']))      $filters['user_id_none']     = '1';
        if (!empty($_GET['access_type']))       $filters['access_type']      = sanitizeInput($_GET['access_type']);
        if (!empty($_GET['access_timestamp'])) {
          $d = sanitizeInput($_GET['access_timestamp']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['access_timestamp'] = $d;
        }
        if (!empty($_GET['date_from'])) {
          $d = sanitizeInput($_GET['date_from']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['date_from'] = $d;
        }
        if (!empty($_GET['date_to'])) {
          $d = sanitizeInput($_GET['date_to']);
          if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) $filters['date_to'] = $d;
        }
        if (!empty($_GET['sort_col'])) $filters['sort_col'] = sanitizeInput($_GET['sort_col']);
        if (!empty($_GET['sort_dir'])) $filters['sort_dir'] = sanitizeInput($_GET['sort_dir']);

        $page  = max(1, (int)($_GET['page']  ?? 1));
        $limit = max(1, (int)($_GET['limit'] ?? 25));

        try {
          $result = $logManager->getLogs($filters, $page, $limit);
          $filterOptions = $logManager->getFilterOptions($filters);

          $fieldFilterOptions = [
            'employee_id'   => [],
            'fullname'      => [],
            'position'      => [],
            'brand'         => [],
            'status'        => [],
            'shift'         => [],
            'violation'     => [],
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

          $response['success']              = true;
          $response['data']                 = $result['data'];
          $response['total']                = $result['total'];
          $response['page']                 = $page;
          $response['pages']                = ceil($result['total'] / $limit);
          $response['filter_options']       = $filterOptions;
          $response['field_filter_options'] = $fieldFilterOptions;
        } catch (Exception $e) {
          error_log("getLogs error: " . $e->getMessage());
          $response['message'] = 'Error retrieving logs: ' . $e->getMessage();
        }
        break;

      case 'get_single':
        $log_id = sanitizeInput($_GET['id'] ?? 0);

        if (!$log_id) {
          $response['message'] = 'Attendance ID is required';
          break;
        }

        try {
          $log = $logManager->getLog($log_id);
          if ($log) {
            $response['success'] = true;
            $response['data']    = $log;
          } else {
            $response['message'] = 'Attendance not found';
          }
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving attendance: ' . $e->getMessage();
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
          $response['message'] = $log ? 'Attendance found' : 'No attendance for this employee';
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
          'user_id'             => sanitizeInput($_SESSION['user_id'] ?? null),
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

  error_log("AttendanceLog System Error: " . $e->getMessage());

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
    'name'        => 'Attendance Log Management System',
    'description' => 'Read / delete access for employee_attendance_log; gate_name resolved from main users table',
    'features'    => [
      'Transaction Support'     => 'Database transactions on filtered delete and delete-all',
      'Audit Logging'           => 'Full audit trail via logSystemAction() on every mutating operation',
      'Filtered Delete'         => 'Delete attendance rows by explicit ID list derived from active search filters',
      'Gate Name Hydration'     => 'user_id values in log rows are resolved to first_name from the main users table',
      'Stats'                   => 'Total, active/inactive, today count, shift and access-type breakdowns',
    ],
    'endpoints' => [
      'POST' => [
        'delete'                => 'Delete a single attendance row by id',
        'delete_filtered'       => 'Delete attendance rows by explicit ID list',
        'delete_all'            => 'Truncate employee_attendance_log; resets AUTO_INCREMENT',
        'get_stats'             => 'Return attendance statistics (total, active, inactive, today, by_shift, by_access_type)',
        'search_qr'             => 'Find employee by exact proximity value',
      ],
      'GET' => [
        'get / list'            => 'Paginated attendance list with server-side filters, sort, gate_name hydration, and field_filter_options',
        'get_single'            => 'Fetch one attendance row by id',
        'check_qr'              => 'Check whether a proximity is already assigned to an employee',
        'stats'                 => 'Same as POST get_stats',
        'user_info'             => 'Return session user_id, username, email, first_name, last_name',
        'health_check'          => 'Verify main DB and user DB connectivity; returns JSON (bypasses XHR check)',
      ],
    ],
    'query_parameters' => [
      'Filters'                 => 'fullname, position, brand, status, shift, violation, qr_code, user_id, gate_name, access_type, access_timestamp, date_from, date_to',
      'None filters'            => 'position_none, brand_none, status_none, shift_none, violation_none, user_id_none',
      'Sorting'                 => 'sort_col (fullname|brand|shift|violation|access_timestamp|gate_name), sort_dir (asc|desc)',
      'Paging'                  => 'page (default 1), limit (default 25)',
    ],
    'authentication'            => 'Session-based ($_SESSION[user_id] required for every request)',
    'database'                  => 'Per-user databases; main DB holds users table for gate-name resolution',
  ];
}

if (isset($_GET['api_info'])) {
  header('Content-Type: application/json');
  echo json_encode(getAPIInfo(), JSON_PRETTY_PRINT);
  exit;
}
