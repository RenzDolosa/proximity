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
  <link rel="icon" href="res/icon/scan-icon.png" type="image/png">
  <link rel="stylesheet" href="res/css/qp.css">
  <link rel="stylesheet" href="res/css/ptl.css">
  <link rel="stylesheet" href="res/css/sbar.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</head>

<body>

  <main class="main-content">
    <iframe src="res/sec/qr.php" class="sec-frames" frameborder="0" allowfullscreen="allowfullscreen"></iframe>
  </main>

  <script src="res/src/req.js"></script>
</body>

</html>