-- Database Schema for 3PL Manpower Data Log System
CREATE DATABASE IF NOT EXISTS datalog_system;

USE datalog_system;

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
  );

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
    access_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    check_status ENUM ('IN','OUT') NOT NULL,
    INDEX idx_employee_id (employee_id),
    INDEX idx_access_timestamp (access_timestamp),
    INDEX idx_access_type (access_type)
  );

CREATE TABLE
  IF NOT EXISTS query_statistics (
    id INT AUTO_INCREMENT PRIMARY KEY,
    date_period DATE NOT NULL,
    period_type ENUM ('daily', 'monthly') NOT NULL,
    total_queries INT DEFAULT 0,
    successful_queries INT DEFAULT 0,
    failed_queries INT DEFAULT 0,
    unique_employees_accessed INT DEFAULT 0,
    most_searched_terms JSON DEFAULT NULL,
    average_response_time_ms DECIMAL(10, 3) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_period (date_period, period_type)
  );