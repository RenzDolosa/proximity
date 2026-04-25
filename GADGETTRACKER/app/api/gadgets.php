<?php
// app/api/gadgets.php

require_once __DIR__ . '/../../config/config.php';

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

try {
  match (true) {
    $method === 'GET'  && $action === 'list'                => handleList(),
    $method === 'GET'  && $action === 'get'                 => handleGet(),
    $method === 'POST' && $action === 'create'              => handleCreate(),
    $method === 'POST' && $action === 'update'              => handleUpdate(),
    $method === 'POST' && $action === 'delete'              => handleDelete(),
    $method === 'POST' && $action === 'bulk-delete'         => handleBulkDelete(),
    $method === 'POST' && $action === 'import'              => handleImport(),
    $method === 'GET'  && $action === 'warehouses'          => handleWarehouses(),
    $method === 'GET'  && $action === 'check-serial'        => handleCheckSerial(),
    // ── Gadget Details ────────────────────────────────────────────────────
    $method === 'GET'  && $action === 'gd-list'             => handleGdList(),
    $method === 'GET'  && $action === 'gd-search'           => handleGdSearch(),
    $method === 'POST' && $action === 'gd-create'           => handleGdCreate(),
    $method === 'POST' && $action === 'gd-update'           => handleGdUpdate(),
    $method === 'POST' && $action === 'gd-delete'           => handleGdDelete(),
    $method === 'POST' && $action === 'gd-import'           => handleGdImport(),
    default => respond(false, 'Unknown action', null, 404),
  };
} catch (Throwable $e) {
  respond(false, $e->getMessage(), null, 500);
}

// ── Handlers ──────────────────────────────────────────────────────────────────

function handleList(): void
{
  $pdo    = getDBConnection();
  $page   = max(1, (int)($_GET['page']  ?? 1));
  $limit  = max(1, min(100, (int)($_GET['limit'] ?? 15)));
  $offset = ($page - 1) * $limit;
  $search    = trim($_GET['search']           ?? '');
  $invStatus = $_GET['inventory_status']      ?? '';
  $status    = $_GET['status']               ?? '';

  $where  = [];
  $params = [];

  if ($search !== '') {
    $like    = "%{$search}%";
    $where[] = '(`user` LIKE ? OR `gadget` LIKE ? OR `serial_number` LIKE ? OR `asset_tag` LIKE ? OR `warehouse_asset_tag` LIKE ? OR `mac_address` LIKE ? OR `imei1` LIKE ? OR `imei2` LIKE ?)';
    $params  = array_merge($params, array_fill(0, 8, $like));
  }
  if ($invStatus !== '') {
    $where[] = '`inventory_status` = ?';
    $params[] = $invStatus;
  }
  if ($status    !== '') {
    $where[] = '`status` = ?';
    $params[] = $status;
  }

  $warehouse = trim($_GET['warehouse'] ?? '');
  if ($warehouse !== '' && $warehouse !== '__ALL__') {
    $where[] = '`warehouse` = ?';
    $params[] = $warehouse;
  }

  $whereSql  = $where ? 'WHERE ' . implode(' AND ', $where) : '';
  $totalStmt = $pdo->prepare("SELECT COUNT(*) FROM `gadgets` {$whereSql}");
  $totalStmt->execute($params);
  $total = (int)$totalStmt->fetchColumn();

  $dataStmt = $pdo->prepare("SELECT * FROM `gadgets` {$whereSql} ORDER BY `id` DESC LIMIT {$limit} OFFSET {$offset}");
  $dataStmt->execute($params);

  respond(true, 'OK', [
    'rows'        => $dataStmt->fetchAll(),
    'total'       => $total,
    'page'        => $page,
    'limit'       => $limit,
    'total_pages' => (int)ceil($total / $limit),
  ]);
}

function handleGet(): void
{
  $pdo = getDBConnection();
  $id  = (int)($_GET['id'] ?? 0);
  if ($id <= 0) respond(false, 'Invalid ID', null, 400);

  $stmt = $pdo->prepare('SELECT * FROM `gadgets` WHERE `id` = ?');
  $stmt->execute([$id]);
  $row = $stmt->fetch();
  if (!$row) respond(false, 'Record not found', null, 404);
  respond(true, 'OK', $row);
}

function handleCreate(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  validateRequired($data, ['user', 'role', 'gadget']);

  // Duplicate serial check
  $serial = san($data['serial_number'] ?? null);
  if ($serial !== null) {
    $chk = $pdo->prepare('SELECT id FROM `gadgets` WHERE `serial_number` = ?');
    $chk->execute([$serial]);
    if ($chk->fetch()) {
      respond(false, 'Serial number "' . $serial . '" already exists.', null, 409);
    }
  }

  $stmt = $pdo->prepare("
        INSERT INTO `gadgets`
          (`user`,`role`,`gadget`,`serial_number`,`warehouse_asset_tag`,`asset_tag`,
           `mac_address`,`password`,`warehouse_owner`,`remarks`,`recent_responsible`,
           `description`,`imei1`,`imei2`,`inventory_status`,`warehouse`,`status`)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ");
  $stmt->execute(rowValues($data));
  respond(true, 'Gadget added successfully.', ['id' => (int)$pdo->lastInsertId()]);
}

function handleUpdate(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  $id   = (int)($data['id'] ?? 0);
  if ($id <= 0) respond(false, 'Invalid ID', null, 400);
  validateRequired($data, ['user', 'role', 'gadget']);

  // Duplicate serial check (exclude own record)
  $serial = san($data['serial_number'] ?? null);
  if ($serial !== null) {
    $chk = $pdo->prepare('SELECT id FROM `gadgets` WHERE `serial_number` = ? AND `id` != ?');
    $chk->execute([$serial, $id]);
    if ($chk->fetch()) {
      respond(false, 'Serial number "' . $serial . '" is already assigned to another gadget.', null, 409);
    }
  }

  $stmt = $pdo->prepare("
        UPDATE `gadgets` SET
          `user`=?,`role`=?,`gadget`=?,`serial_number`=?,`warehouse_asset_tag`=?,
          `asset_tag`=?,`mac_address`=?,`password`=?,`warehouse_owner`=?,`remarks`=?,
          `recent_responsible`=?,`description`=?,`imei1`=?,`imei2`=?,
          `inventory_status`=?,`warehouse`=?,`status`=?
        WHERE `id`=?
    ");
  $stmt->execute([...rowValues($data), $id]);
  respond(true, 'Gadget updated successfully.');
}

function handleDelete(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  $id   = (int)($data['id'] ?? 0);
  if ($id <= 0) respond(false, 'Invalid ID', null, 400);

  $pdo->prepare('DELETE FROM `gadgets` WHERE `id` = ?')->execute([$id]);
  respond(true, 'Gadget deleted successfully.');
}

function handleBulkDelete(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  $ids  = $data['ids'] ?? [];

  if (empty($ids) || !is_array($ids)) respond(false, 'No IDs provided.', null, 422);

  // Validate all IDs are positive integers
  $ids = array_filter(array_map('intval', $ids), fn($id) => $id > 0);
  if (empty($ids)) respond(false, 'No valid IDs provided.', null, 422);

  $placeholders = implode(',', array_fill(0, count($ids), '?'));
  $stmt = $pdo->prepare("DELETE FROM `gadgets` WHERE `id` IN ({$placeholders})");
  $stmt->execute(array_values($ids));

  $deleted = $stmt->rowCount();
  respond(true, "{$deleted} gadget(s) deleted successfully.", ['deleted' => $deleted]);
}

function handleImport(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  $rows = $data['rows'] ?? [];

  if (empty($rows) || !is_array($rows)) respond(false, 'No rows provided.', null, 422);

  $inserted  = 0;
  $errors    = [];
  $batchSNs  = []; // track serials seen within this batch

  // Pre-load all existing serial numbers for fast lookup
  $existingStmt = $pdo->query("SELECT `serial_number` FROM `gadgets` WHERE `serial_number` IS NOT NULL AND `serial_number` != ''");
  $existingSNs  = array_flip(array_column($existingStmt->fetchAll(), 'serial_number'));

  $stmt = $pdo->prepare("
        INSERT INTO `gadgets`
          (`user`,`role`,`gadget`,`serial_number`,`warehouse_asset_tag`,`asset_tag`,
           `mac_address`,`password`,`warehouse_owner`,`remarks`,`recent_responsible`,
           `description`,`imei1`,`imei2`,`inventory_status`,`warehouse`,`status`)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ");

  $pdo->beginTransaction();
  foreach ($rows as $i => $row) {
    $rowNum = $i + 2;
    if (empty($row['gadget'])) {
      $errors[] = "Row {$rowNum}: gadget is required.";
      continue;
    }

    // Serial number duplicate check
    $sn = isset($row['serial_number']) ? trim($row['serial_number']) : '';
    if ($sn !== '') {
      if (isset($existingSNs[$sn])) {
        $errors[] = 'Row ' . $rowNum . ': serial number "' . $sn . '" already exists in the database — skipped.';
        continue;
      }
      if (isset($batchSNs[$sn])) {
        $errors[] = 'Row ' . $rowNum . ': serial number "' . $sn . '" appears more than once in this file — skipped.';
        continue;
      }
      $batchSNs[$sn] = true;
    }

    try {
      $stmt->execute(rowValues($row));
      $inserted++;
      // Add to in-memory set so subsequent rows in the same batch are caught
      if ($sn !== '') $existingSNs[$sn] = true;
    } catch (PDOException $e) {
      $errors[] = "Row {$rowNum}: " . $e->getMessage();
    }
  }
  $pdo->commit();

  respond(true, "{$inserted} record(s) imported." . (count($errors) ? ' ' . count($errors) . ' row(s) skipped.' : ''), [
    'inserted' => $inserted,
    'errors'   => $errors,
  ]);
}

function handleCheckSerial(): void
{
  $pdo    = getDBConnection();
  $serial = san(trim($_GET['serial'] ?? ''));
  if ($serial === null || $serial === '') {
    respond(true, 'OK', ['exists' => false]);
  }

  $excludeId = (int)($_GET['exclude_id'] ?? 0);
  if ($excludeId > 0) {
    $stmt = $pdo->prepare('SELECT id FROM `gadgets` WHERE `serial_number` = ? AND `id` != ?');
    $stmt->execute([$serial, $excludeId]);
  } else {
    $stmt = $pdo->prepare('SELECT id FROM `gadgets` WHERE `serial_number` = ?');
    $stmt->execute([$serial]);
  }

  $row = $stmt->fetch();
  respond(true, 'OK', [
    'exists'     => (bool)$row,
    'gadget_id'  => $row ? (int)$row['id'] : null,
  ]);
}

function handleWarehouses(): void
{
  $pdo  = getDBConnection();
  $stmt = $pdo->query("
    SELECT `warehouse`, COUNT(*) AS cnt
    FROM `gadgets`
    WHERE `warehouse` IS NOT NULL AND `warehouse` != ''
    GROUP BY `warehouse`
    ORDER BY `warehouse` ASC
  ");
  $rows = $stmt->fetchAll();
  respond(true, 'OK', $rows);
}

// ── Gadget Details Handlers ───────────────────────────────────────────────────

function handleGdList(): void
{
  $pdo    = getDBConnection();
  $page   = max(1, (int)($_GET['page']  ?? 1));
  $limit  = max(1, min(100, (int)($_GET['limit'] ?? 15)));
  $offset = ($page - 1) * $limit;
  $search = trim($_GET['search'] ?? '');

  $where  = [];
  $params = [];
  if ($search !== '') {
    $like    = "%{$search}%";
    $where[] = '(`gadget` LIKE ? OR `serial_number` LIKE ? OR `asset_tag` LIKE ? OR `mac_address` LIKE ? OR `imei1` LIKE ? OR `imei2` LIKE ?)';
    $params  = array_merge($params, array_fill(0, 6, $like));
  }
  $whereSql  = $where ? 'WHERE ' . implode(' AND ', $where) : '';
  $totalStmt = $pdo->prepare("SELECT COUNT(*) FROM `gadget_details` {$whereSql}");
  $totalStmt->execute($params);
  $total = (int)$totalStmt->fetchColumn();

  $dataStmt = $pdo->prepare("SELECT * FROM `gadget_details` {$whereSql} ORDER BY `id` DESC LIMIT {$limit} OFFSET {$offset}");
  $dataStmt->execute($params);

  respond(true, 'OK', [
    'rows'        => $dataStmt->fetchAll(),
    'total'       => $total,
    'page'        => $page,
    'limit'       => $limit,
    'total_pages' => (int)ceil($total / $limit),
  ]);
}

function handleGdSearch(): void
{
  $pdo    = getDBConnection();
  $q      = trim($_GET['q'] ?? '');
  if ($q === '') { respond(true, 'OK', []); }

  $like   = "%{$q}%";
  $stmt   = $pdo->prepare("
    SELECT * FROM `gadget_details`
    WHERE `gadget` LIKE ? OR `serial_number` LIKE ? OR `asset_tag` LIKE ?
    ORDER BY `gadget` ASC LIMIT 20
  ");
  $stmt->execute([$like, $like, $like]);
  respond(true, 'OK', $stmt->fetchAll());
}

function handleGdCreate(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  validateRequired($data, ['gadget']);

  $stmt = $pdo->prepare("
    INSERT INTO `gadget_details`
      (`gadget`,`serial_number`,`asset_tag`,`mac_address`,`imei1`,`imei2`,`inventory_status`,`warehouse`,`status`)
    VALUES (?,?,?,?,?,?,?,?,?)
  ");
  $stmt->execute(gdRowValues($data));
  respond(true, 'Gadget detail added successfully.', ['id' => (int)$pdo->lastInsertId()]);
}

function handleGdUpdate(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  $id   = (int)($data['id'] ?? 0);
  if ($id <= 0) respond(false, 'Invalid ID', null, 400);
  validateRequired($data, ['gadget']);

  $stmt = $pdo->prepare("
    UPDATE `gadget_details` SET
      `gadget`=?,`serial_number`=?,`asset_tag`=?,`mac_address`=?,
      `imei1`=?,`imei2`=?,`inventory_status`=?,`warehouse`=?,`status`=?
    WHERE `id`=?
  ");
  $stmt->execute([...gdRowValues($data), $id]);
  respond(true, 'Gadget detail updated successfully.');
}

function handleGdDelete(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  $id   = (int)($data['id'] ?? 0);
  if ($id <= 0) respond(false, 'Invalid ID', null, 400);

  $pdo->prepare('DELETE FROM `gadget_details` WHERE `id` = ?')->execute([$id]);
  respond(true, 'Gadget detail deleted successfully.');
}

function handleGdImport(): void
{
  $pdo  = getDBConnection();
  $data = getJsonBody();
  $rows = $data['rows'] ?? [];

  if (empty($rows) || !is_array($rows)) respond(false, 'No rows provided.', null, 422);

  $inserted = 0;
  $errors   = [];

  $stmt = $pdo->prepare("
    INSERT INTO `gadget_details`
      (`gadget`,`serial_number`,`asset_tag`,`mac_address`,`imei1`,`imei2`,`inventory_status`,`warehouse`,`status`)
    VALUES (?,?,?,?,?,?,?,?,?)
  ");

  $pdo->beginTransaction();
  foreach ($rows as $i => $row) {
    $rowNum = $i + 2;
    if (empty($row['gadget'])) {
      $errors[] = "Row {$rowNum}: gadget is required.";
      continue;
    }
    try {
      $stmt->execute(gdRowValues($row));
      $inserted++;
    } catch (PDOException $e) {
      $errors[] = "Row {$rowNum}: " . $e->getMessage();
    }
  }
  $pdo->commit();

  respond(true, "{$inserted} gadget detail(s) imported." . (count($errors) ? ' ' . count($errors) . ' row(s) skipped.' : ''), [
    'inserted' => $inserted,
    'errors'   => $errors,
  ]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowValues(array $d): array
{
  return [
    san($d['user']                ?? null),
    san($d['role']                ?? null),
    san($d['gadget']),
    san($d['serial_number']       ?? null),
    san($d['warehouse_asset_tag'] ?? null),
    san($d['asset_tag']           ?? null),
    san($d['mac_address']         ?? null),
    san($d['password']            ?? null),
    san($d['warehouse_owner']     ?? null),
    san($d['remarks']             ?? null),
    san($d['recent_responsible']  ?? null),
    san($d['description']         ?? null),
    san($d['imei1']               ?? null),
    san($d['imei2']               ?? null),
    san($d['inventory_status']    ?? 'Active'),
    san($d['warehouse']           ?? null),
    san($d['status']              ?? 'Good'),
  ];
}

function san(mixed $v): ?string
{
  if ($v === null || $v === '') return null;
  return htmlspecialchars(strip_tags(trim((string)$v)), ENT_QUOTES, 'UTF-8');
}

function gdRowValues(array $d): array
{
  return [
    san($d['gadget']),
    san($d['serial_number']    ?? null),
    san($d['asset_tag']        ?? null),
    san($d['mac_address']      ?? null),
    san($d['imei1']            ?? null),
    san($d['imei2']            ?? null),
    san($d['inventory_status'] ?? 'Active'),
    san($d['warehouse']        ?? null),
    san($d['status']           ?? 'Good'),
  ];
}

function validateRequired(array $data, array $fields): void
{
  foreach ($fields as $f) {
    if (empty($data[$f])) respond(false, "Field '{$f}' is required.", null, 422);
  }
}

function getJsonBody(): array
{
  $data = json_decode(file_get_contents('php://input'), true);
  if (json_last_error() !== JSON_ERROR_NONE) respond(false, 'Invalid JSON body', null, 400);
  return $data ?? [];
}

function respond(bool $success, string $message, mixed $data = null, int $code = 200): never
{
  http_response_code($code);
  echo json_encode(
    ['success' => $success, 'message' => $message, 'data' => $data],
    JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
  );
  exit;
}
