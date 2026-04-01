<?php
// qr proximity.php

require_once '../cnfg/config.php';
require_once '../cnfg/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'qr proximity') && !canAccess($permissions, 'manual input')) {
    echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) {
            window.top.history.back();
        } else {
            window.history.back();
        }
    </script></body></html>';
    exit;
}

requireAccess('qr proximity', 'manual input.php');
$access = getMenuAccess();

if (!isset($_SESSION['user_id'])) {
  header('Location: /index.php');
  exit();
}

$myDatabase = $_SESSION['my_database'] ?? 'My Database';
$userId = $_SESSION['user_id'];
$userDbName = USER_DB_PREFIX . $userId;
$username = $_SESSION['username'] ?? 'User';
$email = $_SESSION['email'] ?? '';
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Proximity Pass</title>
  <link rel="preload" href="../logo/nfc-logo.svg" as="image/svg+xml">
  <link rel="preload" href="../logo/proximity-logo.svg" type="image/svg+xml">
  <link rel="icon" href="../logo/nfc-logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../css/qp.css">
  <link rel="stylesheet" href="../css/sbar.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div class="side-bar" style="top: 0;">
    <?php if ($access['qr proximity']): ?>
      <div onclick="window.location.href='qr proximity.php';" class="side-btn">
        <div class="s-header">
          <h1>Proximity</h1>
        </div>
        <div class="s-search-section">
          <img src="../icon/nfc-icon.svg" alt="NFC Icon" loading="lazy">
          <div>
            <h3>Live Search</h3>
            <p>Web pass verifier application</p>
          </div>
        </div>
      </div>
    <?php endif; ?>

    <?php if ($access['manual input']): ?>
      <div onclick="window.location.href='manual input.php';" class="side-btn">
        <div class="s-header">
          <h1>Manual Entry</h1>
        </div>
        <div class="s-search-section">
          <img src="../logo/manual.svg" alt="Manual Entry" loading="lazy">
          <div>
            <h3>Employee Entry</h3>
            <p>This area is served for manual entry</p>
          </div>
        </div>
      </div>
    <?php endif; ?>
    <version_compare style="z-index: 1000;">
      <p id="version"></p>
    </version_compare>
  </div>

  <div class="container">
    <h2>Live Search</h2>

    <div class="search-container">
      <input type="text" id="searchInput" autocomplete="off" autofocus>
    </div>

    <div id="resultsTable" style="display: none;">
      <div class="result" id="resultsBody"></div>
    </div>
    <div id="message"></div>
  </div>

  <audio id="successSound" src="../sounds/success.mp3" preload="auto"></audio>
  <audio id="noResultSound" src="../sounds/noResultsFound.mp3" preload="auto"></audio>
  <audio id="warningSound" src="../sounds/ohh-ow.mp3" preload="auto"></audio>
  <audio id="inactiveSound" src="../sounds/inactive.mp3" preload="auto"></audio>
  <script src="https://cdn.jsdelivr.net/npm/qrcodejs/qrcode.min.js"></script>
  <script src="../src/qp.js"></script>
  <script src="../src/req.js"></script>
  <script src="../src/ver.js"></script>
</body>

</html>