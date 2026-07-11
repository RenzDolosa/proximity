<?php
// index.php --> main login

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/app/http/auth/login.php';

$page = $_GET['page'] ?? '';

// ── Dispatch page sub-views ────────────────────────────────────────────────
if ($page === 'forget') {
  include 'resource/views/f-pass.php';
  exit;
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; script-src 'self';">
  <meta http-equiv="X-XSS-Protection" content="1; mode=block">
  <meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
  <title>Login</title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=a1b2c">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <version_compare>
    <p id="version"></p>
  </version_compare>

  <div class="container">
    <div class="header">
      <div class="logo">
        <?php
        $svgPath = ROOT_PATH . '/resource/assets/logo/database.svg';
        if (file_exists($svgPath)) {
          echo file_get_contents($svgPath);
        }
        ?>
      </div>
      <h2>Proximity Data</h2>
      <p class="subtitle">Sign in to your Proximity Database</p>
    </div>

    <div class="database-status">
      <strong>🔐 Secure Access:</strong> Your personal database will be automatically verified and initialized upon login.
    </div>

    <?php if (!empty($errors)): ?>
      <div class="error" role="alert">
        <?php foreach ($errors as $error): ?>
          <div><?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?></div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if ($success): ?>
      <div class="success" role="alert">
        <?php echo htmlspecialchars($success, ENT_QUOTES, 'UTF-8'); ?>
      </div>
    <?php endif; ?>

    <form method="POST" action="" id="loginForm" autocomplete="on">
      <!-- CSRF Token -->
      <input type="hidden" name="csrf_token" value="<?php echo htmlspecialchars($_SESSION['csrf_token'], ENT_QUOTES, 'UTF-8'); ?>">

      <div class="form-group">
        <label for="username">Username or Email</label>
        <input type="text"
          id="username"
          name="username"
          value="<?php echo htmlspecialchars($username ?? '', ENT_QUOTES, 'UTF-8'); ?>"
          placeholder="Enter your username or email"
          maxlength="255"
          autocomplete="username">
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <div class="password-input-wrapper">
          <input type="password"
            id="password"
            name="password"
            class="password-field"
            placeholder="Enter your password"
            maxlength="255"
            autocomplete="current-password">
          <button type="button"
            class="toggle-pw-sub"
            id="togglePassword"
            tabindex="-1"
            aria-label="Toggle password visibility">
            <i class="fas fa-eye"></i>
          </button>
        </div>
      </div>

      <button type="submit" class="btn-sub btn-primary" tabindex="-1" id="submitBtn">
        <span class="loading"></span>
        Sign In &amp; Access Database
      </button>
    </form>

    <div class="forgot-password">
      <a data-action-root="forget">Forgot your password?</a>
    </div>

    <div class="register-link">
      <!-- Don't have an account? <a href="#">Create one here</a> -->
    </div>
  </div>

  <script src="/config/route-config.php?page=login"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=g5h6i"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=m9n0o"></script>
</body>

</html>