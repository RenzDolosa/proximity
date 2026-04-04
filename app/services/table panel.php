<?php
// table panel.php

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'system') && !canAccess($permissions, 'datalog') && !canAccess($permissions, 'proximity code')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) { window.top.history.back(); } else { window.history.back(); }
    </script></body></html>';
  exit;
}

requireAccess('table panel', '../../resource/views/iframe/main.php');
$access = getMenuAccess();

$firstTab = null;
if ($access['system'])         $firstTab = 'employees';
elseif ($access['datalog'])    $firstTab = 'scanned';
elseif ($access['proximity code']) $firstTab = 'proximity';
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

    body {
      font-family: sans-serif;
      background: #f5f5f5;
    }

    .tab-bar {
      display: flex;
      align-items: flex-end;
      background: #fff;
      border-bottom: 1px solid #e0e0e0;
      padding: 0 16px;
      position: sticky;
      top: 0;
      z-index: 999;
    }

    .tab-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 20px;
      font-size: 14px;
      font-weight: 400;
      color: #666;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      cursor: pointer;
      transition: color 0.15s, border-color 0.15s;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: #222;
    }

    .tab-btn.active {
      color: #222;
      font-weight: 500;
      border-bottom-color: #5340d8;
    }

    .tab-btn .badge {
      font-size: 11px;
      background: #f0f0f0;
      color: #888;
      border-radius: 999px;
      padding: 2px 8px;
      border: 1px solid #e0e0e0;
    }

    .tab-btn.active .badge {
      background: #eeedfe;
      color: #534ab7;
      border-color: #afa9ec;
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
  </style>
  <link rel="stylesheet" href="../../resource/css/btn.css">
</head>

<body>

  <div id="closeButton" class="close-button" role="button" tabindex="0" aria-label="Close" onclick="window.history.back();">
    <i class="fas fa-times"></i>
  </div>

  <div class="tab-bar">
    <?php if ($access['system']): ?>
      <button class="tab-btn <?= $firstTab === 'employees' ? 'active' : '' ?>" onclick="switchTab('employees', this)">
        <i class="fas fa-users"></i> Manage Employees
      </button>
    <?php endif; ?>

    <?php if ($access['datalog']): ?>
      <button class="tab-btn <?= $firstTab === 'scanned' ? 'active' : '' ?>" onclick="switchTab('scanned', this)">
        <i class="fas fa-list-check"></i> Scanned Log
      </button>
    <?php endif; ?>

    <?php if ($access['proximity code']): ?>
      <button class="tab-btn <?= $firstTab === 'proximity' ? 'active' : '' ?>" onclick="switchTab('proximity', this)">
        <i class="fas fa-id-card"></i> Proximity Codes
      </button>
    <?php endif; ?>
  </div>

  <iframe id="frame-employees" class="tab-frame <?= $firstTab === 'employees' ? 'active' : '' ?>"
    src="<?= $firstTab === 'employees' ? 'system.php' : '' ?>"></iframe>
  <iframe id="frame-scanned" class="tab-frame <?= $firstTab === 'scanned'   ? 'active' : '' ?>"
    src="<?= $firstTab === 'scanned'   ? 'datalog.php' : '' ?>"></iframe>
  <iframe id="frame-proximity" class="tab-frame <?= $firstTab === 'proximity' ? 'active' : '' ?>"
    src="<?= $firstTab === 'proximity' ? 'proximity code.php' : '' ?>"></iframe>

  <script src="../../resource/js/req.js"></script>
  <script src="../../resource/js/ver.js"></script>
  <script>
    const srcs = {
      employees: 'system.php',
      scanned: 'datalog.php',
      proximity: 'proximity code.php',
    };

    function focusFrameSearchInput(frame) {
      try {
        const input = frame.contentWindow?.document?.getElementById('search_qr');
        if (input) input.focus();
      } catch (e) {
        // cross-origin or frame not yet ready — silently ignore
      }
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

    // Prevent Escape from affecting tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          btn.blur(); // remove focus outline
          window.history.back(); // forward the intent
        }
      });
    });

    // Also catch Escape on the parent document itself
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        window.history.back();
      }
    });

    // Guard: if the main iframe navigates to login, redirect the whole top window
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