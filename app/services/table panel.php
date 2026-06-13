<?php
// app/services/table panel.php --> table tab panel

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('tablePanel', ROUTE_HOME);
$access = getMenuAccess();

$myDatabase = $_SESSION['my_database'] ?? 'My Database';

$requestedTab = $_GET['tab'] ?? null;

$firstTab = null;

if ($requestedTab === 'datalog' && $access['datalog']) {
  $firstTab = 'scanned';
} elseif ($requestedTab === 'proximity' && $access['proximity-code']) {
  $firstTab = 'proximity';
} elseif ($requestedTab === 'employees' && $access['system']) {
  $firstTab = 'employees';
} elseif ($requestedTab === 'remarks' && $access['remarks']) {
  $firstTab = 'remarks';
} elseif ($requestedTab === 'attendance' && $access['attendance']) {
  $firstTab = 'attendance';
} else {
  if ($access['system'])              $firstTab = 'employees';
  elseif ($access['datalog'])         $firstTab = 'scanned';
  elseif ($access['proximity-code'])  $firstTab = 'proximity';
  elseif ($access['remarks'])         $firstTab = 'remarks';
  elseif ($access['attendance'])      $firstTab = 'attendance';
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?php echo htmlspecialchars($myDatabase); ?></title>
  <link rel="icon" href="/config/asset.php?t=s3t4u" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div class="tab-bar">
    <button class="tab-btn" tabindex="-1" onclick="if (window.self !== window.top) {
        window.top.location.href = window.top.location.href.split('?')[0];
      } else {
        window.history.back();
      }">
      <i class="fas fa-arrow-left"></i>
      <span>Back</span>
    </button>
    <?php if ($access['system']): ?>
      <button class="tab-btn <?= $firstTab === 'employees' ? 'active' : '' ?>" tabindex="-1" onclick="switchTab('employees', this)">
        <i class="fas fa-users"></i> Employees
      </button>
    <?php endif; ?>
    <?php if ($access['datalog']): ?>
      <button class="tab-btn <?= $firstTab === 'scanned' ? 'active' : '' ?>" tabindex="-1" onclick="switchTab('scanned', this)">
        <i class="fas fa-list-check"></i> Scanned Log
      </button>
    <?php endif; ?>
    <?php if ($access['proximity-code']): ?>
      <button class="tab-btn <?= $firstTab === 'proximity' ? 'active' : '' ?>" tabindex="-1" onclick="switchTab('proximity', this)">
        <i class="fas fa-id-card"></i> Proximity Codes
      </button>
    <?php endif; ?>
    <?php if ($access['attendance']): ?>
      <button class="tab-btn <?= $firstTab === 'attendance' ? 'active' : '' ?>" tabindex="-1" onclick="switchTab('attendance', this)">
        <i class="fas fa-clock"></i> Attendance
      </button>
    <?php endif; ?>
    <?php if ($access['remarks']): ?>
      <button class="tab-btn <?= $firstTab === 'remarks' ? 'active' : '' ?>" tabindex="-1" onclick="switchTab('remarks', this)">
        <i class="fas fa-exclamation-triangle"></i> Incidents
      </button>
    <?php endif; ?>
    <button class="tab-btn" tabindex="-1" onclick="reloadActiveTab()">
      <i class="fas fa-sync-alt"></i>
      <span>Refresh</span>
    </button>
  </div>

  <iframe id="frame-employees" class="tab-frame <?= $firstTab === 'employees' ? 'active' : '' ?>"
    src="<?= $firstTab === 'employees' ? 'system.php' : '' ?>"></iframe>
  <iframe id="frame-scanned" class="tab-frame <?= $firstTab === 'scanned' ? 'active' : '' ?>"
    src="<?= $firstTab === 'scanned' ? 'datalog.php' : '' ?>"></iframe>
  <iframe id="frame-proximity" class="tab-frame <?= $firstTab === 'proximity' ? 'active' : '' ?>"
    src="<?= $firstTab === 'proximity' ? 'proximity-code.php' : '' ?>"></iframe>
  <iframe id="frame-attendance" class="tab-frame <?= $firstTab === 'attendance' ? 'active' : '' ?>"
    src="<?= $firstTab === 'attendance' ? 'attendance-log.php' : '' ?>"></iframe>
  <iframe id="frame-remarks" class="tab-frame <?= $firstTab === 'remarks' ? 'active' : '' ?>"
    src="<?= $firstTab === 'remarks' ? 'violation-log.php' : '' ?>"></iframe>

  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=m9n0o"></script>
  <script>
    const srcs = {
      employees: 'system.php',
      scanned: 'datalog.php',
      proximity: 'proximity-code.php',
      attendance: 'attendance-log.php',
      remarks: 'violation-log.php',
    };

    function focusFrameSearchInput(frame) {
      try {
        const input = frame.contentWindow?.document?.getElementById('search_qr');
        if (input) input.focus();
      } catch (e) {}
    }

    function switchTab(name, btn) {
      document.querySelectorAll('.tab-frame.active').forEach(f => {
        try {
          f.contentWindow?.closeAllActionsPanels?.();
          f.contentWindow?.closeModal?.();
          f.contentWindow?.closeCameraModal?.();
          f.contentWindow?.hideAddOptions?.();
          f.contentWindow?.hideExportOptions?.();
        } catch (e) {}
      });

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-frame').forEach(f => f.classList.remove('active'));
      btn.classList.add('active');

      const frame = document.getElementById('frame-' + name);
      if (!frame.src || frame.src === window.location.href) {
        frame.src = srcs[name];
      }
      frame.classList.add('active');
      setTimeout(() => focusFrameSearchInput(frame), 50);
    }

    function reloadActiveTab() {
      const activeFrame = document.querySelector('.tab-frame.active');
      if (activeFrame) {
        activeFrame.src = activeFrame.src;
      }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          btn.blur();
          window.history.back();
        }
      });
    });

    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        window.history.back();
      }
    });

    document.querySelectorAll('.tab-frame').forEach(frame => {
      frame.addEventListener('load', function() {
        try {
          const frameUrl = this.contentWindow.location.href;
          if (frameUrl.includes(ROUTE_LOGIN) || frameUrl.includes('login')) {
            window.top.location.href = frameUrl;
          } else if (this.classList.contains('active')) {
            focusFrameSearchInput(this);
          }
        } catch (e) {
          window.top.location.href = ROUTE_LOGIN;
        }
      });
    });
  </script>
</body>

</html>