-- Database Schema for 3PL Manpower Management System
CREATE DATABASE IF NOT EXISTS `if0_41430152_`;

USE `if0_41430152_`;

-- Main employees table
CREATE TABLE
  IF NOT EXISTS `employees` (
    `id` int (11) NOT NULL,
    `fullname` varchar(100) NOT NULL,
    `position` varchar(50) NOT NULL,
    `brand` varchar(50) NOT NULL,
    `gender` enum ('Male', 'Female') DEFAULT NULL,
    `birth` date DEFAULT NULL,
    `hired` date DEFAULT NULL,
    `status` enum ('Active', 'Inactive') DEFAULT 'Active',
    `shift` enum ('Day Shift', 'Night Shift', 'Graveyard Shift') NOT NULL,
    `violation` text DEFAULT NULL,
    `image` varchar(255) DEFAULT NULL,
    `qr_code` varchar(100) DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT current_timestamp(),
    `updated_at` datetime NOT NULL DEFAULT current_timestamp(),
    `user_id` int (11) DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `qr_code` (`qr_code`),
    KEY `idx_qr_code` (`qr_code`)
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `code` (
    `id` int (11) NOT NULL AUTO_INCREMENT,
    `qr_code` varchar(100) DEFAULT NULL,
    `created_at` timestamp NULL DEFAULT current_timestamp(),
    `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    `is_active` tinyint (1) NOT NULL DEFAULT 1,
    `reserved_by` varchar(64) DEFAULT NULL,
    `reserved_at` datetime DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `qr_code` (`qr_code`)
  ) ENGINE = InnoDB AUTO_INCREMENT = 1 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `violations` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `employee_id` int(11) NOT NULL,
    `violation_type` varchar(100) DEFAULT NULL,
    `violation_description` text DEFAULT NULL,
    `violation_date` date DEFAULT NULL,
    `created_at` timestamp NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`),
    KEY `employee_id` (`employee_id`),
    CONSTRAINT `violations_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `status_history` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `employee_id` int(11) NOT NULL,
    `old_status` varchar(20) DEFAULT NULL,
    `new_status` varchar(20) DEFAULT NULL,
    `changed_by` varchar(100) DEFAULT NULL,
    `change_reason` text DEFAULT NULL,
    `created_at` datetime NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`),
    KEY `employee_id` (`employee_id`),
    CONSTRAINT `status_history_ibfk_1` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
  ) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `search_queries` (
    `id` int(11) NOT NULL AUTO_INCREMENT,
    `query_type` varchar(50) NOT NULL,
    `search_term` varchar(255) DEFAULT NULL,
    `search_parameters` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`search_parameters`)),
    `results_count` int(11) DEFAULT 0,
    `results_data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`results_data`)),
    `ip_address` varchar(45) DEFAULT NULL,
    `user_agent` text DEFAULT NULL,
    `query_timestamp` timestamp NULL DEFAULT current_timestamp(),
    `execution_time_ms` decimal(10,3) DEFAULT NULL,
    `success` tinyint(1) DEFAULT 0,
    `error_message` text DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_query_type` (`query_type`),
    KEY `idx_timestamp` (`query_timestamp`),
    KEY `idx_success` (`success`)
  ) ENGINE=InnoDB AUTO_INCREMENT=1 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `employee_access_log` (
    `id` int (11) NOT NULL AUTO_INCREMENT,
    `employee_id` int (11) DEFAULT NULL,
    `fullname` varchar(100) DEFAULT NULL,
    `position` varchar(50) DEFAULT NULL,
    `brand` varchar(50) DEFAULT NULL,
    `status` enum ('Active', 'Inactive') DEFAULT NULL,
    `shift` enum ('Day Shift', 'Night Shift', 'Graveyard Shift') DEFAULT NULL,
    `violation` text DEFAULT NULL,
    `image` varchar(255) DEFAULT NULL,
    `qr_code` varchar(100) DEFAULT NULL,
    `access_type` varchar(50) DEFAULT NULL,
    `ip_address` varchar(45) DEFAULT NULL,
    `user_agent` text DEFAULT NULL,
    `check_status` enum ('IN', 'OUT') DEFAULT NULL,
    `access_timestamp` datetime NOT NULL,
    `user_id` int (11) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_employee_id` (`employee_id`),
    KEY `idx_qr_code` (`qr_code`),
    KEY `idx_access_timestamp` (`access_timestamp`),
    KEY `idx_access_type` (`access_type`),
    KEY `idx_timestamp` (`access_timestamp`),
    KEY `idx_status` (`status`),
    KEY `idx_shift` (`shift`),
    KEY `idx_check_status` (`check_status`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_status_timestamp` (`status`, `access_timestamp`),
    KEY `idx_qr_ts_id` (`qr_code`, `access_timestamp`, `id`)
  ) ENGINE = InnoDB AUTO_INCREMENT = 1 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `employee_attendance_log` (
    `id` int (11) NOT NULL AUTO_INCREMENT,
    `user_id` int (11) DEFAULT NULL,
    `employee_id` int (11) DEFAULT NULL,
    `fullname` varchar(100) DEFAULT NULL,
    `position` varchar(50) DEFAULT NULL,
    `brand` varchar(50) DEFAULT NULL,
    `status` enum ('Active', 'Inactive') DEFAULT NULL,
    `shift` enum ('Day Shift', 'Night Shift', 'Graveyard Shift') DEFAULT NULL,
    `violation` text DEFAULT NULL,
    `image` varchar(255) DEFAULT NULL,
    `qr_code` varchar(100) DEFAULT NULL,
    `access_type` varchar(50) DEFAULT NULL,
    `ip_address` varchar(45) DEFAULT NULL,
    `user_agent` text DEFAULT NULL,
    `access_timestamp` timestamp NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`id`),
    KEY `idx_employee_id` (`employee_id`),
    KEY `idx_qr_code` (`qr_code`),
    KEY `idx_access_timestamp` (`access_timestamp`),
    KEY `idx_access_type` (`access_type`)
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `check_in_out` (
    `id` int (11) NOT NULL AUTO_INCREMENT,
    `employee_id` int (11) NOT NULL,
    `qr_code` varchar(255) NOT NULL,
    `fullname` varchar(255) NOT NULL,
    `check_type` enum ('IN', 'OUT') NOT NULL,
    `scan_timestamp` datetime NOT NULL,
    `ip_address` varchar(45) DEFAULT NULL,
    `user_agent` text DEFAULT NULL,
    `user_id` int (11) DEFAULT NULL,
    PRIMARY KEY (`id`),
    KEY `idx_employee_id` (`employee_id`),
    KEY `idx_qr_code` (`qr_code`),
    KEY `idx_timestamp` (`scan_timestamp`),
    KEY `idx_employee_scan` (`employee_id`, `scan_timestamp`)
  ) ENGINE = InnoDB AUTO_INCREMENT = 1 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `global_audio_settings` (
    `id` int (11) NOT NULL AUTO_INCREMENT,
    `audio_type` varchar(50) NOT NULL,
    `audio_data` mediumtext DEFAULT '',
    `audio_mime` varchar(50) DEFAULT '',
    `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (`id`),
    UNIQUE KEY `audio_type` (`audio_type`)
  ) ENGINE = InnoDB AUTO_INCREMENT = 1 DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;

CREATE TABLE
  IF NOT EXISTS `user_audio_settings` (
    `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
    `user_id` int(10) unsigned NOT NULL,
    `success_audio_path` varchar(512) DEFAULT NULL,
    `not_found_audio_path` varchar(512) DEFAULT NULL,
    `inactive_audio_path` varchar(512) DEFAULT NULL,
    `violations_audio_path` varchar(512) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
    `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_user_id` (`user_id`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
