# Proximity Data — Employee Access Management System

A web-based proximity/NFC employee access logging and management system. It tracks employee check-ins and check-outs via QR/NFC proximity scanning, manages manpower records, logs violations, provides facial identification for scan verification, and delivers a real-time data dashboard — all scoped per authenticated user with isolated databases.

---

# Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Entry Points](#entry-points)
- [Modules](#modules)
- [Database](#database)
- [Configuration](#configuration)
- [Frontend Assets](#frontend-assets)
- [Security](#security)
- [Version](#version)

---

## Features

- **NFC / Proximity Scanning** — Real-time employee scan with IN/OUT toggle tracking
- **Facial Identification** — Camera-based employee recognition for scan verification using face-api.js; compares live feed against stored employee photos
- **Attendance Log Table** — Dedicated `employee_attendance_log` table with paginated view, daily stats, and status breakdowns (active/inactive/today)
- **Notification System** — Real-time topbar alerts for late check-ins, anomalies, and incident reports; polled every 30 s with unread pip indicator
- **Employee Management (Manpower)** — Full CRUD for employee records with photo upload
- **Access Data Log (DTL)** — Paginated, filterable scan history with auto-update
- **Violation Log** — Record and view employee violation remarks with attachment support
- **Proximity Code Table** — Manage and export employee QR/proximity codes
- **Employee Dashboard** — Visual overview of scanned records and check status
- **Admin Panel** — System-level management for privileged users including user group control, permission assignment, and system logs
- **Manual Input** — Manual IN/OUT entry for employees without a scanner
- **Per-user Isolated Databases** — Each account operates on its own database instance
- **Role-based Menu Access** — Pages shown based on user group/permissions
- **Auto-update** — Configurable polling interval to refresh scan data without page reload
- **Export** — Export proximity codes and data logs
- **Incident Report** — Violation attachment viewer via URL parameters
- **Responsive UI** — Sidebar + top bar layout with mobile bottom navigation

---

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Backend    | PHP 8+                              |
| Database   | MySQL (PDO)                         |
| Frontend   | Vanilla JS, CSS, HTML               |
| Icons      | Font Awesome 6                      |
| Env Config | `vlucas/phpdotenv ^5.6` (Composer)  |
| Audio      | MP3 / M4A (browser Audio API)       |
| Face AI    | face-api.js (TensorFlow.js models)  |

---

## Project Structure

```
htdocs/
├── index.php                        # Login page & main entry point
├── portal.php                       # Main portal shell (sidebar + iframe layout)
├── proximity.php                    # Proximity scanner shell page
├── composer.json                    # PHP dependency (phpdotenv)
│
├── config/
│   ├── config.php                   # App config, DB constants, helper functions
│   ├── db.php                       # PDO connection factory (main + user DBs)
│   ├── req.php                      # Access control / requireAccess()
│   └── migrate_to_webp.php          # Image migration utility
│
├── app/
│   ├── helper/
│   │   └── get_user_id.php          # Returns current session user ID as JSON
│   │
│   ├── http/
│   │   ├── auth/
│   │   │   └── login.php            # Login logic, CSRF, rate limiting
│   │   └── controllers/
│   │       ├── qr proximity.php     # QR/NFC scanner UI controller
│   │       ├── manual input.php     # Manual IN/OUT entry controller
│   │       ├── chart.php            # Dashboard chart controller
│   │       └── scan test.php        # Scanner test/debug controller
│   │
│   └── services/
│       ├── facial-identification.php # Facial recognition scan verification (face-api.js + PHP)
│       ├── face-identify.php         # Face matching API endpoint (returns employee match)
│       ├── face-employees.php        # Employee photo feed for facial model enrollment
│       ├── attendancelog.php         # Attendance log table view (employee_attendance_log)
│       ├── attendancelog_backend.php # Attendance log API — pagination, filters, stats
│       ├── notifications_backend.php # Real-time alert API (late check-ins, anomalies, incidents)
│       ├── manpower_backend.php      # Employee CRUD API (employees table)
│       ├── datalog_backend.php       # Access log API (employee_access_log)
│       ├── qr_search_backend.php     # Proximity scan handler & IN/OUT toggle
│       ├── proxcode_backend.php      # Proximity code table API
│       ├── violation_log_backend.php # Violation CRUD API
│       ├── system.php                # System table service (admin panel backend)
│       ├── violation_log.php         # Violation log view service
│       ├── datalog.php               # Data log view service
│       ├── ea-dtl.php                # Employee-access detail service
│       ├── eas.php                   # Employee access summary service
│       ├── export_proxcode.php       # Export proximity codes
│       ├── global_audio.php          # Global audio settings service
│       ├── incident_report.php       # Incident/violation report viewer
│       ├── proximity-code.php        # Proximity code page service
│       └── table panel.php           # Table panel service
│
├── resource/
│   ├── views/
│   │   ├── iframe/
│   │   │   └── main.php             # Main iframe router (loads pages by ?page=)
│   │   ├── partials/                # Reusable HTML partials
│   │   ├── account.php              # Account info page
│   │   ├── admin panel.php          # Admin panel page (user groups, permissions, system logs)
│   │   ├── employee dashboard.php   # Employee dashboard page
│   │   ├── settings.php             # Settings page
│   │   ├── reg.php                  # Registration page
│   │   └── f-pass.php               # Forgot password page
│   │
│   ├── css/
│   │   ├── main.css                 # Main/global styles
│   │   ├── r-l.css                  # Register/login styles
│   │   ├── qp.css                   # QR proximity styles
│   │   ├── ptl.css                  # Portal styles
│   │   ├── sbar.css                 # Sidebar styles
│   │   ├── emp-db.css               # Employee dashboard styles
│   │   ├── modal.css                # Modal styles
│   │   ├── btn.css                  # Button styles
│   │   ├── loading.css              # Loading indicator styles
│   │   ├── pg.css                   # Pagination styles
│   │   ├── sett.css                 # Settings styles
│   │   ├── acct.css                 # Account styles
│   │   ├── is.css                   # Import employees styles
│   │   ├── m-i.css                  # Manual input styles
│   │   ├── opt-btn.css              # Option button styles
│   │   ├── req.css                  # Requirements/alert styles
│   │   ├── about.css                # About page styles
│   │   ├── system.css               # Table styles
│   │   └── system-camera.css        # Camera system styles
│   │
│   ├── js/
│   │   ├── notifications.js         # Real-time alert polling & topbar rendering
│   │   ├── ver.js                   # Global version display
│   │   ├── main.js                  # Main portal JS
│   │   ├── dtl.js                   # Datalog table JS (filters, pagination, auto-update)
│   │   ├── ea-dtl.js                # Export all datalog JS
│   │   ├── eas.js                   # Export all employees JS
│   │   ├── proxcode.js              # Proximity code table JS
│   │   ├── panel.js                 # Table panel JS
│   │   ├── system.js                # Employees table JS (filters, pagination)
│   │   ├── system-camera.js         # Camera system JS
│   │   ├── is.js                    # Incident summary JS
│   │   ├── ipc.js                   # IPC JS
│   │   ├── qp.js                    # QR proximity JS
│   │   ├── btn.js                   # Button/portal button JS
│   │   ├── clock.js                 # Clock JS
│   │   ├── acct.js                  # Account JS
│   │   ├── reg.js                   # Registration JS
│   │   ├── li.js                    # Login JS
│   │   ├── loading.js               # Loading state JS
│   │   ├── opt-btn.js               # Option button JS
│   │   ├── req.js                   # Requirements/session check JS
│   │   ├── st.js                    # Scan test JS
│   │   ├── global_audio_settings.js # Audio settings JS
│   │   └── m-i v2.js                # Manual input v2 JS
│   │
│   └── assets/
│       ├── icon/                    # App icons (PNG, SVG)
│       ├── logo/                    # App logos (SVG)
│       └── sounds/                  # Audio feedback files
│           ├── success.mp3          # Successful scan sound
│           ├── warning.m4a/.mp3     # Warning sound
│           ├── inactive.m4a/.mp3    # Inactive employee sound
│           ├── noresultsfound.mp3   # No result sound
│           └── ohh-ow.mp3           # Error sound
│
├── database/
│   ├── migrations/
│   │   ├── database.php             # Migration runner
│   │   └── sql/
│   │       ├── employee_.sql        # Employee table schema
│   │       └── if0_41430152_proximity3pl.sql  # Main DB schema dump
│   └── seeders/                     # Database seeders
│
├── public/
│   └── uploads/
│       └── user/                    # User-uploaded employee images
│
└── tests/
    ├── test.php                     # General test file
    └── m-i v2.php                   # Manual input v2 test
```

---

## Entry Points

| URL / File        | Description                                              |
|-------------------|----------------------------------------------------------|
| `index.php`       | Login page. Redirects to `portal.php` if already logged in. Also handles `?url=register` and `?url=proximity3pl` routes. |
| `portal.php`      | Main shell after login. Renders the sidebar, topbar, and loads views inside an iframe via `resource/views/iframe/main.php`. |
| `proximity.php`   | Full-screen proximity scanner shell. Loads `app/http/controllers/qr proximity.php` inside an iframe. |

---

## Modules

### Proximity Scanner (`qr proximity.php`)
Handles NFC/QR code scans in real time. On each scan, it calls `qr_search_backend.php` which:
- Looks up the employee by QR/proximity code
- Toggles IN/OUT status in the `check_in_out` table
- Writes a row to `employee_access_log`
- Returns employee data + audio cue hint to the frontend

### Facial Identification (`facial-identification.php`)
Camera-based employee verification powered by face-api.js (TensorFlow.js):
- Streams live camera feed and runs face detection on each frame
- Loads enrolled employee face descriptors from `face-employees.php` (Active employees with photos)
- Matches detected face against the descriptor pool via `face-identify.php`
- On match: displays employee info, triggers audio feedback, and records the attendance event
- Requires Active employee records with uploaded photos for enrollment
- Operates under the `facial` permission gate via `requireAccess('facial', ...)`

### Attendance Log Table (`attendancelog.php` + `attendancelog_backend.php`)
Dedicated view for the `employee_attendance_log` table:
- Dashboard stat cards: total scanned, active, inactive, and today's attendance counts
- Paginated and filterable log of all attendance events joined with employee names
- Recent log preview (last 10 entries) rendered on page load
- Backend API handles server-side filtering, sorting, and pagination
- Access gated by `system`, `datalog`, `proximity-code`, or `remarks` permission

### Admin Panel (`resource/views/admin panel.php` + `system.php`)
Privileged system-management interface for admin users:
- User group management: create, edit, and delete user groups with JSON-based permission sets
- Permission assignment: granular control over page access and action rights (add, edit, delete, export, import) per group
- System logs: audit trail of admin actions and system events
- Admin users bypass all permission checks automatically via `isAdmin()` guard

### Data Log / DTL (`dtl.js` + `datalog_backend.php`)
Displays `employee_access_log` in a paginated, filterable table with:
- Server-side filtering by name, position, brand, status, shift, violation, gate, date
- Auto-update polling (configurable interval, pauses during user activity)
- Page-preserved auto-refresh (stays on current page during polling)
- Export and filtered delete

### Manpower (`manpower_backend.php`)
Full CRUD for the `employees` table including:
- Photo upload with thumbnail generation
- QR/proximity code assignment
- Violation field
- Shift and status management

### Proximity Code Table (`proxcode_backend.php` + `proxcode.js`)
Manages the `code` table — the registry of proximity/QR codes assigned to employees. Supports export.

### Violation Log (`violation_log_backend.php`)
Stores structured violation records in the `violations` table (linked to `employees` via FK). Viewable via the incident report viewer (`incident_report.php`).

### Notification System (`notifications_backend.php` + `notifications.js`)
Real-time alert pipeline injected into the portal topbar bell:

| Alert Type | Trigger | Severity |
|---|---|---|
| **Late Check-In** | Employee scans IN >30 min after shift start | Medium / High (>60 min) |
| **Anomaly — Inactive** | Inactive/suspended/terminated employee scans IN | High |
| **Anomaly — Flagged** | Employee with an open violation scans IN | Medium |
| **Incident Report** | New row inserted into the `violations` table | High |

`notifications.js` polls every **30 seconds** using a `?since=` timestamp cursor for incremental fetches. A red pip on the bell icon tracks unseen alerts (persisted via `localStorage`). The live-alert section appears above the existing "What's New" changelog in the dropdown. Polling auto-pauses when the browser tab is hidden and resumes on visibility.

### Manual Input (`manual input.php`)
Allows manually recording an employee IN or OUT event without a physical scan.

---

## Database

The system uses **two database tiers**:

| Tier | Purpose |
|------|---------|
| **Main DB** (`DB_NAME`) | Stores users, roles, system-wide settings |
| **User DB** | Per-user isolated database — created automatically on first login. Stores `employees`, `code`, `employee_access_log`, `employee_attendance_log`, `check_in_out`, `violations` |

### Core Tables (User DB)

| Table | Description |
|-------|-------------|
| `employees` | Employee master records (name, position, brand, shift, status, image, QR code) |
| `code` | Proximity/QR code registry |
| `employee_access_log` | Every scan event (written by `qr_search_backend.php`) |
| `employee_attendance_log` | Structured attendance records with status flags; source for the Attendance Log Table view |
| `check_in_out` | IN/OUT toggle history — source of truth for current check status |
| `violations` | Structured violation records linked to employees |

---

## Configuration

Copy or create a `.env` file in the project root:

```env
APP_ENV=local

DB_HOST=127.0.0.1:3306
DB_NAME=proximity3pl
DB_USER=root
DB_PASS=
```

- Set `APP_ENV=local` for local development (uses hardcoded localhost credentials in `config.php`)
- Set `APP_ENV=production` to read all DB values from `.env`

Install PHP dependencies:

```bash
composer install
```

---

## Frontend Assets

- **Font Awesome 6** — loaded from `cdnjs.cloudflare.com`
- **face-api.js** — TensorFlow.js-based face detection and recognition models used by `facial-identification.php`
- **Audio feedback** — played on scan events (success, warning, inactive, not found)
- **NFC icon** — `resource/assets/icon/nfc-icon.svg` used throughout for proximity actions
- **Version display** — `resource/js/ver.js` renders the current version fixed to the bottom-right corner on all pages

---

## Security

- CSRF token on login form
- Rate limiting on login (5 attempts per 3 minutes)
- Password hashing via `password_hash()` / `password_verify()`
- All dynamic HTML output escaped with `htmlspecialchars()` / custom `escapeHtml()`
- PDO prepared statements throughout — no raw query interpolation
- `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy` headers on API endpoints
- CORS restricted to configured origin in `qr_search_backend.php`
- Session-based authentication with `requireAccess()` guard on all protected pages
- Per-user database isolation — users cannot access each other's data
- Facial identification access gated behind the `facial` permission — admin-only by default

---

## Version

Current version is managed and displayed via `resource/js/ver.js`.

```javascript
// resource/js/ver.js
const ver = document.getElementById('version');
ver.innerHTML = `<i class="fas fa-code-branch"></i> Version: 2.3.13`;
```

Update the version string in `ver.js` when releasing a new version.