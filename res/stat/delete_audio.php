<?php
// sett/delete_audio.php

require_once '../cnfg/config.php';
require_once '../cnfg/db.php';

// ── Auth ──────────────────────────────────────────────────────────────────────
if (!isLoggedIn()) {
  http_response_code(403);
  header('Location: ../index.php');
  exit;
}

$user = getCurrentUser();

// ── CSRF token check ──────────────────────────────────────────────────────────
$token = $_GET['token'] ?? '';
if (
  empty($token) ||
  !isset($_SESSION['delete_audio_token']) ||
  !hash_equals($_SESSION['delete_audio_token'], $token)
) {
  $_SESSION['flash_message']  = 'Invalid or expired request.';
  $_SESSION['flash_type']     = 'error';
  header('Location: settings.php');
  exit;
}

var_dump(ini_get('upload_max_filesize'), ini_get('post_max_size'));

// ── Validate `type` param ─────────────────────────────────────────────────────
$ALLOWED_TYPES = [
  'success_audio_path'    => 'success',
  'not_found_audio_path'  => 'not_found',
  'inactive_audio_path'   => 'inactive',
  'violations_audio_path' => 'violations',
];

$type = $_GET['type'] ?? '';

if (!array_key_exists($type, $ALLOWED_TYPES)) {
  $_SESSION['flash_message'] = 'Unknown audio type.';
  $_SESSION['flash_type']    = 'error';
  header('Location: settings.php');
  exit;
}

// ── Load current path from DB ─────────────────────────────────────────────────
try {
  $userPdo  = getUserDBConnection($user['id']);
  $stmt     = $userPdo->prepare("SELECT `$type` FROM user_audio_settings WHERE user_id = ? LIMIT 1");
  $stmt->execute([$user['id']]);
  $row      = $stmt->fetch(PDO::FETCH_ASSOC);
  $filePath = $row ? $row[$type] : null;
} catch (Exception $e) {
  error_log("delete_audio: DB read error — " . $e->getMessage());
  $_SESSION['flash_message'] = 'Database error while reading audio path.';
  $_SESSION['flash_type']    = 'error';
  header('Location: settings.php');
  exit;
}

if (empty($filePath)) {
  $_SESSION['flash_message'] = 'No audio file found to delete.';
  $_SESSION['flash_type']    = 'warning';
  header('Location: settings.php');
  exit;
}

// ── Delete physical file ──────────────────────────────────────────────────────
$absPath = dirname(__DIR__) . '/' . $filePath;

if (file_exists($absPath)) {
  if (!unlink($absPath)) {
    error_log("delete_audio: unlink failed for $absPath");
    // Continue anyway — still clear the DB record
  }
}

// ── Clear DB column ───────────────────────────────────────────────────────────
try {
  $stmt = $userPdo->prepare("UPDATE user_audio_settings SET `$type` = NULL WHERE user_id = ?");
  $stmt->execute([$user['id']]);

  logSystemAction(
    $user['id'],
    'AUDIO_DELETED',
    'User deleted audio: ' . $type . ' (' . basename($filePath) . ')'
  );

  $_SESSION['flash_message'] = ucfirst(str_replace(['_audio_path', '_'], ['', ' '], $type)) . ' audio removed.';
  $_SESSION['flash_type']    = 'success';
} catch (PDOException $e) {
  error_log("delete_audio: DB update error — " . $e->getMessage());
  $_SESSION['flash_message'] = 'File deleted but database update failed.';
  $_SESSION['flash_type']    = 'warning';
}

header('Location: settings.php');
exit;
