<?php
// index.php

// Start session with secure settings
if (session_status() === PHP_SESSION_NONE) {
  // Set secure session parameters
  ini_set('session.cookie_httponly', 1);
  ini_set('session.cookie_secure', 1);
  ini_set('session.use_strict_mode', 1);
  session_start();
}

require_once 'res/cnfg/config.php';

$errors = [];
$success = '';

// Redirect if already logged in
if (isset($_SESSION['user_id'])) {
  header('Location: qr-pass.php');
  exit;
}

// Rate limiting - track login attempts
if (!isset($_SESSION['login_attempts'])) {
  $_SESSION['login_attempts'] = 0;
  $_SESSION['last_attempt'] = 0;
}

// Check if user is rate limited (5 attempts per 15 minutes)
$current_time = time();
if ($_SESSION['login_attempts'] >= 10 && ($current_time - $_SESSION['last_attempt']) < 10) {
  $errors[] = "Too many login attempts. Please try again in " .
    ceil((10 - ($current_time - $_SESSION['last_attempt'])) / 60) . " minutes.";
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && empty($errors)) {
  // CSRF Protection
  if (!isset($_POST['csrf_token']) || !hash_equals($_SESSION['csrf_token'], $_POST['csrf_token'])) {
    $errors[] = "Invalid request. Please try again.";
  } else {
    // Increment login attempt counter
    $_SESSION['login_attempts']++;
    $_SESSION['last_attempt'] = $current_time;

    $username = sanitizeInput(trim($_POST['username'] ?? ''));
    $password = $_POST['password'] ?? '';

    // Input validation with length limits
    if (empty($username)) {
      $errors[] = "Username or email is required.";
    } elseif (strlen($username) > 255) {
      $errors[] = "Username or email is too long.";
    }

    if (empty($password)) {
      $errors[] = "Password is required.";
    } elseif (strlen($password) > 255) {
      $errors[] = "Password is too long.";
    }

    // Additional validation for email format if it contains @
    if (!empty($username) && strpos($username, '@') !== false) {
      if (!filter_var($username, FILTER_VALIDATE_EMAIL)) {
        $errors[] = "Please enter a valid email address.";
      }
    }

    // If no errors, attempt login
    if (empty($errors)) {
      $result = loginUser($username, $password);

      if ($result['success']) {
        // Reset login attempts on successful login
        $_SESSION['login_attempts'] = 0;
        unset($_SESSION['last_attempt']);

        // Regenerate session ID to prevent session fixation
        session_regenerate_id(true);

        // Set user session if not done inside loginUser()
        if (!isset($_SESSION['user_id']) && isset($result['user_id'])) {
          $_SESSION['user_id'] = $result['user_id'];
        }

        // Log successful login with user agent and IP
        $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown';
        $ip_address = $_SERVER['REMOTE_ADDR'] ?? 'Unknown';
        logSystemAction(
          $_SESSION['user_id'],
          'USER_LOGIN',
          "User logged in successfully. IP: $ip_address, User-Agent: " . substr($user_agent, 0, 100)
        );

        // Redirect to dashboard
        header('Location: qr-pass.php');
        exit;
      } else {
        $errors = $result['errors'] ?? ['Invalid username/email or password.'];

        // Log failed login attempt with more details but don't reveal if user exists
        $ip_address = $_SERVER['REMOTE_ADDR'] ?? 'Unknown';
        $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown';
        logSystemAction(
          null,
          'LOGIN_FAILED',
          "Failed login attempt. IP: $ip_address, User-Agent: " . substr($user_agent, 0, 100)
        );

        // Generic error message to prevent username enumeration
        $errors = ['Invalid username/email or password.'];
      }
    }
  }
}

// Generate CSRF token
if (!isset($_SESSION['csrf_token'])) {
  $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login</title>
  <link rel="icon" href="res/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="res/css/r-l.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">

  <!-- Security Headers -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' https://cdnjs.cloudflare.com; font-src 'self' https://cdnjs.cloudflare.com; script-src 'self';">
  <meta http-equiv="X-Content-Type-Options" content="nosniff">
  <meta http-equiv="X-Frame-Options" content="DENY">
  <meta http-equiv="X-XSS-Protection" content="1; mode=block">
  <meta http-equiv="Referrer-Policy" content="strict-origin-when-cross-origin">
</head>

<body>

  <version_compare style="z-index: 1000;">
    <p id="version"></p>
  </version_compare>

  <div class="container">
    <div class="header">
      <div><img src="res/logo/database.png" alt="My Database Logo" class="logo"></div>
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
      Don't have an account? <a href="reg.php">Create one here</a>
    </div>
  </div>

  <script src="res/src/li.js"></script>
  <script src="res/src/req.js"></script>
  <script src="res/src/ver.js"></script>
</body>

</html>