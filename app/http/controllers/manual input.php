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
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> - Manual search</title>
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
          <input type="text" id="search_qr" name="qr_code" placeholder="Proximity Code" style="cursor: default;" autocomplete="off" autofocus inputmode="none" enterkeyhint="done">
        </div>
        <img src="/config/asset.php?t=gnks2" class="proximity-logo" alt="Proximity" loading="lazy">
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
    let UserIdHelper = null;
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

      resultsTable.innerHTML = employeeList
        .map(employee => {
        let avatarContent;
        const safeFullname = escapeHtml(employee.fullname.toUpperCase());
        const safePosition = escapeHtml(employee.position.toUpperCase());
        const safeBrand = escapeHtml(employee.brand.toUpperCase());
        const safeStatus = escapeHtml(employee.status.toUpperCase());
        const safeShift = escapeHtml(employee.shift.toUpperCase());
        const safeViolation = escapeHtml(employee.violation);
        const safeQrCode = escapeHtml(employee.qr_code);
        const safeImage = escapeHtml(employee.image);
        const safeId = escapeHtml(String(employee.id));

        if (safeImage && safeImage.trim() !== '') {
          avatarContent = `<img src="/public/uploads/user/${safeImage}" alt="${safeFullname}" class="employee-image" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                      <div class="avatar-fallback" style="display:none;">${getInitials(safeFullname)}</div>`;
        } else {
          avatarContent = `<div class="avatar-fallback">${getInitials(safeFullname)}</div>`;
        }

        return `
          <div class="employee-card">
            <div class="qr-code" title="Copy Proximity code" style="cursor:pointer;">
              <svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 512 512">
                <path d="M0 0 C1.8671875 1.1328125 1.8671875 1.1328125 3.6875 2.4375 C4.32945312 2.88867188 4.97140625 3.33984375 5.6328125 3.8046875 C12.06627036 8.87576605 16.39227202 15.57014088 20.6875 22.4375 C21.34621094 23.46746094 22.00492187 24.49742187 22.68359375 25.55859375 C51.23747477 74.33574664 50.67378716 139.45530043 36.90576172 192.44628906 C32.19944267 209.92529327 25.88960765 232.01237335 9.6875 242.4375 C2.18206673 245.55178766 -6.35065802 244.93076013 -13.875 241.9375 C-19.14967759 239.24807732 -23.73112419 235.58208816 -28.37744141 231.94384766 C-31.42555165 229.5710442 -34.50536176 227.24019229 -37.58105469 224.90332031 C-40.30508099 222.83314006 -43.02599356 220.75892945 -45.74609375 218.68359375 C-51.09985975 214.5993256 -56.45591129 210.51806505 -61.8125 206.4375 C-63.56251122 205.10418139 -65.3125112 203.77084803 -67.0625 202.4375 C-67.92875 201.7775 -68.795 201.1175 -69.6875 200.4375 C-72.3125 198.4375 -74.9375 196.4375 -77.5625 194.4375 C-78.42907227 193.7772583 -79.29564453 193.1170166 -80.18847656 192.43676758 C-81.9352363 191.10589527 -83.68198114 189.7750034 -85.42871094 188.4440918 C-89.85316371 185.07294264 -94.27788987 181.70215338 -98.703125 178.33203125 C-106.74477361 172.20728725 -114.78445594 166.08006898 -122.8125 159.9375 C-124.89869859 158.34220087 -126.98498216 156.74701295 -129.07128906 155.15185547 C-130.64134924 153.95087915 -132.21097407 152.74933357 -133.78027344 151.54736328 C-139.06420007 147.50114011 -144.35941498 143.47036492 -149.66503906 139.45263672 C-152.30619108 137.44230209 -154.93073125 135.41161082 -157.5546875 133.37890625 C-159.22341526 132.10605854 -160.89266422 130.83389376 -162.5625 129.5625 C-163.31192871 128.973479 -164.06135742 128.38445801 -164.83349609 127.77758789 C-169.81057833 124.0261219 -174.12716029 122.26475737 -180.3125 121.4375 C-183.02071018 131.93181446 -180.27502005 142.64420844 -178.4375 153.0625 C-169.81571431 202.54806425 -169.81571431 202.54806425 -179.3125 216.4375 C-183.81158383 221.30840894 -188.4569437 223.48711211 -195 223.875 C-202.53024915 223.69570835 -208.61065492 220.30643654 -214.0625 215.25 C-235.32229346 192.09379304 -236.87144312 154.02810893 -236.64868164 124.47436523 C-236.62489127 121.10962175 -236.62817992 117.74566707 -236.63476562 114.38085938 C-236.61485561 98.21599681 -235.96840475 82.30978699 -232 66.5625 C-231.7827124 65.68174805 -231.5654248 64.80099609 -231.34155273 63.89355469 C-228.32415574 52.08493076 -224.01327523 38.4774837 -213.3125 31.4375 C-207.94979312 28.26702055 -202.32020821 28.27153031 -196.3125 29.4375 C-192.09096398 31.83748382 -188.60139581 34.76885808 -184.98046875 37.98339844 C-182.20688021 40.40135706 -179.28405319 42.62373022 -176.375 44.875 C-175.19827495 45.79958133 -174.02249634 46.72536844 -172.84765625 47.65234375 C-169.33864683 50.41751679 -165.82593816 53.17795747 -162.3125 55.9375 C-158.85820963 58.65086594 -155.40433949 61.36475356 -151.953125 64.08203125 C-145.42264114 69.22176392 -138.87500641 74.33870342 -132.3125 79.4375 C-125.18920722 84.97200443 -118.08553308 90.5305816 -110.99804688 96.11083984 C-108.10441177 98.38836203 -105.20833448 100.66277541 -102.3125 102.9375 C-98.85822649 105.65088743 -95.40433952 108.36475354 -91.953125 111.08203125 C-85.42264114 116.22176392 -78.87500641 121.33870342 -72.3125 126.4375 C-66.88571801 130.65388559 -61.46481919 134.87730466 -56.0625 139.125 C-55.50264404 139.56497314 -54.94278809 140.00494629 -54.3659668 140.45825195 C-51.48061532 142.72725785 -48.59952425 145.00149711 -45.72265625 147.28125 C-40.27313516 151.59474817 -34.80485176 155.88519191 -29.25 160.0625 C-28.41339844 160.69414062 -27.57679688 161.32578125 -26.71484375 161.9765625 C-24.19631168 163.50815761 -22.21601235 164.0545055 -19.3125 164.4375 C-9.10480357 144.85115863 -9.46577344 119.72535392 -13.3125 98.4375 C-13.44188965 97.72094238 -13.5712793 97.00438477 -13.70458984 96.26611328 C-16.41204935 82.09248627 -21.16605208 68.59405778 -26.03466797 55.04760742 C-36.42156063 25.92954697 -36.42156063 25.92954697 -31.3125 11.4375 C-28.62882779 5.94656542 -25.48071594 1.42886825 -19.71484375 -0.97265625 C-13.28256384 -2.551964 -6.11637655 -2.78675144 0 0 Z " transform="translate(236.3125,130.5625)"/>
                <path d="M0 0 C7.26898446 5.49051451 11.12104728 13.12410054 14.86499023 21.22119141 C15.38407959 22.3255957 15.90316895 23.43 16.43798828 24.56787109 C20.45869356 33.24832584 24.00310046 42.01248934 27.07055664 51.07080078 C27.89188276 53.48783179 28.74235191 55.89333608 29.59545898 58.29931641 C40.66219268 89.95873469 47.45564462 123.20833432 51.86499023 156.40869141 C52.01597168 157.46862305 52.16695313 158.52855469 52.32250977 159.62060547 C57.62579224 197.87060185 57.53667483 239.22115111 51.86499023 277.40869141 C51.75328491 278.17000366 51.64157959 278.93131592 51.52648926 279.71569824 C44.84488014 324.89943161 34.52877403 370.10531454 15.23999023 411.72119141 C14.71791992 412.85935303 14.71791992 412.85935303 14.18530273 414.02050781 C10.73888282 421.22680468 6.8187842 427.9459778 -0.38500977 431.84619141 C-1.23579102 432.31927734 -2.08657227 432.79236328 -2.96313477 433.27978516 C-9.56903839 436.7134293 -17.95627341 436.58533559 -25.10375977 434.57275391 C-34.22746272 430.37697693 -39.07560744 423.70052165 -42.60375977 414.51025391 C-44.26729381 404.79815073 -40.52962578 396.01127593 -37.19750977 387.03369141 C-36.69985116 385.66426811 -36.20345328 384.29438606 -35.70825195 382.92407227 C-34.44084721 379.42358825 -33.16170697 375.92754294 -31.87823486 372.43292236 C-4.95643159 299.10931181 6.14218564 223.84268686 -7.13500977 146.40869141 C-7.33046387 145.26513184 -7.52591797 144.12157227 -7.72729492 142.94335938 C-12.97285106 113.28242678 -22.1294479 84.52830799 -32.95629883 56.46923828 C-34.90837902 51.40062245 -36.81137668 46.3146536 -38.69750977 41.22119141 C-39.03226318 40.34213135 -39.3670166 39.46307129 -39.71191406 38.55737305 C-42.8745721 30.01394836 -44.20515601 22.22660004 -41.13500977 13.40869141 C-37.00136999 6.07564003 -30.98784591 0.31936144 -22.82641602 -2.08349609 C-15.41735805 -3.48143156 -6.60210421 -4.24441332 0 0 Z " transform="translate(457.135009765625,39.59130859375)"/>
                <path d="M0 0 C7.7953733 6.55087912 11.53280265 15.42090184 15.76171875 24.48046875 C16.21248779 25.42623779 16.21248779 25.42623779 16.67236328 26.39111328 C32.79347085 60.37055554 41.01469222 99.12019718 43.76171875 136.48046875 C43.84784424 137.63232666 43.93396973 138.78418457 44.02270508 139.97094727 C44.70961576 149.9186128 44.96372734 159.82288009 44.94921875 169.79296875 C44.9486145 170.57115967 44.94801025 171.34935059 44.9473877 172.15112305 C44.86205494 213.03175637 39.27908005 253.78261823 25.76171875 292.48046875 C25.54225586 293.12983398 25.32279297 293.77919922 25.09667969 294.44824219 C22.06669035 303.37564745 18.30612776 311.93862076 14.32421875 320.48046875 C13.66063354 321.93211426 13.66063354 321.93211426 12.98364258 323.41308594 C8.16614773 333.51922856 2.51180624 340.64351445 -8.23828125 344.48046875 C-15.51757393 346.36861293 -22.88142079 345.56051826 -29.66015625 342.32421875 C-36.6807156 338.08361243 -40.72768524 332.46294914 -43.61328125 324.85546875 C-44.82485584 318.31296596 -44.11503764 313.00984918 -41.92578125 306.79296875 C-41.66651855 306.03169678 -41.40725586 305.2704248 -41.14013672 304.48608398 C-39.03740869 298.44503522 -36.674312 292.51824245 -34.28662109 286.58520508 C-25.49835099 264.71401966 -18.71381467 242.82167184 -15.23828125 219.48046875 C-15.12790527 218.75907715 -15.0175293 218.03768555 -14.90380859 217.29443359 C-12.61763113 202.16245899 -11.99860109 187.1316376 -11.98828125 171.85546875 C-11.98760651 170.9523999 -11.98693176 170.04933105 -11.98623657 169.11889648 C-12.004413 153.72566925 -12.76618222 138.70236989 -15.23828125 123.48046875 C-15.40457031 122.45179688 -15.57085937 121.423125 -15.7421875 120.36328125 C-20.15914921 94.12325688 -28.74989237 69.44819755 -38.22216797 44.68334961 C-38.54515366 43.83860077 -38.86813934 42.99385193 -39.20091248 42.12350464 C-39.81211422 40.52893154 -40.42580218 38.93530844 -41.04237366 37.34280396 C-44.73911997 27.728458 -45.20499335 20.16167797 -41.23828125 10.48046875 C-37.39094926 2.85330181 -31.0596262 -0.57634285 -23.23828125 -3.51953125 C-15.04641976 -5.32005608 -6.94554092 -5.02952963 0 0 Z " transform="translate(358.23828125,85.51953125)"/>
              </svg>
            </div>
            <div class="employee-header">
              <div class="employee-avatar">${avatarContent}</div>
              <div class="employee-info">
                <h3>${safeFullname}</h3>
                <div class="id"><strong>EMPID: ${safeId}</strong></div>
              </div>
            </div>

            <div class="employee-details">
              <div class="detail-item">
                <span class="detail-label">Position</span>
                <span class="detail-value">${safePosition}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Brand</span>
                <span class="detail-value">${safeBrand}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Shift</span>
                <span class="detail-value">${safeShift}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Status</span>
                <span class="status-badge status-${safeStatus.toLowerCase()}">${safeStatus}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Remarks</span> <!-- Violation -->
                <span class="detail-value" style="height: 60px; overflow-y: auto; scrollbar-width: thin; align-content: center;">${safeViolation || 'None'}</span>
              </div>
              <div class="log-buttons" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 10px;">
                <button class="btn btn-success btn-sm" onclick="addToLog(${safeId}, 'IN', this)" title="Check: IN">🟢\nIN</button>
                <button class="btn btn-danger btn-sm" onclick="addToLog(${safeId}, 'OUT', this)" title="Check: OUT">🔴\nOUT</button>
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
      if (!UserIdHelper) return "default";

      try {
        const response = await fetch(`${UserIdHelper}`, {
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

    // ── Utils ─────────────────────────────────────────────────────────────
    function escapeHtml(str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function toProperCase(str) {
      if (!str) return "";
      const spaced = String(str).replace(/([a-z])([A-Z])/g, "$1 $2");
      return spaced.replace(/[^\s,\-]+/g, function(txt) {
        return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
      });
    }

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

    function showAlert(message, type = "info") {
      const existingAlerts = document.querySelectorAll(".alert");
      existingAlerts.forEach((alert) => alert.remove());

      const alert = document.createElement("div");
      alert.className = `alert alert-${type}`;

      const msgSpan = document.createElement("span");
      msgSpan.textContent = message;

      const closeBtn = document.createElement("button");
      closeBtn.style.cssText =
        "float: right; background: none; border: none; font-size: 18px; cursor: pointer; margin-left: 5px;";
      closeBtn.innerHTML = `<i class="fas fa-times"></i>`;
      closeBtn.onclick = () => alert.remove();

      alert.appendChild(msgSpan);
      alert.appendChild(closeBtn);

      document.body.insertBefore(alert, document.body.firstChild);

      setTimeout(() => {
        if (alert.parentElement) alert.remove();
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
  </script>
</body>

</html>