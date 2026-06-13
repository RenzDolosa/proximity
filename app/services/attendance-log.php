<?php
// app/services/attendancelog.php --> attendance log table

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code') && !canAccess($permissions, 'remarks')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('attendance', ROUTE_APP_EMPLOYEES);
$access = getMenuAccess();

$stats = [
  'total_scanned'     => 0,
  'active_employees'  => 0,
  'inactive_employees' => 0,
  'today_attendance'  => 0,
];

$recentLogs = [];
$settings   = [];

if ($databaseConnected) {
  try {
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_attendance_log");
    $stmt->execute();
    $stats['total_scanned'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_attendance_log WHERE status = 'Active'");
    $stmt->execute();
    $stats['active_employees'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_attendance_log WHERE status = 'Inactive'");
    $stmt->execute();
    $stats['inactive_employees'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_attendance_log WHERE DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_attendance'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("
            SELECT el.*, e.fullname
            FROM employee_attendance_log el
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Scanned Log</title>
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
            <input type="text" class="search_qr" id="search_qr" name="qr_code" placeholder="Proximity Code" style="height: 8px; width: 8px; cursor: default;" autocomplete="off">
          </div>
        </div>
        <img src="/config/asset.php?t=gnks2" alt="Proximity" loading="lazy" style="position: absolute; right: 24px; bottom: 10%; width: 50px; height: 50px;">
      </form>
      <div class="form-row-btn">
        <div class="form-row">
          <div class="search-btn">
            <button type="button" class="btn btn-primary" onclick="searchEmployees()" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-search"></i> Search</button>
          </div>
          <div class="clear-btn">
            <button type="button" class="btn btn-secondary" onclick="clearSearch()" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-search-minus"></i> Clear</button>
          </div>
          <?php if (canAccess($permissions, 'export-attendance')) : ?>
            <div class="dropdown">
              <button class="btn add-dropdown" id="exportTrigger" onclick="toggleExportOptions()">
                <img src="/config/asset.php?t=xpet4" style="height: 20px; filter: invert(1);"> Export Data
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
          <?php if (canAccess($permissions, 'delete-attendance')) : ?>
            <div class="delete-all-btn">
              <button type="button" class="btn btn-danger" onclick="openDeleteModal(null, true)" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-trash-alt"></i> Delete All Data</button>
            </div>
          <?php endif; ?>
          <!-- Auto-update controls -->
          <div class="auto-update-controls" style="user-select: none;">
            <label for="autoUpdateToggle" style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; margin: 0; user-select:none;">
              <input type="checkbox" id="autoUpdateToggle" style="width: 16px; cursor: pointer;">
              <small>Auto-update</small>
            </label>
            <span id="autoUpdateStatus" class="auto-update-status inactive" style="user-select:none;"></span>
            <button class="fRefresh-btn" onclick="forceRefresh()" disabled style="opacity: 0.4; cursor: not-allowed; padding: 2px; border-radius: 5px; cursor: pointer; user-select:none;">
              <i class="fas fa-refresh"></i> <small>Refresh Now</small>
            </button>
            <div class="search-group" style="position:relative;">
              <input type="text" id="updateInterval" placeholder="Every Second"
                autocomplete="off" readonly disabled style="opacity: 0.5; cursor: not-allowed; width:130px; height: 25px;">
              <input type="hidden" id="updateInterval_val" value="1000">
            </div>
          </div>
          <div style="position: absolute; right: 0; padding-right: 50px; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none;">
            <div id="lastUpdateTime"></div>
            <div id="autoUpdateNotification"></div>
          </div>
          <div class="filter-status" id="filter-status"></div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer"></div>

    <!-- ── Attendance Log Data table ─────────────────────────────────────────────── -->
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
            <div class="stat-item"><img src="/config/asset.php?t=rjr54" alt="Scan Icon" loading="lazy"></div>
            <p>Scanned Today</p>
            <h3 id="today_attendance"><?php echo $stats['today_attendance']; ?></h3>
          </div>
        </div>
      </div>
      <div class="table-scroll-wrap">
        <table>
          <thead>
            <tr style="border-bottom: 2px solid #e9ecef;">
              <th class="sn-cell">SN</th>
              <th>Fullname</th>
              <th>Brand / Department</th>
              <th>Shift</th>
              <th class="emp-remark">Remarks</th>
              <th class="emp-img">Image</th>
              <th class="emp-proximity">Proximity Code</th>
              <th>Timestamp</th>
              <th>Gate / Operator</th>
              <?php if (canAccess($permissions, 'delete-single-attendance')) : ?>
                <th>Actions</th>
              <?php endif; ?>
            </tr>
          </thead>
          <tbody id="employeeTableBody">
            <script>
              (function() {
                const hasActions = <?= json_encode(
                  canAccess($permissions, 'delete-single-attendance')
                ) ?>;
                const pulse = (w, h='12px', r='6px') =>
                  `<div style="width:${w};height:${h};border-radius:${r};background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);background-size:600px 100%;animation:skel-shimmer 1.4s ease-in-out infinite;display:inline-block;vertical-align:middle;"></div>`;
                const rows = Array.from({length: 25}, (_, i) =>
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
                    <td style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('50px','22px','11px')}</td>
                    <td style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('44px','44px','50%')}</td>
                    <td style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('28px','28px','50%')}</td>
                    <td style="padding:10px 8px;vertical-align:middle;">${pulse('80px','10px')}</td>
                    <td style="padding:10px 8px;vertical-align:middle;">${pulse('80px','10px')}</td>
                    ${hasActions ? `<td style="padding:10px 8px;vertical-align:middle;">${pulse('72px','26px','6px')}</td>` : ''}
                  </tr>`
                ).join('');
                document.currentScript.insertAdjacentHTML('beforebegin', rows);
              })();
            </script>
          </tbody>
        </table>
      </div>

      <div id="no-data" class="no-data" style="display: none;">
        <div class="no-data-icon">📋</div>
        <h3>No Attendance Data Found</h3>
        <p>Try adjusting your search criteria or load all records to get started.</p>
      </div>
    </div>
  </div>

  <div class="pagination" id="pagination" style="display: none;">
    <button onclick="previousPage()" id="prev-btn"><i class="fas fa-arrow-left"></i> Previous</button>
    <span id="page-info">Page 1 of 1</span>
    <button onclick="nextPage()" id="next-btn">Next <i class="fas fa-arrow-right"></i></button>
  </div>

  <!-- Delete Modal -->
  <div id="deleteModal" class="modal-overlay" style="display: none;">
    <div class="modal-delete-content">
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <div class="modal-header">
        <h2 id="deleteModalTitle">Delete Record</h2>
      </div>
      <div class="modal-body">
        <p id="deleteModalMessage">Are you sure you want to delete this record?</p>
        <div id="confirmationContainer" style="display: none; margin-top: 20px;">
          <label for="confirmationInput" style="display: block; margin-bottom: 10px; font-weight: bold;">Type "DELETE ALL" to confirm:</label>
          <input type="text" id="confirmationInput" placeholder="Type DELETE ALL" style="margin-bottom: 10px;" />
        </div>
      </div>
      <button id="confirmDeleteBtn" class="btn btn-danger">Delete</button>
      <button type="button" class="btn btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
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
        if (left + cloneSize > window.innerWidth - 8) left = window.innerWidth - cloneSize - 8;
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
      delete: <?= json_encode(canAccess($permissions, 'delete-single-attendance')) ?>
    };
  </script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=cq4da"></script>
  <script src="/config/asset.php?t=kaew3"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=j445s"></script>
  <script src="/config/asset.php?t=as3ks"></script>
  <script src="/config/asset.php?t=oqw56"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
</body>

</html>