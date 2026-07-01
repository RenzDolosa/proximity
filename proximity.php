<?php
// proximity.php --> proximity iframe for qr proximity.php

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('proximity', $_SERVER['DOCUMENT_ROOT'] . ROUTE_LOGIN);
$access = getMenuAccess();

$page = $_GET['page'] ?? '';

$canQr     = $access['qr proximity']  ?? false;
$canManual = $access['manual input']  ?? false;
$canFacial = $access['facial']        ?? false;

// ── Resolve iframe src ────────────────────────────────────────────────────────
if ($page === 'facial-identification' && $canFacial) {
  $iframeSrc = 'app/services/facial-identification.php';
} elseif ($page === 'qr proximity' && $canQr) {
  $iframeSrc = 'app/http/controllers/qr proximity.php';
} elseif ($page === 'manual input' && $canManual) {
  $iframeSrc = 'app/http/controllers/manual input.php';
} elseif ($canQr) {
  $iframeSrc = 'app/http/controllers/qr proximity.php';
} elseif ($canManual) {
  $iframeSrc = 'app/http/controllers/manual input.php';
} elseif ($canFacial) {
  $iframeSrc = 'app/services/facial-identification.php';
} else {
  header('Location:', ROUTE_LOGIN);
  exit;
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Proximity pass</title>
  <link rel="icon" href="/config/asset.php?t=cfk4d" type="image/svg+xml">
  <link rel="stylesheet" href="/config/asset.php?t=zdsj4">
  <link rel="stylesheet" href="/config/asset.php?t=mq4wc">
  <link rel="stylesheet" href="/config/asset.php?t=ht5sf">
  <link rel="stylesheet" href="/config/asset.php?t=fg6r2">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <main class="main-content">
    <iframe src="<?= htmlspecialchars($iframeSrc) ?>" class="sec-frames" frameborder="0" allowfullscreen="allowfullscreen"></iframe>
  </main>

  <div id="portalButton"></div>

  <script src="/config/route-config.php?page=proximity"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=dsf23"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script>
    const _loginRoute = <?= json_encode(ROUTE_LOGIN) ?>;
    const mainFrame = document.querySelector('.sec-frames');
    if (mainFrame) {
      mainFrame.addEventListener('load', function() {
        try {
          const frameUrl = this.contentWindow.location.href;
          if (frameUrl.includes(_loginRoute) || frameUrl.includes('login')) {
            window.top.location.href = frameUrl;
          }
        } catch (e) {
          window.top.location.href = _loginRoute;
        }
      });
    }
  </script>
</body>

</html>