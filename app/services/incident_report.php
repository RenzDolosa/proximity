<?php
// app/services/incident_report.php

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

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $isAjax) {
  header('Content-Type: application/json');
  header('Cache-Control: no-store, no-cache, must-revalidate');
  header('Pragma: no-cache');
  $pdo = getDBConnection();
  ensureCompanySettingsTable($pdo);
  $row = $pdo->query("SELECT company_name, company_logo FROM company_settings_global LIMIT 1")->fetch(PDO::FETCH_ASSOC);
  echo json_encode(['success' => true, 'name' => $row['company_name'] ?? '', 'logo' => $row['company_logo'] ?? '']);
  exit;
}

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
?>

<style>
  *,
  *::before,
  *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Times New Roman', Times, serif;
    background: #d8d8d8;
    padding: 20px;
  }

  /* ── Toolbar ── */
  #toolbar {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px 14px;
    background: #fff;
    border: 1px solid #bbb;
    border-radius: 6px;
    margin: 0 auto 14px;
    flex-wrap: wrap;
    max-width: 780px;
  }

  .tb-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 11px;
    font-size: 11px;
    font-family: Arial, sans-serif;
    font-weight: 600;
    border: 1px solid #bbb;
    border-radius: 4px;
    background: #f5f5f5;
    color: #222;
    cursor: pointer;
    white-space: nowrap;
    letter-spacing: .3px;
  }

  .tb-btn:hover {
    background: #e8e8e8;
  }

  .tb-btn.primary {
    background: #1a3f80;
    color: #fff;
    border-color: #1a3f80;
  }

  .tb-btn.primary:hover {
    background: #12306a;
  }

  .tb-sep {
    width: 1px;
    height: 20px;
    background: #ccc;
    margin: 0 2px;
  }

  /* ── Paper canvas ── */
  #report-canvas {
    background: #fff;
    border: 1px solid #aaa;
    border-radius: 2px;
    padding: 32px 36px 36px;
    max-width: 780px;
    margin: 0 auto;
    font-family: 'Times New Roman', Times, serif;
    font-size: 12.5px;
    line-height: 1.45;
    box-shadow: 2px 3px 10px rgba(0, 0, 0, .18);
  }

  /* ── Company header ── */
  .company-header {
    text-align: center;
    margin-bottom: 2px;
  }

  .company-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-bottom: 2px;
  }

  #logo-preview {
    max-height: 48px;
    max-width: 110px;
    object-fit: contain;
    display: none;
  }

  .company-name-wrap {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  #company-name-input {
    font-family: 'Times New Roman', Times, serif;
    font-size: 14px;
    font-weight: bold;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #111;
    border: none;
    border-bottom: 1px dashed #bbb;
    background: transparent;
    outline: none;
    text-align: center;
    min-width: 200px;
    max-width: 340px;
    display: block;
    line-height: 1.4;
    padding: 0;
    white-space: pre-wrap;
    word-break: break-word;
    word-wrap: break-word;
    cursor: text;
  }

  #company-name-input:focus {
    background: #fffde7;
    border-bottom-color: #1a3f80;
  }

  #company-name-input:empty:before {
    content: attr(data-placeholder);
    color: #bbb;
    font-weight: normal;
    letter-spacing: 1px;
    text-transform: none;
  }

  .logo-upload-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px;
    font-size: 10px;
    font-family: Arial, sans-serif;
    border: 1px solid #bbb;
    border-radius: 3px;
    background: #f5f5f5;
    color: #555;
    cursor: pointer;
  }

  .logo-upload-btn:hover {
    background: #e8e8e8;
  }

  #logo-clear-btn {
    font-size: 11px;
    font-family: Arial, sans-serif;
    border: none;
    background: none;
    color: #c00;
    cursor: pointer;
    padding: 0 2px;
    display: none;
  }

  /* ── Report title banner ── */
  .rpt-title {
    font-size: 12.5px;
    font-weight: bold;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    border-top: 2.5px solid #111;
    border-bottom: 2.5px solid #111;
    padding: 5px 0 4px;
    text-align: center;
    margin: 10px 0 14px;
  }

  /* ── Field rows ── */
  .f-row {
    display: flex;
    gap: 0;
    margin-bottom: 11px;
    align-items: flex-end;
  }

  .f-cell {
    flex: 1;
    display: flex;
    align-items: flex-end;
    gap: 0;
  }

  .f-cell.shrink {
    flex: 0 0 auto;
    min-width: 200px;
  }

  .f-cell+.f-cell {
    margin-left: 18px;
  }

  .f-label {
    font-size: 12.5px;
    font-weight: normal;
    white-space: nowrap;
    padding-right: 4px;
    flex-shrink: 0;
    padding-bottom: 2px;
  }

  .f-label strong {
    font-weight: bold;
  }

  .f-line {
    flex: 1;
    border: none;
    border-bottom: 1px solid #111;
    background: transparent;
    font-family: 'Times New Roman', Times, serif;
    font-size: 12.5px;
    color: #111;
    padding: 1px 3px 2px;
    outline: none;
    min-width: 60px;
  }

  .f-line:focus {
    background: #fffde7;
  }

  .f-line.auto-filled {
    background: #f0f9ff;
  }

  /* ── Section headers ── */
  .sec-hdr {
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    text-align: center;
    border: 1px solid #111;
    padding: 3px 8px;
    margin: 14px 0 8px;
    background: #fff;
  }

  /* ── Textareas ── */
  .f-area {
    width: 100%;
    border: 1px solid #111;
    background: transparent;
    font-family: 'Times New Roman', Times, serif;
    font-size: 12.5px;
    color: #111;
    padding: 5px 7px;
    outline: none;
    resize: vertical;
    min-height: 64px;
  }

  .f-area:focus {
    background: #fffde7;
  }

  .f-area.auto-filled {
    background: #f0f9ff;
  }

  /* Lined textarea (like the scanned form) */
  .lined-area-wrap {
    border: 1px solid #111;
    padding: 0;
    overflow: hidden;
  }

  .lined-area {
    width: 100%;
    display: block;
    background-image: repeating-linear-gradient(to bottom,
        transparent 0px,
        transparent 24px,
        #ccc 24px,
        #ccc 25px);
    background-attachment: local;
    border: none;
    font-family: 'Times New Roman', Times, serif;
    font-size: 12.5px;
    color: #111;
    padding: 5px 7px 0;
    outline: none;
    resize: none;
    line-height: 25px;
    min-height: 125px;
    overflow: hidden;
    box-sizing: border-box;
  }

  .lined-area:focus {
    background-image: repeating-linear-gradient(to bottom,
        #fffde7 0px,
        #fffde7 24px,
        #bbb 24px,
        #bbb 25px);
    background-attachment: local;
  }

  /* ── Checklist ── */
  .checklist {
    border: 1px solid #111;
    padding: 8px 10px;
  }

  .chk-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 5px;
    font-size: 12px;
  }

  .chk-item:last-child {
    margin-bottom: 0;
  }

  .chk-item input[type=checkbox] {
    margin-top: 2px;
    cursor: pointer;
    flex-shrink: 0;
  }

  .chk-item .chk-lbl {
    flex: 1;
  }

  .chk-item .chk-inline {
    flex: 1;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 3px;
    font-size: 12px;
  }

  .chk-item .chk-inline .date-in {
    border: none;
    border-bottom: 1px solid #111;
    background: transparent;
    font-family: 'Times New Roman', Times, serif;
    font-size: 12px;
    color: #111;
    padding: 1px 2px;
    outline: none;
    width: 80px;
  }

  .chk-item .chk-inline .date-in:focus {
    background: #fffde7;
  }

  .chk-item .chk-inline .other-in {
    border: none;
    border-bottom: 1px solid #111;
    background: transparent;
    font-family: 'Times New Roman', Times, serif;
    font-size: 12px;
    color: #111;
    padding: 1px 2px;
    outline: none;
    flex: 1;
    min-width: 100px;
  }

  .chk-item .chk-inline .other-in:focus {
    background: #fffde7;
  }

  /* ── Signatures ── */
  .sig-row {
    display: flex;
    gap: 40px;
    margin-top: 28px;
    align-items: flex-end;
  }

  .sig-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .sig-lbl {
    font-size: 11.5px;
    font-weight: bold;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    margin-bottom: 8px;
  }

  .sig-line-wrap {
    border-bottom: 1.5px solid #111;
    min-height: 32px;
    display: flex;
    align-items: flex-end;
    padding-bottom: 3px;
  }

  .sig-name-field {
    width: 100%;
    border: none;
    background: transparent;
    font-family: 'Times New Roman', Times, serif;
    font-size: 12.5px;
    color: #111;
    outline: none;
    padding: 1px 3px;
  }

  .sig-name-field:focus {
    background: #fffde7;
  }

  .sig-canvas-wrap {
    border-bottom: 1.5px solid #111;
    min-height: 32px;
    cursor: pointer;
    position: relative;
  }

  .sig-canvas-wrap canvas {
    width: 100%;
    height: 30px;
    display: block;
    cursor: crosshair;
  }

  .sig-hint {
    font-size: 10px;
    color: #bbb;
    margin-top: 3px;
    font-family: Arial, sans-serif;
    text-align: center;
  }

  /* ── Attachments ── */
  .attach-section {
    margin-top: 14px;
    border: 1px dashed #aaa;
    padding: 8px 10px;
    background: #fafafa;
  }

  .attach-lbl {
    font-size: 10px;
    font-weight: bold;
    letter-spacing: 1px;
    color: #555;
    margin-bottom: 5px;
    text-transform: uppercase;
    font-family: Arial, sans-serif;
  }

  .attach-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .attach-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 9px;
    background: #fff;
    border: 1px solid #bbb;
    border-radius: 3px;
    font-size: 11px;
    color: #1a3f80;
    cursor: pointer;
    font-family: Arial, sans-serif;
  }

  .attach-item:hover {
    background: #e8f0fe;
  }

  .attach-item .rm-btn {
    color: #aaa;
    cursor: pointer;
    font-size: 13px;
    border: none;
    background: none;
    padding: 0;
    font-family: Arial, sans-serif;
  }

  .attach-item .rm-btn:hover {
    color: #c00;
  }

  .no-attach {
    font-size: 11px;
    color: #aaa;
    font-style: italic;
    font-family: Arial, sans-serif;
  }

  /* ── Autofill badge ── */
  .af-badge {
    display: inline-flex;
    align-items: center;
    font-size: 9px;
    font-family: Arial, sans-serif;
    color: #0369a1;
    background: #e0f2fe;
    border-radius: 3px;
    padding: 1px 5px;
    margin-left: 4px;
    vertical-align: middle;
  }

  /* ── Signature modal ── */
  #sigModal {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, .45);
    z-index: 1000;
    align-items: center;
    justify-content: center;
  }

  .sig-modal-box {
    background: #fff;
    border-radius: 8px;
    padding: 18px;
    width: 340px;
    border: 1px solid #ccc;
  }

  .sig-modal-title {
    font-family: Arial, sans-serif;
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 10px;
    color: #111;
  }

  #sigPadCanvas {
    border: 1px solid #bbb;
    border-radius: 3px;
    cursor: crosshair;
    touch-action: none;
    display: block;
  }

  .sig-modal-btns {
    display: flex;
    gap: 6px;
    margin-top: 10px;
    font-family: Arial, sans-serif;
  }

  /* ── Print ── */
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
    }

    .f-line,
    .f-area,
    .lined-area,
    .sig-name-field {
      background: transparent !important;
      border-color: #000 !important;
    }

    .f-line.auto-filled,
    .f-area.auto-filled {
      background: transparent !important;
    }

    .sec-hdr {
      border-color: #000 !important;
    }

    .rpt-title {
      border-color: #000 !important;
    }

    .lined-area-wrap {
      overflow: visible !important;
    }

    .lined-area {
      overflow: hidden !important;
      height: auto !important;
      min-height: 0 !important;
      resize: none !important;
      background-image: repeating-linear-gradient(to bottom,
          transparent 0px,
          transparent 24px,
          #ccc 24px,
          #ccc 25px) !important;
      background-attachment: local !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .af-badge {
      display: none !important;
    }

    input::placeholder,
    textarea::placeholder {
      color: transparent !important;
    }

    .sig-hint {
      display: none !important;
    }
  }
</style>

<!-- ── Toolbar ── -->
<div id="toolbar">
  <button class="tb-btn primary" onclick="window.print()">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5 1a1 1 0 0 0-1 1v1H3a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1v1a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1h1a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1V2a1 1 0 0 0-1-1H5zm0 2h6V2H5v1zm6 9H5v-2h6v2zM3 5h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1V9H4v2H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
    </svg>
    Print / Save PDF
  </button>
  <div class="tb-sep"></div>
  <button class="tb-btn" onclick="clearForm()">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M2.5 1a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1H3v9a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4h.5a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H10a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1H2.5zm3 4a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 .5-.5zM8 5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-1 0v-7A.5.5 0 0 1 8 5zm3 .5v7a.5.5 0 0 1-1 0v-7a.5.5 0 0 1 1 0z" />
    </svg>
    Clear Form
  </button>
  <div class="tb-sep"></div>
  <label class="tb-btn" for="attach-file-input" style="cursor:pointer;">
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z" />
    </svg>
    Attach File
  </label>
  <input type="file" id="attach-file-input" multiple accept="image/*,.pdf,.doc,.docx" onchange="addAttachments(this)" style="display:none;">
  <span style="font-size:10px;color:#666;font-family:Arial,sans-serif;margin-left:4px;">Click any field to edit</span>
  <div id="autofill-notice" style="display:none;margin-left:auto;font-size:10px;font-family:Arial,sans-serif;color:#0369a1;background:#e0f2fe;border-radius:3px;padding:2px 8px;">
    ✓ Auto-filled from employee record
  </div>
</div>

<!-- ── Report canvas ── -->
<div id="report-canvas">

  <!-- Company header -->
  <div class="company-header">
    <div class="company-row">
      <img id="logo-preview" src="" alt="Company logo">
      <div class="company-name-wrap">
        <div id="company-name-input" contenteditable="true" spellcheck="false" data-placeholder="COMPANY NAME"></div>
        <label class="logo-upload-btn" for="logo-file-input" title="Upload logo">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
            <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z" />
          </svg>
          Logo
        </label>
        <input type="file" id="logo-file-input" accept="image/*" onchange="uploadLogo(this)" style="display:none;">
        <button id="logo-clear-btn" onclick="clearLogo()" title="Remove logo">&#x2715;</button>
      </div>
    </div>
  </div>

  <div class="rpt-title">Incident Information / Report</div>

  <!-- Reported by row -->
  <div class="f-row">
    <div class="f-cell">
      <span class="f-label"><strong>Reported By:</strong></span>
      <input class="f-line" type="text" id="f_reported_by" placeholder="Full name of reporter">
    </div>
    <div class="f-cell shrink">
      <span class="f-label"><strong>Date of Report:</strong></span>
      <input class="f-line" type="text" id="f_report_date" placeholder="MM-DD-YY" style="width:110px;flex:none;">
    </div>
  </div>

  <!-- Department row -->
  <div class="f-row">
    <div class="f-cell" style="max-width:360px;">
      <span class="f-label"><strong>Department:</strong></span>
      <input class="f-line" type="text" id="f_report_dept" placeholder="Department name">
    </div>
  </div>

  <!-- Section: Employee / Incident Information -->
  <div class="sec-hdr">Employee / Incident Information</div>

  <div class="f-row">
    <div class="f-cell">
      <span class="f-label">
        <strong>Employee Name:</strong>
        <span class="af-badge" id="badge-name" style="display:none;">auto-filled</span>
      </span>
      <input class="f-line" type="text" id="f_emp_name" placeholder="Full name of employee involved">
    </div>
    <div class="f-cell shrink">
      <span class="f-label">
        <strong>Date of Incident:</strong>
        <span class="af-badge" id="badge-date" style="display:none;">auto-filled</span>
      </span>
      <input class="f-line" type="text" id="f_incident_date" placeholder="MM-DD-YY" style="width:110px;flex:none;">
    </div>
  </div>

  <div class="f-row">
    <div class="f-cell">
      <span class="f-label">
        <strong>Department / Brand:</strong>
        <span class="af-badge" id="badge-dept" style="display:none;">auto-filled</span>
      </span>
      <input class="f-line" type="text" id="f_emp_dept" placeholder="Employee's department / brand">
    </div>
    <div class="f-cell shrink">
      <span class="f-label">
        <strong>Time of Incident:</strong>
        <span class="af-badge" id="badge-time" style="display:none;">auto-filled</span>
      </span>
      <input class="f-line" type="text" id="f_incident_time" placeholder="e.g. 5:25 PM" style="width:110px;flex:none;">
    </div>
  </div>

  <div class="f-row">
    <div class="f-cell">
      <span class="f-label">
        <strong>Position / Shift:</strong>
        <span class="af-badge" id="badge-position" style="display:none;">auto-filled</span>
      </span>
      <input class="f-line" type="text" id="f_emp_position" placeholder="Position and shift">
    </div>
    <div class="f-cell shrink">
      <span class="f-label">
        <strong>Status:</strong>
        <span class="af-badge" id="badge-status" style="display:none;">auto-filled</span>
      </span>
      <input class="f-line" type="text" id="f_emp_status" placeholder="Active / Inactive" style="width:110px;flex:none;">
    </div>
  </div>

  <!-- <div class="f-row">
    <div class="f-cell" style="max-width:300px;">
      <span class="f-label"><strong>Position / Shift:</strong></span>
      <input class="f-line" type="text" id="f_emp_position" placeholder="Position and shift">
    </div>
    <div class="f-cell shrink">
      <span class="f-label"><strong>Status:</strong></span>
      <input class="f-line" type="text" id="f_emp_status" placeholder="Active / Inactive" style="width:120px;flex:none;">
    </div>
  </div> -->

  <!-- Section: Incident Details -->
  <div class="sec-hdr">
    Incident Details
    <span class="af-badge" id="badge-details" style="display:none;">auto-filled from violation record</span>
  </div>
  <textarea class="f-area" id="f_incident_details" rows="3" placeholder="Briefly describe what happened..."></textarea>

  <!-- Section: Employee Written Explanation -->
  <div class="sec-hdr">Employee Written Explanation</div>
  <div class="lined-area-wrap">
    <textarea class="lined-area" rows="4" placeholder="Employee's own account of the incident..."></textarea>
  </div>

  <!-- Section: Supervisor Recommendation -->
  <div class="sec-hdr">Supervisor / Manager Recommendation</div>
  <div class="checklist">
    <div class="chk-item">
      <input type="checkbox">
      <span class="chk-lbl">( &nbsp;) Unang Babala</span>
    </div>
    <div class="chk-item">
      <input type="checkbox">
      <span class="chk-lbl">( &nbsp;) Huling babala na may kaekibet na mabigat na parusa sa susunod na paglabag</span>
    </div>
    <div class="chk-item">
      <input type="checkbox">
      <span class="chk-lbl">( &nbsp;) Isang (1) araw na tigil trabaho</span>
    </div>
    <div class="chk-item">
      <input type="checkbox">
      <div class="chk-inline">
        <span>( &nbsp;) Isang (1) Linggo na tigil trabaho, simula</span>
        <input type="text" class="date-in" placeholder="date">
        <span>hanggang</span>
        <input type="text" class="date-in" placeholder="date">
      </div>
    </div>
    <div class="chk-item">
      <input type="checkbox">
      <div class="chk-inline">
        <span>( &nbsp;) Dalawang (2) Linggo na tigil trabaho, simula</span>
        <input type="text" class="date-in" placeholder="date">
        <span>hanggang</span>
        <input type="text" class="date-in" placeholder="date">
      </div>
    </div>
    <div class="chk-item">
      <input type="checkbox">
      <span class="chk-lbl">( &nbsp;) Walang kasiguraduhan ng panahon ng tigil trabaho, ( Indefinite Suspension )</span>
    </div>
    <div class="chk-item">
      <input type="checkbox">
      <span class="chk-lbl">( &nbsp;) Tanggal sa trabaho</span>
    </div>
    <div class="chk-item">
      <input type="checkbox">
      <div class="chk-inline">
        <span>( &nbsp;) Others:</span>
        <input type="text" class="other-in" placeholder="specify...">
      </div>
    </div>
  </div>

  <!-- Signatures -->
  <div style="display:flex; gap:40px; margin-top:24px;">
    <div style="flex:1; display:flex; align-items:flex-end; gap:6px;">
      <span style="font-size:11.5px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;">Employee Name:</span>
      <div style="flex:1; border-bottom:1.5px solid #111; min-height:20px; display:flex; align-items:flex-end;">
        <input class="sig-name-field" type="text" id="sig_emp_name" placeholder="">
      </div>
    </div>
    <div style="flex:1; display:flex; align-items:flex-end; gap:6px;">
      <span style="font-size:11.5px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;">Employee Signature:</span>
      <div class="sig-canvas-wrap" onclick="openSigPad('emp')" title="Click to sign" style="flex:1;">
        <canvas id="sigCanvas-emp"></canvas>
      </div>
    </div>
  </div>

  <div style="display:flex; gap:40px; margin-top:18px;">
    <div style="flex:1; display:flex; align-items:flex-end; gap:6px;">
      <span style="font-size:11.5px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;">Supervisor Name:</span>
      <div style="flex:1; border-bottom:1.5px solid #111; min-height:20px; display:flex; align-items:flex-end;">
        <input class="sig-name-field" type="text" placeholder="">
      </div>
    </div>
    <div style="flex:1; display:flex; align-items:flex-end; gap:6px;">
      <span style="font-size:11.5px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;white-space:nowrap;">Supervisor Signature:</span>
      <div class="sig-canvas-wrap" onclick="openSigPad('sup')" title="Click to sign" style="flex:1;">
        <canvas id="sigCanvas-sup"></canvas>
      </div>
    </div>
  </div>

  <!-- Attachments -->
  <div class="attach-section" id="attach-section">
    <div class="attach-lbl">Attachments</div>
    <div class="attach-list" id="attach-list">
      <span class="no-attach">No attachments added.</span>
    </div>
  </div>

</div><!-- /report-canvas -->

<!-- Signature modal -->
<div id="sigModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;align-items:center;justify-content:center;">
  <div class="sig-modal-box">
    <div class="sig-modal-title">Draw your signature</div>
    <canvas id="sigPadCanvas" width="300" height="120"></canvas>
    <div class="sig-modal-btns">
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
  let saveTimer = null;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCompanyData, 800);
  }

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
    const b = badgeId ? document.getElementById(badgeId) : null;
    if (b) b.style.display = 'inline-flex';
  }

  /* ── Load / save company ── */
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
        const el = document.getElementById('company-name-input');
        el.textContent = data.name;
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

  async function saveCompanyData() {
    try {
      const name = document.getElementById('company-name-input').textContent;
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
        })
      });
    } catch (e) {
      console.warn('Could not save company settings:', e);
    }
  }

  const companyInput = document.getElementById('company-name-input');
  companyInput.addEventListener('input', () => {
    scheduleSave();
  });

  /* ── Logo ── */
  function uploadLogo(input) {
    if (!input.files.length) return;
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
        saveCompanyData();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(input.files[0]);
    input.value = '';
  }

  function clearLogo() {
    const img = document.getElementById('logo-preview');
    img.src = '';
    img.style.display = 'none';
    document.getElementById('logo-clear-btn').style.display = 'none';
    saveCompanyData();
  }

  /* ── Auto-fill from URL ── */
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

  /* ── Attachments ── */
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
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm0 1h5v3.5A1.5 1.5 0 0 0 10.5 6H14v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/></svg>
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
    <style>*{margin:0;padding:0;}body{background:#1a1a1a;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:20px;font-family:sans-serif;}
    .tb{display:flex;gap:10px;margin-bottom:16px;}button{padding:8px 20px;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;}
    .p{background:#1a3f80;color:#fff;}.c{background:#555;color:#fff;}img{max-width:100%;border-radius:4px;}embed{width:100%;min-height:85vh;}h3{color:#fff;font-size:14px;margin-bottom:12px;}</style>
    </head><body><h3>${a.name}</h3>
    <div class="tb"><button class="p" onclick="window.print()">Print</button><button class="c" onclick="window.close()">Close</button></div>
    ${a.type.startsWith('image/') ? `<img src="${a.url}" alt="${a.name}">` : `<embed src="${a.url}" type="application/pdf">`}
    </body></html>`);
    win.document.close();
  }

  /* ── Clear form ── */
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

  /* ── Signature pad ── */
  function openSigPad(target) {
    activeSigTarget = target;
    document.getElementById('sigModal').style.display = 'flex';
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
      const r = canvas.getBoundingClientRect(),
        t = e.touches[0];
      sigPadCtx.beginPath();
      sigPadCtx.moveTo(t.clientX - r.left, t.clientY - r.top);
    };
    canvas.ontouchmove = e => {
      e.preventDefault();
      if (!sigPadDrawing) return;
      const r = canvas.getBoundingClientRect(),
        t = e.touches[0];
      sigPadCtx.lineTo(t.clientX - r.left, t.clientY - r.top);
      sigPadCtx.stroke();
    };
    canvas.ontouchend = () => sigPadDrawing = false;
  }

  function clearSigPad() {
    document.getElementById('sigPadCanvas').getContext('2d').clearRect(0, 0, 300, 120);
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

  /* ── Init ── */
  loadSavedCompany();
  autoFillFromParams();

  window.addEventListener('beforeprint', () => {
    const el = document.getElementById('company-name-input');
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    el.style.overflow = 'visible';
  });
  window.addEventListener('afterprint', () => {
    const el = document.getElementById('company-name-input');
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    el.style.overflow = 'hidden';
  });
</script>