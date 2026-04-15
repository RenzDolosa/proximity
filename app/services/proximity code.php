<?php
// app/services/proximitycode.php --> proximity table

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';


$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity code')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('proximity code', 'system.php');
$access = getMenuAccess();

// Get dashboard statistics if database is connected
$stats = [
  'total_employees' => 0,
];

$recentLogs = [];
$settings = [];

if ($databaseConnected) {
  try {
    // Get total employees
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM code");
    $stmt->execute();
    $stats['total_employees'] = $stmt->fetchColumn();

    // Get recent proximity code logs (fixed column references)
    $stmt = $userDb->prepare("
            SELECT el.*, e.qr_code
            FROM code el
            JOIN code e ON el.employee_id = e.id
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
  <title><?php echo htmlspecialchars($myDatabase); ?> - Proximity Code</title>
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
            <select id="search_remarks" name="remarks">
              <option value="">Default: ALL</option>
              <option value="Available">Available</option>
              <option value="Occupied">Occupied</option>
            </select>
          </div>
          <div class="search-group">
            <input type="text" id="search_date" name="created_at" placeholder="Date">
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
            <button class="btn add-dropdown" id="addTrigger" onclick="toggleAddOptions();">
              <i class="fas fa-ellipsis-v"></i> Add Proximity
              <span class="add-arrow">▼</span>
            </button>
            <div class="add-options-menu" id="addOptionsMenu">
              <button onclick="openModal('add'); hideAddOptions();"><i class="fas fa-plus"></i> Add Proximity Code</button>
              <button onclick="openImportModal(); hideAddOptions();"><i class="fas fa-upload"></i> Import Proximity Code</button>
              <button onclick="hideAddOptions();"><i class="fas fa-times"></i> Cancel</button>
            </div>
          </div>
          <div class="dropdown">
            <button class="btn add-dropdown" id="exportTrigger" onclick="toggleExportOptions()">
              <i class="fas fa-file-excel"></i> Export Data
              <span class="add-arrow">▼</span>
            </button>
            <div class="add-options-menu" id="exportOptionsMenu">
              <button onclick="exportAllCodes(); hideExportOptions();"><i class="fas fa-download"></i> Export All Data</button>
              <button onclick="exportFilteredCodes(); hideExportOptions();"><i class="fas fa-download"></i> Export Filtered Data</button>
              <button onclick="hideExportOptions();"><i class="fas fa-times"></i> Cancel</button>
            </div>
          </div>
          <div class="delete-all-btn">
            <button type="button" class="btn btn-danger" onclick="openDeleteModal(null, true)"><i class="fas fa-trash-alt"></i> Delete All
              Data</button>
          </div>
          <div class="filter-status" id="filter-status"></div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer"></div>

    <!-- Proximity Code Table -->
    <div class="data-table">
      <div class="table-header">
        <h3>Proximity Records</h3>
        <div class="emp-status">
          <div style="display: flex; gap: 10px;">
            <div class="total-emp"><i class="fas fa-id-card"></i></div>
            <p>Total Proximity</p>
            <h3 id="total_employees"><?php echo $stats['total_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="active-emp"><i class="fas fa-rectangle-list"></i></div>
            <p>Total Available</p>
            <h3 id="total_available">0</h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="inactive-emp"><i class="fas fa-credit-card"></i></div>
            <p>Total Occupied</p>
            <h3 id="total_occupied">0</h3>
          </div>
        </div>
      </div>
      <div class="table-scroll-wrap">
        <table>
          <thead>
            <tr>
              <th>SN</th>
              <th class="Col8">Image</th>
              <th>EMPID</th>
              <th class="Col9">Proximity Code</th>
              <th>Remarks</th>
              <th>Status</th>
              <th>Register</th>
              <th>Update</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="employeeTableBody">
            <!-- Data will be loaded here -->
          </tbody>
        </table>
      </div>

      <div id="no-data" class="no-data" style="display: none;">
        <div class="no-data-icon">📋</div>
        <h3>No Proximity Code Found</h3>
        <p>Try adjusting your search criteria or load all proximity codes to get started.</p>
      </div>
    </div>
  </div>

  <div class="pagination" id="pagination" style="display: none;">
    <button onclick="previousPage()" id="prev-btn"><i class="fas fa-arrow-left"></i> Previous</button>
    <span id="page-info">Page 1 of 1</span>
    <button onclick="nextPage()" id="next-btn">Next <i class="fas fa-arrow-right"></i></button>
  </div>

  <!-- Proximity Code Modal -->
  <div id="employeeModal" class="modal">
    <div class="modal-content">
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <h2 id="modalTitle" style="padding-bottom: 10px;">Add Proximity Code</h2>
      <form id="employeeForm" enctype="multipart/form-data">
        <input type="hidden" id="employee_id" name="id">
        <div class="form-group fl-group">
          <input type="text" id="qr_code" name="qr_code" placeholder=" " autocomplete="off">
          <label class="fl-label" for="qr_code">Proximity Code <span style="color:#e74c3c">*</span></label>
        </div>
        <div class="form-group">
          <div style="display:flex; align-items: center; gap: 12px; margin-top: 6px;">
            <span style="font-weight:500;">Status</span>
            <label class="toggle-switch">
              <input type="checkbox" id="is_active_toggle" name="is_active_toggle" checked>
              <span class="toggle-slider"></span>
            </label>
            <span id="statusLabel" style="font-weight:600; color:#16a34a;">Enabled</span>
            <input type="hidden" id="is_active" name="is_active" value="1">
          </div>
        </div>
        <div class="form-row" style="margin-top: 2rem;">
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Save Proximity Code</button>
          <button type="button" class="btn btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
        </div>
      </form>
    </div>
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

  <!-- CSV / Excel Import Modal -->
  <div id="importModal" class="modal">
    <div class="modal-content">
      <div id="importProgress" style="display: none;">
        <h4>Import Progress:</h4>
        <div class="progress-bar">
          <div class="progress-fill" id="progressFill"></div>
        </div>
        <div id="importStatus"></div>
      </div>
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <h2>Import Proximity Codes from File</h2>

      <div class="import-instructions">
        <h4>Supported File Formats:</h4>
        <p><strong>&#128196; CSV (.csv)</strong> | <strong>&#128202; Excel (.xlsx, .xls)</strong></p>

        <h4>File Format Requirements:</h4>
        <p>Your file should have the following columns in this order:</p>
        <ul>
          <li><strong>proximity code</strong> - If have Proximity Code (required)</li>
        </ul>
        <!-- <p><em>Note: If blank Proximity Codes will be automatically generated for each employee.</em></p> -->
      </div>

      <form id="importForm" enctype="multipart/form-data">
        <div class="form-group">
          <div class="form-row">
            <label for="dataFile">
              <div class="download-label">Select File</div>
            </label>
            <a href="#" onclick="excelProxCodeTemplate()" style="display: flex; align-items: center; gap: 5px; margin-left: auto; text-decoration: none; color: #007bff;">
              <i class="fas fa-download"></i> Download Excel Template
            </a>
          </div>
          <div class="file-upload">
            <input type="file" id="dataFile" name="dataFile" accept=".csv,.xlsx,.xls" required>
            <label for="dataFile" class="file-upload-label">
              <i class="fas fa-file"></i> Click to select file (.csv, .xlsx, .xls)
            </label>
          </div>
        </div>

        <div class="form-group">
          <label style="display: grid; grid-template-columns: 300px 20px">
            Skip first row (if it contains headers)
            <input type="checkbox" id="skipHeader" name="skipHeader" checked>
          </label>
        </div>

        <div id="importPreview" style="display: none;">
          <h4>Preview (First 5 rows):</h4>
        </div>

        <div class="form-row" style="margin-top: 2rem;">
          <button type="button" class="btn btn-primary" onclick="previewFile()"><i class="fas fa-list-ul"></i> Preview</button>
          <button type="submit" class="btn btn-import"><i class="fas fa-upload"></i> Import</button>
          <button type="button" class="btn btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <audio id="successSound" src="../../resource/assets/sounds/success.mp3" preload="auto"></audio>
  <audio id="noResultSound" src="../../resource/assets/sounds/noResultsFound.mp3" preload="auto"></audio>
  <audio id="warningSound" src="../../resource/assets/sounds/ohh-ow.mp3" preload="auto"></audio>
  <audio id="inactiveSound" src="../../resource/assets/sounds/inactive.mp3" preload="auto"></audio>

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
  <script src="../../resource/js/proxcode.js"></script>
  <script src="../../resource/js/btn.js"></script>
  <script src="../../resource/js/ipc.js"></script>
  <script src="../../resource/js/eas.js"></script>
  <script src="../../resource/js/opt-btn.js"></script>
  <script src="../../resource/js/loading.js"></script>
  <script src="../../resource/js/req.js"></script>
</body>

</html>