-- Database Schema for 3PL Manpower Login System
-- DROP DATABASE if0_41430152_proximity3pl;
CREATE DATABASE IF NOT EXISTS `if0_41430152_proximity3pl`; -- system_database

USE `if0_41430152_proximity3pl`; -- system_database

CREATE TABLE
  IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `username` varchar(50) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `my_database` varchar(50) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `last_login` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `users` (`id`, `username`, `email`, `password`, `first_name`, `last_name`, `phone`, `my_database`, `created_at`, `updated_at`, `last_login`) VALUES
(1, 'RenzDolosa', 'renzeload@gmail.com', `$2y$10$/nqdViJv2DWyfjHhfS8ZDOPT.6QwxO3DWK1ocCwDFPUYvEE20Lkga`, 'Renren', 'Dolosa', NULL, 'AdminServer', '2025-06-01 11:22:31', '2026-03-21 10:23:20', '2026-03-21 10:23:20'),
(2, 'hrqrdata', 'hrassistant.inspi@gmail.com', `$2y$10$h1KCNltHY3HOQvlOBHyheeSPgA1h7e9mSK/P0p89ugzFpvt2o3xKW`, 'Jennica Marie', 'Cruz', NULL, 'HRServer', '2025-06-05 05:51:53', '2026-03-09 08:57:17', '2026-03-09 08:57:17');

CREATE TABLE
  IF NOT EXISTS `user_sessions` (
  `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` int(11) NOT NULL,
  `session_token` varchar(255) NOT NULL,
  `expires_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  CONSTRAINT `user_sessions_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `system_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `user_id` int(11) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `details` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  CONSTRAINT `system_logs_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `user_groups` (
    `id` INT (11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `group_number` VARCHAR(64) NOT NULL UNIQUE COMMENT 'Auto-generated unique group number',
    `group_name` VARCHAR(100) NOT NULL UNIQUE COMMENT 'Human-readable name e.g. Administrator',
    `description` VARCHAR(255) DEFAULT NULL,
    `is_enabled` TINYINT (1) NOT NULL DEFAULT 1 COMMENT '1 = enabled, 0 = disabled',
    `permissions` JSON DEFAULT NULL COMMENT 'JSON object: { order: true, social: false, ... }',
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT INTO `system_logs` (`id`, `user_id`, `action`, `details`, `ip_address`, `user_agent`, `created_at`) VALUES
(1, 1, 'USER_REGISTERED', 'User registered with database: AdminServer', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36', '2025-06-01 11:22:31'),
(2, 1, 'USER_REGISTERED', 'User registered with database: if0_41430152_1', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36', '2025-06-01 11:22:31'),
(3, 2, 'USER_REGISTERED', 'User registered with database: HRServer', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', '2025-06-05 05:51:53'),
(4, 2, 'USER_REGISTERED', 'User registered with database: if0_41430152_2', '::1', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36', '2025-06-05 05:51:53');

INSERT IGNORE INTO `user_groups` (
  `group_number`,
  `group_name`,
  `description`,
  `is_enabled`,
  `permissions`,
  `created_at`
)
VALUES
  (
    '1',
    'Administrator',
    'Full access to all system features',
    1,
    JSON_OBJECT (
      'system', true,
      'datalog', true,
      'proxcode', true,
      'manual_input', true,
      'live_sreach', true,
      'account', true,
      'employee_db', true,
      'settings', true,
      'system-log', true,
      'user-management', true,
      'scantest', true
    ),
    NOW()
  );