<?php
// system.php

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity code')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('system', 'datalog.php');
$access = getMenuAccess();

// Get dashboard statistics if database is connected
$stats = [
  'total_employees' => 0,
  'active_employees' => 0,
  'inactive_employees' => 0,
];

$recentLogs = [];
$settings = [];

if ($databaseConnected) {
  try {
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees");
    $stmt->execute();
    $stats['total_employees'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees WHERE status = 'Active'");
    $stmt->execute();
    $stats['active_employees'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(*) FROM employees WHERE status = 'Inactive'");
    $stmt->execute();
    $stats['inactive_employees'] = $stmt->fetchColumn();
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
  <title><?php echo htmlspecialchars($myDatabase); ?> - Manage</title>
  <link rel="preload" href="../../resource/assets/icon/database-icon.png" as="image">
  <link rel="preconnect" href="https://filemanager.ai">
  <link rel="prefetch" href="https://filemanager.ai/new3/index.php?home=%2Fhtdocs%2Fuploads%2Fuser&path=%2F">
  <link rel="icon" href="../../resource/assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../../resource/css/system.css">
  <!-- <link rel="stylesheet" href="../../resource/css/system-responsive.css"> -->
  <link rel="stylesheet" href="../../resource/css/system-camera.css">
  <link rel="stylesheet" href="../../resource/css/ptl.css">
  <link rel="stylesheet" href="../../resource/css/modal.css">
  <link rel="stylesheet" href="../../resource/css/btn.css">
  <link rel="stylesheet" href="../../resource/css/is.css">
  <link rel="stylesheet" href="../../resource/css/opt-btn.css">
  <link rel="stylesheet" href="../../resource/css/pg.css">
  <link rel="stylesheet" href="../../resource/css/loading.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css" />
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
        <div class="form-row">
          <div class="form-group">
            <input type="text" id="search_fullname" name="fullname" placeholder="Fullname">
          </div>
          <div class="form-group">
            <select id="search_position" name="position">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="form-group">
            <select id="search_brand" name="brand">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="form-group">
            <select id="search_status" name="status">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="form-group">
            <select id="search_shift" name="shift">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <div class="form-group">
            <select id="search_violation" name="violation">
              <option value="">Default: ALL</option>
            </select>
          </div>
          <!-- <div class="form-group">
            <input type="text" id="search_date" name="created_at" placeholder="Date">
          </div> -->
          <div class="form-group" style="position: relative;">
            <input type="date"
              id="search_date"
              name="created_at"
              title="Filter by registration date"
              style="padding-right: 28px; cursor: pointer;">
            <button type="button"
              id="clear_date_btn"
              onclick="clearDateFilter()"
              title="Clear date"
              style="display:none; position:absolute; right:6px; top:50%; transform:translateY(-50%);
                 background:none; border:none; cursor:pointer; font-size:14px;
                 color:var(--color-text-secondary); padding:0; line-height:1;">✕</button>
          </div>
          <div class="form-group" style="position: fixed; left: 0; top: 0; opacity: 0;">
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
              <i class="fas fa-ellipsis-v"></i> Add Employee
              <span class="add-arrow">▼</span>
            </button>
            <div class="add-options-menu" id="addOptionsMenu">
              <button onclick="openModal('add'); hideAddOptions();"><i class="fas fa-plus"></i> Add Employee</button>
              <button onclick="openImportModal(); hideAddOptions();"><i class="fas fa-upload"></i> Import Employee</button>
              <button onclick="hideAddOptions();"><i class="fas fa-times"></i> Cancel</button>
            </div>
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
            <button type="button" class="btn btn-danger" onclick="openDeleteModal(null, true)"><i class="fas fa-trash-alt"></i> Delete All Data</button>
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
            <p>Total Employees</p>
            <h3 id="total_employees"><?php echo $stats['total_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="active-emp"><i class="fas fa-user-check"></i></div>
            <p>Active Employees</p>
            <h3 id="active_employees"><?php echo $stats['active_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="inactive-emp"><i class="fas fa-user-times"></i></div>
            <p>Inactive Employees</p>
            <h3 id="inactive_employees"><?php echo $stats['inactive_employees']; ?></h3>
          </div>
        </div>
      </div>
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
            <th class="Col7">Violation</th>
            <th class="Col8">Image</th>
            <th class="Col9">Proximity Code</th>
            <th>Register</th>
            <th>Update</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="employeeTableBody">
          <!-- Data will be loaded here -->
        </tbody>
      </table>

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

  <!-- Employee Modal -->
  <div id="employeeModal" class="modal">
    <div class="modal-content">
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <h2 id="modalTitle">Add Employee</h2>
      <form id="employeeForm" enctype="multipart/form-data">
        <input type="hidden" id="original_id" name="original_id" value="">
        <div class="form-row">
          <div class="form-group">
            <label for="employee_id">EMPID <span style="color:#e74c3c">*</span></label>
            <input type="text" id="employee_id" name="id" placeholder="Enter employee ID">
          </div>
          <div class="form-group">
            <label for="fullname">Fullname <span style="color:#e74c3c">*</span></label>
            <input type="text" id="fullname" name="fullname" placeholder="Enter fullname">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="position">Position <span style="color:#e74c3c">*</span></label>
            <input type="text" id="position" name="position" placeholder="Enter position">
          </div>
          <div class="form-group">
            <label for="brand">Brand <span style="color:#e74c3c">*</span></label>
            <input type="text" id="brand" name="brand" placeholder="Enter brand">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="shift">Shift <span style="color:#e74c3c">*</span></label>
            <select id="shift" name="shift">
              <option value="">Select Shift</option>
              <option value="Day Shift">Day Shift</option>
              <option value="Night Shift">Night Shift</option>
              <option value="Graveyard Shift">Graveyard Shift</option>
            </select>
          </div>
          <div class="form-group">
            <label for="status">Status</label>
            <select id="status" name="status">
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
        <div class="form-layout">
          <div class="left-column">
            <div class="form-group">
              <label for="qr_code">Proximity Code</label>
              <input type="text" id="qr_code" name="qr_code" placeholder="Enter proximity code or leave blank to auto-generate" autocomplete="off">
            </div>
            <div class="form-group">
              <label for="violation">Violation</label>
              <textarea id="violation" name="violation" rows="3" placeholder="Kindly specify any violations, if applicable."></textarea>
            </div>
          </div>
          <div class="right-column">
            <div class="form-group">
              <label for="image">Employee Image</label>
              <div class="file-upload-wrapper">
                <div class="file-upload">
                  <input type="file" id="image" name="image" accept="image/jpeg,image/png,image/gif,image/webp">
                  <label for="image" class="file-upload-label">
                    <i class="fas fa-file-image"></i> Click to select image (Max 5MB)
                  </label>
                </div>
                <button type="button" class="camera-toggle-btn" onclick="openCameraModal()" title="Capture from camera">
                  <i class="fas fa-camera"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div class="form-row" style="margin-top: 2rem;">
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Save Employee</button>
          <button type="button" class="btn btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Camera Modal -->
  <div id="cameraModal" class="camera-modal">
    <div class="camera-modal-content">

      <div class="camera-modal-header">
        <h2><i class="fas fa-camera"></i> Capture &amp; Crop Photo</h2>
        <button type="button" class="close-camera" onclick="closeCameraModal()">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <div class="camera-modal-body">

        <!-- Camera selector + status -->
        <div class="camera-selextor-grid">
          <div class="camera-selector-container">
            <label for="cameraSelector">
              <i class="fas fa-video"></i> Camera:
            </label>
            <select id="cameraSelector">
              <option value="">Loading…</option>
            </select>
          </div>
          <div class="camera-status info" id="cameraStatus">
            Initializing camera…
          </div>
        </div>

        <!-- Live video + final preview canvas share this wrapper -->
        <div class="camera-container">
          <video id="cameraStream" playsinline autoplay></video>
          <canvas id="cameraPreview" style="display:none;"></canvas>
        </div>

        <!--
        Crop container — hidden until a photo is captured.
        Cropper.js mounts on #cropImage.
      -->
        <div id="cropContainer" style="display:none;">
          <img id="cropImage" alt="Capture for cropping" />
        </div>

        <!-- Action buttons -->
        <div class="camera-controls">
          <button type="button" class="camera-btn capture"
            id="captureBtn" onclick="capturePhoto()">
            <i class="fas fa-circle"></i> Capture
          </button>

          <!-- Shown while crop interface is active -->
          <button type="button" class="camera-btn apply-crop"
            id="applyCropBtn" onclick="applyCrop()" style="display:none;">
            <i class="fas fa-crop-alt"></i> Apply Crop
          </button>

          <button type="button" class="camera-btn retake"
            id="retakeBtn" onclick="retakePhoto()" style="display:none;">
            <i class="fas fa-redo"></i> Retake
          </button>

          <button type="button" class="camera-btn upload"
            id="uploadCameraBtn" onclick="uploadCameraPhoto()" style="display:none;">
            <i class="fas fa-check"></i> Use Photo
          </button>

          <button type="button" class="camera-btn cancel" onclick="closeCameraModal()">
            <i class="fas fa-times"></i> Cancel
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Delete Modal -->
  <div id="deleteModal" class="modal-overlay">
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
      <button type="button" id="confirmDeleteBtn" class="btn btn-danger">Delete</button>
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
      <h2>Import Employees from File</h2>

      <div class="import-instructions">
        <h4>Supported File Formats:</h4>
        <p><strong>&#128196; CSV (.csv)</strong> | <strong>&#128202; Excel (.xlsx, .xls)</strong></p>
        <h4>File Format Requirements:</h4>
        <p>Your file should have the following columns in this order:</p>
        <ul>
          <li><strong>empid</strong> - Employee's ID (required)</li>
          <li><strong>fullname</strong> - Employee's fullname (required)</li>
          <li><strong>position</strong> - Job position</li>
          <li><strong>brand</strong> - Brand/Department</li>
          <li><strong>status</strong> - Active or Inactive (default: Active)</li>
          <li><strong>shift</strong> - Day Shift, Night Shift, or Graveyard Shift (required)</li>
          <li><strong>violation</strong> - Any violations (optional)</li>
          <li><strong>proximity code</strong> - If have Proximity Code (optional)</li>
        </ul>
        <p><em>Note: If blank, Proximity Codes will be automatically generated for each employee.</em></p>
      </div>

      <form id="importForm" enctype="multipart/form-data">
        <div class="form-group">
          <div class="form-row">
            <label for="dataFile">
              <div class="download-label">Select File</div>
            </label>
            <a href="#" onclick="excelTemplate()" style="display: flex; align-items: center; gap: 5px; margin-left: auto; text-decoration: none; color: #007bff;">
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

  <!-- Employee Logs Modal -->
  <div id="logsModal" class="modal" style="display:none;">
    <div class="modal-content" style="max-width:700px;">
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <h2 id="logsModalTitle"><i class="fas fa-history"></i> Access Logs</h2>

      <!-- Summary cards -->
      <div style="display:flex;gap:16px;margin:16px 0;">
        <div style="flex:1;background:#d1fae5;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#065f46;" id="logCountIn">—</div>
          <div style="font-size:13px;color:#065f46;font-weight:600;">Total IN</div>
        </div>
        <div style="flex:1;background:#fee2e2;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#991b1b;" id="logCountOut">—</div>
          <div style="font-size:13px;color:#991b1b;font-weight:600;">Total OUT</div>
        </div>
        <div style="flex:1;background:#ede9fe;border-radius:8px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:#5b21b6;" id="logCountTotal">—</div>
          <div style="font-size:13px;color:#5b21b6;font-weight:600;">Total Scans</div>
        </div>
      </div>

      <!-- Logs table -->
      <div style="max-height:360px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f8f9fa;border-bottom:2px solid #e9ecef;">
              <th style="padding:10px 12px;text-align:left;">SN</th>
              <th style="padding:10px 12px;text-align:left;">Status</th>
              <th style="padding:10px 12px;text-align:left;">Timestamp</th>
            </tr>
          </thead>
          <tbody id="logsTableBody">
            <tr>
              <td colspan="3" style="text-align:center;padding:24px;color:#aaa;">Loading…</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <audio id="successSound" src="../../resource/assets/sounds/success.mp3" preload="auto"></audio>
  <audio id="noResultSound" src="../../resource/assets/sounds/noResultsFound.mp3" preload="auto"></audio>
  <audio id="warningSound" src="../../resource/assets/sounds/ohh-ow.mp3" preload="auto"></audio>
  <audio id="inactiveSound" src="../../resource/assets/sounds/inactive.mp3" preload="auto"></audio>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js"></script>
  <script src="../../resource/js/system.js"></script>
  <script src="../../resource/js/system-camera.js"></script>
  <script src="../../resource/js/btn.js"></script>
  <script src="../../resource/js/is.js"></script>
  <script src="../../resource/js/eas.js"></script>
  <script src="../../resource/js/opt-btn.js"></script>
  <script src="../../resource/js/loading.js"></script>
  <script src="../../resource/js/req.js"></script>
</body>

</html>