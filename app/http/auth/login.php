<?php
// app/http/auth/login.php --> login logic

$errors = [];
$success = '';

// ── Generate CSRF token FIRST ──────────────────────────────────────────
if (empty($_SESSION['csrf_token'])) {
  $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
}

// ── Already logged in ──────────────────────────────────────────────────
if (isset($_SESSION['user_id'])) {
  header('Location: portal.php');
  exit;
}

// ── Rate limiting (5 attempts per 3 minutes) ──────────────────────────
if (!isset($_SESSION['login_attempts'])) {
  $_SESSION['login_attempts'] = 0;
  $_SESSION['last_attempt']   = 0;
}

$current_time    = time();
$lockout_seconds = 3 * 60; // 3 minutes
$max_attempts    = 10;

if (
  $_SESSION['login_attempts'] >= $max_attempts &&
  ($current_time - $_SESSION['last_attempt']) < $lockout_seconds
) {
  $remaining = $lockout_seconds - ($current_time - $_SESSION['last_attempt']);
  $errors[]  = "Too many login attempts. Please try again in " .
    ceil($remaining / 60) . " minute(s).";
}

// ── Handle POST ────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && empty($errors)) {

  $submitted_token = $_POST['csrf_token'] ?? '';
  if (
    empty($submitted_token) ||
    !isset($_SESSION['csrf_token']) ||
    !hash_equals($_SESSION['csrf_token'], $submitted_token)
  ) {
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    $errors[] = "Your session expired. Please try again.";

  } else {

    $_SESSION['login_attempts']++;
    $_SESSION['last_attempt'] = $current_time;

    $username = sanitizeInput(trim($_POST['username'] ?? ''));
    $password = $_POST['password'] ?? '';

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

    if (!empty($username) && str_contains($username, '@')) {
      if (!filter_var($username, FILTER_VALIDATE_EMAIL)) {
        $errors[] = "Please enter a valid email address.";
      }
    }

    if (empty($errors)) {
      $result = loginUser($username, $password);

      if ($result['success']) {
        $_SESSION['login_attempts'] = 0;
        unset($_SESSION['last_attempt']);

        if (!isset($_SESSION['user_id']) && isset($result['user_id'])) {
          $_SESSION['user_id'] = $result['user_id'];
        }

        session_regenerate_id(true);
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        $ip         = $_SERVER['REMOTE_ADDR']     ?? 'Unknown';
        $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown';
        logSystemAction(
          $_SESSION['user_id'],
          'USER_LOGIN',
          "User logged in"
        );

        header('Location: portal.php');
        exit;

      } else {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        $ip         = $_SERVER['REMOTE_ADDR']     ?? 'Unknown';
        $user_agent = $_SERVER['HTTP_USER_AGENT'] ?? 'Unknown';
        logSystemAction(
          null,
          'LOGIN_FAILED',
          "Failed login. IP: $ip, UA: " . substr($user_agent, 0, 100)
        );

        $errors[] = "Invalid username/email or password.";
      }
    }
  }
}