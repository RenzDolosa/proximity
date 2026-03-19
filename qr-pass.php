<?php
// portal.php - Modified security section to use current user's password

require_once 'res/cnfg/config.php';
require_once 'res/cnfg/db.php';


?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - QR Pass</title>
  <link rel="icon" href="res/logo/nfc-logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="res/css/qp.css">
  <link rel="stylesheet" href="res/css/ptl.css">
  <link rel="stylesheet" href="res/css/sbar.css">
</head>

<body>

  <div class="side-bar" style="top: 0;">
    <div onclick="window.location.href='res/sec/qr.php';" class="side-btn">
      <div class="s-header">
        <h1>QR Pass</h1>
      </div>
      <div class="s-search-section">
        <img src="res/logo/nfc-logo.svg" alt="QR Pass Icon">
        <div>
          <h3>Live Search</h3>
          <p>Web pass verifier application</p>
        </div>
      </div>
    </div>
    <div onclick="window.location.href='res/sec/m-i.php';" class="side-btn">
      <div class="s-header">
        <h1>Manual Entry</h1>
      </div>
      <div class="s-search-section">
        <img src="res/logo/manual.png" alt="Manual Entry">
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

  <main class="main-content">
    <iframe src="res/sec/qr.php" class="sec-frames" frameborder="0" allowfullscreen="allowfullscreen"></iframe>
  </main>

  <script src="res/src/req.js"></script>
</body>

</html>