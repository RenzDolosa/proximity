<?php
// resource/views/about.php

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

requireAccess('about', '../../proximity.php', true);
$access = getMenuAccess();
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>About – <?= htmlspecialchars($myDatabase ?? 'Proximity 3PL'); ?></title>
  <link rel="icon" href="../assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <link rel="stylesheet" href="../css/about.css">
</head>

<body>

  <!-- Loading Screen -->
  <div id="loading-screen">
    <div class="loading-content">
      <div class="spinner"></div>
      <div class="loading-text">Loading…</div>
      <div class="loading-subtext">Preparing About page</div>
    </div>
  </div>

  <div class="page-body">

    <!-- ── Hero ── -->
    <div class="about-hero">
      <div class="hero-logo">
        <img
          src="../assets/logo/proximity-logo.svg"
          alt="Proximity 3PL Logo"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
        <span class="hero-icon-fallback" style="display:none;">
          <i class="fas fa-satellite-dish"></i>
        </span>
      </div>
      <div class="hero-text">
        <h1>Proximity System</h1>
        <p>Empower your business with a smart employee proximity management platform featuring seamless attendance tracking, facial identification, secure access control, and real-time analytics.</p>
        <div class="hero-meta">
          <span class="hero-badge">
            <i class="fas fa-code-branch"></i>
            <span id="about-version">Version 2.3.13</span>
          </span>
          <span class="hero-badge muted">
            <i class="fas fa-map-marker-alt"></i> Proximity · Philippines
          </span>
          <span class="hero-badge muted">
            <i class="fas fa-clock"></i> Build 2025–2026
          </span>
        </div>
      </div>
    </div>

    <!-- ── Notifications / What's New ── -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <i class="fas fa-bell" style="color:#2563eb;"></i> What's New
        </span>
        <span class="notif-badge" id="notif-count">3 updates</span>
      </div>
      <div class="card-body notif-body">

        <div class="notif-item notif-new">
          <div class="notif-dot green"></div>
          <div class="notif-content">
            <div class="notif-header">
              <span class="notif-tag green">New</span>
              <span class="notif-version">v2.3.13</span>
              <span class="notif-date">May 2026</span>
            </div>
            <div class="notif-title">Facial Identification, Attendance Log Table & Admin Panel</div>
            <div class="notif-desc">
              <strong>Facial Identification:</strong> Camera-based employee recognition powered by face-api.js. Detects and matches faces against enrolled employee photos in real time, triggers audio feedback on match, and records the attendance event automatically.<br>
              <strong>Attendance Log Table:</strong> Dedicated view over the <code>employee_attendance_log</code> table with daily stat cards (total scanned, active, inactive, today) and a paginated, filterable log joined with employee names.<br>
              <strong>Admin Panel:</strong> System-level management for privileged users — user group creation, JSON-based permission assignment per group, action gating (add, edit, delete, export, import), and system audit logs. Admins bypass all permission checks automatically.
            </div>
          </div>
        </div>

        <div class="notif-item">
          <div class="notif-dot amber"></div>
          <div class="notif-content">
            <div class="notif-header">
              <span class="notif-tag amber">Updated</span>
              <span class="notif-version">v2.2.12</span>
              <span class="notif-date">May 2026</span>
            </div>
            <div class="notif-title">Real-Time Notification System</div>
            <div class="notif-desc">Live topbar alerts for late check-ins, inactive-employee anomalies, flagged-employee scans, and new incident reports — polled every 30 s with unread pip.</div>
          </div>
        </div>

        <div class="notif-item">
          <div class="notif-dot blue"></div>
          <div class="notif-content">
            <div class="notif-header">
              <span class="notif-tag blue">Improved</span>
              <span class="notif-version">v2.2.10–11</span>
              <span class="notif-date">Apr–May 2026</span>
            </div>
            <div class="notif-title">Role-Based Permission System Overhaul</div>
            <div class="notif-desc">Granular JSON-based permissions per <code>user_groups</code>. Menu visibility, action gating (add, edit, delete, export, import), and AJAX 403 responses are all driven by group permissions. Admin bypasses all checks automatically.</div>
          </div>
        </div>

        <div class="notif-item">
          <div class="notif-dot amber"></div>
          <div class="notif-content">
            <div class="notif-header">
              <span class="notif-tag amber">Updated</span>
              <span class="notif-version">v2.2.8–9</span>
              <span class="notif-date">Apr 2026</span>
            </div>
            <div class="notif-title">Employee Records — Gender, Birth & Hire Date Fields</div>
            <div class="notif-desc">Employee schema expanded with <code>gender</code>, <code>birth</code>, and <code>hired</code> columns. Auto-migrated via <code>ALTER TABLE IF NOT EXISTS</code> on startup. Reflected in the Employee Manager UI and export sheets.</div>
          </div>
        </div>

        <div class="notif-item">
          <div class="notif-dot purple"></div>
          <div class="notif-content">
            <div class="notif-header">
              <span class="notif-tag purple">Feature</span>
              <span class="notif-version">v2.2.6–7</span>
              <span class="notif-date">Mar–Apr 2026</span>
            </div>
            <div class="notif-title">Web NFC Proximity Scanning — Production Ready</div>
            <div class="notif-desc">NFC tap-to-verify flow with real-time Web NFC API integration, check-in/out state tracking, and gate scan doughnut analytics. Supports both active and inactive employee states with distinct audio feedback.</div>
          </div>
        </div>

        <div class="notif-item">
          <div class="notif-dot gray"></div>
          <div class="notif-content">
            <div class="notif-header">
              <span class="notif-tag gray">Core</span>
              <span class="notif-version">v2.0–2.2.5</span>
              <span class="notif-date">2025 – Early 2026</span>
            </div>
            <div class="notif-title">Core System — Login, Portal, Employee Manager & Dashboard</div>
            <div class="notif-desc">Initial release of the full Proximity 3PL platform: session-based auth, multi-user isolation, iframe portal shell, Employee Manager with violation tracking, access logs, Chart.js analytics, and Excel export.</div>
          </div>
        </div>

      </div>
    </div>

    <!-- ── Features + Roadmap ── -->
    <div class="about-grid">

      <!-- Key Features -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-star" style="color:#f59e0b;"></i> Key Features
          </span>
        </div>
        <div class="card-body">
          <div class="feature-list">

            <div class="feature-item">
              <div class="feature-icon blue"><i class="fas fa-id-badge"></i></div>
              <div>
                <div class="fi-title">NFC / Proximity Scanning</div>
                <div class="fi-desc">Tap-to-verify employee identity via Web NFC API with real-time check-in/out state and audio feedback.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon indigo"><i class="fas fa-camera"></i></div>
              <div>
                <div class="fi-title">Facial Identification</div>
                <div class="fi-desc">Camera-based employee recognition using face-api.js — matches live feed against enrolled employee photos and records attendance automatically.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon teal"><i class="fas fa-calendar-check"></i></div>
              <div>
                <div class="fi-title">Attendance Log Table</div>
                <div class="fi-desc">Dedicated <code>employee_attendance_log</code> view with daily stat cards and a paginated, filterable log joined with employee names.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon green"><i class="fas fa-users"></i></div>
              <div>
                <div class="fi-title">Employee Manager</div>
                <div class="fi-desc">Full CRUD with status, shift, gender, birth/hire dates, violation logs, image uploads, and Excel export.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon purple"><i class="fas fa-chart-line"></i></div>
              <div>
                <div class="fi-title">Live Dashboard & Analytics</div>
                <div class="fi-desc">Hourly/daily attendance charts, gate scan doughnut, and real-time check-in/out counters via Chart.js.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon amber"><i class="fas fa-user-shield"></i></div>
              <div>
                <div class="fi-title">Role-Based Access Control</div>
                <div class="fi-desc">JSON-driven permissions per user group — page visibility, action gating, AJAX 403, and portal protection.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon red"><i class="fas fa-tools"></i></div>
              <div>
                <div class="fi-title">Admin Panel</div>
                <div class="fi-desc">System-level management for privileged users: user group control, permission assignment, and system audit logs.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon pink"><i class="fas fa-exclamation-triangle"></i></div>
              <div>
                <div class="fi-title">Incident & Violation Logs</div>
                <div class="fi-desc">Record, track, and export workplace incidents with timestamps and employee attribution.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon teal"><i class="fas fa-volume-up"></i></div>
              <div>
                <div class="fi-title">Per-User Audio Settings</div>
                <div class="fi-desc">Customizable scan sound paths for each event type, stored per user and managed via global audio controller.</div>
              </div>
            </div>

          </div>
        </div>
      </div>

      <!-- Development Roadmap -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-road" style="color:#6366f1;"></i> Development Roadmap
          </span>
        </div>
        <div class="card-body">
          <div class="timeline">

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Core System Launch</div>
              <div class="tl-desc">Login, portal shell, employee manager, NFC scanning, access log dashboard, and session-based auth.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Analytics & Charting</div>
              <div class="tl-desc">Hourly and multi-day attendance charts with gate scan doughnut via Chart.js.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Role-Based Access & Admin Panel</div>
              <div class="tl-desc">JSON-permission system, user group management, system logs, and portal security layer.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Audio Settings System</div>
              <div class="tl-desc">Per-user sound customization with global audio manager and database-backed persistence.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Notification System</div>
              <div class="tl-desc">Real-time alerts for late check-ins, anomalies, and incident reports pushed to the portal topbar.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Facial Identification</div>
              <div class="tl-desc">Camera-based employee recognition via face-api.js with automatic attendance recording on match.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Attendance Log Table</div>
              <div class="tl-desc">Dedicated attendance log view with daily stat cards, pagination, and employee-joined records from <code>employee_attendance_log</code>.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot amber"></div>
              <div class="tl-label">🔄 In Progress</div>
              <div class="tl-title">Enhanced Manual Input v2</div>
              <div class="tl-desc">Redesigned employee input form with bulk import, field validation improvements, and camera integration.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot"></div>
              <div class="tl-label">📋 Planned</div>
              <div class="tl-title">Mobile App Integration</div>
              <div class="tl-desc">Native mobile companion for on-the-go proximity scanning and manager approvals.</div>
            </div>

          </div>
        </div>
      </div>
    </div>

    <!-- ── Technology Stack ── -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">
          <i class="fas fa-layer-group" style="color:#0d9488;"></i> Technology Stack
        </span>
      </div>
      <div class="card-body">
        <div class="tech-stack">
          <span class="tech-pill"><i class="fab fa-php" style="color:#7c3aed;"></i> PHP 8</span>
          <span class="tech-pill"><i class="fas fa-database" style="color:#2563eb;"></i> MySQL / MariaDB</span>
          <span class="tech-pill"><i class="fab fa-html5" style="color:#e34f26;"></i> HTML5</span>
          <span class="tech-pill"><i class="fab fa-css3-alt" style="color:#1572b6;"></i> CSS3</span>
          <span class="tech-pill"><i class="fab fa-js" style="color:#ca8a04;"></i> Vanilla JS</span>
          <span class="tech-pill"><i class="fas fa-chart-bar" style="color:#ec4899;"></i> Chart.js</span>
          <span class="tech-pill"><i class="fas fa-broadcast-tower" style="color:#16a34a;"></i> Web NFC API</span>
          <span class="tech-pill"><i class="fas fa-camera" style="color:#6366f1;"></i> face-api.js</span>
          <span class="tech-pill"><i class="fab fa-font-awesome" style="color:#528dd7;"></i> Font Awesome 6</span>
          <span class="tech-pill"><i class="fas fa-box" style="color:#f59e0b;"></i> Composer / Dotenv</span>
          <span class="tech-pill"><i class="fas fa-volume-up" style="color:#0d9488;"></i> Web Audio API</span>
          <span class="tech-pill"><i class="fas fa-file-excel" style="color:#16a34a;"></i> PhpSpreadsheet</span>
          <span class="tech-pill"><i class="fab fa-github" style="color:#6366f1;"></i> GitHub</span>
        </div>
      </div>
    </div>

    <!-- ── Team + Contact ── -->
    <div class="about-grid">

      <!-- Development Team -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-people-group" style="color:#ec4899;"></i> Development Team
          </span>
        </div>
        <div class="card-body">
          <div class="team-grid">

            <div class="team-card">
              <div class="team-avatar">RD</div>
              <div class="team-name">Renz Dolosa</div>
              <div class="team-role">Lead Developer</div>
            </div>

            <div class="team-card">
              <div class="team-avatar" style="background:#f0fdfa;border-color:#99f6e4;color:#0d9488;">RD</div>
              <div class="team-name">Renz Dolosa</div>
              <div class="team-role">Backend Developer</div>
            </div>

            <div class="team-card">
              <div class="team-avatar" style="background:#fffbeb;border-color:#fde68a;color:#d97706;">RD</div>
              <div class="team-name">Renz Dolosa</div>
              <div class="team-role">UI / Frontend</div>
            </div>

          </div>
        </div>
      </div>

      <!-- Contact & Support -->
      <div class="card">
        <div class="card-header">
          <span class="card-title">
            <i class="fas fa-headset" style="color:#2563eb;"></i> Contact & Support
          </span>
        </div>
        <div class="card-body">

          <div class="contact-row">
            <div class="contact-item">
              <div class="ci-icon"><i class="fas fa-envelope"></i></div>
              <div>
                <div class="ci-label">Email Support</div>
                <div class="ci-value">inspi.renzdolosa@gmail.com</div>
              </div>
            </div>
            <div class="contact-item">
              <div class="ci-icon"><i class="fas fa-globe"></i></div>
              <div>
                <div class="ci-label">Live Site</div>
                <div class="ci-value">proximity3pl.page.gd</div>
              </div>
            </div>
            <div class="contact-item">
              <div class="ci-icon"><i class="fas fa-map-marker-alt"></i></div>
              <div>
                <div class="ci-label">Organization</div>
                <div class="ci-value">3PL · Philippines</div>
              </div>
            </div>
          </div>

          <div class="security-notice">
            <i class="fas fa-shield-alt sn-icon"></i>
            <div>
              <div class="sn-title">Security & Privacy</div>
              <div class="sn-desc">Employee data is stored locally in your own MySQL database. No data is shared with third parties. All access is protected by session-based authentication, CSRF tokens, and role-based permission gating. Facial identification runs entirely in-browser — no biometric data is transmitted to external servers.</div>
            </div>
          </div>

        </div>
      </div>
    </div>

  </div><!-- /.page-body -->

  <script src="../js/btn.js"></script>
  <script src="../js/req.js"></script>
  <script src="../js/loading.js"></script>
  <script>
    // ── Pull version string from portal parent frame ──
    (function() {
      const verEl = document.getElementById('about-version');
      if (!verEl) return;
      try {
        const vTag = window.parent?.document?.getElementById('version');
        if (vTag && vTag.textContent.trim()) {
          const raw = vTag.textContent.trim();
          verEl.textContent = raw.replace(/^\s*\S+\s*/, '').trim() || raw;
        }
      } catch (e) {
        /* cross-origin fallback: leave default */
      }
    })();

    // ── Notification count badge ──
    (function() {
      const items = document.querySelectorAll('.notif-item');
      const newItems = document.querySelectorAll('.notif-item.notif-new');
      const badge = document.getElementById('notif-count');
      if (badge && newItems.length) {
        badge.textContent = newItems.length + ' new';
      } else if (badge) {
        badge.style.display = 'none';
      }
    })();
  </script>

</body>

</html>