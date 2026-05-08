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
  <title>About Us – <?= htmlspecialchars($myDatabase ?? 'Proximity 3PL'); ?></title>
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
      <div class="loading-subtext">Preparing About Us page</div>
    </div>
  </div>

  <div class="page-body">

    <!-- ── Hero banner ── -->
    <div class="about-hero">
      <div class="hero-grid"></div>
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
        <h1>Proximity 3PL System</h1>
        <p>A smart employee proximity management platform built for third-party logistics operations. Track attendance, manage access, and gain real-time insights — all in one place.</p>
        <div class="hero-version">
          <i class="fas fa-tag"></i>
          <span id="about-version">Proximity 3PL — Build 2025</span>
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
                <div class="fi-desc">Tap-to-verify employee identity using proximity codes with real-time web-based detection.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon green"><i class="fas fa-users"></i></div>
              <div>
                <div class="fi-title">Employee Management</div>
                <div class="fi-desc">Add, update, and manage employee records with status tracking and access log history.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon purple"><i class="fas fa-chart-line"></i></div>
              <div>
                <div class="fi-title">Live Dashboard & Analytics</div>
                <div class="fi-desc">Hourly and daily attendance charts, gate scan statistics, and real-time check-in/out counters.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon amber"><i class="fas fa-user-shield"></i></div>
              <div>
                <div class="fi-title">Role-Based Access Control</div>
                <div class="fi-desc">Admin, Supervisor, and User roles with granular menu visibility and portal protection.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon pink"><i class="fas fa-exclamation-triangle"></i></div>
              <div>
                <div class="fi-title">Incident & Violation Logs</div>
                <div class="fi-desc">Record and track workplace incidents with timestamps and responsible party attribution.</div>
              </div>
            </div>

            <div class="feature-item">
              <div class="feature-icon teal"><i class="fas fa-file-export"></i></div>
              <div>
                <div class="fi-title">Data Export</div>
                <div class="fi-desc">Export proximity codes and employee records to Excel for offline reporting and audits.</div>
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
              <div class="tl-desc">Login, portal, employee manager, NFC scanning, and access log dashboard.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Analytics & Charting</div>
              <div class="tl-desc">Hourly and multi-day attendance charts with gate scan doughnut chart.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot green"></div>
              <div class="tl-label">✔ Released</div>
              <div class="tl-title">Role-Based Access & Admin Panel</div>
              <div class="tl-desc">Granular permission system, user management, and portal security layer.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot amber"></div>
              <div class="tl-label">🔄 In Progress</div>
              <div class="tl-title">Enhanced Manual Input v2</div>
              <div class="tl-desc">Redesigned employee input form with bulk import and validation improvements.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot purple"></div>
              <div class="tl-label">📋 Planned</div>
              <div class="tl-title">Notification System</div>
              <div class="tl-desc">Real-time alerts for late check-ins, anomalies, and incident reports.</div>
            </div>

            <div class="tl-item">
              <div class="tl-dot"></div>
              <div class="tl-label">📋 Planned</div>
              <div class="tl-title">Mobile App Integration</div>
              <div class="tl-desc">Native mobile companion app for on-the-go proximity scanning and approvals.</div>
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
          <span class="tech-pill"><i class="fab fa-font-awesome" style="color:#528dd7;"></i> Font Awesome 6</span>
          <span class="tech-pill"><i class="fas fa-box" style="color:#f59e0b;"></i> Composer / Dotenv</span>
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
              <div class="team-avatar" style="background: linear-gradient(135deg, #0d9488, #16a34a);">RD</div>
              <div class="team-name">Renz Dolosa</div>
              <div class="team-role">Backend Developer</div>
            </div>

            <div class="team-card">
              <div class="team-avatar" style="background: linear-gradient(135deg, #d97706, #dc2626);">RD</div>
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
              <div class="sn-desc">This system stores employee data locally in your own database. No data is shared with third parties. All access is protected by session-based authentication and CSRF tokens.</div>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>

  <script src="../js/req.js"></script>
  <script src="../js/loading.js"></script>
  <script>
    const verEl = document.getElementById('about-version');
    if (verEl) {
      const vTag = window.parent?.document?.getElementById('version');
      if (vTag && vTag.textContent.trim()) {
        verEl.textContent = vTag.textContent.trim();
      }
    }
  </script>
  <script src="../js/ver.js"></script>

</body>

</html>