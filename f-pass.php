<?php
// f-pass.php

require_once 'res/cnfg/config.php';
require_once 'res/cnfg/db.php';

// Redirect if already logged in
if (isset($_SESSION['user_id'])) {
  header('Location: portal.php');
  exit();
}

$errors = [];
$success = '';
$email = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $email = sanitizeInput($_POST['email'] ?? '');

  // Validation
  if (empty($email)) {
    $errors[] = "Email is required.";
  } elseif (!isValidEmail($email)) {
    $errors[] = "Please enter a valid email address.";
  }

  if (empty($errors)) {
    try {
      $pdo = getDBConnection();

      // Check if email exists
      $stmt = $pdo->prepare("SELECT id, username, email FROM users WHERE email = ?");
      $stmt->execute([$email]);
      $user = $stmt->fetch();

      if ($user) {
        // Generate secure reset token
        $reset_token = bin2hex(random_bytes(32));
        $expires_at = date('Y-m-d H:i:s', strtotime('+1 hour'));

        // Delete any existing reset tokens for this user
        $stmt = $pdo->prepare("DELETE FROM password_resets WHERE user_id = ?");
        $stmt->execute([$user['id']]);

        // Insert new reset token
        $stmt = $pdo->prepare("INSERT INTO password_resets (user_id, reset_token, expires_at, created_at) VALUES (?, ?, ?, NOW())");
        $stmt->execute([$user['id'], $reset_token, $expires_at]);

        // Send reset email
        $reset_link = "http://" . $_SERVER['HTTP_HOST'] . dirname($_SERVER['PHP_SELF']) . "/reset-password.php?token=" . $reset_token;

        $subject = "Password Reset Request";
        $message = "
                <html>
                <head>
                    <title>Password Reset Request</title>
                </head>
                <body>
                    <h2>Password Reset Request</h2>
                    <p>Hello " . htmlspecialchars($user['username']) . ",</p>
                    <p>You have requested to reset your password. Click the link below to reset your password:</p>
                    <p><a href='" . $reset_link . "' style='background-color: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;'>Reset Password</a></p>
                    <p>Or copy and paste this link in your browser:<br>" . $reset_link . "</p>
                    <p>This link will expire in 1 hour.</p>
                    <p>If you did not request this password reset, please ignore this email.</p>
                    <br>
                    <p>Best regards,<br>Your Website Team</p>
                </body>
                </html>
                ";

        // Email headers
        $headers = "MIME-Version: 1.0" . "\r\n";
        $headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
        $headers .= "From: noreply@yourwebsite.com" . "\r\n";

        // Send email
        if (mail($email, $subject, $message, $headers)) {
          $success = "Password reset instructions have been sent to your email address.";
          $email = ''; // Clear email field on success
        } else {
          $errors[] = "Failed to send email. Please try again later.";
        }
      } else {
        // Don't reveal if email exists or not for security
        $success = "If an account with that email exists, password reset instructions have been sent.";
        $email = '';
      }
    } catch (PDOException $e) {
      $errors[] = "An error occurred. Please try again later.";
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
  <title>Forgot Password</title>
  <link rel="preload" href="../icon/database-icon.png" as="image">
  <link rel="icon" href="res/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="res/css/r-l.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div class="container">
    <div class="header">
      <div><img src="res/logo/database.svg" alt="My Database Logo" class="logo" loading="lazy"></div>
      <h2>Forgot Password</h2>
      <p class="subtitle">Enter your email address and we'll send you instructions to reset your password.</p>
    </div>

    <?php if (!empty($errors)): ?>
      <div class="error">
        <?php foreach ($errors as $error): ?>
          <div><?php echo htmlspecialchars($error); ?></div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>

    <?php if (!empty($success)): ?>
      <div class="success">
        <?php echo htmlspecialchars($success); ?>
      </div>
    <?php endif; ?>

    <form method="POST" action="">
      <div class="form-group">
        <label for="email">Email Address:</label>
        <input type="email" id="email" name="email" value="<?php echo htmlspecialchars($email); ?>">
      </div>

      <button type="submit" class="btn">Send Reset Instructions</button>
    </form>

    <div class="login-link">
      <a href="index.php">← Back to Login</a>
    </div>
  </div>

  <script src="res/src/req.js"></script>
  <script src="re/src/ver.js"></script>
</body>

</html>