<?php
// app/services/table panel.php --> table tab panel

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity-code')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('table panel', '../../resource/views/iframe/main.php');
$access = getMenuAccess();

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
  <link rel="preload" href="../../resource/assets/icon/database-icon.png" as="image">
  <link rel="icon" href="../../resource/assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :root {
      --accent: #2563eb;
      --accent-light: #eff6ff;
      --bg: #f0f2f5;
      --surface: #ffffff;
      --border: #e2e8f0;
      --text: #1e293b;
      --text-muted: #64748b;
      --danger: #dc2626;
      --danger-light: #ff6f6f;
      --radius: 8px;
    }

    body {
      font-family: sans-serif;
      background: var(--bg);
    }

    .tab-bar {
      display: flex;
      align-items: flex-end;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 16px;
      position: sticky;
      top: 0;
      z-index: 999;
    }

    .tab-btn {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 14px 20px;
      font-size: 12px;
      font-weight: 400;
      height: 46px;
      color: #666;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }

    .tab-btn i {
      font-size: 15px;
    }

    .tab-btn:hover {
      background: var(--bg);
      color: var(--accent);
    }

    .tab-btn.active {
      color: var(--accent);
      font-weight: 500;
      border-bottom-color: var(--accent);
    }

    .tab-btn .badge {
      font-size: 11px;
      background: var(--bg);
      color: var(--text-muted);
      border-radius: 999px;
      padding: 2px 8px;
      border: 1px solid var(--border);
    }

    .tab-btn.active .badge {
      background: var(--accent-light);
      color: var(--accent);
      border-color: var(--accent);
    }

    .tab-frame {
      display: none;
      width: 100%;
      height: calc(100vh - 51px);
      border: none;
    }

    .tab-frame.active {
      display: block;
    }

    @media (max-width: 480px) {

      /* ── Tab bar ── */
      .tab-bar {
        padding: 0 8px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }

      .tab-bar::-webkit-scrollbar {
        display: none;
      }

      .tab-btn {
        padding: 12px 14px;
        font-size: 12px;
        gap: 6px;
        flex-shrink: 0;
      }

      .tab-btn i {
        font-size: 14px;
      }

      .tab-btn .badge {
        font-size: 10px;
        padding: 1px 6px;
      }

      .tab-frame {
        height: calc(100vh - 45px);
      }

    }
  </style>
  <link rel="stylesheet" href="../../resource/css/btn.css">
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

    <button class="tab-btn" tabindex="-1" onclick="location.reload();">
      <i class="fas fa-sync-alt"></i>
      <span>Refresh</span>
    </button>
  </div>

  <iframe id="frame-employees" class="tab-frame <?= $firstTab === 'employees' ? 'active' : '' ?>"
    src="<?= $firstTab === 'employees' ? 'system.php' : '' ?>"></iframe>
  <iframe id="frame-scanned" class="tab-frame <?= $firstTab === 'scanned'   ? 'active' : '' ?>"
    src="<?= $firstTab === 'scanned'   ? 'datalog.php' : '' ?>"></iframe>
  <iframe id="frame-proximity" class="tab-frame <?= $firstTab === 'proximity' ? 'active' : '' ?>"
    src="<?= $firstTab === 'proximity' ? 'proximity-code.php' : '' ?>"></iframe>
  <iframe id="frame-attendance" class="tab-frame <?= $firstTab === 'attendance' ? 'active' : '' ?>"
    src="<?= $firstTab === 'attendance' ? 'attendancelog.php' : '' ?>"></iframe>
  <iframe id="frame-remarks" class="tab-frame <?= $firstTab === 'remarks' ? 'active' : '' ?>"
    src="<?= $firstTab === 'remarks' ? 'violation-log.php' : '' ?>"></iframe>

  <script src="../../resource/js/req.js"></script>
  <script src="../../resource/js/ver.js"></script>
  <script>
    const srcs = {
      employees: 'system.php',
      scanned: 'datalog.php',
      proximity: 'proximity-code.php',
      attendance: 'attendancelog.php',
      remarks: 'violation-log.php',
    };

    function focusFrameSearchInput(frame) {
      try {
        const input = frame.contentWindow?.document?.getElementById('search_qr');
        if (input) input.focus();
      } catch (e) {}
    }

    function switchTab(name, btn) {
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
          if (frameUrl.includes('../../index.php') || frameUrl.includes('login')) {
            window.top.location.href = frameUrl;
          } else if (this.classList.contains('active')) {
            focusFrameSearchInput(this);
          }
        } catch (e) {
          window.top.location.href = '../../index.php';
        }
      });
    });
  </script>
</body>

</html>