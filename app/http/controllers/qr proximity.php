<?php
// app/http/controller/qr proximity.php --> qr proximity scanner/viewer

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'qr proximity') && !canAccess($permissions, 'manual input') && !canAccess($permissions, 'facial')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) {
            window.top.history.back();
        } else {
            window.history.back();
        }
    </script></body></html>';
  exit;
}

requireAccess('qr proximity', ROUTE_MANUAL);
$access = getMenuAccess();

if (!isset($_SESSION['user_id'])) {
  header('Location:', ROUTE_LOGIN);
  exit();
}

// ── SECURITY: Generate a per-session CSRF token ──────────────────
if (empty($_SESSION['csrf_token'])) {
  $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

$csrfToken = $_SESSION['csrf_token'];

try {
  if (!$userId) throw new Exception("Not logged in");

  $userDb = getUserDBConnection($userId);

  $stmt = $userDb->prepare("SELECT * FROM employees ORDER BY fullname ASC");
  $stmt->execute();
  $employees = $stmt->fetchAll(PDO::FETCH_ASSOC);

  $employeesJson = json_encode($employees);
} catch (Exception $e) {
  error_log("Error loading employees: " . $e->getMessage());
  $employees = [];
  $employeesJson = json_encode([]);
}

?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Proximity pass</title>
  <meta name="csrf-token" content="<?php echo htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>">
  <link rel="icon" href="/config/asset.php?t=cfk4d" type="image/svg+xml">
  <link rel="stylesheet" href="/config/asset.php?t=zdsj4">
  <link rel="stylesheet" href="/config/asset.php?t=ht5sf">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <background>
    <div class="background-image" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; z-index: 0; pointer-events: none;">
      <img src="/config/asset.php?t=aur2d" loading="lazy" alt="Proximity Code" style="width: 50%; height: 100vh; object-fit: contain;">
    </div>
  </background>
  <div class="side-bar" style="top: 0;">
    <?php if ($access['qr proximity']): ?>
      <div data-action-dir="prox-proximity" class="side-btn">
        <div class="s-header">
          <h1>Proximity</h1>
        </div>
        <div class="s-search-section">
          <img src="/config/asset.php?t=gnks2" alt="NFC Icon" loading="lazy">
          <div>
            <h3>Live Search</h3>
            <p>Web pass verifier application</p>
          </div>
        </div>
      </div>
    <?php endif; ?>

    <?php if ($access['manual input']): ?>
      <div data-action-dir="prox-manual" class="side-btn">
        <div class="s-header">
          <h1>Manual Entry</h1>
        </div>
        <div class="s-search-section">
          <img src="/config/asset.php?t=t43us" alt="Manual Entry" loading="lazy">
          <div>
            <h3>Employee Entry</h3>
            <p>This area is served for manual entry</p>
          </div>
        </div>
      </div>
    <?php endif; ?>
    <version_compare>
      <p id="version"></p>
    </version_compare>
  </div>

  <div class="container">
    <h2 class="header">Live Search</h2>

    <div class="search-container">
      <input type="text" id="searchInput" autocomplete="off" autofocus inputmode="none" enterkeyhint="done">
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
  <script src="/config/route-config.php?page=proximity"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=xjf3w"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=m9n0o"></script>
</body>

</html>