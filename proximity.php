<?php
// portal.php - Modified security section to use current user's password

require_once 'res/cnfg/config.php';
require_once 'res/cnfg/db.php';


?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Proximity Pass</title>
  <link rel="icon" href="res/logo/nfc-logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="res/css/qp.css">
  <link rel="stylesheet" href="res/css/ptl.css">
  <link rel="stylesheet" href="res/css/sbar.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <main class="main-content">
    <iframe src="res/sec/qr.php" class="sec-frames" frameborder="0" allowfullscreen="allowfullscreen"></iframe>
  </main>

  <div id="portalButton"></div>

  <script src="res/src/btn.js"></script>
  <script src="res/src/req.js"></script>
</body>

</html>