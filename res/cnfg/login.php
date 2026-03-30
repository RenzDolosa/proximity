<?php
// login.php - Handles user login logic

$errors = [];
$success = '';

// Redirect if already logged in
if (isset($_SESSION['user_id'])) {
  header('Location: portal.php');
  exit;
}

// Rate limiting - track login attempts
if (!isset($_SESSION['login_attempts'])) {
  $_SESSION['login_attempts'] = 0;
  $_SESSION['last_attempt'] = 0;
}

// Check if user is rate limited (5 attempts per 15 minutes)
$current_time = time();
if (
  isset($_SESSION['login_attempts'], $_SESSION['last_attempt']) &&
  $_SESSION['login_attempts'] >= 10 &&
  ($current_time - $_SESSION['last_attempt']) < 10
) {
  $errors[] = "Too many login attempts. Please try again in " .
    ceil((10 - ($current_time - $_SESSION['last_attempt'])) / 60) . " minutes.";
}

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST' && empty($errors)) {
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
        header('Location: portal.php');
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
