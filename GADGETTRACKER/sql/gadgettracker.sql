-- ============================================================
-- Gadget Tracker Database Schema
-- Import this into phpMyAdmin or run: mysql -u root gadgettracker < gadgettracker.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS `gadgettracker`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `gadgettracker`;

CREATE TABLE IF NOT EXISTS `gadgets` (
  `id`                   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `user`                 VARCHAR(150)    NOT NULL,
  `role`                 VARCHAR(100)    NOT NULL,
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
  `inventory_status`     ENUM('Active','In Stock','In Repair','Retired','Lost','Disposed') NOT NULL DEFAULT 'Active',
  `warehouse`            VARCHAR(150)    DEFAULT NULL,
  `status`               ENUM('Good','Damaged') NOT NULL DEFAULT 'Good',
  `created_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_user`             (`user`),
  INDEX `idx_gadget`           (`gadget`),
  INDEX `idx_inventory_status` (`inventory_status`),
  INDEX `idx_status`           (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Gadget Details Catalog ────────────────────────────────────────────────────
-- Stores the master list of gadget models/units used for autofill in the main form.
CREATE TABLE IF NOT EXISTS `gadget_details` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `gadget`           VARCHAR(150) NOT NULL,
  `serial_number`    VARCHAR(100) DEFAULT NULL,
  `asset_tag`        VARCHAR(100) DEFAULT NULL,
  `mac_address`      VARCHAR(50)  DEFAULT NULL,
  `imei1`            VARCHAR(20)  DEFAULT NULL,
  `imei2`            VARCHAR(20)  DEFAULT NULL,
  `inventory_status` ENUM('Active','In Stock','In Repair','Retired','Lost','Disposed') NOT NULL DEFAULT 'Active',
  `warehouse`        VARCHAR(150) DEFAULT NULL,
  `status`           ENUM('Good','Damaged') NOT NULL DEFAULT 'Good',
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_gd_gadget` (`gadget`),
  INDEX `idx_gd_serial` (`serial_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
