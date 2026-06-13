<?php
// app/services/notifications_backend.php --> real-time notification API
// Returns alerts for: late check-ins, anomalies, incident reports
// Called by resource/js/notifications.js via polling

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, no-cache, must-revalidate');

if (!defined('APP_TIMEZONE')) {
  define('APP_TIMEZONE',    'Asia/Manila');
  define('APP_TIMEZONE_TZ', '+08:00');
}
date_default_timezone_set(APP_TIMEZONE);

// ── Auth guard ────────────────────────────────────────────────────────────────
if (!isset($_SESSION['user_id'])) {
  http_response_code(401);
  echo json_encode(['success' => false, 'message' => 'Unauthenticated', 'alerts' => []]);
  exit();
}

$userId = (int) $_SESSION['user_id'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonError(string $msg, int $code = 500): void
{
  http_response_code($code);
  echo json_encode(['success' => false, 'message' => $msg, 'alerts' => []]);
  exit();
}

// Convert stored ALL-CAPS or mixed-case names to Title Case
// e.g. "NATHAN OBAL" → "Nathan Obal", "DE LA CRUZ" → "De La Cruz"
function properCase(string $name): string
{
  return ucwords(strtolower(trim($name)));
}

function timeAgo(string $datetime): string
{
  $now   = new DateTime();
  $then  = new DateTime($datetime);
  $diff  = $now->diff($then);

  if ($diff->days > 0)  return $diff->days . 'd ago';
  if ($diff->h   > 0)   return $diff->h    . 'h ago';
  if ($diff->i   > 0)   return $diff->i    . 'm ago';
  return 'just now';
}

// ── since= cursor — only fetch alerts newer than this timestamp ───────────────
$since = $_GET['since'] ?? null;
if ($since && !preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/', $since)) {
  $since = null;
}

// ── DB connections ────────────────────────────────────────────────────────────
try {
  $mainDb = getMainDBConnection();
} catch (Exception $e) {
  jsonError('Main DB unavailable');
}

try {
  $userDb = getUserDBConnection($userId);
} catch (Exception $e) {
  jsonError('User DB unavailable');
}

$alerts = [];

// ── LATE CHECK-IN DETECTION ───────────────────────────────────────────────────
// Flags employees who checked IN more than 30 minutes after their shift start.
// Shift format expected: "07:00 AM - 04:00 PM" or "07:00-16:00"
// Only looks at today's log to keep queries fast.
try {
  $todayStart = date('Y-m-d 00:00:00');
  $todayEnd   = date('Y-m-d 23:59:59');

  $sinceClause = $since
    ? "AND eal.access_timestamp > :since"
    : "";

  $stmt = $userDb->prepare(
    "SELECT eal.id,
            eal.fullname,
            eal.position,
            eal.shift,
            eal.check_status,
            eal.access_timestamp,
            eal.violation
       FROM employee_access_log eal
      WHERE eal.access_timestamp BETWEEN :start AND :end
        AND eal.check_status = 'IN'
        AND eal.shift IS NOT NULL
        AND eal.shift != ''
        $sinceClause
      ORDER BY eal.access_timestamp DESC
      LIMIT 50"
  );

  $params = [':start' => $todayStart, ':end' => $todayEnd];
  if ($since) $params[':since'] = $since;
  $stmt->execute($params);
  $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  foreach ($rows as $row) {
    // Parse shift start time — supports "07:00 AM - 04:00 PM" or "07:00-16:00"
    $shiftRaw = trim($row['shift']);
    $shiftStart = null;

    if (preg_match('/(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i', $shiftRaw, $m)) {
      $shiftStart = date('H:i', strtotime($m[1]));
    } elseif (preg_match('/(\d{2}:\d{2})/', $shiftRaw, $m)) {
      $shiftStart = $m[1];
    }

    if (!$shiftStart) continue;

    $shiftStartTs    = strtotime(date('Y-m-d') . ' ' . $shiftStart);
    $accessTs        = strtotime($row['access_timestamp']);
    $lateMinutes     = (int)(($accessTs - $shiftStartTs) / 60);

    // Flag as late only if more than 30 min after shift start
    if ($lateMinutes > 30 && $accessTs >= $shiftStartTs) {
      $alerts[] = [
        'id'       => 'late_' . $row['id'],
        'type'     => 'late_checkin',
        'severity' => $lateMinutes > 60 ? 'high' : 'medium',
        'tag'      => 'Late Check-In',
        'color'    => $lateMinutes > 60 ? 'amber' : 'amber',
        'icon'     => 'fa-clock',
        'title'    => htmlspecialchars(properCase($row['fullname'])) . ' checked in late',
        'desc'     => htmlspecialchars($row['position'] ?? 'Employee')
                      . ' — ' . $lateMinutes . ' min late'
                      . (($row['shift']) ? ' (shift: ' . htmlspecialchars($shiftRaw) . ')' : ''),
        'time'     => timeAgo($row['access_timestamp']),
        'ts'       => $row['access_timestamp'],
      ];
    }
  }
} catch (PDOException $e) {
  error_log('notifications_backend – late check-in query: ' . $e->getMessage());
}

// ── ANOMALY DETECTION ─────────────────────────────────────────────────────────
// Flags employees scanned twice as IN with no OUT in between (double-tap anomaly)
// and employees with 'inactive' status who still scanned in.
try {
  // Inactive employees who checked IN today
  $stmt = $userDb->prepare(
    "SELECT eal.id, eal.fullname, eal.position, eal.status, eal.access_timestamp
       FROM employee_access_log eal
      WHERE eal.access_timestamp BETWEEN :start AND :end
        AND eal.check_status = 'IN'
        AND LOWER(TRIM(eal.status)) IN ('inactive','suspended','terminated')
        " . ($since ? "AND eal.access_timestamp > :since" : "") . "
      ORDER BY eal.access_timestamp DESC
      LIMIT 20"
  );
  $p2 = [':start' => $todayStart, ':end' => $todayEnd];
  if ($since) $p2[':since'] = $since;
  $stmt->execute($p2);
  $inactiveRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  foreach ($inactiveRows as $row) {
    $alerts[] = [
      'id'       => 'anomaly_inactive_' . $row['id'],
      'type'     => 'anomaly',
      'severity' => 'high',
      'tag'      => 'Anomaly',
      'color'    => 'red',
      'icon'     => 'fa-exclamation-triangle',
      'title'    => 'Inactive employee scanned',
      'desc'     => htmlspecialchars(properCase($row['fullname']))
                    . ' (' . htmlspecialchars($row['status'] ?? 'inactive') . ')'
                    . ' — check for unauthorized access.',
      'time'     => timeAgo($row['access_timestamp']),
      'ts'       => $row['access_timestamp'],
    ];
  }

  // Employees with violation flag who checked IN today (new violations)
  $stmt = $userDb->prepare(
    "SELECT eal.id, eal.fullname, eal.position, eal.violation, eal.access_timestamp
       FROM employee_access_log eal
      WHERE eal.access_timestamp BETWEEN :start AND :end
        AND eal.check_status = 'IN'
        AND eal.violation IS NOT NULL
        AND TRIM(eal.violation) != ''
        AND LOWER(TRIM(eal.violation)) NOT IN ('none','n/a','-','no')
        " . ($since ? "AND eal.access_timestamp > :since" : "") . "
      ORDER BY eal.access_timestamp DESC
      LIMIT 20"
  );
  $p3 = [':start' => $todayStart, ':end' => $todayEnd];
  if ($since) $p3[':since'] = $since;
  $stmt->execute($p3);
  $violRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

  foreach ($violRows as $row) {
    $alerts[] = [
      'id'       => 'anomaly_viol_' . $row['id'],
      'type'     => 'anomaly',
      'severity' => 'medium',
      'tag'      => 'Anomaly',
      'color'    => 'amber',
      'icon'     => 'fa-user-slash',
      'title'    => 'Flagged employee checked in',
      'desc'     => htmlspecialchars(properCase($row['fullname']))
                    . ' — ' . htmlspecialchars(mb_strimwidth($row['violation'] ?? '', 0, 80, '...')),
      'time'     => timeAgo($row['access_timestamp']),
      'ts'       => $row['access_timestamp'],
    ];
  }
} catch (PDOException $e) {
  error_log('notifications_backend – anomaly query: ' . $e->getMessage());
}

// ── INCIDENT REPORTS ──────────────────────────────────────────────────────────
try {
  $violTableCheck = $userDb->query(
    "SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'violations'"
  );
  $violTableExists = (int) $violTableCheck->fetchColumn() > 0;

  if ($violTableExists) {
    $stmt = $userDb->prepare(
      "SELECT v.id, e.fullname, e.position, v.remarks, v.created_at
         FROM violations v
         LEFT JOIN employees e ON v.employee_id = e.id
        WHERE v.created_at BETWEEN :start AND :end
              " . ($since ? "AND v.created_at > :since" : "") . "
        ORDER BY v.created_at DESC
        LIMIT 20"
    );
    $p4 = [':start' => $todayStart, ':end' => $todayEnd];
    if ($since) $p4[':since'] = $since;
    $stmt->execute($p4);
    $incidentRows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($incidentRows as $row) {
      $alerts[] = [
        'id'       => 'incident_' . $row['id'],
        'type'     => 'incident',
        'severity' => 'high',
        'tag'      => 'Incident',
        'color'    => 'purple',
        'icon'     => 'fa-file-alt',
        'title'    => 'Incident report filed',
        'desc'     => htmlspecialchars(properCase($row['fullname'] ?? 'Unknown employee'))
                      . ' — ' . htmlspecialchars(mb_strimwidth($row['remarks'] ?? '', 0, 80, '...')),
        'time'     => timeAgo($row['created_at']),
        'ts'       => $row['created_at'],
      ];
    }
  }
} catch (PDOException $e) {
  error_log('notifications_backend – incidents query: ' . $e->getMessage());
}

// ── Sort by timestamp desc, cap at 30 ─────────────────────────────────────────
usort($alerts, fn($a, $b) => strcmp($b['ts'], $a['ts']));
$alerts = array_slice($alerts, 0, 30);

// ── Emit ──────────────────────────────────────────────────────────────────────
echo json_encode([
  'success'      => true,
  'alerts'       => $alerts,
  'total'        => count($alerts),
  'server_time'  => date('Y-m-d H:i:s'),
  'timezone'     => APP_TIMEZONE,
]);
