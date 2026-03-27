<?php
// ptl.php - Modified security section to use current user's password

require_once '../cnfg/config.php';
require_once '../cnfg/db.php';

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

?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'My Database'); ?> - Portal</title>
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/system.css">
  <link rel="stylesheet" href="../css/ptl.css">
  <link rel="stylesheet" href="../css/btn.css">
  <link rel="stylesheet" href="../css/loading.css">
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

  <main class="db-cont">
    <section class="welcome-card" style="height: 160px;">
      <h1><i class="fas fa-server"></i> Management Panel</h1>
      <p>Welcome to your portal, <?= htmlspecialchars($username ?? 'User'); ?> 
        <?php if ($databaseConnected): ?>
          <span style="color: #28a745;">You're successfully logged in.</span>
        <?php else: ?>
          <span style="color: #dc3545;"><i class="fas fa-exclamation"></i> Network connection error.</span>
          <?php if (!empty($missingTables)): ?>
          <?php endif; ?>
        <?php endif; ?>
      </p>
      <p><strong>Email:</strong> <?= htmlspecialchars($email ?? ''); ?></p>
    </section>

    <section class="stats-grid">
      <div class="stat-card" onclick="window.location.href='../stat/acct.php';">
        <div class="icon">👤</div>
        <h3>Account Info</h3>
        <p>Manage your account settings and personal information</p>
      </div>

      <div class="stat-card" onclick="window.location.href='../stat/emp-db.php';">
        <div class="icon">📊</div>
        <h3>Insights</h3>
        <p>View your activity statistics and insights</p>
      </div>

      <div class="stat-card" onclick="navigateWithLoading('../stat/proximitycode.php');">
        <div class="icon"><img src="../logo/nfc-logo.svg" alt="NFC Icon" style="width: 36px; height: 36px; margin: 8px 0 -12px 0;"></div>
        <h3>Proximity Center</h3>
        <p>Check your proximity code status</p>
      </div>

      <div class="stat-card" onclick="window.location.href='../stat/settings.php';">
        <div class="icon">⚙️</div>
        <h3>Settings</h3>
        <p>Configure your application preferences</p>
      </div>
    </section>

    <section class="menu-grid">
      <div class="menu-card" onclick="navigateWithLoading('../tb/system.php');">
        <a href="../tb/system.php" class="action-btn" style="margin-bottom: 10px" onclick="event.preventDefault(); navigateWithLoading('../tb/system.php');">Input Employee</a>
        <div class="favi">
          <img src="../logo/mysql-logo.png" alt="MySql Logo" style="width: 125px; height: 100px;">
          <div>
            <h3>Employee Manager</h3>
            <p>Manage your employee information</p>
          </div>
        </div>
      </div>

      <div class="menu-card" onclick="navigateWithLoading('../tb/dtl.php');">
        <a href="../tb/dtl.php" class="action-btn" style="margin-bottom: 10px" onclick="event.preventDefault(); navigateWithLoading('../tb/dtl.php');">Scanned Log</a>
        <div class="favi">
          <img src="../logo/database.png" alt="Database" style="width: 100px; height: 100px;">
          <div>
            <h3>Scan History</h3>
            <p>View employee activity</p>
          </div>
        </div>
      </div>

      <div class="menu-card" onclick="navigateWithLoading('../sec/scanTest.php');">
        <a href="../sec/scanTest.php" class="action-btn" style="margin-bottom: 10px" onclick="event.preventDefault(); navigateWithLoading('../sec/scanTest.php');">Test QR Code</a>
        <div class="favi">
          <img src="../icon/nfc-icon.png" alt="NFC Icon" style="width: 100px; height: 100px;">
          <div>
            <h3>Test Live Search</h3>
            <p>Web Proximity verifier application</p>
          </div>
        </div>
      </div>

      <div class="menu-card" onclick="navigateWithLoading('../udev/m-i v2.php');" style="background: linear-gradient(to right, rgb(183, 183, 183), rgb(147, 147, 147)); transform: scale(1);">
        <a href="../udev/m-i v2.php" class="action-btn" style="margin-bottom: 10px" onclick="event.preventDefault(); navigateWithLoading('../udev/m-i v2.php');">Coming Soon</a>
        <div class="favi">
          <img src="../logo/coming-soon.png" alt="Coming Soon" style="width: 125px; height: 100px;">
          <div>
            <h3>Under Development</h3>
            <p>This area is reserved for future Development</p>
          </div>
        </div>
      </div>

      <!-- <div class="menu-card" onclick="navigateWithLoading('../stat/system-log.php');" style="background: linear-gradient(to right, rgb(183, 183, 183), rgb(147, 147, 147)); transform: scale(1);">
        <a href="../stat/system-log.php" class="action-btn" style="margin-bottom: 10px" onclick="event.preventDefault(); navigateWithLoading('../stat/system-log.php');">Coming Soon</a>
        <div class="favi">
          <img src="../logo/coming-soon.png" alt="Coming Soon" style="width: 125px; height: 100px;">
          <div>
            <h3>Under Development</h3>
            <p>This area is reserved for future Development</p>
          </div>
        </div>
      </div> -->
    </section>
  </main>

  <script src="../src/req.js"></script>
  <script src="../src/loading.js"></script>
</body>

</html>