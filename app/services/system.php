<?php
// app/services/system.php --> system table

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code') && !canAccess($permissions, 'remarks')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('system', ROUTE_APP_DATALOG);
$access = getMenuAccess();

$hasActionsColumn = (
  canAccess($permissions, 'manual in out-system') ||
  canAccess($permissions, 'logs-system')          ||
  canAccess($permissions, 'edit-system')          ||
  canAccess($permissions, 'delete-single-system')
);

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
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Employees</title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=yde24">
  <link rel="stylesheet" href="/config/asset.php?t=qx2p1">
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
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.css" />
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

          <!-- Register Date -->
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
            <button type="button" class="btn btn-primary" tabindex="-1" onclick="searchEmployees()" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-search"></i> Search</button>
          </div>
          <div class="clear-btn">
            <button type="button" class="btn btn-secondary" tabindex="-1" onclick="clearSearch()" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-search-minus"></i> Clear</button>
          </div>
          <?php if (
            canAccess($permissions, 'add-system')    ||
            canAccess($permissions, 'import-system')
          ) : ?>
            <div class="dropdown">
              <button class="btn add-dropdown" tabindex="-1" id="addTrigger" onclick="toggleAddOptions();">
                <i class="fas fa-ellipsis-v"></i> Add Employee
                <span class="add-arrow">▼</span>
              </button>
              <div class="add-options-menu" id="addOptionsMenu">
                <?php if (canAccess($permissions, 'add-system')) : ?>
                  <button onclick="openModal('add'); hideAddOptions();"><i class="fas fa-plus"></i> Add Employee</button>
                <?php endif; ?>
                <?php if (canAccess($permissions, 'import-system')) : ?>
                  <button onclick="openImportModal(); hideAddOptions();"><i class="fas fa-upload"></i> Import Employee</button>
                <?php endif; ?>
                <button onclick="hideAddOptions();"><i class="fas fa-times"></i> Cancel</button>
              </div>
            </div>
          <?php endif; ?>
          <?php if (canAccess($permissions, 'export-system')) : ?>
            <div class="dropdown">
              <button class="btn add-dropdown" tabindex="-1" id="exportTrigger" onclick="toggleExportOptions()">
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
          <?php if (canAccess($permissions, 'delete-system')) : ?>
            <div class="delete-all-btn">
              <button type="button" class="btn btn-danger" tabindex="-1" onclick="openDeleteModal(null, true)" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-trash-alt"></i> Delete All Data</button>
            </div>
          <?php endif; ?>
          <div class="filter-status" id="filter-status"></div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer"></div>

    <!-- ── Employee Data table ─────────────────────────────────────────────── -->
    <div class="data-table">
      <div class="table-header">
        <h3 class="table-title">Employee Records</h3>
        <div class="emp-records">
          <div style="display: flex; gap: 10px;">
            <div class="stat-item total"><i class="fas fa-users"></i></div>
            <p>Total Employees</p>
            <h3 id="total_employees"><?php echo $stats['total_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item active"><i class="fas fa-user-check"></i></div>
            <p>Active Employees</p>
            <h3 id="active_employees"><?php echo $stats['active_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item inactive"><i class="fas fa-user-times"></i></div>
            <p>Inactive Employees</p>
            <h3 id="inactive_employees"><?php echo $stats['inactive_employees']; ?></h3>
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
              <!-- <th>Gender</th>
              <th>Birth Date</th>
              <th>Hired Date</th> -->
              <th class="sortable-th" data-col="shift">Shift <span class="sort-icon">⇅</span></th>
              <th class="emp-remark sortable-th" data-col="violation">Remarks <span class="sort-icon">⇅</span></th>
              <th class="emp-img">Image</th>
              <th class="emp-proximity">Proximity Code</th>
              <th class="sortable-th" data-col="created_at">Register <span class="sort-icon">⇅</span></th>
              <th class="sortable-th" data-col="updated_at">Update <span class="sort-icon">⇅</span></th>
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
                    <td class="emp-img" style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('45px','45px','50%')}</td>
                    <td class="emp-proximity" style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('28px','28px','50%')}</td>
                    <td style="padding:10px 8px;vertical-align:middle;">${pulse('80px','10px')}</td>
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

  <!-- Employee Modal -->
  <div id="employeeModal" class="modal modal-flex">
    <div class="modal-content">
      <!-- HEADER -->
      <div class="modal-header">
        <h2 id="modalTitle"><i class="fas fa-user-plus"></i> Add Employee</h2>
        <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      </div>

      <!-- BODY (scrollable) -->
      <div class="modal-body">
        <form id="employeeForm" enctype="multipart/form-data">
          <input type="hidden" id="original_id" name="original_id" value="">
          <input type="hidden" id="user_id" name="user_id" value="<?php echo htmlspecialchars($_SESSION['user_id'] ?? ''); ?>">

          <div class="form-row">
            <div class="form-group fl-group">
              <input type="text" id="employee_id" name="id" placeholder=" " autocomplete="off">
              <label class="fl-label" for="employee_id">EMPID <span style="color:#e74c3c">*</span></label>
            </div>
            <div class="form-group fl-group">
              <input type="text" id="fullname" name="fullname" placeholder=" " autocomplete="off">
              <label class="fl-label" for="fullname">Fullname <span style="color:#e74c3c">*</span></label>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group fl-group">
              <input type="text" id="position" name="position" placeholder=" " autocomplete="off">
              <label class="fl-label" for="position">Position <span style="color:#e74c3c">*</span></label>
            </div>
            <div class="form-group fl-group">
              <input type="text" id="brand" name="brand" placeholder=" " autocomplete="off">
              <label class="fl-label" for="brand">Brand / Department <span style="color:#e74c3c">*</span></label>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group fl-group" style="position:relative;">
              <input type="text" id="shift" name="shift" placeholder=" " autocomplete="off" readonly style="cursor:pointer;">
              <label class="fl-label" for="shift">Shift <span style="color:#e74c3c">*</span></label>
            </div>

            <!-- <div class="form-group fl-group">
              <select id="gender" name="gender" class="has-value" onchange="this.classList.toggle('has-value', this.value !== '')">
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
              <label class="fl-label" for="gender">Gender</label>
            </div> -->

            <div class="form-group fl-group">
              <select id="status" name="status" class="has-value" style="cursor: not-allowed;" onchange="this.classList.toggle('has-value', this.value !== '')" disabled>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <label class="fl-label" for="status">Status</label>
            </div>
          </div>

          <!-- <div class="form-row">
            <div class="form-group fl-group">
              <input type="date" id="birth" name="birth" placeholder=" " autocomplete="off">
              <label class="fl-label" for="birth" style="pointer-events:none;">Birth Date <span style="color:#e74c3c">*</span></label>
            </div>
            <div class="form-group fl-group">
              <select id="status" name="status" class="has-value" style="cursor: not-allowed;" onchange="this.classList.toggle('has-value', this.value !== '')" disabled>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
              <label class="fl-label" for="status">Status</label>
            </div>
          </div> -->

          <div class="form-layout">
            <div class="left-column">
              <!-- <div class="form-group fl-group">
                <input type="date" id="hired" name="hired" placeholder=" " autocomplete="off">
                <label class="fl-label" for="hired" style="pointer-events:none;">Hired Date <span style="color:#e74c3c">*</span></label>
              </div> -->
              <div class="form-group fl-group">
                <input type="text" id="qr_code" name="qr_code" placeholder=" " autocomplete="off">
                <label class="fl-label" for="qr_code">Proximity Code</label>
              </div>

              <div class="form-group fl-group">
                <textarea id="violation" name="violation" rows="3"
                  placeholder="Kindly specify any violations, if applicable."
                  style="transition: padding-top 0.15s ease-in-out, padding-bottom 0.15s ease-in-out;"></textarea>
                <label class="fl-label" for="violation">Violation</label>
              </div>
            </div>

            <div class="right-column">
              <div class="form-group fl-group">
                <div class="file-upload-wrapper" style="margin-top: 0.5rem;">
                  <div class="file-upload">
                    <input type="file" id="image" name="image" accept="image/jpeg,image/png,image/gif,image/webp">
                    <label for="image" class="file-upload-label">
                      <i class="fas fa-file-image"></i> Click to select image (Max 5MB)
                    </label>
                  </div>
                  <button type="button" class="camera-toggle-btn" tabindex="-1" onclick="openCameraModal()" title="Capture from camera">
                    <i class="fas fa-camera"></i>
                  </button>
                </div>
                <label class="fl-label" style="top: 0; transform: translateY(-50%); font-size: 0.75rem; color: #667eea;">Employee Image</label>
              </div>
            </div>
          </div>

        </form>
      </div>

      <!-- FOOTER -->
      <div class="modal-footer">
        <button type="submit" form="employeeForm" class="btn btn-success" tabindex="-1">
          <i class="fas fa-save"></i> Save Employee
        </button>
        <button type="button" class="btn btn-secondary" tabindex="-1" onclick="closeModal()">
          <i class="fas fa-times"></i> Cancel
        </button>
      </div>
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

        <div class="camera-container">
          <video id="cameraStream" playsinline autoplay></video>
          <canvas id="cameraPreview" style="display:none;"></canvas>
        </div>

        <div id="cropContainer" style="display:none;">
          <img id="cropImage" alt="Capture for cropping" />
        </div>
      </div>

      <div class="camera-modal-footer">
        <div class="camera-controls">
          <button type="button" class="camera-btn capture" tabindex="-1"
            id="captureBtn" onclick="capturePhoto()">
            <i class="fas fa-circle"></i> Capture
          </button>
          <button type="button" class="camera-btn apply-crop" tabindex="-1"
            id="applyCropBtn" onclick="applyCrop()" style="display:none;">
            <i class="fas fa-crop-alt"></i> Apply Crop
          </button>
          <button type="button" class="camera-btn retake" tabindex="-1"
            id="retakeBtn" onclick="retakePhoto()" style="display:none;">
            <i class="fas fa-redo"></i> Retake
          </button>
          <button type="button" class="camera-btn upload" tabindex="-1"
            id="uploadCameraBtn" onclick="uploadCameraPhoto()" style="display:none;">
            <i class="fas fa-check"></i> Use Photo
          </button>
          <button type="button" class="camera-btn cancel" tabindex="-1" onclick="closeCameraModal()">
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
      <div class="form-row-btn">
        <div class="form-row">
          <div>
            <button type="button" id="confirmDeleteBtn" class="btn btn-danger" tabindex="-1">Delete</button>
          </div>
          <div>
            <button type="button" class="btn btn-secondary" tabindex="-1" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- CSV / Excel Import Modal -->
  <div id="importModal" class="modal modal-flex">
    <div class="modal-content">

      <!-- HEADER -->
      <div class="modal-header">
        <h2><i class="fas fa-upload"></i> Import Employees from File</h2>
        <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      </div>

      <!-- BODY (scrollable) -->
      <div class="modal-body">
        <div id="importProgress" style="display:none;">
          <h4>Import Progress:</h4>
          <div class="progress-bar">
            <div class="progress-fill" id="progressFill"></div>
          </div>
          <div id="importStatus"></div>
        </div>

        <div class="import-instructions">
          <h4>Supported File Formats:</h4>
          <p><strong>&#128196; CSV (.csv)</strong> | <strong>&#128202; Excel (.xlsx, .xls)</strong></p>
          <h4>File Format Requirements:</h4>
          <p>Your file should have the following columns in this order:</p>
          <ul>
            <li><strong>empid</strong> - Employee's ID (required)</li>
            <li><strong>fullname</strong> - Employee's fullname (required)</li>
            <li><strong>position</strong> - Job position</li>
            <li><strong>brand/deparment</strong> - Brand/Department</li>
            <!-- <li><strong>gender</strong> - Gender</li>
            <li><strong>birth date</strong> - Birth Date (DD/MM/YYYY)</li>
            <li><strong>hired date</strong> - Hired Date (DD/MM/YYYY)</li> -->
            <li><strong>status</strong> - Active or Inactive (default: Active)</li>
            <li><strong>shift</strong> - Day Shift, Night Shift, or Graveyard Shift (required)</li>
            <li><strong>remarks</strong> - Any remarks (optional)</li>
            <li><strong>proximity code</strong> - If have Proximity Code (optional)</li>
          </ul>
          <p><em>Note: If blank, Proximity Codes will be automatically generated for each employee.</em></p>
        </div>

        <form id="importForm" enctype="multipart/form-data">
          <div class="form-group">
            <div class="form-row-btn" style="display:flex; width:100%; justify-content:space-between; align-items:center;">
              <label for="dataFile">
                <div class="download-label">Select File</div>
              </label>
              <button type="button" class="btn" tabindex="-1" onclick="excelTemplate()"
                style="display:flex; align-items:center; gap:5px; background:transparent;
                text-decoration:none; color:#007bff; padding:0; border:none; cursor:pointer; width:auto; height:auto;">
                <i class="fas fa-download"></i> Download Excel Template
              </button>
            </div>
            <div class="file-upload">
              <input type="file" id="dataFile" name="dataFile" accept=".csv,.xlsx,.xls" required>
              <label for="dataFile" class="file-upload-label">
                <i class="fas fa-file"></i> Click to select file (.csv, .xlsx, .xls)
              </label>
            </div>
          </div>
          <div class="form-group">
            <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer;">
              Skip first row (if it contains headers)
              <input type="checkbox" class="checkbox" id="skipHeader" name="skipHeader" checked>
            </label>
          </div>
          <div id="importPreview" style="display:none;">
            <h4>Preview (First 10 row's):</h4>
          </div>
        </form>
      </div>

      <!-- FOOTER -->
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" tabindex="-1" onclick="previewFile()">
          <i class="fas fa-list-ul"></i> Preview
        </button>
        <button type="submit" form="importForm" class="btn btn-import" tabindex="-1">
          <i class="fas fa-upload"></i> Import
        </button>
        <button type="button" class="btn btn-secondary" tabindex="-1" onclick="closeModal()">
          <i class="fas fa-times"></i> Cancel
        </button>
      </div>
    </div>
  </div>

  <!-- Employee Logs Modal -->
  <div id="logsModal" class="modal modal-flex" style="display:none;">
    <div class="modal-content" style="max-width:700px;">
      <div class="modal-header">
        <h2 id="logsModalTitle"><i class="fas fa-history"></i> Logs</h2>
        <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      </div>
      <div class="modal-tab" style="padding: 0 1.25rem;"></div>
      <div class="modal-body"></div>
    </div>
  </div>

  <!-- Violation History Modal -->
  <div id="violationsModal" class="modal modal-flex" style="display:none;">
    <div class="modal-content" style="max-width:700px;">
      <div class="modal-header">
        <h2 id="violationsModalTitle"><i class="fas fa-exclamation-triangle" style="color:#e53e3e;"></i> Violation History</h2>
        <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      </div>

      <div style="padding: 0 1.25rem;">
        <div style="display:flex;gap:16px;margin-top:16px;">
          <div style="flex:1;background:#fff5f5;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:#c53030;" id="vioCountTotal">—</div>
            <div style="font-size:13px;color:#c53030;font-weight:600;">Total Records</div>
          </div>
          <div style="flex:1;background:#fffbeb;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:#b7791f;" id="vioCountUpdates">—</div>
            <div style="font-size:13px;color:#b7791f;font-weight:600;">Updates</div>
          </div>
          <div style="flex:1;background:#f0fff4;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:#276749;" id="vioCountCleared">—</div>
            <div style="font-size:13px;color:#276749;font-weight:600;">Cleared</div>
          </div>
        </div>
      </div>

      <div class="modal-body">
        <div style="max-height:360px;overflow-y:auto;border:1px solid #f0f0f0;border-radius:8px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f8f9fa;border-bottom:2px solid #e9ecef;">
                <th style="padding:10px 12px;text-align:left;">SN</th>
                <th style="padding:10px 12px;text-align:left;">Type</th>
                <th style="padding:10px 12px;text-align:left;">Description</th>
                <th style="padding:10px 12px;text-align:left;">Date</th>
                <th style="padding:10px 12px;text-align:left;">Recorded</th>
              </tr>
            </thead>
            <tbody id="violationsTableBody">
              <tr>
                <td colspan="5" style="text-align:center;padding:24px;color:#aaa;">Loading…</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <audio id="successSound" data-fallback="/config/asset.php?t=ero67" preload="none"></audio>
  <audio id="checkoutSound" data-fallback="/config/asset.php?t=jg5df" preload="none"></audio>
  <audio id="noResultSound" data-fallback="/config/asset.php?t=sdh3f" preload="none"></audio>
  <audio id="warningSound" data-fallback="/config/asset.php?t=l45wd" preload="none"></audio>
  <audio id="inactiveSound" data-fallback="/config/asset.php?t=ert26" preload="none"></audio>

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
      manualInOut: <?= json_encode(canAccess($permissions, 'manual in out-system')) ?>,
      logs: <?= json_encode(canAccess($permissions, 'logs-system')) ?>,
      edit: <?= json_encode(canAccess($permissions, 'edit-system')) ?>,
      delete: <?= json_encode(canAccess($permissions, 'delete-single-system')) ?>
    };
  </script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/cropper.min.js"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=ahc32"></script>
  <script src="/config/asset.php?t=gl67w"></script>
  <script src="/config/asset.php?t=kaew3"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=d9fsd"></script>
  <script src="/config/asset.php?t=dxer5"></script>
  <script src="/config/asset.php?t=as3ks"></script>
  <script src="/config/asset.php?t=oqw56"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
</body>

</html>