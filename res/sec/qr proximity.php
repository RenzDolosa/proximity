<?php
// qr proximity.php

require_once '../cnfg/config.php';

if (!isset($_SESSION['user_id'])) {
  header('Location: ../../index.php');
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
  <link rel="icon" href="../logo/nfc-logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../css/qp.css">
  <link rel="stylesheet" href="../css/sbar.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div class="side-bar" style="top: 0;">
    <div onclick="window.location.href='qr proximity.php';" class="side-btn">
      <div class="s-header">
        <h1>Proximity</h1>
      </div>
      <div class="s-search-section">
        <img src="../icon/nfc-icon.png" alt="NFC Icon">
        <div>
          <h3>Live Search</h3>
          <p>Web pass verifier application</p>
        </div>
      </div>
    </div>
    <div onclick="window.location.href='mamual input.php';" class="side-btn">
      <div class="s-header">
        <h1>Manual Entry</h1>
      </div>
      <div class="s-search-section">
        <img src="../logo/manual.png" alt="Manual Entry">
        <div>
          <h3>Employee Entry</h3>
          <p>This area is served for manual entry</p>
        </div>
      </div>
    </div>
    <version_compare style="z-index: 1000;">
      <p id="version"></p>
    </version_compare>
  </div>

  <div class="container">
    <h2>Live Search</h2>

    <div class="search-container">
      <input type="text" id="searchInput" autocomplete="off" autofocus >
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