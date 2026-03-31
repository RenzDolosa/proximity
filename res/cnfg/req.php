<?php
// req.php - Modified security section to use current user's password

require_once 'res/cnfg/config.php';
require_once 'res/cnfg/db.php';

requireAccess('request', 'index.php');

$portalAccessGranted = isset($_SESSION['portal_access_granted']) && $_SESSION['portal_access_granted'] === true;

if ($portalAccessGranted) {
  $isAdministrator = isset($_SESSION['user_group']) && $_SESSION['user_group'] === 'Administrator';

  if (!$isAdministrator) {
    $accessTime = $_SESSION['portal_access_time'] ?? 0;
    if (time() - $accessTime > 60) { // 1 minutes
      unset($_SESSION['portal_access_granted']);
      unset($_SESSION['portal_access_time']);
      $portalAccessGranted = false;
      logSystemAction($userId, 'PORTAL_ACCESS_EXPIRED', 'Portal access expired');
    }
  }
}

// Function to get current user's password hash from database
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

// Function to check if portal is secure from other pages
function isPortalSecure()
{
  return isset($_SESSION['portal_access_granted']) && $_SESSION['portal_access_granted'] === true;
}

// Function to redirect to portal if not secure (call this from other pages)
function redirectToPortalIfNotSecure()
{
  if (!isPortalSecure()) {
    header('Location: ../../portal.php');
    exit();
  }
}

// Handle portal password verification using current user's password
if (isset($_POST['portal_password'])) {
  $submittedPassword = $_POST['portal_password'];

  // Add rate limiting to prevent brute force
  $rateLimitKey = 'portal_attempts_' . $userId;
  $attempts = $_SESSION[$rateLimitKey] ?? 0;
  $lastAttempt = $_SESSION[$rateLimitKey . '_time'] ?? 0;

  // Reset attempts if more than 5 minutes passed
  if (time() - $lastAttempt > 10) {
    $attempts = 0;
  }

  // Check if too many attempts
  if ($attempts >= 10) {
    $timeRemaining = 10 - (time() - $lastAttempt);
    if ($timeRemaining > 0) {
      logSystemAction($userId, 'PORTAL_ACCESS_BLOCKED', 'Too many failed attempts');
      $error = "Too many failed attempts. Please try again in " . ceil($timeRemaining / 60) . " minutes.";
    } else {
      $attempts = 0; // Reset if cooldown period passed
    }
  }

  if (!isset($error)) {
    // Get current user's password hash from database
    $userPasswordHash = getCurrentUserPasswordHash($userId);

    if ($userPasswordHash === null) {
      logSystemAction($userId, 'PORTAL_ACCESS_ERROR', 'Failed to retrieve user password');
      $error = "System error. Please try again or contact support.";
    } else {
      // Verify password against user's actual password
      if (password_verify($submittedPassword, $userPasswordHash)) {
        $_SESSION['portal_access_granted'] = true;
        $_SESSION['portal_access_time'] = time();
        unset($_SESSION[$rateLimitKey]); // Clear failed attempts
        unset($_SESSION[$rateLimitKey . '_time']);
        logSystemAction($userId, 'PORTAL_ACCESS_GRANTED', 'Portal access granted using user password');
        header('Location: ../../portal.php'); // Redirect to prevent form resubmission
        exit();
      } else {
        $attempts++;
        $_SESSION[$rateLimitKey] = $attempts;
        $_SESSION[$rateLimitKey . '_time'] = time();
        logSystemAction($userId, 'PORTAL_ACCESS_DENIED', 'Invalid user password attempt');
        $error = "Incorrect password. Attempt $attempts of 5.";
      }
    }
  }
}

// SECURITY: If portal access not granted, show password form and stop execution
if (!$portalAccessGranted) {
?>
  <!DOCTYPE html>
  <html lang="en">

  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Portal Access</title>
    <link rel="preload" href="../icon/database-icon.png" as="image">
    <link rel="icon" href="res/icon/database-icon.png" type="image/png">
    <link rel="stylesheet" href="res/css/req.css">
    <link rel="stylesheet" href="res/css/sbar.css">
    <link rel="stylesheet" href="res/css/loading.css">
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
      <div onclick="window.location.href='proximity.php';" class="side-btn">
        <div class="s-header">
          <h1>Proximity</h1>
        </div>
        <div class="s-search-section">
          <img src="res/icon/nfc-icon.png" alt="NFC Icon" loading="lazy">
          <div>
            <h3>Live Search</h3>
            <p>Web pass verifier application</p>
          </div>
        </div>
      </div>
      <version_compare style="z-index: 1000;">
        <p id="version"></p>
      </version_compare>
    </div>

    <div class="access-container">
      <span class="security-icon">🔐</span>
      <h1 class="access-title">Portal Access Required</h1>
      <p class="access-subtitle">Please enter the access password to continue to your portal</p>

      <div class="user-info">
        Logged in as: <strong><?= htmlspecialchars($username) ?></strong><br>
        Email: <?= htmlspecialchars($email) ?>
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
            <?= (isset($attempts) && $attempts >= 5) ? 'disabled' : '' ?>>
          <button type="button" class="password-toggle-btn" id="togglePassword" aria-label="Toggle password visibility">
            <i class="fas fa-eye"></i>
          </button>
        </div>
        <button
          type="submit"
          class="unlock-button"
          <?= (isset($attempts) && $attempts >= 5) ? 'disabled' : '' ?>>
          <?= (isset($attempts) && $attempts >= 5) ? 'Access Blocked' : 'Unlock Portal' ?>
        </button>
      </form>

      <p style="font-size: 12px; color: #999; margin-top: 20px;">
        Having trouble? <a href="?logout=1" style="color: #667eea;">Logout and try again</a>
      </p>
    </div>

    <script src="res/src/req.js"></script>
    <script src="res/src/ver.js"></script>
    <script src="res/src/loading.js"></script>
  </body>

  </html>
<?php
  exit(); // CRITICAL: Stop execution here if not authenticated
}
?>