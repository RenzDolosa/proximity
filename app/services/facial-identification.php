<?php
// app/services/facial-identification.php

ob_start();
if (session_status() === PHP_SESSION_NONE) {
  session_start();
}
ob_clean();

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

requireAccess('facial', ROUTE_QR_PROX);

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
  <title><?= htmlspecialchars($myDatabase ?? 'System', ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?> — Facial ID</title>
  <link rel="icon" href="/config/asset.php?t=g4ld2" type="image/png">
  <link rel="stylesheet" href="/config/asset.php?t=jrsb4">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
  <style>

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

    .mirror-btn {
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 8;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: rgba(16, 24, 40, 0.70);
      border: 1px solid rgba(255, 255, 255, 0.10);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: var(--muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      transition: background .15s, color .15s, border-color .15s, transform .2s;
    }

    .mirror-btn:hover {
      background: rgba(37, 99, 235, 0.25);
      color: var(--accent2);
      border-color: rgba(96, 165, 250, 0.30);
    }

    .mirror-btn.on {
      background: rgba(37, 99, 235, 0.22);
      color: var(--accent2);
      border-color: rgba(96, 165, 250, 0.35);
    }

    .mirror-btn.flip-anim {
      transform: scaleX(-1);
    }

    .mirror-btn::after {
      content: attr(data-tip);
      position: absolute;
      left: calc(100% + 8px);
      top: 50%;
      transform: translateY(-50%);
      background: rgba(9, 16, 31, 0.90);
      border: 1px solid var(--border);
      color: var(--text);
      font-size: 10px;
      font-family: inherit;
      white-space: nowrap;
      padding: 4px 8px;
      border-radius: 5px;
      pointer-events: none;
      opacity: 0;
      transition: opacity .15s;
    }

    .mirror-btn:hover::after {
      opacity: 1;
    }

    #videoEl {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
      transition: transform .25s ease;
    }

    #videoEl.no-mirror {
      transform: scaleX(1);
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
      transform: translate(-50%, -100px);
      width: 200px;
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
        transform: translate(-50%, -100px);
      }

      50% {
        transform: translate(-50%, 100px);
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
      justify-content: flex-end;
      padding-bottom: 28px;
      gap: 0;
      background: linear-gradient(to bottom,
          transparent 0%,
          transparent 40%,
          rgba(9, 16, 31, 0.55) 60%,
          rgba(9, 16, 31, 0.88) 100%);
      z-index: 5;
      pointer-events: none;
      transition: opacity .4s ease;
    }

    .preload-overlay.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .preload-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      background: rgba(16, 24, 40, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.09);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 14px;
      padding: 16px 24px 18px;
      min-width: 260px;
      max-width: 340px;
      pointer-events: auto;
    }

    .preload-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .preload-icon-wrap {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(37, 99, 235, 0.18);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .preload-icon-wrap i {
      font-size: 15px;
      color: var(--accent2);
    }

    .preload-icon-wrap.spinning {
      position: relative;
    }

    .preload-icon-wrap.spinning::after {
      content: '';
      position: absolute;
      inset: -3px;
      border-radius: 11px;
      border: 2px solid transparent;
      border-top-color: var(--accent2);
      border-right-color: var(--accent2);
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .preload-text {
      flex: 1;
    }

    .preload-msg {
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
      line-height: 1.3;
    }

    .preload-lbl {
      font-size: 10px;
      color: var(--muted);
      margin-top: 2px;
    }

    .preload-track {
      width: 100%;
      height: 5px;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.07);
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

    .cam-starting {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: var(--surf);
      z-index: 4;
      transition: opacity .3s;
    }

    .cam-starting.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .cam-starting i {
      font-size: 36px;
      color: var(--accent2);
      opacity: .5;
    }

    .cam-starting p {
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
      z-index: 4;
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

    /* ── Mirror toggle row in side panel ── */
    .mirror-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;
      padding: 7px 9px;
      background: var(--surf2);
      border-radius: 7px;
      border: 1px solid var(--border);
    }

    .mirror-row label {
      font-size: 11px;
      color: var(--muted);
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }

    .mirror-row label i {
      color: var(--accent2);
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
      background: var(--accent2);
      border-color: var(--accent2);
    }

    .toggle input:checked+.toggle-slider::before {
      transform: translateX(16px);
      background: #fff;
    }

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

    .strict-toggle .toggle input:checked+.toggle-slider {
      background: var(--amber);
      border-color: var(--amber);
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

    .last-match-sec {
      position: static;
      display: block;
      width: auto;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--border);
      border-radius: 0;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      box-shadow: none;
      padding: 12px 14px;
      z-index: auto;
    }

    /* ── Mobile overlay drawer ── */
    .drawer-btn {
      display: none;
    }

    .drawer-overlay {
      display: none;
    }

    @media (max-width: 680px) {
      body {
        overflow: hidden;
      }

      .workspace {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr;
        position: relative;
      }

      /* Camera fills full workspace */
      .cam-panel {
        height: 100%;
        width: 100%;
      }

      /* Hide side panel from normal flow */
      .side {
        display: none;
      }

      /* Floating drawer toggle button — top right of camera */
      .drawer-btn {
        display: flex;
        position: absolute;
        top: 12px;
        right: 12px;
        z-index: 20;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        background: rgba(16, 24, 40, 0.75);
        border: 1px solid rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        color: var(--text);
        cursor: pointer;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: background .15s;
      }

      .drawer-btn:active {
        background: rgba(37, 99, 235, 0.4);
      }

      /* Dim overlay behind drawer */
      .drawer-overlay {
        display: block;
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 29;
        opacity: 0;
        pointer-events: none;
        transition: opacity .25s;
      }

      .drawer-overlay.open {
        opacity: 1;
        pointer-events: auto;
      }

      /* Slide-in drawer panel from right */
      .side.drawer-open {
        display: flex;
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: 300px;
        max-width: 88vw;
        z-index: 30;
        overflow-y: auto;
        border-left: 1px solid var(--border);
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5);
        animation: slideIn .25s ease;
      }

      @keyframes slideIn {
        from {
          transform: translateX(100%);
        }

        to {
          transform: translateX(0);
        }
      }

      .last-match-sec {
        position: absolute;
        bottom: 20px;
        right: 12px;
        width: 190px;
        background: rgba(16, 24, 40, 0.88);
        border: 1px solid rgba(255, 255, 255, 0.10);
        border-radius: 10px;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        z-index: 10;
        padding: 8px 10px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      }

      .last-match-sec.no-match {
        display: none !important;
      }

      .last-match-sec .emp-photo,
      .last-match-sec .emp-no-photo {
        aspect-ratio: 16/9;
        font-size: 24px;
      }

      .last-match-sec .emp-info {
        padding: 6px 8px;
      }

      .last-match-sec .emp-name {
        font-size: 12px;
      }

      .last-match-sec .emp-sub {
        font-size: 10px;
      }

      .last-match-sec .sec-label {
        font-size: 9px;
        margin-bottom: 5px;
      }

      .last-match-sec .conf-label,
      .last-match-sec .conf-track,
      .last-match-sec .frames-row {
        display: none !important;
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
    <div class="topbar-title"></div>
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

      <!-- Mirror toggle button — floats over the camera, top-left -->
      <button class="mirror-btn on" id="mirrorBtn" tabindex="-1"
        onclick="toggleMirror()"
        title="Toggle mirror"
        data-tip="Mirror: On">
        <i class="fas fa-left-right"></i>
      </button>

      <button class="drawer-btn" id="drawerBtn" onclick="toggleDrawer()" title="Settings">
        <i class="fas fa-sliders-h"></i>
      </button>

      <!-- Shown briefly before the camera stream starts -->
      <div class="cam-starting" id="camStarting">
        <i class="fas fa-camera"></i>
        <p>Starting camera…</p>
      </div>

      <!-- Translucent overlay that sits OVER the live video while models load -->
      <div class="preload-overlay" id="preloadOverlay">
        <div class="preload-card">
          <div class="preload-header">
            <div class="preload-icon-wrap spinning" id="preloadIconWrap">
              <i class="fas fa-brain" id="preloadIcon"></i>
            </div>
            <div class="preload-text">
              <div class="preload-msg" id="preloadMsg">Loading AI models…</div>
              <div class="preload-lbl" id="preloadLabel">Please wait</div>
            </div>
          </div>
          <div class="preload-track">
            <div class="preload-fill" id="preloadFill"></div>
          </div>
        </div>
      </div>

      <!-- Shown after camera is explicitly stopped -->
      <div class="cam-off" id="camOff" style="display:none;">
        <i class="fas fa-camera"></i>
        <p>Click <strong>Start</strong> to resume scanning.</p>
      </div>

      <video id="videoEl" autoplay playsinline muted></video>
      <canvas id="overlayCanvas"></canvas>

      <div class="verify-hud" id="verifyHud"></div>

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

      <div class="last-match-sec no-match" id="lastMatchSec">
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
        <div class="frames-row" id="framesRow" style="display:none;">
          <span>Verifying</span>
        </div>
      </div>
    </div>

    <!-- Side panel -->
    <div class="side">

      <div class="sec">
        <div class="sec-label">Camera</div>
        <select class="cam-sel" id="camSel" onchange="switchCam()">
          <option value="">Select camera…</option>
        </select>

        <!-- Mirror toggle in side panel -->
        <div class="mirror-row">
          <label for="mirrorToggle">
            <i class="fas fa-left-right"></i> Mirror View
          </label>
          <label class="toggle">
            <input type="checkbox" id="mirrorToggle" checked onchange="toggleMirrorFromPanel()">
            <span class="toggle-slider"></span>
          </label>
        </div>

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

        <div class="strict-row">
          <label for="strictToggle">
            <i class="fas fa-shield-alt"></i> Strict Mode
          </label>
          <label class="toggle strict-toggle">
            <input type="checkbox" id="strictToggle" checked onchange="updateStrictMode()">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="slider-row">
          <label>Distance limit</label>
          <input type="range" min="25" max="60" value="45" id="threshSlider"
            oninput="updateThresh(this.value)" step="1">
          <span class="slider-val" id="threshVal">0.45</span>
        </div>

        <div class="slider-row">
          <label>Required frames</label>
          <input type="range" min="1" max="6" value="3" id="framesSlider"
            oninput="updateFramesReq(this.value)" step="1">
          <span class="slider-val" id="framesVal">3</span>
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

  <audio id="successSound" data-fallback="/config/asset.php?t=ero67" preload="none"></audio>
  <audio id="checkoutSound" data-fallback="/config/asset.php?t=jg5df" preload="none"></audio>
  <audio id="noResultSound" data-fallback="/config/asset.php?t=sdh3f" preload="none"></audio>
  <audio id="warningSound" data-fallback="/config/asset.php?t=l45wd" preload="none"></audio>
  <audio id="inactiveSound" data-fallback="/config/asset.php?t=ert26" preload="none"></audio>

  <script src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"></script>
  <script>
    "use strict";

    // ── Config ─────────────────────────────────────────────────────────────────
    const CSRF = <?= json_encode($_SESSION['csrf_token'] ?? '') ?>;
    const MODELS_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights/';
    const DETECT_MS = 600;
    const COOLDOWN_MS = 5000;
    const MIN_DET_CONF = 0.50;

    let DISTANCE_LIMIT = 0.45;
    let FRAMES_REQUIRED = 3;
    let strictMode = true;

    // ── Global-audio endpoint ─────────────────────────────────────────
    const GLOBAL_AUDIO_ENDPOINT = "global_audio.php";

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
        const res = await fetch(GLOBAL_AUDIO_ENDPOINT, {
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

    // ─────────────────────────────────────────────────────────────────
    //  Audio helpers
    // ─────────────────────────────────────────────────────────────────
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

    // ── Mirror state ───────────────────────────────────────────────────────────
    let mirrorMode = true;

    function applyMirror() {
      const vid = document.getElementById('videoEl');
      const btn = document.getElementById('mirrorBtn');
      const chk = document.getElementById('mirrorToggle');

      if (mirrorMode) {
        vid.classList.remove('no-mirror');
        btn.classList.add('on');
        btn.setAttribute('data-tip', 'Mirror: On');
      } else {
        vid.classList.add('no-mirror');
        btn.classList.remove('on');
        btn.setAttribute('data-tip', 'Mirror: Off');
      }

      chk.checked = mirrorMode;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      resetVerify();
    }

    function toggleMirror() {
      mirrorMode = !mirrorMode;

      const btn = document.getElementById('mirrorBtn');
      btn.classList.add('flip-anim');
      setTimeout(() => btn.classList.remove('flip-anim'), 220);

      applyMirror();
    }

    function toggleMirrorFromPanel() {
      mirrorMode = document.getElementById('mirrorToggle').checked;
      applyMirror();
    }

    // ── State ──────────────────────────────────────────────────────────────────
    let stream = null;
    let rafId = null;
    let currentAudio = null;
    let detecting = false;
    let paused = false;
    let modelsReady = false;
    let refsReady = false;
    let refsLoading = false;
    let checkType = 'IN';
    let lastDetect = 0;
    let cooldowns = {};
    let activeDeviceId = null;
    let cameraStreaming = false;

    let labeledDescriptors = [];
    let matcher = null;
    let loadedRef = 0;
    let totalRef = 0;

    let verifyAccum = {};

    const stats = {
      s: 0,
      m: 0,
      n: 0
    };

    const video = document.getElementById('videoEl');
    const canvas = document.getElementById('overlayCanvas');
    const ctx = canvas.getContext('2d');

    // ── Descriptor cache ───────────────────────────────────────────────────────
    const CACHE_KEY = 'faceDescCache_v2_' + <?= json_encode($_SESSION['my_database'] ?? '') ?>;
    const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

    function saveDescriptorCache(entries) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          ts: Date.now(),
          data: entries.map(e => ({
            qr_code: e.qr_code,
            image_url: e.image_url,
            updated_at: e.updated_at ?? '',
            descriptor: Array.from(e.descriptor),
            emp: e.emp,
          }))
        }));
      } catch (_) {}
    }

    function loadDescriptorCache() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw);
        if (Date.now() - p.ts > CACHE_MAX_AGE_MS) {
          localStorage.removeItem(CACHE_KEY);
          return null;
        }
        return p.data;
      } catch (_) {
        return null;
      }
    }

    // ── Strict mode ────────────────────────────────────────────────────────────
    function updateStrictMode() {
      strictMode = document.getElementById('strictToggle').checked;
      document.getElementById('framesSlider').disabled = !strictMode;
    }

    function updateThresh(v) {
      DISTANCE_LIMIT = parseInt(v) / 100;
      document.getElementById('threshVal').textContent = DISTANCE_LIMIT.toFixed(2);
      if (labeledDescriptors.length) rebuildMatcher();
      resetVerify();
    }

    function updateFramesReq(v) {
      FRAMES_REQUIRED = parseInt(v);
      document.getElementById('framesVal').textContent = v;
      rebuildFrameDots();
      resetVerify();
    }

    // ── Frame dots ─────────────────────────────────────────────────────────────
    function rebuildFrameDots() {
      const row = document.getElementById('framesRow');
      row.querySelectorAll('.frame-dot').forEach(d => d.remove());
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
        d.className = 'frame-dot' + (confirmed ? ' confirmed' : i < count ? ' hit' : '');
      }
    }

    // ── Periodic employee status refresh ──────────────────────────────────────
    let _statusRefreshTimer = null;

    function startStatusRefresh() {
      if (_statusRefreshTimer) return;
      _statusRefreshTimer = setInterval(async () => {
        if (!refsReady || !cameraStreaming) return;
        try {
          const r = await fetch('face-employees.php');
          const d = await r.json();
          if (!d.success) return;

          const activeQrSet = new Set(d.employees.map(e => e.qr_code));

          const removed = labeledDescriptors.filter(ld => !activeQrSet.has(ld.label));
          if (removed.length > 0) {
            removed.forEach(ld => {
              invalidateCachedEmployee(ld.label);
              addLog('inf', window._empMap[ld.label]?.fullname ?? ld.label,
                'Removed from matcher — status changed');
            });
            rebuildMatcher();
            loadedRef = labeledDescriptors.length;
            setStatus('live', `Live — ${loadedRef} references`);
          }

          d.employees.forEach(emp => {
            if (window._empMap[emp.qr_code]) {
              window._empMap[emp.qr_code] = {
                ...window._empMap[emp.qr_code],
                ...emp,
              };
            }
          });
        } catch (_) {}
      }, 60_000);
    }

    function stopStatusRefresh() {
      if (_statusRefreshTimer) {
        clearInterval(_statusRefreshTimer);
        _statusRefreshTimer = null;
      }
    }

    // ── Arc progress ───────────────────────────────────────────────────────────
    const CIRC = 2 * Math.PI * 22;

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

      fill.style.strokeDashoffset = CIRC * (1 - Math.min(count / req, 1));

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

    // ── Verify HUD ─────────────────────────────────────────────────────────────
    function showVerifyHud(box) {
      const hud = document.getElementById('verifyHud');
      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      const panel = document.getElementById('camPanel').getBoundingClientRect();
      const scaleX = panel.width / vw;
      const scaleY = panel.height / vh;

      const x = mirrorMode ? (vw - box.x - box.width) : box.x;

      hud.style.left = (x * scaleX) + 'px';
      hud.style.top = (box.y * scaleY) + 'px';
      hud.style.width = (box.width * scaleX) + 'px';
      hud.style.height = (box.height * scaleY) + 'px';
      hud.classList.add('show');
    }

    function hideVerifyHud() {
      document.getElementById('verifyHud').classList.remove('show');
    }

    // ── Reset verify ───────────────────────────────────────────────────────────
    function resetVerify(keepQr) {
      if (keepQr) {
        Object.keys(verifyAccum).forEach(k => {
          if (k !== keepQr) delete verifyAccum[k];
        });
      } else {
        verifyAccum = {};
        hideVerifyHud();
        setArc(0, false);
        document.getElementById('framesRow').style.display = 'none';
      }
    }

    // ── Preload overlay helpers ────────────────────────────────────────────────
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
      const el = document.getElementById('preloadOverlay');
      el.classList.add('hidden');
      document.getElementById('preloadIconWrap').classList.remove('spinning');
      setTimeout(() => {
        el.style.display = 'none';
      }, 450);
    }

    function setRefProgress(loaded, total) {
      document.getElementById('refCount').textContent = loaded;
      document.getElementById('refTotal').textContent = total;
      const p = total > 0 ? Math.round((loaded / total) * 100) : 0;
      const f = document.getElementById('refMiniFill');
      f.style.width = p + '%';
      if (loaded >= total && total > 0) f.classList.add('done');
    }

    // ── Load models ────────────────────────────────────────────────────────────
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

    function rebuildMatcher() {
      if (!labeledDescriptors.length) return;
      matcher = new faceapi.FaceMatcher(labeledDescriptors, strictMode ? DISTANCE_LIMIT : 0.6);
    }

    // ── Preload references ─────────────────────────────────────────────────────
    async function preloadReferences() {
      if (refsLoading) return;
      refsLoading = true;
      setPreloadMsg('Loading employee references…');
      setPreloadLabel('Fetching employee list…');
      setPreloadPct(0);

      let employees;
      try {
        const r = await fetch('face-employees.php');
        const d = await r.json();
        if (!d.success || !d.employees.length) {
          setPreloadMsg('No employee photos found.');
          setPreloadLabel('Upload photos in the employee system first.');
          hidePreloadOverlay();
          document.getElementById('startBtn').disabled = cameraStreaming;
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
        document.getElementById('startBtn').disabled = cameraStreaming;
        return;
      }

      const cached = loadDescriptorCache();
      const cachedMap = new Map(cached ? cached.map(c => [c.qr_code, c]) : []);
      const currentQrSet = new Set(employees.map(e => e.qr_code));

      if (cached && cached.length !== employees.length) {
        localStorage.removeItem(CACHE_KEY);
        cachedMap.clear();
      }

      const cacheComplete = cached && employees.every(e => {
        const c = cachedMap.get(e.qr_code);
        return c && c.image_url === e.image_url && c.updated_at === (e.updated_at ?? '');
      });

      if (cacheComplete) {
        setPreloadMsg('Restoring from cache…');
        const freshEntries = [];

        for (const entry of cached) {
          if (!currentQrSet.has(entry.qr_code)) continue;
          labeledDescriptors.push(
            new faceapi.LabeledFaceDescriptors(entry.qr_code, [new Float32Array(entry.descriptor)])
          );
          freshEntries.push(entry);
          loadedRef++;
        }

        saveDescriptorCache(freshEntries);

        rebuildMatcher();
        setPreloadPct(100);
        setRefProgress(loadedRef, totalRef);
        setPreloadMsg('References ready (cached).');
        setPreloadLabel(`${loadedRef} of ${totalRef} employees loaded`);
        hidePreloadOverlay();
        refsReady = true;
        rebuildFrameDots();
        document.getElementById('startBtn').disabled = cameraStreaming || loadedRef === 0;
        setStatus('live', `Live — ${loadedRef} references`);
        if (cameraStreaming && !detecting) startDetecting();
        return;
      }

      const newCacheEntries = [];
      const BATCH_SIZE = 5;

      async function processEmployee(emp, index) {
        setPreloadLabel(`Processing ${index + 1} / ${employees.length}: ${emp.fullname}`);

        if (cachedMap.has(emp.qr_code)) {
          const entry = cachedMap.get(emp.qr_code);
          // Validate the cached entry is still current
          if (entry.image_url === emp.image_url && entry.updated_at === (emp.updated_at ?? '')) {
            labeledDescriptors.push(
              new faceapi.LabeledFaceDescriptors(emp.qr_code, [new Float32Array(entry.descriptor)])
            );
            newCacheEntries.push({
              qr_code: emp.qr_code,
              image_url: emp.image_url,
              updated_at: emp.updated_at ?? '',
              descriptor: entry.descriptor,
              emp,
            });
            loadedRef++;
            return;
          }
        }

        // Not cached or stale — fetch and compute descriptor
        try {
          const img = await faceapi.fetchImage(emp.image_url);
          const det = await faceapi
            .detectSingleFace(img, new faceapi.SsdMobilenetv1Options({
              minConfidence: 0.3
            }))
            .withFaceLandmarks()
            .withFaceDescriptor();

          if (det) {
            labeledDescriptors.push(
              new faceapi.LabeledFaceDescriptors(emp.qr_code, [det.descriptor])
            );
            newCacheEntries.push({
              qr_code: emp.qr_code,
              image_url: emp.image_url,
              updated_at: emp.updated_at ?? '',
              descriptor: Array.from(det.descriptor),
              emp,
            });
            loadedRef++;
            rebuildMatcher();

            if (!refsReady) {
              refsReady = true;
              document.getElementById('startBtn').disabled = cameraStreaming;
              setStatus('live', 'Live (loading refs…)');
              rebuildFrameDots();
              if (cameraStreaming && !detecting) startDetecting();
            }
          }
        } catch (_) {}
      }

      // Process in parallel batches
      for (let i = 0; i < employees.length; i += BATCH_SIZE) {
        const batch = employees.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map((emp, j) => processEmployee(emp, i + j)));

        const done = Math.min(i + BATCH_SIZE, employees.length);
        setPreloadPct(Math.round((done / employees.length) * 100));
        setRefProgress(loadedRef, totalRef);
        saveDescriptorCache(newCacheEntries); // save after each batch
      }

      if (loadedRef === 0) {
        setPreloadMsg('No usable face photos found.');
        setPreloadLabel('Ensure employee photos show a clear face.');
      } else {
        setPreloadMsg('References ready.');
        setPreloadLabel(`${loadedRef} of ${totalRef} employees loaded`);
        setStatus('live', `Live — ${loadedRef} references`);
        rebuildMatcher();
        saveDescriptorCache(newCacheEntries);
      }

      hidePreloadOverlay();
      document.getElementById('startBtn').disabled = cameraStreaming || loadedRef === 0;
    }

    // ── Camera stream ──────────────────────────────────────────────────────────
    async function startVideoStream(forceDeviceId) {
      if (!window.isSecureContext) {
        document.getElementById('camStarting').querySelector('p').textContent =
          'HTTPS required for camera access.';
        return false;
      }

      const selectedDevice = await discoverCameras(forceDeviceId ?? activeDeviceId);
      const deviceId = forceDeviceId ?? selectedDevice;

      const videoConstraints = {
        width: {
          ideal: 1280
        },
        height: {
          ideal: 720
        }
      };
      if (deviceId) videoConstraints.deviceId = {
        exact: deviceId
      };
      else videoConstraints.facingMode = 'user';

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false
        });

        const track = stream.getVideoTracks()[0];
        activeDeviceId = track.getSettings().deviceId ?? deviceId ?? null;
        await discoverCameras(activeDeviceId);

        video.srcObject = stream;
        await new Promise(r => {
          video.onloadedmetadata = r;
        });
        video.play();

        document.getElementById('camStarting').classList.add('hidden');
        document.getElementById('camOff').style.display = 'none';
        document.getElementById('cf').style.display = '';
        document.getElementById('scanLine').classList.add('active');

        cameraStreaming = true;

        document.getElementById('stopBtn').disabled = false;
        document.getElementById('pauseBtn').disabled = false;
        document.getElementById('startBtn').disabled = true;

        return true;
      } catch (err) {
        activeDeviceId = null;
        cameraStreaming = false;
        const map = {
          NotAllowedError: 'Camera permission denied.',
          NotFoundError: 'No camera device found.',
          NotReadableError: 'Camera is in use by another application.',
          OverconstrainedError: 'Selected camera no longer available.',
        };
        document.getElementById('camStarting').querySelector('p').textContent =
          map[err.name] || 'Camera error: ' + err.message;
        return false;
      }
    }

    async function startCam(forceDeviceId) {
      if (!refsReady) {
        alert('References are still loading. Please wait a moment.');
        return;
      }
      await startVideoStream(forceDeviceId);
      if (cameraStreaming && refsReady && !detecting) {
        startDetecting();
        setStatus('live', `Live — ${loadedRef} references`);
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
      cameraStreaming = false;
      video.srcObject = null;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      document.getElementById('camOff').style.display = 'flex';
      document.getElementById('camStarting').classList.remove('hidden');
      document.getElementById('camStarting').querySelector('p').textContent = 'Starting camera…';
      document.getElementById('cf').style.display = 'none';
      document.getElementById('scanLine').classList.remove('active');
      document.getElementById('startBtn').disabled = !refsReady;
      document.getElementById('stopBtn').disabled = true;
      document.getElementById('pauseBtn').disabled = true;
      resetVerify();
      stopStatusRefresh();
      setStatus('idle', 'Stopped');
      hideNotice();

      document.getElementById('lastMatchSec').classList.add('no-match');
    }

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
          `<option value="${esc(c.deviceId)}" ${c.deviceId === preserveDeviceId ? 'selected' : ''}>
           ${esc(c.label || 'Camera ' + (i + 1))}</option>`
        ).join('');
        sel.disabled = cams.length <= 1;
        return sel.value || null;
      } catch (e) {
        sel.innerHTML = '<option value="">Unavailable</option>';
        sel.disabled = true;
        return null;
      }
    }

    async function switchCam() {
      const chosenId = document.getElementById('camSel').value;
      if (chosenId && chosenId === activeDeviceId) return;

      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
        detecting = false;
        cameraStreaming = false;
        video.srcObject = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        document.getElementById('scanLine').classList.remove('active');
        resetVerify();
      }

      const ok = await startVideoStream(chosenId || null);
      if (ok && refsReady && !detecting) {
        startDetecting();
        setStatus('live', `Live — ${loadedRef} references`);
      }
    }

    function togglePause() {
      paused = !paused;
      document.getElementById('pauseBtn').innerHTML = paused ?
        '<i class="fas fa-play"></i> Resume' :
        '<i class="fas fa-pause"></i> Pause';
      if (paused) resetVerify();
      setStatus(paused ? 'idle' : 'live', paused ? 'Paused' : `Live — ${loadedRef} references`);
    }

    // ── Canvas label renderer (stacked, with pill background) ─────────────────────
    function drawLabel(ctx, lines, x, boxTop) {
      const FONT_SIZE = 12;
      const PAD_X = 6;
      const PAD_Y = 4;
      const LINE_H = FONT_SIZE + 4;
      const RADIUS = 4;

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = `bold ${FONT_SIZE}px system-ui, sans-serif`;

      const lineWidths = lines.map(l => ctx.measureText(l.text).width);
      const maxW = Math.max(...lineWidths);
      const totalH = lines.length * LINE_H + PAD_Y * 2;
      const rx = Math.max(0, x);
      const ry = Math.max(0, boxTop - totalH - 2);

      const clampedX = Math.min(rx, canvas.width - maxW - PAD_X * 2 - 2);

      ctx.fillStyle = 'rgba(9, 16, 31, 0.78)';
      roundRect(ctx, clampedX, ry, maxW + PAD_X * 2, totalH, RADIUS);
      ctx.fill();

      lines.forEach((line, i) => {
        ctx.fillStyle = line.color;
        ctx.fillText(line.text, clampedX + PAD_X, ry + PAD_Y + FONT_SIZE + i * LINE_H);
      });

      ctx.restore();
    }

    function roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    // ── Detection loop ─────────────────────────────────────────────────────────
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

      if (mirrorMode) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }

      for (const det of dets) {
        const best = matcher.findBestMatch(det.descriptor);
        const box = det.detection.box;
        const dist = best.distance;
        const conf = Math.max(0, 1 - dist);

        const effectiveLimit = strictMode ? DISTANCE_LIMIT : 0.6;
        const isCandidate = best.label !== 'unknown' && dist <= effectiveLimit;

        ctx.strokeStyle = isCandidate ? '#f59e0b' : '#ef4444';
        ctx.lineWidth = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        if (isCandidate) {
          // ── Reject low-confidence candidates immediately ──────────────────
          const confPct = Math.round(conf * 100);
          if (confPct < 68) {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const screenXlo = mirrorMode ? (canvas.width - box.x - box.width) : box.x;
            drawLabel(ctx, [{
              text: `Unknown ${Math.round(conf * 100)}%`,
              color: '#ef4444'
            }, ], screenXu + 4, box.y);
            ctx.restore();
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 2;
            ctx.strokeRect(box.x, box.y, box.width, box.height);

            const nowLo = Date.now();
            if (!window._lastLowConfSound || nowLo - window._lastLowConfSound > 4000) {
              window._lastLowConfSound = nowLo;
              playNoResultSound();
            }
            continue;
          }

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

          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);

          const screenX = mirrorMode ? (canvas.width - box.x - box.width) : box.x;

          drawLabel(ctx, [{
              text: label,
              color: confirmed ? '#10b981' : '#f59e0b'
            },
            {
              text: `${Math.round(conf * 100)}%  ${statusTxt}`,
              color: confirmed ? '#10b981' : '#f59e0b'
            },
          ], screenX + 4, box.y);
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
            handleMatch(best.label, Math.max(0, 1 - avgDist), box);
          }
        } else {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          const screenXu = mirrorMode ? (canvas.width - box.x - box.width) : box.x;
          drawLabel(ctx, [{
            text: `Low conf. ${confPct}%`,
            color: '#ef4444'
          }, ], screenXlo + 4, box.y);
          ctx.restore();
        }
      }

      ctx.restore();

      Object.keys(verifyAccum).forEach(qr => {
        if (!seenThisFrame.has(qr)) delete verifyAccum[qr];
      });

      if (Object.keys(verifyAccum).length === 0) {
        hideVerifyHud();
        setArc(0, false);
        document.getElementById('framesRow').style.display = 'none';
      }
    }

    // ── Match handler ──────────────────────────────────────────────────────────
    async function handleMatch(qrCode, confidence, box) {
      if (Math.round(confidence * 100) < 68) {
        playNoResultSound();
        addLog('no', 'Low confidence', `Face detected at ${Math.round(confidence * 100)}% — below threshold`);
        stats.s++;
        stats.n++;
        document.getElementById('stS').textContent = stats.s;
        document.getElementById('stN').textContent = stats.n;
        flashResult('err');
        return;
      }

      const now = Date.now();
      if (cooldowns[qrCode] && (now - cooldowns[qrCode]) < COOLDOWN_MS) return;
      cooldowns[qrCode] = now;

      delete verifyAccum[qrCode];
      hideVerifyHud();
      setArc(0, false);
      document.getElementById('framesRow').style.display = 'none';

      // ── Validate with server FIRST before committing to UI ────────────
      let serverEmp = null;
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

        if (!d.success) {
          if (d.result === 'not_found' || d.result === 'inactive') {
            invalidateCachedEmployee(qrCode);
          }

          const rejectedEmp = d.employee ?? window._empMap[qrCode];
          const rejectedName = rejectedEmp?.fullname ?? qrCode;
          const reason = d.result === 'inactive' ? 'Inactive employee' : (d.message ?? 'Rejected by server');

          addLog('no', rejectedName, reason);
          stats.s++;
          stats.n++;
          document.getElementById('stS').textContent = stats.s;
          document.getElementById('stN').textContent = stats.n;
          flashResult('err');

          if (d.result === 'inactive') {
            playInactiveSound();
          } else {
            playNoResultSound();
          }

          setTimeout(() => {
            if (cameraStreaming && !paused) setStatus('live', `Live — ${loadedRef} references`);
          }, 2500);
          return;
        }

        serverEmp = d.employee;
      } catch (e) {
        addLog('inf', 'Network error', 'Could not reach face-identify.php');
        return;
      }

      // ── Server confirmed — now update UI ──────────────────────────────
      stats.s++;
      stats.m++;
      document.getElementById('stS').textContent = stats.s;
      document.getElementById('stM').textContent = stats.m;

      if (serverEmp) window._empMap[qrCode] = {
        ...window._empMap[qrCode],
        ...serverEmp,
        image_url: window._empMap[qrCode]?.image_url
      };

      const emp = window._empMap[qrCode];
      setStatus('matched', `Matched: ${emp?.fullname ?? qrCode}`);
      showResultCard(emp, checkType, Math.round(confidence * 100));
      updateConfBar(Math.round(confidence * 100));
      flashResult('ok');
      addLog('ok', emp?.fullname ?? qrCode,
        `${checkType} · ${Math.round(confidence * 100)}% · dist ${(1 - confidence).toFixed(3)}`);

      if (emp?.violation && emp.violation.trim() !== '') {
        playWarningSound();
      } else if ((emp?.status || '').toLowerCase() === 'inactive') {
        playInactiveSound();
      } else if (checkType === 'OUT') {
        playCheckoutSound();
      } else {
        playSuccessSound();
      }

      setTimeout(() => {
        if (cameraStreaming && !paused) setStatus('live', `Live — ${loadedRef} references`);
      }, 2500);
    }

    // ── UI helpers ─────────────────────────────────────────────────────────────
    function showResultCard(emp, cs, pct) {
      if (!emp) return;

      document.getElementById('lastMatchSec').classList.remove('no-match');
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
        </div>
      `;
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

    function invalidateCachedEmployee(qrCode) {
      labeledDescriptors = labeledDescriptors.filter(ld => ld.label !== qrCode);
      delete window._empMap[qrCode];
      if (labeledDescriptors.length) rebuildMatcher();

      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return;
        const p = JSON.parse(raw);
        p.data = p.data.filter(e => e.qr_code !== qrCode);
        localStorage.setItem(CACHE_KEY, JSON.stringify(p));
      } catch (_) {}
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
      p.className = 's-pill ' +
        (['idle', 'loading', 'live', 'matched', 'verifying', 'nomatch'].includes(state) ? state : 'idle');
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
      return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
      if (!window.isSecureContext) {
        setPreloadMsg('HTTPS required.');
        setPreloadLabel('Camera API is disabled on non-secure origins.');
        document.getElementById('startBtn').disabled = true;
        document.getElementById('camStarting').querySelector('p').textContent = 'HTTPS required.';
        return;
      }

      setStatus('loading', 'Starting…');

      const camOk = await startVideoStream();

      await loadModels();

      preloadReferences();

      if (!camOk) {
        document.getElementById('startBtn').disabled = cameraStreaming;
        document.getElementById('camStarting').querySelector('p').textContent =
          'Grant camera permission, then click Start.';
      }
    });

    document.addEventListener("DOMContentLoaded", () => {
      loadGlobalAudio();
      startStatusRefresh();
    });

    window.addEventListener('beforeunload', stopCam);
  </script>

  <div class="drawer-overlay" id="drawerOverlay" onclick="toggleDrawer()"></div>

  <script>
    // ── Mobile drawer ──────────────────────────────────────────────────────────
    function toggleDrawer() {
      const side = document.querySelector('.side');
      const overlay = document.getElementById('drawerOverlay');
      const isOpen = side.classList.contains('drawer-open');
      side.classList.toggle('drawer-open', !isOpen);
      overlay.classList.toggle('open', !isOpen);
    }

    // ── Move last-match-sec into side panel on desktop ─────────────────────────
    function positionLastMatch() {
      const sec = document.getElementById('lastMatchSec');
      const side = document.querySelector('.side');
      const stats = side.querySelector('.sec:has(.stats-grid)');

      if (window.innerWidth > 680) {
        if (sec.parentElement !== side) {
          side.insertBefore(sec, stats);
        }
      } else {
        const camPanel = document.getElementById('camPanel');
        if (sec.parentElement !== camPanel) {
          camPanel.appendChild(sec);
        }
      }
    }

    positionLastMatch();
    window.addEventListener('resize', positionLastMatch);
  </script>
</body>

</html>