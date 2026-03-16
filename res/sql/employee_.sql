-- Database Schema for 3PL Manpower Management System
CREATE DATABASE IF NOT EXISTS manpower_system;

USE manpower_system;

-- Main employees table
CREATE TABLE
    employees (
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

-- Table for tracking violations
CREATE TABLE
    violations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT,
        violation_type VARCHAR(100),
        violation_description TEXT,
        violation_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    );

-- Table for tracking status changes
CREATE TABLE
    status_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id INT,
        old_status VARCHAR(20),
        new_status VARCHAR(20),
        changed_by VARCHAR(100),
        change_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees (id) ON DELETE CASCADE
    );

-- Sample data
INSERT INTO
    employees (fullname, position, brand, status, shift, qr_code)
VALUES
    (
        'John Doe',
        'Manager',
        'Brand A',
        'Active',
        'Day Shift',
        'EMP001'
    ),
    (
        'Jane Smith',
        'Supervisor',
        'Brand B',
        'Active',
        'Night Shift',
        'EMP002'
    ),
    (
        'Mike Johnson',
        'Operator',
        'Brand A',
        'Inactive',
        'Day Shift',
        'EMP003'
    );