<?php
// resource/views/admin panel.php --> admin panel system

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'users') && !canAccess($permissions, 'groups') && !canAccess($permissions, 'system logs') && !canAccess($permissions, 'phpmyadmin')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) {
            window.top.history.back();
        } else {
            window.history.back();
        }
    </script></body></html>';
  exit;
}

requireAccess('adminPanel', ROUTE_SETTINGS);
$access = getMenuAccess();

$sessionUserId = (int)($_SESSION['user_id'] ?? 0);

// ════════════════════════════════════════════════════════════════════════════
// AJAX HANDLERS
// ════════════════════════════════════════════════════════════════════════════
if (isset($_GET['action'])) {
  if ($_GET['action'] !== 'export_db') {
    header('Content-Type: application/json');
  }

  try {
    $pdo = getMainDBConnection();

    // ── USERS MANAGEMENT ACTIONS ─────────────────────────────────────────────
    if ($_GET['action'] === 'fetch_users') {
      if ($access['users'] !== true) {
        echo json_encode(['success' => false, 'message' => 'Access denied. Administrators only.']);
        exit;
      }
      $where  = "WHERE 1=1";
      $params = [];

      if (!empty($_GET['search_user'])) {
        $where .= " AND username LIKE :search_user";
        $params[':search_user'] = '%' . $_GET['search_user'] . '%';
      }
      if (!empty($_GET['search_email'])) {
        $where .= " AND email LIKE :search_email";
        $params[':search_email'] = '%' . $_GET['search_email'] . '%';
      }

      $stmt = $pdo->prepare("
        SELECT id, username, email, first_name, last_name,
               phone, my_database, user_group, created_at, last_login
        FROM   users $where
        ORDER  BY id ASC
      ");
      $stmt->execute($params);
      $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

      $stats = $pdo->query("
        SELECT COUNT(*) AS total,
               SUM(last_login IS NOT NULL) AS logged_in,
               SUM(last_login IS NULL)     AS never_logged
        FROM users
      ")->fetch(PDO::FETCH_ASSOC);

      echo json_encode(['success' => true, 'users' => $users, 'stats' => $stats]);
      exit;
    }

    if (in_array($_GET['action'], ['add_user', 'get_user', 'update_user', 'delete_user'], true)) {
      if ($access['users'] !== true) {
        echo json_encode(['success' => false, 'message' => 'Access denied. Administrators only.']);
        exit;
      }

      if ($_GET['action'] === 'add_user') {
        $data = json_decode(file_get_contents('php://input'), true);

        $username   = sanitizeInput($data['username']    ?? '');
        $email      = sanitizeInput($data['email']       ?? '');
        $password   = $data['password'] ?? '';
        $first_name = sanitizeInput($data['first_name']  ?? '');
        $last_name  = sanitizeInput($data['last_name']   ?? '');
        $phone      = sanitizeInput($data['phone']       ?? '');
        $my_db      = sanitizeInput($data['my_database'] ?? '');
        $user_group = sanitizeInput($data['user_group']  ?? '');

        $validGroupsStmt = $pdo->query("SELECT group_name FROM user_groups WHERE is_enabled = 1");
        $allowedGroups = $validGroupsStmt->fetchAll(PDO::FETCH_COLUMN);

        $errors = [];
        if (strlen($username) < 3)                        $errors[] = 'Username must be at least 3 characters.';
        if (!isValidEmail($email))                        $errors[] = 'Invalid email address.';
        if (!isValidPassword($password))                  $errors[] = 'Password: 8+ chars, uppercase, lowercase, number.';
        if (!$first_name || !$last_name)                  $errors[] = 'First and last name are required.';
        if (!$my_db)                                      $errors[] = 'Database name is required.';
        if (!in_array($user_group, $allowedGroups, true)) $errors[] = 'Invalid user group.';

        if ($errors) {
          echo json_encode(['success' => false, 'errors' => $errors]);
          exit;
        }

        $chk = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = ? OR email = ?");
        $chk->execute([$username, $email]);
        if ($chk->fetchColumn() > 0) {
          echo json_encode(['success' => false, 'errors' => ['Username or email already exists.']]);
          exit;
        }

        $hashed = password_hash($password, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare("
          INSERT INTO users (username,email,password,first_name,last_name,phone,my_database,user_group,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)
        ");
        $stmt->execute([$username, $email, $hashed, $first_name, $last_name, $phone ?: null, $my_db, $user_group, date('Y-m-d H:i:s')]);
        $newId = $pdo->lastInsertId();

        createUserDatabase($newId);
        logSystemAction($_SESSION['user_id'] ?? null, 'USER_REGISTERED', "Admin created user: $username (ID: $newId)");
        echo json_encode(['success' => true, 'message' => 'User added successfully.', 'id' => $newId]);
        exit;
      }

      if ($_GET['action'] === 'get_user' && isset($_GET['id'])) {
        $id   = (int) $_GET['id'];
        $stmt = $pdo->prepare("
          SELECT id,username,email,first_name,last_name,phone,my_database,user_group
          FROM users WHERE id = ?
        ");
        $stmt->execute([$id]);
        $user = $stmt->fetch(PDO::FETCH_ASSOC);
        echo $user
          ? json_encode(['success' => true, 'user' => $user])
          : json_encode(['success' => false, 'message' => 'User not found.']);
        exit;
      }

      if ($_GET['action'] === 'update_user' && isset($_GET['id'])) {
        $id   = (int) $_GET['id'];
        $self = (int) ($_SESSION['user_id'] ?? 0);
        $data = json_decode(file_get_contents('php://input'), true);

        $username   = sanitizeInput($data['username']    ?? '');
        $email      = sanitizeInput($data['email']       ?? '');
        $password   = $data['password'] ?? '';
        $first_name = sanitizeInput($data['first_name']  ?? '');
        $last_name  = sanitizeInput($data['last_name']   ?? '');
        $phone      = sanitizeInput($data['phone']       ?? '');
        $my_db      = sanitizeInput($data['my_database'] ?? '');
        $user_group = sanitizeInput($data['user_group']  ?? '');

        $validGroupsStmt = $pdo->query("SELECT group_name FROM user_groups WHERE is_enabled = 1");
        $allowedGroups = $validGroupsStmt->fetchAll(PDO::FETCH_COLUMN);

        $errors = [];
        if (strlen($username) < 3)                        $errors[] = 'Username must be at least 3 characters.';
        if (!isValidEmail($email))                        $errors[] = 'Invalid email address.';
        if ($password && !isValidPassword($password))     $errors[] = 'Password: 8+ chars, uppercase, lowercase, number.';
        if (!$first_name || !$last_name)                  $errors[] = 'First and last name are required.';
        if (!$my_db)                                      $errors[] = 'Database name is required.';
        if (!in_array($user_group, $allowedGroups, true)) $errors[] = 'Invalid user group.';

        if ($errors) {
          echo json_encode(['success' => false, 'errors' => $errors]);
          exit;
        }

        if ($id === $self && $user_group !== 'Administrator') {
          echo json_encode(['success' => false, 'errors' => ['You cannot remove your own Administrator role.']]);
          exit;
        }

        $chk = $pdo->prepare("SELECT COUNT(*) FROM users WHERE (username = ? OR email = ?) AND id != ?");
        $chk->execute([$username, $email, $id]);
        if ($chk->fetchColumn() > 0) {
          echo json_encode(['success' => false, 'errors' => ['Username or email already taken.']]);
          exit;
        }

        if ($password) {
          $hashed = password_hash($password, PASSWORD_DEFAULT);
          $stmt = $pdo->prepare("UPDATE users SET username=?,email=?,password=?,first_name=?,last_name=?,phone=?,my_database=?,user_group=?,updated_at=? WHERE id=?");
          $stmt->execute([$username, $email, $hashed, $first_name, $last_name, $phone ?: null, $my_db, $user_group, date('Y-m-d H:i:s'), $id]);
        } else {
          $stmt = $pdo->prepare("UPDATE users SET username=?,email=?,first_name=?,last_name=?,phone=?,my_database=?,user_group=?,updated_at=? WHERE id=?");
          $stmt->execute([$username, $email, $first_name, $last_name, $phone ?: null, $my_db, $user_group, date('Y-m-d H:i:s'), $id]);
        }

        logSystemAction($_SESSION['user_id'] ?? null, 'USER_UPDATED', "Updated user ID: $id ($username)");
        echo json_encode(['success' => true, 'message' => 'User updated successfully.']);
        exit;
      }

      if ($_GET['action'] === 'delete_user' && isset($_GET['id'])) {
        $id = (int) $_GET['id'];

        if ((int)($_SESSION['user_id'] ?? 0) === $id) {
          echo json_encode(['success' => false, 'message' => 'You cannot delete your own account.']);
          exit;
        }

        $chk = $pdo->prepare("SELECT username, user_group FROM users WHERE id = ?");
        $chk->execute([$id]);
        $user = $chk->fetch(PDO::FETCH_ASSOC);

        if (!$user) {
          echo json_encode(['success' => false, 'message' => 'User not found.']);
          exit;
        }
        if ($id === 1 && $user['user_group'] === 'Administrator') {
          echo json_encode(['success' => false, 'message' => 'The root Administrator account cannot be deleted.']);
          exit;
        }

        $stmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
        $stmt->execute([$id]);
        logSystemAction($_SESSION['user_id'] ?? null, 'USER_DELETED', "Deleted user: {$user['username']} (ID: $id)");
        echo json_encode(['success' => true, 'message' => 'User deleted successfully.']);
        exit;
      }
    }

    // ── FETCH GROUPS FOR USER FORM DROPDOWN ──────────────────────────────────
    if ($_GET['action'] === 'fetch_groups_dropdown') {
      if ($access['users'] !== true) {
        echo json_encode(['success' => false]);
        exit;
      }
      $stmt = $pdo->query("SELECT group_name FROM user_groups WHERE is_enabled = 1 ORDER BY group_name ASC");
      $groups = $stmt->fetchAll(PDO::FETCH_COLUMN);
      echo json_encode(['success' => true, 'groups' => $groups]);
      exit;
    }

    // ── SYSTEM LOG ACTIONS ───────────────────────────────────────────────────
    if (in_array($_GET['action'], ['fetch_logs', 'fetch_log_actions', 'delete_log', 'delete_all_logs'], true)) {
      if ($access['system logs'] !== true) {
        echo json_encode(['success' => false, 'message' => 'Access denied.']);
        exit;
      }

      if ($_GET['action'] === 'fetch_log_actions') {
        $stmt = $pdo->query("SELECT DISTINCT action FROM system_logs ORDER BY action ASC");
        $actions = $stmt->fetchAll(PDO::FETCH_COLUMN);
        echo json_encode(['success' => true, 'actions' => $actions]);
        exit;
      }

      if ($_GET['action'] === 'fetch_logs') {
        $where  = "WHERE 1=1";
        $params = [];

        if (!empty($_GET['search'])) {
          $where .= " AND (sl.action LIKE :s OR sl.details LIKE :s2 OR sl.ip_address LIKE :s3 OR u.username LIKE :s4)";
          $like = '%' . $_GET['search'] . '%';
          $params[':s'] = $params[':s2'] = $params[':s3'] = $params[':s4'] = $like;
        }
        if (!empty($_GET['action_filter'])) {
          $where .= " AND sl.action = :af";
          $params[':af'] = $_GET['action_filter'];
        }

        $stmt = $pdo->prepare("
          SELECT sl.id, sl.user_id,
                 COALESCE(u.username,'System') AS username,
                 sl.action, sl.details, sl.ip_address, sl.user_agent, sl.created_at
          FROM   system_logs sl
          LEFT   JOIN users u ON u.id = sl.user_id
          $where
          ORDER  BY sl.created_at DESC
        ");
        $stmt->execute($params);
        $logs = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stats = $pdo->query("
          SELECT COUNT(*) AS total,
                 SUM(action='USER_LOGIN' OR action='LOGIN') AS logins,
                 SUM(action LIKE '%UPDATED%')               AS updates,
                 SUM(action LIKE '%DELETED%')               AS deletes
          FROM system_logs
        ")->fetch(PDO::FETCH_ASSOC);

        echo json_encode(['success' => true, 'logs' => $logs, 'stats' => $stats]);
        exit;
      }

      if ($_GET['action'] === 'delete_log' && isset($_GET['id'])) {
        $id   = (int) $_GET['id'];
        $stmt = $pdo->prepare("DELETE FROM system_logs WHERE id = :id");
        $stmt->execute([':id' => $id]);
        echo $stmt->rowCount()
          ? json_encode(['success' => true])
          : json_encode(['success' => false, 'message' => 'Log not found.']);
        exit;
      }

      if ($_GET['action'] === 'delete_all_logs') {
        $count = $pdo->query("SELECT COUNT(*) FROM system_logs")->fetchColumn();
        $pdo->exec("DELETE FROM system_logs");
        echo json_encode(['success' => true, 'deleted' => $count]);
        exit;
      }
    }

    // ── USER GROUPS ACTIONS ──────────────────────────────────────────────────
    if (in_array($_GET['action'], [
      'fetch_groups',
      'fetch_group',
      'add_group',
      'update_group',
      'delete_group',
      'fetch_group_users'
    ], true)) {

      if ($access['groups'] !== true) {
        echo json_encode(['success' => false, 'message' => 'Access denied. Administrators only.']);
        exit;
      }

      if ($_GET['action'] === 'fetch_groups') {
        $where  = "WHERE 1=1";
        $params = [];

        if (!empty($_GET['search_group'])) {
          $where .= " AND (ug.group_name LIKE :sg OR ug.group_number LIKE :sg2)";
          $like = '%' . $_GET['search_group'] . '%';
          $params[':sg'] = $params[':sg2'] = $like;
        }

        $stmt = $pdo->prepare("
          SELECT
            ug.id, ug.group_number, ug.group_name, ug.description,
            ug.is_enabled, ug.permissions, ug.created_at, ug.updated_at,
            COUNT(u.id) AS bound_users
          FROM user_groups ug
          LEFT JOIN users u ON u.user_group COLLATE utf8mb4_general_ci = ug.group_name COLLATE utf8mb4_general_ci
          $where
          GROUP BY ug.id
          ORDER BY ug.id ASC
        ");
        $stmt->execute($params);
        $groups = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $stats = $pdo->query("SELECT COUNT(*) AS total FROM user_groups")->fetch(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'groups' => $groups, 'stats' => $stats]);
        exit;
      }

      if ($_GET['action'] === 'fetch_group' && isset($_GET['id'])) {
        $id   = (int) $_GET['id'];
        $stmt = $pdo->prepare("SELECT * FROM user_groups WHERE id = ?");
        $stmt->execute([$id]);
        $group = $stmt->fetch(PDO::FETCH_ASSOC);
        echo $group
          ? json_encode(['success' => true, 'group' => $group])
          : json_encode(['success' => false, 'message' => 'Group not found.']);
        exit;
      }

      if ($_GET['action'] === 'fetch_group_users' && isset($_GET['group_name'])) {
        $groupName = $_GET['group_name'];
        $stmt = $pdo->prepare("
          SELECT id, username, first_name, last_name, email
          FROM users WHERE user_group = ? ORDER BY username ASC
        ");
        $stmt->execute([$groupName]);
        $users = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'users' => $users]);
        exit;
      }

      if ($_GET['action'] === 'add_group') {
        $data        = json_decode(file_get_contents('php://input'), true);
        $group_name  = sanitizeInput($data['group_name']  ?? '');
        $description = sanitizeInput($data['description'] ?? '');
        $is_enabled  = isset($data['is_enabled']) ? (int)(bool)$data['is_enabled'] : 1;
        $permissions = $data['permissions'] ?? null;

        $errors = [];
        if (strlen($group_name) < 2) $errors[] = 'Group name must be at least 2 characters.';

        $chk = $pdo->prepare("SELECT COUNT(*) FROM user_groups WHERE group_name = ?");
        $chk->execute([$group_name]);
        if ($chk->fetchColumn() > 0) $errors[] = 'A group with that name already exists.';

        if ($errors) {
          echo json_encode(['success' => false, 'errors' => $errors]);
          exit;
        }

        $group_number = 'GRP-' . date('Ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(2)), 0, 4));
        $permJson = $permissions ? json_encode($permissions) : null;

        $stmt = $pdo->prepare("
          INSERT INTO user_groups (group_number, group_name, description, is_enabled, permissions, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([$group_number, $group_name, $description ?: null, $is_enabled, $permJson, date('Y-m-d H:i:s')]);
        $newId = $pdo->lastInsertId();

        logSystemAction($_SESSION['user_id'] ?? null, 'GROUP_CREATED', "Created group: $group_name (ID: $newId)");
        echo json_encode(['success' => true, 'message' => 'Group created successfully.', 'id' => $newId]);
        exit;
      }

      if ($_GET['action'] === 'update_group' && isset($_GET['id'])) {
        $id          = (int) $_GET['id'];
        $data        = json_decode(file_get_contents('php://input'), true);
        $group_name  = sanitizeInput($data['group_name']  ?? '');
        $description = sanitizeInput($data['description'] ?? '');
        $is_enabled  = isset($data['is_enabled']) ? (int)(bool)$data['is_enabled'] : 1;
        $permissions = $data['permissions'] ?? null;

        $errors = [];
        if (strlen($group_name) < 2) $errors[] = 'Group name must be at least 2 characters.';

        $chk = $pdo->prepare("SELECT COUNT(*) FROM user_groups WHERE group_name = ? AND id != ?");
        $chk->execute([$group_name, $id]);
        if ($chk->fetchColumn() > 0) $errors[] = 'A group with that name already exists.';

        if ($errors) {
          echo json_encode(['success' => false, 'errors' => $errors]);
          exit;
        }

        $old = $pdo->prepare("SELECT group_name FROM user_groups WHERE id = ?");
        $old->execute([$id]);
        $oldRow  = $old->fetch(PDO::FETCH_ASSOC);
        $oldName = $oldRow ? $oldRow['group_name'] : null;

        $permJson = $permissions ? json_encode($permissions) : null;

        $stmt = $pdo->prepare("
          UPDATE user_groups
          SET group_name = ?, description = ?, is_enabled = ?, permissions = ?, updated_at = ?
          WHERE id = ?
        ");
        $stmt->execute([$group_name, $description ?: null, $is_enabled, $permJson, date('Y-m-d H:i:s'), $id]);

        if ($oldName && $oldName !== $group_name) {
          $upd = $pdo->prepare("UPDATE users SET user_group = ? WHERE user_group = ?");
          $upd->execute([$group_name, $oldName]);
        }

        logSystemAction($_SESSION['user_id'] ?? null, 'GROUP_UPDATED', "Updated group ID: $id ($group_name)");
        echo json_encode(['success' => true, 'message' => 'Group updated successfully.']);
        exit;
      }

      if ($_GET['action'] === 'delete_group' && isset($_GET['id'])) {
        $id = (int) $_GET['id'];

        $chk = $pdo->prepare("SELECT group_name FROM user_groups WHERE id = ?");
        $chk->execute([$id]);
        $group = $chk->fetch(PDO::FETCH_ASSOC);

        if (!$group) {
          echo json_encode(['success' => false, 'message' => 'Group not found.']);
          exit;
        }

        $bound = $pdo->prepare("SELECT COUNT(*) FROM users WHERE user_group = ?");
        $bound->execute([$group['group_name']]);
        $count = $bound->fetchColumn();

        if ($count > 0) {
          echo json_encode([
            'success' => false,
            'message' => "Cannot delete \"{$group['group_name']}\" — $count user(s) still assigned. Reassign them first."
          ]);
          exit;
        }

        $stmt = $pdo->prepare("DELETE FROM user_groups WHERE id = ?");
        $stmt->execute([$id]);
        logSystemAction($_SESSION['user_id'] ?? null, 'GROUP_DELETED', "Deleted group: {$group['group_name']} (ID: $id)");
        echo json_encode(['success' => true, 'message' => 'Group deleted successfully.']);
        exit;
      }
    }

    // ── PHP MYADMIN — EXPORT SQL ─────────────────────────────────────────────
    if ($_GET['action'] === 'export_db') {
      if ($access['phpmyadmin'] !== true) {
        echo json_encode(['success' => false, 'message' => 'Access denied. Administrators only.']);
        exit;
      }

      $mode   = $_GET['mode'] ?? 'full';
      $dbName = $pdo->query("SELECT DATABASE()")->fetchColumn();

      header('Content-Type: application/octet-stream');
      header('Content-Disposition: attachment; filename="' . $dbName . '_' . date('Ymd_His') . '.sql"');
      header('Cache-Control: no-cache');

      $out = fopen('php://output', 'w');
      fwrite($out, "-- Database: `$dbName`\n-- Exported: " . date('Y-m-d H:i:s') . "\n-- Mode: $mode\n\n");
      fwrite($out, "SET FOREIGN_KEY_CHECKS=0;\n\n");

      $tables = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
      foreach ($tables as $table) {
        fwrite($out, "-- Table: `$table`\n\n");
        if ($mode === 'structure' || $mode === 'full') {
          fwrite($out, "DROP TABLE IF EXISTS `$table`;\n");
          $create = $pdo->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_ASSOC);
          fwrite($out, $create['Create Table'] . ";\n\n");
        }
        if ($mode === 'data' || $mode === 'full') {
          $rows = $pdo->query("SELECT * FROM `$table`")->fetchAll(PDO::FETCH_ASSOC);
          if ($rows) {
            $cols = '`' . implode('`, `', array_keys($rows[0])) . '`';
            foreach ($rows as $row) {
              $vals = array_map(fn($v) => $v === null ? 'NULL' : $pdo->quote($v), array_values($row));
              fwrite($out, "INSERT INTO `$table` ($cols) VALUES (" . implode(', ', $vals) . ");\n");
            }
            fwrite($out, "\n");
          }
        }
      }
      fwrite($out, "SET FOREIGN_KEY_CHECKS=1;\n");
      fclose($out);
      exit;
    }

    echo json_encode(['success' => false, 'message' => 'Unknown action.']);
  } catch (PDOException $e) {
    error_log("admin_panel.php error: " . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
  }
  exit;
}

// ── Define menu pages for Bind Access ────────────────────────────────────────
$MENU_PAGES = scanPortalPages();
$MENU_PAGES = applyIconHints($MENU_PAGES);

function renderBindRows(array $pages, int $depth = 0): void
{
  foreach ($pages as $page):
    $hasChildren = !empty($page['children']);
    $indent      = $depth * 20;
    $isChild     = $depth > 0;
    $key         = $page['key'];
    $icon        = $page['icon'] ?? 'fa-circle';
    $label       = htmlspecialchars($page['label']);
?>
    <div class="bind-group" data-key="<?= $key ?>" data-depth="<?= $depth ?>">

      <div class="bind-row <?= $isChild ? 'bind-child-row' : '' ?> <?= $hasChildren ? 'has-children' : '' ?>"
        style="<?= $depth > 0 ? "margin-left:{$indent}px; border-left: 2px solid #ede9fe;" : '' ?>">

        <div class="bind-row-left">
          <?php if ($hasChildren): ?>
            <button type="button" class="bind-toggle-btn"
              onclick="toggleBindChildren('<?= $key ?>')"
              id="toggleBtn_<?= $key ?>">
              <i class="fas fa-play" id="toggleIcon_<?= $key ?>"></i>
            </button>
          <?php else: ?>
            <span style="width:24px;display:inline-block;flex-shrink:0;"></span>
          <?php endif; ?>

          <div class="bind-icon" style="<?= $depth > 0 ? 'width:26px;height:26px;font-size:11px;background:#f3f0ff;' : '' ?>">
            <i class="fas <?= $icon ?>" style="<?= $depth > 0 ? 'color:#7c3aed;' : '' ?>"></i>
          </div>

          <div>
            <span class="bind-label" style="<?= $depth > 0 ? 'font-size:12.5px;font-weight:500;color:#374151;' : '' ?>">
              <?= $label ?>
            </span>
            <?php if ($depth > 1): ?>
              <div style="font-size:10px;color:#9ca3af;margin-top:1px;"></div>
            <?php endif; ?>
          </div>
        </div>

        <div class="radio-pill-group" data-key="<?= $key ?>" data-depth="<?= $depth ?>">
          <label class="radio-pill allow-pill selected" onclick="selectPill(this)">
            <input type="radio" name="perm_<?= $key ?>" value="allow" checked>
            <span class="radio-pill-dot"></span> Allow
          </label>
          <label class="radio-pill deny-pill" onclick="selectPill(this)">
            <input type="radio" name="perm_<?= $key ?>" value="deny">
            <span class="radio-pill-dot"></span> Not allow
          </label>
        </div>
      </div>

      <?php if ($hasChildren): ?>
        <div class="bind-children-wrap" id="children_<?= $key ?>" style="display:none;">
          <?php renderBindRows($page['children'], $depth + 1); ?>
        </div>
      <?php endif; ?>

    </div>
<?php
  endforeach;
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin Panel</title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=yde24">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet" />

  <style>
    /* ── Buttons ── */
    .btn-add {
      background: linear-gradient(135deg, #6ce29d 0%, #2c9c60 100%);
      color: white;
      margin-left: auto;
    }

    .btn-danger {
      background: linear-gradient(135deg, #f6a253 0%, #ef3838 100%);
      color: white;
      margin-left: auto;
    }

    /* ── Panel ── */
    .panel {
      background: #fff;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 12px rgba(0, 0, 0, .08);
    }

    /* ── Stats header ── */
    .refresh-indicator {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-left: auto;
      color: rgba(255, 255, 255, .75);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4ade80;
      box-shadow: 0 0 0 0 rgba(74, 222, 128, .7);
      animation: pulse-ring 2s ease-in-out infinite;
      flex-shrink: 0;
    }

    .pulse-dot2 {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #dc3545;
      animation: pulse-ring2 2s ease-in-out infinite;
      flex-shrink: 0;
    }

    .pulse-dot.paused {
      background: #9ca3af;
      box-shadow: none;
      animation: none;
    }

    @keyframes pulse-ring {
      0% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, .7);
      }

      70% {
        box-shadow: 0 0 0 7px rgba(74, 222, 128, 0);
      }

      100% {
        box-shadow: 0 0 0 0 rgba(74, 222, 128, 0);
      }
    }

    @keyframes pulse-ring2 {
      0% {
        box-shadow: 0 0 0 0 rgba(222, 74, 74, .7);
      }

      70% {
        box-shadow: 0 0 0 7px rgba(222, 74, 74, 0);
      }

      100% {
        box-shadow: 0 0 0 0 rgba(222, 74, 99, 0);
      }
    }

    .countdown-bar-wrap {
      height: 3px;
      background: rgba(255, 255, 255, .15);
      overflow: hidden;
    }

    .countdown-bar {
      height: 100%;
      background: rgba(255, 255, 255, .55);
      width: 100%;
      transition: width 1s linear;
    }

    /* ── Table ── */
    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      table-layout: fixed;
    }

    thead tr {
      background: #f8f9fa;
      border-bottom: 2px solid #e9ecef;
    }

    th {
      padding: 11px 14px;
      text-align: left;
      font-weight: 600;
      color: #495057;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    tbody tr {
      border-bottom: 1px solid #f0f0f0;
      transition: background .12s;
    }

    tbody tr:hover {
      background: #fafafa;
    }

    tbody tr:last-child {
      border-bottom: none;
    }

    td {
      padding: 10px 14px;
      color: #555;
      vertical-align: middle;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .sn-cell {
      color: #aaa;
      font-size: 12px;
      text-align: center;
      width: 50px;
    }

    .user-cell {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    /* ── Action buttons ── */
    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 11px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: filter .15s;
    }

    .action-btn:hover {
      filter: brightness(.88);
    }

    .action-btn:disabled {
      opacity: .5;
      cursor: not-allowed;
      filter: none;
    }

    .btn-edit-row {
      background: #6d28d9;
      color: #fff;
    }

    .btn-del-row {
      background: #ef4444;
      color: #fff;
    }

    .btn-view-log {
      background: #6d28d9;
      color: #fff;
    }

    .btn-del-log {
      background: #ef4444;
      color: #fff;
    }

    .lock-wrap {
      position: relative;
      display: inline-block;
    }

    .lock-wrap .tip {
      display: none;
      position: absolute;
      bottom: 110%;
      left: 50%;
      transform: translateX(-50%);
      background: #1f2937;
      color: #fff;
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 4px;
      white-space: nowrap;
      z-index: 20;
      pointer-events: none;
    }

    .lock-wrap:hover .tip {
      display: block;
    }

    /* ── Pagination ── */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      padding: 12px 16px;
      border-top: 1px solid #f0f0f0;
      font-size: 13px;
      color: #888;
    }

    .page-btn {
      width: 30px;
      height: 30px;
      border-radius: 5px;
      border: 1px solid #dee2e6;
      background: #fff;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background .15s;
    }

    .page-btn.active {
      background: #7c3aed;
      color: #fff;
      border-color: #7c3aed;
    }

    .page-btn:hover:not(.active) {
      background: #f0f0f0;
    }

    /* ── Empty / Spinner ── */
    .empty-row td {
      text-align: center;
      padding: 36px;
      color: #adb5bd;
      font-style: italic;
    }

    .spinner {
      display: inline-block;
      width: 18px;
      height: 18px;
      border: 2px solid #c4b5fd;
      border-top-color: #7c3aed;
      border-radius: 50%;
      animation: spin .7s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* ── Log badges ── */
    .badge {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 12px;
      font-size: 11.5px;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-login {
      background: #d1fae5;
      color: #065f46;
    }

    .badge-logout {
      background: #fee2e2;
      color: #991b1b;
    }

    .badge-create {
      background: #dbeafe;
      color: #1e40af;
    }

    .badge-update {
      background: #fef3c7;
      color: #92400e;
    }

    .badge-delete {
      background: #ffe4e6;
      color: #9f1239;
    }

    .badge-default {
      background: #e5e7eb;
      color: #374151;
    }

    .details-cell {
      max-width: 220px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ════════════════════════════════════
       MODALS — Base
    ════════════════════════════════════ */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, .45);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }

    .modal-overlay.show {
      display: flex;
    }

    .modal-box {
      background: #fff;
      border-radius: 10px;
      padding: 24px 24px 18px;
      width: 480px;
      max-width: 96vw;
      box-shadow: 0 10px 40px rgba(0, 0, 0, .2);
      animation: pop .2s ease;
      max-height: 90vh;
      overflow-y: auto;
    }

    .modal-box.confirm {
      width: 380px;
      text-align: center;
    }

    @keyframes pop {
      from {
        transform: scale(.9);
        opacity: 0;
      }

      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    .modal-box h3 {
      font-size: 16px;
      margin-bottom: 16px;
      color: #1f2937;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .modal-box p {
      font-size: 13.5px;
      color: #6b7280;
      margin-bottom: 20px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0 12px;
    }

    .form-row {
      margin-bottom: 12px;
    }

    .form-row label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 4px;
    }

    .form-row input,
    .form-row select {
      width: 100%;
      padding: 7px 10px;
      font-size: 13px;
      border: 1px solid #d1d5db;
      border-radius: 5px;
      outline: none;
      transition: border-color .15s;
      background: #fff;
    }

    .form-row input:focus,
    .form-row select:focus {
      border-color: #7c3aed;
      box-shadow: 0 0 0 3px rgba(124, 58, 237, .1);
    }

    .err-box {
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 5px;
      padding: 8px 12px;
      font-size: 12px;
      color: #b91c1c;
      margin-bottom: 12px;
      display: none;
    }

    .modal-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 16px;
    }

    .modal-actions button {
      padding: 8px 18px;
      border: none;
      border-radius: 5px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-cancel {
      background: #e5e7eb;
      color: #374151;
    }

    .btn-confirm {
      background: #7c3aed;
      color: #fff;
    }

    .log-detail-grid {
      display: grid;
      gap: 10px;
      margin-bottom: 22px;
    }

    .log-detail-row {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 8px;
      font-size: 13px;
    }

    .log-detail-row .ldr-label {
      font-weight: 600;
      color: #374151;
    }

    .log-detail-row .ldr-val {
      color: #555;
      word-break: break-word;
    }

    /* ── Toast ── */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1f2937;
      color: #fff;
      padding: 12px 20px;
      border-radius: 7px;
      font-size: 13px;
      font-weight: 500;
      opacity: 0;
      transform: translateY(10px);
      transition: all .3s;
      z-index: 2000;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: none;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    .toast i {
      color: #34d399;
    }

    .toast.error i {
      color: #f87171;
    }

    /* ════════════════════════════════════
       GROUP MODAL — Tabbed Layout
    ════════════════════════════════════ */
    .gmodal-box {
      background: #fff;
      border-radius: 12px;
      width: 600px;
      max-width: 96vw;
      max-height: 90vh;
      box-shadow: 0 10px 40px rgba(0, 0, 0, .22);
      animation: pop .2s ease;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .gmodal-header {
      padding: 18px 24px 0;
      border-bottom: 1px solid #e9ecef;
      flex-shrink: 0;
    }

    .gmodal-title {
      font-size: 16px;
      font-weight: 700;
      color: #1f2937;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }

    .gmodal-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .gmodal-sidebar {
      width: 130px;
      flex-shrink: 0;
      background: #f8f9fa;
      border-right: 1px solid #e9ecef;
      padding: 14px 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .gmodal-sidetab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      color: #6b7280;
      border: none;
      background: none;
      text-align: left;
      border-right: 3px solid transparent;
      transition: all .15s;
    }

    .gmodal-sidetab:hover {
      background: #f0f0f0;
      color: #374151;
    }

    .gmodal-sidetab.active {
      background: #ede9fe;
      color: #7c3aed;
      border-right-color: #7c3aed;
      font-weight: 600;
    }

    .gmodal-sidetab i {
      font-size: 13px;
      width: 16px;
      text-align: center;
    }

    .gmodal-content {
      flex: 1;
      padding: 20px 22px;
      overflow-y: auto;
    }

    .gmodal-tabpanel {
      display: none;
    }

    .gmodal-tabpanel.active {
      display: block;
    }

    .gmodal-footer {
      padding: 14px 24px;
      border-top: 1px solid #e9ecef;
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      flex-shrink: 0;
    }

    /* ── Bind Access rows ── */
    .bind-section-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .6px;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 10px;
      margin-top: 4px;
    }

    .bind-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 7px;
      border-radius: 8px;
      border: 1px solid #f0f0f0;
      margin-bottom: 8px;
      transition: border-color .15s, background .15s;
    }

    .bind-row:hover {
      background: #fafafa;
      border-color: #e0d9f8;
    }

    .bind-row-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .bind-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #ede9fe;
      color: #7c3aed;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }

    .bind-label {
      font-size: 13px;
      font-weight: 600;
      color: #1f2937;
    }

    /* ── Bind tree toggle button ── */
    .bind-toggle-btn {
      background: none;
      border: none;
      cursor: pointer;
      width: 24px;
      height: 24px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #7c3aed;
      padding: 0;
      flex-shrink: 0;
      transition: transform .15s;
    }

    .bind-toggle-btn i {
      font-size: 10px;
      transition: transform .2s;
    }

    .bind-toggle-btn.open i {
      transform: rotate(90deg);
    }

    /* ── Child rows ── */
    .bind-children {
      margin-left: 12px;
      border-left: 2px solid #ede9fe;
      padding-left: 4px;
      margin-bottom: 2px;
    }

    .bind-child-row {
      background: #fafafa;
      border-color: #f3f0ff;
    }

    .bind-child-row:hover {
      background: #f5f3ff;
    }

    .bind-children-wrap {
      position: relative;
    }

    /* ── Disabled pill state ── */
    .radio-pill.disabled {
      opacity: 0.45;
      cursor: not-allowed;
      pointer-events: none;
    }

    .radio-pill-group {
      display: flex;
      gap: 3px;
    }

    .radio-pill {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 3px 6px;
      border-radius: 20px;
      cursor: pointer;
      border: 1.5px solid #e5e7eb;
      font-size: 8px;
      font-weight: 600;
      transition: all .15s;
      user-select: none;
      color: #6b7280;
    }

    .radio-pill input[type="radio"] {
      display: none;
    }

    .radio-pill-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 2px solid #d1d5db;
      flex-shrink: 0;
      transition: all .15s;
    }

    .radio-pill.allow-pill.selected {
      background: #d1fae5;
      border-color: #10b981;
      color: #065f46;
    }

    .radio-pill.allow-pill.selected .radio-pill-dot {
      background: #10b981;
      border-color: #10b981;
    }

    .radio-pill.deny-pill.selected {
      background: #fee2e2;
      border-color: #ef4444;
      color: #991b1b;
    }

    .radio-pill.deny-pill.selected .radio-pill-dot {
      background: #ef4444;
      border-color: #ef4444;
    }

    /* ── Enabled toggle ── */
    .toggle-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 8px;
      border: 1px solid #f0f0f0;
      margin-bottom: 10px;
    }

    .toggle-switch {
      position: relative;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-track {
      position: absolute;
      inset: 0;
      background: #d1d5db;
      border-radius: 11px;
      cursor: pointer;
      transition: background .2s;
    }

    .toggle-track::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #fff;
      top: 3px;
      left: 3px;
      transition: transform .2s;
      box-shadow: 0 1px 3px rgba(0, 0, 0, .2);
    }

    input:checked+.toggle-track {
      background: #7c3aed;
    }

    input:checked+.toggle-track::before {
      transform: translateX(18px);
    }

    .toggle-label {
      font-size: 13px;
      font-weight: 500;
      color: #374151;
    }

    .toggle-sublabel {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 1px;
    }

    .desc-textarea {
      width: 100%;
      padding: 8px 10px;
      font-size: 13px;
      border: 1px solid #d1d5db;
      border-radius: 5px;
      outline: none;
      resize: vertical;
      min-height: 72px;
      font-family: inherit;
      transition: border-color .15s;
    }

    .desc-textarea:focus {
      border-color: #7c3aed;
      box-shadow: 0 0 0 3px rgba(124, 58, 237, .1);
    }

    @media (max-width: 640px) {

      /* ── Body padding ── */
      body {
        padding: 0;
      }

      .btn-add,
      .btn-danger {
        margin-left: 0;
        width: 100%;
        justify-content: center;
      }

      /* ── Stats header ── */
      .refresh-indicator {
        width: 100%;
        margin-left: 0;
        font-size: 11px;
      }

      /* ── Table ── */
      .table-wrap {
        padding-bottom: 52px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        width: 100%;
        overflow-y: visible;
      }

      table {
        table-layout: auto;
        min-width: 500px;
      }

      th,
      td {
        padding: 8px 10px;
        font-size: 12px;
      }

      .action-btn {
        font-size: 11px;
        padding: 4px 8px;
      }

      /* ── Pagination ── */
      .pagination {
        padding: 10px 12px;
        gap: 4px;
        font-size: 12px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .page-btn {
        width: 28px;
        height: 28px;
        font-size: 11px;
      }

      /* ── Toast ── */
      .toast {
        bottom: 14px;
        right: 14px;
        left: 14px;
        font-size: 12px;
        padding: 10px 14px;
      }

      /* ── User / Group modal ── */
      .modal-box {
        padding: 18px 16px 14px;
        border-radius: 8px;
        max-height: 95vh;
      }

      .modal-box h3 {
        font-size: 14px;
        margin-bottom: 12px;
      }

      .form-grid {
        grid-template-columns: 1fr;
      }

      .form-row input,
      .form-row select {
        font-size: 13px;
        padding: 8px 10px;
      }

      .modal-actions {
        gap: 8px;
        flex-wrap: wrap;
      }

      .modal-actions button {
        flex: 1 1 auto;
        justify-content: center;
        padding: 9px 14px;
        font-size: 13px;
      }

      /* ── Group modal (tabbed) ── */
      .gmodal-box {
        width: 100%;
        max-width: 100%;
        max-height: 95vh;
        border-radius: 10px;
      }

      .gmodal-header {
        padding: 14px 16px 0;
      }

      .gmodal-title {
        font-size: 14px;
        margin-bottom: 10px;
      }

      .gmodal-body {
        flex-direction: column;
      }

      .gmodal-sidebar {
        width: 100%;
        flex-direction: row;
        padding: 8px 12px;
        border-right: none;
        border-bottom: 1px solid #e9ecef;
        gap: 4px;
      }

      .gmodal-sidetab {
        flex: 1;
        justify-content: center;
        border-right: none;
        border-bottom: 3px solid transparent;
        padding: 8px 10px;
        font-size: 12px;
      }

      .gmodal-sidetab.active {
        border-right-color: transparent;
        border-bottom-color: #7c3aed;
      }

      .gmodal-content {
        padding: 14px 14px;
      }

      .gmodal-footer {
        padding: 12px 16px;
        flex-wrap: wrap;
      }

      .gmodal-footer button {
        flex: 1 1 auto;
        justify-content: center;
      }

      /* ── Bind access rows ── */
      .bind-row {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
        padding: 10px 10px;
      }

      .radio-pill-group {
        width: 100%;
        justify-content: flex-start;
      }

      .radio-pill {
        flex: 1;
        justify-content: center;
        font-size: 11px;
        padding: 3px 4px;
      }

      /* ── Log detail modal ── */
      .log-detail-row {
        grid-template-columns: 90px 1fr;
        font-size: 12px;
      }

    }
  </style>
</head>

<body>

  <!-- ══════════════════════════════════════════ TAB NAVIGATION ══ -->
  <div class="tab-nav">
    <button class="tab-btn" tabindex="-1" onclick="if (window.self !== window.top) {
        window.top.location.href = window.top.location.href.split('?')[0];
      } else {
        window.history.back();
      }">
      <i class="fas fa-arrow-left"></i>
      <span>Back</span>
    </button>

    <?php if ($access['users']): ?>
      <button class="tab-btn active" tabindex="-1" id="tabBtnUsers" onclick="switchTab('users')">
        <i class="fas fa-users-cog"></i> Users Management
        <span class="tab-badge" id="tabBadgeUsers">—</span>
      </button>
    <?php endif; ?>

    <?php if ($access['groups']): ?>
      <button class="tab-btn" tabindex="-1" id="tabBtnGroup" onclick="switchTab('group')">
        <i class="fas fa-layer-group"></i> Users Group
        <span class="tab-badge" id="tabBadgeGroup">—</span>
      </button>
    <?php endif; ?>

    <?php if ($access['system logs']): ?>
      <button class="tab-btn" tabindex="-1" id="tabBtnLogs" onclick="switchTab('logs')">
        <i class="fas fa-history"></i> System Logs
        <span class="tab-badge" id="tabBadgeLogs">—</span>
      </button>
    <?php endif; ?>

    <?php if ($access['phpmyadmin']): ?>
      <button class="tab-btn" tabindex="-1" id="tabBtnMyAdmin" onclick="switchTab('myadmin')">
        <i class="fas fa-database"></i> PHP MyAdmin
        <span class="tab-badge" id="tabBadgeMyAdmin">—</span>
      </button>
    <?php endif; ?>

    <button class="tab-btn" tabindex="-1" onclick="reloadActiveTab()">
      <i class="fas fa-sync-alt"></i>
      <span>Refresh</span>
    </button>
  </div>

  <!-- ══════════════════════════════════════════ TAB: USERS ══ -->
  <div class="container tab-panel active" id="panelUsers">
    <div class="controls">
      <div class="search-row">
        <div class="search-btn">
          <button class="btn btn-primary" tabindex="-1" onclick="loadUsers()"><i class="fas fa-search"></i> Search</button>
        </div>
        <div class="clear-btn">
          <button class="btn btn-secondary" tabindex="-1" onclick="clearUsersSearch()"><i class="fas fa-times"></i> Clear</button>
        </div>
        <div class="search-group" style="align-content:center;">
          <input type="text" id="searchUser" placeholder="Username" oninput="debounceUsers()" style="padding:6px 12px;border:1px solid #ccc;border-radius:5px;font-size:13px;width:180px;" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')">
          <input type="text" id="searchEmail" placeholder="Email" oninput="debounceUsers()" style="padding:6px 12px;border:1px solid #ccc;border-radius:5px;font-size:13px;width:200px;" autocomplete="off">
        </div>
        <?php if ($access['users']): ?>
          <div style="margin-left:auto;">
            <button class="btn btn-add" tabindex="-1" onclick="openAddUser()"><i class="fas fa-user-plus"></i> Add User</button>
          </div>
        <?php endif; ?>
      </div>
    </div>
    <div class="panel">
      <div class="table-header">
        <span class="table-title">Users</span>
        <div class="emp-records">
          <div style="display: flex; gap: 10px;">
            <span class="stat-item total"><i class="fas fa-users"></i></span>
            <p>Total <strong id="uStatTotal">—</strong></p>
          </div>
          <div style="display: flex; gap: 10px;">
            <span class="stat-item active"><i class="fas fa-sign-in-alt"></i></span>
            <p>Logged in <strong id="uStatLoggedIn">—</strong></p>
          </div>
          <div style="display: flex; gap: 10px;">
            <span class="stat-item inactive"><i class="fas fa-user-clock"></i></span>
            <p>Never logged <strong id="uStatNever">—</strong></p>
          </div>
        </div>
        <span class="refresh-indicator">
          <?php if ($access['users']): ?>
            <span class="pulse-dot" id="uPulseDot"></span><span>Live</span>
          <?php else: ?>
            <span class="pulse-dot2"></span><span>✗ Disconnected</span>
          <?php endif; ?>
        </span>
      </div>
      <div class="countdown-bar-wrap">
        <div class="countdown-bar" id="uCountdownBar"></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sn-cell">SN</th>
              <th>Username</th>
              <th>Email</th>
              <th>User Group</th>
              <th>Phone</th>
              <th>Database</th>
              <th>Created At</th>
              <th>Last Login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="userTableBody">
            <tr class="empty-row">
              <td colspan="9"><span class="spinner"></span> Loading users…</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" id="uPaginationWrap"></div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════ TAB: GROUPS ══ -->
  <div class="container tab-panel" id="panelGroup">
    <div class="controls">
      <div class="search-row">
        <div class="search-btn">
          <button class="btn btn-primary" tabindex="-1" onclick="loadGroups()"><i class="fas fa-search"></i> Search</button>
        </div>
        <div class="clear-btn">
          <button class="btn btn-secondary" tabindex="-1" onclick="clearGroupsSearch()"><i class="fas fa-times"></i> Clear</button>
        </div>
        <div class="search-group" style="align-content:center;">
          <input type="text" id="groupSearchInput" placeholder="Usergroup" oninput="debounceGroups()" style="padding:6px 12px;border:1px solid #ccc;border-radius:5px;font-size:13px;width:220px;" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')">
        </div>
        <?php if ($access['groups']): ?>
          <div style="margin-left:auto;">
            <button class="btn btn-add" tabindex="-1" onclick="openAddGroup()"><i class="fas fa-plus"></i> Add Group</button>
          </div>
        <?php endif; ?>
      </div>
    </div>
    <div class="panel">
      <div class="table-header">
        <span class="table-title">User Groups</span>
        <div class="emp-records">
          <div style="display: flex; gap: 10px;">
            <span class="stat-item total"><i class="fas fa-list"></i></span>
            <p>Total <strong id="gStatTotal">—</strong></p>
          </div>
        </div>
        <span class="refresh-indicator">
          <?php if ($access['groups']): ?>
            <span class="pulse-dot" id="gPulseDot"></span><span>Live</span>
          <?php else: ?>
            <span class="pulse-dot2"></span><span>✗ Disconnected</span>
          <?php endif; ?>
        </span>
      </div>
      <div class="countdown-bar-wrap">
        <div class="countdown-bar" id="gCountdownBar"></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sn-cell">SN</th>
              <th>Group Name</th>
              <th>Bound Users</th>
              <th>Status</th>
              <th>Created At</th>
              <th>Last Update</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="groupTableBody">
            <tr class="empty-row">
              <td colspan="7"><span class="spinner"></span> Loading groups…</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" id="gPaginationWrap"></div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════ TAB: LOGS ══ -->
  <div class="container tab-panel" id="panelLogs">
    <div class="controls">
      <div class="search-row">
        <div class="search-btn">
          <button class="btn btn-primary" tabindex="-1" onclick="loadLogs()"><i class="fas fa-search"></i> Search</button>
        </div>
        <div class="clear-btn">
          <button class="btn btn-secondary" tabindex="-1" onclick="clearLogsSearch()"><i class="fas fa-times"></i> Clear</button>
        </div>
        <div class="search-group" style="align-content:center;">
          <input type="text" id="logSearchInput" placeholder="Search action, user, IP, details…" style="padding:6px 12px;border:1px solid #ccc;border-radius:5px;font-size:13px;width:220px;" oninput="debounceLogs()">
          <select id="logActionFilter" onchange="loadLogs()" style="padding:6px 10px;border:1px solid #ccc;border-radius:5px;font-size:13px;">
            <option value="">All Actions</option>
          </select>
        </div>
        <?php if ($access['system logs']): ?>
          <div style="margin-left:auto;">
            <button class="btn btn-danger" tabindex="-1" onclick="confirmDeleteAllLogs()"><i class="fas fa-trash"></i> Delete All Data</button>
          </div>
        <?php endif; ?>
      </div>
    </div>
    <div class="panel">
      <div class="table-header">
        <span class="table-title">System Logs</span>
        <div class="emp-records">
          <div style="display: flex; gap: 10px;">
            <span class="stat-item total"><i class="fas fa-list"></i></span>
            <p>Total <strong id="lStatTotal">—</strong></p>
          </div>
          <div style="display: flex; gap: 10px;">
            <span class="stat-item active"><i class="fas fa-sign-in-alt"></i></span>
            <p>Logins <strong id="lStatLogins">—</strong></p>
          </div>
          <div style="display: flex; gap: 10px;">
            <span class="stat-item update"><i class="fas fa-user-edit"></i></span>
            <p>Updates <strong id="lStatUpdates">—</strong></p>
          </div>
          <div style="display: flex; gap: 10px;">
            <span class="stat-item inactive"><i class="fas fa-trash-alt"></i></span>
            <p>Deletions <strong id="lStatDeletes">—</strong></p>
          </div>
        </div>
        <span class="refresh-indicator">
          <?php if ($access['system logs']): ?>
            <span class="pulse-dot" id="lPulseDot"></span><span>Live</span>
          <?php else: ?>
            <span class="pulse-dot2"></span><span>✗ Disconnected</span>
          <?php endif; ?>
        </span>
      </div>
      <div class="countdown-bar-wrap">
        <div class="countdown-bar" id="lCountdownBar"></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="sn-cell">SN</th>
              <th>Username</th>
              <th>Action</th>
              <th>Details</th>
              <th>IP Address</th>
              <th>User Agent</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="logTableBody">
            <tr class="empty-row">
              <td colspan="8"><span class="spinner"></span> Loading logs…</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination" id="lPaginationWrap"></div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════ TAB: MYADMIN ══ -->
  <div class="container tab-panel" id="panelMyadmin">
    <div class="controls">
      <span style="font-size:13px;font-weight:600;color:#374151;">
        <i class="fas fa-database" style="color:#7c3aed;margin-right:6px;"></i> Database Export
      </span>
    </div>
    <div class="panel" style="padding:28px 28px 24px;">
      <div style="max-width:520px;">
        <h3 style="font-size:15px;color:#1f2937;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
          <i class="fas fa-file-export" style="color:#7c3aed;"></i> Export SQL Dump
        </h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:20px;">
          Export the current database as a <code>.sql</code> file.
        </p>
        <div style="margin-bottom:18px;">
          <p style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">
            Export Mode
          </p>
          <div style="display:flex;flex-direction:column;gap:9px;">
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
              <input type="radio" name="exportMode" value="full" checked style="accent-color:#7c3aed;">
              <span><strong>Structure + Data</strong> — Full export (recommended)</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
              <input type="radio" name="exportMode" value="structure" style="accent-color:#7c3aed;">
              <span><strong>Structure only</strong> — CREATE TABLE statements, no rows</span>
            </label>
            <label style="display:flex;align-items:center;gap:10px;font-size:13px;cursor:pointer;">
              <input type="radio" name="exportMode" value="data" style="accent-color:#7c3aed;">
              <span><strong>Data only</strong> — INSERT statements, no schema</span>
            </label>
          </div>
        </div>
        <button class="btn btn-add" style="margin-left:0;" tabindex="-1" onclick="exportDatabase()">
          <i class="fas fa-download"></i> Download SQL
        </button>
        <div id="exportStatus" style="display:none;margin-top:14px;font-size:13px;color:#6b7280;">
          <span class="spinner"></span> Preparing export…
        </div>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════ MODAL: USER FORM ══ -->
  <div class="modal-overlay" id="userFormModal">
    <div class="modal-box">
      <h3 id="userFormTitle"><i class="fas fa-user-plus" style="color:#7c3aed"></i> Add New User</h3>
      <div class="err-box" id="userFormErr"></div>
      <div class="form-grid">
        <div class="form-row">
          <label for="fFirstName">First name <span style="color:#ef4444">*</span></label>
          <input type="text" id="fFirstName" placeholder="Firstname">
        </div>
        <div class="form-row">
          <label for="fLastName">Last name <span style="color:#ef4444">*</span></label>
          <input type="text" id="fLastName" placeholder="Lastname">
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label for="fUsername">Username <span style="color:#ef4444">*</span></label>
          <input type="text" id="fUsername" placeholder="Minimum 3 characters">
        </div>
        <div class="form-row">
          <label for="fEmail">Email <span style="color:#ef4444">*</span></label>
          <input type="email" id="fEmail" placeholder="user@example.com">
        </div>
      </div>
      <div class="form-row">
        <label for="fUsergroup">User Group <span style="color:#ef4444">*</span></label>
        <select id="fUsergroup">
          <option value="">— Select group —</option>
        </select>
      </div>
      <div class="form-row">
        <label for="fPassword">Password <span id="pwHint" style="font-weight:400;color:#9ca3af">(min 8 chars, upper, lower, number)</span></label>
        <div style="position:relative;display:flex;align-items:center;">
          <input type="password" id="fPassword" placeholder="Password" style="padding-right:36px;width:100%;">
          <button type="button" class="toggle-pw" tabindex="-1" onclick="togglePw('fPassword',this)"
            style="position:absolute;right:10px;background:none;border:none;cursor:pointer;color:#9ca3af;font-size:13px;padding:0;line-height:1;">
            <i class="fas fa-eye"></i>
          </button>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row">
          <label for="fPhone">Phone</label>
          <input type="text" id="fPhone" placeholder="09XXXXXXXXX">
        </div>
        <div class="form-row">
          <label for="fDatabase">My database <span style="color:#ef4444">*</span></label>
          <input type="text" id="fDatabase" placeholder="e.g. AdminServer">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-cancel" tabindex="-1" onclick="closeModal('userFormModal')">Cancel</button>
        <button class="btn btn-confirm" id="btnUserFormSubmit" tabindex="-1" onclick="submitUserForm()">
          <i class="fas fa-save"></i> Register User
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL: Delete User -->
  <div class="modal-overlay" id="deleteUserModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Delete User?</h3>
      <p id="deleteUserMsg">Are you sure? This action cannot be undone.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-cancel" tabindex="-1" onclick="closeModal('deleteUserModal')">Cancel</button>
        <button class="btn btn-danger" id="btnConfirmDeleteUser" tabindex="-1" onclick="confirmDeleteUser()">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL: View Log -->
  <div class="modal-overlay" id="viewLogModal">
    <div class="modal-box">
      <h3><i class="fas fa-info-circle" style="color:#6d28d9"></i> Log Details</h3>
      <div class="log-detail-grid" id="viewLogContent"></div>
      <div class="modal-actions">
        <button class="btn btn-cancel" tabindex="-1" onclick="closeModal('viewLogModal')">Close</button>
      </div>
    </div>
  </div>

  <!-- MODAL: Delete Single Log -->
  <div class="modal-overlay" id="deleteSingleLogModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Confirm Delete</h3>
      <p id="deleteSingleLogMsg">Delete this log entry?</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-cancel" tabindex="-1" onclick="closeModal('deleteSingleLogModal')">Cancel</button>
        <button class="btn btn-danger" id="btnConfirmDeleteLog" tabindex="-1" onclick="deleteSingleLog()"><i class="fas fa-trash"></i> Delete</button>
      </div>
    </div>
  </div>

  <!-- MODAL: Delete All Logs -->
  <div class="modal-overlay" id="deleteAllLogsModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Confirm Delete All</h3>
      <p>Delete <strong>all system log records</strong>? This <strong>cannot be undone</strong>.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-cancel" tabindex="-1" onclick="closeModal('deleteAllLogsModal')">Cancel</button>
        <button class="btn btn-danger" id="btnConfirmDeleteAllLogs" tabindex="-1" onclick="deleteAllLogs()"><i class="fas fa-trash"></i> Yes, Delete All</button>
      </div>
    </div>
  </div>

  <!-- ══════════════════════════════════════════ MODAL: GROUP FORM (Tabbed) ══ -->
  <div class="modal-overlay" id="groupFormModal">
    <div class="gmodal-box">

      <!-- Header -->
      <div class="gmodal-header">
        <div class="gmodal-title">
          <i class="fas fa-layer-group" style="color:#7c3aed"></i>
          <span id="gModalTitle">Add New Group</span>
        </div>
        <div class="err-box" id="groupFormErr" style="margin-bottom:12px;"></div>
      </div>

      <!-- Body: sidebar + content -->
      <div class="gmodal-body">

        <!-- Sidebar -->
        <div class="gmodal-sidebar">
          <button class="side-tab gmodal-sidetab active" id="gSideBasic" tabindex="-1" onclick="switchGroupTab('basic')">
            <i class="fas fa-id-card"></i> Basic Info
          </button>
          <button class="side-tab gmodal-sidetab" id="gSideAccess" tabindex="-1" onclick="switchGroupTab('access')">
            <i class="fas fa-shield-alt"></i> Bind Access
          </button>
        </div>

        <!-- Content -->
        <div class="gmodal-content">

          <!-- Basic Info panel -->
          <div class="gmodal-tabpanel active" id="gPanelBasic">
            <div class="form-row">
              <label for="gGroupName">* User group <span style="color:#ef4444; font-size:11px; font-weight:400">(required)</span></label>
              <input type="text" id="gGroupName" placeholder="e.g. Administrator, HR, Warehouse">
            </div>
            <div class="form-row" style="margin-top:6px;">
              <label for="gDescription">Description <span style="color:#9ca3af; font-weight:400; font-size:11px">(optional)</span></label>
              <textarea id="gDescription" class="desc-textarea" placeholder="Short description of this group's role…"></textarea>
            </div>
            <div class="toggle-row" style="margin-top:8px;">
              <label class="toggle-switch">
                <input type="checkbox" id="gIsEnabled" checked>
                <span class="toggle-track"></span>
              </label>
              <div>
                <div class="toggle-label">Group is <strong>Enabled</strong></div>
                <div class="toggle-sublabel">Disabled groups cannot be assigned to users</div>
              </div>
            </div>
          </div>

          <!-- Bind Access panel -->
          <div class="gmodal-tabpanel" id="gPanelAccess">
            <div class="bind-section-title"><i class="fas fa-sitemap" style="margin-right:4px;"></i> Menu Access</div>
            <div id="bindAccessRows">
              <div id="bindAccessRows">
                <?php renderBindRows($MENU_PAGES); ?>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="modal-actions" style="padding:14px 24px; justify-content:flex-end;">
        <button class="btn btn-cancel" tabindex="-1" onclick="closeModal('groupFormModal')">Cancel</button>
        <button class="btn btn-confirm" id="btnGroupFormSubmit" tabindex="-1" onclick="submitGroupForm()">
          <i class="fas fa-save"></i> <span id="gBtnLabel">Create Group</span>
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL: Delete Group -->
  <div class="modal-overlay" id="deleteGroupModal">
    <div class="modal-box confirm">
      <div style="width:50px;height:50px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
        <i class="fas fa-trash" style="color:#ef4444;font-size:20px"></i>
      </div>
      <h3 style="justify-content:center"><i class="fas fa-exclamation-triangle"></i> Delete Group?</h3>
      <p id="deleteGroupMsg">Are you sure? This action cannot be undone.</p>
      <div class="modal-actions" style="justify-content:center">
        <button class="btn btn-cancel" tabindex="-1" onclick="closeModal('deleteGroupModal')">Cancel</button>
        <button class="btn btn-danger" id="btnConfirmDeleteGroup" tabindex="-1" onclick="confirmDeleteGroup()">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
  </div>

  <!-- MODAL: View Bound Users -->
  <div class="modal-overlay" id="viewGroupUsersModal">
    <div class="modal-box" style="width:520px;">
      <h3 id="viewGroupUsersTitle"><i class="fas fa-users" style="color:#7c3aed"></i> Bound Users</h3>
      <div class="table-wrap" style="max-height:340px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:6px;">
        <table>
          <thead>
            <tr>
              <th style="width:40px">SN</th>
              <th>User</th>
              <th>Email</th>
            </tr>
          </thead>
          <tbody id="viewGroupUsersBody">
            <tr>
              <td colspan="3" style="text-align:center;padding:20px">Loading…</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="modal-actions" style="margin-top:14px;">
        <button class="btn btn-cancel" onclick="closeModal('viewGroupUsersModal')">Close</button>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast">
    <i class="fas fa-check-circle" id="toastIcon"></i>
    <span id="toastMsg">Done</span>
  </div>

  <!-- <script src="../../js/req.js"></script> -->
  <script>
    const IS_USERS = <?= $access['users'] ? 'true' : 'false' ?>;
    const IS_GROUPS = <?= $access['groups'] ? 'true' : 'false' ?>;
    const IS_LOGS = <?= $access['system logs'] ? 'true' : 'false' ?>;
    const IS_MYADMIN = <?= $access['phpmyadmin'] ? 'true' : 'false' ?>;
    const SESSION_UID = <?= $sessionUserId ?>;
    const COLORS = ['#7F77DD', '#1D9E75', '#D85A30', '#D4537E', '#378ADD', '#639922', '#BA7517'];

    /* ══════════════════════════════════════════════════════════════
       TAB SWITCHING (main tabs)
    ══════════════════════════════════════════════════════════════ */
    let activeTab = 'users';

    const TAB_IDS = {
      users: {
        btn: 'tabBtnUsers',
        panel: 'panelUsers'
      },
      group: {
        btn: 'tabBtnGroup',
        panel: 'panelGroup'
      },
      logs: {
        btn: 'tabBtnLogs',
        panel: 'panelLogs'
      },
      myadmin: {
        btn: 'tabBtnMyAdmin',
        panel: 'panelMyadmin'
      },
    };

    function switchTab(tab) {
      activeTab = tab;
      Object.entries(TAB_IDS).forEach(([t, ids]) => {
        const btn = document.getElementById(ids.btn);
        const panel = document.getElementById(ids.panel);
        if (btn) btn.classList.toggle('active', t === tab);
        if (panel) panel.classList.toggle('active', t === tab);
      });
      if (tab === 'group' && allGroups.length === 0) loadGroups().then(startGroupsCountdown);
      if (tab === 'logs' && allLogs.length === 0) {
        loadLogActionOptions();
        loadLogs().then(startLogsCountdown);
      }
    }

    function reloadActiveTab() {
      if (activeTab === 'users') {
        stopUsersCountdown();
        loadUsers().then(startUsersCountdown);
      } else if (activeTab === 'group') {
        stopGroupsCountdown();
        loadGroups().then(startGroupsCountdown);
      } else if (activeTab === 'logs') {
        stopLogsCountdown();
        loadLogActionOptions();
        loadLogs().then(startLogsCountdown);
      }
    }

    /* ══════════════════════════════════════════════════════════════
       GROUP MODAL — inner tab switching
    ══════════════════════════════════════════════════════════════ */
    function switchGroupTab(tab) {
      ['basic', 'access'].forEach(t => {
        document.getElementById('gSide' + cap(t)).classList.toggle('active', t === tab);
        document.getElementById('gPanel' + cap(t)).classList.toggle('active', t === tab);
      });
    }

    function cap(s) {
      return s.charAt(0).toUpperCase() + s.slice(1);
    }

    /* ══════════════════════════════════════════════════════════════
      BIND ACCESS — Tree logic
    ══════════════════════════════════════════════════════════════ */
    const MENU_TREE = <?= json_encode($MENU_PAGES) ?>;
    const NODE_MAP = {};

    function buildNodeMap(pages, parentKey = null) {
      pages.forEach(page => {
        NODE_MAP[page.key] = {
          parentKey,
          childKeys: (page.children || []).map(c => c.key),
        };
        if (page.children && page.children.length) {
          buildNodeMap(page.children, page.key);
        }
      });
    }
    buildNodeMap(MENU_TREE);

    function getAllDescendants(key) {
      const result = [];
      const kids = NODE_MAP[key]?.childKeys || [];
      kids.forEach(childKey => {
        result.push(childKey);
        result.push(...getAllDescendants(childKey));
      });
      return result;
    }

    function getAllAncestors(key) {
      const result = [];
      let current = NODE_MAP[key]?.parentKey;
      while (current) {
        result.push(current);
        current = NODE_MAP[current]?.parentKey;
      }
      return result;
    }

    function toggleBindChildren(key) {
      const container = document.getElementById('children_' + key);
      const btn = document.getElementById('toggleBtn_' + key);
      if (!container) return;
      const isOpen = container.style.display !== 'none';
      container.style.display = isOpen ? 'none' : 'block';
      if (btn) btn.classList.toggle('open', !isOpen);
    }

    function selectPill(pill) {
      const group = pill.closest('.radio-pill-group');
      const key = group.dataset.key;
      const isDeny = pill.classList.contains('deny-pill');

      group.querySelectorAll('.radio-pill').forEach(p => p.classList.remove('selected'));
      pill.classList.add('selected');
      pill.querySelector('input[type="radio"]').checked = true;

      const descendants = getAllDescendants(key);
      descendants.forEach(descKey => {
        const descGroup = document.querySelector(`.radio-pill-group[data-key="${descKey}"]`);
        if (!descGroup) return;

        if (isDeny) {
          descGroup.querySelectorAll('.radio-pill').forEach(p => {
            p.classList.remove('selected');
            p.classList.add('disabled');
          });
          const denyPill = descGroup.querySelector('.deny-pill');
          if (denyPill) {
            denyPill.classList.add('selected');
            denyPill.querySelector('input[type="radio"]').checked = true;
          }
          const container = document.getElementById('children_' + descKey);
          const btn = document.getElementById('toggleBtn_' + descKey);
        } else {
          descGroup.querySelectorAll('.radio-pill').forEach(p => {
            p.classList.remove('disabled');
            p.classList.remove('selected');
          });
          const allowPill = descGroup.querySelector('.allow-pill');
          if (allowPill) {
            allowPill.classList.add('selected');
            allowPill.querySelector('input[type="radio"]').checked = true;
          }
        }
      });

      if (isDeny) {
        const container = document.getElementById('children_' + key);
        const btn = document.getElementById('toggleBtn_' + key);
        if (container) container.style.display = 'block';
        if (btn) btn.classList.add('open');
      }

      if (!isDeny) {
        const ancestors = getAllAncestors(key);
        ancestors.forEach(ancestorKey => {
          const siblingKeys = NODE_MAP[ancestorKey]?.childKeys || [];
          const allAllow = siblingKeys.every(sibKey => {
            const sibGroup = document.querySelector(`.radio-pill-group[data-key="${sibKey}"]`);
            if (!sibGroup) return true;
            const checked = sibGroup.querySelector('input[type="radio"]:checked');
            return checked?.value === 'allow';
          });
          if (allAllow) {
            const ancestorGroup = document.querySelector(`.radio-pill-group[data-key="${ancestorKey}"]`);
          }
        });
      }
    }

    function getPermissionsFromForm() {
      const perms = {};
      Object.keys(NODE_MAP).forEach(key => {
        const checked = document.querySelector(`input[name="perm_${key}"]:checked`);
        perms[key] = checked ? checked.value : 'allow';
      });
      return perms;
    }

    function setPermissionsToForm(permsObj) {
      Object.keys(NODE_MAP).forEach(key => {
        _applyPermToGroup(key, permsObj);
      });

      function cascadeFromNode(key) {
        const val = (permsObj && permsObj[key]) ? permsObj[key] : 'allow';
        if (val === 'deny') {
          const descendants = getAllDescendants(key);
          const container = document.getElementById('children_' + key);
          const btn = document.getElementById('toggleBtn_' + key);
          if (container) container.style.display = 'block';
          if (btn) btn.classList.add('open');

          descendants.forEach(descKey => {
            const descGroup = document.querySelector(`.radio-pill-group[data-key="${descKey}"]`);
            if (!descGroup) return;
            descGroup.querySelectorAll('.radio-pill').forEach(p => p.classList.add('disabled'));
          });
        }
        (NODE_MAP[key]?.childKeys || []).forEach(cascadeFromNode);
      }

      MENU_TREE.forEach(page => cascadeFromNode(page.key));
    }

    function _applyPermToGroup(key, permsObj) {
      const val = (permsObj && permsObj[key]) ? permsObj[key] : 'allow';
      const group = document.querySelector(`.radio-pill-group[data-key="${key}"]`);
      if (!group) return;
      group.querySelectorAll('.radio-pill').forEach(p => {
        const radio = p.querySelector('input[type="radio"]');
        const match = radio.value === val;
        p.classList.toggle('selected', match);
        p.classList.remove('disabled');
        radio.checked = match;
      });
    }

    /* ══════════════════════════════════════════════════════════════
       SHARED HELPERS
    ══════════════════════════════════════════════════════════════ */
    let anyModalOpen = false;

    function openModal(id) {
      anyModalOpen = true;
      document.getElementById(id).classList.add('show');
      updateUsersCountdownUI();
      updateLogsCountdownUI();
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('show');
      anyModalOpen = false;
      updateUsersCountdownUI();
      updateLogsCountdownUI();
    }

    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target === el) closeModal(el.id);
      });
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const open = document.querySelector('.modal-overlay.show');
        if (open) {
          e.stopImmediatePropagation();
          closeModal(open.id);
        } else {
          if (window.self !== window.top) {
            window.parent.document.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Escape',
                bubbles: true
              })
            );
          } else {
            window.history.back();
          }
        }
      }

      if (e.key === 'Enter') {
        const open = document.querySelector('.modal-overlay.show');
        if (!open) return;
        if (open.id === 'userFormModal') submitUserForm();
        if (open.id === 'deleteUserModal') confirmDeleteUser();
        if (open.id === 'deleteSingleLogModal') deleteSingleLog();
        if (open.id === 'deleteAllLogsModal') deleteAllLogs();
        if (open.id === 'groupFormModal') submitGroupForm();
        if (open.id === 'deleteGroupModal') confirmDeleteGroup();
      }
    });

    function escHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function hashStr(str) {
      let h = 5381;
      for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
      return h >>> 0;
    }

    let toastTimer = null;

    function showToast(msg, isError = false) {
      const t = document.getElementById('toast');
      const ic = document.getElementById('toastIcon');
      document.getElementById('toastMsg').textContent = msg;
      ic.className = isError ? 'fas fa-times-circle' : 'fas fa-check-circle';
      t.classList.toggle('error', isError);
      t.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
    }

    function paginate(items, page, perPage) {
      const pages = Math.max(1, Math.ceil(items.length / perPage));
      if (page > pages) page = pages;
      return {
        slice: items.slice((page - 1) * perPage, page * perPage),
        pages,
        page
      };
    }

    function paginationHTML(total, pages, currentPage, fn) {
      if (pages <= 1) return `<span>${total} record${total !== 1 ? 's' : ''}</span>`;
      const buttons = [];
      const range = new Set([1, pages]);
      for (let i = Math.max(2, currentPage - 2); i <= Math.min(pages - 1, currentPage + 2); i++) range.add(i);
      const sorted = [...range].sort((a, b) => a - b);
      let prev = null;
      for (const p of sorted) {
        if (prev !== null && p - prev > 1) buttons.push(`<span style="padding:0 4px;color:#aaa;line-height:30px;">…</span>`);
        buttons.push(`<button class="page-btn${currentPage === p ? ' active' : ''}" tabindex="-1" onclick="${fn}(${p})">${p}</button>`);
        prev = p;
      }
      return `<span>${total} record${total !== 1 ? 's' : ''}</span>
        <button class="page-btn" tabindex="-1" onclick="${fn}(${Math.max(1,currentPage-1)})" ${currentPage===1?'disabled style="opacity:.4;cursor:default"':''}>‹</button>
        ${buttons.join('')}
        <button class="page-btn" tabindex="-1" onclick="${fn}(${Math.min(pages,currentPage+1)})" ${currentPage===pages?'disabled style="opacity:.4;cursor:default"':''}>›</button>`;
    }

    /* ══════════════════════════════════════════════════════════════
       USERS TAB
    ══════════════════════════════════════════════════════════════ */
    const U_REFRESH = 30;
    let allUsers = [],
      uPage = 1;
    const U_PER = 10;
    let editingUserId = null,
      pendingDelUserId = null,
      uDebounce = null;
    let uCountdownLeft = U_REFRESH,
      uTick = null,
      uRefreshTimer = null;

    function startUsersCountdown() {
      stopUsersCountdown();
      uCountdownLeft = U_REFRESH;
      updateUsersCountdownUI();
      uTick = setInterval(() => {
        if (!anyModalOpen) {
          uCountdownLeft = Math.max(0, uCountdownLeft - 1);
          updateUsersCountdownUI();
        }
      }, 1000);
      uRefreshTimer = setTimeout(async () => {
        if (!anyModalOpen) await loadUsers(true);
        startUsersCountdown();
      }, U_REFRESH * 1000);
    }

    function stopUsersCountdown() {
      clearInterval(uTick);
      clearTimeout(uRefreshTimer);
    }

    function updateUsersCountdownUI() {
      document.getElementById('uCountdownBar').style.width = ((uCountdownLeft / U_REFRESH) * 100) + '%';
      const dot = document.getElementById('uPulseDot');
      if (dot) dot.classList.toggle('paused', anyModalOpen);
    }

    function togglePw(fieldId, btn) {
      const input = document.getElementById(fieldId);
      const icon = btn.querySelector('i');
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
    }

    async function loadUsers(silent = false) {
      const su = document.getElementById('searchUser').value.trim();
      const se = document.getElementById('searchEmail').value.trim();
      const params = new URLSearchParams({
        action: 'fetch_users'
      });
      if (su) params.append('search_user', su);
      if (se) params.append('search_email', se);

      if (!silent) document.getElementById('userTableBody').innerHTML =
        `<tr class="empty-row"><td colspan="9"><span class="spinner"></span> Loading…</td></tr>`;
      try {
        const res = await fetch('?' + params.toString());
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Fetch failed');
        allUsers = data.users;
        document.getElementById('tabBadgeUsers').textContent = data.stats.total ?? 0;
        renderUsersTable();
        updateUsersStats(data.stats);
      } catch (err) {
        if (!silent) {
          showToast('Failed to load users: ' + err.message, true);
          document.getElementById('userTableBody').innerHTML =
            `<tr class="empty-row"><td colspan="9"><i class="fas fa-exclamation-circle" style="color:#ef4444"></i> ${escHtml(err.message)}</td></tr>`;
        }
      }
    }

    function renderUsersTable() {
      const tbody = document.getElementById('userTableBody');
      const {
        slice,
        pages,
        page
      } = paginate(allUsers, uPage, U_PER);
      uPage = page;
      if (!slice.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="9"><i class="fas fa-users" style="font-size:24px;display:block;margin-bottom:6px;opacity:.4"></i>No users found.</td></tr>`;
        document.getElementById('uPaginationWrap').innerHTML = '';
        return;
      }
      tbody.innerHTML = slice.map((u, i) => {
        const idx = (uPage - 1) * U_PER + i;
        const color = COLORS[(u.id - 1) % COLORS.length];
        const init = ((u.first_name || u.username)[0] || '?').toUpperCase();
        const isSelf = +u.id === SESSION_UID;
        const isRoot = +u.id === 1 && u.user_group === 'Administrator';

        const editBtn = !IS_USERS ?
          `<div class="lock-wrap"><button class="btn action-btn btn-edit-row" disabled><i class="fas fa-lock" style="opacity:.5"></i> Edit</button><span class="tip">Administrators only</span></div>` :
          `<button class="btn action-btn btn-edit-row" tabindex="-1" onclick="openEditUser(${u.id})"><i class="fas fa-edit"></i> Edit</button>`;

        const delBtn = !IS_USERS ?
          `<div class="lock-wrap"><button class="btn action-btn btn-del-row" disabled><i class="fas fa-lock" style="opacity:.5"></i> Delete</button><span class="tip">Administrators only</span></div>` :
          isSelf ?
          `<div class="lock-wrap"><button class="btn action-btn btn-del-row" disabled><i class="fas fa-trash"></i> Delete</button></div>` :
          isRoot ?
          `<div class="lock-wrap"><button class="btn action-btn btn-del-row" disabled><i class="fas fa-trash"></i> Delete</button><span class="tip">Root Administrator cannot be deleted</span></div>` :
          `<button class="btn action-btn btn-del-row" tabindex="-1" onclick="openDeleteUser(${u.id},'${escHtml(u.username)}')"><i class="fas fa-trash"></i> Delete</button>`;

        return `<tr>
          <td class="sn-cell">${idx+1}</td>
          <td><div class="user-cell">
            <div class="avatar" style="background:${color}">${init}</div>
            <div>
              <div style="font-weight:600;color:#1f2937">${escHtml(u.username)}${isSelf?' <em style="font-size:11px;color:#9ca3af">(you)</em>':''}</div>
              <div style="font-size:11px;color:#9ca3af">${escHtml(u.first_name)} ${escHtml(u.last_name)}</div>
            </div>
          </div></td>
          <td title="${escHtml(u.email)}">${escHtml(u.email||'—')}</td>
          <td>${escHtml(u.user_group||'—')}</td>
          <td>${escHtml(u.phone||'—')}</td>
          <td>${escHtml(u.my_database||'—')}</td>
          <td>${escHtml(u.created_at ? u.created_at.slice(0,16) : '—')}</td>
          <td>${u.last_login ? escHtml(u.last_login.slice(0,16)) : '<span style="color:#d1d5db">—</span>'}</td>
          <td><div style="display:flex;gap:6px;flex-wrap:wrap">${editBtn}${delBtn}</div></td>
        </tr>`;
      }).join('');
      document.getElementById('uPaginationWrap').innerHTML = paginationHTML(allUsers.length, pages, uPage, 'uGoPage');
    }

    function uGoPage(p) {
      uPage = p;
      renderUsersTable();
    }

    function updateUsersStats(s) {
      document.getElementById('uStatTotal').textContent = s.total ?? 0;
      document.getElementById('uStatLoggedIn').textContent = s.logged_in ?? 0;
      document.getElementById('uStatNever').textContent = s.never_logged ?? 0;
    }

    function debounceUsers() {
      clearTimeout(uDebounce);
      uDebounce = setTimeout(() => {
        uPage = 1;
        stopUsersCountdown();
        loadUsers().then(startUsersCountdown);
      }, 380);
    }

    function clearUsersSearch() {
      document.getElementById('searchUser').value = '';
      document.getElementById('searchEmail').value = '';
      uPage = 1;
      stopUsersCountdown();
      loadUsers().then(startUsersCountdown);
    }

    /* ── User form ── */
    async function populateGroupDropdown() {
      try {
        const res = await fetch('?action=fetch_groups_dropdown');
        const data = await res.json();
        const sel = document.getElementById('fUsergroup');
        sel.innerHTML = '<option value="">— Select group —</option>';
        if (data.success) {
          data.groups.forEach(g => {
            const opt = document.createElement('option');
            opt.value = g;
            opt.textContent = g;
            sel.appendChild(opt);
          });
        }
      } catch (e) {}
    }

    function clearUserForm() {
      ['fFirstName', 'fLastName', 'fUsername', 'fEmail', 'fPassword', 'fPhone', 'fDatabase']
      .forEach(id => document.getElementById(id).value = '');
      document.getElementById('fUsergroup').value = '';
      const e = document.getElementById('userFormErr');
      e.style.display = 'none';
      e.innerHTML = '';
      ['fFirstName', 'fLastName', 'fUsername', 'fEmail', 'fPhone', 'fDatabase', 'fUsergroup', 'fPassword']
      .forEach(id => document.getElementById(id).disabled = false);
    }

    async function openAddUser() {
      if (!IS_USERS) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      editingUserId = null;
      clearUserForm();
      await populateGroupDropdown();
      document.getElementById('userFormTitle').innerHTML = '<i class="fas fa-user-plus" style="color:#7c3aed"></i> Add New User';
      document.getElementById('pwHint').textContent = '(min 8 chars, upper, lower, number)';
      document.getElementById('btnUserFormSubmit').innerHTML = '<i class="fas fa-save"></i> Register User';
      document.getElementById('fPassword').placeholder = 'Password';
      openModal('userFormModal');
    }

    async function openEditUser(id) {
      if (!IS_USERS) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      editingUserId = id;
      clearUserForm();
      await populateGroupDropdown();
      document.getElementById('userFormTitle').innerHTML = '<i class="fas fa-edit" style="color:#7c3aed"></i> Edit User';
      document.getElementById('pwHint').textContent = '(leave blank to keep current)';
      document.getElementById('fPassword').placeholder = 'Leave blank to keep current password';
      const btn = document.getElementById('btnUserFormSubmit');
      btn.innerHTML = '<span class="spinner"></span> Loading…';
      btn.disabled = true;
      openModal('userFormModal');
      try {
        const res = await fetch(`?action=get_user&id=${id}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const u = data.user;
        document.getElementById('fFirstName').value = u.first_name || '';
        document.getElementById('fLastName').value = u.last_name || '';
        document.getElementById('fUsername').value = u.username || '';
        document.getElementById('fEmail').value = u.email || '';
        document.getElementById('fPhone').value = u.phone || '';
        document.getElementById('fDatabase').value = u.my_database || '';
        document.getElementById('fUsergroup').value = u.user_group || '';
        if (+id === SESSION_UID) {
          document.getElementById('fEmail').disabled = true;
          document.getElementById('fUsergroup').disabled = true;
        }
        btn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        btn.disabled = false;
      } catch (err) {
        showToast('Failed to load user: ' + err.message, true);
        closeModal('userFormModal');
      }
    }

    async function submitUserForm() {
      if (!IS_USERS) {
        showToast('Access denied.', true);
        return;
      }
      const payload = {
        first_name: document.getElementById('fFirstName').value.trim(),
        last_name: document.getElementById('fLastName').value.trim(),
        username: document.getElementById('fUsername').value.trim(),
        email: document.getElementById('fEmail').value.trim(),
        user_group: document.getElementById('fUsergroup').value,
        password: document.getElementById('fPassword').value,
        phone: document.getElementById('fPhone').value.trim(),
        my_database: document.getElementById('fDatabase').value.trim(),
      };
      const errBox = document.getElementById('userFormErr');
      if (!payload.user_group) {
        errBox.style.display = 'block';
        errBox.textContent = 'Please select a User Group.';
        return;
      }
      errBox.style.display = 'none';
      const btn = document.getElementById('btnUserFormSubmit');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving…';
      const url = editingUserId ? `?action=update_user&id=${editingUserId}` : `?action=add_user`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) {
          errBox.style.display = 'block';
          errBox.textContent = (data.errors || [data.message]).join('\n');
          return;
        }
        closeModal('userFormModal');
        showToast(data.message);
        uPage = 1;
        stopUsersCountdown();
        await loadUsers();
        startUsersCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = editingUserId ? '<i class="fas fa-save"></i> Save Changes' : '<i class="fas fa-save"></i> Register User';
      }
    }

    function openDeleteUser(id, username) {
      if (!IS_USERS) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      pendingDelUserId = id;
      document.getElementById('deleteUserMsg').innerHTML = `Delete <strong>${escHtml(username)}</strong>? This cannot be undone.`;
      openModal('deleteUserModal');
    }

    async function confirmDeleteUser() {
      if (!IS_USERS || !pendingDelUserId) return;
      const btn = document.getElementById('btnConfirmDeleteUser');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';
      try {
        const res = await fetch(`?action=delete_user&id=${pendingDelUserId}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        pendingDelUserId = null;
        closeModal('deleteUserModal');
        showToast(data.message);
        stopUsersCountdown();
        await loadUsers();
        startUsersCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    }

    /* ══════════════════════════════════════════════════════════════
       GROUPS TAB
    ══════════════════════════════════════════════════════════════ */
    const G_REFRESH = 30;
    let allGroups = [],
      gPage = 1;
    const G_PER = 10;
    let editingGroupId = null,
      pendingDelGrpId = null,
      gDebounce = null;
    let gCountdownLeft = G_REFRESH,
      gTick = null,
      gRefreshTimer = null;

    function startGroupsCountdown() {
      stopGroupsCountdown();
      gCountdownLeft = G_REFRESH;
      updateGroupsCountdownUI();
      gTick = setInterval(() => {
        if (!anyModalOpen) {
          gCountdownLeft = Math.max(0, gCountdownLeft - 1);
          updateGroupsCountdownUI();
        }
      }, 1000);
      gRefreshTimer = setTimeout(async () => {
        if (!anyModalOpen) await loadGroups(true);
        startGroupsCountdown();
      }, G_REFRESH * 1000);
    }

    function stopGroupsCountdown() {
      clearInterval(gTick);
      clearTimeout(gRefreshTimer);
    }

    function updateGroupsCountdownUI() {
      const bar = document.getElementById('gCountdownBar');
      if (bar) bar.style.width = ((gCountdownLeft / G_REFRESH) * 100) + '%';
    }

    async function loadGroups(silent = false) {
      const s = document.getElementById('groupSearchInput').value.trim();
      const params = new URLSearchParams({
        action: 'fetch_groups'
      });
      if (s) params.append('search_group', s);

      if (!silent) document.getElementById('groupTableBody').innerHTML =
        `<tr class="empty-row"><td colspan="7"><span class="spinner"></span> Loading…</td></tr>`;
      try {
        const res = await fetch('?' + params.toString());
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Fetch failed');
        allGroups = data.groups;
        document.getElementById('tabBadgeGroup').textContent = data.stats.total ?? 0;
        document.getElementById('gStatTotal').textContent = data.stats.total ?? 0;
        renderGroupsTable();
      } catch (err) {
        if (!silent) {
          showToast('Failed to load groups: ' + err.message, true);
          document.getElementById('groupTableBody').innerHTML =
            `<tr class="empty-row"><td colspan="7"><i class="fas fa-exclamation-circle" style="color:#ef4444"></i> ${escHtml(err.message)}</td></tr>`;
        }
      }
    }

    function renderGroupsTable() {
      const tbody = document.getElementById('groupTableBody');
      const {
        slice,
        pages,
        page
      } = paginate(allGroups, gPage, G_PER);
      gPage = page;
      if (!slice.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="7"><i class="fas fa-layer-group" style="font-size:24px;display:block;margin-bottom:6px;opacity:.4"></i>No groups found.</td></tr>`;
        document.getElementById('gPaginationWrap').innerHTML = '';
        return;
      }
      tbody.innerHTML = slice.map((g, i) => {
        const idx = (gPage - 1) * G_PER + i;
        const color = COLORS[(g.id - 1) % COLORS.length];
        const init = (g.group_name[0] || '?').toUpperCase();
        const badge = g.is_enabled ?
          `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Enabled</span>` :
          `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">Disabled</span>`;

        return `<tr>
          <td class="sn-cell">${idx+1}</td>
          <td><div class="user-cell">
            <div class="avatar" style="background:${color}">${escHtml(init)}</div>
            <div>
              <div style="font-weight:600;color:#1f2937">${escHtml(g.group_name)}</div>
              <div style="font-size:11px;color:#9ca3af">#${escHtml(g.group_number)}</div>
            </div>
          </div></td>
          <td>
            <span style="font-weight:600;color:#7c3aed">${g.bound_users}</span>
            ${+g.bound_users > 0 ? `<button tabindex="-1" onclick="viewGroupUsers(${g.id},'${escHtml(g.group_name)}')"
              style="margin-left:6px;background:none;border:none;color:#7c3aed;cursor:pointer;font-size:12px;text-decoration:underline;">view</button>` : ''}
          </td>
          <td>${badge}</td>
          <td>${escHtml(g.created_at ? g.created_at.slice(0,16) : '—')}</td>
          <td>${escHtml(g.updated_at ? g.updated_at.slice(0,16) : '—')}</td>
          <td><div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn action-btn btn-edit-row" tabindex="-1" onclick="openEditGroup(${g.id})"><i class="fas fa-edit"></i> Edit</button>
            <button class="btn action-btn btn-del-row" tabindex="-1" onclick="openDeleteGroup(${g.id},'${escHtml(g.group_name)}',${g.bound_users})"><i class="fas fa-trash"></i> Delete</button>
          </div></td>
        </tr>`;
      }).join('');
      document.getElementById('gPaginationWrap').innerHTML = paginationHTML(allGroups.length, pages, gPage, 'gGoPage');
    }

    function gGoPage(p) {
      gPage = p;
      renderGroupsTable();
    }

    function debounceGroups() {
      clearTimeout(gDebounce);
      gDebounce = setTimeout(() => {
        gPage = 1;
        stopGroupsCountdown();
        loadGroups().then(startGroupsCountdown);
      }, 380);
    }

    function clearGroupsSearch() {
      document.getElementById('groupSearchInput').value = '';
      gPage = 1;
      stopGroupsCountdown();
      loadGroups().then(startGroupsCountdown);
    }

    /* ── View bound users ── */
    async function viewGroupUsers(id, groupName) {
      document.getElementById('viewGroupUsersTitle').innerHTML =
        `<i class="fas fa-users" style="color:#7c3aed"></i> Users in "${escHtml(groupName)}"`;
      document.getElementById('viewGroupUsersBody').innerHTML =
        `<tr><td colspan="3" style="text-align:center;padding:20px"><span class="spinner"></span> Loading…</td></tr>`;
      openModal('viewGroupUsersModal');
      try {
        const res = await fetch(`?action=fetch_group_users&group_name=${encodeURIComponent(groupName)}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        document.getElementById('viewGroupUsersBody').innerHTML = data.users.length ?
          data.users.map((u, i) => `<tr>
              <td style="color:#aaa">${i+1}</td>
              <td><div class="user-cell">
                <div class="avatar" style="background:${COLORS[(u.id-1)%COLORS.length]}">${(u.username[0]||'?').toUpperCase()}</div>
                <div>
                  <div style="font-weight:600;color:#1f2937">${escHtml(u.username)}</div>
                  <div style="font-size:11px;color:#9ca3af">${escHtml(u.first_name)} ${escHtml(u.last_name)}</div>
                </div>
              </div></td>
              <td style="color:#6b7280">${escHtml(u.email)}</td>
            </tr>`).join('') :
          `<tr><td colspan="3" style="text-align:center;padding:20px;color:#adb5bd">No users in this group.</td></tr>`;
      } catch (err) {
        document.getElementById('viewGroupUsersBody').innerHTML =
          `<tr><td colspan="3" style="text-align:center;color:#ef4444">${escHtml(err.message)}</td></tr>`;
      }
    }

    /* ── Group form ── */
    function clearGroupForm() {
      document.getElementById('gGroupName').value = '';
      document.getElementById('gDescription').value = '';
      document.getElementById('gIsEnabled').checked = true;
      const eb = document.getElementById('groupFormErr');
      eb.style.display = 'none';
      eb.innerHTML = '';
      setPermissionsToForm(null);
      switchGroupTab('basic');
    }

    function openAddGroup() {
      if (!IS_GROUPS) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      editingGroupId = null;
      clearGroupForm();
      document.getElementById('gModalTitle').textContent = 'Add New Group';
      document.getElementById('gBtnLabel').textContent = 'Create Group';
      openModal('groupFormModal');
    }

    async function openEditGroup(id) {
      if (!IS_GROUPS) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      editingGroupId = id;
      clearGroupForm();
      document.getElementById('gModalTitle').textContent = 'Edit Group';
      document.getElementById('gBtnLabel').textContent = 'Save Changes';
      const btn = document.getElementById('btnGroupFormSubmit');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Loading…';
      openModal('groupFormModal');
      try {
        const res = await fetch(`?action=fetch_group&id=${id}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        const g = data.group;
        document.getElementById('gGroupName').value = g.group_name || '';
        document.getElementById('gDescription').value = g.description || '';
        document.getElementById('gIsEnabled').checked = !!+g.is_enabled;
        // Load saved permissions
        let perms = null;
        try {
          perms = g.permissions ? JSON.parse(g.permissions) : null;
        } catch (e) {}
        setPermissionsToForm(perms);
        btn.innerHTML = '<i class="fas fa-save"></i> <span id="gBtnLabel">Save Changes</span>';
        btn.disabled = false;
      } catch (err) {
        showToast('Failed to load group: ' + err.message, true);
        closeModal('groupFormModal');
      }
    }

    async function submitGroupForm() {
      if (!IS_GROUPS) {
        showToast('Access denied.', true);
        return;
      }
      const payload = {
        group_name: document.getElementById('gGroupName').value.trim(),
        description: document.getElementById('gDescription').value.trim(),
        is_enabled: document.getElementById('gIsEnabled').checked,
        permissions: getPermissionsFromForm(),
      };
      const errBox = document.getElementById('groupFormErr');
      errBox.style.display = 'none';
      if (!payload.group_name) {
        errBox.style.display = 'block';
        errBox.textContent = 'Group name is required.';
        return;
      }

      const btn = document.getElementById('btnGroupFormSubmit');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving…';
      const url = editingGroupId ? `?action=update_group&id=${editingGroupId}` : `?action=add_group`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!data.success) {
          errBox.style.display = 'block';
          errBox.textContent = (data.errors || [data.message]).join('\n');
          return;
        }
        closeModal('groupFormModal');
        showToast(data.message);
        gPage = 1;
        stopGroupsCountdown();
        await loadGroups();
        startGroupsCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-save"></i> <span id="gBtnLabel">${editingGroupId ? 'Save Changes' : 'Create Group'}</span>`;
      }
    }

    function openDeleteGroup(id, name, boundCount) {
      if (!IS_GROUPS) {
        showToast('Access denied. Administrators only.', true);
        return;
      }
      pendingDelGrpId = id;
      const msg = document.getElementById('deleteGroupMsg');
      if (+boundCount > 0) {
        msg.innerHTML = `<span style="color:#ef4444">Cannot delete <strong>${escHtml(name)}</strong> — it still has <strong>${boundCount}</strong> user(s) assigned.<br>Reassign those users first.</span>`;
        document.getElementById('btnConfirmDeleteGroup').style.display = 'none';
      } else {
        msg.innerHTML = `Delete group <strong>${escHtml(name)}</strong>? This cannot be undone.`;
        document.getElementById('btnConfirmDeleteGroup').style.display = 'inline-flex';
      }
      openModal('deleteGroupModal');
    }

    async function confirmDeleteGroup() {
      if (!IS_GROUPS || !pendingDelGrpId) return;
      const btn = document.getElementById('btnConfirmDeleteGroup');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';
      try {
        const res = await fetch(`?action=delete_group&id=${pendingDelGrpId}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        pendingDelGrpId = null;
        closeModal('deleteGroupModal');
        showToast(data.message);
        stopGroupsCountdown();
        await loadGroups();
        startGroupsCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    }

    /* ══════════════════════════════════════════════════════════════
       LOGS TAB
    ══════════════════════════════════════════════════════════════ */
    const L_REFRESH = 10;
    let allLogs = [],
      lPage = 1;
    const L_PER = 10;
    let pendingDelLogId = null,
      lDebounce = null;
    let lCountdownLeft = L_REFRESH,
      lTick = null,
      lRefreshTimer = null;

    function startLogsCountdown() {
      stopLogsCountdown();
      lCountdownLeft = L_REFRESH;
      updateLogsCountdownUI();
      lTick = setInterval(() => {
        if (!anyModalOpen) {
          lCountdownLeft = Math.max(0, lCountdownLeft - 1);
          updateLogsCountdownUI();
        }
      }, 1000);
      lRefreshTimer = setTimeout(async () => {
        if (!anyModalOpen) await loadLogs(true);
        startLogsCountdown();
      }, L_REFRESH * 1000);
    }

    function stopLogsCountdown() {
      clearInterval(lTick);
      clearTimeout(lRefreshTimer);
    }

    function updateLogsCountdownUI() {
      document.getElementById('lCountdownBar').style.width = ((lCountdownLeft / L_REFRESH) * 100) + '%';
      const dot = document.getElementById('lPulseDot');
      if (dot) dot.classList.toggle('paused', anyModalOpen);
    }

    function badgeClass(action) {
      const a = action.toUpperCase();
      if (a.includes('LOGIN') && !a.includes('OUT')) return 'badge-login';
      if (a.includes('LOGOUT') || a.includes('_OUT')) return 'badge-logout';
      if (a.includes('CREATED') || a.includes('REGISTERED')) return 'badge-create';
      if (a.includes('UPDATED')) return 'badge-update';
      if (a.includes('DELETED')) return 'badge-delete';
      return 'badge-default';
    }

    async function loadLogs(silent = false) {
      const search = document.getElementById('logSearchInput').value.trim();
      const action = document.getElementById('logActionFilter').value;
      const params = new URLSearchParams({
        action: 'fetch_logs'
      });
      if (search) params.append('search', search);
      if (action) params.append('action_filter', action);

      if (!silent) document.getElementById('logTableBody').innerHTML =
        `<tr class="empty-row"><td colspan="8"><span class="spinner"></span> Loading…</td></tr>`;
      try {
        const res = await fetch('?' + params.toString());
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Fetch failed');
        allLogs = data.logs;
        document.getElementById('tabBadgeLogs').textContent = data.stats.total ?? 0;
        renderLogsTable();
        updateLogsStats(data.stats);
      } catch (err) {
        if (!silent) {
          showToast('Failed to load logs: ' + err.message, true);
          document.getElementById('logTableBody').innerHTML =
            `<tr class="empty-row"><td colspan="8"><i class="fas fa-exclamation-circle" style="color:#ef4444"></i> ${escHtml(err.message)}</td></tr>`;
        }
      }
    }

    function renderLogsTable() {
      const tbody = document.getElementById('logTableBody');
      const {
        slice,
        pages,
        page
      } = paginate(allLogs, lPage, L_PER);
      lPage = page;
      if (!slice.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="8"><i class="fas fa-inbox" style="font-size:24px;display:block;margin-bottom:6px;opacity:.4"></i>No log records found.</td></tr>`;
        document.getElementById('lPaginationWrap').innerHTML = '';
        return;
      }
      tbody.innerHTML = slice.map((log, i) => {
        const idx = (lPage - 1) * L_PER + i;
        const colorKey = log.user_id ? log.user_id : log.username;
        const color = COLORS[Math.abs(hashStr(String(colorKey))) % COLORS.length];
        const init = (log.username[0] || '?').toUpperCase();
        return `<tr>
          <td class="sn-cell">${idx+1}</td>
          <td><div class="user-cell">
            <div class="avatar" style="background:${color}">${init}</div>
            <span>${escHtml(log.username||'—')}</span>
          </div></td>
          <td><span class="badge ${badgeClass(log.action)}">${escHtml(log.action)}</span></td>
          <td class="details-cell" title="${escHtml(log.details||'')}">${escHtml(log.details||'—')}</td>
          <td>${escHtml(log.ip_address||'—')}</td>
          <td class="details-cell" title="${escHtml(log.user_agent||'')}">${escHtml(log.user_agent||'—')}</td>
          <td>${escHtml(log.created_at||'—')}</td>
          <td style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn action-btn btn-view-log" tabindex="-1" onclick="viewLog(${log.id})"><i class="fas fa-eye"></i> View</button>
            <button class="btn action-btn btn-del-log" tabindex="-1" onclick="openDeleteLog(${log.id},'${escHtml(log.username||'this entry')}')"><i class="fas fa-trash"></i> Delete</button>
          </td>
        </tr>`;
      }).join('');
      document.getElementById('lPaginationWrap').innerHTML = paginationHTML(allLogs.length, pages, lPage, 'lGoPage');
    }

    function lGoPage(p) {
      lPage = p;
      renderLogsTable();
    }

    function updateLogsStats(s) {
      document.getElementById('lStatTotal').textContent = s.total ?? 0;
      document.getElementById('lStatLogins').textContent = s.logins ?? 0;
      document.getElementById('lStatUpdates').textContent = s.updates ?? 0;
      document.getElementById('lStatDeletes').textContent = s.deletes ?? 0;
    }

    function debounceLogs() {
      clearTimeout(lDebounce);
      lDebounce = setTimeout(() => {
        lPage = 1;
        stopLogsCountdown();
        loadLogs().then(startLogsCountdown);
      }, 400);
    }

    function clearLogsSearch() {
      document.getElementById('logSearchInput').value = '';
      document.getElementById('logActionFilter').value = '';
      lPage = 1;
      stopLogsCountdown();
      loadLogs().then(startLogsCountdown);
    }

    function viewLog(id) {
      const log = allLogs.find(l => +l.id === +id);
      if (!log) return;
      document.getElementById('viewLogContent').innerHTML = `
        <div class="log-detail-row"><span class="ldr-label">Log ID</span><span class="ldr-val">#${escHtml(String(log.id))}</span></div>
        <div class="log-detail-row"><span class="ldr-label">User</span><span class="ldr-val">${escHtml(log.username||'—')} (ID: ${escHtml(String(log.user_id||'—'))})</span></div>
        <div class="log-detail-row"><span class="ldr-label">Action</span><span class="ldr-val"><span class="badge ${badgeClass(log.action)}">${escHtml(log.action)}</span></span></div>
        <div class="log-detail-row"><span class="ldr-label">Details</span><span class="ldr-val">${escHtml(log.details||'—')}</span></div>
        <div class="log-detail-row"><span class="ldr-label">IP Address</span><span class="ldr-val">${escHtml(log.ip_address||'—')}</span></div>
        <div class="log-detail-row"><span class="ldr-label">User Agent</span><span class="ldr-val">${escHtml(log.user_agent||'—')}</span></div>
        <div class="log-detail-row"><span class="ldr-label">Created At</span><span class="ldr-val">${escHtml(log.created_at||'—')}</span></div>
      `;
      openModal('viewLogModal');
    }

    function openDeleteLog(id, username) {
      pendingDelLogId = id;
      document.getElementById('deleteSingleLogMsg').innerHTML =
        `Delete log entry for <strong>${escHtml(username)}</strong>? This cannot be undone.`;
      openModal('deleteSingleLogModal');
    }

    async function deleteSingleLog() {
      if (!pendingDelLogId) return;
      const btn = document.getElementById('btnConfirmDeleteLog');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';
      try {
        const res = await fetch(`?action=delete_log&id=${pendingDelLogId}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Delete failed');
        pendingDelLogId = null;
        closeModal('deleteSingleLogModal');
        showToast('Log entry deleted successfully.');
        stopLogsCountdown();
        await loadLogs();
        loadLogActionOptions();
        startLogsCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    }

    function confirmDeleteAllLogs() {
      openModal('deleteAllLogsModal');
    }

    async function deleteAllLogs() {
      const btn = document.getElementById('btnConfirmDeleteAllLogs');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Deleting…';
      try {
        const res = await fetch(`?action=delete_all_logs`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Delete all failed');
        closeModal('deleteAllLogsModal');
        showToast(`All log records deleted (${data.deleted} total).`);
        stopLogsCountdown();
        await loadLogs();
        loadLogActionOptions();
        startLogsCountdown();
      } catch (err) {
        showToast('Error: ' + err.message, true);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-trash"></i> Yes, Delete All';
      }
    }

    /* ══════════════════════════════════════════════════════════════
       EXPORT DATABASE
    ══════════════════════════════════════════════════════════════ */
    function exportDatabase() {
      const mode = document.querySelector('input[name="exportMode"]:checked')?.value || 'full';
      const status = document.getElementById('exportStatus');
      status.style.display = 'flex';
      status.style.alignItems = 'center';
      status.style.gap = '8px';
      const link = document.createElement('a');
      link.href = `?action=export_db&mode=${mode}`;
      link.click();
      setTimeout(() => {
        status.style.display = 'none';
      }, 3000);
    }

    /* ══════════════════════════════════════════════════════════════
       INIT
    ══════════════════════════════════════════════════════════════ */
    async function loadLogActionOptions() {
      try {
        const res = await fetch('?action=fetch_log_actions');
        const data = await res.json();
        if (!data.success) return;
        const sel = document.getElementById('logActionFilter');
        sel.innerHTML = '<option value="">All Actions</option>';
        data.actions.forEach(action => {
          const opt = document.createElement('option');
          opt.value = action;
          opt.textContent = action;
          sel.appendChild(opt);
        });
      } catch (err) {
        console.warn('Could not load log action options:', err);
      }
    }

    loadUsers().then(startUsersCountdown);

    const hashTab = window.location.hash.replace('#', '');
    if (hashTab && TAB_IDS[hashTab]) {
      switchTab(hashTab);
      if (hashTab === 'logs') {
        loadLogActionOptions();
        loadLogs().then(startLogsCountdown);
      } else if (hashTab === 'group') {
        loadGroups().then(startGroupsCountdown);
      }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          btn.blur();
          const open = document.querySelector('.modal-overlay.show');
          if (!open) {
            if (window.self !== window.top) {
              window.parent.document.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: 'Escape',
                  bubbles: true
                })
              );
            } else {
              window.history.back();
            }
          }
        }
      });
    });
  </script>
  <script src="/config/route-config.php?page=mainFrame"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=m6efw"></script>
</body>

</html>