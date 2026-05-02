<?php
// resource/views/partials/chart.php

require_once __DIR__ . '/../../../config/config.php';
require_once __DIR__ . '/../../../config/db.php';

if (!isset($_SESSION['user_id'])) {
  echo json_encode(['success' => false, 'error' => 'Unauthorized']);
  exit;
}

header('Content-Type: application/json');

$userId = $_SESSION['user_id'] ?? null;
$selectedDate = $_GET['lb_date'] ?? date('Y-m-d');

try {
  $userDb = getUserDBConnection($userId);

  // Leaderboard rows
  $stmt = $userDb->prepare("
    SELECT 
      COALESCE(NULLIF(TRIM(el.fullname), ''), e.fullname, 'Unknown') AS fullname,
      SUM(CASE WHEN el.check_status = 'IN'  THEN 1 ELSE 0 END) AS total_in,
      SUM(CASE WHEN el.check_status = 'OUT' THEN 1 ELSE 0 END) AS total_out,
      COUNT(*) AS total
    FROM employee_access_log el
    LEFT JOIN employees e ON el.employee_id = e.id
    WHERE DATE(el.access_timestamp) = :selected_date
    GROUP BY el.employee_id, el.fullname
    ORDER BY total DESC
  ");
  $stmt->execute([':selected_date' => $selectedDate]);
  $leaderboard = $stmt->fetchAll(PDO::FETCH_ASSOC);

  // Gate stats for the same date
  $stmt = $userDb->prepare("
    SELECT u.first_name AS gate_name, COUNT(*) AS total
    FROM employee_access_log el
    LEFT JOIN " . DB_NAME . ".users u ON el.user_id = u.id
    WHERE el.user_id IS NOT NULL
      AND DATE(el.access_timestamp) = :selected_date
    GROUP BY el.user_id, u.first_name
    ORDER BY total DESC
    LIMIT 10
  ");
  $stmt->execute([':selected_date' => $selectedDate]);
  $gateStats = $stmt->fetchAll(PDO::FETCH_ASSOC);

  echo json_encode([
    'success'    => true,
    'data'       => $leaderboard,
    'gate_stats' => $gateStats,
  ]);
} catch (Exception $e) {
  echo json_encode(['success' => false, 'data' => [], 'gate_stats' => []]);
}