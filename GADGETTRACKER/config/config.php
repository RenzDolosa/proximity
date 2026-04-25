<?php
// config/config.php

define('DB_HOST', '127.0.0.1:3307');
define('DB_NAME', 'gadgettracker');
define('DB_USER', 'root');
define('DB_PASS', '');

define('APP_TIMEZONE',    'Asia/Manila');
define('APP_TIMEZONE_TZ', '+08:00');

date_default_timezone_set(APP_TIMEZONE);

// ── Auto-setup: creates the DB and table if they don't exist ─────────────
function initDatabase(): array
{
  $dbName = DB_NAME;

  try {
    // Connect WITHOUT specifying a database so we can CREATE DATABASE safely
    $pdo = new PDO(
      'mysql:host=' . DB_HOST . ';charset=utf8mb4',
      DB_USER,
      DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $pdo->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");

    // 1. Check if database already exists
    $stmt = $pdo->prepare("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?");
    $stmt->execute([$dbName]);

    if ($stmt->rowCount() === 0) {
      // Create the database (backtick-escape the name for safety)
      $escapedDbName = str_replace('`', '``', $dbName);
      $pdo->exec("CREATE DATABASE `{$escapedDbName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    }

    // 2. Connect to the (new or existing) database
    $dbPdo = new PDO(
      'mysql:host=' . DB_HOST . ';dbname=' . $dbName . ';charset=utf8mb4',
      DB_USER,
      DB_PASS,
      [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $dbPdo->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");

    // 3. Create tables one by one (avoids multi-statement failures on some drivers)
    $dbPdo->exec("
            CREATE TABLE IF NOT EXISTS `gadgets` (
              `id`                   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
              `user`                 VARCHAR(150)    DEFAULT NULL,
              `role`                 VARCHAR(100)    DEFAULT NULL,
              `gadget`               VARCHAR(150)    NOT NULL,
              `serial_number`        VARCHAR(100)    DEFAULT NULL,
              `warehouse_asset_tag`  VARCHAR(100)    DEFAULT NULL,
              `asset_tag`            VARCHAR(100)    DEFAULT NULL,
              `mac_address`          VARCHAR(50)     DEFAULT NULL,
              `password`             VARCHAR(255)    DEFAULT NULL,
              `warehouse_owner`      VARCHAR(150)    DEFAULT NULL,
              `remarks`              TEXT            DEFAULT NULL,
              `recent_responsible`   VARCHAR(150)    DEFAULT NULL,
              `description`          TEXT            DEFAULT NULL,
              `imei1`                VARCHAR(20)     DEFAULT NULL,
              `imei2`                VARCHAR(20)     DEFAULT NULL,
              `inventory_status`     ENUM('Active','In Stock','In Repair','Retired','Lost','Disposed')
                                                     NOT NULL DEFAULT 'Active',
              `warehouse`            VARCHAR(150)    DEFAULT NULL,
              `status`               ENUM('Good','Damaged')
                                                     NOT NULL DEFAULT 'Good',
              `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
              `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
                                                     ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`),
              INDEX `idx_user`             (`user`),
              INDEX `idx_gadget`           (`gadget`),
              INDEX `idx_inventory_status` (`inventory_status`),
              INDEX `idx_status`           (`status`),
              UNIQUE INDEX `uidx_serial_number` (`serial_number`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ");

    // Add unique index on serial_number for existing installs (safe to re-run)
    try {
        $dbPdo->exec("ALTER TABLE `gadgets` ADD UNIQUE INDEX `uidx_serial_number` (`serial_number`)");
    } catch (PDOException) {
        // Index already exists — ignore
    }

    return ['success' => true, 'database_name' => $dbName];
  } catch (PDOException $e) {
    $errorMsg = 'Error in initDatabase(): ' . $e->getMessage();
    // error_log($errorMsg);
    return ['success' => false, 'error' => $errorMsg];
  }
}

// Run auto-setup on every bootstrap (IF NOT EXISTS = safe to call repeatedly)
$_initResult = initDatabase();
if (!$_initResult['success']) {
  http_response_code(500);
  die(json_encode(['success' => false, 'message' => $_initResult['error']]));
}
unset($_initResult);
// ─────────────────────────────────────────────────────────────────────────────

function getDBConnection(): PDO
{
  try {
    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    $options = [
      PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES   => false,
    ];
    $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
    $pdo->exec("SET time_zone = '" . APP_TIMEZONE_TZ . "'");
    return $pdo;
  } catch (PDOException $e) {
    http_response_code(500);
    die(json_encode(['success' => false, 'message' => 'Database connection failed: ' . $e->getMessage()]));
  }
}
