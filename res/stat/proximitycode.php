<?php
// system.php

require_once '../cnfg/config.php';
require_once '../cnfg/db.php';

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
    // Get total employees
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM code");
    $stmt->execute();
    $stats['total_employees'] = $stmt->fetchColumn();

    // Get recent proximity code logs (fixed column references)
    $stmt = $userDb->prepare("
            SELECT el.*, e.qr_code
            FROM employee_logs el
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
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Manage</title>
  <link rel="icon" href="../icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../css/proxcode.css">
  <link rel="stylesheet" href="../css/ptl.css">
  <link rel="stylesheet" href="../css/modal.css">
  <link rel="stylesheet" href="../css/btn.css">
  <link rel="stylesheet" href="../css/is.css">
  <link rel="stylesheet" href="../css/opt-btn.css">
  <link rel="stylesheet" href="../css/pg.css">
  <link rel="stylesheet" href="../css/loading.css">
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

  <div onclick="window.location.href='../iframe/ptl.php';" style="position: fixed;
      top: 0;
      right: 1vmin;
      padding: 1vmin;
      z-index: 1000;
      cursor: pointer;
      color: red;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);">
    <i class="fas fa-times"></i>
  </div>

  <div class="container">
    <!-- Search and Filter Controls -->
    <div class="controls">
      <h3 style="padding-bottom: 1rem; cursor: default;">Search & Filter</h3>
      <form id="searchForm">
        <div class="form-row">
          <div class="form-group">
            <label for="search_date">Date</label>
            <input type="text" id="search_date" name="created_at" placeholder="Search by date...">
          </div>
          <div class="form-group" style="position: absolute; right: -100px; bottom: 10%; opacity: 1;">
            <img src="../icon/nfc-icon.png" alt="Proximity" style="width: 50px; height: 50px;">
          </div>
          <div class="form-group" style="position: absolute; right: 1%; bottom: 10%; opacity: 0;">
            <label for="search_qr">Proximity Code</label>
            <input type="text" class="search_qr" id="search_qr" name="qr_code" placeholder="Search by proximity code..." style="cursor: default;" autocomplete="off">
          </div>
        </div>
      </form>
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
            <button onclick="exportAllData(); hideExportOptions();"><i class="fas fa-download"></i> Export All Data</button>
            <button onclick="exportFilteredData(); hideExportOptions();"><i class="fas fa-download"></i> Export Filtered Data</button>
            <button onclick="exportWithImages(); hideExportOptions();"><i class="fas fa-download"></i> Export with Images</button>
            <button onclick="hideExportOptions();"><i class="fas fa-times"></i> Cancel</button>
          </div>
        </div>
        <div class="delete-all-btn">
          <button type="button" class="btn btn-danger" onclick="deleteAllEmployees()"><i class="fas fa-trash-alt"></i> Delete All
            Data</button>
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
            <div class="total-emp"><i class="fas fa-users"></i></div>
            <p>Total Proximity Codes</p>
            <h3 id="total_employees"><?php echo $stats['total_employees']; ?></h3>
          </div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>SN</th>
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
      <h2 id="modalTitle">Add Proximity Code</h2>
      <form id="employeeForm" enctype="multipart/form-data">
        <input type="hidden" id="employee_id" name="id">
        <div class="form-group">
          <label for="qr_code">Proximity Code</label>
          <input type="text" id="qr_code" name="qr_code" placeholder="Enter proximity code or leave blank to auto-generate" autocomplete="off" autofocus>
        </div>
        <div class="form-row" style="margin-top: 2rem;">
          <button type="submit" class="btn btn-success"><i class="fas fa-save"></i> Save Proximity Code</button>
          <button type="button" class="btn btn-secondary" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <!-- CSV / Excel Import Modal -->
  <div id="importModal" class="modal">
    <div class="modal-content">
      <span class="close" onclick="closeImportModal()"><i class="fas fa-times"></i></span>
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
          <label for="dataFile">
            <div class="download-label">Select File
              <a href="#" onclick="excelProxCodeTemplate()" class="template-download-link">
                <i class="fas fa-download"></i> Download Excel Template
              </a>
            </div>
          </label>
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
          <button type="button" class="btn btn-secondary" onclick="closeImportModal()"><i class="fas fa-times"></i> Cancel</button>
        </div>
      </form>

      <div id="importProgress" style="display: none;">
        <h4>Import Progress:</h4>
        <div class="progress-bar">
          <div class="progress-fill" id="progressFill"></div>
        </div>
        <div id="importStatus"></div>
      </div>
    </div>
  </div>

  <audio id="successSound" src="../sounds/success.mp3" preload="auto"></audio>
  <audio id="noResultSound" src="../sounds/noResultsFound.mp3" preload="auto"></audio>
  <audio id="warningSound" src="../sounds/ohh-ow.mp3" preload="auto"></audio>
  <audio id="inactiveSound" src="../sounds/inactive.mp3" preload="auto"></audio>
  <!-- Add XLSX library for Excel file support -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="../src/proxcode.js"></script>
  <script src="../src/ipc.js"></script>
  <script src="../src/eas.js"></script>
  <script src="../src/opt-btn.js"></script>
  <script src="../src/loading.js"></script>
  <script src="../src/req.js"></script>
</body>

</html>