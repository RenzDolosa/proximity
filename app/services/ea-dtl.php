<?php
// app/services/exportAll-datalog.php --> datalog table export all

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  exit(0);
}

try {
  if (!$databaseConnected) {
    throw new Exception('Database not connected');
  }

  $isExportRequest = isset($_GET['export']) && $_GET['export'] === 'all';

  if ($isExportRequest) {
    $sql = "SELECT id, employee_id, fullname, position, brand, status, shift, violation, qr_code, 
                       image, access_timestamp, check_status
                FROM employee_access_log
                ORDER BY access_timestamp DESC";

    $stmt = $userDb->prepare($sql);
    $stmt->execute();
    $employees = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
      'success' => true,
      'employees' => $employees,
      'total' => count($employees)
    ]);
    exit;
  }

  $page = isset($_GET['page']) ? max(1, intval($_GET['page'])) : 1;
  $limit = isset($_GET['limit']) ? max(1, min(100, intval($_GET['limit']))) : 10;
  $offset = ($page - 1) * $limit;

  $searchConditions = [];
  $searchParams = [];

  if (!empty($_GET['employee_id'])) {
    $searchConditions[] = "employee_id LIKE :employee_id";
    $searchParams[':employee_id'] = '%' . $_GET['employee_id'] . '%';
  }

  if (!empty($_GET['fullname'])) {
    $searchConditions[] = "fullname LIKE :fullname";
    $searchParams[':fullname'] = '%' . $_GET['fullname'] . '%';
  }

  if (!empty($_GET['position'])) {
    $searchConditions[] = "position LIKE :position";
    $searchParams[':position'] = '%' . $_GET['position'] . '%';
  }

  if (!empty($_GET['brand'])) {
    $searchConditions[] = "brand LIKE :brand";
    $searchParams[':brand'] = '%' . $_GET['brand'] . '%';
  }

  if (!empty($_GET['status'])) {
    $searchConditions[] = "status = :status";
    $searchParams[':status'] = $_GET['status'];
  }

  if (!empty($_GET['shift'])) {
    $searchConditions[] = "shift = :shift";
    $searchParams[':shift'] = $_GET['shift'];
  }

  if (!empty($_GET['created_at'])) {
    $searchConditions[] = "DATE(created_at) = :created_at";
    $searchParams[':created_at'] = $_GET['created_at'];
  }

  if (!empty($_GET['qr_code'])) {
    $searchConditions[] = "qr_code LIKE :qr_code";
    $searchParams[':qr_code'] = '%' . $_GET['qr_code'] . '%';
  }

  if (!empty($_GET['user_id'])) {
    $searchConditions[] = "user_id LIKE :user_id";
    $searchParams[':user_id'] = '%' . $_GET['user_id'] . '%';
  }

  $whereClause = '';
  if (!empty($searchConditions)) {
    $whereClause = 'WHERE ' . implode(' AND ', $searchConditions);
  }

  $countSql = "SELECT COUNT(*) FROM employees $whereClause";
  $countStmt = $userDb->prepare($countSql);
  foreach ($searchParams as $key => $value) {
    $countStmt->bindValue($key, $value);
  }
  $countStmt->execute();
  $totalRecords = $countStmt->fetchColumn();

  $sql = "SELECT id, employee_id, fullname, position, brand, status, shift, violation, qr_code, 
                   image, access_timestamp, check_status, user_id,
            FROM employee_access_log
            $whereClause 
            ORDER BY access_timestamp DESC 
            LIMIT :limit OFFSET :offset";

  $stmt = $userDb->prepare($sql);

  foreach ($searchParams as $key => $value) {
    $stmt->bindValue($key, $value);
  }

  $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
  $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);

  $stmt->execute();
  $employees = $stmt->fetchAll(PDO::FETCH_ASSOC);

  foreach ($employees as &$employee) {
    if ($employee['access_timestamp']) {
      $employee['formatted_access_timestamp'] = date('Y-m-d H:i:s', strtotime($employee['access_timestamp']));
    }

    if ($employee['image'] && file_exists('../uploads/' . $employee['image'])) {
      $employee['image_url'] = '../uploads/' . $employee['image'];
    } else {
      $employee['image_url'] = null;
    }
  }

  $totalPages = ceil($totalRecords / $limit);

  echo json_encode([
    'success' => true,
    'employees' => $employees,
    'pagination' => [
      'current_page' => $page,
      'total_pages' => $totalPages,
      'total_records' => $totalRecords,
      'per_page' => $limit,
      'has_next' => $page < $totalPages,
      'has_prev' => $page > 1
    ]
  ]);
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode([
    'success' => false,
    'message' => 'Error loading employees: ' . $e->getMessage()
  ]);
}
