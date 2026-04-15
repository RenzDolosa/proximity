<?php
// app/http/controller/scan test.php --> qr proximity scanner tester

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

require_once __DIR__ . '/../../../config/config.php';
require_once __DIR__ . '/../../../config/db.php';

requireAccess('scan test', '../../../resource/views/iframe/main.php');
$access = getMenuAccess();

if (!isset($_SESSION['user_id'])) {
  header('Location: ../../../index.php');
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
  <title><?php echo htmlspecialchars($myDatabase); ?> - Test QR Code</title>
  <link rel="preload" href="../../../resource/assets/icon/scanTest.png" as="image">
  <link rel="preload" href="../../../resource/assets/logo/proximitycode.svg" as="image/svg+xml">
  <link rel="icon" href="../../../resource/assets/icon/scanTest.png" type="image/png">
  <link rel="stylesheet" href="../../../resource/css/qp.css">
  <link rel="stylesheet" href="../../../resource/css/btn.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <background>
    <div class="background-image" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; z-index: 0; pointer-events: none;">
      <img src="../../../resource/assets/logo/proximity-logo.svg" loading="lazy" alt="Proximity Code" style="width: 45%; height: 90vh; object-fit: contain;">
    </div>
  </background>

  <div id="closeButton" class="close-button" role="button" tabindex="0" aria-label="Close" onclick="window.history.back()">
    <i class="fas fa-times"></i>
  </div>

  <div class="container">
    <h2 style="position: fixed; top: 2%; left: 0; width: 100%; height: 100%; display: flex; justify-content: center; z-index: 0; pointer-events: none;">Test Proximity Code Live Search</h2>

    <div class="search-container">
      <input type="text" id="searchInput" autocomplete="off" autofocus>
    </div>

    <div id="resultsTable" style="display: none;">
      <div class="result" id="resultsBody"></div>
    </div>
    <div id="message"></div>
  </div>

  <audio id="successSound" data-fallback="../../../resource/assets/sounds/success.mp3" preload="none"></audio>
  <audio id="noResultSound" data-fallback="../../../resource/assets/sounds/noResultsFound.mp3" preload="none"></audio>
  <audio id="warningSound" data-fallback="../../../resource/assets/sounds/ohh-ow.mp3" preload="none"></audio>
  <audio id="inactiveSound" data-fallback="../../../resource/assets/sounds/inactive.mp3" preload="none"></audio>
  <script src="https://cdn.jsdelivr.net/npm/qrcodejs/qrcode.min.js"></script>
  <script src="../../../resource/js/st.js"></script>
  <script src="../../../resource/js/btn.js"></script>
  <script src="../../../resource/js/req.js"></script>
</body>

</html>