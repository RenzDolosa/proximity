<?php
// app/services/datalog.php --> datalog table

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code') && !canAccess($permissions, 'remarks')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('datalog', ROUTE_APP_PROXIMITY);
$access = getMenuAccess();

$hasActionsColumn = (
  canAccess($permissions, 'delete-single-datalog')
);

$stats = [
  'total_scanned' => 0,
  'active_employees' => 0,
  'inactive_employees' => 0,
  'today_attendance' => 0,
];

$recentLogs = [];
$settings = [];

if ($databaseConnected) {
  try {
    $todayStart = date('Y-m-d');
    $todayEnd   = date('Y-m-d', strtotime('+1 day'));

    $stmt = $userDb->prepare("
      SELECT
        COUNT(*) AS total_scanned,
        SUM(status = 'Active')   AS active_employees,
        SUM(status = 'Inactive') AS inactive_employees,
        SUM(access_timestamp >= :today_start1 AND access_timestamp < :today_end1) AS today_attendance,
        SUM(check_status = 'IN'  AND access_timestamp >= :today_start2 AND access_timestamp < :today_end2) AS today_in,
        SUM(check_status = 'OUT' AND access_timestamp >= :today_start3 AND access_timestamp < :today_end3) AS today_out
      FROM employee_access_log
    ");
    $stmt->execute([
      ':today_start1' => $todayStart,
      ':today_end1' => $todayEnd,
      ':today_start2' => $todayStart,
      ':today_end2' => $todayEnd,
      ':today_start3' => $todayStart,
      ':today_end3' => $todayEnd,
    ]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    $stats['total_scanned']      = (int) $row['total_scanned'];
    $stats['active_employees']   = (int) $row['active_employees'];
    $stats['inactive_employees'] = (int) $row['inactive_employees'];
    $stats['today_attendance']   = (int) $row['today_attendance'];
    $stats['today_in']           = (int) $row['today_in'];
    $stats['today_out']          = (int) $row['today_out'];

    $stmt = $userDb->prepare("
            SELECT el.*, e.fullname
            FROM employee_access_log el
            JOIN employees e ON el.employee_id = e.id
            ORDER BY el.access_timestamp DESC
            LIMIT 10
        ");
    $stmt->execute();
    $recentLogs = $stmt->fetchAll();

    $stmt = $userDb->prepare("SELECT setting_key, setting_value FROM user_settings");
    $stmt->execute();
    $settings = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Scanned Log</title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=yde24">
  <link rel="stylesheet" href="/config/asset.php?t=a5dh7">
  <!-- <link rel="stylesheet" href="/config/asset.php?t=mq4wc"> -->
  <link rel="stylesheet" href="/config/asset.php?t=g5f2v">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=j35za">
  <link rel="stylesheet" href="/config/asset.php?t=p5sdi">
  <link rel="stylesheet" href="/config/asset.php?t=x48xd">
  <link rel="stylesheet" href="/config/asset.php?t=rtf2w">
  <link rel="stylesheet" href="/config/asset.php?t=q5fwr">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>
  <div class="container">
    <!-- Search and Filter Controls -->
    <div class="controls">
      <form id="searchForm">
        <div class="search-row">
          <!-- EMPID -->
          <div class="search-group">
            <input type="text" id="search_empid" name="employee_id"
              placeholder="EMPID" autocomplete="off">
          </div>

          <!-- Fullname -->
          <div class="search-group">
            <input type="text" id="search_fullname" name="fullname"
              placeholder="Fullname" autocomplete="off">
          </div>

          <!-- Position -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_position" placeholder="Position" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_position_val" name="position">
          </div>

          <!-- Brand -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_brand" placeholder="Brand" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_brand_val" name="brand">
          </div>

          <!-- Status -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_status" placeholder="Status" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_status_val" name="status">
          </div>

          <!-- Shift -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_shift" placeholder="Shift" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_shift_val" name="shift">
          </div>

          <!-- Violation -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_violation" placeholder="Violation" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_violation_val" name="violation">
          </div>

          <!-- Check IN/OUT -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_in-out" placeholder="Check In/Out" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_in-out_val" name="check_status">
          </div>

          <!-- Gate -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_user_id" placeholder="Gate" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_user_id_val" name="user_id">
          </div>

          <!-- Timestamp -->
          <div class="search-group date-range-pill" id="date_range_pill" style="cursor:pointer;">
            <i class="fas fa-clock date-range-icon"></i>
            <span class="drp-display" id="drp_display">
              <span class="drp-placeholder">Start Date</span>
              <span class="drp-sep"> - </span>
              <span class="drp-placeholder">End Date</span>
            </span>
            <button type="button" id="date_range_clear" class="date-range-clear" title="Clear dates" style="display:none;">✕</button>
            <input type="hidden" id="f_from" name="date_from">
            <input type="hidden" id="f_to" name="date_to">
          </div>

          <div class="search-group" style="position: fixed; left: 0; top: 0; opacity: 0;">
            <input type="text" class="search_qr" id="search_qr" name="qr_code" placeholder="Proximity Code" style="height: 8px; width: 8px; cursor: default;" autocomplete="off" autofocus inputmode="none" enterkeyhint="done">
          </div>
        </div>
        <div style="position: absolute; right: 24px; bottom: 10%; width: 50px; height: 50px;">
          <?php
          $svgPath = ROOT_PATH . '/resource/assets/icon/nfc-icon.svg';
          if (file_exists($svgPath)) {
            echo file_get_contents($svgPath);
          }
          ?>
        </div>
      </form>
      <div class="form-row-btn">
        <div class="form-row">
          <div class="search-btn">
            <button type="button" class="btn btn-primary" onclick="searchEmployees()" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-search"></i> Search</button>
          </div>
          <div class="clear-btn">
            <button type="button" class="btn btn-secondary" onclick="clearSearch()" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-search-minus"></i> Clear</button>
          </div>
          <?php if (canAccess($permissions, 'export-datalog')) : ?>
            <div class="dropdown">
              <button class="btn add-dropdown" id="exportTrigger" onclick="toggleExportOptions()">
                <div class="btn-icon">
                  <?php
                  $svgPath = ROOT_PATH . '/resource/assets/icon/excel.svg';
                  if (file_exists($svgPath)) {
                    echo file_get_contents($svgPath);
                  }
                  ?>
                </div>
                Export Data
                <span class="add-arrow">▼</span>
              </button>
              <div class="add-options-menu" id="exportOptionsMenu">
                <button style="display:flex; align-items:center;" onclick="exportAllData(); hideExportOptions();"><img src="/config/asset.php?t=xpet4" style="height: 20px; margin-right: 5px;">Export All Data</button>
                <button style="display:flex; align-items:center;" onclick="exportFilteredData(); hideExportOptions();"><img src="/config/asset.php?t=xpet4" style="height: 20px; margin-right: 5px;">Export Filtered Data</button>
                <button style="display:flex; align-items:center;" onclick="exportWithImages(); hideExportOptions();"><img src="/config/asset.php?t=xpet4" style="height: 20px; margin-right: 5px;">Export with Images</button>
                <button onclick="hideExportOptions();"><i class="fas fa-times"></i> Cancel</button>
              </div>
            </div>
          <?php endif; ?>
          <?php if (canAccess($permissions, 'delete-datalog')) : ?>
            <div class="delete-all-btn">
              <button type="button" class="btn btn-danger" onclick="openDeleteModal(null, true)" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-trash-alt"></i> Delete All Data</button>
            </div>
          <?php endif; ?>
          <!-- Auto-update controls -->
          <div class="auto-update-controls" style="user-select: none;">
            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; margin:0; user-select:none;">
              <input type="checkbox" class="checkbox" id="autoUpdateToggle">
              <small>Auto-update</small>
            </label>
            <strong id="toggle">OFF</strong>
            <span id="autoUpdateStatus" class="auto-update-status inactive" style="user-select:none;"></span>
            <div class="search-group" style="position:relative;">
              <input type="text" id="updateInterval" placeholder="Every Second"
                autocomplete="off" readonly disabled style="opacity: 0.5; cursor: not-allowed; cursor:pointer; width:120px; height: 25px;">
              <input type="hidden" id="updateInterval_val" value="1000">
            </div>
          </div>
          <div style="position: absolute; font-size: 12px; right: 0; padding-right: 50px; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none;">
            <div id="lastUpdateTime">Last updated: 00:00:00 AM</div>
            <div id="autoUpdateNotification"></div>
          </div>
          <div class="filter-status" id="filter-status"></div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer"></div>

    <!-- ── Employee Log Data table ─────────────────────────────────────────────── -->
    <div class="data-table">
      <div class="table-header">
        <h3 class="table-title">Scanned Records</h3>
        <div class="emp-records">
          <div style="display: flex; gap: 10px;">
            <div class="stat-item total"><i class="fas fa-users"></i></div>
            <p>Total Scanned</p>
            <h3 id="total_scanned"><?php echo $stats['total_scanned']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item active"><i class="fas fa-user-check"></i></div>
            <p>Active Scanned</p>
            <h3 id="active_employees"><?php echo $stats['active_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item inactive"><i class="fas fa-user-times"></i></div>
            <p>Inactive Scanned</p>
            <h3 id="inactive_employees"><?php echo $stats['inactive_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item">
              <?php
              $svgPath = ROOT_PATH . '/resource/assets/icon/scan-icon.svg';
              if (file_exists($svgPath)) {
                echo file_get_contents($svgPath);
              }
              ?>
            </div>
            <p>Scanned Today</p>
            <h3 id="today_attendance"><?php echo $stats['today_attendance']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <div class="stat-item total"><i class="fas fa-calendar-day"></i></div>
            <h3 id="today_in" class="stat-checkin">IN : <?php echo $stats['today_in'] ?? 0; ?></h3>
            <p>&</p>
            <h3 id="today_out" class="stat-checkout">OUT : <?php echo $stats['today_out'] ?? 0; ?></h3>
          </div>
        </div>
      </div>
      <div class="thead-sticky-wrap">
        <table class="thead-table">
          <thead>
            <tr style="border-bottom: 2px solid #e9ecef;">
              <th class="sn-cell">SN</th>
              <th class="sortable-th" data-col="fullname">Fullname <span class="sort-icon">⇅</span></th>
              <th class="sortable-th" data-col="brand">Brand / Department <span class="sort-icon">⇅</span></th>
              <th class="sortable-th" data-col="shift">Shift <span class="sort-icon">⇅</span></th>
              <th class="emp-remark sortable-th" data-col="violation">Remarks <span class="sort-icon">⇅</span></th>
              <th class="emp-img">Image</th>
              <th class="emp-proximity">Proximity Code</th>
              <th class="sortable-th" data-col="access_timestamp">Timestamp <span class="sort-icon">⇅</span></th>
              <th class="sortable-th" data-col="check_status">Check Status <span class="sort-icon">⇅</span></th>
              <th class="sortable-th" data-col="gate_name">Gate / Operator <span class="sort-icon">⇅</span></th>
              <?php if ($hasActionsColumn) : ?>
                <th class="emp-actions">Actions</th>
              <?php endif; ?>
            </tr>
          </thead>
        </table>
      </div>
      <div class="table-scroll-wrap">
        <table class="thead-table">
          <tbody id="employeeTableBody">
            <script>
              (function() {
                const hasActions = <?= json_encode($hasActionsColumn) ?>;
                const pulse = (w, h = '12px', r = '6px') =>
                  `<div style="width:${w};height:${h};border-radius:${r};background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);background-size:600px 100%;animation:skel-shimmer 1.4s ease-in-out infinite;display:inline-block;vertical-align:middle;"></div>`;
                const rows = Array.from({
                    length: 25
                  }, (_, i) =>
                  `<tr class="skel-row" style="animation-delay:${i*60}ms;background:white;">
                    <td class="sn-cell" style="padding:10px 8px;height:52px;vertical-align:middle;">${pulse('24px','10px','4px')}</td>
                    <td style="padding:10px 8px;vertical-align:middle;">
                      <div style="display:flex;flex-direction:column;gap:5px;">${pulse('80%')}${pulse('50%','10px')}</div>
                    </td>
                    <td style="padding:10px 8px;vertical-align:middle;">
                      <div style="display:flex;flex-direction:column;gap:5px;">${pulse('65%')}${pulse('75%','10px')}</div>
                    </td>
                    <td style="padding:10px 8px;vertical-align:middle;">
                      <div style="display:flex;flex-direction:column;gap:5px;">${pulse('55%')}${pulse('60%','10px')}</div>
                    </td>
                    <td class="emp-remark" style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('50px','22px','11px')}</td>
                    <td class="emp-img" style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('44px','44px','50%')}</td>
                    <td class="emp-proximity" style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('28px','28px','50%')}</td>
                    <td style="padding:10px 8px;vertical-align:middle;">${pulse('80px','10px')}</td>
                    <td style="padding:10px 8px;height:52px;vertical-align:middle;">${pulse('60px','44px','50%')}</td>
                    <td style="padding:10px 8px;vertical-align:middle;">${pulse('80px','10px')}</td>
                    ${hasActions ? `<td class="emp-actions" style="padding:10px 8px;vertical-align:middle;">${pulse('72px','26px','6px')}</td>` : ''}
                  </tr>`
                ).join('');

                document.currentScript.insertAdjacentHTML('beforebegin', rows);

                const ls = document.getElementById('loading-screen');
                if (ls) {
                  ls.classList.add('hidden');
                  setTimeout(() => {
                    ls.style.display = 'none';
                  }, 250);
                }
              })();
            </script>
          </tbody>
        </table>
      </div>

      <div id="no-data" class="no-data" style="display: none;">
        <div class="no-data-icon">📋</div>
        <h3>No Employee Data Found</h3>
        <p>Try adjusting your search criteria or load all employees to get started.</p>
      </div>
    </div>
  </div>

  <div class="pagination" id="pagination" style="display: none;"></div>

  <!-- Delete Modal -->
  <div id="deleteModal" class="modal-overlay" style="display: none;">
    <div class="modal-delete-content">
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <div class="modal-header">
        <h2 id="deleteModalTitle">Delete Employee</h2>
      </div>
      <div class="modal-body">
        <p id="deleteModalMessage">Are you sure you want to delete this employee?</p>
        <div id="confirmationContainer" style="display: none; margin-top: 20px;">
          <label for="confirmationInput" style="display: block; margin-bottom: 10px; font-weight: bold;">Type "DELETE ALL" to confirm:</label>
          <input type="text" id="confirmationInput" placeholder="Type DELETE ALL" style="margin-bottom: 10px;" />
        </div>
      </div>
      <div class="form-row-btn">
        <div class="form-row">
          <div>
            <button id="confirmDeleteBtn" class="btn btn-danger">Delete</button>
          </div>
          <div>
            <button type="button" class="btn btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <button class="filter-fab" id="filterFab" onclick="toggleDrawer()">
    <i class="fas fa-sliders-h"></i> Filters
  </button>
  <div class="drawer-backdrop" id="drawerBackdrop" onclick="closeDrawer()"></div>

  <script>
    function toggleDrawer() {
      const controls = document.querySelector('.controls');
      const backdrop = document.getElementById('drawerBackdrop');
      const isOpen = controls.classList.contains('drawer-open');
      if (isOpen) {
        closeDrawer();
      } else {
        controls.classList.add('drawer-open');
        backdrop.classList.add('show');
        document.getElementById('filterFab').innerHTML = '<i class="fas fa-times"></i> Close';
      }
    }

    function closeDrawer() {
      document.querySelector('.controls').classList.remove('drawer-open');
      document.getElementById('drawerBackdrop').classList.remove('show');
      document.getElementById('filterFab').innerHTML = '<i class="fas fa-sliders-h"></i> Filters';
    }

    function checkFab() {
      const fab = document.getElementById('filterFab');
      if (!fab) return;
      fab.style.display = window.innerWidth <= 640 ? 'flex' : 'none';
    }
    checkFab();
    window.addEventListener('resize', checkFab);

    (function() {
      if (window.innerWidth > 640) return;

      let clone = null;

      document.addEventListener('touchstart', function(e) {
        const img = e.target.closest('.employee-image');
        if (!img) return;

        e.preventDefault();

        const rect = img.getBoundingClientRect();
        const cloneSize = 130;

        let left = rect.left;
        let top = rect.top - cloneSize - 8;

        if (top < 8) top = rect.bottom + 8;

        if (left + cloneSize > window.innerWidth - 8) {
          left = window.innerWidth - cloneSize - 8;
        }

        clone = document.createElement('img');
        clone.src = img.src;
        clone.className = 'img-zoom-clone';
        clone.style.left = left + 'px';
        clone.style.top = top + 'px';
        clone.style.width = cloneSize + 'px';
        clone.style.height = cloneSize + 'px';
        document.body.appendChild(clone);

      }, {
        passive: false
      });

      document.addEventListener('touchend', function() {
        if (clone) {
          clone.remove();
          clone = null;
        }
      });

      document.addEventListener('touchcancel', function() {
        if (clone) {
          clone.remove();
          clone = null;
        }
      });

    })();
  </script>

  <script>
    window.PERMISSIONS = {
      delete: <?= json_encode(canAccess($permissions, 'delete-single-datalog')) ?>
    };
    window.NfcIconSVG = <?php
                        $svgPath = ROOT_PATH . '/resource/assets/icon/nfc-icon.svg';
                        echo json_encode(file_exists($svgPath) ? file_get_contents($svgPath) : '');
                        ?>;
  </script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=acwr3"></script>
  <script src="/config/asset.php?t=kaew3"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=mt6ed"></script>
  <script src="/config/asset.php?t=as3ks"></script>
  <script src="/config/asset.php?t=oqw56"></script>
  <script src="/config/asset.php?t=edrg3"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
</body>

</html>