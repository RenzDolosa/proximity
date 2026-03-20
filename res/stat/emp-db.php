<?php
// emp-db.php

require_once '../cnfg/config.php';
require_once '../cnfg/manpower_backend.php';
require_once '../cnfg/db.php';

// Get dashboard statistics
$stats = [
  'total_employees' => 0,
  'active_employees' => 0,
  'inactive_employees' => 0,
  'total_scanned' => 0,
  'active_scan' => 0,
  'inactive_scan' => 0,
  'today_attendance' => 0,
  'today_in' => 0,
  'today_out' => 0,
  'total_proxcode' => 0,
];

$recentLogs = [];

// Get user database connection
try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError = $e->getMessage();
}

if ($databaseConnected && $employeeManager) {
  try {
    // Get employee statistics using the EmployeeManager
    $employeeStats = $employeeManager->getEmployeeStats();
    $stats = [
      'total_employees' => $employeeStats['total'] ?? 0,
      'active_employees' => $employeeStats['active'] ?? 0,
      'inactive_employees' => $employeeStats['inactive'] ?? 0,
    ];

    // Get user database connection for access logs
    $userDb = $database->getUserConnection();

    // Get access log statistics
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log");
    $stmt->execute();
    $stats['total_scanned'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE status = 'Active'");
    $stmt->execute();
    $stats['active_scan'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE status = 'Inactive'");
    $stmt->execute();
    $stats['inactive_scan'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_attendance'] = $stmt->fetchColumn();

    // Get today's check-ins
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'IN' AND DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_in'] = (int)$stmt->fetchColumn();

    // Get today's check-outs
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'OUT' AND DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_out'] = (int)$stmt->fetchColumn();

    // Get recent employee logs
    $stmt = $userDb->prepare("
            SELECT el.*, e.fullname 
            FROM employee_access_log el
            LEFT JOIN employees e ON el.employee_id = e.id
            ORDER BY el.access_timestamp DESC 
            LIMIT 6
        ");
    $stmt->execute();
    $recentLogs = $stmt->fetchAll();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM code");
    $stmt->execute();
    $stats['total_proxcode'] = $stmt->fetchColumn();

    // Get recent employee logs
    $stmt = $userDb->prepare("
            SELECT el.*, e.qr_code
            FROM code el
            ORDER BY el.access_timestamp DESC 
            LIMIT 6
        ");
    $stmt->execute();
    $recentLogs = $stmt->fetchAll();
  } catch (PDOException $e) {
    $dbError = "Error fetching dashboard data: " . $e->getMessage();
    error_log($dbError);
  }
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Employee Dashboard</title>
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/system.css">
  <link rel="stylesheet" href="../css/emp-db.css">
  <link rel="stylesheet" href="../css/ptl.css">
  <link rel="stylesheet" href="../css/sbar.css">
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

  <main class="db-cont">
    <section class="welcome-card">
      <h1><i class="fas fa-tachometer-alt"></i> Employee Data Insights</h1>
      <div class="breadcrumb">
        <a href="../iframe/ptl.php"><i class="fas fa-home"></i> Portal</a> / Insights
      </div>
    </section>

    <?php if (!$databaseConnected): ?>
      <div class="alert alert-error">
        <strong>Database Connection Error:</strong>
        <?php echo htmlspecialchars($dbError ?? 'Could not connect to user database'); ?>
      </div>
    <?php endif; ?>

    <!-- Employee Statistics -->
    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #667eea, #764ba2);">
          <i class="fas fa-users" style="z-index: 1000;"></i>
        </div>
        <div class="stat-number"><?php echo number_format($stats['total_employees']); ?></div>
        <div class="stat-label">Total Employees</div>
        <img src="../logo/mysql-logo.png" style="top: 10%; right: 2%; height: 40px; position:absolute;">
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #28a745, #20c997);">
          <i class="fas fa-user-check" style="z-index: 1000;"></i>
        </div>
        <div class="stat-number"><?php echo number_format($stats['active_employees']); ?></div>
        <div class="stat-label">Active Employees</div>
        <img src="../logo/mysql-logo.png" style="top: 10%; right: 2%; height: 40px; position:absolute;">
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #dc3545, #fd7e14);">
          <i class="fas fa-user-times" style="z-index: 1000;"></i>
        </div>
        <div class="stat-number"><?php echo number_format($stats['inactive_employees']); ?></div>
        <div class="stat-label">Inactive Employees</div>
        <img src="../logo/mysql-logo.png" style="top: 10%; right: 2%; height: 40px; position:absolute;">
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #17a2b8, #6f42c1);">
          <i class="fas fa-id-card" style="z-index: 1000;"></i>
        </div>
        <div class="stat-number"><?php echo number_format($stats['total_proxcode']); ?></div>
        <div class="stat-label">Proximity Codes</div>
        <img src="../logo/mysql-logo.png" style="top: 10%; right: 2%; height: 40px; position:absolute;">
      </div>
    </section>

    <!-- Access Log Statistics -->
    <section class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #667eea, #764ba2);">
          <i class="fas fa-users" style="z-index: 1000;"></i>
        </div>
        <div class="stat-number"><?php echo number_format($stats['total_scanned']); ?></div>
        <div class="stat-label">Total Scanned</div>
        <img src="../logo/database.png" style="top: 10%; right: 5%; height: 40px; position:absolute;">
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #28a745, #20c997);">
          <i class="fas fa-user-check" style="z-index: 1000;"></i>
        </div>
        <div class="stat-number"><?php echo number_format($stats['active_scan']); ?></div>
        <div class="stat-label">Active Scanned</div>
        <img src="../logo/database.png" style="top: 10%; right: 5%; height: 40px; position:absolute;">
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #dc3545, #fd7e14);">
          <i class="fas fa-user-times" style="z-index: 1000;"></i>
        </div>
        <div class="stat-number"><?php echo number_format($stats['inactive_scan']); ?></div>
        <div class="stat-label">Inactive Scanned</div>
        <img src="../logo/database.png" style="top: 10%; right: 5%; height: 40px; position:absolute;">
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background: linear-gradient(135deg, #17a2b8, #6f42c1);">
          <img src="../icon/nfc-icon.png" style="width: 32px; height: 32px; z-index: 1000; filter: invert(1);" >
        </div>
        <div class="stat-number"><?php echo number_format($stats['today_attendance']); ?></div>
        <div class="stat-label">Scanned Today</div>
        <small style="color: #666; position: absolute; bottom: 10px; left: 40%;">
          In: <span id="todayIn"><?php echo $stats['today_in']; ?></span> |
          Out: <span id="todayOut"><?php echo $stats['today_out']; ?></span>
        </small>
        <img src="../logo/database.png" style="top: 10%; right: 5%; height: 40px; position:absolute;">
      </div>
    </section>

    <section class="menu-grid">
      <!-- Database Information -->
      <div class="menu-card">
        <h2><i class="fas fa-database"></i> Database Information</h2>

        <div class="database-info">
          <img src="../icon/database-icon.png" alt="MySql Logo" class="database-logo">
          <p>Connected to your personal database:</p>
          <div class="database-name"><?php echo htmlspecialchars($myDatabase); ?></div>
        </div>

        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">Database Status</div>
            <div class="info-value">
              <?php if ($databaseConnected): ?>
                <span style="color: #28a745;">✓ Connected</span>
              <?php else: ?>
                <span style="color: #dc3545;">✗ Disconnected</span>
              <?php endif; ?>
            </div>
          </div>
          <div class="info-item">
            <div class="info-label">Total Records</div>
            <div class="info-value"><?php echo number_format($stats['total_employees']); ?></div>
          </div>
          <div class="info-item">
            <div class="info-label">Active Records</div>
            <div class="info-value"><?php echo number_format($stats['active_employees']); ?></div>
          </div>
          <div class="info-item">
            <div class="info-label">Last Updated</div>
            <div class="info-value"><?php echo date('F j, Y g:i A'); ?></div>
          </div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="menu-card">
        <h2><i class="fas fa-history"></i> Recent Activity</h2>

        <?php if (!empty($recentLogs)): ?>
          <div class="activity-container">
            <?php foreach (array_slice($recentLogs, 0, 5) as $log): ?>
              <div class="activity-item">
                <?php
                // Get the image path from the log data or use a default
                $userImage = $log['profile_image'] ?? $log['image'] ?? '../icon/database-icon.png';
                $imagePath = "../../uploads/user_" . htmlspecialchars($userId) . "/" . htmlspecialchars($userImage);

                // Check if image file exists, otherwise use default
                if (!file_exists($imagePath)) {
                  $imagePath = "../icon/database-icon.png"; // Fallback icon
                }
                ?>
                <img src=<?php echo $imagePath; ?>
                  alt="<?php echo htmlspecialchars($log['fullname'] ?? 'User'); ?> Profile"
                  class="activity-icon"
                  onerror="this.src='../logo/3Pl.png'; this.nextSibling.style.display='inline';">

                <div class="activity-details">
                  <div class="activity-name">
                    <strong><?php echo htmlspecialchars($log['fullname'] ?? 'Unknown Employee'); ?></strong>
                  </div>
                  <div class="activity-time">
                    <?php echo date('M j, Y g:i A', strtotime($log['access_timestamp'])); ?>
                  </div>
                </div>

                <div class="activity-status">
                  <span class="status-badge status-<?php echo strtolower($log['status'] ?? 'unknown'); ?>">
                    <?php echo htmlspecialchars($log['status'] ?? 'Unknown'); ?>
                  </span>
                  <span class="check-badge check-<?php echo strtolower($log['check_status'] ?? 'unknown'); ?>">
                    <?php echo htmlspecialchars($log['check_status'] ?? 'Unknown'); ?>
                  </span>
                </div>
              </div>
            <?php endforeach; ?>
          </div>
        <?php else: ?>
          <div class="no-activity">
            <div class="no-data-icon">📋</div>
            <h3 style="color: #6c757d;">No recent activity found.</h3>
          </div>
        <?php endif; ?>

        <?php
        // Alternative approach: Function to get user image
        function getUserImage($log, $userId)
        {
          // Priority order for image sources
          $imageSources = [
            $log['profile_image'] ?? null,
            $log['image'] ?? null,
            $log['avatar'] ?? null,
            '../icon/database-icon.png', // Fallback icon
          ];

          foreach ($imageSources as $imageFile) {
            if ($imageFile) {
              $fullPath = "../../uploads/user_" . $userId . "/" . $imageFile;
              if (file_exists($fullPath)) {
                return $fullPath;
              }
            }
          }

          return "../logo/3PL.png";
        }
        ?>
        <hr style="border: none; height: 1px; background: #e1e5e9;">
        <div style="text-align: center; margin-top: 20px;">
          <a href="../tb/dtl.php" class="btn btn-secondary">View All Logs</a>
        </div>
      </div>
    </section>
  </main>

  <script src="../src/req.js"></script>
</body>

</html>