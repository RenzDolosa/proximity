<?php
// app/services/datalog_backend.php --> datalog table backend

require_once __DIR__ . '/../../config/config.php';

// Safety-net: re-assert PHP timezone in case this file is ever bootstrapped
// without config.php (e.g. direct CLI invocation or a future refactor).
// config.php already calls date_default_timezone_set(APP_TIMEZONE) and sets
// APP_TIMEZONE / APP_TIMEZONE_TZ, so this is a no-op in normal operation.
if (!defined('APP_TIMEZONE')) {
  define('APP_TIMEZONE',    'Asia/Manila');
  define('APP_TIMEZONE_TZ', '+08:00');
}
date_default_timezone_set(APP_TIMEZONE);

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
        $result = createUserDatabase($this->currentUserId);
        if (!$result['success']) {
          throw new Exception("Failed to initialize user database: " . $result['error']);
        }
      }
      $this->userConn = getUserDBConnection($this->currentUserId);

      // ── Explicitly sync MySQL session timezone with PHP/app timezone ──
      // getUserDBConnection() already does this, but we set it again here
      // to guarantee correct CURRENT_TIMESTAMP behaviour for every query
      // made through this connection (access_timestamp, scan_timestamp, etc.)
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
// AccessLogManager — reads from employee_access_log (written by qr_search_backend.php)
// and check_in_out (IN/OUT toggle records, also written by qr_search_backend.php).
//
// Schema reminder:
//   employee_access_log: id, employee_id, fullname, position, brand, status,
//                        shift, violation, image, qr_code, access_type,
//                        ip_address, user_agent, check_status, access_timestamp
//   check_in_out:        id, employee_id, qr_code, fullname, check_type,
//                        scan_timestamp, ip_address, user_agent
// ============================================================================
class AccessLogManager
{
  private $conn;
  private $logTable    = 'employee_access_log'; // written by qr_search_backend.php
  private $checkTable  = 'check_in_out';        // IN/OUT toggle records
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

  // ── READ: access log entries with optional filters ──────────────────────────
  // Returns rows from employee_access_log ordered by most-recent first.
  // Each row already has check_status set by qr_search_backend.php at scan time.
  public function getLogs($filters = [])
  {
    // ── Step 1: fetch logs from user DB (no cross-DB JOIN) ──
    $query  = "SELECT * FROM {$this->logTable} l WHERE 1=1";
    $params = [];

    if (!empty($filters['fullname'])) {
      $query .= " AND fullname LIKE :fullname";
      $params[':fullname'] = '%' . $filters['fullname'] . '%';
    }
    if (!empty($filters['position'])) {
      $query .= " AND position LIKE :position";
      $params[':position'] = '%' . $filters['position'] . '%';
    }
    if (!empty($filters['position_none'])) {
      $query .= " AND (position IS NULL OR TRIM(position) = '' OR LOWER(TRIM(position)) = 'none')";
    }
    if (!empty($filters['brand'])) {
      $query .= " AND brand LIKE :brand";
      $params[':brand'] = '%' . $filters['brand'] . '%';
    }
    if (!empty($filters['brand_none'])) {
      $query .= " AND (brand IS NULL OR TRIM(brand) = '' OR LOWER(TRIM(brand)) = 'none')";
    }
    if (!empty($filters['status'])) {
      $query .= " AND status LIKE :status";
      $params[':status'] = '%' . $filters['status'] . '%';
    }
    if (!empty($filters['status_none'])) {
      $query .= " AND (status IS NULL OR TRIM(status) = '' OR LOWER(TRIM(status)) = 'none')";
    }
    if (!empty($filters['shift'])) {
      $query .= " AND shift LIKE :shift";
      $params[':shift'] = '%' . $filters['shift'] . '%';
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
      $params[':qr_code'] = '%' . $filters['qr_code'] . '%';
    }
    if (!empty($filters['check_status'])) {
      $query .= " AND check_status = :check_status";
      $params[':check_status'] = $filters['check_status'];
    }
    if (!empty($filters['user_id'])) {
      $query .= " AND user_id LIKE :user_id";
      $params[':user_id'] = '%' . $filters['user_id'] . '%';
    }
    if (!empty($filters['gate_name'])) {
      $query .= " AND user_id IN (
        SELECT id FROM " . DB_NAME . ".users 
        WHERE first_name LIKE :gate_name
      )";
      $params[':gate_name'] = '%' . $filters['gate_name'] . '%';
    }
    if (!empty($filters['user_id_none'])) {
      $query .= " AND (user_id IS NULL OR TRIM(user_id) = '' OR LOWER(TRIM(user_id)) = 'none')";
    }
    if (!empty($filters['access_type'])) {
      $query .= " AND access_type LIKE :access_type";
      $params[':access_type'] = '%' . $filters['access_type'] . '%';
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
    $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // ── Step 2: collect unique user_ids, look them up in main DB ──
    $userIds = array_unique(array_filter(array_column($logs, 'user_id')));

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

    // ── Step 3: attach gate_name to each log row ──
    foreach ($logs as &$log) {
      $uid = (int)($log['user_id'] ?? 0);
      $log['gate_name'] = $uid && isset($userNameMap[$uid])
        ? $userNameMap[$uid]
        : null;
    }
    unset($log);

    return $logs;
  }

  // ── READ: single log entry ───────────────────────────────────────────────────
  public function getLog($id)
  {
    $stmt = $this->conn->prepare(
      "SELECT * FROM {$this->logTable} WHERE id = :id"
    );
    $stmt->bindParam(':id', $id);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // ── READ: log entry by QR code ───────────────────────────────────────────────
  public function getLogByQR($qr_code)
  {
    $stmt = $this->conn->prepare(
      "SELECT * FROM {$this->logTable} WHERE qr_code = :qr_code ORDER BY id DESC LIMIT 1"
    );
    $stmt->bindParam(':qr_code', $qr_code);
    $stmt->execute();
    return $stmt->fetch(PDO::FETCH_ASSOC);
  }

  // ── READ: IN/OUT history for one employee from check_in_out ─────────────────
  public function getCheckInOutHistory($employeeId)
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

  // ── READ: current IN/OUT status for one employee (most recent check_in_out row)
  public function getCurrentCheckStatus($employeeId, $qrCode = null)
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
    return $row ? $row['check_type'] : 'OUT'; // default OUT = never checked in
  }

  // ── DELETE: single log entry from employee_access_log ───────────────────────
  // Does NOT touch employees or check_in_out.
  public function deleteLog($id)
  {
    $log = $this->getLog($id);

    $stmt = $this->conn->prepare(
      "DELETE FROM {$this->logTable} WHERE id = :id"
    );
    $stmt->bindParam(':id', $id);
    $result = $stmt->execute();

    if ($result && $log) {
      $checkStmt = $this->conn->prepare(
        "DELETE FROM {$this->checkTable}
       WHERE employee_id = :employee_id
          OR qr_code     = :qr_code"
      );
      $checkStmt->execute([
        ':employee_id' => $log['employee_id'] ?? null,
        ':qr_code'     => $log['qr_code']     ?? null,
      ]);
    }

    if ($result && $this->userId && $log) {
      logSystemAction(
        $this->userId,
        'ACCESS_LOG_DELETED',
        "Deleted access log entry #{$id} for: " . ($log['fullname'] ?? 'unknown')
      );
    }

    return $result;
  }

  // ── DELETE: multiple log entries by ID list ──────────────────────────────────
  public function deleteLogsByIds(array $logIds)
  {
    if (empty($logIds)) return 0;

    $placeholders = implode(',', array_fill(0, count($logIds), '?'));

    $fetchStmt = $this->conn->prepare(
      "SELECT employee_id, qr_code FROM {$this->logTable}
     WHERE id IN ({$placeholders})"
    );
    $fetchStmt->execute($logIds);
    $affected = $fetchStmt->fetchAll(PDO::FETCH_ASSOC);

    $employeeIds = array_unique(array_filter(array_column($affected, 'employee_id')));
    $qrCodes     = array_unique(array_filter(array_column($affected, 'qr_code')));

    $stmt = $this->conn->prepare(
      "DELETE FROM {$this->logTable} WHERE id IN ({$placeholders})"
    );
    $stmt->execute($logIds);
    $deleted = $stmt->rowCount();

    if ($deleted > 0 && (!empty($employeeIds) || !empty($qrCodes))) {
      $conditions = [];
      $params     = [];

      if (!empty($employeeIds)) {
        $ep = implode(',', array_fill(0, count($employeeIds), '?'));
        $conditions[] = "employee_id IN ({$ep})";
        $params = array_merge($params, $employeeIds);
      }
      if (!empty($qrCodes)) {
        $qp = implode(',', array_fill(0, count($qrCodes), '?'));
        $conditions[] = "qr_code IN ({$qp})";
        $params = array_merge($params, $qrCodes);
      }

      $checkStmt = $this->conn->prepare(
        "DELETE FROM {$this->checkTable} WHERE " . implode(' OR ', $conditions)
      );
      $checkStmt->execute($params);
    }

    return $deleted;
  }

  // ── DELETE: all log entries (employee_access_log + check_in_out) ─────────────
  public function deleteAllLogs()
  {
    // Delete check_in_out first (no FK to access_log, but keeps data consistent)
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
      error_log("AUTO_INCREMENT reset warning (employee_access_log): " . $e->getMessage());
    }

    if ($this->userId) {
      logSystemAction($this->userId, 'ALL_LOGS_DELETED', 'Cleared employee_access_log and check_in_out');
    }

    return true;
  }

  // ── STATS: summary counts from employee_access_log ───────────────────────────
  public function getStats()
  {
    $stats = [];

    $stmt = $this->conn->prepare("SELECT COUNT(*) as total FROM {$this->logTable}");
    $stmt->execute();
    $stats['total'] = $stmt->fetch(PDO::FETCH_ASSOC)['total'];

    $stmt = $this->conn->prepare(
      "SELECT COUNT(*) as active FROM {$this->logTable} WHERE status = 'Active'"
    );
    $stmt->execute();
    $stats['active'] = $stmt->fetch(PDO::FETCH_ASSOC)['active'];

    $stats['inactive'] = $stats['total'] - $stats['active'];

    // IN/OUT counts from check_in_out (the authoritative toggle table)
    $stmt = $this->conn->prepare(
      "SELECT check_type, COUNT(*) as cnt FROM {$this->checkTable} GROUP BY check_type"
    );
    $stmt->execute();
    $stats['check_counts'] = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
      $stats['check_counts'][$row['check_type']] = $row['cnt'];
    }

    // Breakdown by shift
    $stmt = $this->conn->prepare(
      "SELECT shift, COUNT(*) as count FROM {$this->logTable} GROUP BY shift"
    );
    $stmt->execute();
    $stats['by_shift'] = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
      $stats['by_shift'][$row['shift']] = $row['count'];
    }

    // Breakdown by access_type
    $stmt = $this->conn->prepare(
      "SELECT access_type, COUNT(*) as count FROM {$this->logTable} GROUP BY access_type"
    );
    $stmt->execute();
    $stats['by_access_type'] = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
      $stats['by_access_type'][$row['access_type']] = $row['count'];
    }

    return $stats;
  }
}

// ============================================================================
// FileUploader — only used here for serving/deleting images referenced in logs
// ============================================================================
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
    $this->upload_dir = '../../public/uploads/user/';

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

// ============================================================================
// Main request handler
// ============================================================================
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

    header('Location: ../../index.php');
    exit;
  }

  $database   = new Database();
  $logManager = new AccessLogManager($database);
  $fileUploader = new FileUploader($database->getCurrentUserId());

  $response = ['success' => false, 'message' => '', 'data' => null];

  // ── POST actions ─────────────────────────────────────────────────────────────
  if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    switch ($action) {

      // Delete a single log entry
      case 'delete':
        $log_id = $_POST['id'] ?? 0;

        if (!$log_id) {
          $response['message'] = 'Log entry ID is required';
          break;
        }

        if ($logManager->deleteLog($log_id)) {
          $response['success'] = true;
          $response['message'] = 'Log entry deleted successfully';
        } else {
          $response['message'] = 'Failed to delete log entry';
        }
        break;

      // Delete a filtered set of log entries by ID list
      case 'delete_filtered':
        $log_ids_json = $_POST['employee_ids'] ?? '[]'; // key kept for JS compatibility
        $filters_json = $_POST['filters']      ?? '{}';

        $log_ids = json_decode($log_ids_json, true) ?: [];
        $filters = json_decode($filters_json, true)  ?: [];

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
              fn($k, $v) => "$k: $v",
              array_keys($filters),
              $filters
            )) ?: 'All';

            $response['success']       = true;
            $response['message']       = "Deleted {$deleted_count} log entry/entries matching filters: {$filterStr}";
            $response['deleted_count'] = $deleted_count;

            logSystemAction(
              $database->getCurrentUserId(),
              'FILTERED_LOGS_DELETED',
              "Deleted {$deleted_count} log entries — filters: {$filterStr}"
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

      // Delete ALL log entries (employee_access_log + check_in_out)
      case 'delete_all':
        try {
          // Count first so the response message is accurate
          $all_logs    = $logManager->getLogs([]);
          $log_count   = count($all_logs);

          if ($log_count === 0) {
            $response['success'] = false;
            $response['message'] = 'No log data to delete';
            break;
          }

          $db = $database->getUserConnection();
          $db->beginTransaction();

          $logManager->deleteAllLogs();

          $db->commit();

          $response['success'] = true;
          $response['message'] = "All log data deleted successfully. {$log_count} record(s) removed.";
          $response['deleted_count'] = $log_count;

          logSystemAction(
            $database->getCurrentUserId(),
            'DELETE_ALL_LOGS',
            "Deleted all access log data: {$log_count} entries"
          );
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

      // Stats
      case 'get_stats':
        try {
          $response['success'] = true;
          $response['data']    = $logManager->getStats();
        } catch (Exception $e) {
          $response['message'] = 'Error getting statistics: ' . $e->getMessage();
        }
        break;

      // IN/OUT history for one employee (from check_in_out)
      case 'get_checkinout_history':
        $employee_id = $_POST['employee_id'] ?? 0;

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

      // Backup: export employee_access_log as JSON
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

      // QR lookup (read-only — does NOT toggle IN/OUT; use qr_search_backend.php for scans)
      case 'search_qr':
        $qr_code = $_POST['qr_code'] ?? '';

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
            $response['message'] = 'No log entry found for this QR code';
          }
        } catch (Exception $e) {
          $response['message'] = 'QR search error: ' . $e->getMessage();
        }
        break;

      default:
        $response['message'] = 'Invalid action: ' . $action;
        break;
    }

    // ── GET actions ───────────────────────────────────────────────────────────────
  } elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? '';

    switch ($action) {

      case 'get':
      case 'list':
        $filters = [];

        if (!empty($_GET['fullname']))         $filters['fullname']         = $_GET['fullname'];
        if (!empty($_GET['position']))         $filters['position']         = $_GET['position'];
        if (!empty($_GET['position_none']))    $filters['position_none']    = '1';
        if (!empty($_GET['brand']))            $filters['brand']            = $_GET['brand'];
        if (!empty($_GET['brand_none']))       $filters['brand_none']       = '1';
        if (!empty($_GET['status']))           $filters['status']           = $_GET['status'];
        if (!empty($_GET['status_none']))      $filters['status_none']      = '1';
        if (!empty($_GET['shift']))            $filters['shift']            = $_GET['shift'];
        if (!empty($_GET['shift_none']))       $filters['shift_none']       = '1';
        if (!empty($_GET['violation']))        $filters['violation']        = $_GET['violation'];
        if (!empty($_GET['violation_none']))   $filters['violation_none']   = '1';
        if (!empty($_GET['qr_code']))          $filters['qr_code']          = $_GET['qr_code'];
        if (!empty($_GET['check_status']))     $filters['check_status']     = $_GET['check_status'];
        if (!empty($_GET['user_id']))          $filters['user_id']          = $_GET['user_id'];
        if (!empty($_GET['gate_name']))        $filters['gate_name']        = $_GET['gate_name'];
        if (!empty($_GET['user_id_none']))     $filters['user_id_none']     = '1';
        if (!empty($_GET['access_type']))      $filters['access_type']      = $_GET['access_type'];
        if (!empty($_GET['access_timestamp'])) $filters['access_timestamp'] = $_GET['access_timestamp'];

        try {
          $logs = $logManager->getLogs($filters);
          $response['success'] = true;
          $response['data']    = $logs;
          $response['total']   = count($logs);
        } catch (Exception $e) {
          $response['message'] = 'Error retrieving logs: ' . $e->getMessage();
        }
        break;

      case 'get_single':
        $log_id = $_GET['id'] ?? 0;

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

      case 'stats':
        try {
          $response['success'] = true;
          $response['data']    = $logManager->getStats();
        } catch (Exception $e) {
          $response['message'] = 'Error getting statistics: ' . $e->getMessage();
        }
        break;

      // Current IN/OUT status for an employee (reads check_in_out)
      case 'current_status':
        $employee_id = $_GET['employee_id'] ?? 0;
        $qr_code     = $_GET['qr_code']     ?? null;

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
        $qr_code = $_GET['qr_code'] ?? '';

        if (empty($qr_code)) {
          $response['message'] = 'QR code parameter is required';
          break;
        }

        try {
          $log = $logManager->getLogByQR($qr_code);

          $response['success'] = true;
          $response['exists']  = (bool)$log;
          $response['data']    = $log ?: null;
          $response['message'] = $log ? 'Log entry found' : 'No log entry for this QR code';
        } catch (Exception $e) {
          $response['message'] = 'Error checking QR code: ' . $e->getMessage();
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

      default:
        $response['message'] = 'Invalid GET action: ' . $action;
        break;
    }
  }

  // Output JSON for AJAX
  if (
    !empty($_SERVER['HTTP_X_REQUESTED_WITH']) &&
    strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest'
  ) {
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

  if (
    !empty($_SERVER['HTTP_X_REQUESTED_WITH']) &&
    strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest'
  ) {
    header('Content-Type: application/json');
    echo json_encode($error_response);
    exit;
  }

  $_SESSION['error_message'] = $error_response['message'];
}

// ============================================================================
// File-serving helper (for images referenced in log rows)
// ============================================================================
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

// Health check
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
