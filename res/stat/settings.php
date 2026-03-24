<?php
//settings.php

require_once '../cnfg/config.php';
require_once '../cnfg/db.php';

$user = getCurrentUser();
$message = '';
$messageType = '';

// Refresh user data from database to ensure we have the latest information
try {
  $pdo = getMainDBConnection();
  $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
  $stmt->execute([$user['id']]);
  $refreshedUser = $stmt->fetch();
  if ($refreshedUser) {
    $user = $refreshedUser;
  }
} catch (PDOException $e) {
  error_log("Error refreshing user data: " . $e->getMessage());
}

// Get user statistics
$userStats = [];
try {
  $userPdo = getUserDBConnection($user['id']);

  // Get employee count
  $stmt = $userPdo->query("SELECT COUNT(*) as total_employees FROM employees");
  $userStats['total_employees'] = $stmt->fetchColumn();

  // Get active employees
  $stmt = $userPdo->query("SELECT COUNT(*) as active_employees FROM employees WHERE status = 'Active'");
  $userStats['active_employees'] = $stmt->fetchColumn();

  // Get total violations
  $stmt = $userPdo->query("SELECT COUNT(*) as total_violations FROM employees WHERE violation <> ''");
  $userStats['total_violations'] = $stmt->fetchColumn();

  // Get recent activity count (last 30 days)
  $stmt = $userPdo->query("SELECT COUNT(*) as recent_activity FROM employee_access_log WHERE access_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  $userStats['recent_activity'] = $stmt->fetchColumn();
} catch (Exception $e) {
  error_log("Error fetching user stats: " . $e->getMessage());
  $userStats = [
    'total_employees' => 0,
    'active_employees' => 0,
    'total_violations' => 0,
    'recent_activity' => 0
  ];
}

// Get account creation date and last login
try {
  $pdo = getMainDBConnection();
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
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Settings</title>
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/system.css">
  <link rel="stylesheet" href="../css/ptl.css">
  <link rel="stylesheet" href="../css/sett.css">
  <link rel="stylesheet" href="../css/btn.css">
  <link rel="stylesheet" href="../css/acct.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div id="closeButton" class="close-button" role="button" tabindex="0" aria-label="Close">
    <i class="fas fa-times"></i>
  </div>

  <main class="db-cont">
    <section class="welcome-card">
      <h1><i class="fas fa-cogs"></i> Settings & Configuration</h1>
      <div class="breadcrumb">
        <a href="../iframe/ptl.php"><i class="fas fa-home"></i> Portal</a> / Settings
      </div>
    </section>

    <?php if ($message): ?>
      <div class="alert alert-<?php echo $messageType; ?>">
        <?php echo htmlspecialchars($message); ?>
      </div>
    <?php endif; ?>

    <!-- Account Statistics -->
    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-number"><?php echo number_format($userStats['total_employees']); ?></div>
        <div class="stat-label">Total Employees</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?php echo number_format($userStats['active_employees']); ?></div>
        <div class="stat-label">Active Employees</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?php echo number_format($userStats['total_violations']); ?></div>
        <div class="stat-label">Total Violations</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?php echo number_format($userStats['recent_activity']); ?></div>
        <div class="stat-label">Recent Activity (30 days)</div>
      </div>
    </section>

    <section class="menu-grid">
      <!-- Profile Information -->
      <div class="menu-card">
        <h2><i class="fas fa-database"></i> Database Information</h2>

        <div class="database-info">
          <img src="../icon/database-icon.png" alt="MySql Logo" class="database-logo">
          <p>Connected to your personal database:</p>
          <div class="database-name"><?php echo htmlspecialchars($user['my_database']); ?></div>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Username</div>
            <div class="info-value"><?php echo htmlspecialchars($user['username']); ?></div>
          </div>
          <div class="info-item">
            <div class="info-label">Email</div>
            <div class="info-value"><?php echo htmlspecialchars($user['email']); ?></div>
          </div>
          <div class="info-item">
            <div class="info-label">Account Created</div>
            <div class="info-value">
              <?php echo $accountInfo['created_at'] ? date('F j, Y g:i A', strtotime($accountInfo['created_at'])) : 'N/A'; ?>
            </div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Login</div>
            <div class="info-value">
              <?php echo $accountInfo['last_login'] ? date('F j, Y g:i A', strtotime($accountInfo['last_login'])) : 'N/A'; ?>
            </div>
          </div>
        </div>
      </div>

      <!-- Security Settings -->
      <div class="menu-card">
        <h2>Audio Settings</h2>

        <form method="POST">
          <div class="audio-grid">
            <div class="audio-group">
              <div class="audio-row">
                <label>Success Sound</label>
                <div class="toggle-mute" onclick="toggleMute()">
                  <div class="toggle-switch active" id="toggleSwitch">
                    <div class="toggle-slider"></div>
                  </div>
                </div>
              </div>
              <div class="file-upload">
                <input type="file" id="audio" name="audio" accept="audio/*">
                <label for="audio" class="file-upload-label">
                  <i class="fas fa-file-audio"></i> Click to select audio
                </label>
              </div>
            </div>
            <div class="audio-group">
              <div class="audio-row">
                <label>Not Found Sound</label>
                <div class="toggle-mute" onclick="toggleMute()">
                  <div class="toggle-switch active" id="toggleSwitch">
                    <div class="toggle-slider"></div>
                  </div>
                </div>
              </div>
              <div class="file-upload">
                <input type="file" id="audio" name="audio" accept="audio/*">
                <label for="audio" class="file-upload-label">
                  <i class="fas fa-file-audio"></i> Click to select audio
                </label>
              </div>
            </div>
            <div class="audio-group">
              <div class="audio-row">
                <label>Inactive Sound</label>
                <div class="toggle-mute" onclick="toggleMute()">
                  <div class="toggle-switch active" id="toggleSwitch">
                    <div class="toggle-slider"></div>
                  </div>
                </div>
              </div>
              <div class="file-upload">
                <input type="file" id="audio" name="audio" accept="audio/*">
                <label for="audio" class="file-upload-label">
                  <i class="fas fa-file-audio"></i> Click to select audio
                </label>
              </div>
            </div>
            <div class="audio-group">
              <div class="audio-row">
                <label>Violations Sound</label>
                <div class="toggle-mute" onclick="toggleMute()">
                  <div class="toggle-switch active" id="toggleSwitch">
                    <div class="toggle-slider"></div>
                  </div>
                </div>
              </div>
              <div class="file-upload">
                <input type="file" id="audio" name="audio" accept="audio/*">
                <label for="audio" class="file-upload-label">
                  <i class="fas fa-file-audio"></i> Click to select audio
                </label>
              </div>
            </div>
          </div>

          <button type="submit" name="update_audio" class="btn btn-primary">Update Audio</button>
        </form>

        <hr style="margin: 30px 0; border: none; height: 1px; background: #e1e5e9;">
      </div>
    </section>
  </main>

  <script src="../src/aud.js"></script>
  <script src="../src/btn.js"></script>
  <script src="../src/req.js"></script>
</body>

</html>