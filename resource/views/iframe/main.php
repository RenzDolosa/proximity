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
  'total_employees'   => 0,
  'active_employees'  => 0,
  'inactive_employees' => 0,
  'total_scanned'     => 0,
  'active_scan'       => 0,
  'inactive_scan'     => 0,
  'today_attendance'  => 0,
  'check_in'          => 0,
  'check_out'         => 0,
  'total_proxcode'    => 0,
];

try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
  $requiredTables = ['employees', 'code', 'employee_access_log', 'check_in_out'];
  $missingTables  = [];

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

    // Gate activity stats
    $stmt = $userDb->prepare("
      SELECT u.first_name AS gate_name, COUNT(*) AS total
      FROM employee_access_log el
      LEFT JOIN " . DB_NAME . ".users u ON el.user_id = u.id
      WHERE el.user_id IS NOT NULL
      GROUP BY el.user_id, u.first_name
      ORDER BY total DESC
      LIMIT 10
    ");
    $stmt->execute();
    $gateStats = $stmt->fetchAll();

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

    <div class="two-col">

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

              <?php if ($access['violation']): ?>
                <div class="sc-card" onclick="navigateWithLoading('../../../app/services/violation_log.php');">
                  <div class="sc-icon"><i class="fas fa-exclamation-triangle"></i></div>
                  <div class="sc-label">Violation</div>
                </div>
              <?php endif; ?>

            </div>
          </div>
        </div>
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

    <!-- ── Attendance chart ── -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <i class="fas fa-chart-line" style="color:#3b82f6;margin-right:6px;"></i>
          <span id="chart-title-label">Hourly Attendance</span>
        </span>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;color:var(--text-muted);" id="chart-updated"></span>
          <div style="display:flex;border:1px solid var(--border);border-radius:6px;overflow:hidden;">
            <button id="btn-today" onclick="setChartTab('volume')"
              style="font-size:11px;padding:4px 10px;border:none;cursor:pointer;
                    background:var(--accent);color:#fff;font-weight:500;">Today</button>
            <button id="btn-15" onclick="setDayRange(15)"
              style="font-size:11px;padding:4px 10px;border:none;cursor:pointer;
                    background:var(--surface);color:var(--text-muted);border-left:1px solid var(--border);">Past 15 Days</button>
            <button id="btn-30" onclick="setDayRange(30)"
              style="font-size:11px;padding:4px 10px;border:none;cursor:pointer;
                    background:var(--surface);color:var(--text-muted);border-left:1px solid var(--border);">Recent 30 Days</button>
          </div>
        </div>
      </div>
      <div class="card-body" style="padding-bottom:20px;">

        <!-- Tab strip -->
        <div id="chart-tabs" style="display:flex;gap:24px;margin-bottom:16px;border-bottom:1px solid var(--border);">
          <span id="tab-volume"
            onclick="setChartTab('volume')"
            style="font-size:13px;font-weight:500;padding-bottom:10px;cursor:pointer;
                  color:var(--text);border-bottom:2px solid var(--accent);">Volume</span>
          <span id="tab-checkin"
            onclick="setChartTab('checkin')"
            style="font-size:13px;padding-bottom:10px;cursor:pointer;
                  color:var(--text-muted);border-bottom:2px solid transparent;">Check In</span>
          <span id="tab-checkout"
            onclick="setChartTab('checkout')"
            style="font-size:13px;padding-bottom:10px;cursor:pointer;
                  color:var(--text-muted);border-bottom:2px solid transparent;">Check Out</span>
        </div>

        <!-- Canvas -->
        <div style="position:relative;width:100%;height:260px;">
          <canvas id="attendanceChart"
            role="img"
            aria-label="Line chart showing today and yesterday attendance counts by hour">
            Hourly attendance data comparing today and yesterday.
          </canvas>
        </div>

        <!-- Legend -->
        <div id="chart-legend" style="display:flex;justify-content:center;gap:20px;margin-top:12px;font-size:12px;color:var(--text-muted);">
          <span style="display:flex;align-items:center;gap:5px;">
            <span style="display:inline-block;width:16px;height:2px;background:#f97316;border-radius:1px;position:relative;">
              <span style="position:absolute;top:-4px;left:3px;width:8px;height:8px;border-radius:50%;border:2px solid #f97316;background:var(--surface);"></span>
            </span>
            Today
          </span>
          <span style="display:flex;align-items:center;gap:5px;">
            <span style="display:inline-block;width:16px;height:2px;background:#3b82f6;border-radius:1px;position:relative;">
              <span style="position:absolute;top:-4px;left:3px;width:8px;height:8px;border-radius:50%;border:2px solid #3b82f6;background:var(--surface);"></span>
            </span>
            Yesterday
          </span>
        </div>

      </div>
    </div>
    <!-- ── /Attendance chart ── -->

    <!-- Two-column: shortcuts + menu -->
    <div class="two-col">

      <!-- Left: Quick access -->
      <div>
        <!-- Gate Activity Chart -->
        <div class="card">
          <div class="card-header">
            <span class="card-title">
              <i class="fas fa-door-open" style="color:#ec4899;margin-right:6px;"></i>
              Gate Scanned Statistics
            </span>
          </div>
          <div class="card-body" style="display:flex;align-items:center;justify-content:center;gap:32px;padding:20px;">
            <div style="position:relative;width:180px;height:180px;flex-shrink:0;">
              <canvas id="gateChart"></canvas>
              <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                text-align:center;pointer-events:none;">
                <div id="gate-total-count" style="font-size:22px;font-weight:700;color:var(--text);">
                  <?= number_format(array_sum(array_column($gateStats, 'total'))); ?>
                </div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Total Scans</div>
              </div>
            </div>
            <div id="gate-legend" style="display:flex;flex-direction:column;gap:8px;min-width:160px;">
              <?php if (!empty($gateStats)):
                $gateColors = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316', '#06b6d4', '#84cc16', '#a855f7', '#14b8a6'];
                $gateTotal  = array_sum(array_column($gateStats, 'total'));
                foreach ($gateStats as $i => $gate):
                  $color = $gateColors[$i % count($gateColors)];
                  $pct   = $gateTotal > 0 ? round(($gate['total'] / $gateTotal) * 100, 1) : 0;
                  $name  = htmlspecialchars($gate['gate_name'] ?? 'Unknown');
              ?>
                  <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
                    <span style="width:10px;height:10px;border-radius:50%;background:<?= $color ?>;flex-shrink:0;"></span>
                    <span style="color:var(--text);flex:1;"><?= $name ?></span>
                    <span style="color:var(--text-muted);font-weight:600;">
                      <?= number_format($gate['total']) ?> <span style="font-weight:400;">(<?= $pct ?>%)</span>
                    </span>
                  </div>
                <?php endforeach;
              else: ?>
                <div class="no-data" style="padding:30px 0;">
                  <i class="fas fa-door-open"></i>
                  No gate scan data available.
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
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>

  <script>
    // ── Live clock ──────────────────────────────────────────────────────────────
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

    // ── Gate chart colors ─────────────────────────────────────────────────────────
    const gateColors = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6',
      '#f97316', '#06b6d4', '#84cc16', '#a855f7', '#14b8a6'
    ];

    // ── Init gate chart ───────────────────────────────────────────────────────────
    let gateChart = null;
    (function() {
      <?php if (!empty($gateStats)): ?>
        const gateLabels = <?= json_encode(array_map(fn($g) => $g['gate_name'] ?? 'Unknown', $gateStats)); ?>;
        const gateData = <?= json_encode(array_column($gateStats, 'total')); ?>;
        const isDark = matchMedia('(prefers-color-scheme: dark)').matches;

        gateChart = new Chart(document.getElementById('gateChart'), {
          type: 'doughnut',
          data: {
            labels: gateLabels,
            datasets: [{
              data: gateData,
              backgroundColor: gateColors.slice(0, gateData.length),
              borderColor: isDark ? '#1e293b' : '#ffffff',
              borderWidth: 3,
              hoverOffset: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                backgroundColor: isDark ? '#1e293b' : '#fff',
                borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
                borderWidth: 1,
                titleColor: isDark ? '#f1f5f9' : '#1e293b',
                bodyColor: isDark ? '#94a3b8' : '#64748b',
                callbacks: {
                  label(item) {
                    const total = item.dataset.data.reduce((a, b) => a + b, 0);
                    const pct = total > 0 ? ((item.parsed / total) * 100).toFixed(1) : 0;
                    return '  ' + item.label + ': ' + item.parsed.toLocaleString() + ' (' + pct + '%)';
                  }
                }
              }
            }
          }
        });
      <?php endif; ?>
    })();

    // ── Frame guard ─────────────────────────────────────────────────────────────
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

    // ── Attendance chart ────────────────────────────────────────────────────────
    const HOURS = [
      '00:00', '01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00',
      '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00',
      '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'
    ];

    // Populated by fetchAttendanceData(); defaults to zeros so chart renders
    // immediately while the fetch is in flight.
    let chartDatasets = {
      volume: {
        today: new Array(24).fill(0),
        yesterday: new Array(24).fill(0)
      },
      checkin: {
        today: new Array(24).fill(0),
        yesterday: new Array(24).fill(0)
      },
      checkout: {
        today: new Array(24).fill(0),
        yesterday: new Array(24).fill(0)
      }
    };

    let currentChartTab = 'volume';
    let attendanceChart;

    // Bucket raw log rows into per-hour arrays for today and yesterday
    function buildHourlyBuckets(rows) {
      const out = {
        volume: {
          today: new Array(24).fill(0),
          yesterday: new Array(24).fill(0)
        },
        checkin: {
          today: new Array(24).fill(0),
          yesterday: new Array(24).fill(0)
        },
        checkout: {
          today: new Array(24).fill(0),
          yesterday: new Array(24).fill(0)
        }
      };

      const todayStr = new Date().toDateString();
      const yd = new Date();
      yd.setDate(yd.getDate() - 1);
      const yesterdayStr = yd.toDateString();

      rows.forEach(function(row) {
        const ts = new Date(row.access_timestamp);
        if (isNaN(ts)) return;
        const h = ts.getHours();
        const day = ts.toDateString();

        let bucket = null;
        if (day === todayStr) bucket = 'today';
        else if (day === yesterdayStr) bucket = 'yesterday';
        if (!bucket) return;

        out.volume[bucket][h]++;

        const status = (row.check_status || '').toUpperCase();
        if (status === 'IN') out.checkin[bucket][h]++;
        if (status === 'OUT') out.checkout[bucket][h]++;
      });

      return out;
    }

    // Fetch log rows for the current month (covers today + yesterday)
    function fetchAttendanceData() {
      const yearMonth = new Date().toISOString().slice(0, 7); // e.g. "2025-07"
      const url = '../../../app/services/datalog_backend.php' +
        '?action=list' +
        '&access_timestamp=' + encodeURIComponent(yearMonth);

      fetch(url, {
          headers: {
            'X-Requested-With': 'XMLHttpRequest'
          }
        })
        .then(function(res) {
          return res.json();
        })
        .then(function(json) {
          if (json.success && Array.isArray(json.data)) {
            chartDatasets = buildHourlyBuckets(json.data);
          }
          renderChart(currentChartTab);

          const el = document.getElementById('chart-updated');
          if (el) {
            el.textContent = 'Updated ' + new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            });
          }
        })
        .catch(function(err) {
          console.warn('Attendance chart: fetch failed, showing zeros.', err);
          renderChart(currentChartTab);
        });
    }

    function renderChart(tab) {
      const d = chartDatasets[tab];
      const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
      const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
      const tickColor = isDark ? '#9ca3af' : '#94a3b8';

      if (attendanceChart) attendanceChart.destroy();

      attendanceChart = new Chart(document.getElementById('attendanceChart'), {
        type: 'line',
        data: {
          labels: HOURS,
          datasets: [{
              label: 'Today',
              data: d.today,
              borderColor: '#f97316',
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              pointBackgroundColor: 'transparent',
              pointBorderColor: '#f97316',
              pointRadius: 4,
              pointHoverRadius: 5,
              tension: 0.3,
              borderDash: []
            },
            {
              label: 'Yesterday',
              data: d.yesterday,
              borderColor: '#3b82f6',
              backgroundColor: 'transparent',
              borderWidth: 1.5,
              pointBackgroundColor: 'transparent',
              pointBorderColor: '#3b82f6',
              pointRadius: 4,
              pointHoverRadius: 5,
              tension: 0.3,
              borderDash: [4, 3]
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              backgroundColor: isDark ? '#1e293b' : '#fff',
              borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
              borderWidth: 1,
              titleColor: isDark ? '#f1f5f9' : '#1e293b',
              bodyColor: isDark ? '#94a3b8' : '#64748b',
              callbacks: {
                title: function(items) {
                  return items[0].label;
                },
                label: function(item) {
                  return ' ' + item.dataset.label + ': ' + Math.round(item.parsed.y);
                }
              }
            }
          },
          scales: {
            x: {
              grid: {
                color: gridColor,
                drawBorder: false
              },
              ticks: {
                color: tickColor,
                font: {
                  size: 11
                },
                autoSkip: true,
                maxTicksLimit: 12,
                maxRotation: 0
              }
            },
            y: {
              min: 0,
              grid: {
                color: gridColor,
                drawBorder: false
              },
              ticks: {
                color: tickColor,
                font: {
                  size: 11
                },
                stepSize: 5
              }
            }
          }
        }
      });
    }

    let currentDayRange = 15;

    function buildDailyBuckets(rows, days) {
      const labels = [];
      const today = [];
      const ref = new Date();
      ref.setHours(0, 0, 0, 0);
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(ref);
        d.setDate(d.getDate() - i);
        labels.push(d.toLocaleDateString([], {
          month: 'short',
          day: 'numeric'
        }));
        today.push(0);
      }
      rows.forEach(function(row) {
        const ts = new Date(row.access_timestamp);
        if (isNaN(ts)) return;
        const tsDay = new Date(ts);
        tsDay.setHours(0, 0, 0, 0);
        const diff = Math.round((ref - tsDay) / 86400000);
        const idx = days - 1 - diff;
        if (idx >= 0 && idx < days) today[idx]++;
      });
      return {
        labels: labels,
        data: today
      };
    }

    function renderDailyChart(days) {
      const isDark = matchMedia('(prefers-color-scheme: dark)').matches;
      const gridColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
      const tickColor = isDark ? '#9ca3af' : '#94a3b8';

      const now = new Date();
      const months = new Set();
      for (let i = 0; i < days; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        months.add(d.toISOString().slice(0, 7));
      }

      const fetches = [...months].map(function(ym) {
        const url = '../../../app/services/datalog_backend.php' +
          '?action=list&access_timestamp=' + encodeURIComponent(ym);
        return fetch(url, {
            headers: {
              'X-Requested-With': 'XMLHttpRequest'
            }
          })
          .then(function(res) {
            return res.json();
          })
          .then(function(json) {
            return (json.success && Array.isArray(json.data)) ? json.data : [];
          });
      });

      Promise.all(fetches).then(function(results) {
        const rows = [].concat.apply([], results);
        const {
          labels,
          data
        } = buildDailyBuckets(rows, days);
        if (attendanceChart) attendanceChart.destroy();
        attendanceChart = new Chart(document.getElementById('attendanceChart'), {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Attendance',
              data: data,
              borderColor: '#22c55e',
              backgroundColor: 'rgba(34,197,94,0.08)',
              fill: true,
              borderWidth: 1.5,
              pointBackgroundColor: 'transparent',
              pointBorderColor: '#22c55e',
              pointRadius: 4,
              pointHoverRadius: 5,
              tension: 0.3
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
              mode: 'index',
              intersect: false
            },
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                backgroundColor: isDark ? '#1e293b' : '#fff',
                borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
                borderWidth: 1,
                titleColor: isDark ? '#f1f5f9' : '#1e293b',
                bodyColor: isDark ? '#94a3b8' : '#64748b',
                callbacks: {
                  label: function(item) {
                    return ' Total: ' + Math.round(item.parsed.y);
                  }
                }
              }
            },
            scales: {
              x: {
                grid: {
                  color: gridColor
                },
                ticks: {
                  color: tickColor,
                  font: {
                    size: 11
                  },
                  maxRotation: 0
                }
              },
              y: {
                min: 0,
                grid: {
                  color: gridColor
                },
                ticks: {
                  color: tickColor,
                  font: {
                    size: 11
                  }
                }
              }
            }
          }
        });
      });
    }

    function setDayRange(days) {
      currentDayRange = days;

      // Reset Today button
      document.getElementById('btn-today').style.background = 'var(--surface)';
      document.getElementById('btn-today').style.color = 'var(--text-muted)';
      document.getElementById('btn-today').style.fontWeight = '400';

      // Highlight active range button
      document.getElementById('btn-15').style.background = days === 15 ? 'var(--accent)' : 'var(--surface)';
      document.getElementById('btn-15').style.color = days === 15 ? '#fff' : 'var(--text-muted)';
      document.getElementById('btn-15').style.fontWeight = days === 15 ? '500' : '400';
      document.getElementById('btn-30').style.background = days === 30 ? 'var(--accent)' : 'var(--surface)';
      document.getElementById('btn-30').style.color = days === 30 ? '#fff' : 'var(--text-muted)';
      document.getElementById('btn-30').style.fontWeight = days === 30 ? '500' : '400';

      document.getElementById('chart-title-label').textContent =
        days === 15 ? 'Past 15 Days — Daily Attendance' : 'Recent 30 Days — Daily Attendance';
      document.getElementById('chart-tabs').style.display = 'none';
      document.getElementById('chart-legend').style.display = 'none';
      renderDailyChart(days);
    }

    function setChartTab(tab) {
      document.getElementById('chart-tabs').style.display = 'flex';
      document.getElementById('chart-legend').style.display = 'flex';
      document.getElementById('chart-title-label').textContent = 'Hourly Attendance';

      // Highlight Today, reset range buttons
      document.getElementById('btn-today').style.background = 'var(--accent)';
      document.getElementById('btn-today').style.color = '#fff';
      document.getElementById('btn-today').style.fontWeight = '500';
      document.getElementById('btn-15').style.background = 'var(--surface)';
      document.getElementById('btn-15').style.color = 'var(--text-muted)';
      document.getElementById('btn-15').style.fontWeight = '400';
      document.getElementById('btn-30').style.background = 'var(--surface)';
      document.getElementById('btn-30').style.color = 'var(--text-muted)';
      document.getElementById('btn-30').style.fontWeight = '400';

      currentChartTab = tab;
      ['volume', 'checkin', 'checkout'].forEach(function(t) {
        const el = document.getElementById('tab-' + t);
        if (t === tab) {
          el.style.color = 'var(--text)';
          el.style.borderBottom = '2px solid var(--accent)';
          el.style.fontWeight = '500';
        } else {
          el.style.color = 'var(--text-muted)';
          el.style.borderBottom = '2px solid transparent';
          el.style.fontWeight = '400';
        }
      });
      renderChart(tab);
    }

    // Kick off — render zeros immediately, then replace with real data
    renderChart('volume');
    fetchAttendanceData();
  </script>
</body>

</html>