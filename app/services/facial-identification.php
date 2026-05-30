<?php
// app/services/facial-identification.php

ob_start();
if (session_status() === PHP_SESSION_NONE) {
  session_start();
}
ob_clean();

require_once __DIR__ . '/../../config/config.php';
require_once __DIR__ . '/../../config/db.php';

requireAccess('facial', '../../index.php');

$myDb      = htmlspecialchars($_SESSION['my_database'] ?? 'My Database', ENT_QUOTES, 'UTF-8');
$userId    = (int) ($_SESSION['user_id']  ?? 0);
$username  = htmlspecialchars($_SESSION['username'] ?? 'User', ENT_QUOTES, 'UTF-8');
$csrfToken = htmlspecialchars($_SESSION['csrf_token'] ?? '', ENT_QUOTES, 'UTF-8');

$photoCount = 0;
try {
  $db = getUserDBConnection($userId);
  $s  = $db->query("SELECT COUNT(*) FROM employees WHERE status='Active' AND image IS NOT NULL AND image != ''");
  if ($s) $photoCount = (int) $s->fetchColumn();
} catch (Exception $e) {
}
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge,chrome=1">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-Content-Type-Options" content="nosniff">
  <meta http-equiv="X-Frame-Options" content="SAMEORIGIN">
  <title><?= $myDb ?> — Facial ID</title>
  <link rel="icon" href="../../resource/assets/icon/database-icon.png" type="image/png">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>
    *,
    *::before,
    *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    :root {
      --bg: #09101f;
      --surf: #101828;
      --surf2: #192132;
      --border: rgba(255, 255, 255, .07);
      --accent: #2563eb;
      --accent2: #60a5fa;
      --green: #10b981;
      --red: #ef4444;
      --amber: #f59e0b;
      --text: #f1f5f9;
      --muted: #64748b;
      --r: 10px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .topbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 16px;
      height: 48px;
      background: var(--surf);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }

    .back-btn {
      width: 32px;
      height: 32px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 7px;
      color: var(--muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: .15s;
    }

    .back-btn:hover {
      background: var(--surf2);
      color: var(--text);
    }

    .topbar-title {
      font-size: 14px;
      font-weight: 600;
      flex: 1;
    }

    .topbar-title span {
      color: var(--muted);
      font-weight: 400;
    }

    .ref-progress {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      color: var(--muted);
      white-space: nowrap;
    }

    .ref-mini-bar {
      width: 60px;
      height: 4px;
      border-radius: 2px;
      background: var(--surf2);
      overflow: hidden;
    }

    .ref-mini-fill {
      height: 100%;
      border-radius: 2px;
      background: var(--accent);
      transition: width .3s ease;
      width: 0%;
    }

    .ref-mini-fill.done {
      background: var(--green);
    }

    .s-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .02em;
    }

    .s-pill.idle {
      background: rgba(100, 116, 139, .12);
      color: var(--muted);
    }

    .s-pill.loading {
      background: rgba(245, 158, 11, .12);
      color: var(--amber);
    }

    .s-pill.live {
      background: rgba(16, 185, 129, .12);
      color: var(--green);
    }

    .s-pill.matched {
      background: rgba(37, 99, 235, .12);
      color: var(--accent2);
    }

    .s-pill.verifying {
      background: rgba(245, 158, 11, .12);
      color: var(--amber);
    }

    .s-pill.nomatch {
      background: rgba(239, 68, 68, .12);
      color: var(--red);
    }

    .s-pill .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .s-pill .dot.pulse {
      animation: blink 1.1s ease-in-out infinite;
    }

    @keyframes blink {

      0%,
      100% {
        opacity: 1
      }

      50% {
        opacity: .25
      }
    }

    .workspace {
      display: grid;
      grid-template-columns: 1fr 310px;
      flex: 1;
      overflow: hidden;
    }

    .cam-panel {
      position: relative;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    #videoEl {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }

    #overlayCanvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .cf {
      position: absolute;
      width: 200px;
      height: 200px;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .cf::before,
    .cf::after,
    .cf>b::before,
    .cf>b::after {
      content: '';
      position: absolute;
      width: 28px;
      height: 28px;
      border-color: var(--accent2);
      border-style: solid;
    }

    .cf::before {
      top: 0;
      left: 0;
      border-width: 2px 0 0 2px;
      border-radius: 3px 0 0 0;
    }

    .cf::after {
      top: 0;
      right: 0;
      border-width: 2px 2px 0 0;
      border-radius: 0 3px 0 0;
    }

    .cf>b::before {
      bottom: 0;
      left: 0;
      border-width: 0 0 2px 2px;
      border-radius: 0 0 0 3px;
    }

    .cf>b::after {
      bottom: 0;
      right: 0;
      border-width: 0 2px 2px 0;
      border-radius: 0 0 3px 0;
    }

    .scan-line {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -90px);
      width: 160px;
      height: 2px;
      background: linear-gradient(90deg, transparent 0%, var(--accent2) 50%, transparent 100%);
      border-radius: 1px;
      opacity: 0;
      animation: scanMove 2.2s ease-in-out infinite;
    }

    .scan-line.active {
      opacity: .8;
    }

    @keyframes scanMove {

      0%,
      100% {
        top: calc(50% - 90px)
      }

      50% {
        top: calc(50% + 90px)
      }
    }

    .flash {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0;
      transition: opacity .2s;
    }

    .flash.show {
      opacity: 1;
    }

    .flash.ok {
      background: rgba(16, 185, 129, .18);
    }

    .flash.err {
      background: rgba(239, 68, 68, .18);
    }

    .flash.ver {
      background: rgba(245, 158, 11, .18);
    }

    /* Verify ring — pulses around the bounding box while accumulating frames */
    .verify-hud {
      position: absolute;
      pointer-events: none;
      border: 2px solid var(--amber);
      border-radius: 6px;
      box-shadow: 0 0 10px rgba(245, 158, 11, .4);
      transition: opacity .2s;
      display: none;
    }

    .verify-hud.show {
      display: block;
    }

    /* Verify progress arc overlay on top-right of camera */
    .verify-arc {
      position: absolute;
      top: 14px;
      right: 14px;
      width: 52px;
      height: 52px;
      display: none;
      z-index: 6;
    }

    .verify-arc.show {
      display: block;
    }

    .verify-arc svg {
      width: 52px;
      height: 52px;
      transform: rotate(-90deg);
    }

    .verify-arc circle.track {
      fill: none;
      stroke: rgba(255, 255, 255, .08);
      stroke-width: 4;
    }

    .verify-arc circle.fill {
      fill: none;
      stroke: var(--amber);
      stroke-width: 4;
      stroke-linecap: round;
      stroke-dasharray: 138.2;
      /* 2π × 22 */
      stroke-dashoffset: 138.2;
      transition: stroke-dashoffset .15s linear, stroke .2s;
    }

    .verify-arc circle.fill.done {
      stroke: var(--green);
    }

    .verify-arc-label {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      color: var(--amber);
    }

    .verify-arc-label.done {
      color: var(--green);
    }

    .preload-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      background: var(--surf);
      z-index: 5;
    }

    .preload-overlay.hidden {
      display: none;
    }

    .preload-overlay i {
      font-size: 38px;
      color: var(--accent2);
      opacity: .7;
    }

    .preload-overlay p {
      font-size: 12px;
      color: var(--muted);
      text-align: center;
      max-width: 240px;
      line-height: 1.6;
    }

    .preload-track {
      width: 200px;
      height: 6px;
      border-radius: 3px;
      background: var(--surf2);
      overflow: hidden;
    }

    .preload-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--accent);
      transition: width .3s ease;
      width: 0%;
    }

    .preload-fill.done {
      background: var(--green);
    }

    .preload-label {
      font-size: 11px;
      color: var(--muted);
    }

    .cam-off {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--muted);
      background: var(--surf);
    }

    .cam-off i {
      font-size: 44px;
      opacity: .35;
    }

    .cam-off p {
      font-size: 12px;
      max-width: 220px;
      text-align: center;
      line-height: 1.6;
    }

    .model-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--surf2);
    }

    .model-bar-fill {
      height: 100%;
      background: var(--accent);
      transition: width .35s ease;
      width: 0%;
    }

    .side {
      background: var(--surf);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sec {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
    }

    .sec-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: var(--muted);
      margin-bottom: 8px;
      font-weight: 600;
    }

    .tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      background: var(--surf2);
      border-radius: 7px;
      padding: 3px;
      gap: 2px;
    }

    .tab {
      padding: 6px 0;
      text-align: center;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      color: var(--muted);
      border: none;
      background: transparent;
      transition: .15s;
    }

    .tab.on {
      background: var(--accent);
      color: #fff;
    }

    .tab:hover:not(.on) {
      color: var(--text);
    }

    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 12px;
      height: 34px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid var(--border);
      transition: .15s;
      background: transparent;
      color: var(--text);
    }

    .btn.pri {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }

    .btn.pri:hover {
      background: #1d4ed8;
    }

    .btn.dan {
      background: rgba(239, 68, 68, .1);
      border-color: rgba(239, 68, 68, .3);
      color: var(--red);
    }

    .btn:hover:not(.pri):not(.dan) {
      background: var(--surf2);
    }

    .btn:disabled {
      opacity: .4;
      cursor: default;
      pointer-events: none;
    }

    .btn-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 10px;
    }

    .cam-sel {
      width: 100%;
      padding: 7px 9px;
      border-radius: 7px;
      background: var(--surf2);
      border: 1px solid var(--border);
      color: var(--text);
      font-size: 12px;
      cursor: pointer;
      outline: none;
    }

    /* Strict mode toggle */
    .strict-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
      padding: 7px 9px;
      background: var(--surf2);
      border-radius: 7px;
      border: 1px solid var(--border);
    }

    .strict-row label {
      font-size: 11px;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    .strict-row label i {
      color: var(--amber);
    }

    .toggle {
      position: relative;
      width: 34px;
      height: 18px;
    }

    .toggle input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .toggle-slider {
      position: absolute;
      inset: 0;
      background: var(--surf);
      border-radius: 9px;
      border: 1px solid var(--border);
      cursor: pointer;
      transition: .2s;
    }

    .toggle-slider::before {
      content: '';
      position: absolute;
      width: 12px;
      height: 12px;
      left: 2px;
      top: 2px;
      border-radius: 50%;
      background: var(--muted);
      transition: .2s;
    }

    .toggle input:checked+.toggle-slider {
      background: var(--amber);
      border-color: var(--amber);
    }

    .toggle input:checked+.toggle-slider::before {
      transform: translateX(16px);
      background: #fff;
    }

    .result-card {
      border: 1px solid var(--border);
      border-radius: var(--r);
      background: var(--surf2);
      overflow: hidden;
    }

    .emp-photo {
      width: 100%;
      aspect-ratio: 4/3;
      object-fit: cover;
      background: var(--surf);
      display: block;
    }

    .emp-no-photo {
      width: 100%;
      aspect-ratio: 4/3;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surf);
      color: var(--muted);
      font-size: 36px;
    }

    .emp-info {
      padding: 10px 12px;
    }

    .emp-name {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 2px;
    }

    .emp-sub {
      font-size: 11px;
      color: var(--muted);
      line-height: 1.6;
    }

    .emp-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 7px;
    }

    .badge {
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
    }

    .badge.in {
      background: rgba(16, 185, 129, .15);
      color: var(--green);
    }

    .badge.out {
      background: rgba(239, 68, 68, .15);
      color: var(--red);
    }

    .badge.act {
      background: rgba(37, 99, 235, .15);
      color: var(--accent2);
    }

    .badge.ina {
      background: rgba(100, 116, 139, .15);
      color: var(--muted);
    }

    .badge.shf {
      background: rgba(245, 158, 11, .15);
      color: var(--amber);
    }

    .conf-label {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--muted);
      margin: 8px 0 4px;
    }

    .conf-track {
      height: 5px;
      border-radius: 3px;
      background: var(--surf2);
      overflow: hidden;
    }

    .conf-fill {
      height: 100%;
      border-radius: 3px;
      background: var(--accent);
      transition: width .5s ease, background .3s;
    }

    .conf-fill.hi {
      background: var(--green);
    }

    .conf-fill.mid {
      background: var(--amber);
    }

    .conf-fill.lo {
      background: var(--red);
    }

    /* Consecutive-frames indicator */
    .frames-row {
      display: flex;
      gap: 4px;
      margin-top: 6px;
      align-items: center;
    }

    .frames-row span {
      font-size: 10px;
      color: var(--muted);
      margin-right: 2px;
    }

    .frame-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--surf2);
      border: 1px solid var(--border);
      transition: background .15s;
    }

    .frame-dot.hit {
      background: var(--amber);
      border-color: var(--amber);
    }

    .frame-dot.confirmed {
      background: var(--green);
      border-color: var(--green);
    }

    .slider-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    .slider-row label {
      font-size: 11px;
      color: var(--muted);
    }

    .slider-row input[type=range] {
      flex: 1;
    }

    .slider-val {
      font-size: 11px;
      font-weight: 600;
      min-width: 32px;
      text-align: right;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
    }

    .stat {
      background: var(--surf2);
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 9px 10px;
      text-align: center;
    }

    .stat-n {
      font-size: 18px;
      font-weight: 700;
      line-height: 1;
    }

    .stat-l {
      font-size: 9px;
      color: var(--muted);
      margin-top: 3px;
      text-transform: uppercase;
    }

    .stat-n.g {
      color: var(--green);
    }

    .stat-n.r {
      color: var(--red);
    }

    .stat-n.a {
      color: var(--accent2);
    }

    .log-feed {
      flex: 1;
      overflow-y: auto;
    }

    .log-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border);
      font-size: 11px;
    }

    .log-item:last-child {
      border-bottom: none;
    }

    .log-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .log-icon.ok {
      background: rgba(16, 185, 129, .12);
      color: var(--green);
    }

    .log-icon.no {
      background: rgba(239, 68, 68, .12);
      color: var(--red);
    }

    .log-icon.inf {
      background: rgba(37, 99, 235, .12);
      color: var(--accent2);
    }

    .log-body {
      flex: 1;
      min-width: 0;
    }

    .log-name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .log-meta {
      color: var(--muted);
      line-height: 1.5;
    }

    .log-time {
      font-size: 10px;
      color: var(--muted);
      flex-shrink: 0;
      margin-top: 2px;
    }

    .notice {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(9, 16, 31, .9);
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 7px 14px;
      border-radius: 7px;
      font-size: 11px;
      white-space: nowrap;
      pointer-events: none;
    }

    @media (max-width:680px) {
      .workspace {
        grid-template-columns: 1fr;
        grid-template-rows: 55vh 1fr;
      }

      .side {
        border-left: none;
        border-top: 1px solid var(--border);
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }

      .log-feed {
        overflow-y: visible;
      }
    }

    ::-webkit-scrollbar {
      width: 4px;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--surf2);
      border-radius: 4px;
    }
  </style>
</head>

<body>

  <!-- Topbar -->
  <div class="topbar">
    <button class="back-btn" tabindex="-1" onclick="window.history.back()" title="Back">
      <i class="fas fa-arrow-left" style="font-size:11px;"></i>
    </button>
    <div class="topbar-title">
    </div>
    <div id="sPill" class="s-pill idle">
      <span class="dot"></span>
      <span id="sText">Idle</span>
    </div>
    <div class="ref-progress" id="refProgress">
      <i class="fas fa-images"></i>
      <span id="refCount">0</span> / <span id="refTotal"><?= $photoCount ?></span>
      <div class="ref-mini-bar">
        <div class="ref-mini-fill" id="refMiniFill"></div>
      </div>
    </div>
  </div>

  <!-- Workspace -->
  <div class="workspace">

    <div class="cam-panel" id="camPanel">

      <div class="preload-overlay" id="preloadOverlay">
        <i class="fas fa-brain"></i>
        <p id="preloadMsg">Loading AI models…</p>
        <div class="preload-track">
          <div class="preload-fill" id="preloadFill"></div>
        </div>
        <div class="preload-label" id="preloadLabel">Please wait</div>
      </div>

      <div class="cam-off" id="camOff" style="display:none;">
        <i class="fas fa-camera"></i>
        <p>References ready. Click <strong>Start</strong> to begin scanning.</p>
      </div>

      <video id="videoEl" autoplay playsinline muted></video>
      <canvas id="overlayCanvas"></canvas>

      <!-- Amber verify ring drawn over bounding box area -->
      <div class="verify-hud" id="verifyHud"></div>

      <!-- Arc progress indicator (top-right of camera) -->
      <div class="verify-arc" id="verifyArc">
        <svg viewBox="0 0 52 52">
          <circle class="track" cx="26" cy="26" r="22" />
          <circle class="fill" cx="26" cy="26" r="22" id="arcFill" />
        </svg>
        <div class="verify-arc-label" id="arcLabel">0</div>
      </div>

      <div class="cf" id="cf" style="display:none;"><b></b></div>
      <div class="scan-line" id="scanLine"></div>
      <div class="flash" id="flash"></div>

      <div class="model-bar" id="modelBar" style="display:none;">
        <div class="model-bar-fill" id="modelBarFill"></div>
      </div>
      <div class="notice" id="notice" style="display:none;"></div>
    </div>

    <!-- Side panel -->
    <div class="side">

      <div class="sec">
        <div class="sec-label">Camera</div>
        <select class="cam-sel" id="camSel" onchange="switchCam()">
          <option value="">Select camera…</option>
        </select>
        <div class="btn-row">
          <button class="btn pri" id="startBtn" tabindex="-1" onclick="startCam()" disabled>
            <i class="fas fa-play"></i> Start
          </button>
          <button class="btn dan" id="stopBtn" tabindex="-1" onclick="stopCam()" disabled>
            <i class="fas fa-stop"></i> Stop
          </button>
          <button class="btn" id="pauseBtn" tabindex="-1" onclick="togglePause()" disabled>
            <i class="fas fa-pause"></i> Pause
          </button>
        </div>
      </div>

      <div class="sec">
        <div class="sec-label">Check Type</div>
        <div class="tabs">
          <button class="tab on" id="tabIn" tabindex="-1" onclick="setCheck('IN')">
            <i class="fas fa-sign-in-alt" style="margin-right:4px;"></i>Check In
          </button>
          <button class="tab" id="tabOut" tabindex="-1" onclick="setCheck('OUT')">
            <i class="fas fa-sign-out-alt" style="margin-right:4px;"></i>Check Out
          </button>
        </div>

        <!-- Strict mode toggle -->
        <div class="strict-row">
          <label for="strictToggle">
            <i class="fas fa-shield-alt"></i> Strict Mode
          </label>
          <label class="toggle">
            <input type="checkbox" id="strictToggle" checked onchange="updateStrictMode()">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="slider-row">
          <label>Distance limit</label>
          <input type="range" min="25" max="60" value="35" id="threshSlider"
            oninput="updateThresh(this.value)" step="1">
          <span class="slider-val" id="threshVal">0.35</span>
        </div>

        <div class="slider-row">
          <label>Required frames</label>
          <input type="range" min="1" max="6" value="3" id="framesSlider"
            oninput="updateFramesReq(this.value)" step="1">
          <span class="slider-val" id="framesVal">3</span>
        </div>
      </div>

      <div class="sec">
        <div class="sec-label">Last Match</div>
        <div id="resultBox">
          <div class="result-card">
            <div class="emp-no-photo"><i class="fas fa-user"></i></div>
            <div class="emp-info">
              <div class="emp-name" style="color:var(--muted);font-size:12px;">Awaiting scan…</div>
              <div class="emp-sub">No identification yet</div>
            </div>
          </div>
        </div>
        <div class="conf-label">
          <span>Confidence</span><span id="confPct">—</span>
        </div>
        <div class="conf-track">
          <div class="conf-fill" id="confFill" style="width:0%;"></div>
        </div>
        <!-- Frame accumulation dots -->
        <div class="frames-row" id="framesRow" style="display:none;">
          <span>Verifying</span>
          <!-- dots injected by JS -->
        </div>
      </div>

      <div class="sec">
        <div class="stats-grid">
          <div class="stat">
            <div class="stat-n a" id="stS">0</div>
            <div class="stat-l">Scanned</div>
          </div>
          <div class="stat">
            <div class="stat-n g" id="stM">0</div>
            <div class="stat-l">Matched</div>
          </div>
          <div class="stat">
            <div class="stat-n r" id="stN">0</div>
            <div class="stat-l">No Match</div>
          </div>
        </div>
      </div>

      <div class="sec" style="border-bottom:none; padding-bottom:6px;">
        <div class="sec-label">Activity Log</div>
      </div>
      <div class="log-feed" id="logFeed">
        <div style="padding:18px 14px; text-align:center; color:var(--muted); font-size:11px;">
          <i class="fas fa-history" style="font-size:20px;display:block;margin-bottom:7px;opacity:.3;"></i>
          No activity yet
        </div>
      </div>

    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"></script>
  <script>
    "use strict";

    // ── Config ────────────────────────────────────────────────────────────────────
    const CSRF = <?= json_encode($_SESSION['csrf_token'] ?? '') ?>;
    const MODELS_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/';
    const DETECT_MS = 600; // ms between recognition frames (faster for accumulation)
    const COOLDOWN_MS = 5000; // ms before same employee can be logged again
    const MIN_DET_CONF = 0.70; // raised detector gate — reject low-quality face crops

    // ── Strict-match config (user-adjustable) ─────────────────────────────────────
    // Distance: 0.0 = identical descriptor, 1.0 = completely different.
    // Default 0.35 is very tight — only near-identical faces pass.
    let DISTANCE_LIMIT = 0.35; // slider range 0.25–0.60
    let FRAMES_REQUIRED = 3; // how many consecutive frames must agree before confirming
    let strictMode = true; // when false, behaves like standard single-frame matching

    // ── State ─────────────────────────────────────────────────────────────────────
    let stream = null;
    let rafId = null;
    let detecting = false;
    let paused = false;
    let modelsReady = false;
    let refsReady = false;
    let refsLoading = false;
    let checkType = 'IN';
    let lastDetect = 0;
    let cooldowns = {};
    let activeDeviceId = null;

    // Descriptor store
    let labeledDescriptors = [];
    let matcher = null;
    let loadedRef = 0;
    let totalRef = 0;

    // ── Multi-frame verification state ───────────────────────────────────────────
    // Tracks consecutive frame agreements per candidate qr_code.
    // Structure: { qr_code: { count, distances: [] } }
    let verifyAccum = {};

    const stats = {
      s: 0,
      m: 0,
      n: 0
    };

    const video = document.getElementById('videoEl');
    const canvas = document.getElementById('overlayCanvas');
    const ctx = canvas.getContext('2d');

    // ── Descriptor cache helpers ──────────────────────────────────────────────────
    const CACHE_KEY = 'faceDescCache_v1_' + <?= json_encode($_SESSION['my_database'] ?? '') ?>;
    const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 1 day

    function saveDescriptorCache(entries) {
      // entries: [{ qr_code, descriptor: Float32Array, emp: {...} }]
      try {
        const payload = {
          ts: Date.now(),
          data: entries.map(e => ({
            qr_code: e.qr_code,
            descriptor: Array.from(e.descriptor), // Float32Array → plain array for JSON
            emp: e.emp,
          }))
        };
        localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      } catch (_) {
        /* quota exceeded — silently skip */
      }
    }

    function loadDescriptorCache() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const payload = JSON.parse(raw);
        if (Date.now() - payload.ts > CACHE_MAX_AGE_MS) {
          localStorage.removeItem(CACHE_KEY);
          return null;
        }
        return payload.data; // [{ qr_code, descriptor: number[], emp }]
      } catch (_) {
        return null;
      }
    }

    function invalidateDescriptorCache() {
      localStorage.removeItem(CACHE_KEY);
    }

    // ── Strict mode controls ──────────────────────────────────────────────────────
    function updateStrictMode() {
      strictMode = document.getElementById('strictToggle').checked;
      document.getElementById('framesSlider').disabled = !strictMode;
    }

    function updateThresh(v) {
      DISTANCE_LIMIT = parseInt(v) / 100;
      document.getElementById('threshVal').textContent = (DISTANCE_LIMIT).toFixed(2);
      if (labeledDescriptors.length) rebuildMatcher();
      resetVerify();
    }

    function updateFramesReq(v) {
      FRAMES_REQUIRED = parseInt(v);
      document.getElementById('framesVal').textContent = v;
      rebuildFrameDots();
      resetVerify();
    }

    // ── Frame-dot UI ──────────────────────────────────────────────────────────────
    function rebuildFrameDots() {
      const row = document.getElementById('framesRow');
      const dots = row.querySelectorAll('.frame-dot');
      dots.forEach(d => d.remove());
      for (let i = 0; i < FRAMES_REQUIRED; i++) {
        const d = document.createElement('div');
        d.className = 'frame-dot';
        d.id = 'fd' + i;
        row.appendChild(d);
      }
    }

    function setFrameDots(count, confirmed) {
      for (let i = 0; i < FRAMES_REQUIRED; i++) {
        const d = document.getElementById('fd' + i);
        if (!d) continue;
        d.className = 'frame-dot' + (confirmed ? ' confirmed' : (i < count ? ' hit' : ''));
      }
    }

    // ── Arc progress ──────────────────────────────────────────────────────────────
    const CIRC = 2 * Math.PI * 22; // 138.2
    function setArc(count, confirmed) {
      const arc = document.getElementById('verifyArc');
      const fill = document.getElementById('arcFill');
      const lbl = document.getElementById('arcLabel');
      const req = strictMode ? FRAMES_REQUIRED : 1;

      if (count === 0) {
        arc.classList.remove('show');
        return;
      }
      arc.classList.add('show');

      const pct = Math.min(count / req, 1);
      const offset = CIRC * (1 - pct);
      fill.style.strokeDashoffset = offset;

      if (confirmed) {
        fill.classList.add('done');
        lbl.classList.add('done');
        lbl.textContent = '✓';
      } else {
        fill.classList.remove('done');
        lbl.classList.remove('done');
        lbl.textContent = count;
      }
    }

    // ── Verify HUD (amber rect overlay on canvas coords) ────────────────────────
    function showVerifyHud(box) {
      // box is in video pixel space; we need to map to cam-panel CSS space
      const hud = document.getElementById('verifyHud');
      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      const panel = document.getElementById('camPanel').getBoundingClientRect();
      const scaleX = panel.width / vw;
      const scaleY = panel.height / vh;
      const mirX = vw - box.x - box.width;
      hud.style.left = (mirX * scaleX) + 'px';
      hud.style.top = (box.y * scaleY) + 'px';
      hud.style.width = (box.width * scaleX) + 'px';
      hud.style.height = (box.height * scaleY) + 'px';
      hud.classList.add('show');
    }

    function hideVerifyHud() {
      document.getElementById('verifyHud').classList.remove('show');
    }

    // ── Reset verification accumulator ───────────────────────────────────────────
    function resetVerify(keepQr) {
      if (keepQr) {
        Object.keys(verifyAccum).forEach(k => {
          if (k !== keepQr) delete verifyAccum[k];
        });
      } else {
        verifyAccum = {};
      }
      if (!keepQr) {
        hideVerifyHud();
        setArc(0, false);
        document.getElementById('framesRow').style.display = 'none';
      }
    }

    // ── Preload overlay helpers ───────────────────────────────────────────────────
    function setPreloadMsg(m) {
      document.getElementById('preloadMsg').textContent = m;
    }

    function setPreloadLabel(l) {
      document.getElementById('preloadLabel').textContent = l;
    }

    function setPreloadPct(p) {
      const f = document.getElementById('preloadFill');
      f.style.width = p + '%';
      if (p >= 100) f.classList.add('done');
    }

    function hidePreloadOverlay() {
      document.getElementById('preloadOverlay').classList.add('hidden');
      document.getElementById('camOff').style.display = 'flex';
    }

    function setRefProgress(loaded, total) {
      document.getElementById('refCount').textContent = loaded;
      document.getElementById('refTotal').textContent = total;
      const p = total > 0 ? Math.round((loaded / total) * 100) : 0;
      const f = document.getElementById('refMiniFill');
      f.style.width = p + '%';
      if (loaded >= total && total > 0) f.classList.add('done');
    }

    // ── Load models ───────────────────────────────────────────────────────────────
    async function loadModels() {
      setPreloadMsg('Loading AI models…');
      setPreloadLabel('Detection model');
      setPreloadPct(5);
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS_URL);
      setPreloadLabel('Landmark model');
      setPreloadPct(40);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS_URL);
      setPreloadLabel('Recognition model');
      setPreloadPct(75);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS_URL);
      setPreloadPct(100);
      modelsReady = true;
    }

    // ── Rebuild matcher ───────────────────────────────────────────────────────────
    function rebuildMatcher() {
      if (!labeledDescriptors.length) return;
      const dist = strictMode ? DISTANCE_LIMIT : 0.6;
      matcher = new faceapi.FaceMatcher(labeledDescriptors, dist);
    }

    // ── Preload references (lazy, one-by-one) ────────────────────────────────────
    async function preloadReferences() {
      if (refsLoading) return;
      refsLoading = true;
      setPreloadMsg('Loading employee references…');
      setPreloadLabel('Fetching employee list…');
      setPreloadPct(0);

      // ── Fetch employee list from server ─────────────────────────────────────────
      let employees;
      try {
        const r = await fetch('face-employees.php');
        const d = await r.json();
        if (!d.success || !d.employees.length) {
          setPreloadMsg('No employee photos found.');
          setPreloadLabel('Upload photos in the employee system first.');
          hidePreloadOverlay();
          document.getElementById('startBtn').disabled = false;
          return;
        }
        employees = d.employees;
        totalRef = employees.length;
        window._empMap = Object.fromEntries(employees.map(e => [e.qr_code, e]));
        setRefProgress(0, totalRef);
      } catch (e) {
        setPreloadMsg('Could not load employee list.');
        setPreloadLabel('Check your connection and reload.');
        hidePreloadOverlay();
        document.getElementById('startBtn').disabled = false;
        return;
      }

      // ── Try loading from cache ─────────────────────────────────────────────────
      const cached = loadDescriptorCache();
      const cachedMap = new Map(
        cached ? cached.map(c => [c.qr_code, c]) : []
      );

      const currentQrSet = new Set(employees.map(e => e.qr_code));

      const cacheComplete = cached &&
        employees.every(e => cachedMap.has(e.qr_code));

      if (cacheComplete) {
        // ── Fast path: restore from cache ────────────────────────────────────────
        setPreloadMsg('Restoring from cache…');
        for (const entry of cached) {
          if (!currentQrSet.has(entry.qr_code)) continue;
          const descriptor = new Float32Array(entry.descriptor);
          labeledDescriptors.push(
            new faceapi.LabeledFaceDescriptors(entry.qr_code, [descriptor])
          );
          loadedRef++;
        }
        rebuildMatcher();
        setPreloadPct(100);
        setRefProgress(loadedRef, totalRef);
        setPreloadMsg('References ready (cached).');
        setPreloadLabel(`${loadedRef} of ${totalRef} employees loaded`);
        hidePreloadOverlay();
        refsReady = true;
        rebuildFrameDots();
        document.getElementById('startBtn').disabled = loadedRef === 0;
        setStatus('idle', `Ready — ${loadedRef} references`);
        return;
      }

      // ── Slow path: process images, fill in missing entries ────────────────────
      const newCacheEntries = [];

      for (let i = 0; i < employees.length; i++) {
        const emp = employees[i];
        setPreloadLabel(`Processing ${i + 1} / ${employees.length}: ${emp.fullname}`);

        if (cachedMap.has(emp.qr_code)) {
          const entry = cachedMap.get(emp.qr_code);
          const descriptor = new Float32Array(entry.descriptor);
          labeledDescriptors.push(
            new faceapi.LabeledFaceDescriptors(emp.qr_code, [descriptor])
          );
          newCacheEntries.push({
            qr_code: emp.qr_code,
            descriptor: entry.descriptor,
            emp
          });
          loadedRef++;

        } else {
          try {
            const img = await faceapi.fetchImage(emp.image_url);
            const det = await faceapi
              .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({
                minConfidence: 0.5
              }))
              .withFaceLandmarks()
              .withFaceDescriptor();

            if (det) {
              labeledDescriptors.push(
                new faceapi.LabeledFaceDescriptors(emp.qr_code, [det.descriptor])
              );
              newCacheEntries.push({
                qr_code: emp.qr_code,
                descriptor: Array.from(det.descriptor),
                emp,
              });
              loadedRef++;
              rebuildMatcher();

              if (!refsReady) {
                refsReady = true;
                document.getElementById('startBtn').disabled = false;
                setStatus('idle', 'Ready (partial refs)');
                rebuildFrameDots();
              }
            }
          } catch (_) {}
        }

        setPreloadPct(Math.round(((i + 1) / employees.length) * 100));
        setRefProgress(loadedRef, totalRef);

        saveDescriptorCache(newCacheEntries);
      }

      if (loadedRef === 0) {
        setPreloadMsg('No usable face photos found.');
        setPreloadLabel('Ensure employee photos show a clear face.');
      } else {
        setPreloadMsg('References ready.');
        setPreloadLabel(`${loadedRef} of ${totalRef} employees loaded`);
        setStatus('idle', `Ready — ${loadedRef} references`);
        rebuildMatcher();
        saveDescriptorCache(newCacheEntries);
      }

      hidePreloadOverlay();
      document.getElementById('startBtn').disabled = loadedRef === 0;
    }

    // ── Camera ────────────────────────────────────────────────────────────────────
    async function discoverCameras(preserveDeviceId) {
      const sel = document.getElementById('camSel');
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        const cams = devs.filter(d => d.kind === 'videoinput');

        if (!cams.length) {
          sel.innerHTML = '<option value="">No cameras found</option>';
          sel.disabled = true;
          return null;
        }

        sel.innerHTML = cams.map((c, i) =>
          `<option value="${esc(c.deviceId)}"
         ${c.deviceId === preserveDeviceId ? 'selected' : ''}>
         ${esc(c.label || 'Camera ' + (i + 1))}
       </option>`
        ).join('');

        sel.disabled = cams.length <= 1;

        return sel.value || null;
      } catch (e) {
        sel.innerHTML = '<option value="">Unavailable</option>';
        sel.disabled = true;
        return null;
      }
    }

    async function startCam(forceDeviceId) {
      if (!window.isSecureContext) {
        alert('Camera requires HTTPS. Please access via HTTPS or localhost.');
        return;
      }
      if (!refsReady) {
        alert('References are still loading. Please wait a moment.');
        return;
      }

      const selectedDevice = await discoverCameras(forceDeviceId ?? activeDeviceId);

      const deviceId = forceDeviceId ?? selectedDevice;

      const videoConstraints = {
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        },
      };
      if (deviceId) {
        videoConstraints.deviceId = {
          exact: deviceId
        };
      } else {
        videoConstraints.facingMode = 'user';
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });

        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        activeDeviceId = settings.deviceId ?? deviceId ?? null;

        await discoverCameras(activeDeviceId);

        video.srcObject = stream;
        await new Promise(r => {
          video.onloadedmetadata = r;
        });
        video.play();

        document.getElementById('camOff').style.display = 'none';
        document.getElementById('cf').style.display = '';
        document.getElementById('scanLine').classList.add('active');
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        document.getElementById('pauseBtn').disabled = false;
        setStatus('live', `Live — ${loadedRef} references`);
        startDetecting();

      } catch (err) {
        activeDeviceId = null;
        const map = {
          NotAllowedError: 'Camera permission denied.',
          NotFoundError: 'No camera device found.',
          NotReadableError: 'Camera is in use by another application.',
          OverconstrainedError: 'Selected camera no longer available.',
        };
        alert(map[err.name] || 'Camera error: ' + err.message);
        setStatus('idle', 'Camera error');
      }
    }

    function stopCam() {
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      detecting = false;
      paused = false;
      video.srcObject = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      document.getElementById('camOff').style.display = 'flex';
      document.getElementById('cf').style.display = 'none';
      document.getElementById('scanLine').classList.remove('active');
      document.getElementById('startBtn').disabled = !refsReady;
      document.getElementById('stopBtn').disabled = true;
      document.getElementById('pauseBtn').disabled = true;
      resetVerify();
      setStatus('idle', 'Stopped');
      hideNotice();
    }

    async function switchCam() {
      const chosenId = document.getElementById('camSel').value;

      if (chosenId && chosenId === activeDeviceId) return;

      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        detecting = false;
        video.srcObject = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('scanLine').classList.remove('active');
        resetVerify();
      }

      await startCam(chosenId || null);
    }

    function togglePause() {
      paused = !paused;
      document.getElementById('pauseBtn').innerHTML = paused ?
        '<i class="fas fa-play"></i> Resume' :
        '<i class="fas fa-pause"></i> Pause';
      if (paused) resetVerify();
      setStatus(paused ? 'idle' : 'live', paused ? 'Paused' : `Live — ${loadedRef} references`);
    }

    // ── Detection loop ────────────────────────────────────────────────────────────
    function startDetecting() {
      if (detecting) return;
      detecting = true;
      (function loop() {
        if (!detecting) return;
        rafId = requestAnimationFrame(loop);
        if (paused || !video.videoWidth || !matcher) return;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        const now = Date.now();
        if (now - lastDetect >= DETECT_MS) {
          lastDetect = now;
          runDetection();
        }
      })();
    }

    async function runDetection() {
      if (!video.videoWidth || !matcher) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let dets;
      try {
        dets = await faceapi
          .detectAllFaces(video, new faceapi.SsdMobilenetv1Options({
            minConfidence: MIN_DET_CONF
          }))
          .withFaceLandmarks()
          .withFaceDescriptors();
      } catch (e) {
        return;
      }

      if (!dets || !dets.length) {
        resetVerify();
        return;
      }

      const seenThisFrame = new Set();

      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);

      for (const det of dets) {
        const best = matcher.findBestMatch(det.descriptor);
        const box = det.detection.box;
        const dist = best.distance;
        const conf = Math.max(0, 1 - dist);

        const effectiveLimit = strictMode ? DISTANCE_LIMIT : 0.6;
        const isCandidate = best.label !== 'unknown' && dist <= effectiveLimit;
        const color = isCandidate ? '#f59e0b' : '#ef4444';

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        if (isCandidate) {
          seenThisFrame.add(best.label);

          if (!verifyAccum[best.label]) verifyAccum[best.label] = {
            count: 0,
            distances: []
          };
          verifyAccum[best.label].count++;
          verifyAccum[best.label].distances.push(dist);

          const acc = verifyAccum[best.label];
          const req = strictMode ? FRAMES_REQUIRED : 1;
          const confirmed = acc.count >= req;

          const label = window._empMap[best.label]?.fullname ?? best.label;
          const statusTxt = confirmed ? '✓ CONFIRMED' : `${acc.count}/${req}`;
          ctx.fillStyle = confirmed ? '#10b981' : '#f59e0b';
          ctx.font = 'bold 12px system-ui';
          ctx.save();
          const mirX = canvas.width - box.x - box.width;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillText(`${label}  ${Math.round(conf * 100)}%  ${statusTxt}`, mirX + 4, box.y - 6);
          ctx.restore();

          showVerifyHud(box);
          setArc(acc.count, confirmed);

          const framesRow = document.getElementById('framesRow');
          framesRow.style.display = 'flex';
          setFrameDots(acc.count, confirmed);

          if (confirmed) {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 3;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            const avgDist = acc.distances.reduce((a, b) => a + b, 0) / acc.distances.length;
            const avgConf = Math.max(0, 1 - avgDist);

            handleMatch(best.label, avgConf, box);
          }
        } else {
          ctx.fillStyle = '#ef4444';
          ctx.font = 'bold 12px system-ui';
          ctx.save();
          const mirXu = canvas.width - box.x - box.width;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillText(`Unknown  ${Math.round(conf * 100)}%`, mirXu + 4, box.y - 6);
          ctx.restore();
        }
      }

      ctx.restore();

      Object.keys(verifyAccum).forEach(qr => {
        if (!seenThisFrame.has(qr)) {
          delete verifyAccum[qr];
        }
      });

      if (Object.keys(verifyAccum).length === 0) {
        hideVerifyHud();
        setArc(0, false);
        document.getElementById('framesRow').style.display = 'none';
      }
    }

    // ── Match handler ─────────────────────────────────────────────────────────────
    async function handleMatch(qrCode, confidence, box) {
      if (Math.round(confidence * 100) < 60) return;

      const now = Date.now();
      if (cooldowns[qrCode] && (now - cooldowns[qrCode]) < COOLDOWN_MS) return;
      cooldowns[qrCode] = now;

      delete verifyAccum[qrCode];
      hideVerifyHud();
      setArc(0, false);
      document.getElementById('framesRow').style.display = 'none';

      stats.s++;
      stats.m++;
      document.getElementById('stS').textContent = stats.s;
      document.getElementById('stM').textContent = stats.m;

      const emp = window._empMap[qrCode];
      setStatus('matched', `Matched: ${emp?.fullname ?? qrCode}`);
      showResultCard(emp, checkType, Math.round(confidence * 100));
      updateConfBar(Math.round(confidence * 100));
      flashResult('ok');
      addLog('ok', emp?.fullname ?? qrCode, `${checkType} · ${Math.round(confidence * 100)}% · dist ${(1 - confidence).toFixed(3)}`);

      try {
        const r = await fetch('face-identify.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            qr_code: qrCode,
            check_status: checkType,
            csrf_token: CSRF
          }),
        });
        const d = await r.json();
        if (!d.success) addLog('inf', 'Server error', d.message ?? 'Failed to write log');
      } catch (e) {
        addLog('inf', 'Network error', 'Could not reach face-identify.php');
      }

      // After cooldown delay, reset status back to live
      setTimeout(() => {
        if (detecting && !paused) setStatus('live', `Live — ${loadedRef} references`);
      }, 2500);
    }

    // ── UI helpers ────────────────────────────────────────────────────────────────
    function showResultCard(emp, cs, pct) {
      if (!emp) return;
      document.getElementById('resultBox').innerHTML = `
    <div class="result-card">
      <img class="emp-photo" src="${esc(emp.image_url)}"
           onerror="this.outerHTML='<div class=emp-no-photo><i class=\\'fas fa-user\\'></i></div>'">
      <div class="emp-info">
        <div class="emp-name">${esc(emp.fullname)}</div>
        <div class="emp-sub">${esc(emp.position)} &middot; ${esc(emp.brand)}</div>
        <div class="emp-badges">
          <span class="badge ${cs==='IN'?'in':'out'}">
            <i class="fas fa-${cs==='IN'?'sign-in-alt':'sign-out-alt'}" style="margin-right:3px;"></i>${cs}
          </span>
          <span class="badge ${emp.status==='Active'?'act':'ina'}">${esc(emp.status)}</span>
          ${emp.shift ? `<span class="badge shf">${esc(emp.shift)}</span>` : ''}
        </div>
      </div>
    </div>`;
    }

    function updateConfBar(pct) {
      document.getElementById('confPct').textContent = pct + '%';
      const fill = document.getElementById('confFill');
      fill.style.width = pct + '%';
      fill.className = 'conf-fill ' + (pct >= 80 ? 'hi' : pct >= 55 ? 'mid' : 'lo');
    }

    function flashResult(cls) {
      const el = document.getElementById('flash');
      el.className = `flash show ${cls}`;
      setTimeout(() => {
        el.className = 'flash';
      }, 800);
    }

    function addLog(type, name, meta) {
      const feed = document.getElementById('logFeed');
      if (feed.querySelector('div[style]')) feed.innerHTML = '';
      const time = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      const icons = {
        ok: 'fa-check',
        no: 'fa-times',
        inf: 'fa-info'
      };
      const el = document.createElement('div');
      el.className = 'log-item';
      el.innerHTML = `
    <div class="log-icon ${type}"><i class="fas ${icons[type]||'fa-circle'}"></i></div>
    <div class="log-body">
      <div class="log-name">${esc(name)}</div>
      <div class="log-meta">${esc(meta)}</div>
    </div>
    <div class="log-time">${time}</div>`;
      feed.insertBefore(el, feed.firstChild);
      while (feed.children.length > 40) feed.removeChild(feed.lastChild);
    }

    function setCheck(t) {
      checkType = t;
      document.getElementById('tabIn').classList.toggle('on', t === 'IN');
      document.getElementById('tabOut').classList.toggle('on', t === 'OUT');
    }

    function setStatus(state, text) {
      const p = document.getElementById('sPill');
      const d = p.querySelector('.dot');
      const S = {
        idle: 'idle',
        loading: 'loading',
        live: 'live',
        matched: 'matched',
        verifying: 'verifying',
        nomatch: 'nomatch'
      };
      p.className = 's-pill ' + (S[state] ?? 'idle');
      d.className = 'dot' + (['live', 'loading', 'verifying'].includes(state) ? ' pulse' : '');
      document.getElementById('sText').textContent = text;
    }

    function showNotice(msg) {
      const n = document.getElementById('notice');
      n.textContent = msg;
      n.style.display = '';
    }

    function hideNotice() {
      document.getElementById('notice').style.display = 'none';
    }

    function esc(s) {
      if (!s) return '';
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── Init ──────────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
      if (!window.isSecureContext) {
        setPreloadMsg('HTTPS required.');
        setPreloadLabel('Camera API is disabled on non-secure origins.');
        document.getElementById('startBtn').disabled = true;
        return;
      }

      setStatus('loading', 'Loading models…');
      await loadModels();

      preloadReferences(); // background — not awaited

      try {
        const perm = await navigator.permissions.query({
          name: 'camera'
        });
        if (perm.state === 'granted') {
          const tid = setInterval(() => {
            if (refsReady) {
              clearInterval(tid);
              startCam();
            }
          }, 300);
        }
      } catch (_) {}
    });

    window.addEventListener('beforeunload', stopCam);
  </script>
</body>

</html>