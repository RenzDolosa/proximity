<?php
// resource/views/settings.php --> settings

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

requireAccess('settings', 'iframe/main.php');
$access = getMenuAccess();

$userId    = $_SESSION['user_id'] ?? null;
$userGroup = $_SESSION['user_group'] ?? '';

if (!isLoggedIn()) {
  header('Location: ../index.php');
  exit;
}

$user = getCurrentUser();

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
  'success_audio_path'    => ['icon' => 'fa-check-circle',       'color' => '#22c55e'],
  'not_found_audio_path'  => ['icon' => 'fa-search',             'color' => '#f59e0b'],
  'inactive_audio_path'   => ['icon' => 'fa-user-slash',         'color' => '#64748b'],
  'violations_audio_path' => ['icon' => 'fa-exclamation-triangle', 'color' => '#ef4444'],
];
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($user['my_database'] ?? 'System', ENT_QUOTES) ?> – Settings</title>
  <link rel="icon" href="../assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link rel="stylesheet" href="../css/sett.css">
  <link rel="stylesheet" href="../css/loading.css">
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
    <?php if ($access['table panel']): ?>
      <div class="shortcut-item" onclick="navigateWithLoading('../../../app/services/table panel.php?tab=employees');">
        <i class="fas fa-users"></i>
        <span>Employees</span>
      </div>
    <?php endif; ?>
    <?php if ($access['scan test']): ?>
      <div class="shortcut-item" onclick="navigateWithLoading('../../../app/http/controllers/scan test.php');">
        <i class="fas fa-qrcode"></i>
        <span>Scan Test</span>
      </div>
    <?php endif; ?>
    <?php if ($access['admin panel']): ?>
      <div class="shortcut-item" onclick="navigateWithLoading('admin panel.php#users');">
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
          <div class="status-pill ok"><i class="fas fa-circle" style="font-size:7px;"></i> Database connected</div>
        <?php else: ?>
          <div class="status-pill err"><i class="fas fa-exclamation-circle" style="font-size:9px;"></i> Connection error</div>
        <?php endif; ?>
      </div>
    </div>

    <!-- Alert message -->
    <?php if ($message): ?>
      <div class="alert alert-<?= htmlspecialchars($messageType, ENT_QUOTES) ?>">
        <span><?= htmlspecialchars($message, ENT_QUOTES) ?></span>
        <button onclick="this.parentElement.remove()"><i class="fas fa-times"></i></button>
      </div>
    <?php endif; ?>

    <!-- Two-column: Profile + Security -->
    <div class="two-col">

      <!-- Left: Stats cards -->
      <div style="display: flex; flex-direction: column; gap: 5px;">

        <!-- Profile Information -->
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-user" style="color:#3b82f6;margin-right:6px;"></i>Employee Stats</span>
          </div>
          <div class="card-body">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon" style="color:#3b82f6;"><i class="fas fa-users"></i></div>
                  <div class="stat-value"><?= number_format($userStats['total_employees']) ?></div>
                </div>
                <div class="stat-label">Total Employees</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon" style="color:#22c55e;"><i class="fas fa-user-check"></i></div>
                  <div class="stat-value"><?= number_format($userStats['active_employees']) ?></div>
                </div>
                <div class="stat-label">Active Employees</div>
              </div>
              <div class="stat-card" onclick="navigateWithLoading('../../../app/services/violation_log.php');">
                <div class="stat-top">
                  <div class="stat-icon" style="color:#ef4444;"><i class="fas fa-exclamation-triangle"></i></div>
                  <div class="stat-value"><?= number_format($userStats['total_violations']) ?></div>
                </div>
                <div class="stat-label">Total Violators</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon" style="color:#f59e0b;"><i class="fas fa-history"></i></div>
                  <div class="stat-value"><?= number_format($userStats['recent_activity']) ?></div>
                </div>
                <div class="stat-label">Activity (30 days)</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-database" style="color:#3b82f6;margin-right:6px;"></i>Database &amp; Profile</span>
          </div>
          <div class="card-body">

            <div class="db-block">
              <img src="../assets/icon/database-icon.png" alt="MySQL">
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
                <div class="info-value"><?= htmlspecialchars($user['username'], ENT_QUOTES) ?></div>
              </div>
              <div class="info-item">
                <div class="info-label">Email</div>
                <div class="info-value" style="font-size:12px;"><?= htmlspecialchars($user['email'], ENT_QUOTES) ?></div>
              </div>
              <div class="info-item">
                <div class="info-label">Account Created</div>
                <div class="info-value" style="font-size:12px;">
                  <?= $accountInfo['created_at'] ? date('M j, Y g:i A', strtotime($accountInfo['created_at'])) : 'N/A' ?>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">Last Login</div>
                <div class="info-value" style="font-size:12px;">
                  <?= $accountInfo['last_login'] ? date('M j, Y g:i A', strtotime($accountInfo['last_login'])) : 'N/A' ?>
                </div>
              </div>
            </div>

            <?php if ($access['admin panel']): ?>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button onclick="navigateWithLoading('admin panel.php#users')" class="btn-outline">
                  <i class="fas fa-users-cog"></i> Users Management
                </button>
                <button onclick="navigateWithLoading('admin panel.php#group')" class="btn-outline">
                  <i class="fas fa-layer-group"></i> Users Group
                </button>
                <button onclick="navigateWithLoading('admin panel.php#logs')" class="btn-outline">
                  <i class="fas fa-history"></i> System Logs
                </button>
                <button onclick="navigateWithLoading('admin panel.php#myadmin')" class="btn-outline">
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
            <span class="card-title"><i class="fas fa-volume-up" style="color:#6366f1;margin-right:6px;"></i>Audio Settings</span>
          </div>
          <div class="card-body">

            <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px;">
              Upload custom audio for each system event. Supported: MP3, WAV, OGG, AAC — max 5 MB each.
            </p>

            <form method="POST" enctype="multipart/form-data" id="audioForm">
              <div class="audio-grid">
                <?php foreach (AUDIO_TYPES as $inputKey => $dbColumn):
                  $hasFile  = !empty($currentAudio[$dbColumn]);
                  $filename = $hasFile ? basename($currentAudio[$dbColumn]) : null;
                  $webPath  = $hasFile ? '../' . htmlspecialchars($currentAudio[$dbColumn], ENT_QUOTES) : null;
                  $iconData = $audioIconMap[$dbColumn] ?? ['icon' => 'fa-volume-up', 'color' => '#64748b'];
                ?>
                  <div class="audio-card">
                    <div class="audio-card-top">
                      <div class="audio-card-label">
                        <i class="fas <?= $iconData['icon'] ?>" style="color:<?= $iconData['color'] ?>;font-size:14px;"></i>
                        <?= htmlspecialchars(audioLabel($inputKey), ENT_QUOTES) ?>
                      </div>
                      <?php if ($hasFile): ?>
                        <span class="badge badge-ok">Uploaded</span>
                      <?php else: ?>
                        <span class="badge badge-none">None</span>
                      <?php endif; ?>
                    </div>

                    <?php if ($hasFile): ?>
                      <audio controls preload="none">
                        <source src="<?= $webPath ?>">
                      </audio>
                      <div class="audio-actions">
                        <label for="audio_<?= $inputKey ?>" class="file-upload-label">
                          <i class="fas fa-file-audio"></i> Replace
                        </label>
                        <a href="delete_audio.php?type=<?= urlencode($dbColumn) ?>&token=<?= htmlspecialchars($_SESSION['delete_audio_token'], ENT_QUOTES) ?>"
                          class="remove-audio"
                          onclick="return confirm('Remove <?= htmlspecialchars(audioLabel($inputKey), ENT_QUOTES) ?>?')">
                          <i class="fas fa-times-circle"></i> Remove
                        </a>
                      </div>
                    <?php else: ?>
                      <label for="audio_<?= $inputKey ?>" class="file-upload-label">
                        <i class="fas fa-file-audio"></i> Select audio file
                      </label>
                    <?php endif; ?>

                    <input type="file"
                      id="audio_<?= $inputKey ?>"
                      name="audio_<?= $inputKey ?>"
                      accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,audio/aac"
                      style="display:none;">
                    <div class="file-chosen" id="chosen_<?= $inputKey ?>"></div>
                  </div>
                <?php endforeach; ?>
              </div>

              <button type="submit" name="update_audio" class="btn-primary" style="margin-top:16px;" id="saveBtn">
                <i class="fas fa-save"></i> Save Audio Settings
              </button>
            </form>

          </div>
        </div>
      </div>

    </div><!-- /.two-col -->
  </div><!-- /.page-body -->

  <script>
    window.AUDIO_SETTINGS = <?= json_encode([
                              'success'    => $currentAudio['success_audio_path']    ? '../' . $currentAudio['success_audio_path']    : null,
                              'not_found'  => $currentAudio['not_found_audio_path']  ? '../' . $currentAudio['not_found_audio_path']  : null,
                              'inactive'   => $currentAudio['inactive_audio_path']   ? '../' . $currentAudio['inactive_audio_path']   : null,
                              'violations' => $currentAudio['violations_audio_path'] ? '../' . $currentAudio['violations_audio_path'] : null,
                            ], JSON_UNESCAPED_SLASHES) ?>;
  </script>

  <script src="../js/btn.js"></script>
  <script src="../js/aud.js"></script>
  <script src="../js/req.js"></script>
  <script src="../js/loading.js"></script>

  <script>
    document.querySelectorAll('.audio-grid input[type="file"]').forEach(function(input) {
      input.addEventListener('change', function() {
        var key = this.id.replace('audio_', '');
        var shown = document.getElementById('chosen_' + key);
        if (shown) shown.textContent = this.files[0] ? this.files[0].name : '';
      });
    });

    document.getElementById('audioForm').addEventListener('submit', function() {
      var btn = document.getElementById('saveBtn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    });
  </script>

</body>

</html>