# Gadget Tracker — Setup Guide

## Requirements
- XAMPP (PHP 8.0+, MySQL 5.7+ / MariaDB 10+)

---

## 1. Copy project to XAMPP htdocs

Place the entire `gadgettracker` folder inside your XAMPP `htdocs`:

```
C:\xampp\htdocs\gadgettracker\
```

---

## 2. Import the database

### Option A — phpMyAdmin
1. Open **phpMyAdmin** → `http://localhost/phpmyadmin`
2. Click **Import** (top menu)
3. Choose file: `gadgettracker/sql/gadgettracker.sql`
4. Click **Go**

### Option B — Command line
```bash
mysql -u root gadgettracker < sql/gadgettracker.sql
```

---

## 3. Configure database credentials (if needed)

Edit `config/config.php` and update:

```php
define('DB_HOST', 'localhost');
define('DB_NAME', 'gadgettracker');
define('DB_USER', 'root');
define('DB_PASS', '');        // change if you have a MySQL password
```

---

## 4. Open the app

```
http://localhost/gadgettracker/
```

---

## Project Structure

```
gadgettracker/
├── index.php                      ← redirects to main page
├── config/
│   └── config.php                 ← DB settings + connection
├── app/
│   ├── api/
│   │   └── gadgets.php            ← REST API (CRUD)
│   └── services/
│       └── gadgettable.php        ← Main UI page
├── public/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
└── sql/
    └── gadgettracker.sql          ← DB schema + sample data
```

---

## Features

| Feature | Details |
|---|---|
| **Add** | Open modal → fill form → Save |
| **Edit** | Click Edit on any row → update → Save |
| **Delete** | Click Del → confirm dialog |
| **Search** | Live search across user, gadget, serial, asset tags, MAC, IMEI |
| **Filter** | Dropdown filters for Inventory Status and Status |
| **Pagination** | 10/15/25/50 rows per page, page number buttons |
| **Keyboard** | `Esc` closes modals, `Ctrl+K` focuses search |

---

## Database fields

| Column | Type | Notes |
|---|---|---|
| user | VARCHAR(150) | Required |
| role | VARCHAR(100) | Required |
| gadget | VARCHAR(150) | Required |
| serial_number | VARCHAR(100) | |
| warehouse_asset_tag | VARCHAR(100) | |
| asset_tag | VARCHAR(100) | |
| mac_address | VARCHAR(50) | |
| password | VARCHAR(255) | Stored as-is (hash recommended for production) |
| warehouse_owner | VARCHAR(150) | |
| remarks | TEXT | |
| recent_responsible | VARCHAR(150) | |
| description | TEXT | |
| imei1 / imei2 | VARCHAR(20) | |
| inventory_status | ENUM | Active, In Stock, In Repair, Retired, Lost, Disposed |
| warehouse | VARCHAR(150) | |
| status | ENUM | Active, Inactive, Pending |
| created_at / updated_at | DATETIME | Auto-managed |
