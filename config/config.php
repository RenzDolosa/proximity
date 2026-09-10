<?php
// config/config.php --> database configuration

require_once __DIR__ . '/../vendor/autoload.php';
require_once __DIR__ . '/paths.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/../');
$dotenv->load();

// -- Database (Postgres / Supabase) ------------------------------------------
// Formerly MySQL with one physical database created per user (see git
// history if you need the old logic). Migrated to a single shared Postgres
// database on Supabase: tenancy is now enforced by a `user_id` column plus
// Row Level Security on every tenant-scoped table (see
// supabase/migrations/20260909084355_initial_schema.sql), not by physical
// database isolation. Schema changes belong in supabase/migrations/ from now
// on -- NOT in runtime CREATE TABLE / ALTER TABLE calls in this file. The old
// createDatabase() / createMainTables() bootstrap-on-every-request pattern
// is gone; if you need a schema change, add a migration and push it (the
// GitHub -> Supabase integration deploys it automatically on merge to main).
//
// Recommended .env values (Supabase Session Pooler -- IPv4-compatible, works
// from shared/traditional hosts like InfinityFree where a direct IPv6-only
// connection won't work): grab the exact host from the Supabase dashboard's
// "Connect" button > Session pooler.
//   DB_HOST=aws-<region>.pooler.supabase.com
//   DB_PORT=5432
//   DB_NAME=postgres
//   DB_USER=postgres.<project-ref>
//   DB_PASS=<your database password>
define('DB_HOST', $_ENV['DB_HOST']);
define('DB_PORT', $_ENV['DB_PORT'] ?? '5432');
define('DB_NAME', $_ENV['DB_NAME'] ?? 'postgres');
define('DB_USER', $_ENV['DB_USER']);
define('DB_PASS', $_ENV['DB_PASS']);

define('QR_EMP_CACHE_FILE', '/database/seeders/cache/employee_qr_cache.json');

// -- Timezone -----------------------------------------------------------------
define('APP_TIMEZONE',    'Asia/Manila');
define('APP_TIMEZONE_TZ', '+08:00'); // kept for any code still reading the raw offset

date_default_timezone_set(APP_TIMEZONE);

// -----------------------------------------------------------------------------
// Database -- connection manager (Postgres)
// -----------------------------------------------------------------------------
//
// Deliberately NOT using PDO::ATTR_PERSISTENT here. Row Level Security below
// depends on a session variable (app.current_user_id) that's set per
// connection; a persistent connection pool reused across different users'
// requests could leak a stale user_id into the wrong request if we're not
// extremely careful. Non-persistent connections cost a bit of latency per
// request but make that whole class of bug structurally impossible instead
// of "impossible as long as every call site remembers" -- same philosophy as
// the qr_code conflict fix in proxcode_backend.php.
function pgConnect(): PDO
{
  $pdo = new PDO(
    "pgsql:host=" . DB_HOST . ";port=" . DB_PORT . ";dbname=" . DB_NAME,
    DB_USER,
    DB_PASS,
    [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => false,
    ]
  );
  $pdo->exec("SET TIME ZONE '" . APP_TIMEZONE . "'");
  return $pdo;
}

function getMainDBConnection()
{
  try {
    return pgConnect();
  } catch (PDOException $e) {
    die("Database connection failed: " . $e->getMessage() . " | Host: " . DB_HOST . " | DB: " . DB_NAME);
  }
}

// Kept as getUserDBConnection($userId) for compatibility with every service
// file that already calls it this way. Under the old architecture this
// pointed at a different physical database per user; now it's the SAME
// shared database as getMainDBConnection(), but with the Postgres session
// variable RLS policies check (app.current_user_id) set to $userId, so
// queries run through this connection only ever see that user's rows.
function getUserDBConnection(int $userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    throw new Exception("Invalid user ID");
  }

  static $pool = [];
  $id = (int) $userId;

  try {
    if (!isset($pool[$id])) {
      $pool[$id] = pgConnect();
    }
    $pdo = $pool[$id];

    // Re-set on every call, even for a pooled connection -- cheap, and it's
    // the difference between "correct" and "correct as long as no other
    // user_id was ever requested earlier in this same request."
    $stmt = $pdo->prepare("SELECT set_config('app.current_user_id', ?, false)");
    $stmt->execute([(string) $id]);

    return $pdo;
  } catch (PDOException $e) {
    throw new Exception("User database connection failed");
  }
}

// -----------------------------------------------------------------------------
// Deprecated compatibility shims
// -----------------------------------------------------------------------------
// These used to create/check/destroy an entire physical MySQL database per
// user. That concept doesn't exist anymore -- schema lives in
// supabase/migrations/ and is always present. Kept as no-ops purely so the
// ~8 existing call sites across the service layer (proxcode_backend.php,
// manpower_backend.php, qr_search_backend.php, device-push.php, etc.) keep
// working unmodified. TODO: strip these call sites out directly in a
// follow-up pass -- they're now dead weight, not functional guards.

function userDatabaseExists(int $userId)
{
  return true;
}

function createUserDatabase(int $userId)
{
  return ['success' => true, 'database_name' => DB_NAME];
}

function ensureUserTablesExist(int $userId)
{
  return true;
}

function deleteUserDatabase(int $userId)
{
  error_log("deleteUserDatabase() called for user $userId -- no-op under the shared-database architecture. Delete the user's row instead (their data cascades via ON DELETE CASCADE).");
  return true;
}


// ─────────────────────────────────────────────────────────────────────────────
// SESSION AND SECURITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
if (session_status() === PHP_SESSION_NONE) {
  ini_set('session.cookie_httponly', 1);
  ini_set('session.cookie_secure', 1);
  ini_set('session.use_strict_mode', 1);
  session_start();
}

// ── Safe fallback sanitizeInput() ─────────────────────────────────────────────
if (!function_exists('sanitizeInput')) {
  /**
   * Sanitize input for safe output.
   *
   * @param mixed $input
   * @return string
   */
  function sanitizeInput($input): string
  {
    if (is_null($input)) return '';
    return htmlspecialchars(strip_tags(trim((string)$input)), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
  }
}

function isValidEmail(string $email)
{
  return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

function isValidPassword(string $password)
{
  return strlen($password) >= 8 &&
    preg_match('/[A-Z]/', $password) &&
    preg_match('/[a-z]/', $password) &&
    preg_match('/[0-9]/', $password);
}

// Deprecated: MySQL INFORMATION_SCHEMA.SCHEMATA lookup for a per-user
// database that no longer exists. Not called anywhere else in the codebase
// (verified) -- kept only in case something external still references it.
function customDatabaseExists(string $dbName)
{
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRATION AND LOGIN FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * User Registration Function
 *
 * Every user's data now lives in the same shared Postgres tables, isolated
 * by `user_id` + Row Level Security -- there's no per-user database to
 * create anymore. `my_database` is kept as a plain free-text metadata column
 * on `users` (admin panel.php and reg.php both read/write it as a display
 * label) but has no functional effect on where data is stored.
 *
 * @param string $username - Unique username (3+ chars)
 * @param string $email - Valid email address
 * @param string $password - Strong password (8+ chars, uppercase, lowercase, number)
 * @param string $firstName - User's first name
 * @param string $lastName - User's last name
 * @param string $user_group - User group or role (e.g., 'Administrator', 'User', etc.)
 * @param string|null $myDatabase - Free-text display label (metadata only)
 * @param string|null $phoneNum - User's phone number
 *
 * @return array - ['success' => bool, 'user_id' => int, 'message' => string, 'errors' => array]
 */
function registerUser(string $username, string $email, string $password, string $firstName, string $lastName, string $user_group, ?string $myDatabase = null, ?string $phoneNum = null)
{
  $errors = [];

  if (empty($username) || strlen($username) < 3) {
    $errors[] = "Username must be at least 3 characters long";
  }

  if (!isValidEmail($email)) {
    $errors[] = "Invalid email format";
  }

  if (!isValidPassword($password)) {
    $errors[] = "Password must be at least 8 characters with uppercase, lowercase, and number";
  }

  if (empty($firstName) || empty($lastName)) {
    $errors[] = "First name and last name are required";
  }

  if (!empty($errors)) {
    return ['success' => false, 'errors' => $errors];
  }

  try {
    $pdo = getMainDBConnection();

    $pdo->beginTransaction();

    $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = ? OR email = ?");
    $stmt->execute([$username, $email]);

    if ($stmt->fetchColumn() > 0) {
      $pdo->rollBack();
      return ['success' => false, 'errors' => ['Username or email already exists']];
    }

    $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

    $stmt = $pdo->prepare("
      INSERT INTO users (username, email, password, first_name, last_name, my_database, phone, user_group, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");

    $stmt->execute([
      sanitizeInput($username),
      sanitizeInput($email),
      $hashedPassword,
      sanitizeInput($firstName),
      sanitizeInput($lastName),
      sanitizeInput($myDatabase ?? ''),
      $phoneNum ? sanitizeInput($phoneNum) : null,
      sanitizeInput($user_group),
      date('Y-m-d H:i:s'),
    ]);

    $userId = $pdo->lastInsertId();

    $pdo->commit();

    logSystemAction($userId, 'USER_REGISTERED', "User registered (display label: $myDatabase)");

    return [
      'success' => true,
      'user_id' => $userId,
      'custom_name' => $myDatabase,
      'message' => 'Registration successful!'
    ];
  } catch (PDOException $e) {
    try {
      if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
      }
    } catch (PDOException $rollbackError) {
    }

    return ['success' => false, 'errors' => ['Database error: ' . $e->getMessage()]];
  }
}

function loginUser(string $username, string $password)
{
  try {
    $pdo = getMainDBConnection();

    $stmt = $pdo->prepare("SELECT id, username, email, password, first_name, last_name, my_database, user_group FROM users WHERE username = ? OR email = ?");
    $stmt->execute([$username, $username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password'])) {
      $_SESSION['user_id'] = $user['id'];
      $_SESSION['username'] = $user['username'];
      $_SESSION['email'] = $user['email'];
      $_SESSION['first_name'] = $user['first_name'];
      $_SESSION['last_name'] = $user['last_name'];
      $_SESSION['my_database'] = $user['my_database'];
      $_SESSION['user_group'] = $user['user_group'];

      $updateStmt = $pdo->prepare("UPDATE users SET last_login = ? WHERE id = ?");
      $updateStmt->execute([date('Y-m-d H:i:s'), $user['id']]);

      return ['success' => true, 'user' => $user, 'database_ready' => true];
    } else {
      return ['success' => false, 'errors' => ['Invalid username or password']];
    }
  } catch (PDOException $e) {
    return ['success' => false, 'errors' => ['Database error occurred during login: ' . $e->getMessage()]];
  }
}

// Schema (users, user_sessions, system_logs, user_groups, and everything
// else) now lives entirely in supabase/migrations/ and is applied via the
// GitHub -> Supabase integration -- no runtime bootstrap call needed or
// wanted here anymore (see the comment at the top of this file).

function logSystemAction(?int $userId, string $action, ?string $details = null)
{
  try {
    $pdo = getMainDBConnection();
    $stmt = $pdo->prepare("
        INSERT INTO system_logs (user_id, action, details, ip_address, user_agent, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    ");

    $stmt->execute([
      $userId,
      $action,
      $details,
      $_SERVER['REMOTE_ADDR'] ?? null,
      $_SERVER['HTTP_USER_AGENT'] ?? null,
      date('Y-m-d H:i:s'),
    ]);
  } catch (PDOException $e) {
    error_log("logSystemAction() failed: " . $e->getMessage());
  }
}

function isLoggedIn()
{
  return isset($_SESSION['user_id']) && !empty($_SESSION['user_id']);
}

function getCurrentUser()
{
  if (!isLoggedIn()) {
    return null;
  }

  return [
    'id' => $_SESSION['user_id'],
    'username' => $_SESSION['username'],
    'email' => $_SESSION['email'],
    'first_name' => $_SESSION['first_name'],
    'last_name' => $_SESSION['last_name'],
    'my_database' => $_SESSION['my_database'],
    'user_group' => $_SESSION['user_group']
  ];
}

// ── Logout user ────────────────────────────────────────────────────────────────────
function logoutUser()
{
  if (isLoggedIn()) {
    logSystemAction($_SESSION['user_id'], 'USER_LOGOUT', 'User logged out');
  }

  session_destroy();
  return true;
}