<?php
// config/req.php --> portal access

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('main', ROUTE_QR_PROX);
$access = getMenuAccess();

$portalAccessGranted = isset($_SESSION['portal_access_granted']) && $_SESSION['portal_access_granted'] === true;
$userId    = $_SESSION['user_id'] ?? '';

if ($portalAccessGranted) {
  $isAdministrator = isset($_SESSION['user_group']) && $_SESSION['user_group'] === 'Administrator';

  if (!$isAdministrator) {
    $accessTime = $_SESSION['portal_access_time'] ?? 0;
    if (time() - $accessTime > 600) {
      unset($_SESSION['portal_access_granted']);
      unset($_SESSION['portal_access_time']);
      $portalAccessGranted = false;
      logSystemAction($userId, 'PORTAL_ACCESS_EXPIRED', 'Portal access expired');
    }
  }
}

function getCurrentUserPasswordHash($userId)
{
  try {
    $pdo = getMainDBConnection();
    $stmt = $pdo->prepare("SELECT password FROM users WHERE id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    return $user ? $user['password'] : null;
  } catch (PDOException $e) {
    error_log("Error fetching user password: " . $e->getMessage());
    return null;
  }
}

function isPortalSecure()
{
  return isset($_SESSION['portal_access_granted']) && $_SESSION['portal_access_granted'] === true;
}

function redirectToPortalIfNotSecure()
{
  if (!isPortalSecure()) {
    header('Location: ../portal.php');
    exit();
  }
}

if (isset($_POST['portal_password'])) {
  $submittedPassword = $_POST['portal_password'];

  $rateLimitKey = 'portal_attempts_' . $userId;
  $attempts = $_SESSION[$rateLimitKey] ?? 0;
  $lastAttempt = $_SESSION[$rateLimitKey . '_time'] ?? 0;

  if (time() - $lastAttempt > 10) {
    $attempts = 0;
  }

  if ($attempts >= 10) {
    $timeRemaining = 10 - (time() - $lastAttempt);
    if ($timeRemaining > 0) {
      logSystemAction($userId, 'PORTAL_ACCESS_BLOCKED', 'Too many failed attempts');
      $error = "Too many failed attempts. Please try again in " . ceil($timeRemaining / 60) . " minutes.";
    } else {
      $attempts = 0;
    }
  }

  if (!isset($error)) {
    $userPasswordHash = getCurrentUserPasswordHash($userId);

    if ($userPasswordHash === null) {
      logSystemAction($userId, 'PORTAL_ACCESS_ERROR', 'Failed to retrieve user password');
      $error = "System error. Please try again or contact support.";
    } else {
      if (password_verify($submittedPassword, $userPasswordHash)) {
        $_SESSION['portal_access_granted'] = true;
        $_SESSION['portal_access_time'] = time();
        unset($_SESSION[$rateLimitKey]);
        unset($_SESSION[$rateLimitKey . '_time']);
        logSystemAction($userId, 'PORTAL_ACCESS_GRANTED', 'Portal access granted using user password');
        header('Location: ../portal.php');
        exit();
      } else {
        $attempts++;
        $_SESSION[$rateLimitKey] = $attempts;
        $_SESSION[$rateLimitKey . '_time'] = time();
        logSystemAction($userId, 'PORTAL_ACCESS_DENIED', 'Invalid user password attempt');
        $error = "Incorrect password. Attempt $attempts of 10.";
      }
    }
  }
}

function maskEmail(string $email): string
{
  if (!str_contains($email, '@')) return $email;

  [$local, $domain] = explode('@', $email, 2);
  $len = strlen($local);

  if ($len <= 4) {
    $masked = $local[0] . str_repeat('*', max(1, $len - 1));
  } else {
    $masked = substr($local, 0, 2)
      . str_repeat('*', $len - 4)
      . substr($local, -2);
  }

  return $masked . '@' . $domain;
}

function maskUsername(string $name): string
{
  $len = strlen($name);

  if ($len <= 2) return $name[0] . '*';
  if ($len === 3) return $name[0] . '*' . $name[2];

  return $name[0]
    . str_repeat('*', $len - 2)
    . $name[$len - 1];
}

$firstName = $_SESSION['first_name'] ?? '';
$lastName  = $_SESSION['last_name'] ?? '';
$email     = $_SESSION['email'] ?? '';

if (!$portalAccessGranted) {
?>
  <!DOCTYPE html>
  <html lang="en">

  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portal Access</title>
    <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
    <link rel="stylesheet" href="/config/asset.php?t=f48sv">
    <link rel="stylesheet" href="/config/asset.php?t=c24hj">
    <link rel="stylesheet" href="/config/asset.php?t=ht5sf">
    <link rel="stylesheet" href="/config/asset.php?t=q5fwr">
    <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
      .error-alert {
        background: #fee;
        color: #c33;
        padding: 12px;
        border-radius: 8px;
        margin-bottom: 20px;
        border: 1px solid #fcc;
        display: <?= isset($error) ? 'block' : 'none' ?>;
      }
    </style>
  </head>

  <body>
    <!-- Loading Screen -->
    <div id="loading-screen">
      <div class="loading-content">
        <div class="spinner"></div>
        <div class="loading-text">Loading...</div>
        <div class="loading-subtext">Please wait while we prepare your content</div>
      </div>
    </div>

    <div class="side-bar" style="top: 0;">
      <?php if ($access['proximity']): ?>
        <div data-action-dir="require-proximity" class="side-btn">
          <div class="s-header">
            <h1>Proximity</h1>
          </div>
          <div class="s-search-section">
            <img src="/config/asset.php?t=gnks2" alt="NFC Icon" loading="lazy">
            <div>
              <h3>Live Search</h3>
              <p>Proximity verifier application</p>
            </div>
          </div>
        </div>
      <?php endif; ?>
      <?php if ($access['facial']): ?>
        <div data-action-dir="require-facial" class="side-btn">
          <div class="s-header">
            <h1>Face ID</h1>
          </div>
          <div class="s-search-section">
            <img src="/config/asset.php?t=g4ld2" alt="Face ID" loading="lazy">
            <div>
              <h3>Face Search</h3>
              <p>Facial verifier application</p>
            </div>
          </div>
        </div>
      <?php endif; ?>
      <?php if ($access['manual input']): ?>
        <div data-action-dir="require-manual" class="side-btn">
          <div class="s-header">
            <h1>Manual Entry</h1>
          </div>
          <div class="s-search-section">
            <img src="/config/asset.php?t=t43us" alt="Manual Entry" loading="lazy">
            <div>
              <h3>Manual Search</h3>
              <p>Manual verifier application</p>
            </div>
          </div>
        </div>
      <?php endif; ?>
      <version_compare style="z-index: 1000;">
        <p id="version"></p>
      </version_compare>
    </div>

    <div class="access-container">
      <span class="security-icon">🔐</span>
      <h1 class="access-title">Portal Access Required</h1>
      <p class="access-subtitle">Please enter the access password to continue to your portal</p>

      <div class="user-info">
        Logged in as: <strong><?= htmlspecialchars($firstName . ' ' . $lastName) ?></strong><br>
        Email: <?= htmlspecialchars(maskEmail($email)) ?>
      </div>

      <?php if (isset($error)): ?>
        <div class="error-alert"><?= htmlspecialchars($error) ?></div>
      <?php endif; ?>

      <form method="POST" class="access-form">
        <div class="password-input-wrapper">
          <input
            type="password"
            id="portal_password"
            name="portal_password"
            class="password-field"
            placeholder="Enter portal access password"
            autocomplete="current-password"
            autofocus
            <?= (isset($attempts) && $attempts >= 10) ? 'disabled' : '' ?>>
          <button type="button" class="toggle-pw-sub" tabindex="-1" id="togglePassword" aria-label="Toggle password visibility">
            <i class="fas fa-eye"></i>
          </button>
        </div>
        <button
          type="submit"
          class="btn-sub btn-primary" tabindex="-1"
          <?= (isset($attempts) && $attempts >= 10) ? 'disabled' : '' ?>>
          <?= (isset($attempts) && $attempts >= 10) ? 'Access Blocked' : 'Unlock Portal' ?>
        </button>
      </form>

      <p style="font-size: 12px; color: #999; margin-top: 20px;">
        Having trouble? <a href="?logout=1" style="color: #667eea;">Logout and try again</a>
      </p>
    </div>

    <script src="/config/route-config.php?page=require"></script>
    <script src="/config/asset.php?t=p1q2r"></script>
    <script src="/config/asset.php?t=j7k8l"></script>
    <script src="/config/asset.php?t=m9n0o"></script>
    <script src="/config/asset.php?t=oqw56"></script>
  </body>

  </html>
<?php
  exit();
}
?>