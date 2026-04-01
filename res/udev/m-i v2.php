<?php
// m-i v2.php

require_once '../cnfg/config.php';
require_once '../cnfg/db.php';

requireAccess('m-i v2', '../iframe/main.php');
$access = getMenuAccess();

// FIX: Move ALL function definitions to the top before any calls
function getDashboardData($userDb)
{
  $stats = [
    'total_scanned'      => 0,
    'active_employees'   => 0,
    'inactive_employees' => 0,
    'today_attendance'   => 0,
    'today_in'           => 0,
    'today_out'          => 0,
  ];
  $recentLogs = [];
  $settings   = [];

  try {
    $tablesExist = checkTablesExist($userDb);

    if (!$tablesExist['employee_access_log']) {
      throw new Exception("Table 'employee_access_log' does not exist");
    }

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log");
    $stmt->execute();
    $stats['total_scanned'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE LOWER(status) = 'active'");
    $stmt->execute();
    $stats['active_employees'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE LOWER(status) = 'inactive'");
    $stmt->execute();
    $stats['inactive_employees'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_attendance'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'IN' AND DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_in'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'OUT' AND DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_out'] = (int)$stmt->fetchColumn();

    if ($tablesExist['employee_logs'] && $tablesExist['employees']) {
      $stmt = $userDb->prepare("
        SELECT el.*, e.fullname
        FROM employee_logs el
        LEFT JOIN employees e ON el.employee_id = e.id
        ORDER BY el.timestamp DESC
        LIMIT 10
      ");
      $stmt->execute();
      $recentLogs = $stmt->fetchAll(PDO::FETCH_ASSOC);
    } else {
      $stmt = $userDb->prepare("
        SELECT
          employee_id,
          fullname,
          access_timestamp AS timestamp,
          check_status,
          status,
          'Access Log' AS action
        FROM employee_access_log
        ORDER BY access_timestamp DESC
        LIMIT 10
      ");
      $stmt->execute();
      $recentLogs = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    if ($tablesExist['user_settings']) {
      $stmt = $userDb->prepare("SELECT setting_key, setting_value FROM user_settings");
      $stmt->execute();
      $settings = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
    }

    return [
      'stats'      => $stats,
      'recentLogs' => $recentLogs,
      'settings'   => $settings,
      'lastUpdate' => date('Y-m-d H:i:s'),
    ];
  } catch (PDOException $e) {
    $error = "Database error: " . $e->getMessage();
    error_log($error);
    return ['stats' => $stats, 'recentLogs' => $recentLogs, 'settings' => $settings, 'error' => $error];
  } catch (Exception $e) {
    $error = "Error: " . $e->getMessage();
    error_log($error);
    return ['stats' => $stats, 'recentLogs' => $recentLogs, 'settings' => $settings, 'error' => $error];
  }
}

function checkTablesExist($userDb)
{
  $tables = ['employee_access_log', 'employee_logs', 'employees', 'user_settings'];
  $exists = [];
  try {
    foreach ($tables as $table) {
      $stmt = $userDb->prepare("SHOW TABLES LIKE ?");
      $stmt->execute([$table]);
      $exists[$table] = $stmt->rowCount() > 0;
    }
  } catch (PDOException $e) {
    foreach ($tables as $table) {
      $exists[$table] = false;
    }
  }
  return $exists;
}

// ── Handle AJAX requests ──────────────────────────────────────────────────────
if (isset($_GET['ajax']) && $_GET['ajax'] === 'update') {
  header('Content-Type: application/json');

  if (($_SESSION['user_group'] ?? '') !== 'Administrator') {
    echo json_encode(['success' => false, 'message' => 'Access denied.']);
    exit;
  }

  // FIX: Guard against undefined $databaseConnected / $userDb from db.php
  if (!isset($databaseConnected) || !$databaseConnected || !isset($userDb)) {
    echo json_encode(['error' => 'Database not connected']);
    exit;
  }

  echo json_encode(getDashboardData($userDb));
  exit;
}

// ── Page load data ────────────────────────────────────────────────────────────
$stats = [
  'total_scanned'      => 0,
  'active_employees'   => 0,
  'inactive_employees' => 0,
  'today_attendance'   => 0,
  'today_in'           => 0,
  'today_out'          => 0,
];
$recentLogs = [];
$settings   = [];
$dbError    = '';

// FIX: Safely check variables that db.php is supposed to provide
if (!isset($databaseConnected)) {
  $dbError = 'db.php did not set $databaseConnected — check your db.php file.';
  $databaseConnected = false;
}

if ($databaseConnected && isset($userDb)) {
  $dashboardData = getDashboardData($userDb);
  $stats         = $dashboardData['stats'];
  $recentLogs    = $dashboardData['recentLogs'];
  $settings      = $dashboardData['settings'];
  if (isset($dashboardData['error'])) {
    $dbError = $dashboardData['error'];
  }
} elseif (empty($dbError)) {
  $dbError = 'Database connection not established';
}

$myDatabase = $myDatabase ?? 'Unknown Database';
$username   = $username   ?? 'Unknown User';
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - DTL Dashboard</title>
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/system.css">
  <link rel="stylesheet" href="../css/ptl.css">
  <link rel="stylesheet" href="../css/btn.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    .auto-update-controls {
      display: flex;
      align-items: center;
      gap: 15px;
      background: rgba(102, 126, 234, 0.1);
      padding: 10px 15px;
      border-radius: 10px;
      border: 1px solid rgba(102, 126, 234, 0.2);
    }

    .update-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: #555;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #28a745;
      animation: pulse 2s infinite;
    }

    .status-indicator.updating {
      background: #ffc107;
    }

    .status-indicator.error {
      background: #dc3545;
      animation: none;
    }

    @keyframes pulse {
      0% {
        opacity: 1;
      }

      50% {
        opacity: 0.5;
      }

      100% {
        opacity: 1;
      }
    }

    .auto-update-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }

    .toggle-switch {
      position: relative;
      width: 50px;
      height: 24px;
      background: #ccc;
      border-radius: 12px;
      transition: background 0.3s;
    }

    .toggle-switch.active {
      background: #667eea;
    }

    .toggle-slider {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      background: white;
      border-radius: 50%;
      transition: transform 0.3s;
    }

    .toggle-switch.active .toggle-slider {
      transform: translateX(26px);
    }

    .stat-icon {
      width: 60px;
      height: 60px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      color: white;
      margin-bottom: 15px;
    }

    .recent-logs {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 15px;
      padding: 25px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      cursor: default;
    }

    .log-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(0, 0, 0, 0.1);
      transition: background 0.3s ease;
    }

    .log-item:hover {
      background: rgba(102, 126, 234, 0.05);
      border-radius: 8px;
      padding-left: 10px;
      padding-right: 10px;
    }

    .fade-in {
      animation: fadeIn 0.5s ease-in;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }

      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .last-updated {
      font-size: 12px;
      color: #666;
      margin-top: 10px;
      text-align: center;
    }

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

    .alert {
      padding: 15px;
      margin-bottom: 20px;
      border: 1px solid transparent;
      border-radius: 4px;
    }

    .alert-danger {
      color: #721c24;
      background-color: #f8d7da;
      border-color: #f5c6cb;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .stat-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 15px;
      padding: 25px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }

    .stat-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
    }
  </style>
</head>

<body>

  <div id="closeButton" class="close-button" role="button" tabindex="0" aria-label="Close" onclick="window.history.back();">
    <i class="fas fa-times"></i>
  </div>

  <main class="db-cont">
    <section class="welcome-card">
      <div>
        <h1><i class="fas fa-tachometer-alt"></i> DTL Dashboard</h1>
        <p>Welcome back, <?php echo htmlspecialchars($username); ?></p>
      </div>

      <div class="auto-update-controls">
        <div class="update-status">
          <div class="status-indicator" id="statusIndicator"></div>
          <span id="statusText">Live Updates</span>
        </div>

        <div class="auto-update-toggle" onclick="toggleAutoUpdate()">
          <span>Auto Update</span>
          <div class="toggle-switch active" id="toggleSwitch">
            <div class="toggle-slider"></div>
          </div>
        </div>

        <button onclick="manualUpdate()" style="background: #667eea; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer;">
          <i class="fas fa-refresh"></i> Refresh
        </button>
      </div>
    </section>

    <?php if (!$databaseConnected): ?>
      <div class="alert alert-danger">
        <strong>Database Connection Error:</strong> <?php echo htmlspecialchars($dbError); ?>
      </div>
    <?php else: ?>
      <section class="stats-grid" id="statsGrid">
        <div class="stat-card">
          <div class="stat-icon" style="background: linear-gradient(135deg, #667eea, #764ba2);">
            <i class="fas fa-users"></i>
          </div>
          <h3>Total Scanned</h3>
          <p style="font-size: 28px; font-weight: bold; color: #333; margin-top: 8px;" id="totalScanned">
            <?php echo number_format($stats['total_scanned']); ?>
          </p>
        </div>

        <div class="stat-card">
          <div class="stat-icon" style="background: linear-gradient(135deg, #28a745, #20c997);">
            <i class="fas fa-user-check"></i>
          </div>
          <h3>Active Employees</h3>
          <p style="font-size: 28px; font-weight: bold; color: #28a745; margin-top: 8px;" id="activeEmployees">
            <?php echo number_format($stats['active_employees']); ?>
          </p>
        </div>

        <div class="stat-card">
          <div class="stat-icon" style="background: linear-gradient(135deg, #dc3545, #fd7e14);">
            <i class="fas fa-user-times"></i>
          </div>
          <h3>Inactive Employees</h3>
          <p style="font-size: 28px; font-weight: bold; color: #dc3545; margin-top: 8px;" id="inactiveEmployees">
            <?php echo number_format($stats['inactive_employees']); ?>
          </p>
        </div>

        <div class="stat-card">
          <div class="stat-icon" style="background: linear-gradient(135deg, #17a2b8, #6f42c1);">
            <i class="fas fa-calendar-day"></i>
          </div>
          <h3>Today's Attendance</h3>
          <p style="font-size: 28px; font-weight: bold; color: #17a2b8; margin-top: 8px;" id="todayAttendance">
            <?php echo number_format($stats['today_attendance']); ?>
          </p>
          <small style="color: #666;">
            In: <span id="todayIn"><?php echo $stats['today_in']; ?></span> |
            Out: <span id="todayOut"><?php echo $stats['today_out']; ?></span>
          </small>
        </div>
      </section>

      <div class="recent-logs">
        <h3><i class="fas fa-history"></i> Recent Activity</h3>
        <div id="recentLogsList">
          <?php if (empty($recentLogs)): ?>
            <p style="text-align: center; color: #666; padding: 20px;">No recent activity found.</p>
          <?php else: ?>
            <?php foreach ($recentLogs as $log): ?>
              <div class="log-item">
                <div>
                  <strong><?php echo htmlspecialchars($log['fullname'] ?? 'Unknown'); ?></strong>
                  <br>
                  <small style="color: #666;"><?php echo htmlspecialchars($log['action'] ?? 'Access Log'); ?></small>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 14px; color: #333;">
                    <?php
                    $timestamp = $log['timestamp'] ?? $log['access_timestamp'] ?? '';
                    if ($timestamp) {
                      echo date('M j, H:i', strtotime($timestamp));
                    } else {
                      echo 'N/A';
                    }
                    ?>
                  </div>
                </div>
              </div>
            <?php endforeach; ?>
          <?php endif; ?>
        </div>

        <div class="last-updated" id="lastUpdated">
          Last updated: <?php echo date('M j, Y H:i:s'); ?>
        </div>
      </div>
    <?php endif; ?>
  </main>

  <script src="../src/btn.js"></script>
  <script src="../src/req.js"></script>
  <script src="../src/ver.js"></script>
  <script>
    let autoUpdateEnabled = true;
    let updateInterval;
    let isUpdating = false;

    // Initialize auto-update
    document.addEventListener('DOMContentLoaded', function() {
      startAutoUpdate();
    });

    function startAutoUpdate() {
      if (autoUpdateEnabled && !updateInterval) {
        updateInterval = setInterval(updateDashboard, 10000); // Update every 10 seconds
        updateStatusDisplay('active', 'Live Updates (10s)');
      }
    }

    function stopAutoUpdate() {
      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
        updateStatusDisplay('inactive', 'Updates Paused');
      }
    }

    function toggleAutoUpdate() {
      autoUpdateEnabled = !autoUpdateEnabled;
      const toggleSwitch = document.getElementById('toggleSwitch');

      if (autoUpdateEnabled) {
        toggleSwitch.classList.add('active');
        startAutoUpdate();
      } else {
        toggleSwitch.classList.remove('active');
        stopAutoUpdate();
      }
    }

    function updateStatusDisplay(status, text) {
      const indicator = document.getElementById('statusIndicator');
      const statusText = document.getElementById('statusText');

      indicator.className = 'status-indicator';
      if (status === 'updating') {
        indicator.classList.add('updating');
      } else if (status === 'error') {
        indicator.classList.add('error');
      }

      statusText.textContent = text;
    }

    function manualUpdate() {
      updateDashboard();
    }

    async function updateDashboard() {
      if (isUpdating) return;

      isUpdating = true;
      updateStatusDisplay('updating', 'Updating...');

      try {
        const response = await fetch(window.location.pathname + '?ajax=update');

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        // Update statistics with fade-in animation
        updateStatistic('totalScanned', data.stats.total_scanned);
        updateStatistic('activeEmployees', data.stats.active_employees);
        updateStatistic('inactiveEmployees', data.stats.inactive_employees);
        updateStatistic('todayAttendance', data.stats.today_attendance);
        updateStatistic('todayIn', data.stats.today_in);
        updateStatistic('todayOut', data.stats.today_out);

        // Update recent logs
        updateRecentLogs(data.recentLogs);

        // Update last updated time
        document.getElementById('lastUpdated').textContent =
          'Last updated: ' + new Date(data.lastUpdate).toLocaleString();

        updateStatusDisplay('active', autoUpdateEnabled ? 'Live Updates (10s)' : 'Updated');

      } catch (error) {
        console.error('Update failed:', error);
        updateStatusDisplay('error', 'Update Failed');
      } finally {
        isUpdating = false;
      }
    }

    function updateStatistic(elementId, newValue) {
      const element = document.getElementById(elementId);
      if (element && element.textContent !== newValue.toLocaleString()) {
        element.classList.add('fade-in');
        element.textContent = newValue.toLocaleString();
        setTimeout(() => element.classList.remove('fade-in'), 500);
      }
    }

    function updateRecentLogs(logs) {
      const container = document.getElementById('recentLogsList');

      if (logs.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No recent activity found.</p>';
        return;
      }

      let html = '';
      logs.forEach(log => {
        const timestamp = log.timestamp || log.access_timestamp || '';
        let formattedDate = 'N/A';

        if (timestamp) {
          const date = new Date(timestamp);
          formattedDate = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
          }) + ', ' + date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
        }

        html += `
                    <div class="log-item">
                        <div>
                            <strong>${escapeHtml(log.fullname || 'Unknown')}</strong>
                            <br>
                            <small style="color: #666;">${escapeHtml(log.action || 'Access Log')}</small>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 14px; color: #333;">
                                ${formattedDate}
                            </div>
                        </div>
                    </div>
                `;
      });

      container.innerHTML = html;
      container.classList.add('fade-in');
      setTimeout(() => container.classList.remove('fade-in'), 500);
    }

    function escapeHtml(text) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    // Handle page visibility changes to pause/resume updates
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        stopAutoUpdate();
      } else if (autoUpdateEnabled) {
        startAutoUpdate();
        updateDashboard(); // Immediate update when page becomes visible
      }
    });
  </script>
</body>

</html>