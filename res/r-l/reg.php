<?php
// register.php

require_once '../cnfg/config.php';

$errors = [];
$success = '';

// Check if user is already logged in
if (isset($_SESSION['user_id'])) {
  header('Location: ../../portal.php'); // or wherever logged-in users should go
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  // Get and sanitize input data
  $myDatabase = sanitizeInput($_POST['my_database'] ?? '');
  $username = sanitizeInput($_POST['username'] ?? '');
  $email = sanitizeInput($_POST['email'] ?? '');
  $password = $_POST['password'] ?? '';
  $confirm_password = $_POST['confirm_password'] ?? '';
  $first_name = sanitizeInput($_POST['first_name'] ?? '');
  $last_name = sanitizeInput($_POST['last_name'] ?? '');
  $phone = sanitizeInput($_POST['phone'] ?? '');

  // Enhanced validation with config.php functions
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

  // Check for existing username/email using config.php connection
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

  // If no errors, create user with database using config.php function
  if (empty($errors)) {
    $result = registerUser($username, $email, $password, $first_name, $last_name, $myDatabase, $phone);

    if ($result['success']) {
      $success = "Registration successful! Your personal database has been created. You can now login.";

      // Log the successful registration using config.php function
      logSystemAction(
        $result['user_id'],
        'USER_REGISTERED',
        'User registered with database: ' . USER_DB_PREFIX . $result['user_id']
      );

      // Clear form data on success
      $username = $email = $first_name = $last_name = $myDatabase = $phone = '';

      // // Optional: Auto-login the user after registration
      // // Uncomment the following lines if you want auto-login:

      // $_SESSION['user_id'] = $result['user_id'];
      // $_SESSION['username'] = $username;
      // $_SESSION['email'] = $email;
      // $_SESSION['first_name'] = $first_name;
      // $_SESSION['last_name'] = $last_name;
      // header('Location: ../../portal.php');
      // exit;

    } else {
      $errors = $result['errors'];
      // Log failed registration attempt
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Register</title>
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/r-l.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <version_compare style="z-index: 1000;">
    <p id="version"></p>
  </version_compare>

  <div class="container">
    <div class="header">
      <div><img src="../logo/database.png" alt="My Database Logo" class="logo"></div>
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

    <div class="login-link">
      Already have an account? <a href="../../index.php">Sign in here</a>
    </div>
  </div>

  <script src="../src/reg.js"></script>
  <script src="../src/req.js"></script>
  <script src="../src/ver.js"></script>
</body>

</html>