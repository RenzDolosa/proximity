<?php
// portal.php

require_once 'res/cnfg/config.php';
require_once 'res/cnfg/req.php';

?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'My Database'); ?> - Portal</title>
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
  <!-- Security indicator -->
  <div class="security-badge"><i class="fas fa-shield-alt"></i> Secured</div>

  <div class="side-bar" style="top: 64px;">
    <div onclick="window.location.href='qr-pass.php';" class="side-btn">
      <div class="s-header">
        <h1>Proximity</h1>
      </div>
      <div class="s-search-section">
        <img src="res/icon/nfc-icon.png" alt="NFC Icon">
        <div>
          <h3>Live Search</h3>
          <p>Web pass verifier application</p>
        </div>
      </div>
    </div>
    <version_compare style="z-index: 1000;">
      <p id="version"></p>
    </version_compare>
  </div>

  <header class="header">
    <div class="myDatabase-logo">
      <a href="portal.php" class="link">
        <img src="res/logo/Mysql.png" alt="MySql Logo" class="header-logo">
        <h1 style="padding-left: 50px; margin: 0;"><?= htmlspecialchars($myDatabase ?? 'My Database'); ?></h1>
      </a>
    </div>
    <div class="user-info">
      <span>Welcome, <?= htmlspecialchars($username ?? 'User'); ?> <i class="fas fa-exclamation"></i></span>
      <a href="?logout=1" class="logout-btn">Logout ▼</a>
    </div>
  </header>

  <main class="main-content">
    <iframe src="res/iframe/ptl.php" class="frames" frameborder="0" allowfullscreen="allowfullscreen"></iframe>
  </main>

  <script src="res/src/req.js"></script>
  <script src="res/src/ver.js"></script>
</body>

</html>