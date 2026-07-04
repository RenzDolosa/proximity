<?php
// resource/views/employee dashboard.php --> employee dashboard

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('employee dashboard', ROUTE_HOME);
$access = getMenuAccess();

$userId = $_SESSION['user_id'] ?? null;
$recentLogs = [];

$stats = [
  'total_employees'     => 0,
  'active_employees'    => 0,
  'inactive_employees'  => 0,
  'total_department'    => 0,
  'total_position'      => 0,
  'total_access'        => 0,
  'active_access'       => 0,
  'inactive_access'     => 0,
  'today_access'        => 0,
  'today_in'            => 0,
  'today_out'           => 0,
  'total_in'            => 0,
  'total_out'           => 0,
  'total_proxcode'      => 0,
  'total_violations'    => 0,
  'total_main_gate'     => 0,
];

try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
  $requiredTables = ['employees', 'code', 'employee_access_log', 'check_in_out'];
  $missingTables = [];

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
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError = $e->getMessage();
}

if ($databaseConnected) {
  try {
    $queries = [
      'total_employees'     => "SELECT COUNT(*) FROM employees",
      'active_employees'    => "SELECT COUNT(*) FROM employees WHERE status = 'Active'",
      'inactive_employees'  => "SELECT COUNT(*) FROM employees WHERE status = 'Inactive'",
      'total_violations'    => "SELECT COUNT(*) FROM employees WHERE violation <> ''",
      'total_department'    => "SELECT COUNT(DISTINCT brand) FROM employees WHERE brand IS NOT NULL AND TRIM(brand) != ''",
      'total_position'      => "SELECT COUNT(DISTINCT position) FROM employees WHERE position IS NOT NULL AND TRIM(position) != ''",
      'total_access'        => "SELECT COUNT(*) FROM employee_access_log",
      'active_access'       => "SELECT COUNT(*) FROM employee_access_log WHERE status = 'Active'",
      'inactive_access'     => "SELECT COUNT(*) FROM employee_access_log WHERE status = 'Inactive'",
      'today_access'        => "SELECT COUNT(*) FROM employee_access_log WHERE DATE(access_timestamp) = CURDATE()",
      'today_in'            => "SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'IN' AND DATE(access_timestamp) = CURDATE()",
      'today_out'           => "SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'OUT' AND DATE(access_timestamp) = CURDATE()",
      'total_in'            => "SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'IN'",
      'total_out'           => "SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'OUT'",
      'total_attendance'    => "SELECT COUNT(*) FROM employee_attendance_log",
      'active_attendance'   => "SELECT COUNT(*) FROM employee_attendance_log WHERE status = 'Active'",
      'inactive_attendance' => "SELECT COUNT(*) FROM employee_attendance_log WHERE status = 'Inactive'",
      'today_attendance'    => "SELECT COUNT(*) FROM employee_attendance_log WHERE DATE(access_timestamp) = CURDATE()",
      'total_proxcode'      => "SELECT COUNT(*) FROM code",
      'total_main_gate'     => "SELECT COUNT(*) FROM users WHERE user_group = 'Main Gate'",
    ];

    foreach ($queries as $key => $sql) {
      $stmt = $userDb->prepare($sql);
      $stmt->execute();
      $stats[$key] = (int)$stmt->fetchColumn();
    }

    $selectedDate = $_GET['lb_date'] ?? date('Y-m-d');

    $stmt = $userDb->prepare("
      SELECT u.first_name AS gate_name, COUNT(*) AS total
      FROM employee_access_log el
      LEFT JOIN " . DB_NAME . ".users u ON el.user_id = u.id
      WHERE el.user_id IS NOT NULL
        AND DATE(el.access_timestamp) = :selected_date
      GROUP BY el.user_id, u.first_name
      ORDER BY total DESC
      LIMIT 10
    ");
    $stmt->execute([':selected_date' => $selectedDate]);
    $gateStats = $stmt->fetchAll();

    $stmt = $userDb->prepare("
      SELECT 
        COALESCE(NULLIF(TRIM(el.fullname), ''), e.fullname, 'Unknown') AS fullname,
        SUM(CASE WHEN el.check_status = 'IN'  THEN 1 ELSE 0 END) AS total_in,
        SUM(CASE WHEN el.check_status = 'OUT' THEN 1 ELSE 0 END) AS total_out,
        COUNT(*) AS total
      FROM employee_access_log el
      LEFT JOIN employees e ON el.employee_id = e.id
      WHERE DATE(el.access_timestamp) = :selected_date
      GROUP BY el.employee_id, el.fullname
      ORDER BY total DESC
    ");
    $stmt->execute([':selected_date' => $selectedDate]);
    $leaderboard = $stmt->fetchAll();

    $stmt = $userDb->prepare("
      SELECT el.*,
            e.image AS emp_image,
            e.qr_code AS emp_qr_code,
            COALESCE(NULLIF(TRIM(el.fullname), ''), e.fullname, 'Unknown Employee') AS fullname,
            u.first_name AS user_first_name
      FROM employee_access_log el
      LEFT JOIN employees e ON el.employee_id = e.id
      LEFT JOIN users u ON el.user_id = u.id
      ORDER BY el.access_timestamp DESC
      LIMIT 10
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
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Employee dashboard</title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <!-- <link rel="stylesheet" href="/config/asset.php?t=n8hsr"> -->
  <link rel="stylesheet" href="/config/asset.php?t=a5dh7">
  <link rel="stylesheet" href="/config/asset.php?t=mq4wc">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=rtf2w">
  <link rel="stylesheet" href="/config/asset.php?t=q5fwr">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script>
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
    <div class="shortcut-item" onclick="if (window.self !== window.top) {
        window.top.location.href = window.top.location.href.split('?')[0];
      } else {
        window.history.back();
      }">
      <i class="fas fa-arrow-left"></i>
      <span>Back</span>
    </div>
    <?php if ($access['tablePanel']): ?>
      <div class="shortcut-item" data-action-app="mainFrame-employees">
        <i class="fas fa-users"></i>
        <span>Employees</span>
      </div>
    <?php endif; ?>
    <?php if ($access['scanTest']): ?>
      <div class="shortcut-item" data-action-app="mainFrame-scanTest">
        <i class="fas fa-qrcode"></i>
        <span>Scan Test</span>
      </div>
    <?php endif; ?>
    <?php if ($access['adminPanel']): ?>
      <div class="shortcut-item" data-action-app="mainFrame-adminPanel">
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
        <h2><i class="fas fa-chart-line" style="margin-right:8px;opacity:.8;"></i>Employee Data Insights</h2>
        <p>Connected to <strong><?= htmlspecialchars($myDatabase); ?></strong></p>
        <?php if ($databaseConnected): ?>
          <div class="status-pill ok"><i class="fas fa-circle"></i> Database connected</div>
        <?php else: ?>
          <div class="status-pill err"><i class="fas fa-exclamation-circle"></i> Connection error</div>
        <?php endif; ?>
      </div>
      <div class="wb-right">
        <i class="fas fa-clock" style="margin-right:4px;"></i>
        <span id="wb-time"></span><br>
        <span id="wb-date" style="margin-top:3px;display:block;"></span>
      </div>
    </div>

    <!-- Three-column: Stats + Recent Activity -->
    <div class="three-col">

      <!-- Left: Stats cards -->
      <div style="display: flex; flex-direction: column; gap: 5px;">

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-users" style="color:#3b82f6;margin-right:6px;"></i>Employee Stats</span>
          </div>
          <div class="card-body">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#3b82f6;"><i class="fas fa-users"></i></div>
                  <div class="stat-value"><?= number_format($stats['total_employees']); ?></div>
                </div>
                <div class="stat-label">Total Employees</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#22c55e;"><i class="fas fa-user-check"></i></div>
                  <div class="stat-value"><?= number_format($stats['active_employees']); ?></div>
                </div>
                <div class="stat-label">Active</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#ef4444;"><i class="fas fa-user-times"></i></div>
                  <div class="stat-value"><?= number_format($stats['inactive_employees']); ?></div>
                </div>
                <div class="stat-label">Inactive</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#8b5cf6;"><i class="fas fa-id-card"></i></div>
                  <div class="stat-value"><?= number_format($stats['total_proxcode']); ?></div>
                </div>
                <div class="stat-label">Proximity Codes</div>
              </div>
              <div class="stat-card" data-action-app="mainFrame-remarks">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#ef4444;"><i class="fas fa-exclamation-triangle"></i></div>
                  <div class="stat-value"><?= number_format($stats['total_violations']); ?></div>
                </div>
                <div class="stat-label">Total Incidents</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-fingerprint" style="color:#f59e0b;margin-right:6px;"></i>Access Log Stats</span>
          </div>
          <div class="card-body">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#3b82f6;"><i class="fas fa-list"></i></div>
                  <div class="stat-value"><?= number_format($stats['total_access']); ?></div>
                </div>
                <div class="stat-label">Total Access &nbsp;<span style="font-weight:400;font-size:10px;">IN: <?= $stats['total_in']; ?> OUT: <?= $stats['total_out']; ?></span></div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#22c55e;"><i class="fas fa-check-circle"></i></div>
                  <div class="stat-value"><?= number_format($stats['active_access']); ?></div>
                </div>
                <div class="stat-label">Active Access</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#ef4444;"><i class="fas fa-times-circle"></i></div>
                  <div class="stat-value"><?= number_format($stats['inactive_access']); ?></div>
                </div>
                <div class="stat-label">Inactive Access</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#f97316;"><i class="fas fa-calendar-day"></i></div>
                  <div class="stat-value"><?= number_format($stats['today_access']); ?></div>
                </div>
                <div class="stat-label">Today's &nbsp;<span style="font-weight:400;font-size:10px;">IN: <?= $stats['today_in']; ?> OUT: <?= $stats['today_out']; ?></span></div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-fingerprint" style="color:#f59e0b;margin-right:6px;"></i>Attendance Stats</span>
          </div>
          <div class="card-body">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#3b82f6;"><i class="fas fa-list"></i></div>
                  <div class="stat-value"><?= number_format($stats['total_attendance']); ?></div>
                </div>
                <div class="stat-label">Total Attendance</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#22c55e;"><i class="fas fa-check-circle"></i></div>
                  <div class="stat-value"><?= number_format($stats['active_attendance']); ?></div>
                </div>
                <div class="stat-label">Active Attendance</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#ef4444;"><i class="fas fa-times-circle"></i></div>
                  <div class="stat-value"><?= number_format($stats['inactive_attendance']); ?></div>
                </div>
                <div class="stat-label">Inactive Attendance</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#f97316;"><i class="fas fa-calendar-day"></i></div>
                  <div class="stat-value"><?= number_format($stats['today_attendance']); ?></div>
                </div>
                <div class="stat-label">Today's Attendance</div>
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-ellipsis-h" style="color:#3b82f6;margin-right:6px;"></i>Other Stats</span>
          </div>
          <div class="card-body">
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#22c55e;"><i class="fas fa-building"></i></div>
                  <div class="stat-value"><?= number_format($stats['total_department']); ?></div>
                </div>
                <div class="stat-label">Total Departments</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#f59e0b;"><i class="fas fa-briefcase"></i></div>
                  <div class="stat-value"><?= number_format($stats['total_position']); ?></div>
                </div>
                <div class="stat-label">Total Positions</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#3b82f6;"><i class="fas fa-door-open"></i></div>
                  <div class="stat-value"><?= number_format($stats['total_main_gate']); ?></div>
                </div>
                <div class="stat-label">Main Gate Scanners</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#f59e0b;"></div>
                  <div class="stat-value"></div>
                </div>
                <div class="stat-label"></div>
              </div>
            </div>
          </div>
        </div>

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

        <!-- DB info -->
        <!-- <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-database" style="color:#6366f1;margin-right:6px;"></i>Database</span>
          </div>
          <div class="card-body">
            <div class="db-block">
              <img src="/config/asset.php?t=s3t4u" alt="DB">
              <div>
                <div class="db-name" style="color:<?= $databaseConnected ? '#16a34a' : '#dc2626' ?>;">
                  <?= htmlspecialchars($myDatabase) ?>
                </div>
                <div class="db-sub">Personal database</div>
              </div>
            </div>
            <div class="info-grid">
              <div class="info-item">
                <div class="info-label">Connection</div>
                <div class="info-value" style="color:<?= $databaseConnected ? '#16a34a' : '#dc2626'; ?>;">
                  <?= $databaseConnected ? '✓ Connected' : '✗ Offline'; ?>
                </div>
              </div>
              <div class="info-item">
                <div class="info-label">Total Records</div>
                <div class="info-value"><?= number_format($stats['total_employees']); ?></div>
              </div>
              <div class="info-item">
                <div class="info-label">Active Records</div>
                <div class="info-value"><?= number_format($stats['active_employees']); ?></div>
              </div>
              <div class="info-item">
                <div class="info-label">Last Updated</div>
                <div class="info-value"><?= date('M j, g:i A'); ?></div>
              </div>
            </div>
          </div>
        </div> -->
      </div>

      <!-- Right: Recent activity -->
      <div>
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-history" style="color:#6366f1;margin-right:6px;"></i>Recent Activity</span>
          </div>

          <div class="card-body" style="padding: 0 50px 20px;">

            <div style="
              display: flex;
              align-items: center;
              padding: 8px 0 6px;
              border-bottom: 1px solid var(--border);
              font-size: 11px;
              font-weight: 600;
              color: var(--text-muted);
              text-transform: uppercase;
              letter-spacing: 0.05em;
            ">
              <div style="width: 40px; flex-shrink: 0;">Image</div>
              <div style="flex: 1; padding-left: 12px;">Fullname</div>
              <div style="width: 70px; text-align: end; padding-left: 12px;">Operators</div>
              <div style="width: 110px; text-align: end;">Status</div>
            </div>

            <?php if (!empty($recentLogs)): ?>
              <div class="activity-list">
                <?php foreach (array_slice($recentLogs, 0, 10) as $log):
                  $userImage   = !empty($log['emp_image']) ? $log['emp_image'] : ($log['image'] ?? null);
                  $imagePath   = $userImage ? "../../public/uploads/user/" . htmlspecialchars($userImage) : null;
                  $imgSrc      = ($imagePath && file_exists($imagePath)) ? $imagePath : "/config/asset.php?t=cfk4d";
                  $status      = strtolower($log['status'] ?? 'unknown');
                  $check       = strtolower($log['check_status'] ?? 'unknown');
                  $statusClass = in_array($status, ['active', 'inactive']) ? "badge-{$status}" : 'badge-unknown';
                  $checkClass  = in_array($check, ['in', 'out']) ? "badge-{$check}" : 'badge-unknown';
                ?>
                  <div class="activity-item">
                    <img src="<?= $imgSrc; ?>"
                      alt="<?= htmlspecialchars($log['fullname'] ?? 'User'); ?>"
                      class="activity-avatar"
                      onerror="this.src='/config/asset.php?t=g4ld2';">
                    <div class="activity-info" style="padding-left: 12px;">
                      <div class="activity-name">
                        <strong><?= htmlspecialchars(mb_convert_case($log['fullname'] ?? 'Unknown Employee', MB_CASE_TITLE, 'UTF-8')); ?></strong>
                      </div>
                      <div class="activity-time">
                        <small><?= date('M j, Y g:i A', strtotime($log['access_timestamp'])); ?></small>
                      </div>
                    </div>
                    <div style="text-align: end; flex-shrink: 0; padding-right: 20px;">
                      <?= htmlspecialchars($log['gate_name'] ?? ($log['user_first_name'] ?? 'Gate')); ?>
                      <div style="color: var(--text-muted);"><small>Gate</small></div>
                    </div>
                    <div class="activity-badges">
                      <span class="badge <?= $statusClass; ?>"><?= htmlspecialchars($log['status'] ?? 'Unknown'); ?></span>
                      <span class="badge <?= $checkClass; ?>"><?= htmlspecialchars($log['check_status'] ?? '—'); ?></span>
                    </div>
                  </div>
                <?php endforeach; ?>
              </div>
            <?php else: ?>
              <div class="no-data">
                <i class="fas fa-clipboard-list"></i>
                No recent activity found.
              </div>
            <?php endif; ?>

            <?php if ($access['datalog']): ?>
              <div style="margin-top: 16px; text-align: center; border-top: 1px solid var(--border); padding-top: 14px;">
                <button data-action-app="mainFrame-datalog" class="btn btn-link" tabindex="-1">
                  <i class="fas fa-history" style="margin-right:4px;"></i>View All Logs
                </button>
              </div>
            <?php endif; ?>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-header">
            <span class="card-title">
              <i class="fas fa-user-check" style="color:#f59e0b;margin-right:6px;"></i>
              Today's Scan
            </span>
            <div id="lb_date_pill" class="date-range-pill lb-drp-pill"></div>
          </div>
          <div class="card-body" style="padding:12px 16px; display:flex; flex-direction:column; height:520px;">
            <?php if (!empty($leaderboard)): ?>
              <!-- Fixed thead -->
              <table class="lb-table" style="table-layout:fixed; width:100%;">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Employee</th>
                    <th style="color:#22c55e;">In</th>
                    <th style="color:#f59e0b;">Out</th>
                    <th>Total</th>
                  </tr>
                </thead>
              </table>

              <!-- Scrollable tbody only -->
              <div class="lb-scroll">
                <table class="lb-table" style="table-layout:fixed; width:100%;">
                  <tbody id="lb-tbody">
                    <?php foreach ($leaderboard as $rank => $row):
                      $rankNum  = $rank + 1;
                      $rankClass = $rankNum === 1 ? 'lb-rank-1' : ($rankNum === 2 ? 'lb-rank-2' : ($rankNum === 3 ? 'lb-rank-3' : ''));
                      $name     = mb_convert_case($row['fullname'], MB_CASE_TITLE, 'UTF-8');
                    ?>
                      <tr>
                        <td class="<?= $rankClass ?>">
                          <?php if ($rankNum <= 3): ?>
                            <i class="fas fa-circle" style="font-size:8px;"></i>
                          <?php else: ?>
                            <?= $rankNum ?>
                          <?php endif; ?>
                        </td>
                        <td title="<?= htmlspecialchars($name) ?>">
                          <?= htmlspecialchars(mb_strimwidth($name, 0, 18, '…')) ?>
                        </td>
                        <td class="lb-in"><?= number_format($row['total_in']) ?></td>
                        <td class="lb-out"><?= number_format($row['total_out']) ?></td>
                        <td class="lb-total"><?= number_format($row['total']) ?></td>
                      </tr>
                    <?php endforeach; ?>
                  </tbody>
                </table>
              </div>

              <!-- Fixed footer -->
              <div class="lb-footer" id="lb-footer">
                <span style="color:var(--text-muted);">
                  <?= count($leaderboard) ?> employee<?= count($leaderboard) !== 1 ? 's' : '' ?>
                </span>
                <span style="display:flex;gap:12px;">
                  <span class="lb-in">In: <?= number_format(array_sum(array_column($leaderboard, 'total_in'))) ?></span>
                  <span class="lb-out">Out: <?= number_format(array_sum(array_column($leaderboard, 'total_out'))) ?></span>
                </span>
              </div>

            <?php else: ?>
              <div class="no-data">
                <i class="fas fa-history"></i>
                No scan activity today.
              </div>
            <?php endif; ?>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script src="/config/route-config.php?page=mainFrame"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=kter8"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=oqw56"></script>
  <script src="/config/asset.php?t=kg56e"></script>
  <script>
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

    function updateGateChart(gateStats) {
      const legend = document.getElementById('gate-legend');
      const totalEl = document.getElementById('gate-total-count');
      const isDark = matchMedia('(prefers-color-scheme: dark)').matches;

      if (!gateStats || !gateStats.length) {
        totalEl.textContent = '0';
        legend.innerHTML = `
      <div class="no-data" style="padding:30px 0;">
        <i class="fas fa-door-open"></i> No gate scan data available.
      </div>`;
        if (gateChart) {
          gateChart.data.labels = [];
          gateChart.data.datasets[0].data = [];
          gateChart.update();
        }
        return;
      }

      const labels = gateStats.map(g => g.gate_name || 'Unknown');
      const data = gateStats.map(g => parseInt(g.total));
      const total = data.reduce((a, b) => a + b, 0);

      if (gateChart) {
        gateChart.data.labels = labels;
        gateChart.data.datasets[0].data = data;
        gateChart.data.datasets[0].backgroundColor = gateColors.slice(0, data.length);
        gateChart.update();
      } else {
        gateChart = new Chart(document.getElementById('gateChart'), {
          type: 'doughnut',
          data: {
            labels,
            datasets: [{
              data,
              backgroundColor: gateColors.slice(0, data.length),
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
              }
            }
          }
        });
      }

      totalEl.textContent = total.toLocaleString();
      legend.innerHTML = gateStats.map((g, i) => {
        const color = gateColors[i % gateColors.length];
        const pct = total > 0 ? ((parseInt(g.total) / total) * 100).toFixed(1) : 0;
        const name = g.gate_name || 'Unknown';
        return `
          <div style="display:flex;align-items:center;gap:8px;font-size:12px;">
            <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            <span style="color:var(--text);flex:1;">${name}</span>
            <span style="color:var(--text-muted);font-weight:600;">
              ${parseInt(g.total).toLocaleString()} <span style="font-weight:400;">(${pct}%)</span>
            </span>
          </div>`;
      }).join('');
    }
  </script>
  <script>
    // ── Init leaderboard date picker ──────────────────────────────────
    initLbDatePicker();

    // ── Called by picker on Apply ─────────────────────────────────────
    window.onLbDateChange = function(date) {
      const card = document.getElementById('lb_date_pill').closest('.card');
      const cardBody = card.querySelector('.card-body');

      cardBody.innerHTML = `
        <table class="lb-table" style="table-layout:fixed;width:100%;">
          <thead><tr>
            <th>#</th><th>Employee</th>
            <th style="color:#22c55e;">In</th>
            <th style="color:#f59e0b;">Out</th>
            <th>Total</th>
          </tr></thead>
        </table>
        <div class="lb-scroll">
          <table class="lb-table" style="table-layout:fixed;width:100%;">
            <tbody id="lb-tbody">
              <tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">
                <i class="fas fa-spinner fa-spin"></i> Loading...
              </td></tr>
            </tbody>
          </table>
        </div>
        <div class="lb-footer" id="lb-footer"></div>`;

      fetch(`partials/chart.php?lb_date=${encodeURIComponent(date)}`)
        .then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(({
          success,
          data,
          gate_stats
        }) => {
          const tbody = document.getElementById('lb-tbody');
          const footer = document.getElementById('lb-footer');

          updateGateChart(gate_stats);

          if (!success || !data.length) {
            tbody.innerHTML = `
              <tr><td colspan="5">
                <div class="no-data"><i class="fas fa-history"></i> No scan activity for this date.</div>
              </td></tr>`;
            footer.innerHTML = `
              <span style="color:var(--text-muted);">0 employees</span>
              <span style="display:flex;gap:12px;">
                <span class="lb-in">In: 0</span>
                <span class="lb-out">Out: 0</span>
              </span>`;
            return;
          }

          const rankColors = ['#f59e0b', '#94a3b8', '#b45309'];
          let totalIn = 0,
            totalOut = 0;

          tbody.innerHTML = data.map((row, i) => {
            const rank = i + 1;
            const name = row.fullname.replace(/\w\S*/g,
              t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
            const truncated = name.length > 18 ? name.slice(0, 18) + '…' : name;
            const rankCell = rank <= 3 ?
              `<td style="text-align:center;color:${rankColors[i]};font-size:11px;font-weight:700;">
                  <i class="fas fa-circle" style="font-size:8px;"></i></td>` :
              `<td style="text-align:center;font-size:11px;font-weight:700;color:var(--text-muted);">${rank}</td>`;
            totalIn += parseInt(row.total_in);
            totalOut += parseInt(row.total_out);
            return `<tr>
            ${rankCell}
            <td title="${name}" style="text-align:left;font-weight:500;max-width:110px;
              overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${truncated}</td>
            <td class="lb-in"    style="text-align:right;">${row.total_in}</td>
            <td class="lb-out"   style="text-align:right;">${row.total_out}</td>
            <td class="lb-total" style="text-align:right;">${row.total}</td>
          </tr>`;
          }).join('');

          footer.innerHTML = `
          <span style="color:var(--text-muted);">
            ${data.length} employee${data.length !== 1 ? 's' : ''}
          </span>
          <span style="display:flex;gap:12px;">
            <span class="lb-in">In: ${totalIn.toLocaleString()}</span>
            <span class="lb-out">Out: ${totalOut.toLocaleString()}</span>
          </span>`;
        })
        .catch(err => {
          console.error('Fetch error:', err);
          const tbody = document.getElementById('lb-tbody');
          if (tbody) tbody.innerHTML = `
          <tr><td colspan="5" style="text-align:center;padding:20px;color:#ef4444;">
            Failed to load data.
          </td></tr>`;
        });
    };
  </script>
</body>

</html>