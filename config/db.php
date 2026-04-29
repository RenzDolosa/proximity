<?php
// config/db.php --> database bridge

const PAGE_ICONS = [
  'main'               => 'fa-home',
  'admin panel'        => 'fa-user-shield',
  'users'              => 'fa-users',
  'groups'             => 'fa-users-cog',
  'system logs'        => 'fa-clipboard-list',
  'system'             => 'fa-users-cog',
  'datalog'            => 'fa-clipboard-list',
  'violation'          => 'fa-exclamation-triangle',
  'settings'           => 'fa-cog',
  'phpmyadmin'         => 'fa-database',
  'proximity'          => 'fa-th-large',
  'proximity-code'     => 'fa-barcode',
  'qr proximity'       => 'fa-qrcode',
  'manual input'       => 'fa-keyboard',
  'portal'             => 'fa-th-large',
  'table panel'        => 'fa-table',
  'request'            => 'fa-door-open',
  'account info'       => 'fa-user-circle',
  'employee dashboard' => 'fa-tachometer-alt',
  'reg'                => 'fa-user-plus',
  'scan test'          => 'fa-search',
  'm-i v2'             => 'fa-keyboard',
  'test'               => 'fa-flask',
  // Buttons and actions: (not pages)
  'add-system'                => 'fa-user-plus',
  'edit-system'               => 'fa-edit',
  'logs-system'               => 'fa-history',
  'import-system'             => 'fa-upload',
  'delete-system'             => 'fa-trash-alt',
  'export-system'             => 'fa-download',
  'manual in out-system'      => 'fa-clipboard-list',
  'delete-datalog'            => 'fa-trash-alt',
  'export-datalog'            => 'fa-download',
  'add-proximity'             => 'fa-user-plus',
  'edit-proximity'            => 'fa-edit',
  'import-proximity'          => 'fa-upload',
  'delete-proximity'          => 'fa-trash-alt',
  'export-proximity'          => 'fa-download',
  'delete-violation'          => 'fa-trash-alt',
  'export-violation'          => 'fa-download',
];

const PAGE_KEY_OVERRIDES = [
  'account'            => 'account info',
  'employee dashboard' => 'employee dashboard',
  'admin panel'        => 'admin panel',
  'proximity-code'     => 'proximity-code',
  'scan test'          => 'scan test',
  'm-i v2'             => 'm-i v2',
  'manual input'       => 'manual input',
  'qr proximity'       => 'qr proximity',
  'table panel'        => 'table panel',
];

function applyIconHints(array $pages): array
{
  foreach ($pages as &$page) {
    $page['icon'] = PAGE_ICONS[$page['key']] ?? 'fa-file';
    if (!empty($page['children'])) {
      $page['children'] = applyIconHints($page['children']);
    }
  }
  return $pages;
}

require_once 'config.php';

// ── Auth guard FIRST (before anything else) ───────────────────────────────────
if (!isset($_SESSION['user_id']) || !isLoggedIn()) {
  $rootUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http')
    . '://' . $_SERVER['HTTP_HOST'] . '/index.php';

  $isAjax = !empty($_SERVER['HTTP_X_REQUESTED_WITH'])
    && strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest';

  // Also detect fetch() calls — they don't send X-Requested-With by default
  $acceptsJson = isset($_SERVER['HTTP_ACCEPT'])
    && str_contains($_SERVER['HTTP_ACCEPT'], 'application/json');

  $wantsJson = isset($_GET['action']) || $isAjax || $acceptsJson;

  if ($wantsJson) {
    header('Content-Type: application/json');
    http_response_code(401);
    echo json_encode([
      'success'         => false,
      'unauthenticated' => true,
      'message'         => 'Session expired. Please log in again.',
      'redirect'        => $rootUrl,
    ]);
    exit;
  }

  $isEmbedded = isset($_SERVER['HTTP_SEC_FETCH_DEST'])
    && $_SERVER['HTTP_SEC_FETCH_DEST'] === 'iframe';

  if ($isEmbedded) {
    echo '<!DOCTYPE html><html><body>'
      . '<script>window.top.location.href = ' . json_encode($rootUrl) . ';</script>'
      . '</body></html>';
    exit;
  }

  header('Location: ' . $rootUrl);
  exit;
}

$group          = $_SESSION['user_group'] ?? '';
$isAdminSession = ($group === 'Administrator');
$userId         = $_SESSION['user_id'];
$myDatabase     = $_SESSION['my_database'] ?? 'My Database';
$userDbName     = USER_DB_PREFIX . $userId;
$username       = $_SESSION['username'] ?? 'User';
$email          = $_SESSION['email'] ?? '';
$phoneNum       = $_SESSION['phone'] ?? '';

// Handle logout
if (isset($_GET['logout'])) {
  logSystemAction($userId, 'USER_LOGOUT', 'User logged out');
  session_destroy();

  $rootUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? 'https' : 'http')
    . '://' . $_SERVER['HTTP_HOST'] . '/index.php';

  $isEmbedded = isset($_SERVER['HTTP_SEC_FETCH_DEST'])
    && $_SERVER['HTTP_SEC_FETCH_DEST'] === 'iframe';

  if ($isEmbedded) {
    echo '<!DOCTYPE html><html><body>'
      . '<script>window.top.location.href = ' . json_encode($rootUrl) . ';</script>'
      . '</body></html>';
    exit;
  }

  header('Location: ' . $rootUrl);
  exit;
}

// Get user database connection
try {
  $userDb = getUserDBConnection($userId);
  $databaseConnected = true;
} catch (Exception $e) {
  $databaseConnected = false;
  $dbError = $e->getMessage();
}

$isAdmin       = ($group === 'Administrator');
$sessionUserId = (int)$userId;

// ════════════════════════════════════════════════════════════════════════════
// PERMISSION SYSTEM
// ════════════════════════════════════════════════════════════════════════════

/**
 * Returns the decoded permissions array for the current user's group.
 * Reads $_SESSION['user_group'] (already set by loginUser()) so no extra
 * DB query is needed on every page load — only one query per call.
 *
 * Returns: ['system' => 'allow'|'deny', 'datalog' => 'allow'|'deny', ...]
 */
function getUserGroupPermissions(): array
{
  // Administrators always get full access — skip DB lookup entirely
  if (!empty($_SESSION['user_group']) && $_SESSION['user_group'] === 'Administrator') {
    return [];   // canAccess() treats Administrator specially below
  }

  if (empty($_SESSION['user_group'])) {
    return [];
  }

  try {
    $pdo  = getMainDBConnection();
    $stmt = $pdo->prepare(
      "SELECT permissions FROM user_groups
             WHERE group_name = ? AND is_enabled = 1
             LIMIT 1"
    );
    $stmt->execute([$_SESSION['user_group']]);
    $permJson = $stmt->fetchColumn();

    if (!$permJson) return [];

    $perms = json_decode($permJson, true);
    return is_array($perms) ? $perms : [];
  } catch (PDOException $e) {
    error_log('getUserGroupPermissions error: ' . $e->getMessage());
    return [];
  }
}

/**
 * Returns true when the current user may access $pageKey.
 *
 * Rules:
 *   - Administrators → always allowed
 *   - Key missing from saved permissions → default ALLOW
 *   - Key present and value === 'allow' → allowed
 *   - Key present and value === 'deny'  → denied
 */
function canAccess(array $permissions, string $pageKey): bool
{
  if (!empty($_SESSION['user_group']) && $_SESSION['user_group'] === 'Administrator') {
    return true;
  }
  $value = $permissions[$pageKey] ?? 'allow';
  return strtolower($value) === 'allow';
}

/**
 * Hard-gate a page.
 * (after requiring config.php and db.php, before any HTML output).
 *
 * If the user is not allowed:
 *   • AJAX requests get a 403 JSON response
 *   • Normal requests get a full HTML "Access Denied" screen
 *
 * @param string $pageKey     Matches the 'key' in $MENU_PAGES: 'system', 'datalog', 'proxcode'
 * @param string $redirectUrl Back-link shown on the access-denied page
 */
function requireAccess(string $pageKey, string $redirectUrl = '../index.php'): void
{
  $permissions = getUserGroupPermissions();

  if (canAccess($permissions, $pageKey)) {
    return;
  }

  // ── AJAX: return JSON 403 ──────────────────────────────────────────────
  if (
    !empty($_SERVER['HTTP_X_REQUESTED_WITH']) &&
    strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest'
  ) {
    header('Content-Type: application/json');
    http_response_code(403);
    echo json_encode([
      'success'  => false,
      'message'  => 'Access denied.',
      'redirect' => $redirectUrl,
    ]);
    exit;
  }

  // ── Normal request: immediately redirect ─────────────────────────────
  header('Location: ' . $redirectUrl);
  exit;
?>
  <!DOCTYPE html>
  <html lang="en">

  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Access Denied</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        background: #f0f2f5;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
      }

      .card {
        background: #fff;
        border-radius: 12px;
        padding: 52px 44px;
        text-align: center;
        max-width: 440px;
        width: 92%;
        box-shadow: 0 8px 32px rgba(0, 0, 0, .10);
      }

      .icon-wrap {
        width: 76px;
        height: 76px;
        border-radius: 50%;
        background: #fee2e2;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 22px;
      }

      .icon-wrap i {
        font-size: 34px;
        color: #ef4444;
      }

      h1 {
        font-size: 22px;
        color: #1f2937;
        margin-bottom: 10px;
        font-weight: 700;
      }

      p {
        font-size: 14px;
        color: #6b7280;
        line-height: 1.65;
        margin-bottom: 30px;
      }

      .badge {
        display: inline-block;
        background: #ede9fe;
        color: #7c3aed;
        font-size: 12px;
        font-weight: 600;
        padding: 3px 12px;
        border-radius: 20px;
        margin-bottom: 18px;
        letter-spacing: .3px;
      }

      a {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        background: #7c3aed;
        color: #fff;
        padding: 11px 28px;
        border-radius: 7px;
        text-decoration: none;
        font-size: 14px;
        font-weight: 600;
        transition: background .15s;
      }

      a:hover {
        background: #6d28d9;
      }

      .countdown {
        display: inline-block;
        background: #fee2e2;
        color: #ef4444;
        font-size: 12px;
        font-weight: 600;
        padding: 3px 10px;
        border-radius: 20px;
        margin-left: 6px;
      }
    </style>
  </head>

  <body>
    <div class="card">
      <div class="icon-wrap"><i class="fas fa-ban"></i></div>
      <span class="badge"><i class="fas fa-shield-alt"></i> Permission Required</span>
      <h1>Access Denied</h1>
      <p>
        You don't have permission to view this page.<br>
        Contact your administrator if you think this is a mistake.
      </p>
      <a href="#" onclick="goBack(); return false;">
        <i class="fas fa-arrow-left"></i> Go Back <span class="countdown" id="countdown">5</span>
      </a>
    </div>

    <script src="/resource/js/req.js"></script>
    <script>
      var url = '<?= htmlspecialchars($redirectUrl, ENT_QUOTES) ?>';

      function goBack() {
        window.history.back();
      }

      // Countdown timer — auto-triggers goBack() at 0
      var seconds = 5;
      var el = document.getElementById('countdown');
      var timer = setInterval(function() {
        seconds--;
        el.textContent = seconds;
        if (seconds <= 0) {
          clearInterval(timer);
          goBack();
        }
      }, 1000);
    </script>
  </body>

  </html>
<?php
  exit;
}

/**
 * For use in navigation / menu templates.
 * Returns an associative array of [ pageKey => bool ] so the menu can
 * show/hide links without calling canAccess() repeatedly.
 *
 * Usage in a menu file:
 *   $access = getMenuAccess();
 *   if ($access['system'])   echo '<a href="system.php">System</a>';
 *   if ($access['datalog'])  echo '<a href="datalog.php">Datalog</a>';
 *   if ($access['proxcode']) echo '<a href="proxcode.php">Proxcode</a>';
 */
function scanPortalPages(
  array $baseDirs = [],
  array $exclude = [
    // 'index.php',
    // 'database.php',
    // 'f-pass.php',
    // 'add_to_log.php',
    'config.php',
    'db.php',
    'req.php',
    'migrate_to_webp.php',
    // 'ea-dtl.php',
    // 'eas.php',
    // 'export_proxcode.php',
    // 'get_user_id.php',
    // 'ip.php',
    // 'login.php',
    // 'manpower_backend.php',
    // 'migrate_to_webp.php',
    // 'proxcode_backend.php',
    // 'qr_search_backend.php',
    // 'scanTest_search_backend.php',
    // 'settings.php',
    // 'admin panel.php',
    // 'table panel.php',
    // 'reg.php',
  ]
): array {

  // ── Define which folders are GROUPED (children under a parent) ────────────
  $groupedFolders = [
    'portal' => [
      'folder'   => __DIR__ . '/resource/views/iframe',
      'children' => [
        [
          'key'      => 'main',
          'label'    => 'Main',
          'icon'     => 'fa-home',
          'children' => [],
        ]
      ],
    ],
    'main' => [
      'folder'   => __DIR__ . '/../tests',
      'children' => [
        [
          'key'      => 'settings',
          'label'    => 'Settings',
          'icon'     => 'fa-cog',
          'children' => [],
        ],
        [
          'key'      => 'table panel',
          'label'    => 'Employee Manager',
          'icon'     => 'fa-table',
          'children' => [],
        ],
        [
          'key'      => 'scan test',
          'label'    => 'Scan Test',
          'icon'     => 'fa-search',
          'children' => [],
        ]
      ],
    ],
    'settings' => [
      'folder'   => __DIR__ . '/resource/views',
      'children' => [
        [
          'key'      => 'reg',
          'label'    => 'Register',
          'icon'     => 'fa-user-plus',
          'children' => [],
        ],
        [
          'key'      => 'admin panel',
          'label'    => 'Admin Panel',
          'icon'     => 'fa-user-shield',
          'children' => [
            ['key' => 'users',       'label' => 'Manage Users', 'icon' => 'fa-users',         'children' => []],
            ['key' => 'groups',      'label' => 'User Groups',  'icon' => 'fa-users-cog',      'children' => []],
            ['key' => 'system logs', 'label' => 'System Logs',  'icon' => 'fa-clipboard-list', 'children' => []],
            ['key' => 'phpmyadmin',  'label' => 'PHP MyAdmin',  'icon' => 'fa-database',       'children' => []],
          ],
        ],
        [
          'key'      => 'employee dashboard',
          'label'    => 'Employee Dashboard',
          'icon'     => 'fa-tachometer-alt',
          'children' => [],
        ],
        [
          'key'      => 'account info',
          'label'    => 'Account Info',
          'icon'     => 'fa-user-circle',
          'children' => [],
        ]
      ],
    ],
    'table panel' => [
      'folder'   => __DIR__ . '/app/services',
      'children' => [
        [
          'key'      => 'system',
          'label'    => 'System',
          'icon'     => 'fa-users-cog',
          'children' => [
            ['key' => 'add-system',            'label' => 'Add',             'icon' => 'fa-user-plus',       'children' => []],
            ['key' => 'edit-system',           'label' => 'Edit',            'icon' => 'fa-edit',            'children' => []],
            ['key' => 'logs-system',           'label' => 'Logs',            'icon' => 'fa-history',         'children' => []],
            ['key' => 'import-system',         'label' => 'Import',          'icon' => 'fa-upload',          'children' => []],
            ['key' => 'delete-system',         'label' => 'Delete',          'icon' => 'fa-trash-alt',       'children' => []],
            ['key' => 'export-system',         'label' => 'Export',          'icon' => 'fa-download',        'children' => []],
            ['key' => 'manual in out-system',  'label' => 'In/Out Action',   'icon' => 'fa-clipboard-list',  'children' => []],
          ],
        ],
        [
          'key'      => 'datalog',
          'label'    => 'Datalog',
          'icon'     => 'fa-clipboard-list',
          'children' => [
            ['key' => 'delete-datalog',        'label' => 'Delete',          'icon' => 'fa-trash-alt',       'children' => []],
            ['key' => 'export-datalog',        'label' => 'Export',          'icon' => 'fa-download',        'children' => []],
          ],
        ],
        [
          'key'      => 'proximity-code',
          'label'    => 'Proximity Codes',
          'icon'     => 'fa-barcode',
          'children' => [
            ['key' => 'add-proximity',         'label' => 'Add',             'icon' => 'fa-user-plus',       'children' => []],
            ['key' => 'edit-proximity',        'label' => 'Edit',            'icon' => 'fa-edit',            'children' => []],
            ['key' => 'import-proximity',      'label' => 'Import',          'icon' => 'fa-upload',          'children' => []],
            ['key' => 'delete-proximity',      'label' => 'Delete',          'icon' => 'fa-trash-alt',       'children' => []],
            ['key' => 'export-proximity',      'label' => 'Export',          'icon' => 'fa-download',        'children' => []],
          ],
        ],
        [
          'key'      => 'violation',
          'label'    => 'Violations',
          'icon'     => 'fa-exclamation-triangle',
          'children' => [
            ['key' => 'delete-violation',      'label' => 'Delete',          'icon' => 'fa-trash-alt',       'children' => []],
            ['key' => 'export-violation',      'label' => 'Export',          'icon' => 'fa-download',        'children' => []],
          ],
        ],
      ],
    ],
    'proximity' => [
      'folder'   => __DIR__ . '/http/controllers',
      'children' => [
        [
          'key'      => 'manual input',
          'label'    => 'Manual Input',
          'icon'     => 'fa-keyboard',
          'children' => [],
        ],
        [
          'key'      => 'qr proximity',
          'label'    => 'QR Proximity',
          'icon'     => 'fa-qrcode',
          'children' => [],
        ]
      ],
    ],
  ];

  // Build a quick lookup of which real paths are "owned" by a grouped folder
  $groupedPaths = [];
  foreach ($groupedFolders as $config) {
    if (!empty($config['folder'])) {
      $groupedPaths[] = realpath($config['folder']);
    }
  }

  // ── STEP 1: Flat folders (iframe, udev, root) ─────────────────────────────
  if (empty($baseDirs)) {
    $baseDirs = [
      __DIR__ . '/resource/views/iframe',
      __DIR__ . '/app/services',
      __DIR__ . '/../tests',
    ];
  }

  $pages    = [];
  $seenKeys = [];

  foreach ($baseDirs as $baseDir) {
    $realBase = realpath($baseDir);
    if (!$realBase || !is_dir($realBase)) continue;

    // Skip if this folder is owned by a grouped parent
    if (in_array($realBase, $groupedPaths, true)) continue;

    foreach (glob($baseDir . '/*.php') ?: [] as $file) {
      $name        = basename($file, '.php');
      $resolvedKey = PAGE_KEY_OVERRIDES[$name] ?? $name;

      if (in_array(basename($file), $exclude, true)) continue;
      if (isset($seenKeys[$resolvedKey])) continue;
      $seenKeys[$resolvedKey] = true;

      $pages[] = [
        'key'      => $resolvedKey,
        'label'    => ucwords(str_replace(['-', '_'], ' ', $name)),
        'icon'     => PAGE_ICONS[$resolvedKey] ?? 'fa-file',
        'children' => [],
      ];
    }
  }

  // ── STEP 2: Root-level .php files ────────────────────────────────────────
  $rootDir = __DIR__ . '/';
  foreach (glob($rootDir . '/*.php') ?: [] as $file) {
    $name        = basename($file, '.php');
    $resolvedKey = PAGE_KEY_OVERRIDES[$name] ?? $name;

    if (in_array(basename($file), $exclude, true)) continue;
    if (isset($seenKeys[$resolvedKey])) continue;
    $seenKeys[$resolvedKey] = true;

    $pages[] = [
      'key'      => $resolvedKey,
      'label'    => ucwords(str_replace(['-', '_'], ' ', $name)),
      'icon'     => PAGE_ICONS[$resolvedKey] ?? 'fa-file',
      'children' => [],
    ];
  }

  // ── STEP 3: Grouped folders → parent with children ───────────────────────
  foreach ($groupedFolders as $parentKey => $config) {

    $children = $config['children'];  // start with any hardcoded children

    // Auto-scan the folder if provided
    if (!empty($config['folder']) && is_dir($config['folder'])) {
      foreach (glob($config['folder'] . '/*.php') ?: [] as $file) {
        $name        = basename($file, '.php');
        $resolvedKey = PAGE_KEY_OVERRIDES[$name] ?? $name;

        if (in_array(basename($file), $exclude, true)) continue;
        if (isset($seenKeys[$resolvedKey])) continue;
        $seenKeys[$resolvedKey] = true;

        $children[] = [
          'key'      => $resolvedKey,
          'label'    => ucwords(str_replace(['-', '_'], ' ', $name)),
          'icon'     => PAGE_ICONS[$resolvedKey] ?? 'fa-file',
          'children' => [],
        ];
      }
    }

    if (empty($children)) continue;

    // Find if the parent page itself already exists (e.g. admin panel.php was in iframe/)
    $attached = attachChildrenByKey($pages, $parentKey, $children);
    if (!$attached) {
      $seenKeys[$parentKey] = true;
      $pages[] = [
        'key'      => $parentKey,
        'label'    => ucwords(str_replace(['-', '_'], ' ', $parentKey)),
        'icon'     => PAGE_ICONS[$parentKey] ?? 'fa-folder',
        'children' => $children,
      ];
    }
  }

  return $pages;
}

function findPageByKey(array &$pages, string $key): ?array
{
  foreach ($pages as &$page) {
    if ($page['key'] === $key) return $page;
    if (!empty($page['children'])) {
      $found = findPageByKey($page['children'], $key);
      if ($found !== null) return $found;
    }
  }
  return null;
}

function attachChildrenByKey(array &$pages, string $parentKey, array $children): bool
{
  foreach ($pages as &$page) {
    if ($page['key'] === $parentKey) {
      $existingKeys = array_column($page['children'], 'key');
      foreach ($children as $child) {
        if (!in_array($child['key'], $existingKeys, true)) {
          $page['children'][] = $child;
        }
      }
      return true;
    }
    if (!empty($page['children'])) {
      if (attachChildrenByKey($page['children'], $parentKey, $children)) {
        return true;
      }
    }
  }
  return false;
}

function flattenPageKeys(array $pages): array
{
  $keys = [];
  foreach ($pages as $page) {
    $keys[] = $page['key'];
    if (!empty($page['children'])) {
      $keys = array_merge($keys, flattenPageKeys($page['children']));
    }
  }
  return $keys;
}

function getMenuAccess(): array
{
  $permissions = getUserGroupPermissions();
  $pages       = scanPortalPages();
  $access      = [];

  // Keys derived from actual .php files
  foreach (flattenPageKeys($pages) as $key) {
    $access[$key] = canAccess($permissions, $key);
  }

  // ── Virtual keys (not files, but used in permission checks) ──────────────
  $virtualKeys = [
    'users',
    'groups',
    'system logs',
    'phpmyadmin',
  ];
  foreach ($virtualKeys as $key) {
    if (!isset($access[$key])) {   // don't overwrite if a file happens to match
      $access[$key] = canAccess($permissions, $key);
    }
  }

  return $access;
}
