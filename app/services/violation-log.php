<?php
// app/services/violation_log.php --> Violation Log Table

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code') && !canAccess($permissions, 'remarks')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('remarks', 'system.php');
$access = getMenuAccess();

$stats = [
  'total_violations'   => 0,
  'employees_affected' => 0,
  'this_month'         => 0,
];

if ($databaseConnected) {
  try {
    $stmt = $userDb->prepare("SELECT COUNT(*) FROM violations");
    $stmt->execute();
    $stats['total_violations'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare("SELECT COUNT(DISTINCT employee_id) FROM violations");
    $stmt->execute();
    $stats['employees_affected'] = $stmt->fetchColumn();

    $stmt = $userDb->prepare(
      "SELECT COUNT(*) FROM violations
       WHERE MONTH(violation_date) = MONTH(CURDATE())
         AND YEAR(violation_date)  = YEAR(CURDATE())"
    );
    $stmt->execute();
    $stats['this_month'] = $stmt->fetchColumn();
  } catch (PDOException $e) {
    error_log("Violation stats error: " . $e->getMessage());
  }
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?> - Remarks Log</title>
  <link rel="icon" href="../../resource/assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="../../resource/css/system.css">
  <link rel="stylesheet" href="../../resource/css/ptl.css">
  <link rel="stylesheet" href="../../resource/css/modal.css">
  <link rel="stylesheet" href="../../resource/css/btn.css">
  <link rel="stylesheet" href="../../resource/css/opt-btn.css">
  <link rel="stylesheet" href="../../resource/css/pg.css">
  <link rel="stylesheet" href="../../resource/css/loading.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    /* ── Data table card ──────────────────────────────────────────── */
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }

    .badge-red {
      background: #fff5f5;
      color: #c53030;
      border: 1px solid #fecaca;
    }

    .badge-warn {
      background: #fffbeb;
      color: #b7791f;
      border: 1px solid #fde68a;
    }

    .badge-green {
      background: #f0fff4;
      color: #276749;
      border: 1px solid #9ae6b4;
    }

    .badge-blue {
      background: #ebf8ff;
      color: #2b6cb0;
      border: 1px solid #bee3f8;
    }

    .desc-cell {
      max-width: 260px;
      word-break: break-word;
      line-height: 1.5;
      color: #4a5568;
    }

    /* ── Delete confirmation modal ────────────────────────────────── */
    .modal-overlay.open {
      display: flex;
    }

    .modal-footer {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .f-group {
      position: relative;
    }

    .f-group:has(input[type="date"]) {
      border-radius: 8px;
    }

    .f-group input[type="date"] {
      position: relative;
      z-index: 0;
    }

    .f-group input[type="date"]:focus {
      box-shadow: none;
      outline: none;
    }

    .f-group:has(input[type="date"]:focus) {
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
      border-radius: 8px;
    }

    .f-group input[type="date"]~.fl-label {
      top: 0;
      transform: translateY(-50%);
      font-size: 0.75rem;
      color: #667eea;
      background: linear-gradient(to bottom, transparent 52%, #fff 50%);
      z-index: 10;
      position: absolute;
    }
  </style>
</head>

<body>
  <div class="container">

    <!-- ── Controls ──────────────────────────────────────────────────── -->
    <div class="controls">
      <div class="search-row">
        <div class="search-group" style="position:relative;">
          <input type="text" id="f_name" placeholder="Employee name…"
            oninput="showNameSuggestions(this.value); applyFilters()"
            onkeydown="handleNameSuggestionNav(event)"
            onfocus="showNameSuggestions(this.value)"
            autocomplete="off"
            style="width:100%;">
          <ul id="name-suggestions" style="
            display:none;
            position:absolute;
            top:100%;
            left:0;
            right:0;
            z-index:9999;
            background:#fff;
            border:1px solid #cbd5e1;
            border-top:none;
            border-radius:0 0 8px 8px;
            box-shadow:0 4px 12px rgba(0,0,0,0.1);
            list-style:none;
            margin:0;
            padding:0;
            max-height:220px;
            overflow-y:auto;
          "></ul>
        </div>
        <div class="search-group">
          <select id="f_type" onchange="applyFilters()">
            <option value="">Default: ALL Types</option>
          </select>
        </div>
        <div class="search-group f-group">
          <input type="date" id="f_from" onchange="applyFilters()" title="Date from" placeholder=" ">
          <label class="fl-label" for="f_from">From</label>
        </div>
        <div class="search-group f-group">
          <input type="date" id="f_to" onchange="applyFilters()" title="Date to" placeholder=" ">
          <label class="fl-label" for="f_to">To</label>
        </div>
      </div>
      <div class="form-row-btn">
        <div class="form-row">
          <div>
            <button type="button" class="btn btn-primary" tabindex="-1" onclick="applyFilters()">
              <i class="fas fa-search"></i> Search
            </button>
          </div>
          <div>
            <button type="button" class="btn btn-secondary" tabindex="-1" onclick="clearFilters()">
              <i class="fas fa-search-minus"></i> Clear
            </button>
          </div>
          <div id="filter-status"></div>
        </div>
      </div>
    </div>

    <!-- Alert Messages -->
    <div class="alert-container" id="alertContainer"></div>

    <!-- ── Data table ─────────────────────────────────────────────── -->
    <div class="data-table">
      <div class="table-header">
        <h3 class="table-title">Remarks Records</h3>
        <div class="emp-records">
          <div style="display: flex; gap: 10px;">
            <div class="stat-item total"><i class="fas fa-gavel"></i></div>
            <p>Total</p>
            <h3 id="statTotal"><?= $stats['total_violations'] ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item people"><i class="fas fa-users"></i></div>
            <p>Remarks</p>
            <h3 id="statAffected"><?= $stats['employees_affected'] ?></h3>
          </div>
          <div style="display: flex; gap: 10px;">
            <div class="stat-item monthly"><i class="fas fa-calendar-alt"></i></div>
            <p>This Month</p>
            <h3 id="statMonth"><?= $stats['this_month'] ?></h3>
          </div>
        </div>
      </div>

      <div class="table-scroll-wrap">
        <table>
          <thead>
            <tr>
              <th class="sn-cell">SN</th>
              <th>Employee</th>
              <th>Type</th>
              <th>Description</th>
              <th>Creation Date</th>
              <th>Recorded</th>
              <?php if (canAccess($permissions, 'delete-remarks')) : ?>
                <th>Actions</th>
              <?php endif; ?>
            </tr>
          </thead>
          <tbody id="violationTableBody">
            <tr>
              <td colspan="15" style="text-align:center;padding:40px;color:#aaa;">
                Loading…
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div id="no-data" class="no-data" style="display:none;">
        <div class="no-data-icon">📋</div>
        <h3>No Violation Records Found</h3>
        <p>Try adjusting your search criteria.</p>
      </div>
    </div>
  </div>

  <div class="pagination" id="pagination" style="display: none;">
    <button onclick="previousPage()" id="prev-btn"><i class="fas fa-arrow-left"></i> Previous</button>
    <span id="page-info">Page 1 of 1</span>
    <button onclick="nextPage()" id="next-btn">Next <i class="fas fa-arrow-right"></i></button>
  </div>

  <!-- ── Delete confirm modal ───────────────────────────────────────── -->
  <!-- <div class="modal-overlay" id="confirmModal">
    <div class="modal-delete-content">
      <h2><i class="fas fa-trash-alt" style="color:#e53e3e;"></i> Delete Violation</h2>
      <p id="confirmMsg">
        Are you sure you want to delete this violation record?
        <strong>This cannot be undone.</strong>
      </p>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeConfirm()">
          <i class="fas fa-times"></i> Cancel
        </button>
        <button class="btn btn-danger" id="confirmDeleteBtn" onclick="executeDelete()">
          <i class="fas fa-trash-alt"></i> Delete
        </button>
      </div>
    </div>
  </div> -->

  <!-- Delete Modal -->
  <div id="deleteModal" class="modal-overlay">
    <div class="modal-delete-content">
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <div class="modal-header">
        <h2 id="deleteModalTitle">Delete Remarks</h2>
      </div>
      <div class="modal-body">
        <p id="deleteModalMessage">Are you sure you want to delete this remarks?</p>
        <div id="confirmationContainer" style="display: none; margin-top: 20px;">
          <label for="confirmationInput" style="display: block; margin-bottom: 10px; font-weight: bold;">Type "DELETE ALL" to confirm:</label>
          <input type="text" id="confirmationInput" placeholder="Type DELETE ALL" style="margin-bottom: 10px;" />
        </div>
      </div>
      <button type="button" id="confirmDeleteBtn" class="btn btn-danger" tabindex="-1" onclick="executeDelete()">Delete</button>
      <button type="button" class="btn btn-secondary" tabindex="-1" onclick="closeModal()"><i class="fas fa-times"></i> Cancel</button>
    </div>
  </div>

  <script>
    window.PERMISSIONS = {
      delete: <?= json_encode(canAccess($permissions, 'delete-remarks')) ?>
    };
  </script>

  <script src="../../resource/js/violation.js"></script>
  <script src="../../resource/js/btn.js"></script>
  <script src="../../resource/js/opt-btn.js"></script>
</body>

</html>