<?php
// resource/views/employee dashboard.php --> employee dashboard

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

requireAccess('employee dashboard', 'iframe/main.php');
$access = getMenuAccess();

$userId = $_SESSION['user_id'] ?? null;
$recentLogs = [];

$stats = [
  'total_employees'    => 0,
  'active_employees'   => 0,
  'inactive_employees' => 0,
  'total_scanned'      => 0,
  'active_scan'        => 0,
  'inactive_scan'      => 0,
  'today_attendance'   => 0,
  'today_in'           => 0,
  'today_out'          => 0,
  'total_proxcode'     => 0,
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
      'total_employees'    => "SELECT COUNT(*) FROM employees",
      'active_employees'   => "SELECT COUNT(*) FROM employees WHERE status = 'Active'",
      'inactive_employees' => "SELECT COUNT(*) FROM employees WHERE status = 'Inactive'",
      'total_scanned'      => "SELECT COUNT(*) FROM employee_access_log",
      'active_scan'        => "SELECT COUNT(*) FROM employee_access_log WHERE status = 'Active'",
      'inactive_scan'      => "SELECT COUNT(*) FROM employee_access_log WHERE status = 'Inactive'",
      'today_attendance'   => "SELECT COUNT(*) FROM employee_access_log WHERE DATE(access_timestamp) = CURDATE()",
      'today_in'           => "SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'IN' AND DATE(access_timestamp) = CURDATE()",
      'today_out'          => "SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'OUT' AND DATE(access_timestamp) = CURDATE()",
      'total_proxcode'     => "SELECT COUNT(*) FROM code",
    ];

    foreach ($queries as $key => $sql) {
      $stmt = $userDb->prepare($sql);
      $stmt->execute();
      $stats[$key] = (int)$stmt->fetchColumn();
    }

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

    $selectedDate = $_GET['lb_date'] ?? date('Y-m-d');

    // Today's employee scan leaderboard
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
  <title><?= htmlspecialchars($myDatabase); ?> - Employee Dashboard</title>
  <link rel="icon" href="../assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link rel="stylesheet" href="../css/emp-db.css">
  <link rel="stylesheet" href="../css/loading.css">
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
      <div class="shortcut-item" onclick="navigateWithLoading('admin panel.php#users');">
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

    <!-- Two-column: Stats + Recent Activity -->
    <div class="two-col">

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
                  <div class="stat-value"><?= number_format($stats['total_scanned']); ?></div>
                </div>
                <div class="stat-label">Total Scanned</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#22c55e;"><i class="fas fa-check-circle"></i></div>
                  <div class="stat-value"><?= number_format($stats['active_scan']); ?></div>
                </div>
                <div class="stat-label">Active Scans</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#ef4444;"><i class="fas fa-times-circle"></i></div>
                  <div class="stat-value"><?= number_format($stats['inactive_scan']); ?></div>
                </div>
                <div class="stat-label">Inactive Scans</div>
              </div>
              <div class="stat-card">
                <div class="stat-top">
                  <div class="stat-icon-sm" style="color:#f97316;"><i class="fas fa-calendar-day"></i></div>
                  <div class="stat-value"><?= number_format($stats['today_attendance']); ?></div>
                </div>
                <div class="stat-label">Today &nbsp;<span style="font-weight:400;font-size:10px;">In:<?= $stats['today_in']; ?> Out:<?= $stats['today_out']; ?></span></div>
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
            <?php if (!empty($gateStats)): ?>
              <div style="position:relative;width:180px;height:180px;flex-shrink:0;">
                <canvas id="gateChart"></canvas>
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
                    text-align:center;pointer-events:none;">
                  <div style="font-size:22px;font-weight:700;color:var(--text);">
                    <?= number_format(array_sum(array_column($gateStats, 'total'))); ?>
                  </div>
                  <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">Total Scans</div>
                </div>
              </div>
              <div id="gate-legend" style="display:flex;flex-direction:column;gap:8px;min-width:160px;">
                <?php
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
                <?php endforeach; ?>
              </div>
            <?php else: ?>
              <div class="no-data" style="padding:30px 0;">
                <i class="fas fa-door-open"></i>
                No gate scan data available.
              </div>
            <?php endif; ?>
          </div>
        </div>

        <!-- DB info -->
        <!-- <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-database" style="color:#6366f1;margin-right:6px;"></i>Database</span>
          </div>
          <div class="card-body">
            <div class="db-block">
              <img src="../assets/icon/database-icon.png" alt="DB">
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
          <div class="card-body" style="padding: 0 150px 20px 150px;">
            <?php if (!empty($recentLogs)): ?>
              <div class="activity-list">
                <?php foreach (array_slice($recentLogs, 0, 10) as $log):
                  $userImage  = $log['profile_image'] ?? $log['image'] ?? null;
                  $imagePath  = $userImage ? "../../public/uploads/user/" . htmlspecialchars($userImage) : null;
                  $imgSrc     = ($imagePath && file_exists($imagePath)) ? $imagePath : "../assets/logo/3PL.svg";
                  $status     = strtolower($log['status'] ?? 'unknown');
                  $check      = strtolower($log['check_status'] ?? 'unknown');
                  $statusClass = in_array($status, ['active', 'inactive']) ? "badge-{$status}" : 'badge-unknown';
                  $checkClass  = in_array($check, ['in', 'out']) ? "badge-{$check}" : 'badge-unknown';
                ?>
                  <div class="activity-item">
                    <img src="<?= $imgSrc; ?>"
                      alt="<?= htmlspecialchars($log['fullname'] ?? 'User'); ?>"
                      class="activity-avatar"
                      onerror="this.src='../assets/logo/3PL.svg';">
                    <div class="activity-info" style="padding-left: 50px;">
                      <div class="activity-name">
                        <strong><?= htmlspecialchars(mb_convert_case($log['fullname'] ?? 'Unknown Employee', MB_CASE_TITLE, 'UTF-8')); ?></strong>
                      </div>
                      <div class="activity-time">
                        <small><?= date('M j, Y g:i A', strtotime($log['access_timestamp'])); ?></small>
                      </div>
                    </div>
                    <div style="text-align: end;">
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
              <div style="margin-top:16px;text-align:center;border-top:1px solid var(--border);padding-top:14px;">
                <a href="../../app/services/table panel.php?tab=datalog" class="btn-link">
                  <i class="fas fa-history" style="margin-right:4px;"></i>View All Logs
                </a>
              </div>
            <?php endif; ?>
          </div>
        </div>
      </div>

      <div>
        <div class="card" style="height:100%;">
          <div class="card-header">
            <span class="card-title">
              <i class="fas fa-user-check" style="color:#f59e0b;margin-right:6px;"></i>
              Today's Scan
            </span>
            <input type="date"
              id="lb-date-picker"
              value="<?= htmlspecialchars($selectedDate) ?>"
              max="<?= date('Y-m-d') ?>"
              style="
                font-size:10px;
                color:var(--text-muted);
                border:1px solid var(--border);
                border-radius:4px;
                padding:2px 6px;
                background:var(--surface);
                cursor:pointer;
                outline:none;
              ">
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

    </div><!-- /.two-col -->

  </div><!-- /.page-body -->

  <script src="../js/btn.js"></script>
  <script src="../js/req.js"></script>
  <script src="../js/loading.js"></script>
  <script>
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

    (function() {
      <?php if (!empty($gateStats)): ?>
        const gateLabels = <?= json_encode(array_map(fn($g) => $g['gate_name'] ?? 'Unknown', $gateStats)); ?>;
        const gateData = <?= json_encode(array_column($gateStats, 'total')); ?>;
        const gateColors = ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316', '#06b6d4', '#84cc16', '#a855f7', '#14b8a6'];

        const isDark = matchMedia('(prefers-color-scheme: dark)').matches;

        new Chart(document.getElementById('gateChart'), {
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
                  label: function(item) {
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

    document.getElementById('lb-date-picker').addEventListener('change', function() {
      const date = this.value;
      const tbody = document.getElementById('lb-tbody');
      const footer = document.getElementById('lb-footer');

      // Show a subtle loading state
      tbody.style.opacity = '0.4';

      fetch(`partials/leaderboard.php?lb_date=${date}`)
        .then(r => r.json())
        .then(({
          success,
          data
        }) => {
          if (!success || !data.length) {
            tbody.innerHTML = `
          <tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">
            No scan activity for this date.
          </td></tr>`;
            footer.innerHTML = `
          <span style="color:var(--text-muted);">0 employees</span>
          <span style="display:flex;gap:12px;">
            <span class="lb-in">In: 0</span>
            <span class="lb-out">Out: 0</span>
          </span>`;
            tbody.style.opacity = '1';
            return;
          }

          const rankColors = ['#f59e0b', '#94a3b8', '#b45309'];
          let totalIn = 0,
            totalOut = 0;

          tbody.innerHTML = data.map((row, i) => {
            const rank = i + 1;
            const name = row.fullname.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
            const truncated = name.length > 18 ? name.slice(0, 18) + '…' : name;
            const rankCell = rank <= 3 ?
              `<td style="text-align:center;color:${rankColors[i]};font-size:11px;font-weight:700;">
               <i class="fas fa-circle" style="font-size:8px;"></i>
             </td>` :
              `<td style="text-align:center;font-size:11px;font-weight:700;color:var(--text-muted);">${rank}</td>`;

            totalIn += parseInt(row.total_in);
            totalOut += parseInt(row.total_out);

            return `<tr>
          ${rankCell}
          <td title="${name}" style="text-align:left;font-weight:500;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${truncated}</td>
          <td class="lb-in" style="text-align:right;">${row.total_in}</td>
          <td class="lb-out" style="text-align:right;">${row.total_out}</td>
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

          tbody.style.opacity = '1';
        })
        .catch(() => {
          tbody.innerHTML = `
        <tr><td colspan="5" style="text-align:center;padding:20px;color:#ef4444;">
          Failed to load data.
        </td></tr>`;
          tbody.style.opacity = '1';
        });
    });
  </script>

</body>

</html>