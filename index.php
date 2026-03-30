<?php
// index.php


require_once 'res/cnfg/config.php';
require_once 'res/cnfg/login.php';

if (isLoggedIn()) {
    header('Location: portal.php');
    exit;
}

$url = $_GET['url'] ?? 'home';
$url = rtrim($url, '/');

switch ($url) {
  case 'portal':
    include 'portal.php';
    break;
  case 'register':
    include 'reg.php';
    break;
  case 'proximity3pl':
    include 'proximity.php';
    break;
  default:
    // show home/dashboard
    break;
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- Security Headers -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; script-src 'self';">
  <meta http-equiv="X-Content-Type-Options" content="nosniff">
  <meta http-equiv="X-Frame-Options" content="DENY">
  <meta http-equiv="X-XSS-Protection" content="1; mode=block">
  <meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
  <title>Login</title>
  <link rel="preload" href="../icon/database-icon.png" as="image">
  <link rel="preload" href="../logo/database.svg" as="image">
  <link rel="icon" href="res/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="res/css/r-l.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <version_compare style="z-index: 1000;">
    <p id="version"></p>
  </version_compare>

  <div class="container">
    <div class="header">
      <div><img src="res/logo/database.svg" alt="My Database Logo" class="logo" loading="lazy"></div>
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
            class="password-toggle-btn"
            id="togglePassword"
            aria-label="Toggle password visibility">
            <i class="fas fa-eye"></i>
          </button>
        </div>
      </div>

      <button type="submit" class="btn" id="submitBtn">
        <span class="loading"></span>
        Sign In &amp; Access Database
      </button>
    </form>

    <div class="forgot-password">
      <a href="f-pass.php">Forgot your password?</a>
    </div>

    <div class="register-link">
      <!-- Don't have an account? <a href="reg.php">Create one here</a> -->
    </div>
  </div>

  <script src="res/src/li.js"></script>
  <script src="res/src/req.js"></script>
  <script src="res/src/ver.js"></script>
</body>

</html>