<?php
// resource/views/iframe/main.php --> main panel controller

require_once __DIR__ . '/../../../config/config.php';
require_once __DIR__ . '/../../../config/db.php';

requireAccess('main', '../../../proximity.php', true);
$access = getMenuAccess();

$userId = $_SESSION['user_id'] ?? null;
$userGroup = $_SESSION['user_group'] ?? '';

// ── Page router ──
$page = $_GET['page'] ?? null;

// Pages that are full standalone HTML — render them in an iframe wrapper, not included directly
$iframePages = ['admin panel', 'account', 'employee dashboard', 'settings'];

// Pages safe to include directly (they output only a fragment, no full HTML shell)
$includedPages = ['account', 'employee dashboard', 'f-pass', 'reg', 'settings'];

if ($page && in_array($page, $iframePages)) {
  $safePageName = htmlspecialchars($page, ENT_QUOTES);
  $iframeSrc    = '../' . rawurlencode($page) . '.php?_standalone=1';
  echo '<!DOCTYPE html><html><head><meta charset="UTF-8">';
  echo '<style>*{margin:0;padding:0;box-sizing:border-box;}html,body{height:100%;overflow:hidden;}';
  echo 'iframe{width:100%;height:100%;border:none;display:block;}</style></head><body>';
  echo '<iframe src="' . $iframeSrc . '" allowfullscreen></iframe>';
  echo '</body></html>';
  exit();
}

if ($page && in_array($page, $includedPages)) {
  include __DIR__ . '/../' . $page . '.php';
  exit();
}

if (!isset($_SESSION['user_id'])) {
  header('Location: ../../../index.php');
  exit();
}

// Get dashboard statistics
$stats = [
  'total_employees' => 0,
  'active_employees' => 0,
  'inactive_employees' => 0,
  'total_scanned' => 0,
  'active_scan' => 0,
  'inactive_scan' => 0,
  'today_attendance' => 0,
  'check_in' => 0,
  'check_out' => 0,
  'total_proxcode' => 0,
];

try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
  $requiredTables = ['employees', 'code', 'employee_access_log', 'check_in_out'];
  $missingTables = [];

  if ($databaseConnected) {
    try {
      foreach ($requiredTables as $table) {
        $stmt = $userDb->prepare("
        SELECT COUNT(*) FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ");
        $stmt->execute([$table]);
        if ((int)$stmt->fetchColumn() === 0) {
          $missingTables[] = $table;
        }
      }
      if (!empty($missingTables)) {
        $databaseConnected = false;
      }
    } catch (PDOException $e) {
      $databaseConnected = false;
      $dbError = "Error checking tables: " . $e->getMessage();
    }
  }
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError = $e->getMessage();
}

if ($databaseConnected) {
  try {
    // Employee stats
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees");
    $stmt->execute();
    $stats['total_employees'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees WHERE status = 'Active'");
    $stmt->execute();
    $stats['active_employees'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees WHERE status = 'Inactive'");
    $stmt->execute();
    $stats['inactive_employees'] = (int)$stmt->fetchColumn();

    // Access log stats
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log");
    $stmt->execute();
    $stats['total_scanned'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE status = 'Active'");
    $stmt->execute();
    $stats['active_scan'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE status = 'Inactive'");
    $stmt->execute();
    $stats['inactive_scan'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_attendance'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'IN'");
    $stmt->execute();
    $stats['check_in'] = (int)$stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'OUT'");
    $stmt->execute();
    $stats['check_out'] = (int)$stmt->fetchColumn();

    // Proximity codes
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM code");
    $stmt->execute();
    $stats['total_proxcode'] = (int)$stmt->fetchColumn();

    // Recent logs
    $stmt = $userDb->prepare("
      SELECT el.*,
             COALESCE(NULLIF(TRIM(el.fullname), ''), e.fullname, 'Unknown Employee') AS fullname
      FROM employee_access_log el
      LEFT JOIN employees e ON el.employee_id = e.id
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
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase ?? 'My Database'); ?> - Dashboard</title>
  <link rel="icon" href="../../assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link rel="stylesheet" href="../../css/main.css">
  <link rel="stylesheet" href="../../css/loading.css">
</head>

<body>
  <!-- Loading Screen -->
  <div id="loading-screen">
    <div class="loading-content">
      <div class="spinner"></div>
      <div class="loading-text">Loading...</div>
      <div class="loading-subtext">Please wait while we prepare your content</div>
    </div>
  </div>

  <!-- Top shortcut nav -->
  <div class="shortcut-bar">
    <?php if ($access['table panel']): ?>
      <div class="shortcut-item" onclick="navigateWithLoading('../../../app/services/table panel.php?tab=employees');">
        <i class="fas fa-users"></i>
        <span>Employees</span>
      </div>
    <?php endif; ?>
    <?php if ($access['scan test']): ?>
      <div class="shortcut-item" onclick="navigateWithLoading('../../../app/http/controllers/scan test.php');">
        <i class="fas fa-qrcode"></i>
        <span>Scan Test</span>
      </div>
    <?php endif; ?>
    <?php if ($access['admin panel']): ?>
      <div class="shortcut-item" onclick="navigateWithLoading('../admin panel.php#users');">
        <i class="fas fa-user-shield"></i>
        <span>Admin Panel</span>
      </div>
    <?php endif; ?>
    <div class="shortcut-item" onclick="location.reload();">
      <i class="fas fa-sync-alt"></i>
      <span>Refresh</span>
    </div>
  </div>

  <div class="page-body">

    <!-- Welcome banner -->
    <div class="welcome-banner">
      <div class="wb-left">
        <h2><i class="fas fa-server" style="margin-right:8px;opacity:.8;"></i>Management Panel</h2>
        <p>Welcome back, <strong><?= htmlspecialchars($username ?? 'User'); ?></strong> &nbsp;&middot;&nbsp; <?= htmlspecialchars($email ?? ''); ?></p>
        <?php if ($databaseConnected): ?>
          <div class="status-pill ok"><i class="fas fa-circle"></i> Database connected</div>
        <?php else: ?>
          <div class="status-pill err"><i class="fas fa-exclamation-circle"></i> Network connection error</div>
        <?php endif; ?>
      </div>
      <div class="wb-right">
        <i class="fas fa-clock" style="margin-right:4px;"></i>
        <span id="wb-time"></span><br>
        <span id="wb-date" style="margin-top:3px;display:block;"></span>
      </div>
    </div>

    <!-- Status summary row -->
    <div class="status-row">
      <div class="status-item">
        <div class="status-dot blue"></div>
        <div class="status-info">
          <div class="status-label">Total Employees</div>
          <div class="status-value" id="stat-total"><?php echo number_format($stats['total_employees']); ?></div>
        </div>
      </div>
      <div class="status-item">
        <div class="status-dot purple"></div>
        <div class="status-info">
          <div class="status-label">Active Proximity Codes</div>
          <div class="status-value" id="stat-codes"><?php echo number_format($stats['total_proxcode']); ?></div>
        </div>
      </div>
      <div class="status-item">
        <div class="status-dot green"></div>
        <div class="status-info">
          <div class="status-label">Total Checked In</div>
          <div class="status-value" id="stat-in"><?php echo number_format($stats['check_in']); ?></div>
        </div>
      </div>
      <div class="status-item">
        <div class="status-dot orange"></div>
        <div class="status-info">
          <div class="status-label">Total Checked Out</div>
          <div class="status-value" id="stat-out"><?php echo number_format($stats['check_out']); ?></div>
        </div>
      </div>
      <div class="status-item">
        <div class="status-dot <?= $databaseConnected ? 'green' : 'red'; ?>"></div>
        <div class="status-info">
          <div class="status-label">Status</div>
          <div class="status-value" style="font-size:14px;margin-top:2px;">
            <?= $databaseConnected ? 'Online' : 'Offline'; ?>
          </div>
        </div>
      </div>
    </div>

    <!-- Two-column: shortcuts + menu -->
    <div class="two-col">

      <!-- Left: Quick access -->
      <div>
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-bolt" style="color:#f59e0b;margin-right:6px;"></i>Quick Access</span>
          </div>
          <div class="card-body">
            <div class="shortcuts-grid">

              <?php if ($access['system']): ?>
                <div class="sc-card" onclick="navigateWithLoading('../../../app/services/table panel.php?tab=employees');">
                  <div class="sc-icon"><i class="fas fa-user-plus"></i></div>
                  <div class="sc-label">Input Employee</div>
                </div>
              <?php endif; ?>

              <?php if ($access['datalog']): ?>
                <div class="sc-card" onclick="navigateWithLoading('../../../app/services/table panel.php?tab=datalog');">
                  <div class="sc-icon"><i class="fas fa-list-check"></i></div>
                  <div class="sc-label">Scanned Log</div>
                </div>
              <?php endif; ?>

              <?php if ($access['proximity code']): ?>
                <div class="sc-card" onclick="navigateWithLoading('../../../app/services/table panel.php?tab=proximity');">
                  <div class="sc-icon">
                    <img src="../../../resource/assets/logo/nfc-logo.svg" alt="NFC"
                      class="icon-accent" style="width:18px;height:18px;">
                  </div>
                  <div class="sc-label">Proximity Center</div>
                </div>
              <?php endif; ?>

              <?php if ($access['scan test']): ?>
                <div class="sc-card" onclick="navigateWithLoading('../../../app/http/controllers/scan test.php');">
                  <div class="sc-icon"><i class="fas fa-qrcode"></i></div>
                  <div class="sc-label">Test Live Search</div>
                </div>
              <?php endif; ?>

              <?php if ($access['employee dashboard']): ?>
                <div class="sc-card" onclick="navigateWithLoading('../employee dashboard.php');">
                  <div class="sc-icon"><i class="fas fa-chart-line"></i></div>
                  <div class="sc-label">Insights</div>
                </div>
              <?php endif; ?>

              <?php if ($access['account info']): ?>
                <div class="sc-card" onclick="navigateWithLoading('../account.php');">
                  <div class="sc-icon"><i class="fas fa-id-card"></i></div>
                  <div class="sc-label">Account Info</div>
                </div>
              <?php endif; ?>

            </div>
          </div>
        </div>
      </div>

      <!-- Right: Module cards -->
      <div>
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-th-large" style="color:#6366f1;margin-right:6px;"></i>Modules</span>
          </div>
          <div class="card-body">
            <div class="menu-list">

              <?php if ($access['table panel']): ?>
                <div class="menu-card" onclick="navigateWithLoading('../../../app/services/table panel.php?tab=employees');">
                  <div class="mc-icon" style="background:#eff6ff; color:#2563eb;">
                    <img src="../../assets/logo/mysql-logo.svg" alt="MySQL" style="width:26px;height:26px;object-fit:contain;">
                  </div>
                  <div class="mc-info">
                    <div class="mc-title">Employee Manager</div>
                    <div class="mc-desc">Manage employee records and information</div>
                  </div>
                  <div class="mc-action"><i class="fas fa-arrow-right"></i> Open</div>
                </div>
              <?php endif; ?>

              <?php if ($access['scan test']): ?>
                <div class="menu-card" onclick="navigateWithLoading('../../../app/http/controllers/scan test.php');">
                  <div class="mc-icon" style="background:#f0fdf4; color:#16a34a;">
                    <img src="../../assets/icon/nfc-icon.svg" alt="NFC" style="width:26px;height:26px;object-fit:contain;">
                  </div>
                  <div class="mc-info">
                    <div class="mc-title">Test Live Search</div>
                    <div class="mc-desc">Web Proximity verifier application</div>
                  </div>
                  <div class="mc-action"><i class="fas fa-arrow-right"></i> Open</div>
                </div>
              <?php endif; ?>

              <?php if ($access['m-i v2']): ?>
                <div class="menu-card disabled">
                  <div class="mc-icon" style="background:#f8fafc; color:#94a3b8;">
                    <img src="../../assets/logo/coming-soon.svg" alt="Coming Soon" style="width:26px;height:26px;object-fit:contain;">
                  </div>
                  <div class="mc-info">
                    <div class="mc-title">Under Development</div>
                    <div class="mc-desc">This area is reserved for future development</div>
                  </div>
                  <div class="mc-badge">Coming Soon</div>
                </div>
              <?php endif; ?>

            </div>
          </div>
        </div>
      </div>

    </div><!-- /.two-col -->

  </div><!-- /.page-body -->

  <script src="../../js/req.js"></script>
  <script src="../../js/loading.js"></script>
  <script>
    // Live clock
    function updateTime() {
      const now = new Date();
      document.getElementById('wb-time').textContent = now.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      document.getElementById('wb-date').textContent = now.toLocaleDateString([], {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    }
    updateTime();
    setInterval(updateTime, 1000);

    // Frame guard
    function attachFrameGuard(frame) {
      frame.addEventListener('load', function() {
        try {
          const frameUrl = this.contentWindow.location.href;
          if (frameUrl.includes('index.php') || frameUrl.includes('login')) {
            window.top.location.href = frameUrl;
          }
        } catch (e) {
          window.top.location.href = 'index.php';
        }
      });
    }
    document.querySelectorAll('.tab-frame').forEach(attachFrameGuard);
  </script>
</body>

</html>