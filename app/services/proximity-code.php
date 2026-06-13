<?php
// app/services/proximity-code.php --> proximity table

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code') && !canAccess($permissions, 'remarks')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('proximity-code', ROUTE_APP_ATTENDANCE);
$access = getMenuAccess();

$stats = [
  'total_employees' => 0,
];

$recentLogs = [];
$settings = [];

if ($databaseConnected) {
  try {
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM code");
    $stmt->execute();
    $stats['total_employees'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("
            SELECT el.*, e.qr_code
            FROM code el
            JOIN code e ON el.employee_id = e.id
            ORDER BY el.timestamp DESC 
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
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Proximity code</title>
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
          <!-- Remarks -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_remarks" placeholder="Remarks" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_remarks_val" name="remarks">
          </div>

          <!-- Status -->
          <div class="search-group" style="position:relative;">
            <input type="text" id="search_status" placeholder="Status" autocomplete="off" readonly style="cursor:pointer;">
            <input type="hidden" id="search_status_val" name="status">
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
            canAccess($permissions, 'add-proximity')    ||
            canAccess($permissions, 'import-proximity')
          ) : ?>
            <div class="dropdown">
              <button class="btn add-dropdown" tabindex="-1" id="addTrigger"onclick="toggleAddOptions();">
                <i class="fas fa-ellipsis-v"></i> Add Proximity
                <span class="add-arrow">▼</span>
              </button>
              <div class="add-options-menu" id="addOptionsMenu">
                <?php if (canAccess($permissions, 'add-proximity')) : ?>
                  <button onclick="openModal('add'); hideAddOptions();"><i class="fas fa-plus"></i> Add Proximity Code</button>
                <?php endif; ?>
                <?php if (canAccess($permissions, 'import-proximity')) : ?>
                  <button onclick="openImportModal(); hideAddOptions();"><i class="fas fa-upload"></i> Import Proximity Code</button>
                <?php endif; ?>
                <button onclick="hideAddOptions();"><i class="fas fa-times"></i> Cancel</button>
              </div>
            </div>
          <?php endif; ?>
          <?php if (canAccess($permissions, 'export-proximity')) : ?>
            <div class="dropdown">
              <button class="btn add-dropdown" tabindex="-1"id="exportTrigger" onclick="toggleExportOptions()">
                <img src="/config/asset.php?t=xpet4" style="height: 20px; filter: invert(1);"> Export Data
                <span class="add-arrow">▼</span>
              </button>
              <div class="add-options-menu" id="exportOptionsMenu">
                <button style="display:flex; align-items:center;" onclick="exportAllCodes(); hideExportOptions();"><img src="/config/asset.php?t=xpet4" style="height: 20px; margin-right: 5px;">Export All Data</button>
                <button style="display:flex; align-items:center;" onclick="exportFilteredCodes(); hideExportOptions();"><img src="/config/asset.php?t=xpet4" style="height: 20px; margin-right: 5px;">Export Filtered Data</button>
                <button onclick="hideExportOptions();"><i class="fas fa-times"></i> Cancel</button>
              </div>
            </div>
          <?php endif; ?>
          <?php if (canAccess($permissions, 'delete-proximity')) : ?>
            <div class="delete-all-btn">
              <button type="button" class="btn btn-danger" tabindex="-1" onclick="openDeleteModal(null, true)" disabled style="opacity:0.4;cursor:not-allowed;"><i class="fas fa-trash-alt"></i> Delete All
                Data</button>
            </div>
          <?php endif; ?>
          <div class="filter-status" id="filter-status"></div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer"></div>

    <!-- ── Proximity Code Data table ─────────────────────────────────────────────── -->
    <div class="data-table">
      <div class="table-header">
        <h3 class="table-title">Proximity Records</h3>
        <div class="emp-records">
          <div style="display: flex; gap: 10px;">
            <div class="stat-item total"><i class="fas fa-id-card"></i></div>
            <p>Total Proximity</p>
            <h3 id="total_employees"><?php echo $stats['total_employees']; ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item available"><i class="fas fa-rectangle-list"></i></div>
            <p>Total Available</p>
            <h3 id="total_available">0</h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item occupied"><i class="fas fa-credit-card"></i></div>
            <p>Total Occupied</p>
            <h3 id="total_occupied">0</h3>
          </div>
        </div>
      </div>
      <div class="table-scroll-wrap">
        <table>
          <thead>
            <tr style="border-bottom: 2px solid #e9ecef;">
              <th class="sn-cell">SN</th>
              <th class="emp-img">Image</th>
              <th class="emp-proximity">Proximity Code</th>
              <th class="emp-remark">Remarks</th>
              <th>Status</th>
              <th>Register</th>
              <th>Update</th>
              <?php if (
                canAccess($permissions, 'edit-proximity')   ||
                canAccess($permissions, 'delete-single-proximity')
              ) : ?>
                <th>Actions</th>
              <?php endif; ?>
            </tr>
          </thead>
          <tbody id="employeeTableBody">
            <script>
              (function() {
                const hasActions = <?= json_encode(
                  canAccess($permissions, 'edit-proximity') ||
                  canAccess($permissions, 'delete-single-proximity')
                ) ?>;
                const pulse = (w, h='12px', r='6px') =>
                  `<div style="width:${w};height:${h};border-radius:${r};background:linear-gradient(90deg,#e2e8f0 25%,#f1f5f9 50%,#e2e8f0 75%);background-size:600px 100%;animation:skel-shimmer 1.4s ease-in-out infinite;display:inline-block;vertical-align:middle;"></div>`;
                const rows = Array.from({length: 25}, (_, i) =>
                  `<tr class="skel-row" style="animation-delay:${i*60}ms;background:white;">
                    <td class="sn-cell" style="padding:10px 8px;height:52px;vertical-align:middle;">${pulse('24px','10px','4px')}</td>
                    <td style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('44px','44px','50%')}</td>
                    <td style="padding:10px 8px;height:52px;text-align:center;vertical-align:middle;">${pulse('28px','28px','50%')}</td>
                    <td style="padding:10px 8px;vertical-align:middle;">
                      <div style="display:flex;flex-direction:column;gap:5px;align-items:center;text-align:center;">${pulse('40%')}${pulse('50%', '10px')}</div>
                    </td>
                    <td style="padding:10px 8px;height:52px;text-align:start;vertical-align:middle;">${pulse('50px','22px','11px')}</td>
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
  <div id="employeeModal" class="modal modal-flex">
    <div class="modal-content">

      <!-- HEADER -->
      <div class="modal-header">
        <h2 id="modalTitle"><i class="fas fa-id-card"></i> Add Proximity Code</h2>
        <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      </div>

      <!-- BODY (scrollable) -->
      <div class="modal-body">
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
        </form>
      </div>

      <!-- FOOTER -->
      <div class="modal-footer">
        <button type="submit" form="employeeForm" class="btn btn-success" tabindex="-1">
          <i class="fas fa-save"></i> Save Proximity Code
        </button>
        <button type="button" class="btn btn-secondary" tabindex="-1" onclick="closeModal()">
          <i class="fas fa-times"></i> Cancel
        </button>
      </div>
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

        <div id="confirmationContainer" style="display: none; margin-top: 20px;">
          <label for="confirmationInput" style="display: block; margin-bottom: 10px; font-weight: bold;">Type "DELETE ALL" to confirm:</label>
          <input type="text" id="confirmationInput" placeholder="Type DELETE ALL" style="margin-bottom: 10px;" />
        </div>
      </div>

      <button id="confirmDeleteBtn" class="btn btn-danger" tabindex="-1">Delete</button>
      <button type="button" class="btn btn-secondary" tabindex="-1" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
    </div>
  </div>

  <!-- CSV / Excel Import Modal -->
  <div id="importModal" class="modal modal-flex">
    <div class="modal-content">

      <!-- HEADER -->
      <div class="modal-header">
        <h2><i class="fas fa-upload"></i> Import Proximity Codes from File</h2>
        <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      </div>

      <!-- BODY (scrollable) -->
      <div class="modal-body">
        <div id="importProgress" style="display: none;">
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
            <li><strong>proximity code</strong> - If have Proximity Code (required)</li>
          </ul>
        </div>

        <form id="importForm" enctype="multipart/form-data">
          <div class="form-group">
            <div class="form-row">
              <label for="dataFile">
                <div class="download-label">Select File</div>
              </label>
              <button type="button" class="btn" tabindex="-1" onclick="excelTemplate()" style="display:flex;background:transparent;align-items:center;gap:5px;margin-left:auto;text-decoration:none;color:#007bff;">
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
            <label style="display: grid; grid-template-columns: 300px 20px">
              Skip first row (if it contains headers)
              <input type="checkbox" id="skipHeader" name="skipHeader" checked>
            </label>
          </div>

          <div id="importPreview" style="display: none;">
            <h4>Preview (First 5 rows):</h4>
          </div>
        </form>
      </div>

      <!-- FOOTER -->
      <div class="modal-footer">
        <button type="button" class="btn btn-primary" tabindex="-1" onclick="previewFile()">
          <i class="fas fa-list-ul"></i> Preview
        </button>
        <button type="submit" class="btn btn-import" tabindex="-1">
          <i class="fas fa-upload"></i> Import
        </button>
        <button type="button" class="btn btn-secondary" tabindex="-1" onclick="closeModal()">
          <i class="fas fa-times"></i> Cancel
        </button>
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
      edit: <?= json_encode(canAccess($permissions, 'edit-proximity')) ?>,
      delete: <?= json_encode(canAccess($permissions, 'delete-single-proximity')) ?>
    };
  </script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=xzjg8"></script>
  <script src="/config/asset.php?t=kaew3"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=ds6ed"></script>
  <script src="/config/asset.php?t=dxer5"></script>
  <script src="/config/asset.php?t=as3ks"></script>
  <script src="/config/asset.php?t=oqw56"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
</body>

</html>