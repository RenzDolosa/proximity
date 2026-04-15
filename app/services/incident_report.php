<?php
require_once __DIR__ . '/../../config/config.php';

if (!isLoggedIn()) {
  if (isset($_SERVER['HTTP_X_REQUESTED_WITH'])) {
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'message' => 'Unauthorized']);
    exit;
  }
}

function ensureCompanySettingsTable($pdo)
{
  $pdo->exec("CREATE TABLE IF NOT EXISTS company_settings_global (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT '',
        company_logo MEDIUMTEXT DEFAULT '',
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

$isAjax = isset($_SERVER['HTTP_X_REQUESTED_WITH']) &&
  strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest';

// ── AJAX GET ──────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $isAjax) {
  header('Content-Type: application/json');
  header('Cache-Control: no-store, no-cache, must-revalidate');
  header('Pragma: no-cache');

  $pdo = getDBConnection();
  ensureCompanySettingsTable($pdo);

  $row = $pdo->query("SELECT company_name, company_logo FROM company_settings_global LIMIT 1")->fetch(PDO::FETCH_ASSOC);

  echo json_encode([
    'success' => true,
    'name'    => $row['company_name'] ?? '',
    'logo'    => $row['company_logo'] ?? '',
  ]);
  exit;
}

// ── AJAX POST ─────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isAjax) {
  header('Content-Type: application/json');

  $body = json_decode(file_get_contents('php://input'), true);
  $name = trim($body['name'] ?? '');
  $logo = $body['logo'] ?? '';

  if (strlen($logo) > 500000) {
    echo json_encode(['success' => false, 'message' => 'Logo too large']);
    exit;
  }

  $pdo = getDBConnection();
  ensureCompanySettingsTable($pdo);

  // Always keep only one global row
  $count = $pdo->query("SELECT COUNT(*) FROM company_settings_global")->fetchColumn();
  if ($count > 0) {
    $stmt = $pdo->prepare("UPDATE company_settings_global SET company_name = ?, company_logo = ?");
    $stmt->execute([$name, $logo]);
  } else {
    $stmt = $pdo->prepare("INSERT INTO company_settings_global (company_name, company_logo) VALUES (?, ?)");
    $stmt->execute([$name, $logo]);
  }

  echo json_encode(['success' => true]);
  exit;
}
// ── Normal page load — fall through to HTML below ────────────
?>

<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Times New Roman', serif;
    background: #f4f4f4;
    padding: 20px;
  }

  #toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 16px;
    background: #fff;
    border: 0.5px solid #ddd;
    border-radius: 8px;
    margin-bottom: 14px;
    flex-wrap: wrap;
    max-width: 760px;
    margin-left: auto;
    margin-right: auto;
  }

  .tb-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    font-size: 12px;
    font-family: sans-serif;
    font-weight: 500;
    border: 0.5px solid #ccc;
    border-radius: 6px;
    background: #fff;
    color: #1e293b;
    cursor: pointer;
    white-space: nowrap;
  }

  .tb-btn:hover {
    background: #f1f5f9;
  }

  .tb-btn.primary {
    background: #1a4fa0;
    color: #fff;
    border-color: #1a4fa0;
  }

  .tb-btn.primary:hover {
    background: #153e80;
  }

  .tb-sep {
    width: 0.5px;
    height: 22px;
    background: #ddd;
    margin: 0 2px;
  }

  #report-canvas {
    background: #fff;
    color: #000;
    border: 0.5px solid #ccc;
    border-radius: 8px;
    padding: 36px 40px;
    max-width: 760px;
    margin: 0 auto;
    font-family: 'Times New Roman', serif;
    font-size: 13px;
    line-height: 1.5;
  }

  .rpt-header {
    text-align: center;
    margin-bottom: 4px;
  }

  .company-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 6px;
  }

  #logo-preview {
    max-height: 52px;
    max-width: 120px;
    object-fit: contain;
    display: none;
  }

  .company-name-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  #company-name-input {
    font-size: 13px;
    letter-spacing: 2px;
    color: #555;
    border: none;
    border-bottom: 1px dashed #bbb;
    background: transparent;
    outline: none;
    text-align: center;
    font-family: 'Times New Roman', serif;
    min-width: 180px;
  }

  #company-name-input:focus {
    background: #fffde7;
    border-bottom-color: #1a4fa0;
  }

  .logo-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-size: 11px;
    font-family: sans-serif;
    border: 0.5px solid #bbb;
    border-radius: 4px;
    background: #f8f9fa;
    color: #555;
    cursor: pointer;
  }

  .logo-upload-btn:hover {
    background: #e9ecef;
  }

  #logo-file-input {
    display: none;
  }

  #logo-clear-btn {
    font-size: 11px;
    font-family: sans-serif;
    border: none;
    background: none;
    color: #e53e3e;
    cursor: pointer;
    padding: 0 2px;
    display: none;
  }

  .rpt-title {
    font-size: 13px;
    font-weight: bold;
    letter-spacing: 3px;
    border-top: 2px solid #000;
    border-bottom: 2px solid #000;
    padding: 4px 0;
    text-align: center;
    margin: 8px 0;
  }

  .rpt-row {
    display: flex;
    gap: 16px;
    margin-bottom: 10px;
    align-items: flex-end;
  }

  .rpt-field {
    flex: 1;
  }

  .rpt-field.shrink {
    flex: 0 0 auto;
    min-width: 160px;
  }

  .rpt-label {
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #333;
    margin-bottom: 2px;
  }

  .rpt-input {
    width: 100%;
    border: none;
    border-bottom: 1px solid #000;
    background: transparent;
    font-family: 'Times New Roman', serif;
    font-size: 13px;
    color: #000;
    padding: 2px 4px;
    outline: none;
  }

  .rpt-input:focus {
    background: #fffde7;
    border-bottom-color: #1a4fa0;
  }

  .rpt-input.auto-filled {
    background: #f0f9ff;
  }

  .section-title {
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 2px;
    text-transform: uppercase;
    background: #e8e8e8;
    padding: 3px 8px;
    margin: 14px 0 8px;
    border: 0.5px solid #bbb;
  }

  .rpt-textarea {
    width: 100%;
    border: 1px solid #000;
    background: transparent;
    font-family: 'Times New Roman', serif;
    font-size: 13px;
    color: #000;
    padding: 6px 8px;
    outline: none;
    resize: vertical;
    min-height: 60px;
  }

  .rpt-textarea:focus {
    background: #fffde7;
    border-color: #1a4fa0;
  }

  .rpt-textarea.auto-filled {
    background: #f0f9ff;
  }

  .checklist {
    border: 1px solid #000;
    padding: 10px 12px;
  }

  .check-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 12px;
  }

  .check-item input[type=checkbox] {
    margin-top: 2px;
    cursor: pointer;
  }

  .check-item .check-label {
    flex: 1;
  }

  .check-item .check-inline {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }

  .check-item .check-inline input[type=text] {
    flex: 1;
    min-width: 60px;
    border: none;
    border-bottom: 1px solid #000;
    background: transparent;
    font-family: 'Times New Roman', serif;
    font-size: 12px;
    color: #000;
    padding: 1px 2px;
    outline: none;
  }

  .check-item .check-inline input[type=text]:focus {
    background: #fffde7;
  }

  .sig-row {
    display: flex;
    gap: 20px;
    margin-top: 20px;
  }

  .sig-block {
    flex: 1;
  }

  .sig-line {
    border-bottom: 1px solid #000;
    min-height: 36px;
    padding: 2px 4px;
    display: flex;
    align-items: flex-end;
  }

  .sig-field {
    width: 100%;
    border: none;
    background: transparent;
    font-family: 'Times New Roman', serif;
    font-size: 13px;
    color: #000;
    outline: none;
  }

  .sig-field:focus {
    background: #fffde7;
  }

  .attach-section {
    margin-top: 14px;
    border: 1px dashed #999;
    padding: 10px 12px;
    background: #fafafa;
  }

  .attach-label {
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 1px;
    color: #555;
    margin-bottom: 6px;
    text-transform: uppercase;
    font-family: sans-serif;
  }

  .attach-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .attach-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: #fff;
    border: 0.5px solid #bbb;
    border-radius: 4px;
    font-size: 11px;
    color: #1a4fa0;
    cursor: pointer;
    font-family: sans-serif;
  }

  .attach-item:hover {
    background: #e8f0fe;
  }

  .attach-item .rm-btn {
    color: #999;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    border: none;
    background: none;
    padding: 0;
    font-family: sans-serif;
  }

  .attach-item .rm-btn:hover {
    color: #c00;
  }

  .no-attach {
    font-size: 11px;
    color: #999;
    font-style: italic;
    font-family: sans-serif;
  }

  .autofill-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-family: sans-serif;
    color: #0369a1;
    background: #e0f2fe;
    border-radius: 4px;
    padding: 1px 6px;
    margin-left: 6px;
    vertical-align: middle;
  }

  @media print {
    body {
      background: #fff;
      padding: 0;
    }

    #toolbar {
      display: none !important;
    }

    .attach-section {
      display: none !important;
    }

    .logo-upload-btn {
      display: none !important;
    }

    #logo-clear-btn {
      display: none !important;
    }

    #company-name-input {
      border-bottom: none !important;
      background: transparent !important;
    }

    #report-canvas {
      border: none !important;
      padding: 0 !important;
      max-width: 100% !important;
      box-shadow: none !important;
      border-radius: 0 !important;
    }

    .rpt-input,
    .rpt-textarea,
    .sig-field {
      border-color: #000 !important;
      background: transparent !important;
    }

    .rpt-input.auto-filled,
    .rpt-textarea.auto-filled {
      background: transparent !important;
    }

    .rpt-title {
      border-color: #000 !important;
    }

    .section-title {
      background: #e8e8e8 !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .autofill-badge {
      display: none !important;
    }

    input::placeholder,
    textarea::placeholder {
      color: transparent !important;
    }

    input[value=""],
    .rpt-input:placeholder-shown {
      border-bottom-color: #ccc !important;
    }
  }
</style>

<div id="toolbar">
  <button class="tb-btn primary" onclick="window.print()">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 1a1 1 0 0 0-1 1v1H3a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1v1a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1h1a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V2a1 1 0 0 0-1-1H5zm0 2h6V2H5v1zm6 9H5v-2h6v2zM3 5h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1V9H4v2H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    </svg>
    Print / Save PDF
  </button>
  <div class="tb-sep"></div>
  <button class="tb-btn" onclick="clearForm()">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5zm3 .5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 1 0z" />
    </svg>
    Clear Form
  </button>
  <div class="tb-sep"></div>
  <label class="tb-btn" for="attach-file-input" style="cursor:pointer;">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z" />
    </svg>
    Attach File
  </label>
  <input type="file" id="attach-file-input" multiple accept="image/*,.pdf,.doc,.docx" onchange="addAttachments(this)">
  <span style="font-size:11px;color:#64748b;font-family:sans-serif;">Click fields to edit</span>
  <div id="autofill-notice" style="display:none;margin-left:auto;font-size:11px;font-family:sans-serif;color:#0369a1;background:#e0f2fe;border-radius:4px;padding:3px 8px;">
    Auto-filled from employee record
  </div>
</div>

<div id="report-canvas">

  <div class="rpt-header">
    <div class="company-row">
      <img id="logo-preview" src="" alt="Company logo">
      <div class="company-name-wrap">
        <input id="company-name-input" type="text" value="" placeholder="COMPANY NAME" spellcheck="false">
        <label class="logo-upload-btn" for="logo-file-input" title="Upload logo image">
          <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
            <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z" />
          </svg>
          Logo
        </label>
        <input type="file" id="logo-file-input" accept="image/*" onchange="uploadLogo(this)" style="display:none;">
        <button id="logo-clear-btn" onclick="clearLogo()" title="Remove logo">&#x2715;</button>
      </div>
    </div>
    <div class="rpt-title">INCIDENT INFORMATION / REPORT</div>
  </div>

  <div class="rpt-row" style="margin-top:14px;">
    <div class="rpt-field">
      <div class="rpt-label">Reported By:</div>
      <input class="rpt-input" type="text" id="f_reported_by" placeholder="Full name of reporter">
    </div>
    <div class="rpt-field shrink">
      <div class="rpt-label">Date of Report:</div>
      <input class="rpt-input" type="text" id="f_report_date" placeholder="MM-DD-YY">
    </div>
  </div>
  <div class="rpt-row">
    <div class="rpt-field">
      <div class="rpt-label">Department:</div>
      <input class="rpt-input" type="text" id="f_report_dept" placeholder="Department name">
    </div>
    <div class="rpt-field shrink" style="visibility:hidden;">
      <div class="rpt-label">&nbsp;</div>
      <input class="rpt-input" type="text">
    </div>
  </div>

  <div class="section-title">Employee / Incident Information</div>

  <div class="rpt-row">
    <div class="rpt-field">
      <div class="rpt-label">
        Employee Name:
        <span class="autofill-badge" id="badge-name" style="display:none;">auto-filled</span>
      </div>
      <input class="rpt-input" type="text" id="f_emp_name" placeholder="Full name of employee involved">
    </div>
    <div class="rpt-field shrink">
      <div class="rpt-label">
        Date of Incident:
        <span class="autofill-badge" id="badge-date" style="display:none;">auto-filled</span>
      </div>
      <input class="rpt-input" type="text" id="f_incident_date" placeholder="MM-DD-YY">
    </div>
  </div>
  <div class="rpt-row">
    <div class="rpt-field">
      <div class="rpt-label">
        Department / Brand:
        <span class="autofill-badge" id="badge-dept" style="display:none;">auto-filled</span>
      </div>
      <input class="rpt-input" type="text" id="f_emp_dept" placeholder="Employee's department / brand">
    </div>
    <div class="rpt-field shrink">
      <div class="rpt-label">
        Time of Incident:
        <span class="autofill-badge" id="badge-time" style="display:none;">auto-filled</span>
      </div>
      <input class="rpt-input" type="text" id="f_incident_time" placeholder="e.g. 5:25 pm">
    </div>
  </div>
  <div class="rpt-row">
    <div class="rpt-field">
      <div class="rpt-label">Position / Shift:</div>
      <input class="rpt-input" type="text" id="f_emp_position" placeholder="Position and shift">
    </div>
    <div class="rpt-field shrink">
      <div class="rpt-label">Status:</div>
      <input class="rpt-input" type="text" id="f_emp_status" placeholder="Active / Inactive">
    </div>
  </div>

  <div class="section-title">
    Incident Details
    <span class="autofill-badge" id="badge-details" style="display:none;">auto-filled from violation record</span>
  </div>
  <textarea class="rpt-textarea" id="f_incident_details" rows="4" placeholder="Briefly describe what happened..."></textarea>

  <div class="section-title">Employee Written Explanation</div>
  <textarea class="rpt-textarea" rows="5" placeholder="Employee's own account of the incident..."></textarea>

  <div class="section-title">Supervisor / Manager Recommendation</div>
  <div class="checklist">
    <div class="check-item"><input type="checkbox"><span class="check-label">( ) Unang Babala</span></div>
    <div class="check-item"><input type="checkbox"><span class="check-label">( ) Huling babala na may kaekibet na mabigat na parusa sa susunod na paglabag</span></div>
    <div class="check-item"><input type="checkbox"><span class="check-label">( ) Isang (1) araw na tigil trabaho</span></div>
    <div class="check-item">
      <input type="checkbox">
      <div class="check-inline">
        <span>( ) Isang (1) Linggo na tigil trabaho, simula</span>
        <input type="text" placeholder="date" style="width:90px;">
        <span>hanggang</span>
        <input type="text" placeholder="date" style="width:90px;">
      </div>
    </div>
    <div class="check-item">
      <input type="checkbox">
      <div class="check-inline">
        <span>( ) Dalawang (2) Linggo na tigil trabaho, simula</span>
        <input type="text" placeholder="date" style="width:90px;">
        <span>hanggang</span>
        <input type="text" placeholder="date" style="width:90px;">
      </div>
    </div>
    <div class="check-item"><input type="checkbox"><span class="check-label">( ) Walang kasiguraduhan ng panahon ng tigil trabaho, ( Indefinite Suspension )</span></div>
    <div class="check-item"><input type="checkbox"><span class="check-label">( ) Tanggal sa trabaho</span></div>
    <div class="check-item">
      <input type="checkbox">
      <div class="check-inline">
        <span>( ) Others:</span>
        <input type="text" placeholder="specify..." style="flex:1;min-width:120px;">
      </div>
    </div>
  </div>

  <div class="sig-row">
    <div class="sig-block">
      <div class="rpt-label">Employee Name:</div>
      <div class="sig-line"><input class="sig-field" type="text" id="sig_emp_name" placeholder="Print name"></div>
    </div>
    <div class="sig-block">
      <div class="rpt-label">Employee Signature:</div>
      <div class="sig-line" style="cursor:pointer;" onclick="openSigPad('emp')" title="Click to sign">
        <canvas id="sigCanvas-emp" style="width:100%;height:32px;cursor:pointer;"></canvas>
      </div>
      <div style="font-size:10px;color:#999;margin-top:2px;font-family:sans-serif;">Click to sign</div>
    </div>
  </div>
  <div class="sig-row">
    <div class="sig-block">
      <div class="rpt-label">Supervisor Name:</div>
      <div class="sig-line"><input class="sig-field" type="text" placeholder="Print name"></div>
    </div>
    <div class="sig-block">
      <div class="rpt-label">Supervisor Signature:</div>
      <div class="sig-line" style="cursor:pointer;" onclick="openSigPad('sup')" title="Click to sign">
        <canvas id="sigCanvas-sup" style="width:100%;height:32px;cursor:pointer;"></canvas>
      </div>
      <div style="font-size:10px;color:#999;margin-top:2px;font-family:sans-serif;">Click to sign</div>
    </div>
  </div>

  <div class="attach-section" id="attach-section">
    <div class="attach-label">Attachments</div>
    <div class="attach-list" id="attach-list">
      <span class="no-attach">No attachments added.</span>
    </div>
  </div>

</div>

<div id="sigModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center;">
  <div style="background:#fff;border-radius:12px;padding:20px;width:340px;box-shadow:0 4px 24px rgba(0,0,0,0.2);">
    <div style="font-family:sans-serif;font-size:13px;font-weight:500;margin-bottom:10px;color:#000;">Draw your signature</div>
    <canvas id="sigPadCanvas" width="300" height="120" style="border:1px solid #ccc;border-radius:4px;cursor:crosshair;touch-action:none;"></canvas>
    <div style="display:flex;gap:8px;margin-top:12px;font-family:sans-serif;">
      <button class="tb-btn primary" onclick="applySig()" style="flex:1;">Apply</button>
      <button class="tb-btn" onclick="clearSigPad()">Clear</button>
      <button class="tb-btn" onclick="closeSigPad()">Cancel</button>
    </div>
  </div>
</div>

<script>
  let activeSigTarget = null;
  let sigPadDrawing = false;
  let sigPadCtx = null;
  let attachments = [];

  // ── Save debounce timer ──────────────────────────────────────
  let saveTimer = null;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCompanyData, 800); // wait 800 ms after last keystroke
  }

  // ── Helpers ──────────────────────────────────────────────────
  function toProperCase(str) {
    if (!str) return '';
    return str.replace(/[^\s,\-]+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (e) {
      return '';
    }
  }

  function setAutoFilled(inputEl, value, badgeId) {
    if (!value || !inputEl) return;
    inputEl.value = value;
    inputEl.classList.add('auto-filled');
    const badge = badgeId ? document.getElementById(badgeId) : null;
    if (badge) badge.style.display = 'inline-flex';
  }

  // ── Load company settings FROM SERVER ────────────────────────
  async function loadSavedCompany() {
    try {
      const res = await fetch('', {
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      });
      const data = await res.json();
      if (!data.success) return;

      if (data.name) {
        document.getElementById('company-name-input').value = data.name;
      }
      if (data.logo) {
        const img = document.getElementById('logo-preview');
        img.src = data.logo;
        img.style.display = 'block';
        document.getElementById('logo-clear-btn').style.display = 'inline';
      }
    } catch (e) {
      console.warn('Could not load company settings:', e);
    }
  }

  // ── Save company settings TO SERVER ──────────────────────────
  async function saveCompanyData() {
    try {
      const name = document.getElementById('company-name-input').value;
      const img = document.getElementById('logo-preview');
      const logo = (img && img.style.display !== 'none') ? img.src : '';

      await fetch('', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({
          name,
          logo
        }),
      });
    } catch (e) {
      console.warn('Could not save company settings:', e);
    }
  }

  // ── Company name input listener ──────────────────────────────
  document.getElementById('company-name-input').addEventListener('input', scheduleSave);

  // ── Logo upload (resize → save) ───────────────────────────────
  function uploadLogo(input) {
    if (!input.files.length) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, 200 / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const resized = canvas.toDataURL('image/webp', 0.8);

        const logoImg = document.getElementById('logo-preview');
        logoImg.src = resized;
        logoImg.style.display = 'block';
        document.getElementById('logo-clear-btn').style.display = 'inline';
        saveCompanyData(); // immediate save on upload
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
    input.value = '';
  }

  function clearLogo() {
    const img = document.getElementById('logo-preview');
    img.src = '';
    img.style.display = 'none';
    document.getElementById('logo-clear-btn').style.display = 'none';
    saveCompanyData();
  }

  // ── Auto-fill from URL params ─────────────────────────────────
  function autoFillFromParams() {
    const fullname = getParam('fullname');
    const brand = getParam('brand');
    const position = getParam('position');
    const shift = getParam('shift');
    const status = getParam('status');
    const violation = getParam('violation');
    const ts = getParam('ts');
    let anyFilled = false;

    if (fullname) {
      setAutoFilled(document.getElementById('f_emp_name'), toProperCase(fullname), 'badge-name');
      document.getElementById('sig_emp_name').value = toProperCase(fullname);
      anyFilled = true;
    }
    if (brand) {
      setAutoFilled(document.getElementById('f_emp_dept'), toProperCase(brand), 'badge-dept');
      anyFilled = true;
    }
    if (position || shift) {
      const posShift = [toProperCase(position), shift].filter(Boolean).join(' — ');
      const el = document.getElementById('f_emp_position');
      if (el) {
        el.value = posShift;
        el.classList.add('auto-filled');
      }
      anyFilled = true;
    }
    if (status) {
      const el = document.getElementById('f_emp_status');
      if (el) {
        el.value = toProperCase(status);
        el.classList.add('auto-filled');
      }
    }
    if (violation) {
      setAutoFilled(document.getElementById('f_incident_details'), violation, 'badge-details');
      anyFilled = true;
    }
    if (ts) {
      try {
        const d = new Date(ts);
        const dateStr = d.toLocaleDateString('en-PH', {
          month: '2-digit',
          day: '2-digit',
          year: '2-digit'
        });
        const timeStr = d.toLocaleTimeString('en-PH', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        setAutoFilled(document.getElementById('f_incident_date'), dateStr, 'badge-date');
        setAutoFilled(document.getElementById('f_incident_time'), timeStr, 'badge-time');
        document.getElementById('f_report_date').value = dateStr;
        anyFilled = true;
      } catch (e) {}
    }
    if (anyFilled) document.getElementById('autofill-notice').style.display = 'block';
  }

  // ── Attachments ───────────────────────────────────────────────
  function addAttachments(input) {
    Array.from(input.files).forEach(file => {
      attachments.push({
        name: file.name,
        url: URL.createObjectURL(file),
        type: file.type
      });
    });
    renderAttachments();
    input.value = '';
  }

  function renderAttachments() {
    const list = document.getElementById('attach-list');
    if (!attachments.length) {
      list.innerHTML = '<span class="no-attach">No attachments added.</span>';
      return;
    }
    list.innerHTML = attachments.map((a, i) => `
    <div class="attach-item" onclick="viewAttachment(${i})">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm0 1h5v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/></svg>
      ${a.name}
      <button class="rm-btn" onclick="removeAttachment(event,${i})">&#x2715;</button>
    </div>`).join('');
  }

  function removeAttachment(e, i) {
    e.stopPropagation();
    attachments.splice(i, 1);
    renderAttachments();
  }

  function viewAttachment(i) {
    const a = attachments[i];
    const win = window.open('', '_blank');
    win.document.write(`<!DOCTYPE html><html><head><title>${a.name}</title>
    <style>*{margin:0;padding:0;box-sizing:border-box;}body{background:#1a1a1a;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:20px;font-family:sans-serif;}
    .tb{display:flex;gap:10px;margin-bottom:16px;}button{padding:8px 20px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;}
    .p{background:#1a4fa0;color:#fff;}.c{background:#555;color:#fff;}img{max-width:100%;border-radius:6px;}embed{width:100%;min-height:85vh;}h3{color:#fff;font-size:14px;margin-bottom:12px;}</style>
    </head><body><h3>${a.name}</h3>
    <div class="tb"><button class="p" onclick="window.print()">Print</button><button class="c" onclick="window.close()">Close</button></div>
    ${a.type.startsWith('image/') ? `<img src="${a.url}" alt="${a.name}">` : `<embed src="${a.url}" type="application/pdf">`}
    </body></html>`);
    win.document.close();
  }

  // ── Clear form ────────────────────────────────────────────────
  function clearForm() {
    if (!confirm('Clear all manually-entered fields? Auto-filled values will remain.')) return;
    document.querySelectorAll('#report-canvas input[type=text]:not(.auto-filled), #report-canvas textarea:not(.auto-filled)')
      .forEach(el => el.value = '');
    document.querySelectorAll('#report-canvas input[type=checkbox]').forEach(el => el.checked = false);
    ['emp', 'sup'].forEach(id => {
      const c = document.getElementById('sigCanvas-' + id);
      if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    });
    attachments = [];
    renderAttachments();
  }

  // ── Signature pad ─────────────────────────────────────────────
  function openSigPad(target) {
    activeSigTarget = target;
    const modal = document.getElementById('sigModal');
    modal.style.display = 'flex';
    const canvas = document.getElementById('sigPadCanvas');
    sigPadCtx = canvas.getContext('2d');
    sigPadCtx.clearRect(0, 0, canvas.width, canvas.height);
    sigPadCtx.strokeStyle = '#000';
    sigPadCtx.lineWidth = 2;
    sigPadCtx.lineCap = 'round';
    sigPadCtx.lineJoin = 'round';

    canvas.onmousedown = e => {
      sigPadDrawing = true;
      const r = canvas.getBoundingClientRect();
      sigPadCtx.beginPath();
      sigPadCtx.moveTo(e.clientX - r.left, e.clientY - r.top);
    };
    canvas.onmousemove = e => {
      if (!sigPadDrawing) return;
      const r = canvas.getBoundingClientRect();
      sigPadCtx.lineTo(e.clientX - r.left, e.clientY - r.top);
      sigPadCtx.stroke();
    };
    canvas.onmouseup = () => sigPadDrawing = false;
    canvas.onmouseleave = () => sigPadDrawing = false;
    canvas.ontouchstart = e => {
      e.preventDefault();
      sigPadDrawing = true;
      const r = canvas.getBoundingClientRect();
      const t = e.touches[0];
      sigPadCtx.beginPath();
      sigPadCtx.moveTo(t.clientX - r.left, t.clientY - r.top);
    };
    canvas.ontouchmove = e => {
      e.preventDefault();
      if (!sigPadDrawing) return;
      const r = canvas.getBoundingClientRect();
      const t = e.touches[0];
      sigPadCtx.lineTo(t.clientX - r.left, t.clientY - r.top);
      sigPadCtx.stroke();
    };
    canvas.ontouchend = () => sigPadDrawing = false;
  }

  function clearSigPad() {
    document.getElementById('sigPadCanvas').getContext('2d')
      .clearRect(0, 0, 300, 120);
  }

  function closeSigPad() {
    document.getElementById('sigModal').style.display = 'none';
    activeSigTarget = null;
  }

  function applySig() {
    const padCanvas = document.getElementById('sigPadCanvas');
    const targetCanvas = document.getElementById('sigCanvas-' + activeSigTarget);
    if (!targetCanvas) {
      closeSigPad();
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const rect = targetCanvas.parentElement.getBoundingClientRect();
    targetCanvas.width = rect.width * dpr;
    targetCanvas.height = 36 * dpr;
    const ctx = targetCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, 36);
    ctx.drawImage(padCanvas, 0, 0, rect.width, 36);
    closeSigPad();
  }

  // ── Init ──────────────────────────────────────────────────────
  loadSavedCompany();
  autoFillFromParams();
</script>