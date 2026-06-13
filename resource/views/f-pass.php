<?php
// resource/views/f-pass.php --> forget password

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';

if (isset($_SESSION['user_id'])) {
  header('Location:', ROUTE_HOME);
  exit();
}

$errors = [];
$success = '';
$email = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $email = sanitizeInput($_POST['email'] ?? '');

  if (empty($email)) {
    $errors[] = "Email is required.";
  } elseif (!isValidEmail($email)) {
    $errors[] = "Please enter a valid email address.";
  }

  if (empty($errors)) {
    try {
      $pdo = getDBConnection();

      $stmt = $pdo->prepare("SELECT id, username, email FROM users WHERE email = ?");
      $stmt->execute([$email]);
      $user = $stmt->fetch();

      if ($user) {
        $reset_token = bin2hex(random_bytes(32));
        $expires_at = date('Y-m-d H:i:s', strtotime('+1 hour'));

        $stmt = $pdo->prepare("DELETE FROM password_resets WHERE user_id = ?");
        $stmt->execute([$user['id']]);

        $stmt = $pdo->prepare("INSERT INTO password_resets (user_id, reset_token, expires_at, created_at) VALUES (?, ?, ?, NOW())");
        $stmt->execute([$user['id'], $reset_token, $expires_at]);

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

        $headers = "MIME-Version: 1.0" . "\r\n";
        $headers .= "Content-type:text/html;charset=UTF-8" . "\r\n";
        $headers .= "From: noreply@yourwebsite.com" . "\r\n";

        if (mail($email, $subject, $message, $headers)) {
          $success = "Password reset instructions have been sent to your email address.";
          $email = '';
        } else {
          $errors[] = "Failed to send email. Please try again later.";
        }
      } else {
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
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=a1b2c">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div class="container">
    <div class="header">
      <div><img src="/config/asset.php?t=v5w6x" alt="My Database Logo" class="logo" loading="lazy"></div>
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

      <button type="submit" class="btn-sub btn-primary" tabindex="-1">Send Reset Instructions</button>
    </form>

    <div class="login-link">
      <a data-action-dir="login">← Back to Login</a>
    </div>
  </div>

  <script src="/config/route-config.php?page=login"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=m9n0o"></script>
</body>

</html>