<?php
// m-i v2.php

require_once '../cnfg/config.php';
require_once '../cnfg/manpower_backend.php';
require_once '../cnfg/db.php';

try {
  // Initialize database and employee manager
  $db = new Database();
  $employeeManager = new EmployeeManager($db);

  // Get employees data
  $employees = $employeeManager->getEmployees();

  // Convert to JSON for JavaScript
  $employeesJson = json_encode($employees);
} catch (Exception $e) {
  // Handle errors gracefully
  error_log("Error loading employees: " . $e->getMessage());
  $employees = [];
  $employeesJson = json_encode([]);
}
?>

<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($myDatabase); ?> - Manual Search</title>
  <link rel="icon" href="../logo/nfc-logo.svg" type="image/svg+xml">
  <link rel="stylesheet" href="../css/m-i.css">
  <link rel="stylesheet" href="../css/btn.css">
  <link rel="stylesheet" href="../css/sbar.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div class="side-bar" style="top: 0;">
    <div onclick="window.history.back();" class="side-btn">
      <div class="s-header">
        <h1>Proximity</h1>
      </div>
      <div class="s-search-section">
        <img src="../icon/nfc-icon.png" alt="NFC Icon">
        <div>
          <h3>Live Search</h3>
          <p>Web pass verifier application</p>
        </div>
      </div>
    </div>
    <div onclick="window.location.href='m-i.php';" class="side-btn">
      <div class="s-header">
        <h1>Manual Entry</h1>
      </div>
      <div class="s-search-section">
        <img src="../logo/manual.png" alt="Manual Entry">
        <div>
          <h3>Employee Entry</h3>
          <p>This area is served for manual entry</p>
        </div>
      </div>
    </div>
    <version_compare style="z-index: 1000;">
      <p id="version"></p>
    </version_compare>
  </div>

  <div class="container">
    <div class="header">
      <h1>Employee Manual Access</h1>
      <div class="stats-bar">
        <div class="stat-item">
          <span class="stat-number" id="totalEmployees">0</span>
          <span class="stat-label">Total Employees</span>
        </div>
        <div class="stat-item">
          <span class="stat-number" id="activeEmployees">0</span>
          <span class="stat-label">Active</span>
        </div>
        <div class="stat-item">
          <span class="stat-number" id="inactiveEmployees">0</span>
          <span class="stat-label">Inactive</span>
        </div>
      </div>
    </div>

    <div class="search-section">
      <form class="search-form" id="searchForm">
        <div class="form-group">
          <input type="text" id="fullname" name="fullname" placeholder="Fullname">
        </div>
        <div class="form-group" style="position: fixed; left: 1%; top: 1%; opacity: 0;">
          <input type="text" id="search_qr" name="qr_code" placeholder="Proximity Code" style="cursor: default;" autocomplete="off">
        </div>
        <img src="../icon/nfc-icon.png" alt="Proximity" style="position: absolute; left: 24px; top: 10%; width: 100px; height: 100px; filter: invert(1);">
      </form>
    </div>

    <div class="results-section">
      <div class="results-header">
        <div class="results-count" id="resultsCount">Enter search criteria to find employees</div>
      </div>

      <div class="employee-grid" id="resultsTable">
        <!-- Default blank state -->
        <div class="no-results" id="defaultState">
          <div class="no-results-icon"><img src="../icon/nfc-icon.png" alt="Proximity Code" style="width: 10%; height: 10%;"></div>
          <h3>Search for Employees</h3>
          <p>Enter a name or proximity code to find employees</p>
        </div>
      </div>
    </div>
  </div>

  <audio id="successSound" src="../sounds/success.mp3" preload="auto"></audio>
  <audio id="noResultSound" src="../sounds/noResultsFound.mp3" preload="auto"></audio>
  <audio id="warningSound" src="../sounds/ohh-ow.mp3" preload="auto"></audio>
  <audio id="inactiveSound" src="../sounds/inactive.mp3" preload="auto"></audio>
  <script src="../src/btn.js"></script>
  <script src="../src/req.js"></script>
  <script src="../src/ver.js"></script>
  <script>
    let employees = <?php echo $employeesJson; ?>;
    let hasSearched = false; // Track if user has performed a search

    let currentAudio = null;

    // Convert date strings to proper format if needed
    employees = employees.map(employee => {
      return {
        ...employee,
        // Ensure all required fields have default values
        violation: employee.violation || '',
        image: employee.image || null,
        // Convert database dates to display format if needed
        created_at: employee.created_at ? employee.created_at.split(' ')[0] : new Date().toISOString().split('T')[0],
        updated_at: employee.updated_at ? employee.updated_at.split(' ')[0] : new Date().toISOString().split('T')[0]
      };
    });

    let filteredEmployees = [];

    function updateStats() {
      const total = employees.length;
      const active = employees.filter(emp => emp.status === 'Active').length;
      const inactive = total - active;

      document.getElementById('totalEmployees').textContent = total;
      document.getElementById('activeEmployees').textContent = active;
      document.getElementById('inactiveEmployees').textContent = inactive;
    }

    function getInitials(name) {
      return name.split(' ').map(n => n[0]).join('').toUpperCase();
    }

    // Function to stop any currently playing audio
    function stopCurrentAudio() {
      if (currentAudio && !currentAudio.paused) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
      currentAudio = null;
    }

    function playSound(id) {
      stopCurrentAudio();
      const sound = document.getElementById(id);
      if (!sound) return;
      currentAudio = sound;
      sound.currentTime = 0;
      sound.play().catch((e) => console.log("Audio play error:", e));
    }

    const playSuccessSound = () => playSound("successSound");
    const playInactiveSound = () => playSound("inactiveSound");
    const playNoResultSound = () => playSound("noResultSound");
    const playWarningSound = () => playSound("warningSound");

    // Add employee to access log
    async function addToLog(employeeId, checkStatus = "IN", triggerElement = null) {
      stopCurrentAudio();
      const button = triggerElement;
      const originalText = button ? button.innerHTML : "";

      try {
        if (button) {
          button.innerHTML = "⏳ Adding...";
          button.disabled = true;
        }

        const employee = employees.find((emp) => emp.id === employeeId);
        if (!employee) throw new Error("Employee not found");

        const hasViolations =
          employee.violation && employee.violation.trim() !== "";
        const hasInactive = employee.status.toLowerCase() === "inactive";

        const logData = {
          employee_id: employee.id,
          fullname: employee.fullname,
          position: employee.position,
          brand: employee.brand,
          status: employee.status,
          shift: employee.shift,
          violation: employee.violation || "",
          image: employee.image || "",
          qr_code: employee.qr_code,
          check_status: checkStatus,
          access_timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
        };

        const response = await fetch("../cnfg/add_to_log.php", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(logData),
        });

        const result = await response.json();

        if (result.success) {
          if (hasViolations) playWarningSound();
          else if (hasInactive) playInactiveSound();
          else playSuccessSound();

          showAlert(`Employee marked as ${checkStatus} successfully!`, "success");
        } else {
          throw new Error(result.message || "Failed to add employee to log");
        }
      } catch (error) {
        console.error("Error adding to log:", error);
        showAlert("Error: " + error.message, "error");
      } finally {
        setTimeout(() => {
          searchEmployees();
          if (button) {
            button.innerHTML = originalText; // ← restored correctly
            button.disabled = false;
          }
        }, 1000);
      }
    }

    // Updated renderEmployees function with separate IN/OUT buttons
    async function renderEmployees(employeeList = filteredEmployees) {
      const resultsTable = document.getElementById('resultsTable');
      const count = document.getElementById('resultsCount');

      // Remove any existing classes
      resultsTable.classList.remove('has-results');

      // If no search has been performed, show default state
      if (!hasSearched) {
        resultsTable.innerHTML = `
      <div class="no-results" id="defaultState">
        <div class="no-results-icon"><img src="../icon/nfc-icon.png" alt="Proximity Code" style="width: 10%; height: 10%;"></div>
        <h3>Search for Employees</h3>
        <p>Enter a name or proximity code to find employees</p>
      </div>
    `;
        count.textContent = 'Enter search criteria to find employees';
        return;
      }

      count.textContent = `Showing ${employeeList.length} employee${employeeList.length !== 1 ? 's' : ''}`;

      if (employeeList.length === 0) {
        resultsTable.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">👥</div>
        <h3>No employees found</h3>
        <p>Try adjusting your search criteria</p>
      </div>
    `;
        return;
      }

      const currentUserId = await getCurrentUserId();

      // Add class when there are results for better browser compatibility
      resultsTable.classList.add('has-results');

      resultsTable.innerHTML = employeeList.map(employee => {
        // Handle employee image display
        let avatarContent;
        if (employee.image && employee.image.trim() !== '') {
          avatarContent = `<img src="../../uploads/user_${currentUserId}/${employee.image}" alt="${employee.fullname}" class="employee-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                      <div class="avatar-fallback" style="display:none;">${getInitials(employee.fullname)}</div>`;
        } else {
          avatarContent = `<div class="avatar-fallback">${getInitials(employee.fullname)}</div>`;
        }

        return `
      <div class="employee-card">
        <div class="qr-code">📱</div>
        <div class="employee-header">
          <div class="employee-avatar">${avatarContent}</div>
          <div class="employee-info">
            <h3>${employee.fullname}</h3>
            <div class="id">ID: ${employee.id}</div>
          </div>
        </div>

        <div class="employee-details">
          <div class="detail-item">
            <span class="detail-label">Position</span>
            <span class="detail-value">${employee.position}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Brand</span>
            <span class="detail-value">${employee.brand}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Shift</span>
            <span class="detail-value">${employee.shift}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Status</span>
            <span class="status-badge status-${employee.status.toLowerCase()}">${employee.status}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">Violation</span>
            <span class="detail-value" style="height: 60px; overflow-y: auto; scrollbar-width: thin; align-content: center;">${employee.violation || 'None'}</span>
          </div>
          <div class="log-buttons" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px;">
            <button class="btn btn-success btn-sm" onclick="addToLog(${employee.id}, 'IN')" title="Check: IN">🟢 IN</button>
            <button class="btn btn-danger btn-sm" onclick="addToLog(${employee.id}, 'OUT')" title="Check: OUT">🔴 OUT</button>
          </div>
        </div>
      </div>
    `;
      }).join('');

      showAlert(`Found ${employeeList.length} employee${employeeList.length !== 1 ? 's' : ''}`, 'success');
    }

    function searchEmployees() {
      const form = document.getElementById('searchForm');
      const formData = new FormData(form);
      const filters = Object.fromEntries(formData.entries());

      // Check if any search criteria is entered
      const hasSearchCriteria = Object.values(filters).some(value => value.trim() !== '');

      if (!hasSearchCriteria) {
        // If no search criteria, reset to default state
        hasSearched = false;
        filteredEmployees = [];
        renderEmployees();
        return;
      }

      // Mark that a search has been performed
      hasSearched = true;

      filteredEmployees = employees.filter(employee => {
        return Object.keys(filters).every(key => {
          const filterValue = filters[key].toLowerCase().trim();
          if (!filterValue) return true;

          const employeeValue = (employee[key] || '').toString().toLowerCase();
          return employeeValue.includes(filterValue);
        });
      });

      renderEmployees(filteredEmployees);

      // ✅ AUTO-CLEAR AFTER SUCCESSFUL SEARCH
      if (hasSearchCriteria) {
        document.getElementById("search_qr").value = "";
      }
    }

    function clearSearch() {
      document.getElementById('searchForm').reset();
      hasSearched = false;
      filteredEmployees = [];
      renderEmployees();
    }

    async function getCurrentUserId() {
      try {
        const response = await fetch("../cnfg/get_user_id.php", {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        if (response.ok) {
          const data = await response.json();
          return data.user_id || "default";
        }
      } catch (error) {
        console.error("Error getting user ID:", error);
      }

      return "default"; // fallback
    }

    function showAlert(message, type = "info") {
      // Remove any existing alerts
      const existingAlerts = document.querySelectorAll(".alert");
      existingAlerts.forEach(alert => alert.remove());

      // Create alert element
      const alert = document.createElement("div");
      alert.className = `alert alert-${type}`;
      alert.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;"><i class="fas fa-times"></i></button>
  `;

      // Add to page
      document.body.insertBefore(alert, document.body.firstChild);

      // Auto remove after 5 seconds
      setTimeout(() => {
        if (alert.parentElement) {
          alert.remove();
        }
      }, 5000);
    }

    // Show/hide loading state
    function showLoading(show) {
      const body = document.body;
      if (show) {
        body.classList.add("loading");
      } else {
        body.classList.remove("loading");
      }
    }

    // Initialize the page
    document.addEventListener('DOMContentLoaded', function() {
      updateStats();
      renderEmployees(); // This will show the default blank state

      // Add real-time search
      const searchInputs = document.querySelectorAll('#searchForm input, #searchForm select');
      searchInputs.forEach((input) => {
        input.addEventListener("input", debounce(searchEmployees, 300));
      });

      // 🔥 AUTO-FOCUS LOGIC
      const codeInput = document.getElementById("search_qr");

      function autoFocus() {
        const active = document.activeElement;

        // Check if active element is NOT an input, select, or textarea
        const isTyping =
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "SELECT" ||
            active.tagName === "TEXTAREA");

        if (!isTyping && codeInput) {
          codeInput.focus();
        }
      }

      // Run on page load
      autoFocus();

      // Re-check when user clicks anywhere
      document.addEventListener("click", autoFocus);

      // Re-check when focus changes (keyboard navigation, tabbing, etc.)
      document.addEventListener("focusin", autoFocus);
    });

    // Debounce function
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }
  </script>
</body>

</html>