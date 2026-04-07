<?php
// proximity.php --> proximity iframe for qr proximity.php

require_once 'config/config.php';
require_once 'config/db.php';

requireAccess('proximity', 'index.php');
$access = getMenuAccess();
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Proximity Pass</title>
  <link rel="preload" href="resource/assets/icon/database-icon.png" as="image">
  <link rel="icon" href="resource/assets/logo/nfc-logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="resource/css/qp.css">
  <link rel="stylesheet" href="resource/css/ptl.css">
  <link rel="stylesheet" href="resource/css/sbar.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <main class="main-content">
    <iframe src="app/http/controllers/qr proximity.php" class="sec-frames" frameborder="0" allowfullscreen="allowfullscreen"></iframe>
  </main>

  <div id="portalButton"></div>

  <script src="resource/js/btn.js"></script>
  <script src="resource/js/req.js"></script>
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