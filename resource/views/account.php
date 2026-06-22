<?php
// resource/views/account.php --> account

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('account info', ROUTE_HOME);
$access = getMenuAccess();

$userId = $_SESSION['user_id'] ?? null;
$user = getCurrentUser();
$message = '';
$messageType = '';

function formatLocalTime(string $timestamp, string $format = 'F j, Y g:i A'): string
{
  return (new DateTime($timestamp, new DateTimeZone(APP_TIMEZONE)))->format($format);
}

try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
  $requiredTables = ['employees', 'code', 'employee_access_log', 'check_in_out'];
  $missingTables = [];

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
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError = $e->getMessage();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  if (isset($_POST['update_profile'])) {
    $firstName = sanitizeInput($_POST['first_name']);
    $lastName  = sanitizeInput($_POST['last_name']);
    $phoneNum  = sanitizeInput($_POST['phone']);
    $errors    = [];

    if (empty($firstName) || empty($lastName)) {
      $errors[] = "First name and last name are required";
    }

    if (empty($errors)) {
      try {
        $pdo  = getMainDBConnection();
        $stmt = $pdo->prepare("UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = NOW() WHERE id = ?");
        $stmt->execute([$firstName, $lastName, $phoneNum, $user['id']]);

        $_SESSION['first_name'] = $firstName;
        $_SESSION['last_name']  = $lastName;
        $_SESSION['phone']      = $phoneNum;

        $user['first_name'] = $firstName;
        $user['last_name']  = $lastName;
        $user['phone']      = $phoneNum;

        logSystemAction($user['id'], 'PROFILE_UPDATED', 'User updated profile information');

        $message     = 'Profile updated successfully!';
        $messageType = 'success';
      } catch (PDOException $e) {
        error_log("Profile update error: " . $e->getMessage());
        $message     = 'An error occurred while updating your profile.';
        $messageType = 'error';
      }
    } else {
      $message     = implode(', ', $errors);
      $messageType = 'error';
    }
  }

  if (isset($_POST['change_password'])) {
    $currentPassword = $_POST['current_password'];
    $newPassword     = $_POST['new_password'];
    $confirmPassword = $_POST['confirm_password'];
    $errors          = [];

    if (empty($currentPassword) || empty($newPassword) || empty($confirmPassword)) {
      $errors[] = "All password fields are required";
    }
    if ($newPassword !== $confirmPassword) {
      $errors[] = "New passwords do not match";
    }
    if (!isValidPassword($newPassword)) {
      $errors[] = "Password must be at least 8 characters with uppercase, lowercase, and number";
    }

    if (empty($errors)) {
      try {
        $pdo  = getMainDBConnection();
        $stmt = $pdo->prepare("SELECT password FROM users WHERE id = ?");
        $stmt->execute([$user['id']]);
        $currentHash = $stmt->fetchColumn();

        if (password_verify($currentPassword, $currentHash)) {
          $newHash    = password_hash($newPassword, PASSWORD_DEFAULT);
          $updateStmt = $pdo->prepare("UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?");
          $updateStmt->execute([$newHash, $user['id']]);

          logSystemAction($user['id'], 'PASSWORD_CHANGED', 'User changed password');

          $message     = 'Password changed successfully!';
          $messageType = 'success';
        } else {
          $message     = 'Current password is incorrect.';
          $messageType = 'error';
        }
      } catch (PDOException $e) {
        error_log("Password change error: " . $e->getMessage());
        $message     = 'An error occurred while changing your password.';
        $messageType = 'error';
      }
    } else {
      $message     = implode(', ', $errors);
      $messageType = 'error';
    }
  }
}

try {
  $pdo  = getMainDBConnection();
  $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
  $stmt->execute([$user['id']]);
  $refreshedUser = $stmt->fetch();
  if ($refreshedUser) {
    $user = $refreshedUser;
  }
} catch (PDOException $e) {
  error_log("Error refreshing user data: " . $e->getMessage());
}

$userStats = ['total_employees' => 0, 'active_employees' => 0, 'total_violations' => 0, 'recent_activity' => 0];
try {
  $userPdo = getUserDBConnection($user['id']);

  $stmt = $userPdo->query("SELECT COUNT(*) FROM employees");
  $userStats['total_employees'] = (int)$stmt->fetchColumn();

  $stmt = $userPdo->query("SELECT COUNT(*) FROM employees WHERE status = 'Active'");
  $userStats['active_employees'] = (int)$stmt->fetchColumn();

  $stmt = $userPdo->query("SELECT COUNT(*) FROM employees WHERE violation <> ''");
  $userStats['total_violations'] = (int)$stmt->fetchColumn();

  $stmt = $userPdo->query("SELECT COUNT(*) FROM employee_access_log WHERE access_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  $userStats['recent_activity'] = (int)$stmt->fetchColumn();
} catch (Exception $e) {
  error_log("Error fetching user stats: " . $e->getMessage());
}

try {
  $pdo  = getMainDBConnection();
  $stmt = $pdo->prepare("SELECT created_at, last_login FROM users WHERE id = ?");
  $stmt->execute([$user['id']]);
  $accountInfo = $stmt->fetch();
} catch (PDOException $e) {
  error_log("Error fetching account info: " . $e->getMessage());
  $accountInfo = ['created_at' => null, 'last_login' => null];
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Account info</title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <!-- <link rel="stylesheet" href="/config/asset.php?t=h46e2"> -->
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
        <h2><i class="fas fa-user-circle" style="margin-right:8px;opacity:.8;"></i>Account Information</h2>
        <p>Connected to <strong><?= htmlspecialchars($myDatabase); ?></strong></p>
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
              <img src="/config/asset.php?t=s3t4u" alt="DB">
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

            <form method="POST">
              <div class="form-grid">
                <div class="form-group">
                  <label for="first_name">First Name</label>
                  <input type="text" id="first_name" name="first_name" class="form-control"
                    value="<?= htmlspecialchars($user['first_name'] ?? ''); ?>">
                </div>
                <div class="form-group">
                  <label for="last_name">Last Name</label>
                  <input type="text" id="last_name" name="last_name" class="form-control"
                    value="<?= htmlspecialchars($user['last_name'] ?? ''); ?>">
                </div>
                <div class="form-group full">
                  <label for="phone">Phone Number <span style="font-weight:400;">(Optional)</span></label>
                  <input type="tel" id="phone" name="phone" class="form-control"
                    value="<?= htmlspecialchars($user['phone'] ?? ''); ?>">
                </div>
              </div>
              <button type="submit" name="update_profile" class="btn btn-primary" tabindex="-1">
                <i class="fas fa-save"></i> Update Profile
              </button>
            </form>
          </div>
        </div>
      </div>

      <!-- Right: Recent activity -->
      <div>
        <!-- Security Settings -->
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-lock" style="color:#6366f1;margin-right:6px;"></i>Security Settings</span>
          </div>
          <div class="card-body">
            <form method="POST">
              <div class="form-grid">
                <div class="form-group full">
                  <label for="current_password">Current Password</label>
                  <div class="input-wrapper">
                    <input type="password" id="current_password" name="current_password" class="form-control" required>
                    <button type="button" class="toggle-pw" tabindex="-1" onclick="togglePw('current_password', this)">
                      <i class="fas fa-eye"></i>
                    </button>
                  </div>
                </div>
                <div class="form-group full">
                  <label for="new_password">New Password</label>
                  <div class="input-wrapper">
                    <input type="password" id="new_password" name="new_password" class="form-control" required>
                    <button type="button" class="toggle-pw" tabindex="-1" onclick="togglePw('new_password', this)">
                      <i class="fas fa-eye"></i>
                    </button>
                  </div>
                  <span class="form-hint">At least 8 characters with uppercase, lowercase, and number.</span>
                </div>
                <div class="form-group full">
                  <label for="confirm_password">Confirm New Password</label>
                  <div class="input-wrapper">
                    <input type="password" id="confirm_password" name="confirm_password" class="form-control" required>
                    <button type="button" class="toggle-pw" tabindex="-1" onclick="togglePw('confirm_password', this)">
                      <i class="fas fa-eye"></i>
                    </button>
                  </div>
                </div>
              </div>
              <div class="form-row-btn">
                <div class="form-row">
                  <div>
                    <button type="submit" name="change_password" class="btn btn-primary" tabindex="-1">
                      <i class="fas fa-key"></i> Change Password
                    </button>
                  </div>
                </div>
              </div>
            </form>
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
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=oqw56"></script>
  <script src="/config/asset.php?t=kg56e"></script>
  <script>
    function togglePw(fieldId, btn) {
      const input = document.getElementById(fieldId);
      const icon = btn.querySelector('i');
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      icon.className = isHidden ? 'fas fa-eye-slash' : 'fas fa-eye';
    }
  </script>
</body>

</html>