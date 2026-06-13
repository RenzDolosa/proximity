<?php
// app/http/controller/scan test.php --> qr proximity scanner tester

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('scanTest', ROUTE_HOME);
$access = getMenuAccess();

if (!isset($_SESSION['user_id'])) {
  header('Location:', ROUTE_LOGIN);
  exit();
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Test proximity code</title>
  <link rel="icon" href="/config/asset.php?t=asc4s" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=zdsj4">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <background>
    <div class="background-image" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; z-index: 0; pointer-events: none;">
      <img src="/config/asset.php?t=aur2d" loading="lazy" alt="Proximity Code" style="width: 50%; height: 100vh; object-fit: contain;">
    </div>
  </background>

  <div id="closeButton" class="close-button" tabindex="-1" role="button" aria-label="Close" onclick="window.history.back()">
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

  <audio id="successSound" data-fallback="/config/asset.php?t=ero67" preload="none"></audio>
  <audio id="checkoutSound" data-fallback="/config/asset.php?t=jg5df" preload="none"></audio>
  <audio id="noResultSound" data-fallback="/config/asset.php?t=sdh3f" preload="none"></audio>
  <audio id="warningSound" data-fallback="/config/asset.php?t=l45wd" preload="none"></audio>
  <audio id="inactiveSound" data-fallback="/config/asset.php?t=ert26" preload="none"></audio>

  <script src="https://cdn.jsdelivr.net/npm/qrcodejs/qrcode.min.js"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=aw4sa"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
</body>

</html>