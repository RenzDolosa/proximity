<?php
// app/services/violation-log.php --> Violation Log Table

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code') && !canAccess($permissions, 'remarks')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('remarks', ROUTE_APP_EMPLOYEES);
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
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=yde24">
  <link rel="stylesheet" href="/config/asset.php?t=a5dh7">
  <!-- <link rel="stylesheet" href="/config/asset.php?t=mq4wc"> -->
  <link rel="stylesheet" href="/config/asset.php?t=g5f2v">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=p5sdi">
  <link rel="stylesheet" href="/config/asset.php?t=x48xd">
  <link rel="stylesheet" href="/config/asset.php?t=rtf2w">
  <link rel="stylesheet" href="/config/asset.php?t=q5fwr">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
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
  </style>
</head>

<body>
  <div class="container">
    <!-- Search and Filter Controls -->
    <div class="controls">
      <form id="filterForm">
        <div class="search-row">

          <div class="search-group">
            <input type="text"
              id="f_name"
              name="fullname"
              placeholder="Employee name…"
              autocomplete="off">
          </div>

          <div class="search-group" style="position:relative;">
            <input type="text"
              id="f_type_display"
              placeholder="Type"
              autocomplete="off"
              readonly
              style="cursor:pointer;">
            <input type="hidden" id="f_type_val" name="violation_type">
          </div>

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

        </div>

        <div class="form-row-btn">
          <div class="form-row">
            <div class="search-btn">
              <button type="button" class="btn btn-primary" tabindex="-1" onclick="applyFilters()" disabled style="opacity:0.4;cursor:not-allowed;">
                <i class="fas fa-search"></i> Search
              </button>
            </div>
            <div class="clear-btn">
              <button type="button" class="btn btn-secondary" tabindex="-1" onclick="clearFilters()" disabled style="opacity:0.4;cursor:not-allowed;">
                <i class="fas fa-search-minus"></i> Clear
              </button>
            </div>
            <div class="filter-status" id="filter-status"></div>
          </div>
        </div>
      </form>
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
            <script>
              (function() {
                const hasActions = <?= json_encode(
                                      canAccess($permissions, 'delete-single-remarks')
                                    ) ?>;
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
                    <td style="padding:10px 8px;height:52px;text-align:start;vertical-align:middle;">${pulse('50px','22px','11px')}</td>
                    <td style="padding:10px 8px;vertical-align:middle;">${pulse('80px','10px')}</td>
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

  <!-- Delete Modal -->
  <div id="deleteModal" class="modal-overlay">
    <div class="modal-delete-content">
      <span class="close" onclick="closeModal()"><i class="fas fa-times"></i></span>
      <div class="modal-header">
        <h2 id="deleteModalTitle">Delete Remarks</h2>
      </div>
      <div class="modal-body">
        <p id="deleteModalMessage">Are you sure you want to delete this remarks?</p>
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

  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=jrk23"></script>
  <script src="/config/asset.php?t=kaew3"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=as3ks"></script>
</body>

</html>