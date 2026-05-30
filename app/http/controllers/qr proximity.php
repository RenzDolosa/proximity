<?php
// app/http/controller/qr proximity.php --> qr proximity scanner/viewer

require_once __DIR__ . '/../../../config/config.php';
require_once __DIR__ . '/../../../config/db.php';

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

requireAccess('qr proximity', 'manual input.php');
$access = getMenuAccess();

$myDatabase = $_SESSION['my_database'] ?? 'My Database';
$userId = $_SESSION['user_id'] ?? null;
$userDbName = USER_DB_PREFIX . $userId;
$username = $_SESSION['username'] ?? 'User';
$email = $_SESSION['email'] ?? '';

if (!isset($_SESSION['user_id'])) {
  header('Location: ../../../index.php');
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
  <title><?php echo htmlspecialchars($myDatabase); ?> - Proximity Pass</title>

  <meta name="csrf-token" content="<?php echo htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8'); ?>">

  <link rel="preload" href="../../../resource/assets/logo/nfc-logo.svg" as="image/svg+xml">
  <link rel="preload" href="../../../resource/assets/logo/proximity-logo.svg" type="image/svg+xml">
  <link rel="icon" href="../../../resource/assets/logo/nfc-logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../../../resource/css/qp.css">
  <link rel="stylesheet" href="../../../resource/css/sbar.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <background>
    <div class="background-image" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; z-index: 0; pointer-events: none;">
      <img src="../../../resource/assets/logo/proximity-logo.svg" loading="lazy" alt="Proximity Code" style="width: 50%; height: 100vh; object-fit: contain;">
    </div>
  </background>
  <div class="side-bar" style="top: 0;">
    <?php if ($access['qr proximity']): ?>
      <div onclick="window.location.href='qr proximity.php';" class="side-btn">
        <div class="s-header">
          <h1>Proximity</h1>
        </div>
        <div class="s-search-section">
          <img src="../../../resource/assets/icon/nfc-icon.svg" alt="NFC Icon" loading="lazy">
          <div>
            <h3>Live Search</h3>
            <p>Web pass verifier application</p>
          </div>
        </div>
      </div>
    <?php endif; ?>

    <?php if ($access['manual input']): ?>
      <div onclick="window.location.href='manual input.php';" class="side-btn">
        <div class="s-header">
          <h1>Manual Entry</h1>
        </div>
        <div class="s-search-section">
          <img src="../../../resource/assets/logo/manual.svg" alt="Manual Entry" loading="lazy">
          <div>
            <h3>Employee Entry</h3>
            <p>This area is served for manual entry</p>
          </div>
        </div>
      </div>
    <?php endif; ?>
    <version_compare style="z-index: 1000;">
      <p id="version"></p>
    </version_compare>
  </div>

  <div class="container">
    <h2 style="position: fixed; top: 2%; left: 0; width: 100%; height: 100%; display: flex; justify-content: center; z-index: 0; pointer-events: none;">Live Search</h2>

    <div class="search-container">
      <input type="text" id="searchInput" autocomplete="off" autofocus>
    </div>

    <div id="resultsTable" style="display: none;">
      <div class="result" id="resultsBody"></div>
    </div>
    <div id="message"></div>
  </div>

  <audio id="successSound" data-fallback="../../../resource/assets/sounds/success.mp3" preload="none"></audio>
  <audio id="checkoutSound" data-fallback="../../../resource/assets/sounds/checkout.mp3" preload="none"></audio>
  <audio id="noResultSound" data-fallback="../../../resource/assets/sounds/noResultsFound.mp3" preload="none"></audio>
  <audio id="warningSound" data-fallback="../../../resource/assets/sounds/ohh-ow.mp3" preload="none"></audio>
  <audio id="inactiveSound" data-fallback="../../../resource/assets/sounds/inactive.mp3" preload="none"></audio>

  <script src="https://cdn.jsdelivr.net/npm/qrcodejs/qrcode.min.js"></script>
  <script src="../../../resource/js/qp.js"></script>
  <script src="../../../resource/js/req.js"></script>
  <script src="../../../resource/js/ver.js"></script>
</body>

</html>