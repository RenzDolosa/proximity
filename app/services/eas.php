<?php
// app/services/exportAll-system.php --> system table export all

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
    $sql = "SELECT id, fullname, position, brand, status, shift, violation, qr_code, 
                       image, created_at, updated_at 
                FROM employees 
                ORDER BY id DESC";

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

  if (!empty($_GET['id'])) {
    $searchConditions[] = "id LIKE :id";
    $searchParams[':id'] = '%' . $_GET['id'] . '%';
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

  $sql = "SELECT id, fullname, position, brand, status, shift, violation, qr_code, 
                   image, created_at, updated_at 
            FROM employees 
            $whereClause 
            ORDER BY id DESC 
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
    if ($employee['created_at']) {
      $employee['formatted_created_at'] = date('Y-m-d H:i:s', strtotime($employee['created_at']));
    }
    if ($employee['updated_at']) {
      $employee['formatted_updated_at'] = date('Y-m-d H:i:s', strtotime($employee['updated_at']));
    }

    if ($employee['image'] && file_exists('../../public/uploads/' . $employee['image'])) {
      $employee['image_url'] = '../../public/uploads/' . $employee['image'];
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
