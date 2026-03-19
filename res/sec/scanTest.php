<?php
// scanTest.php

require_once '../cnfg/config.php';
require_once '../cnfg/manpower_backend.php';
if (!isset($_SESSION['user_id'])) {
  header('Location: ../../login.php');
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
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Test QR Code</title>
  <link rel="icon" href="../icon/scanTest.png" type="image/png">
  <link rel="stylesheet" href="../css/qp.css">
  <link rel="stylesheet" href="../css/loading.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div onclick="window.location.href='../iframe/ptl.php';" style="position: fixed;
      top: 0;
      right: 1vmin;
      padding: 1vmin;
      z-index: 1000;
      cursor: pointer;
      color: red;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);">
    <i class="fas fa-times"></i>
  </div>

  <div class="container">
    <h2>Test Proximity Code Live Search</h2>

    <div class="search-container">
      <input type="text" id="searchInput" autofocus>
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
  <script src="../src/st.js"></script>
  <script src="../src/req.js"></script>
  <script src="../src/loading.js"></script>
</body>

</html>