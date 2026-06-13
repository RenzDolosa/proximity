<?php
// resource/views/reg.php --> register

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('register', ROUTE_LOGIN);
$access = getMenuAccess();

$errors = [];
$success = '';

// ── Auth guard ────────────────────────────────────────────────────────────────
if (($_SESSION['user_group'] ?? '') !== 'Administrator') {
  echo '<script>history.back();</script>';
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $myDatabase = sanitizeInput($_POST['my_database'] ?? '');
  $username = sanitizeInput($_POST['username'] ?? '');
  $email = sanitizeInput($_POST['email'] ?? '');
  $password = $_POST['password'] ?? '';
  $confirm_password = $_POST['confirm_password'] ?? '';
  $first_name = sanitizeInput($_POST['first_name'] ?? '');
  $last_name = sanitizeInput($_POST['last_name'] ?? '');
  $phone = sanitizeInput($_POST['phone'] ?? '');
  $user_group = sanitizeInput($_POST['user_group'] ?? '');

  if (empty($username)) {
    $errors[] = "Username is required.";
  } elseif (strlen($username) < 3) {
    $errors[] = "Username must be at least 3 characters long.";
  } elseif (strlen($username) > 50) {
    $errors[] = "Username must be less than 50 characters.";
  }

  if (empty($email)) {
    $errors[] = "Email is required.";
  } elseif (!isValidEmail($email)) {
    $errors[] = "Please enter a valid email address.";
  }

  if (empty($first_name)) {
    $errors[] = "First name is required.";
  }

  if (empty($last_name)) {
    $errors[] = "Last name is required.";
  }

  if (empty($password)) {
    $errors[] = "Password is required.";
  } elseif (!isValidPassword($password)) {
    $errors[] = "Password must be at least 8 characters and contain uppercase, lowercase, and number.";
  }

  if ($password !== $confirm_password) {
    $errors[] = "Passwords do not match.";
  }

  if (empty($errors)) {
    try {
      $pdo = getMainDBConnection();
      $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = ? OR email = ?");
      $stmt->execute([$username, $email]);

      if ($stmt->fetchColumn() > 0) {
        $errors[] = "Username or email already exists.";
      }
    } catch (PDOException $e) {
      error_log("Database check error: " . $e->getMessage());
      $errors[] = "Database error occurred. Please try again.";
    }
  }

  if (empty($errors)) {
    $result = registerUser($username, $email, $password, $first_name, $last_name, $myDatabase, $phone, $user_group);

    if ($result['success']) {
      $success = "Registration successful! Your personal database has been created. You can now login.";

      // Log the successful registration using config.php function
      // logSystemAction(
      //   $result['user_id'],
      //   'USER_REGISTERED',
      //   'User registered with database: ' . USER_DB_PREFIX . $result['user_id']
      // );

      $username = $email = $first_name = $last_name = $myDatabase = $phone = $user_group = '';

      exit;
    } else {
      $errors = $result['errors'];
      logSystemAction(
        null,
        'REGISTRATION_FAILED',
        'Failed registration attempt for username: ' . $username . ' - ' . implode(', ', $result['errors'])
      );
    }
  }
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Register</title>
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

  <div id="closeButton" class="close-button" role="button" tabindex="0" aria-label="Close"
    data-action-dir="register">
    <i class="fas fa-times"></i>
  </div>

  <div class="container">
    <div class="header">
      <div><img src="/config/asset.php?t=v5w6x" alt="My Database Logo" class="logo" loading="lazy"></div>
      <h2>Create Your Account</h2>
      <p class="subtitle">Sign up to Proximity Database</p>
    </div>

    <div class="database-info">
      <strong>🗄️ Personal Database:</strong> A private database will be automatically created for you to store your
      employee data securely.
    </div>

    <?php if (!empty($errors)): ?>
      <div class="error">
        <?php foreach ($errors as $error): ?>
          <div><?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?></div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if ($success): ?>
      <div class="success"><?php echo htmlspecialchars($success, ENT_QUOTES, 'UTF-8'); ?></div>
    <?php endif; ?>

    <form method="POST" action="" id="registerForm">
      <div class="form-group">
        <label for="my_database">Create Database Name<span style="color: #ff6b6b;">*</span></label>
        <input type="text" id="my_database" name="my_database" value="<?php echo htmlspecialchars($myDatabase ?? '', ENT_QUOTES, 'UTF-8'); ?>"
          placeholder="Choose a unique Database Name">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="first_name">First Name <span style="color: #ff6b6b;">*</span></label>
          <input type="text" id="first_name" name="first_name"
            value="<?php echo htmlspecialchars($first_name ?? '', ENT_QUOTES, 'UTF-8'); ?>">
        </div>

        <div class="form-group">
          <label for="last_name">Last Name <span style="color: #ff6b6b;">*</span></label>
          <input type="text" id="last_name" name="last_name" value="<?php echo htmlspecialchars($last_name ?? '', ENT_QUOTES, 'UTF-8'); ?>">
        </div>
      </div>

      <div class="form-group">
        <label for="username">Username <span style="color: #ff6b6b;">*</span></label>
        <input type="text" id="username" name="username" value="<?php echo htmlspecialchars($username ?? '', ENT_QUOTES, 'UTF-8'); ?>"
          placeholder="Choose a unique username">
      </div>

      <div class="form-group">
        <label for="email">Email Address <span style="color: #ff6b6b;">*</span></label>
        <input type="email" id="email" name="email" value="<?php echo htmlspecialchars($email ?? '', ENT_QUOTES, 'UTF-8'); ?>"
          placeholder="your.email@example.com">
      </div>

      <div class="form-group">
        <label for="phone">Phone Number</label>
        <input type="tel" id="phone" name="phone" value="<?php echo htmlspecialchars($phone ?? '', ENT_QUOTES, 'UTF-8'); ?>"
          placeholder="+63 912 345 6789">
      </div>

      <div class="form-row">
        <div class="form-group">
          <label for="password">Password <span style="color: #ff6b6b;">*</span></label>
          <div class="password-input-wrapper">
            <input type="password" id="password" name="password" placeholder="Minimum 8 characters">
            <button type="button" class="password-toggle-btn" aria-label="Toggle password visibility">
              <i class="fas fa-eye"></i>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label for="confirm_password">Confirm Password <span style="color: #ff6b6b;">*</span></label>
          <div class="password-input-wrapper">
            <input type="password" id="confirm_password" name="confirm_password" placeholder="Re-enter your password">
            <button type="button" class="password-toggle-btn" aria-label="Toggle password visibility">
              <i class="fas fa-eye"></i>
            </button>
          </div>
        </div>
      </div>

      <button type="submit" class="btn" id="submitBtn">
        <span class="loading"></span>
        Create Account
      </button>
    </form>

    <!-- <div class="login-link">
      Already have an account? <a href="#">Sign in here</a>
    </div> -->
  </div>

  <script>
    const closeBtn = document.getElementById('closeButton')

    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape" && closeBtn) {
        window.location = "/iframe/main.php";
      }
    });

    const portalBtn = document.getElementById('portalButton');

    document.addEventListener("keydown", function(e) {
      if (e.ctrlKey && e.shiftKey && e.altKey && e.key === "P" && portalBtn) {
        window.location.href = "portal.php";
      }
    });
  </script>
  <script src="/config/route-config.php?page=login"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=zgq2a"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=m9n0o"></script>
</body>

</html>