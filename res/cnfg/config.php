<?php
// config.php

ini_set('log_errors', '0');
ini_set('display_errors', '0');
error_reporting(0);

// Database configuration 
define('DB_HOST', '127.0.0.1:3307'); // localhost // sql212.infinityfree.com
define('DB_NAME', 'if0_41430152_proximity3pl'); // system_database // if0_41430152_proximity3pl
define('DB_USER', 'root'); // root // if0_41430152
define('DB_PASS', ''); // empty for local development // kGq47fPWAS41

define('USER_DB_PREFIX', DB_NAME); // 'if0_41430152' . '_'
define('USER_DB_HOST', DB_HOST);
define('USER_DB_USER', DB_USER);
define('USER_DB_PASS', DB_PASS);

// Maximum database name length for MySQL
define('MAX_DB_NAME_LENGTH', 64);

// Create main database
function createDatabase()
{
  $dbName = DB_NAME;

  if (strlen($dbName) > MAX_DB_NAME_LENGTH) {
    $errorMsg = "Database name exceeds maximum length of " . MAX_DB_NAME_LENGTH . " characters. Generated name: '$dbName' (" . strlen($dbName) . " chars)";
    // error_log($errorMsg);
    return ['success' => false, 'error' => $errorMsg];
  }

  try {
    // Connect WITHOUT specifying a database
    $pdo = new PDO(
      "mysql:host=" . DB_HOST . ";charset=utf8mb4",
      DB_USER,
      DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    // Check if database already exists
    $stmt = $pdo->prepare("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?");
    $stmt->execute([$dbName]);

    if ($stmt->rowCount() > 0) {
      // error_log("Database already exists: $dbName — skipping creation.");
      // Still connect and ensure tables exist
    } else {
      // Create the database
      $escapedDbName = str_replace("`", "``", $dbName);
      $pdo->exec("CREATE DATABASE `{$escapedDbName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
      // error_log("Database created successfully: $dbName");
    }

    // Connect to the (new or existing) database
    $dbPdo = new PDO(
      "mysql:host=" . DB_HOST . ";dbname=" . $dbName . ";charset=utf8mb4",
      DB_USER,
      DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    // Create tables one by one to avoid multi-statement failures
    $dbPdo->exec("CREATE TABLE IF NOT EXISTS `users` (
        `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `username` varchar(50) NOT NULL,
        `email` varchar(100) NOT NULL,
        `password` varchar(255) NOT NULL,
        `first_name` varchar(50) NOT NULL,
        `last_name` varchar(50) NOT NULL,
        `phone` varchar(20) DEFAULT NULL,
        `my_database` varchar(50) NOT NULL DEFAULT '',
        `user_group` varchar(50) NOT NULL DEFAULT '',
        `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
        `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        `last_login` timestamp NULL DEFAULT NULL,
        `session_token` varchar(255) DEFAULT NULL,
        INDEX idx_username (username),
        INDEX idx_email (email),
        INDEX idx_session_token (session_token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

    $dbPdo->exec("CREATE TABLE IF NOT EXISTS `user_sessions` (
        `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `user_id` int(11) NOT NULL,
        `session_token` varchar(255) NOT NULL,
        `expires_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
        `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
        CONSTRAINT `user_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

    $dbPdo->exec("CREATE TABLE IF NOT EXISTS `system_logs` (
        `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `user_id` int(11) DEFAULT NULL,
        `action` varchar(100) NOT NULL,
        `details` text DEFAULT NULL,
        `ip_address` varchar(45) DEFAULT NULL,
        `user_agent` text DEFAULT NULL,
        `created_at` timestamp NOT NULL DEFAULT current_timestamp()
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci");

    $dbPdo->exec("CREATE TABLE IF NOT EXISTS `user_groups` (
        `id` INT(11) NOT NULL AUTO_INCREMENT,
        `group_number` VARCHAR(64) NOT NULL UNIQUE,
        `group_name` VARCHAR(100) NOT NULL UNIQUE,
        `description` VARCHAR(255) DEFAULT NULL,
        `is_enabled` TINYINT(1) NOT NULL DEFAULT 1,
        `permissions` JSON DEFAULT NULL,
        `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `updated_at` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (`id`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

    $dbPdo->exec("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `user_group` VARCHAR(50) NOT NULL DEFAULT ''");
    $dbPdo->exec("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");
    $dbPdo->exec("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
    $dbPdo->exec("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `last_login` TIMESTAMP NULL DEFAULT NULL");
    $dbPdo->exec("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `session_token` VARCHAR(255) DEFAULT NULL");
    $dbPdo->exec("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `my_database` VARCHAR(50) NOT NULL DEFAULT ''");

    // error_log("Creating/verifying tables in database: $dbName");
    $dbPdo->exec("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `user_group` VARCHAR(50)");

    $adminHash = '$2y$10$/nqdViJv2DWyfjHhfS8ZDOPT.6QwxO3DWK1ocCwDFPUYvEE20Lkga';
    $dbPdo->exec("INSERT INTO `users` (`id`, `username`, `email`, `password`, `first_name`, `last_name`, `phone`, `my_database`, `user_group`)
      VALUES (1, 'Admin', 'administrator@gmail.com', '$adminHash', 'Renz', 'Admin', '09196398247', 'AdminServer', 'Administrator')
      ON DUPLICATE KEY UPDATE id=id");

    $dbPdo->exec("ALTER TABLE `users` MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;");

    // error_log("Tables ready in database: $dbName");

    return ['success' => true, 'database_name' => $dbName];
  } catch (PDOException $e) {
    $errorMsg = "Error in createDatabase(): " . $e->getMessage();
    // error_log($errorMsg);
    return ['success' => false, 'error' => $errorMsg];
  }
}

createDatabase();

// ============================================================================
// DATABASE CONNECTION FUNCTIONS
// ============================================================================

// Create main database connection
function getDBConnection()
{
  try {
    $pdo = new PDO(
      "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
      DB_USER,
      DB_PASS,
      [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false
      ]
    );
    return $pdo;
  } catch (PDOException $e) {
    // error_log("Database connection failed: " . $e->getMessage());
    die("Database connection failed. Please try again later.");
  }
}

// Create connection to main database (for user management)
function getMainDBConnection()
{
  return getDBConnection();
}

// Create connection to user-specific database
function getUserDBConnection($userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    throw new Exception("Invalid user ID");
  }

  $dbName = DB_NAME; // USER_DB_PREFIX . intval($userId);

  try {
    $pdo = new PDO(
      "mysql:host=" . USER_DB_HOST . ";dbname=" . $dbName . ";charset=utf8mb4",
      USER_DB_USER,
      USER_DB_PASS,
      [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false
      ]
    );
    return $pdo;
  } catch (PDOException $e) {
    // error_log("User database connection failed for user $userId: " . $e->getMessage());
    throw new Exception("User database connection failed");
  }
}

// Check if user database exists
function userDatabaseExists($userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    return false;
  }

  $dbName = DB_NAME; // USER_DB_PREFIX . intval($userId);

  try {
    $pdo = new PDO(
      "mysql:host=" . USER_DB_HOST . ";charset=utf8mb4",
      USER_DB_USER,
      USER_DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    $stmt = $pdo->prepare("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?");
    $stmt->execute([$dbName]);

    return $stmt->rowCount() > 0;
  } catch (PDOException $e) {
    // error_log("Error checking user database existence: " . $e->getMessage());
    return false;
  }
}

// FIXED: Create user-specific database and tables with better error handling
function createUserDatabase($userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    $errorMsg = "Invalid user ID for database creation: $userId";
    // error_log($errorMsg);
    return ['success' => false, 'error' => $errorMsg];
  }

  $userId = intval($userId);
  $dbName = DB_NAME; // USER_DB_PREFIX . $userId;

  // ADDED: Validate database name length
  if (strlen($dbName) > MAX_DB_NAME_LENGTH) {
    $errorMsg = "Database name exceeds maximum length of " . MAX_DB_NAME_LENGTH . " characters. Generated name: '$dbName' (" . strlen($dbName) . " chars)";
    // error_log($errorMsg);
    return ['success' => false, 'error' => $errorMsg];
  }

  try {
    // Connect without specifying database
    $pdo = new PDO(
      "mysql:host=" . USER_DB_HOST . ";charset=utf8mb4",
      USER_DB_USER,
      USER_DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    // Create database with backticks and proper escaping
    $createDbQuery = "CREATE DATABASE IF NOT EXISTS `" . str_replace("`", "``", $dbName) . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci";

    // error_log("Attempting to create database: $dbName with query: $createDbQuery");
    $pdo->exec($createDbQuery);
    // error_log("Database created successfully: $dbName");

    // Connect to the new database
    $userPdo = new PDO(
      "mysql:host=" . USER_DB_HOST . ";dbname=" . $dbName . ";charset=utf8mb4",
      USER_DB_USER,
      USER_DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    // error_log("Connected to new database: $dbName");

    // Create user-specific tables
    $sql = "
        CREATE TABLE
          IF NOT EXISTS employees (
            id INT NOT NULL,
            fullname VARCHAR(100) NOT NULL,
            position VARCHAR(50) NOT NULL,
            brand VARCHAR(50) NOT NULL,
            status ENUM ('Active', 'Inactive') DEFAULT 'Active',
            shift ENUM ('Day Shift', 'Night Shift', 'Graveyard Shift') NOT NULL,
            violation TEXT,
            image VARCHAR(255),
            qr_code VARCHAR(100) UNIQUE PRIMARY KEY,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_qr_code (qr_code)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS code (
            id INT AUTO_INCREMENT PRIMARY KEY,
            qr_code VARCHAR(100) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS violations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            violation_type VARCHAR(100),
            violation_description TEXT,
            violation_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS status_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            old_status VARCHAR(20),
            new_status VARCHAR(20),
            changed_by VARCHAR(100),
            change_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS search_queries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            query_type VARCHAR(50) NOT NULL,
            search_term VARCHAR(255) DEFAULT NULL,
            search_parameters JSON DEFAULT NULL,
            results_count INT DEFAULT 0,
            results_data JSON DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            query_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            execution_time_ms DECIMAL(10, 3) DEFAULT NULL,
            success BOOLEAN DEFAULT FALSE,
            error_message TEXT DEFAULT NULL,
            INDEX idx_query_type (query_type),
            INDEX idx_timestamp (query_timestamp),
            INDEX idx_success (success)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS employee_access_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT DEFAULT NULL,
            fullname VARCHAR(100) DEFAULT NULL,
            position VARCHAR(50) DEFAULT NULL,
            brand VARCHAR(50) DEFAULT NULL,
            status ENUM ('Active', 'Inactive') DEFAULT NULL,
            shift ENUM ('Day Shift', 'Night Shift', 'Graveyard Shift') DEFAULT NULL,
            violation TEXT DEFAULT NULL,
            image VARCHAR(255) DEFAULT NULL,
            qr_code VARCHAR(100) DEFAULT NULL,
            access_type VARCHAR(50) DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            check_status ENUM ('IN', 'OUT') DEFAULT NULL,
            access_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_employee_id (employee_id),
            INDEX idx_qr_code (qr_code),
            INDEX idx_access_timestamp (access_timestamp),
            INDEX idx_access_type (access_type)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS check_in_out (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            qr_code VARCHAR(255) NOT NULL,
            fullname VARCHAR(255) NOT NULL,
            check_type ENUM ('IN', 'OUT') NOT NULL,
            scan_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45),
            user_agent TEXT,
            INDEX idx_employee_id (employee_id),
            INDEX idx_qr_code (qr_code),
            INDEX idx_timestamp (scan_timestamp)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS user_audio_settings (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            success_audio_path VARCHAR(512) DEFAULT NULL,
            not_found_audio_path VARCHAR(512) DEFAULT NULL,
            inactive_audio_path VARCHAR(512) DEFAULT NULL,
            violations_audio_path VARCHAR(512) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_user_id (user_id)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
    ";

    // error_log("Creating tables in database: $dbName");
    $userPdo->exec($sql);
    // error_log("Tables created successfully in database: $dbName");

    return ['success' => true, 'database_name' => $dbName];
  } catch (PDOException $e) {
    $errorMsg = "Error creating user database for user $userId: " . $e->getMessage();
    // error_log($errorMsg);
    return ['success' => false, 'error' => $errorMsg];
  }
}

// Ensure all user tables exist (call on every login)
function ensureUserTablesExist($userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    // error_log("Invalid user ID for ensuring tables: $userId");
    return false;
  }

  try {
    $userPdo = getUserDBConnection($userId);

    // SQL to create tables if they don't exist
    $sql = "
        CREATE TABLE
          IF NOT EXISTS employees (
            id INT PRIMARY KEY,
            fullname VARCHAR(100) NOT NULL,
            position VARCHAR(50) NOT NULL,
            brand VARCHAR(50) NOT NULL,
            status ENUM ('Active', 'Inactive') DEFAULT 'Active',
            shift ENUM ('Day Shift', 'Night Shift', 'Graveyard Shift') NOT NULL,
            violation TEXT,
            image VARCHAR(255),
            qr_code VARCHAR(100) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_qr_code (qr_code)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS code (
            id INT AUTO_INCREMENT PRIMARY KEY,
            qr_code VARCHAR(100) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS violations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            violation_type VARCHAR(100),
            violation_description TEXT,
            violation_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS status_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            old_status VARCHAR(20),
            new_status VARCHAR(20),
            changed_by VARCHAR(100),
            change_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS search_queries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            query_type VARCHAR(50) NOT NULL,
            search_term VARCHAR(255) DEFAULT NULL,
            search_parameters JSON DEFAULT NULL,
            results_count INT DEFAULT 0,
            results_data JSON DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            query_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            execution_time_ms DECIMAL(10, 3) DEFAULT NULL,
            success BOOLEAN DEFAULT FALSE,
            error_message TEXT DEFAULT NULL,
            INDEX idx_query_type (query_type),
            INDEX idx_timestamp (query_timestamp),
            INDEX idx_success (success)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS employee_access_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT DEFAULT NULL,
            fullname VARCHAR(100) DEFAULT NULL,
            position VARCHAR(50) DEFAULT NULL,
            brand VARCHAR(50) DEFAULT NULL,
            status ENUM ('Active', 'Inactive') DEFAULT NULL,
            shift ENUM ('Day Shift', 'Night Shift', 'Graveyard Shift') DEFAULT NULL,
            violation TEXT DEFAULT NULL,
            image VARCHAR(255) DEFAULT NULL,
            qr_code VARCHAR(100) DEFAULT NULL,
            access_type VARCHAR(50) DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            check_status ENUM ('IN', 'OUT') DEFAULT NULL,
            access_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_employee_id (employee_id),
            INDEX idx_qr_code (qr_code),
            INDEX idx_access_timestamp (access_timestamp),
            INDEX idx_access_type (access_type)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS check_in_out (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            qr_code VARCHAR(255) NOT NULL,
            fullname VARCHAR(255) NOT NULL,
            check_type ENUM ('IN', 'OUT') NOT NULL,
            scan_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45),
            user_agent TEXT,
            INDEX idx_employee_id (employee_id),
            INDEX idx_qr_code (qr_code),
            INDEX idx_timestamp (scan_timestamp)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

        CREATE TABLE
          IF NOT EXISTS user_audio_settings (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            success_audio_path VARCHAR(512) DEFAULT NULL,
            not_found_audio_path VARCHAR(512) DEFAULT NULL,
            inactive_audio_path VARCHAR(512) DEFAULT NULL,
            violations_audio_path VARCHAR(512) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_user_id (user_id)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;
    ";

    $userPdo->exec($sql);
    return true;
  } catch (PDOException $e) {
    error_log("Error ensuring user tables exist: " . $e->getMessage());
    return false;
  }
}

// Delete user database (for cleanup)
function deleteUserDatabase($userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    // error_log("Invalid user ID for deletion: $userId");
    return false;
  }

  $userId = intval($userId);
  $dbName = DB_NAME; // USER_DB_PREFIX . $userId;

  try {
    $pdo = new PDO(
      "mysql:host=" . USER_DB_HOST . ";charset=utf8mb4",
      USER_DB_USER,
      USER_DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    $pdo->exec("DROP DATABASE IF EXISTS `" . str_replace("`", "``", $dbName) . "`");
    return true;
  } catch (PDOException $e) {
    // error_log("Error deleting user database: " . $e->getMessage());
    return false;
  }
}

// ============================================================================
// SESSION AND SECURITY FUNCTIONS
// ============================================================================

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
  ini_set('session.cookie_httponly', 1);
  ini_set('session.cookie_secure', 0);  // ← Change to 0 for local HTTP
  ini_set('session.use_strict_mode', 1);
  session_start();
}

// Security function to sanitize input
function sanitizeInput($data)
{
  return htmlspecialchars(strip_tags(trim($data)), ENT_QUOTES, 'UTF-8');
}

// Function to validate email
function isValidEmail($email)
{
  return filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
}

// Function to validate password strength
function isValidPassword($password)
{
  // At least 8 characters, contains uppercase, lowercase, number
  return strlen($password) >= 8 &&
    preg_match('/[A-Z]/', $password) &&
    preg_match('/[a-z]/', $password) &&
    preg_match('/[0-9]/', $password);
}

// Function to check if custom database name already exists
function customDatabaseExists($dbName)
{
  try {
    $pdo = new PDO(
      "mysql:host=" . DB_HOST . ";charset=utf8mb4",
      DB_USER,
      DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    $stmt = $pdo->prepare("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?");
    $stmt->execute([$dbName]);

    return $stmt->rowCount() > 0;
  } catch (PDOException $e) {
    // error_log("Error checking custom database existence: " . $e->getMessage());
    return true; // Return true to be safe and prevent creation
  }
}

// ============================================================================
// REGISTRATION AND LOGIN FUNCTIONS
// ============================================================================

/**
 * Enhanced User Registration Function
 * 
 * DATABASE NAMING STRATEGY:
 * - Actual database created: user_{$userId} (e.g., user_1, user_2, user_3)
 * - The 'my_database' field is stored in users table as METADATA ONLY
 * - This ensures clean, predictable database names while preserving user's custom name
 * 
 * @param string $username - Unique username (3+ chars)
 * @param string $email - Valid email address
 * @param string $password - Strong password (8+ chars, uppercase, lowercase, number)
 * @param string $firstName - User's first name
 * @param string $lastName - User's last name
 * @param string|null $myDatabase - Custom database name (stored as metadata)
 * @param string|null $phoneNum - User's phone number
 * 
 * @return array - ['success' => bool, 'user_id' => int, 'database_created' => bool, 'database_name' => string, 'message' => string, 'errors' => array]
 */
function registerUser($username, $email, $password, $firstName, $lastName, $myDatabase = null, $phoneNum = null, $user_group)
{
  $errors = [];

  // Validate inputs
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

  // Return validation errors before database operations
  if (!empty($errors)) {
    return ['success' => false, 'errors' => $errors];
  }

  try {
    $pdo = getMainDBConnection();

    // Start transaction
    $pdo->beginTransaction();

    // Check if username or email already exists
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM users WHERE username = ? OR email = ?");
    $stmt->execute([$username, $email]);

    if ($stmt->fetchColumn() > 0) {
      $pdo->rollBack();
      return ['success' => false, 'errors' => ['Username or email already exists']];
    }

    // Hash password
    $hashedPassword = password_hash($password, PASSWORD_DEFAULT);

    // Insert new user with my_database as metadata
    $stmt = $pdo->prepare("
        INSERT INTO users (username, email, password, first_name, last_name, my_database, phone, user_group, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ");

    $stmt->execute([
      sanitizeInput($username),
      sanitizeInput($email),
      $hashedPassword,
      sanitizeInput($firstName),
      sanitizeInput($lastName),
      sanitizeInput($myDatabase ?? ''),
      $phoneNum ? sanitizeInput($phoneNum) : null,
      sanitizeInput($user_group)
    ]);

    $userId = $pdo->lastInsertId();

    // Commit the user creation first
    $pdo->commit();

    // error_log("User created successfully: ID=$userId, Username=$username, My_Database=$myDatabase");

    // Now create user-specific database with actual name: user_{$userId}
    $dbResult = createUserDatabase($userId);

    if (!$dbResult['success']) {
      // If database creation fails, remove the user record
      try {
        $pdo->beginTransaction();
        $deleteStmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
        $deleteStmt->execute([$userId]);
        $pdo->commit();
        // error_log("User deleted due to database creation failure: ID=$userId");
      } catch (PDOException $e) {
        // error_log("Error rolling back user creation: " . $e->getMessage());
      }

      // Return the actual error from database creation
      return ['success' => false, 'errors' => [$dbResult['error']]];
    }

    // Log successful registration
    logSystemAction($userId, 'USER_REGISTERED', "User registered with database: " . $dbResult['database_name'] . " (custom name: $myDatabase)");

    return [
      'success' => true,
      'user_id' => $userId,
      'database_created' => true,
      'database_name' => $dbResult['database_name'], // Returns: user_1, user_2, etc.
      'custom_name' => $myDatabase, // User's custom name (for display)
      'message' => 'Registration successful! Your personal database has been created.'
    ];
  } catch (PDOException $e) {
    // Rollback transaction on error
    try {
      if ($pdo->inTransaction()) {
        $pdo->rollBack();
      }
    } catch (Exception $rollbackError) {
      // error_log("Error during rollback: " . $rollbackError->getMessage());
    }

    $errorMsg = "Registration error: " . $e->getMessage();
    // error_log($errorMsg);
    return ['success' => false, 'errors' => ['Database error occurred during registration. ' . $e->getMessage()]];
  }
}

// Enhanced User Login Function with Database Check
function loginUser($username, $password)
{
  try {
    $pdo = getMainDBConnection();

    $stmt = $pdo->prepare("SELECT id, username, email, password, first_name, last_name, my_database, user_group FROM users WHERE username = ? OR email = ?");
    $stmt->execute([$username, $username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password'])) {
      // Check if user database exists
      if (!userDatabaseExists($user['id'])) {
        // Create user database if it doesn't exist
        $dbResult = createUserDatabase($user['id']);
        if (!$dbResult['success']) {
          return ['success' => false, 'errors' => ['Failed to initialize user database: ' . $dbResult['error']]];
        }
      } else {
        // Database exists, but verify/create tables if needed
        ensureUserTablesExist($user['id']);
      }

      // Set session variables
      $_SESSION['user_id'] = $user['id'];
      $_SESSION['username'] = $user['username'];
      $_SESSION['email'] = $user['email'];
      $_SESSION['first_name'] = $user['first_name'];
      $_SESSION['last_name'] = $user['last_name'];
      $_SESSION['my_database'] = $user['my_database'];
      $_SESSION['user_group'] = $user['user_group'];

      // Update last login
      $updateStmt = $pdo->prepare("UPDATE users SET last_login = NOW() WHERE id = ?");
      $updateStmt->execute([$user['id']]);

      return ['success' => true, 'user' => $user, 'database_ready' => true];
    } else {
      return ['success' => false, 'errors' => ['Invalid username or password']];
    }
  } catch (PDOException $e) {
    // error_log("Login error: " . $e->getMessage());
    return ['success' => false, 'errors' => ['Database error occurred during login: ' . $e->getMessage()]];
  }
}

// Create main system tables
function createMainTables()
{
  try {
    $pdo = getMainDBConnection();

    // FIX Bug 5: Removed invalid "ON users(...)" index syntax from CREATE TABLE.
    // Also merged session_token column and its index directly into the CREATE TABLE definition.
    $sql = "
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            first_name VARCHAR(50) NOT NULL,
            last_name VARCHAR(50) NOT NULL,
            phone VARCHAR(20),
            my_database VARCHAR(100),
            user_group VARCHAR(50),
            session_token VARCHAR(255) DEFAULT NULL,
            session_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL,
            INDEX idx_username (username),
            INDEX idx_email (email),
            INDEX idx_session_token (session_token)
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            session_token VARCHAR(255) NOT NULL,
            ip_address VARCHAR(45),
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE KEY unique_session (session_token),
            INDEX idx_user_sessions_user_id (user_id),
            INDEX idx_user_sessions_token (session_token)
        );

        CREATE TABLE IF NOT EXISTS system_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            action VARCHAR(100) NOT NULL,
            details TEXT,
            ip_address VARCHAR(45),
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
            INDEX idx_user_id (user_id),
            INDEX idx_action (action),
            INDEX idx_created_at (created_at)
        );

        CREATE TABLE
          IF NOT EXISTS `user_groups` (
            `id` INT (11) NOT NULL AUTO_INCREMENT,
            `group_number` VARCHAR(64) NOT NULL UNIQUE COMMENT 'Auto-generated unique group number',
            `group_name` VARCHAR(100) NOT NULL UNIQUE COMMENT 'Human-readable name e.g. Administrator',
            `description` VARCHAR(255) DEFAULT NULL,
            `is_enabled` TINYINT (1) NOT NULL DEFAULT 1 COMMENT '1 = enabled, 0 = disabled',
            `permissions` JSON DEFAULT NULL COMMENT 'JSON object: { order: true, social: false, ... }',
            `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            `updated_at` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (`id`)
          ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
    ";

    $pdo->exec($sql);

    $pdo->exec("ALTER TABLE `users` ADD COLUMN IF NOT EXISTS `user_group` VARCHAR(50)");

    // error_log("Main system tables created successfully");
    return true;
  } catch (PDOException $e) {
    // error_log("Error creating main tables: " . $e->getMessage());
    return false;
  }
}

// Initialize main system tables
createMainTables();

// Utility function to log system actions
function logSystemAction($userId, $action, $details = null)
{
  try {
    $pdo = getMainDBConnection();
    $stmt = $pdo->prepare("
        INSERT INTO system_logs (user_id, action, details, ip_address, user_agent) 
        VALUES (?, ?, ?, ?, ?)
    ");

    $stmt->execute([
      $userId,
      $action,
      $details,
      $_SERVER['REMOTE_ADDR'] ?? null,
      $_SERVER['HTTP_USER_AGENT'] ?? null
    ]);
  } catch (PDOException $e) {
    // error_log("Error logging system action: " . $e->getMessage());
  }
}

// Function to check if user is logged in
function isLoggedIn()
{
  return isset($_SESSION['user_id']) && !empty($_SESSION['user_id']);
}

// Function to get current user info
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

// Function to logout user
function logoutUser()
{
  if (isLoggedIn()) {
    logSystemAction($_SESSION['user_id'], 'USER_LOGOUT', 'User logged out');
  }

  session_destroy();
  return true;
}

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
 * Hard-gate a page.  Call this at the very top of every protected page
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

    <script src="../src/req.js"></script>
    <script>
      var url = '<?= htmlspecialchars($redirectUrl, ENT_QUOTES) ?>';

      function goBack() {
        window.history.back();
      }

      // Countdown timer — auto-triggers goBack() at 0
      var seconds = 5;
      var el = document.getElementById('countdown');
      var timer = setInterval(function () {
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
function getMenuAccess(): array
{
  $permissions = getUserGroupPermissions();
  $pages = [
    'request',
    'main',
    'manual input',
    'qr proximity',
    'scan test',
    'account info',
    'admin panel',
    'employee management',
    'settings',
    'datalog',
    'proximity code',
    'system',
    'table panel',
    'm-i v2',
    'test',
    'portal',
    'proximity',
    'reg'
  ];
  $access = [];
  foreach ($pages as $key) {
    $access[$key] = canAccess($permissions, $key);
  }
  return $access;
}
