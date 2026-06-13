<?php
// app/services/violation_log_backend.php --> Violation Log CRUD backend

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';

// ── Auth guard ───────────────────────────────────────────────────────────────
if (!isset($_SESSION['user_id'])) {
  header('Content-Type: application/json');
  echo json_encode(['success' => false, 'message' => 'Authentication required.']);
  exit;
}

header('Content-Type: application/json');

$userId = $_SESSION['user_id'];
$response = ['success' => false, 'message' => ''];

try {
  $db = getUserDBConnection($userId);
  $mainDb = getMainDBConnection();

  // ── Ensure violations table exists ──────────────────────────────────────
  $db->exec("CREATE TABLE IF NOT EXISTS `violations` (
    `id`                    INT AUTO_INCREMENT PRIMARY KEY,
    `employee_id`           INT NOT NULL,
    `violation_type`        VARCHAR(100)    DEFAULT NULL,
    `violation_description` TEXT            DEFAULT NULL,
    `violation_date`        DATE            DEFAULT NULL,
    `created_at`            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

  $method = $_SERVER['REQUEST_METHOD'];

  // ════════════════════════════════════════════════════════════════════════════
  // GET  –  list all violations with employee name joined
  // ════════════════════════════════════════════════════════════════════════════
  if ($method === 'GET') {
    $action = $_GET['action'] ?? '';

    if ($action === 'list') {
      $stmt = $db->prepare("
        SELECT
          v.id,
          v.employee_id,
          e.fullname      AS employee_name,
          v.violation_type,
          v.violation_description,
          v.violation_date,
          v.created_at
        FROM violations v
        LEFT JOIN employees e ON e.id = v.employee_id
        ORDER BY v.violation_date DESC, v.created_at DESC
      ");
      $stmt->execute();
      $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

      $response = ['success' => true, 'data' => $rows, 'total' => count($rows)];
    } elseif ($action === 'get') {
      $id = intval($_GET['id'] ?? 0);
      if (!$id) {
        $response['message'] = 'ID required';
        goto done;
      }

      $stmt = $db->prepare("
        SELECT v.*, e.fullname AS employee_name
        FROM violations v
        LEFT JOIN employees e ON e.id = v.employee_id
        WHERE v.id = ?
      ");
      $stmt->execute([$id]);
      $row = $stmt->fetch(PDO::FETCH_ASSOC);

      if ($row) {
        $response = ['success' => true, 'data' => $row];
      } else {
        $response['message'] = 'Record not found';
      }
    } else {
      $response['message'] = 'Unknown GET action';
    }

    // ════════════════════════════════════════════════════════════════════════════
    // POST  –  add | update | delete
    // ════════════════════════════════════════════════════════════════════════════
  } elseif ($method === 'POST') {
    $action = $_POST['action'] ?? '';

    // ── ADD ──────────────────────────────────────────────────────────────────
    if ($action === 'add') {
      $employeeId  = intval($_POST['employee_id']  ?? 0);
      $type        = trim($_POST['violation_type']        ?? '');
      $desc        = trim($_POST['violation_description'] ?? '');
      $date        = trim($_POST['violation_date']        ?? '');

      if (!$employeeId) {
        $response['message'] = 'Employee ID is required';
        goto done;
      }
      if (!$type) {
        $response['message'] = 'Violation type is required';
        goto done;
      }
      if (!$date) {
        $response['message'] = 'Violation date is required';
        goto done;
      }

      $chk = $db->prepare("SELECT id FROM employees WHERE id = ?");
      $chk->execute([$employeeId]);
      if (!$chk->fetch()) {
        $response['message'] = 'Employee not found';
        goto done;
      }

      $stmt = $db->prepare("
        INSERT INTO violations (employee_id, violation_type, violation_description, violation_date)
        VALUES (?, ?, ?, ?)
      ");
      $stmt->execute([$employeeId, $type, $desc ?: null, $date]);

      logSystemAction(
        $userId,
        'VIOLATION_ADDED',
        "Added violation ($type) for employee ID $employeeId on $date"
      );

      $response = ['success' => true, 'message' => 'Violation record added successfully.', 'id' => $db->lastInsertId()];

      // ── UPDATE ───────────────────────────────────────────────────────────────
    } elseif ($action === 'update') {
      $id          = intval($_POST['id']           ?? 0);
      $employeeId  = intval($_POST['employee_id']  ?? 0);
      $type        = trim($_POST['violation_type']        ?? '');
      $desc        = trim($_POST['violation_description'] ?? '');
      $date        = trim($_POST['violation_date']        ?? '');

      if (!$id) {
        $response['message'] = 'Record ID is required';
        goto done;
      }
      if (!$employeeId) {
        $response['message'] = 'Employee ID is required';
        goto done;
      }
      if (!$type) {
        $response['message'] = 'Violation type is required';
        goto done;
      }
      if (!$date) {
        $response['message'] = 'Violation date is required';
        goto done;
      }

      $stmt = $db->prepare("
        UPDATE violations
        SET employee_id           = ?,
            violation_type        = ?,
            violation_description = ?,
            violation_date        = ?
        WHERE id = ?
      ");
      $stmt->execute([$employeeId, $type, $desc ?: null, $date, $id]);

      if ($stmt->rowCount() > 0) {
        logSystemAction($userId, 'VIOLATION_UPDATED', "Updated violation ID $id");
        $response = ['success' => true, 'message' => 'Violation record updated successfully.'];
      } else {
        $response['message'] = 'No changes made or record not found.';
        $response['success'] = true;
      }

      // ── DELETE ───────────────────────────────────────────────────────────────
    } elseif ($action === 'delete') {
      $id = intval($_POST['id'] ?? 0);
      if (!$id) {
        $response['message'] = 'Record ID is required';
        goto done;
      }

      $stmt = $db->prepare("DELETE FROM violations WHERE id = ?");
      $stmt->execute([$id]);

      if ($stmt->rowCount() > 0) {
        logSystemAction($userId, 'VIOLATION_DELETED', "Deleted violation ID $id");
        $response = ['success' => true, 'message' => 'Violation record deleted successfully.'];
      } else {
        $response['message'] = 'Record not found.';
      }
    } else {
      $response['message'] = 'Unknown POST action: ' . htmlspecialchars($action);
    }
  } else {
    $response['message'] = 'Method not allowed';
  }
} catch (Exception $e) {
  error_log("violation_log_backend error: " . $e->getMessage());
  $response = ['success' => false, 'message' => 'Server error: ' . $e->getMessage()];
}

done:
echo json_encode($response);
