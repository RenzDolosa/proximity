<?php
// portal.php

require_once 'res/cnfg/config.php';
require_once 'res/cnfg/db.php';
require_once 'res/cnfg/req.php';

requireAccess('portal', 'proximity.php', true);
$access = getMenuAccess();

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
  <link rel="preload" href="../icon/database-icon.png" as="image">
  <link rel="icon" href="res/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="res/css/system.css">
  <link rel="stylesheet" href="res/css/ptl.css">
  <link rel="stylesheet" href="res/css/sbar.css">
  <link rel="stylesheet" href="res/css/btn.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    /* Add a subtle indicator that portal is secured */
    .security-badge {
      position: fixed;
      top: 80px;
      left: 10px;
      background: linear-gradient(135deg, #4CAF50, #45a049);
      color: white;
      padding: 5px 12px;
      border-radius: 15px;
      font-size: 12px;
      font-weight: 600;
      z-index: 2000;
      box-shadow: 0 2px 10px rgba(76, 175, 80, 0.3);
    }

    .security-badge::before {
      content: "🔒";
      margin-left: 0.6px;
      font-size: 8px;
      position: absolute;
    }
  </style>
</head>

<body>
  <main>
    <!-- Security indicator -->
    <!-- <div class="security-badge"><i class="fas fa-shield-alt"></i> Secured</div> -->

    <div class="side-bar" style="top: 64px;">
      <?php if ($access['proximity']): ?>
        <div onclick="window.location.href='proximity.php';" class="side-btn">
          <div class="s-header">
            <h1>Proximity</h1>
          </div>
          <div class="s-search-section">
            <img src="res/icon/nfc-icon.png" alt="NFC Icon" loading="lazy">
            <div>
              <h3>Live Search</h3>
              <p>Web pass verifier application</p>
            </div>
          </div>
        </div>
      <?php endif; ?>
      <version_compare style="z-index: 1000;">
        <p id="version"></p>
      </version_compare>
    </div>

    <header class="header">
      <div class="myDatabase-logo">
        <a href="portal.php" class="link">
          <img src="res/logo/mysql.png" alt="MySql Logo" class="header-logo" loading="lazy">
          <h1 style="padding-left: 50px; margin: 0;"><?= htmlspecialchars($myDatabase ?? 'My Database'); ?></h1>
        </a>
      </div>
      <div class="user-info">
        <span>Welcome, <?= htmlspecialchars($username ?? 'User'); ?>
          <?php if ($databaseConnected): ?>
            <span style="color: #28a745;"></span>
          <?php else: ?>
            <span style="color: #dc3545;"><i class="fas fa-exclamation"></i></span>
            <?php if (!empty($missingTables)): ?>
            <?php endif; ?>
          <?php endif; ?>
          <a href="?logout=1" class="logout-btn">Logout ▼</a>
      </div>
    </header>

    <portal class="main-content">
      <iframe src="res/iframe/main.php" class="frames" frameborder="0" allowfullscreen="allowfullscreen"></iframe>
    </portal>
  </main>

  <script src="res/src/req.js"></script>
  <script src="res/src/ver.js"></script>
  <script>
    // Guard: if the main iframe navigates to login, redirect the whole top window
    const mainFrame = document.querySelector('.frames');
    if (mainFrame) {
      mainFrame.addEventListener('load', function() {
        try {
          const frameUrl = this.contentWindow.location.href;
          if (frameUrl.includes('index.php') || frameUrl.includes('login')) {
            window.top.location.href = frameUrl;
          }
        } catch (e) {
          // Cross-origin means a real redirect happened — go to login
          window.top.location.href = 'index.php';
        }
      });
    }
  </script>
</body>

</html>