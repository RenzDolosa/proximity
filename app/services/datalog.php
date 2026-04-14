<?php
// app/services/datalog.php --> datalog table

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity code')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('datalog', 'proximity.php');
$access = getMenuAccess();

// Get dashboard statistics if database is connected
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
    // Get total employees
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log");
    $stmt->execute();
    $stats['total_scanned'] = $stmt->fetchColumn();

    // Get active employees (note: status values are 'Active', not 'active')
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE status = 'Active'");
    $stmt->execute();
    $stats['active_employees'] = $stmt->fetchColumn();

    // Get inactive count
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE status = 'Inactive'");
    $stmt->execute();
    $stats['inactive_employees'] = $stmt->fetchColumn();

    // Get today's attendance
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_attendance'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'IN' AND DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_in'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employee_access_log WHERE check_status = 'OUT' AND DATE(access_timestamp) = CURDATE()");
    $stmt->execute();
    $stats['today_out'] = $stmt->fetchColumn();

    // Get recent employee logs (fixed column references)
    $stmt = $userDb->prepare("
            SELECT el.*, e.fullname 
            FROM employee_logs el
            JOIN employees e ON el.employee_id = e.id
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
  <link rel="preload" href="../../resource/assets/icon/database-icon.png" as="image">
  <link rel="preconnect" href="https://filemanager.ai">
  <link rel="prefetch" href="https://filemanager.ai/new3/index.php?home=%2Fhtdocs%2Fuploads%2Fuser">
  <link rel="icon" href="../../resource/assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../../resource/css/system.css">
  <link rel="stylesheet" href="../../resource/css/ptl.css">
  <link rel="stylesheet" href="../../resource/css/modal.css">
  <link rel="stylesheet" href="../../resource/css/btn.css">
  <link rel="stylesheet" href="../../resource/css/is.css">
  <link rel="stylesheet" href="../../resource/css/opt-btn.css">
  <link rel="stylesheet" href="../../resource/css/pg.css">
  <link rel="stylesheet" href="../../resource/css/loading.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
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

  <div class="container">
    <!-- Search and Filter Controls -->
    <div class="controls">
      <form id="searchForm">
        <div class="search-row">
          <div class="search-group">
            <input type="text" id="search_fullname" name="fullname" placeholder="Fullname">
          </div>
          <div class="search-group">
            <select id="search_position" name="position">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="search-group">
            <select id="search_brand" name="brand">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="search-group">
            <select id="search_status" name="status">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="search-group">
            <select id="search_shift" name="shift">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="search-group">
            <select id="search_violation" name="violation">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="search-group">
            <select id="search_in-out" name="check_status">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="search-group">
            <select id="search_user_id" name="user_id">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="search-group">
            <input type="text" id="search_date" name="access_timestamp" placeholder="Date">
          </div>
          <div class="search-group" style="position: fixed; left: 0; top: 0; opacity: 0;">
            <input type="text" class="search_qr" id="search_qr" name="qr_code" placeholder="Proximity Code" style="height: 8px; width: 8px; cursor: default;" autocomplete="off">
          </div>
        </div>
        <img src="../../resource/assets/icon/nfc-icon.svg" alt="Proximity" loading="lazy" style="position: absolute; right: 24px; bottom: 10%; width: 50px; height: 50px;">
      </form>
      <div class="form-row-btn">
        <div class="form-row">
          <div class="search-btn">
            <button type="button" class="btn btn-primary" onclick="searchEmployees()"><i class="fas fa-search"></i> Search</button>
          </div>
          <div class="clear-btn">
            <button type="button" class="btn btn-secondary" onclick="clearSearch()"><i class="fas fa-search-minus"></i> Clear</button>
          </div>
          <div class="dropdown">
            <button class="btn add-dropdown" id="exportTrigger" onclick="toggleExportOptions()">
              <i class="fas fa-file-excel"></i> Export Data
              <span class="add-arrow">▼</span>
            </button>
            <div class="add-options-menu" id="exportOptionsMenu">
              <button onclick="exportAllData(); hideExportOptions();"><i class="fas fa-download"></i> Export All Data</button>
              <button onclick="exportFilteredData(); hideExportOptions();"><i class="fas fa-download"></i> Export Filtered Data</button>
              <button onclick="exportWithImages(); hideExportOptions();"><i class="fas fa-download"></i> Export with Images</button>
              <button onclick="hideExportOptions();"><i class="fas fa-times"></i> Cancel</button>
            </div>
          </div>
          <div class="delete-all-btn">
            <button type="button" class="btn btn-danger" onclick="openDeleteModal(null, true)"><i class="fas fa-trash-alt"></i> Delete All
              Data
            </button>
          </div>
          <!-- Auto-update controls -->
          <div class="auto-update-controls">
            <label style="margin: 0;">
              <input type="checkbox" id="autoUpdateToggle" style="width: 20px; cursor: pointer;" checked> Auto-update
              <span id="autoUpdateStatus" class="auto-update-status active">ON</span>
              <button onclick="forceRefresh()" style="padding: 2px; border-radius: 5px; cursor: pointer;"><i class="fas fa-refresh"></i> Refresh Now</button>
            </label>
            <select id="updateInterval" style="width: 150px; height: 20px; padding: 0; cursor: pointer;">
              <option value="1000" selected>Every Second</option>
              <option value="10000">10 seconds</option>
              <option value="30000">30 seconds</option>
              <option value="60000">1 minute</option>
              <option value="300000">5 minutes</option>
            </select>
          </div>
          <div style="position: absolute; top: 0; right: 0; padding: 10px 50px 0px 0px; justify-content: end; pointer-events: none;">
            <div id="lastUpdateTime"></div>
            <div id="autoUpdateNotification"></div>
          </div>
          <div class="filter-status" id="filter-status"></div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer"></div>

    <!-- Employee Data Table -->
    <div class="data-table">
      <div class="table-header">
        <h3>Employee Records</h3>
        <div class="emp-status">
          <div style="display: flex; gap: 10px;">
            <div class="total-emp"><i class="fas fa-users"></i></div>
            <p>Total Scanned</p>
            <h3 id="total_scanned"><?php echo $stats['total_scanned']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="active-emp"><i class="fas fa-user-check"></i></div>
            <p>Active Scanned</p>
            <h3 id="active_employees"><?php echo $stats['active_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="inactive-emp"><i class="fas fa-user-times"></i></div>
            <p>Inactive Scanned</p>
            <h3 id="inactive_employees"><?php echo $stats['inactive_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <img src="../../resource/assets/icon/scan-icon.svg" class="scan-emp" loading="lazy">
            <p>Scanned Today</p>
            <h3 id="today_attendance"><?php echo $stats['today_attendance']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px; align-items: center;"><i class="fas fa-calendar-day"></i>
            <h3 id="today_in" class="check-in">IN : <?php echo $stats['today_in'] ?? 0; ?></h3>
            <p>&</p>
            <h3 id="today_out" class="check-out">OUT : <?php echo $stats['today_out'] ?? 0; ?></h3>
          </div>
        </div>
      </div>
      <div class="table-scroll-wrap">
        <table>
          <thead>
            <tr>
              <th>SN</th>
              <th>EMPID</th>
              <th>Fullname</th>
              <th>Position</th>
              <th>Brand</th>
              <th>Status</th>
              <th>Shift</th>
              <th class="Col7">Remarks</th> <!-- Violation -->
              <th class="Col8">Image</th>
              <th class="Col9">Proximity Code</th>
              <th>Timestamp</th>
              <th>Check Status</th>
              <th>Gate</th>
            </tr>
          </thead>
          <tbody id="employeeTableBody">
            <!-- Data will be loaded here -->
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
        <h2 id="deleteModalTitle">Delete Employee</h2>
      </div>

      <div class="modal-body">
        <p id="deleteModalMessage">Are you sure you want to delete this employee?</p>

        <!-- Confirmation input for delete all -->
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

    // Hide FAB on desktop — only needed on mobile
    function checkFab() {
      const fab = document.getElementById('filterFab');
      if (!fab) return;
      fab.style.display = window.innerWidth <= 480 ? 'flex' : 'none';
    }
    checkFab();
    window.addEventListener('resize', checkFab);

    // image phone view
    (function() {
      if (window.innerWidth > 480) return; // desktop only uses CSS hover

      let clone = null;

      document.addEventListener('touchstart', function(e) {
        const img = e.target.closest('.employee-image');
        if (!img) return;

        e.preventDefault(); // prevent scroll while zooming

        const rect = img.getBoundingClientRect();
        const cloneSize = 130;

        // Calculate position — anchor left of the image, above center
        let left = rect.left;
        let top = rect.top - cloneSize - 8;

        // If it would go off the top, show below instead
        if (top < 8) top = rect.bottom + 8;

        // Don't go off right edge
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

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="../../resource/js/dtl.js"></script>
  <script src="../../resource/js/btn.js"></script>
  <!-- <script src="../../resource/js/i-dtl.js"></script> -->
  <script src="../../resource/js/ea-dtl.js"></script>
  <script src="../../resource/js/opt-btn.js"></script>
  <script src="../../resource/js/loading.js"></script>
  <script src="../../resource/js/req.js"></script>
</body>

</html>