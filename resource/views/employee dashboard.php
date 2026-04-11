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
  <link rel="stylesheet" href="../css/loading.css">
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

    /* ── Page body ── */
    .page-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
      flex: 1;
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

    /* ── Two-column layout ── */
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    /* ── Cards ── */
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

    /* ── Stats grid ── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 12px;
    }

    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .stat-top {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .stat-icon-sm {
      font-size: 18px;
      flex-shrink: 0;
      line-height: 1;
    }

    .stat-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
      line-height: 1;
    }

    .stat-label {
      font-size: 11px;
      color: var(--text-muted);
    }

    /* ── Activity list ── */
    .activity-list {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .activity-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
    }

    .activity-item:last-child {
      border-bottom: none;
    }

    .activity-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--bg);
      border: 1px solid var(--border);
      object-fit: cover;
      flex-shrink: 0;
    }

    .activity-avatar:hover {
      position: relative;
      box-shadow: 0 0 2px rgba(102, 126, 234, 0.2);
      border-radius: 3%;
      transform: scale(3.8);
      background: white;
      transition: all 0.3s ease-in-out;
      border: none;
    }

    .activity-info {
      flex: 1;
      min-width: 0;
    }

    .activity-name {
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .activity-time {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .activity-badges {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 4px;
    }

    .badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      white-space: nowrap;
    }

    .badge-active {
      background: #dcfce7;
      color: #166534;
    }

    .badge-inactive {
      background: #fee2e2;
      color: #991b1b;
    }

    .badge-in {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .badge-out {
      background: #fef9c3;
      color: #92400e;
    }

    .badge-unknown {
      background: #f1f5f9;
      color: #64748b;
    }

    /* ── Info grid ── */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 16px;
    }

    .info-item {
      background: var(--bg);
      border-radius: var(--radius);
      padding: 10px 12px;
    }

    .info-label {
      font-size: 11px;
      color: var(--text-muted);
      margin-bottom: 3px;
    }

    .info-value {
      font-size: 13px;
      font-weight: 600;
      color: var(--text);
    }

    /* ── DB info block ── */
    .db-block {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px;
      background: var(--bg);
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }

    .db-block img {
      width: 32px;
      height: 32px;
      object-fit: contain;
      flex-shrink: 0;
    }

    .db-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
    }

    .db-sub {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .btn-link {
      display: inline-block;
      font-size: 12px;
      font-weight: 500;
      color: var(--accent);
      background: var(--accent-light);
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 5px 14px;
      text-decoration: none;
      transition: background 0.15s;
    }

    .btn-link:hover {
      background: #dbeafe;
    }

    .no-data {
      text-align: center;
      padding: 32px 16px;
      color: var(--text-muted);
      font-size: 13px;
    }

    .no-data i {
      font-size: 28px;
      margin-bottom: 8px;
      display: block;
      opacity: 0.4;
    }

    @media (max-width: 480px) {

      /* ── Page body ── */
      .page-body {
        padding: 12px;
        gap: 14px;
      }

      /* ── Welcome banner ── */
      .welcome-banner {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        padding: 14px 16px;
      }

      .wb-right {
        text-align: left;
        font-size: 12px;
      }

      .wb-left h2 {
        font-size: 15px;
      }

      /* ── Two-col → single column ── */
      .two-col {
        grid-template-columns: 1fr;
        gap: 14px;
      }

      /* ── Stats grid → 2 columns ── */
      .stats-grid {
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .stat-value {
        font-size: 18px;
      }

      .stat-label {
        font-size: 10px;
      }

      /* ── Info grid ── */
      .info-grid {
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 12px;
      }

      .info-value {
        font-size: 12px;
      }

      /* ── DB block ── */
      .db-block {
        padding: 10px;
        gap: 10px;
      }

      .db-name {
        font-size: 13px;
      }

      /* ── Activity list ── */
      .card-body {
        padding: 12px !important;
        /* override the inline padding:0 150px */
      }

      .activity-item {
        gap: 8px;
        padding: 10px 0;
      }

      .activity-avatar {
        width: 32px;
        height: 32px;
      }

      .activity-avatar:hover {
        transform: scale(3.8);
        transform-origin: left center;
      }

      .card {
        overflow: visible;
      }

      .activity-list {
        overflow: visible;
      }

      .activity-info {
        padding-left: 0 !important;
        /* override inline padding-left: 50px */
      }

      .activity-name {
        font-size: 12px;
      }

      .activity-time {
        font-size: 11px;
      }

      .badge {
        font-size: 9px;
        padding: 2px 5px;
      }

      /* ── Top shortcut bar ── */
      .shortcut-bar {
        padding: 0 10px;
        gap: 2px;
      }

      .shortcut-item {
        padding: 6px 10px;
        min-width: 52px;
        font-size: 11px;
      }

      .shortcut-item i {
        font-size: 14px;
      }

      /* ── Card header ── */
      .card-header {
        padding: 10px 12px;
      }

      .card-title {
        font-size: 12px;
      }
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
      <div style="display:flex;flex-direction:column;gap:16px;">

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

        <!-- DB info -->
        <div class="card">
          <div class="card-header">
            <span class="card-title"><i class="fas fa-database" style="color:#6366f1;margin-right:6px;"></i>Database</span>
          </div>
          <div class="card-body">
            <div class="db-block">
              <img src="../assets/icon/database-icon.png" alt="DB">
              <div>
                <div class="db-name"><?= htmlspecialchars($myDatabase); ?></div>
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
        </div>

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
  </script>

</body>

</html>