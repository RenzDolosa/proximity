<?php
// resource/views/settings.php --> settings

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('settings', ROUTE_HOME);
$access = getMenuAccess();

$userId    = $_SESSION['user_id'] ?? null;
$userGroup = $_SESSION['user_group'] ?? '';

if (!isLoggedIn()) {
  header('Location:', ROUTE_LOGIN);
  exit;
}

$user = getCurrentUser();

function formatLocalTime(string $timestamp, string $format = 'F j, Y g:i A'): string
{
  return (new DateTime($timestamp, new DateTimeZone(APP_TIMEZONE)))->format($format);
}

// ── Database connectivity check ───────────────────────────────────────────────
try {
  $userDb            = getUserDBConnection($userId);
  $databaseConnected = true;
  $requiredTables    = ['employees', 'code', 'employee_access_log', 'check_in_out'];
  $missingTables     = [];

  foreach ($requiredTables as $table) {
    $stmt = $userDb->prepare("
            SELECT COUNT(*) FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
        ");
    $stmt->execute([$table]);
    if ((int) $stmt->fetchColumn() === 0) {
      $missingTables[] = $table;
    }
  }

  if (!empty($missingTables)) {
    $databaseConnected = false;
  }
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError           = $e->getMessage();
}

// ── CSRF token for audio deletion ─────────────────────────────────────────────
if (empty($_SESSION['delete_audio_token'])) {
  $_SESSION['delete_audio_token'] = bin2hex(random_bytes(32));
}

// ── Flash messages ────────────────────────────────────────────────────────────
$message     = $_SESSION['flash_message'] ?? '';
$messageType = $_SESSION['flash_type']    ?? '';
unset($_SESSION['flash_message'], $_SESSION['flash_type']);

// ── Audio type map ────────────────────────────────────────────────────────────
const AUDIO_TYPES = [
  'success'    => 'success_audio_path',
  'checkout'   => 'checkout_audio_path',
  'not_found'  => 'not_found_audio_path',
  'inactive'   => 'inactive_audio_path',
  'violations' => 'violations_audio_path',
];

// ============================================================================
// HANDLE AUDIO UPLOAD
// ============================================================================
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['update_audio'])) {

  $uploadDir = dirname(__DIR__) . '/uploads/audio/' . $user['id'] . '/';
  if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
  }

  $uploadedPaths = [];
  $uploadErrors  = [];
  $allowedMime   = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/webm',
    'audio/aac',
    'audio/x-aac',
  ];
  $maxSize = 5 * 1024 * 1024;

  foreach (AUDIO_TYPES as $inputKey => $dbColumn) {
    $fileKey = 'audio_' . $inputKey;

    if (!isset($_FILES[$fileKey]) || $_FILES[$fileKey]['error'] === UPLOAD_ERR_NO_FILE) {
      continue;
    }

    $file = $_FILES[$fileKey];

    if ($file['error'] !== UPLOAD_ERR_OK) {
      $uploadErrors[] = audioLabel($inputKey) . ': upload error (code ' . $file['error'] . ').';
      continue;
    }

    if ($file['size'] > $maxSize) {
      $uploadErrors[] = audioLabel($inputKey) . ' exceeds the 5 MB limit.';
      continue;
    }

    $finfo    = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);

    if (!in_array($mimeType, $allowedMime, true)) {
      $uploadErrors[] = audioLabel($inputKey) . ': not a supported audio format.';
      continue;
    }

    $ext      = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $filename = $inputKey . '_' . time() . '.' . $ext;
    $destPath = $uploadDir . $filename;

    $oldRelPath = getExistingAudioPath($user['id'], $dbColumn);
    if ($oldRelPath) {
      $oldAbs = dirname(__DIR__) . '/' . $oldRelPath;
      if (file_exists($oldAbs)) {
        @unlink($oldAbs);
      }
    }

    if (move_uploaded_file($file['tmp_name'], $destPath)) {
      $uploadedPaths[$dbColumn] = 'uploads/audio/' . $user['id'] . '/' . $filename;
    } else {
      $uploadErrors[] = audioLabel($inputKey) . ': could not save file to disk.';
    }
  }

  if (!empty($uploadedPaths)) {
    try {
      $userPdo      = getUserDBConnection($user['id']);
      $cols         = array_merge(['user_id'], array_keys($uploadedPaths));
      $placeholders = implode(', ', array_fill(0, count($cols), '?'));
      $updateParts  = array_map(fn($c) => "`$c` = VALUES(`$c`)", array_keys($uploadedPaths));

      $sql = "INSERT INTO user_audio_settings (" . implode(', ', array_map(fn($c) => "`$c`", $cols)) . ")
                    VALUES ($placeholders)
                    ON DUPLICATE KEY UPDATE " . implode(', ', $updateParts);

      $stmt = $userPdo->prepare($sql);
      $stmt->execute(array_merge([$user['id']], array_values($uploadedPaths)));

      $message     = 'Audio settings saved successfully!';
      $messageType = 'success';
      logSystemAction($user['id'], 'AUDIO_SETTINGS_UPDATED', 'User updated ' . count($uploadedPaths) . ' audio file(s)');
    } catch (PDOException $e) {
      error_log('Audio settings DB error: ' . $e->getMessage());
      $message     = 'Files uploaded but database save failed. Please try again.';
      $messageType = 'error';
    }
  }

  if (!empty($uploadErrors)) {
    $errText     = implode(' ', $uploadErrors);
    $message     = $message ? $message . ' However: ' . $errText : $errText;
    $messageType = 'error';
  }

  if (empty($uploadedPaths) && empty($uploadErrors)) {
    $message     = 'No new files were selected.';
    $messageType = 'warning';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getExistingAudioPath(int $userId, string $column): ?string
{
  $allowed = array_values(AUDIO_TYPES);
  if (!in_array($column, $allowed, true)) {
    return null;
  }
  try {
    $pdo  = getUserDBConnection($userId);
    $stmt = $pdo->prepare("SELECT `$column` FROM user_audio_settings WHERE user_id = ? LIMIT 1");
    $stmt->execute([$userId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return ($row && !empty($row[$column])) ? $row[$column] : null;
  } catch (Exception $e) {
    error_log('getExistingAudioPath error: ' . $e->getMessage());
    return null;
  }
}

function audioLabel(string $key): string
{
  return ucfirst(str_replace('_', ' ', $key)) . ' sound';
}

// ── Load current audio settings ───────────────────────────────────────────────
$currentAudio = array_fill_keys(array_values(AUDIO_TYPES), null);
try {
  $userPdo = getUserDBConnection($user['id']);
  $stmt    = $userPdo->prepare("SELECT * FROM user_audio_settings WHERE user_id = ? LIMIT 1");
  $stmt->execute([$user['id']]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if ($row) {
    $currentAudio = array_merge($currentAudio, $row);
  }
} catch (Exception $e) {
  error_log('Error loading audio settings: ' . $e->getMessage());
}

// ── Refresh user ──────────────────────────────────────────────────────────────
try {
  $pdo  = getMainDBConnection();
  $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $stmt->execute([$user['id']]);
  $refreshedUser = $stmt->fetch(PDO::FETCH_ASSOC);
  if ($refreshedUser) {
    $user = $refreshedUser;
  }
} catch (PDOException $e) {
  error_log('Error refreshing user: ' . $e->getMessage());
}

// ── User stats ────────────────────────────────────────────────────────────────
$userStats = ['total_employees' => 0, 'active_employees' => 0, 'total_violations' => 0, 'recent_activity' => 0];
try {
  $userPdo = getUserDBConnection($user['id']);
  $userStats['total_employees']  = (int) $userPdo->query("SELECT COUNT(*) FROM employees")->fetchColumn();
  $userStats['active_employees'] = (int) $userPdo->query("SELECT COUNT(*) FROM employees WHERE status = 'Active'")->fetchColumn();
  $userStats['total_violations'] = (int) $userPdo->query("SELECT COUNT(*) FROM employees WHERE violation <> ''")->fetchColumn();
  $userStats['recent_activity']  = (int) $userPdo->query("SELECT COUNT(*) FROM employee_access_log WHERE access_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)")->fetchColumn();
} catch (Exception $e) {
  error_log('Error fetching user stats: ' . $e->getMessage());
}

// ── Account timestamps ────────────────────────────────────────────────────────
try {
  $pdo  = getMainDBConnection();
  $stmt = $pdo->prepare('SELECT created_at, last_login FROM users WHERE id = ?');
  $stmt->execute([$user['id']]);
  $accountInfo = $stmt->fetch(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
  $accountInfo = ['created_at' => null, 'last_login' => null];
}

// ── Audio card icon map ───────────────────────────────────────────────────────
$audioIconMap = [
  'success_audio_path'    => ['icon' => 'fa-check-circle',         'color' => '#22c55e'],
  'checkout_audio_path'   => ['icon' => 'fa-check-circle',         'color' => '#c54822'],
  'not_found_audio_path'  => ['icon' => 'fa-search',               'color' => '#f59e0b'],
  'inactive_audio_path'   => ['icon' => 'fa-user-slash',           'color' => '#64748b'],
  'violations_audio_path' => ['icon' => 'fa-exclamation-triangle', 'color' => '#ef4444'],
];
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> – Settings</title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link rel="stylesheet" href="/config/asset.php?t=by9d3">
  <link rel="stylesheet" href="/config/asset.php?t=mq4wc">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=rtf2w">
  <link rel="stylesheet" href="/config/asset.php?t=q5fwr">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>
  <!-- Loading Screen -->
  <div id="loading-screen">
    <div class="loading-content">
      <div class="spinner"></div>
      <div class="loading-text">Loading...</div>
      <div class="loading-subtext">Please wait while we prepare your content</div>
    </div>
  </div>

  <!-- Top shortcut nav -->
  <div class="shortcut-bar">
    <div class="shortcut-item" onclick="if (window.self !== window.top) {
        window.top.location.href = window.top.location.href.split('?')[0];
      } else {
        window.history.back();
      }">
      <i class="fas fa-arrow-left"></i>
      <span>Back</span>
    </div>
    <?php if ($access['tablePanel']): ?>
      <div class="shortcut-item" data-action-app="mainFrame-employees">
        <i class="fas fa-users"></i>
        <span>Employees</span>
      </div>
    <?php endif; ?>
    <?php if ($access['scanTest']): ?>
      <div class="shortcut-item" data-action-app="mainFrame-scanTest">
        <i class="fas fa-qrcode"></i>
        <span>Scan Test</span>
      </div>
    <?php endif; ?>
    <?php if ($access['adminPanel']): ?>
      <div class="shortcut-item" data-action-app="mainFrame-adminPanel">
        <i class="fas fa-user-shield"></i>
        <span>Admin Panel</span>
      </div>
    <?php endif; ?>
    <div class="shortcut-item" onclick="location.reload();">
      <i class="fas fa-sync-alt"></i>
      <span>Refresh</span>
    </div>
  </div>

  <div class="page-body">

    <!-- Welcome banner -->
    <div class="welcome-banner">
      <div class="wb-left">
        <h2><i class="fas fa-cogs" style="margin-right:8px;opacity:.8;"></i>Settings &amp; Configuration</h2>
        <p>Connected to <strong><?= htmlspecialchars($myDatabase) ?></strong></p>
        <?php if ($databaseConnected): ?>
          <div class="status-pill ok"><i class="fas fa-circle"></i> Database connected</div>
        <?php else: ?>
          <div class="status-pill err"><i class="fas fa-exclamation-circle"></i> Connection error</div>
        <?php endif; ?>
      </div>
      <div class="wb-right">
        <i class="fas fa-clock" style="margin-right:4px;"></i>
        <span id="wb-time"></span><br>
        <span id="wb-date" style="margin-top:3px;display:block;"></span>
      </div>
    </div>

    <!-- Two-column: Profile + Security -->
    <div class="two-col">

      <!-- Left: Stats cards -->
      <div style="display: flex; flex-direction: column; gap: 5px;">

        <!-- Profile Information -->
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-user" style="color:#3b82f6;margin-right:6px;"></i>Profile Information</span>
          </div>
          <div class="card-body">

            <div class="db-block">
              <img src="/config/asset.php?t=s3t4u" alt="MySQL">
              <div>
                <div class="db-name" style="color:<?= $databaseConnected ? '#16a34a' : '#dc2626' ?>;">
                  <?= htmlspecialchars($myDatabase) ?>
                </div>
                <div class="db-sub">Personal database</div>
              </div>
            </div>

            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Username</div>
                <div class="info-value"><?= htmlspecialchars($user['username'], ENT_QUOTES); ?></div>
              </div>
              <div class="info-item">
                <div class="info-label">Email</div>
                <div class="info-value"><?= htmlspecialchars($user['email'], ENT_QUOTES); ?></div>
              </div>
              <div class="info-item">
                <div class="info-label">Account Created</div>
                <div class="info-value">
                  <?= htmlspecialchars($accountInfo['created_at'] ? formatLocalTime($accountInfo['created_at']) : 'N/A'); ?>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">Last Login</div>
                <div class="info-value">
                  <?= htmlspecialchars($accountInfo['last_login'] ? formatLocalTime($accountInfo['last_login']) : 'N/A'); ?>
                </div>
              </div>
            </div>

            <?php if ($access['adminPanel']): ?>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button data-action-app="mainFrame-user" class="btn btn-secondary">
                  <i class="fas fa-users-cog"></i> Users Management
                </button>
                <button data-action-app="mainFrame-group" class="btn btn-secondary">
                  <i class="fas fa-layer-group"></i> Users Group
                </button>
                <button data-action-app="mainFrame-logs" class="btn btn-secondary">
                  <i class="fas fa-history"></i> System Logs
                </button>
                <button data-action-app="mainFrame-myAdmin" class="btn btn-secondary">
                  <i class="fas fa-database"></i> PHP MyAdmin
                </button>
              </div>
            <?php endif; ?>

          </div>
        </div>
      </div>

      <!-- Right: Audio Settings -->
      <div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">
              <i class="fas fa-volume-up" style="color:#6366f1;margin-right:6px;"></i>
              Audio Settings
              <span style="font-size:10px;color:#64748b;font-weight:400;margin-left:6px;">(Global)</span>
            </span>
          </div>
          <div class="card-body" id="global-audio-card-body">
            <!-- Populated by global_audio_settings.js -->
            <div style="font-size:12px;color:var(--text-muted);">Loading audio settings…</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer">
      <?php if ($message): ?>
        <div class="alert alert-<?= htmlspecialchars($messageType, ENT_QUOTES) ?>">
          <span><?= htmlspecialchars($message, ENT_QUOTES) ?></span>
          <button style="float:right;background:none;border:none;font-size:18px;cursor:pointer;margin-left:5px;"
            onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
          </button>
        </div>
      <?php endif; ?>
    </div>
  </div>

  <script src="/config/route-config.php?page=mainFrame"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=xd6ls"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=oqw56"></script>
  <script src="/config/asset.php?t=kg56e"></script>
</body>

</html>