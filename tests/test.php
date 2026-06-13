<?php
// tests/test.php --> test project

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('test', ROUTE_HOME);
$access = getMenuAccess();

// Get dashboard statistics if database is connected
$stats = [
  'total_employees' => 0,
  'active_employees' => 0,
  'inactive_employees' => 0,
  'today_attendance' => 0
];

if ($databaseConnected) {
  try {
    // Get total employees
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees");
    $stmt->execute();
    $stats['total_employees'] = $stmt->fetchColumn();

    // Get active employees
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees WHERE status = 'active'");
    $stmt->execute();
    $stats['active_employees'] = $stmt->fetchColumn();

    // Get inactive count
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees WHERE status = 'inactive'");
    $stmt->execute();
    $stats['inactive_employees'] = $stmt->fetchColumn();

    // Get today's attendance
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log");
    $stmt->execute();
    $stats['today_attendance'] = $stmt->fetchColumn();

    // Get recent employee logs
    $stmt = $userDb->prepare("
            SELECT el.*, e.first_name, e.last_name 
            FROM employee_logs el
            JOIN employees e ON el.employee_id = e.employee_id
            ORDER BY el.timestamp DESC 
            LIMIT 10
        ");
    $stmt->execute();
    $recentLogs = $stmt->fetchAll();

    // Get company settings
    $stmt = $userDb->prepare("SELECT setting_key, setting_value FROM user_settings");
    $stmt->execute();
    $settings = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
  } catch (PDOException $e) {
    $dbError = "Error fetching dashboard data: " . $e->getMessage();
  }
}

// Handle quick actions
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $databaseConnected) {
  $action = $_POST['action'] ?? '';

  switch ($action) {
    case 'add_employee':
      $employeeId = sanitizeInput($_POST['id'] ?? '');
      $firstName = sanitizeInput($_POST['first_name'] ?? '');
      $lastName = sanitizeInput($_POST['last_name'] ?? '');
      $email = sanitizeInput($_POST['email'] ?? '');
      $position = sanitizeInput($_POST['position'] ?? '');
      $department = sanitizeInput($_POST['department'] ?? '');

      if (!empty($employeeId) && !empty($firstName) && !empty($lastName)) {
        try {
          $stmt = $userDb->prepare("
                        INSERT INTO employees (id, first_name, last_name, email, position, department) 
                        VALUES (?, ?, ?, ?, ?, ?)
                    ");
          $stmt->execute([$employeeId, $firstName, $lastName, $email, $position, $department]);

          logSystemAction($userId, 'EMPLOYEE_ADDED', "Added employee: $firstName $lastName ($employeeId)");
          $success = "Employee added successfully!";

          // Refresh stats
          header('Location: portal.php');
          exit;
        } catch (PDOException $e) {
          $error = "Error adding employee: " . $e->getMessage();
        }
      } else {
        $error = "Employee ID, first name, and last name are required.";
      }
      break;
  }
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Dashboard</title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 1rem 2rem;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    }

    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 1200px;
      margin: 0 auto;
    }

    .logo-section {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .logo {
      width: 40px;
      height: 40px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 18px;
    }

    .user-section {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .user-info {
      text-align: right;
    }

    .user-name {
      font-weight: 600;
      margin-bottom: 2px;
    }

    .user-db {
      font-size: 0.8rem;
      opacity: 0.8;
    }

    .logout-btn {
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.3s ease;
    }

    .logout-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: white;
      padding: 1.5rem;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
      border-left: 4px solid;
      transition: transform 0.3s ease;
    }

    .stat-card:hover {
      transform: translateY(-2px);
    }

    .stat-card.employees {
      border-left-color: #667eea;
    }

    .stat-card.active {
      border-left-color: #51cf66;
    }

    .stat-card.inactive {
      border-left-color: #ff6b6b;
    }

    .stat-card.attendance {
      border-left-color: #ffa726;
    }

    .stat-number {
      font-size: 2rem;
      font-weight: bold;
      margin-bottom: 0.5rem;
    }

    .stat-label {
      color: #666;
      font-size: 0.9rem;
    }

    .stat-icon {
      font-size: 1.2rem;
      float: right;
      opacity: 0.6;
    }

    .content-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 2rem;
      margin-top: 2rem;
    }

    .main-content {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }

    .sidebar {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
      padding: 1.5rem;
    }

    .section-header {
      background: #f8f9fa;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid #e9ecef;
      font-weight: 600;
      color: #495057;
    }

    .section-content {
      padding: 1.5rem;
    }

    .quick-actions {
      display: grid;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .action-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.3s ease;
      text-decoration: none;
      display: inline-block;
      text-align: center;
    }

    .action-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    .recent-logs {
      max-height: 400px;
      overflow-y: auto;
    }

    .log-item {
      padding: 0.75rem 0;
      border-bottom: 1px solid #f1f3f4;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .log-item:last-child {
      border-bottom: none;
    }

    .log-details {
      flex: 1;
    }

    .log-employee {
      font-weight: 600;
      color: #333;
    }

    .log-action {
      font-size: 0.85rem;
      color: #666;
      text-transform: capitalize;
    }

    .log-time {
      font-size: 0.8rem;
      color: #999;
      text-align: right;
    }

    .database-status {
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }

    .database-status.connected {
      background: linear-gradient(135deg, #e8f5e8, #c8e6c9);
      color: #2e7d32;
      border-left: 4px solid #4caf50;
    }

    .database-status.error {
      background: linear-gradient(135deg, #ffebee, #ffcdd2);
      color: #c62828;
      border-left: 4px solid #f44336;
    }

    .employee-form {
      display: none;
      background: #f8f9fa;
      padding: 1rem;
      border-radius: 8px;
      margin-top: 1rem;
    }

    .form-group {
      margin-bottom: 1rem;
    }

    .form-group label {
      display: block;
      margin-bottom: 0.25rem;
      font-weight: 600;
      color: #555;
      font-size: 0.9rem;
    }

    .form-group input,
    .form-group select {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 0.9rem;
    }

    .form-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 1rem;
    }

    .btn-small {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 600;
    }

    .btn-primary {
      background: #667eea;
      color: white;
    }

    .btn-secondary {
      background: #6c757d;
      color: white;
    }

    @media (max-width: 768px) {
      .header-content {
        flex-direction: column;
        gap: 1rem;
        text-align: center;
      }

      .content-grid {
        grid-template-columns: 1fr;
      }

      .container {
        padding: 1rem;
      }
    }

    /* Add a subtle indicator that portal is secured */
    .security-badge {
      position: fixed;
      top: 80px;
      left: 10px;
      background: linear-gradient(135deg, #4CAF50, #45a049);
      color: white;
      padding: 5px 12px;
      border-radius: 15px;
      font-size: 12px;
      font-weight: 600;
      z-index: 2000;
      box-shadow: 0 2px 10px rgba(76, 175, 80, 0.3);
    }

    .security-badge::before {
      content: "🔒";
      margin-right: 5px;
    }
  </style>
</head>

<body>
  <!-- Security indicator -->
  <div class="security-badge">Secured</div>

  <version_compare style="z-index: 1000;">
    <p id="version"></p>
  </version_compare>

  <div id="closeButton" class="close-button" role="button" tabindex="0" aria-label="Close" onclick="window.history.back();">
    <i class="fas fa-times"></i>
  </div>

  <div class="header">
    <div class="header-content">
      <div class="logo-section">
        <div class="logo">3PL</div>
        <h1><?php echo htmlspecialchars($myDatabase); ?></h1>
      </div>
      <div class="user-section">
        <div class="user-info">
          <div class="user-name">
            <?php echo htmlspecialchars($_SESSION['first_name'] . ' ' . $_SESSION['last_name']); ?>
          </div>
          <div class="user-db">DB: <?php echo htmlspecialchars($userDbName); ?></div>
        </div>
        <a href="?logout=1" class="logout-btn">Logout</a>
      </div>
    </div>
  </div>

  <div class="container">
    <!-- Database Status -->
    <?php if ($databaseConnected): ?>
      <div class="database-status connected">
        ✅ Database Connected: <?php echo htmlspecialchars($userDbName); ?>
      </div>
    <?php else: ?>
      <div class="database-status error">
        ❌ Database Connection Error: <?php echo htmlspecialchars($dbError ?? 'Unknown error'); ?>
      </div>
    <?php endif; ?>
    <div onclick="window.history.back()" style="position: fixed;
      top: 0;
      right: 1vmin;
      padding: 1vmin;
      z-index: 1000;
      cursor: pointer;
      color: red;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);">
    <i class="fas fa-times"></i>
  </div>

    <!-- Dashboard Statistics -->
    <div class="dashboard-grid">
      <div class="stat-card employees">
        <div class="stat-icon">👥</div>
        <div class="stat-number"><?php echo number_format($stats['total_employees']); ?></div>
        <div class="stat-label">Total Employees</div>
      </div>
      <div class="stat-card active">
        <div class="stat-icon">✅</div>
        <div class="stat-number"><?php echo number_format($stats['active_employees']); ?></div>
        <div class="stat-label">Active Employees</div>
      </div>
      <div class="stat-card inactive">
        <div class="stat-icon">❎</div>
        <div class="stat-number"><?php echo number_format($stats['inactive_employees']); ?></div>
        <div class="stat-label">Inactive Employees</div>
      </div>
      <div class="stat-card attendance">
        <div class="stat-icon">📅</div>
        <div class="stat-number"><?php echo number_format($stats['today_attendance']); ?></div>
        <div class="stat-label">Today's Attendance</div>
      </div>
    </div>

    <!-- Main Content Grid -->
    <div class="content-grid">
      <!-- Main Content Area -->
      <div class="main-content">
        <div class="section-header">
          Recent Employee Activity
        </div>
        <div class="section-content">
          <?php if ($databaseConnected && !empty($recentLogs)): ?>
            <div class="recent-logs">
              <?php foreach ($recentLogs as $log): ?>
                <div class="log-item">
                  <div class="log-details">
                    <div class="log-employee">
                      <?php echo htmlspecialchars($log['first_name'] . ' ' . $log['last_name']); ?>
                    </div>
                    <div class="log-action">
                      <?php echo htmlspecialchars(str_replace('_', ' ', $log['action_type'])); ?>
                      <?php if ($log['location']): ?>
                        at <?php echo htmlspecialchars($log['location']); ?>
                      <?php endif; ?>
                    </div>
                  </div>
                  <div class="log-time">
                    <?php echo date('M j, g:i A', strtotime($log['timestamp'])); ?>
                  </div>
                </div>
              <?php endforeach; ?>
            </div>
          <?php elseif ($databaseConnected): ?>
            <p style="text-align: center; color: #666; padding: 2rem;">
              No employee activity recorded yet.
            </p>
          <?php else: ?>
            <p style="text-align: center; color: #666; padding: 2rem;">
              Database connection required to view activity logs.
            </p>
          <?php endif; ?>
        </div>
      </div>

      <!-- Sidebar -->
      <div class="sidebar">
        <h3 style="margin-bottom: 1rem; color: #333;">Quick Actions</h3>

        <div class="quick-actions">
          <button onclick="toggleEmployeeForm()" class="action-btn">➕ Add Employee</button>
          <button href="employees.php" class="action-btn">👥 Manage Employees</button>
          <button href="attendance.php" class="action-btn">📊 View Attendance</button>
          <button href="reports.php" class="action-btn">📈 Generate Reports</button>
          <button href="settings.php" class="action-btn">⚙️ Settings</button>
        </div>

        <!-- Quick Add Employee Form -->
        <div id="employeeForm" class="employee-form">
          <h4 style="margin-bottom: 1rem; color: #333;">Add New Employee</h4>

          <?php if (isset($error)): ?>
            <div
              style="background: #ffebee; color: #c62828; padding: 0.5rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem;">
              <?php echo htmlspecialchars($error); ?>
            </div>
          <?php endif; ?>

          <?php if (isset($success)): ?>
            <div
              style="background: #e8f5e8; color: #2e7d32; padding: 0.5rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.9rem;">
              <?php echo htmlspecialchars($success); ?>
            </div>
          <?php endif; ?>

          <form method="POST" action="">
            <input type="hidden" name="action" value="add_employee">

            <div class="form-group">
              <label for="employee_id">Employee ID *</label>
              <input type="text" id="employee_id" name="employee_id" required>
            </div>

            <div class="form-group">
              <label for="first_name">First Name *</label>
              <input type="text" id="first_name" name="first_name" required>
            </div>

            <div class="form-group">
              <label for="last_name">Last Name *</label>
              <input type="text" id="last_name" name="last_name" required>
            </div>

            <div class="form-group">
              <label for="email">Email</label>
              <input type="email" id="email" name="email">
            </div>

            <div class="form-group">
              <label for="position">Position</label>
              <select id="position" name="position">
                <option value="">Select Position</option>
                <option value="HR Manager">HR Manager</option>
                <option value="Operations Supervisor">Operations Supervisor</option>
                <option value="Administrative Assistant">Administrative Assistant</option>
                <option value="Security Guard">Security Guard</option>
                <option value="Maintenance Technician">Maintenance Technician</option>
                <option value="General Worker">General Worker</option>
              </select>
            </div>

            <div class="form-group">
              <label for="department">Department</label>
              <select id="department" name="department">
                <option value="">Select Department</option>
                <option value="Human Resources">Human Resources</option>
                <option value="Operations">Operations</option>
                <option value="Administration">Administration</option>
                <option value="Security">Security</option>
                <option value="Maintenance">Maintenance</option>
              </select>
            </div>

            <div class="form-actions">
              <button type="submit" class="btn-small btn-primary">Add Employee</button>
              <button type="button" onclick="toggleEmployeeForm()" class="btn-small btn-secondary">Cancel</button>
            </div>
          </form>
        </div>

        <!-- System Information -->
        <div style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e9ecef;">
          <h4 style="margin-bottom: 1rem; color: #333;">System Info</h4>
          <div style="font-size: 0.85rem; color: #666; line-height: 1.4;">
            <div style="margin-bottom: 0.5rem;">
              <strong>Company:</strong> <?php echo htmlspecialchars($settings['company_name'] ?? 'My Company'); ?>
            </div>
            <div style="margin-bottom: 0.5rem;">
              <strong>Timezone:</strong> <?php echo htmlspecialchars($settings['timezone'] ?? 'Asia/Manila'); ?>
            </div>
            <div style="margin-bottom: 0.5rem;">
              <strong>Max Employees:</strong> <?php echo htmlspecialchars($settings['max_employees'] ?? '1000'); ?>
            </div>
            <div>
              <strong>Database:</strong> <?php echo htmlspecialchars($userDbName); ?>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=j7k8l.js"></script>
  <script src="/config/asset.php?t=m9n0o.js"></script>
  <script>
    function toggleEmployeeForm() {
      const form = document.getElementById('employeeForm');
      const isVisible = form.style.display === 'block';
      form.style.display = isVisible ? 'none' : 'block';

      if (!isVisible) {
        // Focus on first input when form is shown
        document.getElementById('employee_id').focus();
      }
    }

    // Auto-refresh dashboard every 30 seconds
    setInterval(function() {
      // Only refresh if no forms are visible
      const form = document.getElementById('employeeForm');
      if (form.style.display !== 'block') {
        window.location.reload();
      }
    }, 30000);

    // Real-time clock
    function updateClock() {
      const now = new Date();
      const timeString = now.toLocaleTimeString();
      const dateString = now.toLocaleDateString();

      // Update if clock element exists
      const clockElement = document.getElementById('current-time');
      if (clockElement) {
        clockElement.textContent = `${dateString} ${timeString}`;
      }
    }

    // Add current time display to header
    window.addEventListener('DOMContentLoaded', function() {
      const userInfo = document.querySelector('.user-info');
      if (userInfo) {
        const timeDiv = document.createElement('div');
        timeDiv.id = 'current-time';
        timeDiv.style.fontSize = '0.8rem';
        timeDiv.style.opacity = '0.8';
        timeDiv.style.marginTop = '4px';
        userInfo.appendChild(timeDiv);

        updateClock();
        setInterval(updateClock, 1000);
      }
    });

    // Enhance form validation
    document.addEventListener('DOMContentLoaded', function() {
      const employeeIdInput = document.getElementById('employee_id');
      if (employeeIdInput) {
        employeeIdInput.addEventListener('input', function() {
          // Auto-uppercase employee ID
          this.value = this.value.toUpperCase();

          // Basic validation
          if (this.value.length > 0 && this.value.length < 3) {
            this.style.borderColor = '#ff6b6b';
          } else if (this.value.length >= 3) {
            this.style.borderColor = '#51cf66';
          }
        });
      }

      // Email validation
      const emailInput = document.getElementById('email');
      if (emailInput) {
        emailInput.addEventListener('input', function() {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (this.value && !emailRegex.test(this.value)) {
            this.style.borderColor = '#ff6b6b';
          } else if (this.value) {
            this.style.borderColor = '#51cf66';
          } else {
            this.style.borderColor = '';
          }
        });
      }
    });

    // Show success message if employee was added
    <?php if (isset($success)): ?>
      setTimeout(function() {
        const successDiv = document.querySelector('.employee-form div[style*="background: #e8f5e8"]');
        if (successDiv) {
          successDiv.style.transition = 'opacity 0.5s ease';
          successDiv.style.opacity = '0';
          setTimeout(() => successDiv.remove(), 500);
        }
      }, 3000);
    <?php endif; ?>
  </script>
</body>

</html>