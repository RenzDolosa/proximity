<?php
// settings.php

require_once '../../config/config.php';
require_once '../../config/db.php';

requireAccess('settings', '/portal');
$access = getMenuAccess();

if (!isLoggedIn()) {
  header('Location: /proximity3pl');
  exit;
}

$user = getCurrentUser();

try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
  $requiredTables = ['employees', 'code', 'employee_access_log', 'check_in_out'];
  $missingTables = [];

  if ($databaseConnected) {
    try {
      foreach ($requiredTables as $table) {
        $stmt = $userDb->prepare("
        SELECT COUNT(*) FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ");
        $stmt->execute([$table]);
        if ((int)$stmt->fetchColumn() === 0) {
          $missingTables[] = $table;
        }
      }

      if (!empty($missingTables)) {
        $databaseConnected = false;
      }
    } catch (PDOException $e) {
      $databaseConnected = false;
      $dbError = "Error checking tables: " . $e->getMessage();
    }
  }
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError = $e->getMessage();
}

// ── Generate / persist delete CSRF token ─────────────────────────────────────
if (empty($_SESSION['delete_audio_token'])) {
  $_SESSION['delete_audio_token'] = bin2hex(random_bytes(32));
}

// ── Pick up flash messages set by delete_audio.php ───────────────────────────
$message     = $_SESSION['flash_message'] ?? '';
$messageType = $_SESSION['flash_type']    ?? '';
unset($_SESSION['flash_message'], $_SESSION['flash_type']);

// ============================================================================
// ALLOWED AUDIO TYPES  (input key → DB column)
// ============================================================================
const AUDIO_TYPES = [
  'success'    => 'success_audio_path',
  'not_found'  => 'not_found_audio_path',
  'inactive'   => 'inactive_audio_path',
  'violations' => 'violations_audio_path',
];

// ============================================================================
// HANDLE AUDIO UPLOAD FORM SUBMISSION
// ============================================================================
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['update_audio'])) {

  $uploadDir = dirname(__DIR__) . '/uploads/audio/' . $user['id'] . '/';

  if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
  }

  $uploadedPaths = [];
  $uploadErrors  = [];
  $allowedMime = [
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',      // ← finfo on Linux
    'audio/wave',       // ← finfo on some systems
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',      // ← finfo for .m4a
    'audio/webm',
    'audio/aac',
    'audio/x-aac',      // ← finfo on Linux
  ];
  $maxSize       = 5 * 1024 * 1024; // 5 MB

  foreach (AUDIO_TYPES as $inputKey => $dbColumn) {
    $fileKey = 'audio_' . $inputKey;

    // Skip slots where no file was chosen
    if (!isset($_FILES[$fileKey]) || $_FILES[$fileKey]['error'] === UPLOAD_ERR_NO_FILE) {
      continue;
    }

    $file = $_FILES[$fileKey];

    // ── PHP upload error ──────────────────────────────────────────────────────
    if ($file['error'] !== UPLOAD_ERR_OK) {
      $uploadErrors[] = label($inputKey) . ': upload error (code ' . $file['error'] . ').';
      continue;
    }

    // ── Size guard ────────────────────────────────────────────────────────────
    if ($file['size'] > $maxSize) {
      $uploadErrors[] = label($inputKey) . ' exceeds the 5 MB limit.';
      continue;
    }

    // ── MIME check (finfo on tmp file, not browser-supplied type) ─────────────
    $finfo    = finfo_open(FILEINFO_MIME_TYPE);
    $mimeType = finfo_file($finfo, $file['tmp_name']);
    finfo_close($finfo);

    if (!in_array($mimeType, $allowedMime, true)) {
      $uploadErrors[] = label($inputKey) . ': not a supported audio format.';
      continue;
    }

    // ── Build destination path ────────────────────────────────────────────────
    $ext      = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $filename = $inputKey . '_' . time() . '.' . $ext;
    $destPath = $uploadDir . $filename;

    // ── Remove previous file for this slot ────────────────────────────────────
    $oldRelPath = getExistingAudioPath($user['id'], $dbColumn);
    if ($oldRelPath) {
      $oldAbs = dirname(__DIR__) . '/' . $oldRelPath;
      if (file_exists($oldAbs)) {
        @unlink($oldAbs);
      }
    }

    // ── Move upload ───────────────────────────────────────────────────────────
    if (move_uploaded_file($file['tmp_name'], $destPath)) {
      $uploadedPaths[$dbColumn] = 'uploads/audio/' . $user['id'] . '/' . $filename;
    } else {
      $uploadErrors[] = label($inputKey) . ': could not save file to disk.';
    }
  }

  // ── Persist to DB ─────────────────────────────────────────────────────────
  if (!empty($uploadedPaths)) {
    try {
      $userPdo = getUserDBConnection($user['id']);

      /*
       * Build a single-row upsert:
       *   INSERT INTO user_audio_settings (user_id, col1, col2, …)
       *   VALUES (?, ?, ?, …)
       *   ON DUPLICATE KEY UPDATE col1 = VALUES(col1), col2 = VALUES(col2), …
       *
       * The UNIQUE KEY on user_id (see schema) makes the duplicate-key trigger
       * fire on the second upload, so no separate SELECT + UPDATE is needed.
       */
      $cols         = array_merge(['user_id'], array_keys($uploadedPaths));
      $placeholders = implode(', ', array_fill(0, count($cols), '?'));
      $updateParts  = array_map(fn($c) => "`$c` = VALUES(`$c`)", array_keys($uploadedPaths));

      $sql = "INSERT INTO user_audio_settings (" . implode(', ', array_map(fn($c) => "`$c`", $cols)) . ")
              VALUES ($placeholders)
              ON DUPLICATE KEY UPDATE " . implode(', ', $updateParts);

      $params = array_merge([$user['id']], array_values($uploadedPaths));

      $stmt = $userPdo->prepare($sql);
      $stmt->execute($params);

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
    // Prepend any DB success note if we also had per-file errors
    $errText     = implode(' ', $uploadErrors);
    $message     = $message ? $message . ' However: ' . $errText : $errText;
    $messageType = 'error';
  }

  if (empty($uploadedPaths) && empty($uploadErrors)) {
    $message     = 'No new files were selected.';
    $messageType = 'warning';
  }
}

// ============================================================================
// HELPER: GET EXISTING AUDIO PATH FOR A GIVEN DB COLUMN
// ============================================================================
function getExistingAudioPath(int $userId, string $column): ?string
{
  // Whitelist column to prevent SQL injection
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

/** Human-readable label from an audio input key */
function label(string $key): string
{
  return ucfirst(str_replace('_', ' ', $key)) . ' sound';
}

// ============================================================================
// LOAD CURRENT AUDIO SETTINGS
// ============================================================================
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

// ============================================================================
// REFRESH USER + STATS
// ============================================================================
try {
  $pdo  = getMainDBConnection();
  $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $stmt->execute([$user['id']]);
  $refreshedUser = $stmt->fetch(PDO::FETCH_ASSOC);
  if ($refreshedUser) $user = $refreshedUser;
} catch (PDOException $e) {
  error_log('Error refreshing user: ' . $e->getMessage());
}

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

try {
  $pdo  = getMainDBConnection();
  $stmt = $pdo->prepare('SELECT created_at, last_login FROM users WHERE id = ?');
  $stmt->execute([$user['id']]);
  $accountInfo = $stmt->fetch(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
  $accountInfo = ['created_at' => null, 'last_login' => null];
}

// ============================================================================
// VIEW HELPER: render a single audio upload card
// ============================================================================
function audioCard(string $label, string $inputName, string $dbKey, array $currentAudio): void
{
  $hasFile  = !empty($currentAudio[$dbKey]);
  $filename = $hasFile ? basename($currentAudio[$dbKey]) : null;
  $webPath  = $hasFile ? '../' . htmlspecialchars($currentAudio[$dbKey], ENT_QUOTES) : null;

  $iconMap = [
    'success_audio_path'    => 'fa-check-circle text-success',
    'not_found_audio_path'  => 'fa-search text-warning',
    'inactive_audio_path'   => 'fa-user-slash text-secondary',
    'violations_audio_path' => 'fa-exclamation-triangle text-danger',
  ];
  $icon = $iconMap[$dbKey] ?? 'fa-volume-up';
?>
  <div class="audio-group" data-audio-type="<?= htmlspecialchars($inputName, ENT_QUOTES) ?>">
    <div class="audio-row">
      <label><i class="fas <?= $icon ?>"></i> <?= htmlspecialchars($label, ENT_QUOTES) ?></label>
      <div class="toggle-mute" onclick="toggleMute('<?= htmlspecialchars($inputName, ENT_QUOTES) ?>')">
        <div class="toggle-switch active" id="toggle-<?= htmlspecialchars($inputName, ENT_QUOTES) ?>">
          <div class="toggle-slider"></div>
        </div>
      </div>
    </div>

    <?php if ($hasFile): ?>
      <div class="current-audio-preview">
        <audio controls preload="none" style="width:100%;height:36px;">
          <source src="<?= $webPath ?>">
          Your browser does not support the audio element.
        </audio>
        <div class="current-file-name">
          <i class="fas fa-file-audio"></i>
          <?= htmlspecialchars($filename, ENT_QUOTES) ?>
          <a href="delete_audio.php?type=<?= urlencode($dbKey) ?>&token=<?= htmlspecialchars($_SESSION['delete_audio_token'], ENT_QUOTES) ?>"
            class="remove-audio"
            title="Remove this audio"
            onclick="return confirm('Remove <?= htmlspecialchars($label, ENT_QUOTES) ?>?')">
            <i class="fas fa-times-circle"></i>
          </a>
        </div>
      </div>
    <?php endif; ?>

    <div class="file-upload">
      <input type="file"
        id="<?= htmlspecialchars($inputName, ENT_QUOTES) ?>"
        name="audio_<?= htmlspecialchars($inputName, ENT_QUOTES) ?>"
        accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm,audio/aac">
      <label for="<?= htmlspecialchars($inputName, ENT_QUOTES) ?>" class="file-upload-label">
        <i class="fas fa-file-audio"></i>
        <?= $hasFile ? 'Replace audio file' : 'Click to select audio' ?>
      </label>
      <span class="file-chosen-name" style="font-size:.8rem;color:#888;display:block;margin-top:4px;"></span>
    </div>
  </div>
<?php
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($user['my_database'] ?? 'System', ENT_QUOTES) ?> – Settings</title>
  <link rel="preload" href="../icon/database-icon.png" as="image">
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/system.css">
  <link rel="stylesheet" href="../css/ptl.css">
  <link rel="stylesheet" href="../css/sett.css">
  <link rel="stylesheet" href="../css/btn.css">
  <link rel="stylesheet" href="../css/acct.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    /* ── Audio preview row ───────────────────────────────────── */
    .current-audio-preview {
      margin: 8px 0;
    }

    .current-file-name {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: .82rem;
      color: #555;
      margin-top: 4px;
    }

    .remove-audio {
      color: #dc3545;
      text-decoration: none;
      margin-left: auto;
    }

    .remove-audio:hover {
      color: #a71d2a;
    }

    /* ── Alerts ──────────────────────────────────────────────── */
    .alert {
      padding: 12px 16px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-weight: 500;
    }

    .alert-success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }

    .alert-error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }

    .alert-warning {
      background: #fff3cd;
      color: #856404;
      border: 1px solid #ffeaa7;
    }

    /* ── Colour helpers ──────────────────────────────────────── */
    .text-success {
      color: #28a745;
    }

    .text-warning {
      color: #ffc107;
    }

    .text-secondary {
      color: #6c757d;
    }

    .text-danger {
      color: #dc3545;
    }
  </style>
</head>

<body>

  <div id="closeButton" class="close-button" role="button" tabindex="0" aria-label="Close" onclick="window.history.back();">
    <i class="fas fa-times"></i>
  </div>

  <main class="db-cont">

    <section class="welcome-card">
      <h1><i class="fas fa-cogs"></i> Settings &amp; Configuration</h1>
      <div class="breadcrumb">
        <a onclick="window.history.back()"><i class="fas fa-home"></i> Portal</a> / Settings
      </div>
    </section>

    <?php if ($message): ?>
      <div class="alert alert-<?= htmlspecialchars($messageType, ENT_QUOTES) ?>">
        <i class="fas fa-<?= $messageType === 'success' ? 'check-circle' : ($messageType === 'warning' ? 'exclamation-circle' : 'times-circle') ?>"></i>
        <?= htmlspecialchars($message, ENT_QUOTES) ?>
      </div>
    <?php endif; ?>

    <!-- ── Stats ──────────────────────────────────────────────── -->
    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-number"><?= number_format($userStats['total_employees']) ?></div>
        <div class="stat-label">Total Employees</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?= number_format($userStats['active_employees']) ?></div>
        <div class="stat-label">Active Employees</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?= number_format($userStats['total_violations']) ?></div>
        <div class="stat-label">Total Violations</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?= number_format($userStats['recent_activity']) ?></div>
        <div class="stat-label">Recent Activity (30 days)</div>
      </div>
    </section>

    <section class="menu-grid">

      <!-- ── Database / Profile ──────────────────────────────── -->
      <div class="menu-card">
        <h2><i class="fas fa-database"></i> Database Information</h2>
        <div class="database-info">
          <img src="../icon/database-icon.png" alt="MySQL Logo" class="database-logo" loading="lazy">
          <p>Connected to your personal database:</p>
          <div class="database-name">
            <?php if ($databaseConnected): ?>
              <span style="color: #28a745;"><?php echo htmlspecialchars($myDatabase); ?></span>
            <?php else: ?>
              <span style="color: #dc3545;"><?php echo htmlspecialchars($myDatabase); ?></span>
              <?php if (!empty($missingTables)): ?>
              <?php endif; ?>
            <?php endif; ?>
          </div>
        </div>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Username</div>
            <div class="info-value"><?= htmlspecialchars($user['username'], ENT_QUOTES) ?></div>
          </div>
          <div class="info-item">
            <div class="info-label">Email</div>
            <div class="info-value"><?= htmlspecialchars($user['email'], ENT_QUOTES) ?></div>
          </div>
          <div class="info-item">
            <div class="info-label">Account Created</div>
            <div class="info-value">
              <?= $accountInfo['created_at'] ? date('F j, Y g:i A', strtotime($accountInfo['created_at'])) : 'N/A' ?>
            </div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Login</div>
            <div class="info-value">
              <?= $accountInfo['last_login'] ? date('F j, Y g:i A', strtotime($accountInfo['last_login'])) : 'Network error. Please try again.' ?>
            </div>
          </div>
        </div>
        <?php if (($user['user_group'] ?? '') === 'Administrator'): ?>
          <button onclick="window.location='users-management.php'" class="btn btn-primary" style="margin-top:20px;" id="regBtn">
            <i class="fas fa-user-plus"></i> Register User
          </button>
          <button onclick="window.location='system-log.php'" class="btn btn-primary" style="margin-top:20px;" id="regBtn">
            <i class="fas fa-file-alt"></i> System Log
          </button>
        <?php endif; ?>
      </div>

      <!-- ── Audio Settings ──────────────────────────────────── -->
      <div class="menu-card">
        <h2><i class="fas fa-volume-up"></i> Audio Settings</h2>
        <p style="color:#666;font-size:.9rem;margin-bottom:16px;">
          Upload custom audio files for each system event.
          Supported: MP3, WAV, OGG, AAC &mdash; max&nbsp;5&nbsp;MB each.
        </p>

        <form method="POST" enctype="multipart/form-data" id="audioForm">
          <div class="audio-grid">
            <?php audioCard('Success Sound',    'success',    'success_audio_path',    $currentAudio) ?>
            <?php audioCard('Not Found Sound',  'not_found',  'not_found_audio_path',  $currentAudio) ?>
            <?php audioCard('Inactive Sound',   'inactive',   'inactive_audio_path',   $currentAudio) ?>
            <?php audioCard('Violations Sound', 'violations', 'violations_audio_path', $currentAudio) ?>
          </div>

          <button type="submit" name="update_audio" class="btn btn-primary" style="margin-top:20px;" id="saveBtn">
            <i class="fas fa-save"></i> Save Audio Settings
          </button>
        </form>

        <hr style="margin:30px 0;border:none;height:1px;background:#e1e5e9;">
      </div>

    </section>
  </main>

  <!-- Pass current audio paths to JS aud.js / req.js -->
  <script>
    window.AUDIO_SETTINGS = <?= json_encode([
                              'success'    => $currentAudio['success_audio_path']    ? '../' . $currentAudio['success_audio_path']    : null,
                              'not_found'  => $currentAudio['not_found_audio_path']  ? '../' . $currentAudio['not_found_audio_path']  : null,
                              'inactive'   => $currentAudio['inactive_audio_path']   ? '../' . $currentAudio['inactive_audio_path']   : null,
                              'violations' => $currentAudio['violations_audio_path'] ? '../' . $currentAudio['violations_audio_path'] : null,
                            ], JSON_UNESCAPED_SLASHES) ?>;
  </script>

  <script src="../src/btn.js"></script>
  <script src="../src/aud.js"></script>
  <script src="../src/req.js"></script>

  <script>
    // Show chosen filename under each file input
    document.querySelectorAll('.file-upload input[type="file"]').forEach(function(input) {
      input.addEventListener('change', function() {
        var span = this.closest('.file-upload').querySelector('.file-chosen-name');
        if (span) span.textContent = this.files[0] ? this.files[0].name : '';
      });
    });

    // Disable save button while submitting to prevent double-post
    document.getElementById('audioForm').addEventListener('submit', function() {
      var btn = document.getElementById('saveBtn');
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    });
  </script>
</body>

</html>