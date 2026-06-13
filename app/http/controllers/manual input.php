<?php
// app/http/controller/manual input.php --> manual employee input in/out

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

$permissions = getUserGroupPermissions();
if (!canAccess($permissions, 'qr proximity') && !canAccess($permissions, 'manual input') && !canAccess($permissions, 'facial')) {
  echo '<!DOCTYPE html><html><body><script>
        if (window.top !== window.self) {
            window.top.history.back();
        } else {
            window.history.back();
        }
    </script></body></html>';
  exit;
}

requireAccess('manual input', ROUTE_QR_PROX);
$access = getMenuAccess();

$userId = $_SESSION['user_id'] ?? null;

try {
  if (!$userId) throw new Exception("Not logged in");

  $userDb = getUserDBConnection($userId);

  $stmt = $userDb->prepare("SELECT * FROM employees ORDER BY fullname ASC");
  $stmt->execute();
  $employees = $stmt->fetchAll(PDO::FETCH_ASSOC);

  $employeesJson = json_encode($employees);
} catch (Exception $e) {
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
  <link rel="icon" href="/config/asset.php?t=cfk4d" type="image/svg+xml">
  <link rel="stylesheet" href="/config/asset.php?t=k95g3">
  <link rel="stylesheet" href="/config/asset.php?t=c24hj">
  <link rel="stylesheet" href="/config/asset.php?t=ht5sf">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
</head>

<body>

  <div class="side-bar" style="top: 0;">
    <?php if ($access['qr proximity']): ?>
      <div data-action-dir="prox-proximity" class="side-btn">
        <div class="s-header">
          <h1>Proximity</h1>
        </div>
        <div class="s-search-section">
          <img src="/config/asset.php?t=gnks2" alt="NFC Icon" loading="lazy">
          <div>
            <h3>Live Search</h3>
            <p>Web pass verifier application</p>
          </div>
        </div>
      </div>
    <?php endif; ?>

    <?php if ($access['manual input']): ?>
      <div data-action-dir="prox-manual" class="side-btn">
        <div class="s-header">
          <h1>Manual Entry</h1>
        </div>
        <div class="s-search-section">
          <img src="/config/asset.php?t=t43us" alt="Manual Entry" loading="lazy">
          <div>
            <h3>Employee Entry</h3>
            <p>This area is served for manual entry</p>
          </div>
        </div>
      </div>
    <?php endif; ?>

    <version_compare>
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
        <div class="form-group" style="position: relative;">
          <input type="text" id="search_fullname" name="fullname"
            placeholder="Fullname" autocomplete="off"
            oninput="showFullnameSuggestions(this.value)"
            onkeydown="handleSuggestionNav(event)"
            onfocus="showFullnameSuggestions(this.value)">
          <ul id="fullname-suggestions" style="
              display: none;
              position: absolute;
              top: 100%;
              left: 0;
              right: 0;
              z-index: 9999;
              background: #fff;
              border: 1px solid #cbd5e1;
              border-top: none;
              border-radius: 0 0 8px 8px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.1);
              list-style: none;
              margin: 0;
              padding: 0;
              max-height: 220px;
              overflow-y: auto;
            "></ul>
        </div>
        <div class="form-group" style="position: fixed; left: 1%; top: 1%; opacity: 0;">
          <input type="text" id="search_qr" name="qr_code" placeholder="Proximity Code" style="cursor: default;" autocomplete="off">
        </div>
        <img src="/config/asset.php?t=gnks2" alt="Proximity" loading="lazy" style="position: absolute; left: 24px; top: 10%; width: 100px; height: 100px; filter: invert(1);">
      </form>
    </div>

    <div class="results-section">
      <div class="results-header">
        <div class="results-count" id="resultsCount">Enter search criteria to find employees</div>
      </div>

      <div class="employee-grid" id="resultsTable">
        <div class="no-results" id="defaultState">
          <div class="no-results-icon"><img src="/config/asset.php?t=gnks2" alt="Proximity Code" loading="lazy" style="width: 10%; height: 10%;"></div>
          <h3>Search for Employees</h3>
          <p>Enter a name or proximity code to find employees</p>
        </div>
      </div>
    </div>
  </div>

  <audio id="successSound" data-fallback="/config/asset.php?t=ero67" preload="none"></audio>
  <audio id="checkoutSound" data-fallback="/config/asset.php?t=jg5df" preload="none"></audio>
  <audio id="noResultSound" data-fallback="/config/asset.php?t=sdh3f" preload="none"></audio>
  <audio id="warningSound" data-fallback="/config/asset.php?t=l45wd" preload="none"></audio>
  <audio id="inactiveSound" data-fallback="/config/asset.php?t=ert26" preload="none"></audio>

  <script src="/config/route-config.php?page=proximity"></script>
  <script src="/config/route-config.php?page=endpoint"></script>
  <script src="/config/asset.php?t=p1q2r"></script>
  <script src="/config/asset.php?t=m6efw"></script>
  <script src="/config/asset.php?t=j7k8l"></script>
  <script src="/config/asset.php?t=m9n0o"></script>
  <script>
    let GlobalAudioBackend = null;

    let employees = <?php echo $employeesJson; ?>;
    let hasSearched = false;

    let currentAudio = null;

    // ── Global-audio endpoint ─────────────────────────────────────────
    const AUDIO_TYPE_MAP = {
      success: "successSound",
      checkout: "checkoutSound",
      not_found: "noResultSound",
      violations: "warningSound",
      inactive: "inactiveSound",
    };

    // ─────────────────────────────────────────────────────────────────
    //  Load global audio from DB; fall back to bundled files if absent
    // ─────────────────────────────────────────────────────────────────
    async function loadGlobalAudio() {
      try {
        const res = await fetch(`${GlobalAudioBackend}`, {
          credentials: "same-origin",
          headers: {
            "X-Requested-With": "XMLHttpRequest"
          },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (!json.success) throw new Error("Server returned success:false");

        Object.entries(AUDIO_TYPE_MAP).forEach(([audioType, elementId]) => {
          const el = document.getElementById(elementId);
          if (!el) return;

          const entry = json.audio?.[audioType];

          if (entry?.data && entry.data.length > 0) {
            el.src = entry.data;
            el.preload = "auto";
          } else {
            const fallback = el.dataset.fallback;
            if (fallback) {
              el.src = fallback;
              el.preload = "auto";
            }
          }
        });

      } catch (e) {
        console.warn("Could not load global audio; using bundled fallbacks.", e);

        Object.values(AUDIO_TYPE_MAP).forEach((elementId) => {
          const el = document.getElementById(elementId);
          if (el && !el.src && el.dataset.fallback) {
            el.src = el.dataset.fallback;
            el.preload = "auto";
          }
        });
      }
    }

    function setupEventListeners() {
      const searchInputs = document.querySelectorAll('#searchForm input, #searchForm select');
      searchInputs.forEach((input) => {
        input.addEventListener("input", debounce(searchEmployees, 300));
      });

      const codeInput = document.getElementById("search_qr");

      function autoFocus() {
        const active = document.activeElement;

        const isTyping =
          active &&
          (active.tagName === "INPUT" ||
            active.tagName === "SELECT" ||
            active.tagName === "TEXTAREA");

        if (!isTyping && codeInput) {
          codeInput.focus();
        }
      }

      autoFocus();

      document.addEventListener("click", autoFocus);

      document.addEventListener("focusin", autoFocus);
    };

    employees = employees.map(employee => {
      return {
        ...employee,
        violation: employee.violation || '',
        image: employee.image || null,
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
    const playCheckoutSound = () => playSound("checkoutSound");
    const playInactiveSound = () => playSound("inactiveSound");
    const playNoResultSound = () => playSound("noResultSound");
    const playWarningSound = () => playSound("warningSound");

    // ── Add employee to access log ────────────────────────────────────────────────
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

        const hasViolations = employee.violation && employee.violation.trim() !== "";
        const hasInactive = employee.status.toLowerCase() === "inactive";
        const hasCheckedOut = checkStatus === "OUT";

        if (hasInactive) {
          playInactiveSound();
          showAlert("Access denied. Employee is inactive.", "error");
          return;
        }

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
          access_timestamp: new Date().toLocaleString("sv-SE", {
            timeZone: "Asia/Manila"
          }),
        };

        const response = await fetch("../middleware/add_to_log.php", {
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
          else if (hasCheckedOut) playCheckoutSound();
          else playSuccessSound();

          showAlert(`Employee marked as ${checkStatus} successfully!`, "success");
        } else {
          throw new Error(result.message || "Failed to add employee to log");
        }
      } catch (error) {
        showAlert("Error: " + error.message, "error");
      } finally {
        setTimeout(() => {
          searchEmployees();
          if (button) {
            button.innerHTML = originalText;
            button.disabled = false;
          }
        }, 1000);
        clearSearch();
      }
    }

    async function renderEmployees(employeeList = filteredEmployees) {
      const resultsTable = document.getElementById('resultsTable');
      const count = document.getElementById('resultsCount');

      resultsTable.classList.remove('has-results');

      if (!hasSearched) {
        resultsTable.innerHTML = `
      <div class="no-results" id="defaultState">
        <div class="no-results-icon"><img src="/config/asset.php?t=gnks2" alt="Proximity Code" loading="lazy" style="width: 10%; height: 10%;"></div>
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

      resultsTable.classList.add('has-results');

      resultsTable.innerHTML = employeeList.map(employee => {
        let avatarContent;
        if (employee.image && employee.image.trim() !== '') {
          avatarContent = `<img src="../../../public/uploads/user/${employee.image}" alt="${employee.fullname}" class="employee-image" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
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
            <span class="detail-label">Remarks</span> <!-- Violation -->
            <span class="detail-value" style="height: 60px; overflow-y: auto; scrollbar-width: thin; align-content: center;">${employee.violation || 'None'}</span>
          </div>
          <div class="log-buttons" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px;">
            <button class="btn btn-success btn-sm" onclick="addToLog(${employee.id}, 'IN', this)" title="Check: IN">🟢\nIN</button>
            <button class="btn btn-danger btn-sm" onclick="addToLog(${employee.id}, 'OUT', this)" title="Check: OUT">🔴\nOUT</button>
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

      const hasSearchCriteria = Object.values(filters).some(value => value.trim() !== '');

      if (!hasSearchCriteria) {
        hasSearched = false;
        filteredEmployees = [];
        renderEmployees();
        return;
      }

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
        const response = await fetch("../../helper/get_user_id.php", {
          headers: {
            "X-Requested-With": "XMLHttpRequest",
          },
        });

        if (response.ok) {
          const data = await response.json();
          return data.user_id || "default";
        }
      } catch (error) {}

      return "default";
    }

    // ── Fullname Autocomplete ────────────────────────────────────────────────────
    let suggestionIndex = -1;

    function showFullnameSuggestions(query) {
      const list = document.getElementById("fullname-suggestions");
      if (!list) return;

      const q = query.trim().toLowerCase();

      const matches = [
        ...new Map(
          employees
          .filter((emp) => !q || emp.fullname.toLowerCase().includes(q))
          .map((emp) => [emp.fullname.toLowerCase(), emp.fullname]),
        ).values(),
      ].slice(0, 10);

      if (!matches.length || !q) {
        list.style.display = "none";
        suggestionIndex = -1;
        return;
      }

      list.innerHTML = matches
        .map((name, i) => {
          const regex = new RegExp(
            `(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
          );
          const highlighted = name.replace(
            regex,
            '<mark style="background:#fef08a;border-radius:2px;">$1</mark>',
          );
          return `
      <li data-value="${name}" data-index="${i}"
          onmousedown="selectSuggestion('${name.replace(/'/g, "\\'")}')"
          onmouseover="highlightSuggestion(${i})"
          style="padding: 8px 12px; cursor: pointer; font-size: 13px; border-bottom: 1px solid #f1f5f9;">
        ${highlighted}
      </li>`;
        })
        .join("");

      list.style.display = "block";
      suggestionIndex = -1;
    }

    function selectSuggestion(name) {
      const input = document.getElementById("search_fullname");
      const list = document.getElementById("fullname-suggestions");
      if (input) input.value = name;
      if (list) list.style.display = "none";
      suggestionIndex = -1;
      searchEmployees();
    }

    function highlightSuggestion(index) {
      const items = document.querySelectorAll("#fullname-suggestions li");
      items.forEach((li, i) => {
        li.style.background = i === index ? "#f0f9ff" : "";
      });
      suggestionIndex = index;
    }

    function handleSuggestionNav(e) {
      const list = document.getElementById("fullname-suggestions");
      const items = list ? list.querySelectorAll("li") : [];
      if (!items.length || list.style.display === "none") return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        suggestionIndex = Math.min(suggestionIndex + 1, items.length - 1);
        highlightSuggestion(suggestionIndex);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        suggestionIndex = Math.max(suggestionIndex - 1, 0);
        highlightSuggestion(suggestionIndex);
      } else if (e.key === "Enter" && suggestionIndex >= 0) {
        e.preventDefault();
        selectSuggestion(items[suggestionIndex].dataset.value);
      } else if (e.key === "Escape") {
        list.style.display = "none";
        suggestionIndex = -1;
      }
    }

    document.addEventListener("click", function(e) {
      const list = document.getElementById("fullname-suggestions");
      const input = document.getElementById("search_fullname");
      if (list && input && !input.contains(e.target) && !list.contains(e.target)) {
        list.style.display = "none";
        suggestionIndex = -1;
      }
    });

    function showAlert(message, type = "info") {
      const existingAlerts = document.querySelectorAll(".alert");
      existingAlerts.forEach(alert => alert.remove());

      const alert = document.createElement("div");
      alert.className = `alert alert-${type}`;
      alert.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()" style="float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;"><i class="fas fa-times"></i></button>
  `;

      document.body.insertBefore(alert, document.body.firstChild);

      setTimeout(() => {
        if (alert.parentElement) {
          alert.remove();
        }
      }, 5000);
    }

    function showLoading(show) {
      const body = document.body;
      if (show) {
        body.classList.add("loading");
      } else {
        body.classList.remove("loading");
      }
    }

    document.addEventListener('DOMContentLoaded', async function() {
      const ready = await resolveEndpoints();
      if (!ready) return;

      loadGlobalAudio();
      updateStats();
      setupEventListeners();
      renderEmployees();
    });

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