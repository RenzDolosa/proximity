-- Database Schema for 3PL Manpower Management System
CREATE DATABASE IF NOT EXISTS `if0_41430152_`;

USE `if0_41430152_`;

-- Main employees table
CREATE TABLE
  IF NOT EXISTS employees (
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
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    success_audio_path VARCHAR(255),
    not_found_audio_path VARCHAR(255),
    inactive_audio_path VARCHAR(255),
    violations_audio_path VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    UNIQUE KEY uq_user_id (user_id)
  ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_general_ci;