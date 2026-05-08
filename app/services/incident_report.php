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
  $pdo->exec("CREATE TABLE IF NOT EXISTS global_company_settings (
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
  $row = $pdo->query("SELECT company_name, company_logo FROM global_company_settings LIMIT 1")->fetch(PDO::FETCH_ASSOC);
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
  $count = $pdo->query("SELECT COUNT(*) FROM global_company_settings")->fetchColumn();
  if ($count > 0) {
    $stmt = $pdo->prepare("UPDATE global_company_settings SET company_name = ?, company_logo = ?");
    $stmt->execute([$name, $logo]);
  } else {
    $stmt = $pdo->prepare("INSERT INTO global_company_settings (company_name, company_logo) VALUES (?, ?)");
    $stmt->execute([$name, $logo]);
  }
  echo json_encode(['success' => true]);
  exit;
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Incident Report</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="icon" href="../../resource/assets/icon/database-icon.png" type="image/png">
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@700&display=swap" rel="stylesheet">
  <style>
    *,
    *::before,
    *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    /* ── Letter page size for print ── */
    @page {
      size: letter portrait;
      margin: 0.55in 0.6in 0.55in 0.6in;
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
      max-width: 816px;
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
      background: #1565c0;
      color: #fff;
      border-color: #1565c0;
    }

    .tb-btn.primary:hover {
      background: #0d47a1;
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
      width: 816px;
      max-width: 816px;
      min-height: 950px;
      padding: 28px 52px 28px 52px;
      margin: 0 auto;
      font-family: 'Times New Roman', Times, serif;
      font-size: 11.5px;
      line-height: 1.35;
      box-shadow: 2px 3px 10px rgba(0, 0, 0, .18);
    }

    /* ── Company header ── */
    .company-header {
      text-align: center;
      margin-bottom: 14px;
    }

    .company-logo-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 0;
    }

    #logo-preview {
      max-height: 56px;
      max-width: 120px;
      object-fit: contain;
      display: none;
    }

    #company-name-input {
      font-family: 'Anton', Impact, 'Arial Narrow', 'Franklin Gothic Heavy', 'Arial Black', sans-serif;
      font-size: 30px;
      font-weight: 400;
      color: #1565c0;
      letter-spacing: 2px;
      text-transform: uppercase;
      border: none;
      border-bottom: 2px dashed transparent;
      background: transparent;
      outline: none;
      text-align: center;
      width: 100%;
      display: block;
      line-height: 1.15;
      padding: 2px 0 2px;
      cursor: text;
      transition: border-color 0.15s, background 0.15s;
      -webkit-font-smoothing: antialiased;
    }

    #company-name-input:hover {
      border-bottom-color: #90caf9;
    }

    #company-name-input:focus {
      background: #e3f2fd;
      border-bottom-color: #1565c0;
      border-radius: 2px;
    }

    #company-name-input::placeholder {
      color: #b0c8e8;
      font-size: 13px;
      letter-spacing: 0px;
      text-transform: none;
      font-weight: normal;
      font-family: Arial, sans-serif;
    }

    #company-subtitle-input {
      font-family: 'Anton', Impact, 'Arial Narrow', 'Franklin Gothic Heavy', 'Arial Black', sans-serif;
      font-size: 30px;
      font-weight: 400;
      color: #1565c0;
      letter-spacing: 2px;
      text-transform: uppercase;
      border: none;
      border-bottom: 1px dashed transparent;
      background: transparent;
      outline: none;
      text-align: center;
      display: block;
      width: 100%;
      line-height: 1.15;
      padding: 2px 0 2px;
      cursor: text;
      margin-top: 0;
      transition: border-color 0.15s, background 0.15s;
      -webkit-font-smoothing: antialiased;
    }

    #company-subtitle-input:hover {
      border-bottom-color: #90caf9;
    }

    #company-subtitle-input:focus {
      background: #e3f2fd;
      border-bottom-color: #1565c0;
      border-radius: 2px;
    }

    #company-subtitle-input::placeholder {
      color: #b0c8e8;
      font-size: 11px;
      letter-spacing: 0px;
      text-transform: none;
      font-weight: normal;
      font-family: Arial, sans-serif;
    }

    .logo-edit-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 5px;
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
      font-size: 11px;
      font-weight: bold;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      background: #c8c8c8;
      color: #111;
      padding: 4px 10px;
      text-align: center;
      margin: 0 0 12px;
    }

    /* ── Field rows ── */
    .f-row {
      display: flex;
      gap: 0;
      margin-bottom: 7px;
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
      min-width: 185px;
    }

    .f-cell+.f-cell {
      margin-left: 20px;
    }

    .f-label {
      font-size: 11.5px;
      white-space: nowrap;
      padding-right: 4px;
      flex-shrink: 0;
      padding-bottom: 1px;
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
      font-size: 11.5px;
      color: #111;
      padding: 1px 3px 1px;
      outline: none;
      min-width: 50px;
    }

    .f-line:focus {
      background: #fffde7;
    }

    .f-line.auto-filled {
      background: #e8f5e9;
    }

    .f-line[readonly] {
      background: #e8f5e9 !important;
      color: #2e7d32;
    }

    .f-line[readonly]:focus {
      background: #e8f5e9 !important;
      outline: none;
    }

    /* ── Section headers ── */
    .sec-hdr {
      font-size: 10.5px;
      font-weight: bold;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      background: #c8c8c8;
      color: #111;
      padding: 3px 8px;
      margin: 10px 0 6px;
    }

    /* ── Bordered box areas ── */
    .box-area {
      border: 1px solid #888;
      padding: 0;
      margin-bottom: 2px;
    }

    /* ── Plain textarea inside box ── */
    .f-area {
      width: 100%;
      border: none;
      background: transparent;
      font-family: 'Times New Roman', Times, serif;
      font-size: 11.5px;
      color: #111;
      padding: 4px 7px;
      outline: none;
      resize: none;
      min-height: 56px;
      display: block;
    }

    .f-area:focus {
      background: #fffde7;
    }

    .f-area.auto-filled {
      background: #e8f5e9;
    }

    /* ── Lined textarea — screen view ── */
    .lined-area {
      width: 100%;
      display: block;
      border: none;
      font-family: 'Times New Roman', Times, serif;
      font-size: 11.5px;
      color: #111;
      padding: 4px 7px 0;
      outline: none;
      resize: none;
      line-height: 24px;
      min-height: 192px;
      overflow: hidden;
      box-sizing: border-box;
      background-image: repeating-linear-gradient(to bottom,
          transparent 0px, transparent 23px,
          #b0b0b0 23px, #b0b0b0 24px);
      background-attachment: local;
    }

    .lined-area:focus {
      background-image: repeating-linear-gradient(to bottom,
          #fffde7 0px, #fffde7 23px,
          #999 23px, #999 24px);
      background-attachment: local;
    }

    /* ── Print-only lined rows that replace the textarea for print ── */
    .lined-print-rows {
      display: none;
    }

    .rec-box {
      border: 1px solid #888;
      padding: 6px 10px 7px;
    }

    .chk-item {
      display: flex;
      align-items: flex-start;
      gap: 5px;
      margin-bottom: 3px;
      font-size: 11.5px;
      line-height: 1.4;
    }

    .chk-item:last-child {
      margin-bottom: 0;
    }

    .chk-item input[type=checkbox] {
      margin-top: 2px;
      cursor: pointer;
      flex-shrink: 0;
      accent-color: #1565c0;
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
      font-size: 11.5px;
    }

    .date-in {
      border: none;
      border-bottom: 1px solid #111;
      background: transparent;
      font-family: 'Times New Roman', Times, serif;
      font-size: 11px;
      color: #111;
      padding: 1px 2px;
      outline: none;
      width: 72px;
    }

    .date-in:focus {
      background: #fffde7;
    }

    .other-in {
      border: none;
      border-bottom: 1px solid #111;
      background: transparent;
      font-family: 'Times New Roman', Times, serif;
      font-size: 11px;
      color: #111;
      padding: 1px 2px;
      outline: none;
      flex: 1;
      min-width: 100px;
    }

    .other-in:focus {
      background: #fffde7;
    }

    /* ── Signature rows ── */
    .sig-section {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .sig-row {
      display: flex;
      gap: 30px;
      align-items: flex-end;
    }

    .sig-block {
      flex: 1;
      display: flex;
      align-items: flex-end;
      gap: 5px;
    }

    .sig-lbl {
      font-size: 11px;
      font-weight: bold;
      letter-spacing: .6px;
      text-transform: uppercase;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .sig-line-wrap {
      flex: 1;
      border-bottom: 1.5px solid #111;
      min-height: 20px;
      display: flex;
      align-items: flex-end;
    }

    .sig-name-field {
      width: 100%;
      border: none;
      background: transparent;
      font-family: 'Times New Roman', Times, serif;
      font-size: 11.5px;
      color: #111;
      outline: none;
      padding: 1px 3px;
    }

    .sig-name-field:focus {
      background: #fffde7;
    }

    .sig-canvas-wrap {
      flex: 1;
      border-bottom: 1.5px solid #111;
      min-height: 20px;
      cursor: pointer;
    }

    .sig-canvas-wrap canvas {
      width: 100%;
      height: 24px;
      display: block;
      cursor: crosshair;
    }

    .sig-hint {
      font-size: 9px;
      color: #bbb;
      margin-top: 1px;
      font-family: Arial, sans-serif;
      text-align: center;
    }

    /* ── Attachments ── */
    .attach-section {
      margin-top: 12px;
      border: 1px dashed #aaa;
      padding: 6px 10px;
      background: #fafafa;
    }

    .attach-lbl {
      font-size: 10px;
      font-weight: bold;
      letter-spacing: 1px;
      color: #555;
      margin-bottom: 4px;
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
      color: #1565c0;
      cursor: pointer;
      font-family: Arial, sans-serif;
    }

    .attach-item:hover {
      background: #e3f2fd;
    }

    .attach-item .rm-btn {
      color: #aaa;
      cursor: pointer;
      font-size: 13px;
      border: none;
      background: none;
      padding: 0;
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
      color: #2e7d32;
      background: #e8f5e9;
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

    /* ══════════════════════════════════════════════
     PRINT STYLES
  ══════════════════════════════════════════════ */
    @media print {
      body {
        background: #fff;
        padding: 0;
        margin: 0;
      }

      #toolbar,
      .attach-section,
      .logo-edit-row,
      .logo-upload-btn,
      #logo-clear-btn,
      .af-badge,
      .sig-hint {
        display: none !important;
      }

      #subtitle-wrapper:not(.has-content) {
        display: none !important;
        visibility: hidden !important;
      }

      #company-name-input,
      #company-subtitle-input {
        border-bottom: none !important;
        background: transparent !important;
        -webkit-appearance: none;
        appearance: none;
      }

      #report-canvas {
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        min-height: 0 !important;
      }

      .f-line,
      .f-area,
      .sig-name-field {
        background: transparent !important;
      }

      .f-line.auto-filled,
      .f-area.auto-filled {
        background: transparent !important;
      }

      #company-name-input,
      #company-subtitle-input {
        color: #1565c0 !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        border: none !important;
        width: 100% !important;
        display: block !important;
      }

      .rpt-title,
      .sec-hdr {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      input::placeholder,
      textarea::placeholder {
        color: transparent !important;
      }

      .lined-area {
        display: none !important;
      }

      .lined-print-rows {
        display: block !important;
        width: 100%;
        border: 1px solid #888;
      }

      .lined-print-row {
        height: 24px;
        border-bottom: 1px solid #b0b0b0;
        padding: 0 7px;
        font-family: 'Times New Roman', Times, serif;
        font-size: 11.5px;
        line-height: 24px;
        color: #111;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .lined-print-row:last-child {
        border-bottom: none;
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
    <span style="font-size:10px;color:#666;font-family:Arial,sans-serif;margin-left:4px;">Click any field to edit &nbsp;·&nbsp;</span>
    <div id="autofill-notice" style="display:none;margin-left:auto;font-size:10px;font-family:Arial,sans-serif;color:#2e7d32;background:#e8f5e9;border-radius:3px;padding:2px 8px;">
      ✓ Auto-filled from employee record
    </div>
  </div>

  <!-- ── Report canvas ── -->
  <div id="report-canvas">

    <!-- ── Company header ── -->
    <div class="company-header">
      <div class="company-logo-row">
        <img id="logo-preview" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" alt="Company logo">
        <table style="width:100%;border-collapse:collapse;border-spacing:0;">
          <tbody>
            <tr>
              <td style="padding:0;text-align:center;display:table-cell;">
                <input
                  id="company-name-input"
                  type="text"
                  spellcheck="false"
                  placeholder="COMPANY NAME"
                  title="Click to edit company name"
                  autocomplete="off"
                  value="">
              </td>
            </tr>
            <tr id="subtitle-wrapper" class="has-content">
              <td style="padding:0;text-align:center;display:table-cell;">
                <input
                  id="company-subtitle-input"
                  type="text"
                  spellcheck="false"
                  placeholder="Company Subtitle / Address (optional)"
                  title="Click to edit subtitle"
                  autocomplete="off"
                  value="">
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <!-- Logo controls (hidden on print) -->
      <div class="logo-edit-row">
        <label class="logo-upload-btn" for="logo-file-input" title="Upload logo">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z" />
            <path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z" />
          </svg>
          Upload Logo
        </label>
        <input type="file" id="logo-file-input" accept="image/*" onchange="uploadLogo(this)" style="display:none;">
        <button id="logo-clear-btn" onclick="clearLogo()" title="Remove logo">&#x2715; Remove logo</button>
      </div>
    </div>

    <!-- ── Reported By / Date of Report ── -->
    <div class="f-row" style="margin-top: 50px;">
      <div class="f-cell">
        <span class="f-label"><strong>Reported By:</strong></span>
        <input class="f-line" type="text" id="f_reported_by" placeholder="">
      </div>
      <div class="f-cell shrink">
        <span class="f-label"><strong>Date of Report:</strong></span>
        <input class="f-line" type="text" id="f_report_date" placeholder="" style="width:120px;flex:none;">
      </div>
    </div>

    <!-- ── Department ── -->
    <div class="f-row" style="margin-bottom:16px;">
      <div class="f-cell" style="max-width:380px;">
        <span class="f-label"><strong>Department:</strong></span>
        <input class="f-line" type="text" id="f_report_dept" placeholder="">
      </div>
    </div>

    <!-- ── INCIDENT INFORMATION / REPORT ── -->
    <div class="sec-hdr" style="margin-top:0; text-align:center;">
      Incident Information / Report
    </div>

    <!-- ── Employee Name / Date of Incident ── -->
    <div class="f-row" style="margin-top: 20px;">
      <div class="f-cell">
        <span class="f-label">
          <strong>Employee Name:</strong>
          <span class="af-badge" id="badge-name" style="display:none;">auto-filled</span>
        </span>
        <input class="f-line" type="text" id="f_emp_name" placeholder="">
      </div>
      <div class="f-cell shrink">
        <span class="f-label">
          <strong>Date of Incident:</strong>
          <span class="af-badge" id="badge-date" style="display:none;">auto-filled</span>
        </span>
        <input class="f-line" type="text" id="f_incident_date" placeholder="" style="width:120px;flex:none;">
      </div>
    </div>

    <!-- ── Department / Time of Incident ── -->
    <div class="f-row">
      <div class="f-cell">
        <span class="f-label">
          <strong>Department:</strong>
          <span class="af-badge" id="badge-dept" style="display:none;">auto-filled</span>
        </span>
        <input class="f-line" type="text" id="f_emp_dept" placeholder="">
      </div>
      <div class="f-cell shrink">
        <span class="f-label">
          <strong>Time of Incident:</strong>
          <span class="af-badge" id="badge-time" style="display:none;">auto-filled</span>
        </span>
        <input class="f-line" type="text" id="f_incident_time" placeholder="" style="width:120px;flex:none;">
      </div>
    </div>

    <!-- ── INCIDENT DETAILS ── -->
    <div class="sec-hdr" style="margin-top: 20px;">
      Incident Details
      <span class="af-badge" id="badge-details" style="display:none;">auto-filled from violation record</span>
    </div>
    <div class="box-area">
      <textarea class="f-area" id="f_incident_details" rows="3" placeholder=""></textarea>
    </div>

    <!-- ── EMPLOYEE WRITTEN EXPLANATION ── -->
    <div class="sec-hdr" style="margin-top: 20px;">Employee Written Explanation</div>

    <div class="box-area" id="lined-screen-box">
      <textarea class="lined-area" id="employee-explanation" rows="9" placeholder=""></textarea>
    </div>

    <div class="lined-print-rows" id="lined-print-box">
      <div class="lined-print-row" id="pr0"></div>
      <div class="lined-print-row" id="pr1"></div>
      <div class="lined-print-row" id="pr2"></div>
      <div class="lined-print-row" id="pr3"></div>
      <div class="lined-print-row" id="pr4"></div>
      <div class="lined-print-row" id="pr5"></div>
      <div class="lined-print-row" id="pr6"></div>
      <div class="lined-print-row" id="pr7"></div>
    </div>

    <!-- ── SUPERVISOR / MANAGER RECOMMENDATION ── -->
    <div class="sec-hdr" style="margin-top: 30px;">Supervisor / Manager Recommendation</div>
    <div class="rec-box">
      <div class="chk-item">
        <input type="checkbox">
        <span class="chk-lbl">( &nbsp;) Unang Babala</span>
      </div>
      <div class="chk-item">
        <input type="checkbox">
        <span class="chk-lbl">( &nbsp;) Huling babala na may kaakibat na mabigat na parusa sa susunod na paglabag</span>
      </div>
      <div class="chk-item">
        <input type="checkbox">
        <span class="chk-lbl">( &nbsp;) Isang (1) araw na tigil trabaho</span>
      </div>
      <div class="chk-item">
        <input type="checkbox">
        <div class="chk-inline">
          <span>( &nbsp;) Isang (1) Linggo na tigil trabaho, simula</span>
          <input type="text" class="date-in" placeholder="">
          <span>hanggang</span>
          <input type="text" class="date-in" placeholder="">
        </div>
      </div>
      <div class="chk-item">
        <input type="checkbox">
        <div class="chk-inline">
          <span>( &nbsp;) Dalawang (2) Linggo na tigil trabaho, simula</span>
          <input type="text" class="date-in" placeholder="">
          <span>hanggang</span>
          <input type="text" class="date-in" placeholder="">
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
      <div class="chk-item" style="margin-bottom: 30px;">
        <input type="checkbox">
        <div class="chk-inline">
          <span>( &nbsp;) Others:</span>
          <input type="text" class="other-in" placeholder="">
        </div>
      </div>
    </div>

    <!-- ── Signatures ── -->
    <div class="sig-section">
      <div class="sig-row">
        <div class="sig-block">
          <span class="sig-lbl">Employee Name:</span>
          <div class="sig-line-wrap">
            <input class="sig-name-field" type="text" id="sig_emp_name" placeholder="">
          </div>
        </div>
        <div class="sig-block">
          <span class="sig-lbl">Employee Signature:</span>
          <div class="sig-canvas-wrap" onclick="openSigPad('emp')" title="Click to sign">
            <canvas id="sigCanvas-emp"></canvas>
            <div class="sig-hint">click to sign</div>
          </div>
        </div>
      </div>

      <div class="sig-row">
        <div class="sig-block">
          <span class="sig-lbl">Supervisor Name:</span>
          <div class="sig-line-wrap">
            <input class="sig-name-field" type="text" placeholder="">
          </div>
        </div>
        <div class="sig-block">
          <span class="sig-lbl">Supervisor Signature:</span>
          <div class="sig-canvas-wrap" onclick="openSigPad('sup')" title="Click to sign">
            <canvas id="sigCanvas-sup"></canvas>
            <div class="sig-hint">click to sign</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Attachments ── -->
    <div class="attach-section" id="attach-section">
      <div class="attach-lbl">Attachments</div>
      <div class="attach-list" id="attach-list">
        <span class="no-attach">No attachments added.</span>
      </div>
    </div>

  </div>

  <!-- ── Signature modal ── -->
  <div id="sigModal">
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
    /* ══════════════════════════════════════════
     Default company name constants
  ══════════════════════════════════════════ */
    const DEFAULT_COMPANY_NAME = '';
    const DEFAULT_COMPANY_SUBTITLE = '';

    const LS_NAME_KEY = 'ir_company_name';
    const LS_SUBTITLE_KEY = 'ir_company_subtitle';
    const LS_LOGO_KEY = 'ir_company_logo';

    function applyCompanyName(name, subtitle) {
      const nameEl = document.getElementById('company-name-input');
      const subEl = document.getElementById('company-subtitle-input');
      if (name !== undefined && name !== null) {
        nameEl.value = name;
      }
      if (subtitle !== undefined && subtitle !== null) {
        subEl.value = subtitle;
      }
      updateSubtitlePrintClass();
    }

    function updateSubtitlePrintClass() {
      const subEl = document.getElementById('company-subtitle-input');
      const wrapper = document.getElementById('subtitle-wrapper');
      const hasContent = subEl.value.trim().length > 0;
      if (hasContent) {
        wrapper.classList.add('has-content');
      } else {
        wrapper.classList.remove('has-content');
      }
    }

    (function loadFromLocalStorage() {
      let name = localStorage.getItem(LS_NAME_KEY);
      let subtitle = localStorage.getItem(LS_SUBTITLE_KEY);

      if (name === null) {
        name = DEFAULT_COMPANY_NAME;
        localStorage.setItem(LS_NAME_KEY, name);
      }
      if (subtitle === null) {
        subtitle = DEFAULT_COMPANY_SUBTITLE;
        localStorage.setItem(LS_SUBTITLE_KEY, subtitle);
      }

      applyCompanyName(name, subtitle);
      updateSubtitlePrintClass();
    })();

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

        let name = '',
          subtitle = '';
        if (data.name) {
          const parts = data.name.split('\n');
          name = parts[0] || '';
          subtitle = parts[1] || '';
        }

        if (!name) name = DEFAULT_COMPANY_NAME;
        if (!subtitle) subtitle = DEFAULT_COMPANY_SUBTITLE;

        const nameEl = document.getElementById('company-name-input');
        const subEl = document.getElementById('company-subtitle-input');
        if (nameEl.value !== name) nameEl.value = name;
        if (subEl.value !== subtitle) subEl.value = subtitle;

        localStorage.setItem(LS_NAME_KEY, name);
        localStorage.setItem(LS_SUBTITLE_KEY, subtitle);

        if (data.logo) {
          const img = document.getElementById('logo-preview');
          img.src = data.logo;
          img.style.display = 'block';
          document.getElementById('logo-clear-btn').style.display = 'inline';
          localStorage.setItem(LS_LOGO_KEY, data.logo);
        }

        updateSubtitlePrintClass();
      } catch (e) {
        console.warn('Could not load company settings:', e);
      }
    }

    let saveTimer = null;

    function scheduleSave() {
      const nameEl = document.getElementById('company-name-input');
      const subEl = document.getElementById('company-subtitle-input');
      localStorage.setItem(LS_NAME_KEY, nameEl.value.trim());
      localStorage.setItem(LS_SUBTITLE_KEY, subEl.value.trim());
      updateSubtitlePrintClass();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveCompanyData, 800);
    }

    async function saveCompanyData() {
      try {
        const line1 = document.getElementById('company-name-input').value.trim();
        const line2 = document.getElementById('company-subtitle-input').value.trim();
        const name = line2 ? line1 + '\n' + line2 : line1;

        const img = document.getElementById('logo-preview');
        const placeholder = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
        const logo = (img && img.style.display !== 'none' && img.src !== placeholder) ? img.src : '';

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

    document.getElementById('company-name-input').addEventListener('input', scheduleSave);
    document.getElementById('company-subtitle-input').addEventListener('input', scheduleSave);

    /* ── Logo ── */
    function uploadLogo(input) {
      if (!input.files.length) return;
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 220 / img.width);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const resized = canvas.toDataURL('image/webp', 0.85);
          const logoImg = document.getElementById('logo-preview');
          logoImg.src = resized;
          logoImg.style.display = 'block';
          document.getElementById('logo-clear-btn').style.display = 'inline';
          localStorage.setItem(LS_LOGO_KEY, resized);
          saveCompanyData();
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(input.files[0]);
      input.value = '';
    }

    function clearLogo() {
      const img = document.getElementById('logo-preview');
      img.src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
      img.style.display = 'none';
      document.getElementById('logo-clear-btn').style.display = 'none';
      localStorage.removeItem(LS_LOGO_KEY);
      saveCompanyData();
    }

    /* ── Helpers ── */
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

    const EDITABLE_AUTOFILL_IDS = new Set(['f_report_date', 'f_incident_date', 'f_incident_time']);

    function setAutoFilled(inputEl, value, badgeId) {
      if (!value || !inputEl) return;
      inputEl.value = value;
      inputEl.classList.add('auto-filled');
      if (!EDITABLE_AUTOFILL_IDS.has(inputEl.id)) {
        inputEl.readOnly = true;
        inputEl.style.cursor = 'not-allowed';
        inputEl.title = 'Auto-filled — cannot be edited';
      }
      const b = badgeId ? document.getElementById(badgeId) : null;
      if (b) b.style.display = 'inline-flex';
    }

    /* ── Auto-fill from URL params ── */
    function autoFillFromParams() {
      const fullname = getParam('fullname');
      const brand = getParam('brand');
      const position = getParam('position');
      const shift = getParam('shift');
      const violation = getParam('violation');
      const ts = getParam('ts');
      let anyFilled = false;

      if (fullname) {
        setAutoFilled(document.getElementById('f_emp_name'), toProperCase(fullname), 'badge-name');
        const sigNameEl = document.getElementById('sig_emp_name');
        sigNameEl.value = toProperCase(fullname);
        sigNameEl.readOnly = true;
        sigNameEl.style.cursor = 'not-allowed';
        sigNameEl.title = 'Auto-filled — cannot be edited';
        anyFilled = true;
      }

      if (brand) {
        setAutoFilled(document.getElementById('f_emp_dept'), toProperCase(brand), 'badge-dept');
        anyFilled = true;
      }

      if (position || shift) {
        const posShift = [toProperCase(position), shift].filter(Boolean).join(' — ');
        if (!brand) {
          const el = document.getElementById('f_emp_dept');
          if (el) {
            el.value = posShift;
            el.classList.add('auto-filled');
            el.readOnly = true;
            el.style.cursor = 'not-allowed';
            el.title = 'Auto-filled — cannot be edited';
          }
        }
        anyFilled = true;
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
    let attachments = [];

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
    .p{background:#1565c0;color:#fff;}.c{background:#555;color:#fff;}img{max-width:100%;border-radius:4px;}embed{width:100%;min-height:85vh;}h3{color:#fff;font-size:14px;margin-bottom:12px;}</style>
    </head><body><h3>${a.name}</h3>
    <div class="tb"><button class="p" onclick="window.print()">Print</button><button class="c" onclick="window.close()">Close</button></div>
    ${a.type.startsWith('image/') ? `<img src="${a.url}" alt="${a.name}">` : `<embed src="${a.url}" type="application/pdf">`}
    </body></html>`);
      win.document.close();
    }

    /* ── Clear form ── */
    function clearForm() {
      if (!confirm('Clear all manually-entered fields? Auto-filled values will remain.')) return;
      document.querySelectorAll('#report-canvas input[type=text]:not(.auto-filled):not(#company-name-input):not(#company-subtitle-input), #report-canvas textarea:not(.auto-filled)')
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
    let activeSigTarget = null;
    let sigPadDrawing = false;
    let sigPadCtx = null;

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
      targetCanvas.height = 32 * dpr;
      const ctx = targetCanvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, rect.width, 32);
      ctx.drawImage(padCanvas, 0, 0, rect.width, 32);
      closeSigPad();
    }

    function syncPrintRows() {
      const ta = document.getElementById('employee-explanation');
      const lines = ta.value.split('\n');
      for (let i = 0; i < 8; i++) {
        const row = document.getElementById('pr' + i);
        if (row) row.textContent = lines[i] || '';
      }
    }

    window.addEventListener('beforeprint', syncPrintRows);

    /* ── Init ── */
    loadSavedCompany();
    autoFillFromParams();
  </script>