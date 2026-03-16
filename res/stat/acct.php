<?php
//acct.php

require_once '../cnfg/config.php';

$user = getCurrentUser();
$message = '';
$messageType = '';

// Handle form submissions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  if (isset($_POST['update_profile'])) {
    // Update profile information
    $firstName = sanitizeInput($_POST['first_name']);
    $lastName = sanitizeInput($_POST['last_name']);
    $phoneNum = sanitizeInput($_POST['phone']);

    $errors = [];

    if (empty($firstName) || empty($lastName)) {
      $errors[] = "First name and last name are required";
    }

    if (empty($errors)) {
      try {
        $pdo = getMainDBConnection();
        $stmt = $pdo->prepare("UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = NOW() WHERE id = ?");
        $stmt->execute([$firstName, $lastName, $phoneNum, $user['id']]);

        // Update session variables
        $_SESSION['first_name'] = $firstName;
        $_SESSION['last_name'] = $lastName;
        $_SESSION['phone'] = $phoneNum;

        // Update the current user array to reflect changes immediately
        $user['first_name'] = $firstName;
        $user['last_name'] = $lastName;
        $user['phone'] = $phoneNum;

        logSystemAction($user['id'], 'PROFILE_UPDATED', 'User updated profile information');

        $message = 'Profile updated successfully!';
        $messageType = 'success';
      } catch (PDOException $e) {
        error_log("Profile update error: " . $e->getMessage());
        $message = 'An error occurred while updating your profile.';
        $messageType = 'error';
      }
    } else {
      $message = implode(', ', $errors);
      $messageType = 'error';
    }
  }

  if (isset($_POST['change_password'])) {
    // Change password
    $currentPassword = $_POST['current_password'];
    $newPassword = $_POST['new_password'];
    $confirmPassword = $_POST['confirm_password'];

    $errors = [];

    if (empty($currentPassword) || empty($newPassword) || empty($confirmPassword)) {
      $errors[] = "All password fields are required";
    }

    if ($newPassword !== $confirmPassword) {
      $errors[] = "New passwords do not match";
    }

    if (!isValidPassword($newPassword)) {
      $errors[] = "Password must be at least 8 characters with uppercase, lowercase, and number";
    }

    if (empty($errors)) {
      try {
        $pdo = getMainDBConnection();
        $stmt = $pdo->prepare("SELECT password FROM users WHERE id = ?");
        $stmt->execute([$user['id']]);
        $currentHash = $stmt->fetchColumn();

        if (password_verify($currentPassword, $currentHash)) {
          $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
          $updateStmt = $pdo->prepare("UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?");
          $updateStmt->execute([$newHash, $user['id']]);

          logSystemAction($user['id'], 'PASSWORD_CHANGED', 'User changed password');

          $message = 'Password changed successfully!';
          $messageType = 'success';
        } else {
          $message = 'Current password is incorrect.';
          $messageType = 'error';
        }
      } catch (PDOException $e) {
        error_log("Password change error: " . $e->getMessage());
        $message = 'An error occurred while changing your password.';
        $messageType = 'error';
      }
    } else {
      $message = implode(', ', $errors);
      $messageType = 'error';
    }
  }
}

// Refresh user data from database to ensure we have the latest information
try {
  $pdo = getMainDBConnection();
  $stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
  $stmt->execute([$user['id']]);
  $refreshedUser = $stmt->fetch();
  if ($refreshedUser) {
    $user = $refreshedUser;
  }
} catch (PDOException $e) {
  error_log("Error refreshing user data: " . $e->getMessage());
}

// Get user statistics
$userStats = [];
try {
  $userPdo = getUserDBConnection($user['id']);

  // Get employee count
  $stmt = $userPdo->query("SELECT COUNT(*) as total_employees FROM employees");
  $userStats['total_employees'] = $stmt->fetchColumn();

  // Get active employees
  $stmt = $userPdo->query("SELECT COUNT(*) as active_employees FROM employees WHERE status = 'Active'");
  $userStats['active_employees'] = $stmt->fetchColumn();

  // Get total violations
  $stmt = $userPdo->query("SELECT COUNT(*) as total_violations FROM violations");
  $userStats['total_violations'] = $stmt->fetchColumn();

  // Get recent activity count (last 30 days)
  $stmt = $userPdo->query("SELECT COUNT(*) as recent_activity FROM employee_access_log WHERE access_timestamp >= DATE_SUB(NOW(), INTERVAL 30 DAY)");
  $userStats['recent_activity'] = $stmt->fetchColumn();
} catch (Exception $e) {
  error_log("Error fetching user stats: " . $e->getMessage());
  $userStats = [
    'total_employees' => 0,
    'active_employees' => 0,
    'total_violations' => 0,
    'recent_activity' => 0
  ];
}

// Get account creation date and last login
try {
  $pdo = getMainDBConnection();
  $stmt = $pdo->prepare("SELECT created_at, last_login FROM users WHERE id = ?");
  $stmt->execute([$user['id']]);
  $accountInfo = $stmt->fetch();
} catch (PDOException $e) {
  error_log("Error fetching account info: " . $e->getMessage());
  $accountInfo = ['created_at' => null, 'last_login' => null];
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Account Info</title>
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/system.css">
  <link rel="stylesheet" href="../css/ptl.css">
  <link rel="stylesheet" href="../css/btn.css">
  <link rel="stylesheet" href="../css/acct.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div onclick="window.location.href='../iframe/ptl.php';" style="position: fixed;
      top: 0;
      right: 1vmin;
      padding: 1vmin;
      z-index: 1000;
      cursor: pointer;
      color: red;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);">
    <i class="fas fa-times"></i>
  </div>

  <!-- Alert Messages -->
  <div class="alert-container" id="alertContainer"></div>

  <main class="db-cont">
    <section class="welcome-card">
      <h1><i class="fas fa-user"></i> Account Information</h1>
      <div class="breadcrumb">
        <a href="../iframe/ptl.php"><i class="fas fa-home"></i> Portal</a> / Account Info
      </div>
    </section>

    <?php if ($message): ?>
      <div class="alert alert-<?php echo $messageType; ?>">
        <?php echo htmlspecialchars($message); ?>
        <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;"><i class="fas fa-times"></i></button>
      </div>
    <?php endif; ?>

    <!-- Account Statistics -->
    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-number"><?php echo number_format($userStats['total_employees']); ?></div>
        <div class="stat-label">Total Employees</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?php echo number_format($userStats['active_employees']); ?></div>
        <div class="stat-label">Active Employees</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?php echo number_format($userStats['total_violations']); ?></div>
        <div class="stat-label">Total Violations</div>
      </div>
      <div class="stat-card">
        <div class="stat-number"><?php echo number_format($userStats['recent_activity']); ?></div>
        <div class="stat-label">Recent Activity (30 days)</div>
      </div>
    </section>

    <section class="menu-grid">
      <!-- Profile Information -->
      <div class="menu-card">
        <h2><i class="fas fa-user"></i> Profile Information</h2>

        <div class="database-info">
          <img src="../icon/database-icon.png" alt="MySql Logo" class="database-logo">
          <p>Connected to your personal database:</p>
          <div class="database-name"><?php echo htmlspecialchars($user['my_database']); ?></div>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Username</div>
            <div class="info-value"><?php echo htmlspecialchars($user['username']); ?></div>
          </div>
          <div class="info-item">
            <div class="info-label">Email</div>
            <div class="info-value"><?php echo htmlspecialchars($user['email']); ?></div>
          </div>
          <div class="info-item">
            <div class="info-label">Account Created</div>
            <div class="info-value">
              <?php echo $accountInfo['created_at'] ? date('F j, Y g:i A', strtotime($accountInfo['created_at'])) : 'N/A'; ?>
            </div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Login</div>
            <div class="info-value">
              <?php echo $accountInfo['last_login'] ? date('F j, Y g:i A', strtotime($accountInfo['last_login'])) : 'N/A'; ?>
            </div>
          </div>
        </div>

        <form method="POST">
          <div class="data-grid">
            <div class="info-item">
              <label for="first_name">First Name</label>
              <input type="text" id="first_name" name="first_name" class="form-control"
                value="<?php echo htmlspecialchars($user['first_name'] ?? ''); ?>" required>
            </div>

            <div class="info-item">
              <label for="last_name">Last Name</label>
              <input type="text" id="last_name" name="last_name" class="form-control"
                value="<?php echo htmlspecialchars($user['last_name'] ?? ''); ?>" required>
            </div>

            <div class="info-item">
              <label for="phone">Phone Number ( Optional )</label>
              <input type="tel" id="phone" name="phone" class="form-control"
                value="<?php echo htmlspecialchars($user['phone'] ?? ''); ?>">
            </div>
          </div>

          <button type="submit" name="update_profile" class="btn btn-primary">Update Profile</button>
        </form>
      </div>

      <!-- Security Settings -->
      <div class="menu-card">
        <h2>Security Settings</h2>

        <form method="POST">
          <div class="pass-item">
            <label for="current_password">Current Password</label>
            <input type="password" id="current_password" name="current_password" class="form-control" required>
          </div>

          <div class="pass-item">
            <label for="new_password">New Password</label>
            <input type="password" id="new_password" name="new_password" class="form-control" require>
            <small style="color: #666">Password must be at least 8 characters with uppercase, lowercase, and number</small>
          </div>

          <div class="pass-item">
            <label for="confirm_password">Confirm New Password</label>
            <input type="password" id="confirm_password" name="confirm_password" class="form-control" required>
          </div>

          <button type="submit" name="change_password" class="btn btn-primary">Change Password</button>
        </form>

        <hr style="margin: 30px 0; border: none; height: 1px; background: #e1e5e9;">
      </div>
    </section>
  </main>

  <script src="../src/acct.js"></script>
  <script src="../src/req.js"></script>
</body>

</html>