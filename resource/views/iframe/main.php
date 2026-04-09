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
  <link rel="stylesheet" href="../../css/loading.css">
  <style>
    *,
    *::before,
    *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :root {
      --accent: #2563eb;
      --accent-light: #eff6ff;
      --bg: #f0f2f5;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #1e293b;
      --text-muted: #64748b;
      --radius: 8px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* ── Top nav bar ── */
    .shortcut-bar {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 20px;
      display: flex;
      align-items: center;
      gap: 4px;
      overflow-x: auto;
      min-height: 46px;
      flex-shrink: 0;
    }

    .shortcut-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 6px 14px;
      cursor: pointer;
      border-radius: 6px;
      color: var(--text-muted);
      white-space: nowrap;
      transition: background 0.15s, color 0.15s;
      font-size: 12px;
      min-width: 64px;
    }

    .shortcut-item i {
      font-size: 15px;
    }

    .shortcut-item:hover {
      background: var(--bg);
      color: var(--accent);
    }

    .shortcut-item.new-badge {
      position: relative;
    }

    .shortcut-item .badge {
      position: absolute;
      top: 4px;
      right: 8px;
      background: #ef4444;
      color: white;
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 4px;
      font-weight: 600;
    }

    /* ── Page body ── */
    .page-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
      flex: 1;
    }

    /* ── Status summary row ── */
    .status-row {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 20px;
      display: flex;
      align-items: center;
      gap: 0;
    }

    .status-item {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 16px;
      border-right: 1px solid var(--border);
    }

    .status-item:first-child {
      padding-left: 0;
    }

    .status-item:last-child {
      border-right: none;
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.blue {
      background: #3b82f6;
    }

    .status-dot.pink {
      background: #ec4899;
    }

    .status-dot.purple {
      background: #8b5cf6;
    }

    .status-dot.red {
      background: #ef4444;
    }

    .status-dot.orange {
      background: #f97316;
    }

    .status-dot.green {
      background: #22c55e;
    }

    .status-info {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .status-label {
      font-size: 11px;
      color: var(--text-muted);
    }

    .status-value {
      font-size: 20px;
      font-weight: 700;
      color: var(--text);
      line-height: 1.1;
    }

    /* ── Two-column layout ── */
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    /* ── Section cards ── */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }

    .card-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }

    .card-body {
      padding: 16px;
    }

    /* ── Shortcuts grid ── */
    .shortcuts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 12px;
    }

    .sc-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 7px;
      padding: 14px 8px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      text-align: center;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
      background: var(--surface);
      text-decoration: none;
      color: var(--text);
    }

    .sc-card:hover {
      background: var(--accent-light);
      border-color: #bfdbfe;
      transform: translateY(-1px);
    }

    .sc-card .sc-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      color: var(--accent);
    }

    .sc-card .sc-label {
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
      color: var(--text);
    }

    /* ── Menu cards (large) ── */
    .menu-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .menu-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      background: var(--surface);
      text-decoration: none;
      color: var(--text);
    }

    .menu-card:hover {
      background: var(--accent-light);
      border-color: #bfdbfe;
    }

    .menu-card .mc-icon {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: var(--bg);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 20px;
    }

    .menu-card.disabled {
      opacity: 0.55;
      cursor: default;
      background: #f8fafc;
    }

    .menu-card.disabled:hover {
      background: #f8fafc;
      border-color: var(--border);
    }

    .mc-info {
      flex: 1;
      min-width: 0;
    }

    .mc-title {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 2px;
    }

    .mc-desc {
      font-size: 12px;
      color: var(--text-muted);
    }

    .mc-action {
      flex-shrink: 0;
      font-size: 12px;
      color: var(--accent);
      background: var(--accent-light);
      padding: 5px 12px;
      border-radius: 6px;
      font-weight: 500;
      white-space: nowrap;
      border: 1px solid #bfdbfe;
      transition: background 0.15s;
    }

    .menu-card:hover .mc-action {
      background: #dbeafe;
    }

    .mc-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      background: #fef9c3;
      color: #92400e;
      border: 1px solid #fde68a;
    }

    /* ── Welcome banner ── */
    .welcome-banner {
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      border-radius: var(--radius);
      padding: 18px 22px;
      color: white;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .wb-left h2 {
      font-size: 17px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .wb-left p {
      font-size: 13px;
      opacity: 0.85;
    }

    .wb-right {
      font-size: 12px;
      opacity: 0.8;
      text-align: right;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 12px;
      font-weight: 500;
      margin-top: 6px;
    }

    .status-pill.ok {
      background: rgba(255, 255, 255, 0.2);
      color: #bbf7d0;
    }

    .status-pill.err {
      background: rgba(239, 68, 68, 0.3);
      color: #fca5a5;
    }

    .status-pill i {
      font-size: 9px;
    }
  </style>
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
        <div class="status-dot purple"></div>
        <div class="status-info">
          <div class="status-label">Active Proximity Codes</div>
          <div class="status-value" id="stat-codes"><?php echo number_format($stats['total_proxcode']); ?></div>
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
                  <div class="sc-icon"><img src="../../../resource/assets/logo/nfc-logo.svg" alt="NFC" style="width:18px;height:18px;"></div>
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