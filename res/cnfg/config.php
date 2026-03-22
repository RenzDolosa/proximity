<?php
// config.php

// $server = "sql212.infinityfree.com";
// $username = "if0_41430152";
// $password = "kGq47fPWAS41";
// $dbbase = "if0_41430152_proximity3pl";

// $conn = mysqli_connect($server, $username, $password, $dbbase);

// if (!$conn) {
//   die("Connection failed: " . mysqli_connect_error());
// }

// Database configuration
define('DB_HOST', 'localhost'); // localhost
define('DB_NAME', 'if0_41430152_proximity3pl'); // system_database
define('DB_USER', 'root'); // root
define('DB_PASS', ''); // empty for local development

// User database configuration
define('USER_DB_PREFIX', DB_NAME); // Prefix for user databases 'user_db_'
define('USER_DB_HOST', DB_HOST);
define('USER_DB_USER', DB_USER);
define('USER_DB_PASS', DB_PASS);

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
    error_log("Database connection failed: " . $e->getMessage());
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

  $dbName = USER_DB_PREFIX . intval($userId);

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
    error_log("User database connection failed for user $userId: " . $e->getMessage());
    throw new Exception("User database connection failed");
  }
}

// Check if user database exists
function userDatabaseExists($userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    return false;
  }

  $dbName = USER_DB_PREFIX . intval($userId);

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
    error_log("Error checking user database existence: " . $e->getMessage());
    return false;
  }
}

// Create user-specific database and tables
function createUserDatabase($userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    error_log("Invalid user ID for database creation: $userId");
    return false;
  }

  $userId = intval($userId);
  $dbName = USER_DB_PREFIX . $userId;

  try {
    // Connect without specifying database
    $pdo = new PDO(
      "mysql:host=" . USER_DB_HOST . ";charset=utf8mb4",
      USER_DB_USER,
      USER_DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    // Create database - FIXED: Backticks prevent SQL injection
    $pdo->exec("CREATE DATABASE IF NOT EXISTS `" . str_replace("`", "``", $dbName) . "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

    // Connect to the new database
    $userPdo = new PDO(
      "mysql:host=" . USER_DB_HOST . ";dbname=" . $dbName . ";charset=utf8mb4",
      USER_DB_USER,
      USER_DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );

    // Create user-specific tables
    $sql = "
        CREATE TABLE IF NOT EXISTS employees (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fullname VARCHAR(100) NOT NULL,
            position VARCHAR(50) NOT NULL,
            brand VARCHAR(50) NOT NULL,
            status ENUM ('Active', 'Inactive') DEFAULT 'Active',
            shift ENUM ('Day Shift', 'Night Shift', 'Graveyard Shift') NOT NULL,
            violation TEXT,
            image VARCHAR(255),
            qr_code VARCHAR(100) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS code (
            id INT AUTO_INCREMENT PRIMARY KEY,
            qr_code VARCHAR(100) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS violations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            violation_type VARCHAR(100),
            violation_description TEXT,
            violation_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS status_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            old_status VARCHAR(20),
            new_status VARCHAR(20),
            changed_by VARCHAR(100),
            change_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS search_queries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            query_type VARCHAR(50) NOT NULL,
            search_term VARCHAR(255) DEFAULT NULL,
            search_parameters JSON DEFAULT NULL,
            results_count INT DEFAULT 0,
            results_data JSON DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            query_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            execution_time_ms DECIMAL(10,3) DEFAULT NULL,
            success BOOLEAN DEFAULT FALSE,
            error_message TEXT DEFAULT NULL,
            INDEX idx_query_type (query_type),
            INDEX idx_timestamp (query_timestamp),
            INDEX idx_success (success)
        );

        CREATE TABLE IF NOT EXISTS employee_access_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT DEFAULT NULL,
            fullname VARCHAR(100) DEFAULT NULL,
            position VARCHAR(50) DEFAULT NULL,
            brand VARCHAR(50) DEFAULT NULL,
            status ENUM('Active', 'Inactive') DEFAULT NULL,
            shift ENUM('Day Shift', 'Night Shift', 'Graveyard Shift') DEFAULT NULL,
            violation TEXT DEFAULT NULL,
            image VARCHAR(255) DEFAULT NULL,
            qr_code VARCHAR(100) DEFAULT NULL,
            access_type VARCHAR(50) DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            check_status ENUM('IN', 'OUT') DEFAULT NULL,
            access_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_employee_id (employee_id),
            INDEX idx_qr_code (qr_code),
            INDEX idx_access_timestamp (access_timestamp),
            INDEX idx_access_type (access_type)
        );

        CREATE TABLE IF NOT EXISTS check_in_out (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            qr_code VARCHAR(255) NOT NULL,
            fullname VARCHAR(255) NOT NULL,
            check_type ENUM('IN', 'OUT') NOT NULL,
            scan_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ip_address VARCHAR(45),
            user_agent TEXT,
            INDEX idx_employee_id (employee_id),
            INDEX idx_qr_code (qr_code),
            INDEX idx_timestamp (scan_timestamp)
        );

        CREATE TABLE IF NOT EXISTS query_statistics (
            id INT AUTO_INCREMENT PRIMARY KEY,
            date_period DATE NOT NULL,
            period_type ENUM('daily', 'monthly') NOT NULL,
            total_queries INT DEFAULT 0,
            successful_queries INT DEFAULT 0,
            failed_queries INT DEFAULT 0,
            unique_employees_accessed INT DEFAULT 0,
            most_searched_terms JSON DEFAULT NULL,
            average_response_time_ms DECIMAL(10,3) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_period (date_period, period_type)
        );

        CREATE TABLE IF NOT EXISTS employee_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            action_type ENUM('clock_in', 'clock_out', 'break_start', 'break_end', 'scan') DEFAULT 'scan',
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            location VARCHAR(100),
            notes TEXT,
            created_by INT,
            INDEX idx_employee_id (employee_id),
            INDEX idx_timestamp (timestamp),
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            setting_key VARCHAR(100) NOT NULL,
            setting_value TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_setting (setting_key)
        );

        CREATE TABLE IF NOT EXISTS user_audio_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            success_audio_path VARCHAR(255),
            not_found_audio_path VARCHAR(255),
            inactive_audio_path VARCHAR(255),
            violations_audio_path VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
    ";

    $userPdo->exec($sql);
    return true;
  } catch (PDOException $e) {
    error_log("Error creating user database: " . $e->getMessage());
    return false;
  }
}

// Ensure all user tables exist (call on every login)
function ensureUserTablesExist($userId)
{
  if (!is_numeric($userId) || $userId <= 0) {
    error_log("Invalid user ID for ensuring tables: $userId");
    return false;
  }

  try {
    $userPdo = getUserDBConnection($userId);

    // SQL to create tables if they don't exist
    $sql = "
        CREATE TABLE IF NOT EXISTS employees (
            id INT AUTO_INCREMENT PRIMARY KEY,
            fullname VARCHAR(100) NOT NULL,
            position VARCHAR(50) NOT NULL,
            brand VARCHAR(50) NOT NULL,
            status ENUM ('Active', 'Inactive') DEFAULT 'Active',
            shift ENUM ('Day Shift', 'Night Shift', 'Graveyard Shift') NOT NULL,
            violation TEXT,
            image VARCHAR(255),
            qr_code VARCHAR(100) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS code (
            id INT AUTO_INCREMENT PRIMARY KEY,
            qr_code VARCHAR(100) UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS violations (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            violation_type VARCHAR(100),
            violation_description TEXT,
            violation_date DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS status_history (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            old_status VARCHAR(20),
            new_status VARCHAR(20),
            changed_by VARCHAR(100),
            change_reason TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS search_queries (
            id INT AUTO_INCREMENT PRIMARY KEY,
            query_type VARCHAR(50) NOT NULL,
            search_term VARCHAR(255) DEFAULT NULL,
            search_parameters JSON DEFAULT NULL,
            results_count INT DEFAULT 0,
            results_data JSON DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            query_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            execution_time_ms DECIMAL(10,3) DEFAULT NULL,
            success BOOLEAN DEFAULT FALSE,
            error_message TEXT DEFAULT NULL,
            INDEX idx_query_type (query_type),
            INDEX idx_timestamp (query_timestamp),
            INDEX idx_success (success)
        );

        CREATE TABLE IF NOT EXISTS employee_access_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT DEFAULT NULL,
            fullname VARCHAR(100) DEFAULT NULL,
            position VARCHAR(50) DEFAULT NULL,
            brand VARCHAR(50) DEFAULT NULL,
            status ENUM('Active', 'Inactive') DEFAULT NULL,
            shift ENUM('Day Shift', 'Night Shift', 'Graveyard Shift') DEFAULT NULL,
            violation TEXT DEFAULT NULL,
            image VARCHAR(255) DEFAULT NULL,
            qr_code VARCHAR(100) DEFAULT NULL,
            access_type VARCHAR(50) DEFAULT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            user_agent TEXT DEFAULT NULL,
            check_status ENUM('IN', 'OUT') DEFAULT NULL,
            access_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_employee_id (employee_id),
            INDEX idx_qr_code (qr_code),
            INDEX idx_access_timestamp (access_timestamp),
            INDEX idx_access_type (access_type)
        );

        CREATE TABLE IF NOT EXISTS query_statistics (
            id INT AUTO_INCREMENT PRIMARY KEY,
            date_period DATE NOT NULL,
            period_type ENUM('daily', 'monthly') NOT NULL,
            total_queries INT DEFAULT 0,
            successful_queries INT DEFAULT 0,
            failed_queries INT DEFAULT 0,
            unique_employees_accessed INT DEFAULT 0,
            most_searched_terms JSON DEFAULT NULL,
            average_response_time_ms DECIMAL(10,3) DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_period (date_period, period_type)
        );

        CREATE TABLE IF NOT EXISTS employee_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            employee_id INT NOT NULL,
            action_type ENUM('clock_in', 'clock_out', 'break_start', 'break_end', 'scan') DEFAULT 'scan',
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            location VARCHAR(100),
            notes TEXT,
            created_by INT,
            INDEX idx_employee_id (employee_id),
            INDEX idx_timestamp (timestamp),
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            setting_key VARCHAR(100) NOT NULL,
            setting_value TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_setting (setting_key)
        );

        CREATE TABLE IF NOT EXISTS user_audio_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            success_audio_path VARCHAR(255),
            not_found_audio_path VARCHAR(255),
            inactive_audio_path VARCHAR(255),
            violations_audio_path VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
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
    error_log("Invalid user ID for deletion: $userId");
    return false;
  }

  $userId = intval($userId);
  $dbName = USER_DB_PREFIX . $userId;

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
    error_log("Error deleting user database: " . $e->getMessage());
    return false;
  }
}

// Start session if not already started
if (session_status() === PHP_SESSION_NONE) {
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
    error_log("Error checking custom database existence: " . $e->getMessage());
    return true; // Return true to be safe and prevent creation
  }
}

// Enhanced User Registration Function with Database Creation
function registerUser($username, $email, $password, $firstName, $lastName, $myDatabase = null, $phoneNum = null)
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

    // Insert new user
    $stmt = $pdo->prepare("
        INSERT INTO users (username, email, password, first_name, last_name, my_database, phone, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    ");

    $stmt->execute([
      sanitizeInput($username),
      sanitizeInput($email),
      $hashedPassword,
      sanitizeInput($firstName),
      sanitizeInput($lastName),
      sanitizeInput($myDatabase ?? ''),
      $phoneNum ? sanitizeInput($phoneNum) : null
    ]);

    $userId = $pdo->lastInsertId();

    // Commit the user creation first
    $pdo->commit();

    // Now create user-specific database
    if (!createUserDatabase($userId)) {
      // If database creation fails, remove the user record
      try {
        $pdo->beginTransaction();
        $deleteStmt = $pdo->prepare("DELETE FROM users WHERE id = ?");
        $deleteStmt->execute([$userId]);
        $pdo->commit();
      } catch (PDOException $e) {
        error_log("Error rolling back user creation: " . $e->getMessage());
      }

      return ['success' => false, 'errors' => ['Failed to create user database. Registration cancelled.']];
    }

    // Log successful registration
    logSystemAction($userId, 'USER_REGISTERED', "User registered with database: " . USER_DB_PREFIX . $userId);

    return [
      'success' => true,
      'user_id' => $userId,
      'database_created' => true,
      'database_name' => USER_DB_PREFIX . $userId,
      'message' => 'Registration successful! Your personal database has been created.'
    ];
  } catch (PDOException $e) {
    // Rollback transaction on error
    try {
      if ($pdo->inTransaction()) {
        $pdo->rollBack();
      }
    } catch (Exception $rollbackError) {
      error_log("Error during rollback: " . $rollbackError->getMessage());
    }

    error_log("Registration error: " . $e->getMessage());
    return ['success' => false, 'errors' => ['Database error occurred during registration. Please try again.']];
  }
}

// Enhanced User Login Function with Database Check
function loginUser($username, $password)
{
  try {
    $pdo = getMainDBConnection();

    $stmt = $pdo->prepare("SELECT id, username, email, password, first_name, last_name, my_database FROM users WHERE username = ? OR email = ?");
    $stmt->execute([$username, $username]);
    $user = $stmt->fetch();

    if ($user && password_verify($password, $user['password'])) {
      // Check if user database exists
      if (!userDatabaseExists($user['id'])) {
        // Create user database if it doesn't exist
        if (!createUserDatabase($user['id'])) {
          return ['success' => false, 'errors' => ['Failed to initialize user database']];
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

      // Update last login
      $updateStmt = $pdo->prepare("UPDATE users SET last_login = NOW() WHERE id = ?");
      $updateStmt->execute([$user['id']]);

      // Log successful login
      logSystemAction($user['id'], 'USER_LOGIN', 'User logged in successfully');

      return ['success' => true, 'user' => $user, 'database_ready' => true];
    } else {
      return ['success' => false, 'errors' => ['Invalid username or password']];
    }
  } catch (PDOException $e) {
    error_log("Login error: " . $e->getMessage());
    return ['success' => false, 'errors' => ['Database error occurred during login']];
  }
}

// Create main system tables
function createMainTables()
{
  try {
    $pdo = getMainDBConnection();

    $sql = "
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            first_name VARCHAR(50) NOT NULL,
            last_name VARCHAR(50) NOT NULL,
            phone VARCHAR(20),
            my_database VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            last_login TIMESTAMP NULL,
            session_token VARCHAR(255) DEFAULT NULL,
            session_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_username (username),
            INDEX idx_email (email),
            INDEX idx_users_session_token ON users(session_token)
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
    ";

    $pdo->exec($sql);
    return true;
  } catch (PDOException $e) {
    error_log("Error creating main tables: " . $e->getMessage());
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
    error_log("Error logging system action: " . $e->getMessage());
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
    'my_database' => $_SESSION['my_database']
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
