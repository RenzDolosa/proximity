<?php
// app/services/global_audio.php
// Global audio settings endpoint — mirrors company_settings_global pattern.
// GET  (XHR) → returns current audio as base64 data-URLs
// POST (XHR) → saves uploaded audio files

require_once __DIR__ . '/../../config/config.php';

if (!isLoggedIn()) {
  header('Content-Type: application/json');
  echo json_encode(['success' => false, 'message' => 'Unauthorized']);
  exit;
}

// ── Ensure global audio table exists ─────────────────────────────────────────
function ensureGlobalAudioTable($pdo)
{
  $pdo->exec("CREATE TABLE IF NOT EXISTS global_audio_settings (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        audio_type      VARCHAR(50) NOT NULL UNIQUE,
        audio_data      MEDIUMTEXT DEFAULT '',
        audio_mime      VARCHAR(50)  DEFAULT '',
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

$isAjax = isset($_SERVER['HTTP_X_REQUESTED_WITH']) &&
  strtolower($_SERVER['HTTP_X_REQUESTED_WITH']) === 'xmlhttprequest';

$audioTypes = ['success', 'checkout', 'not_found', 'inactive', 'violations'];

// ── AJAX GET ─────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET' && $isAjax) {
  header('Content-Type: application/json');
  header('Cache-Control: no-store, no-cache, must-revalidate');
  header('Pragma: no-cache');

  $pdo = getDBConnection();
  ensureGlobalAudioTable($pdo);

  $rows = $pdo->query(
    "SELECT audio_type, audio_data, audio_mime
         FROM global_audio_settings
         WHERE audio_type IN ('" . implode("','", $audioTypes) . "')"
  )->fetchAll(PDO::FETCH_ASSOC);

  $result = array_fill_keys($audioTypes, ['data' => '', 'mime' => '']);
  foreach ($rows as $row) {
    $result[$row['audio_type']] = [
      'data' => $row['audio_data'],
      'mime' => $row['audio_mime'],
    ];
  }

  echo json_encode(['success' => true, 'audio' => $result]);
  exit;
}

// ── AJAX POST ─────────────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && $isAjax) {
  header('Content-Type: application/json');

  $body      = json_decode(file_get_contents('php://input'), true);
  $audioType = $body['audio_type'] ?? '';
  $audioData = $body['audio_data'] ?? '';   // base64 data-URL  e.g. "data:audio/mpeg;base64,..."
  $audioMime = $body['audio_mime'] ?? '';

  if (!in_array($audioType, $audioTypes, true)) {
    echo json_encode(['success' => false, 'message' => 'Invalid audio type']);
    exit;
  }

  // ~5 MB limit in base64 (base64 inflates ~33 %, so raw 5 MB ≈ 6.8 MB base64)
  if (strlen($audioData) > 7_000_000) {
    echo json_encode(['success' => false, 'message' => 'Audio file too large (max 5 MB)']);
    exit;
  }

  $pdo = getDBConnection();
  ensureGlobalAudioTable($pdo);

  $stmt = $pdo->prepare(
    "INSERT INTO global_audio_settings (audio_type, audio_data, audio_mime)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE audio_data = VALUES(audio_data),
                                 audio_mime = VALUES(audio_mime)"
  );
  $stmt->execute([$audioType, $audioData, $audioMime]);

  echo json_encode(['success' => true]);
  exit;
}

// ── DELETE single audio type ──────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'DELETE' && $isAjax) {
  header('Content-Type: application/json');

  $body      = json_decode(file_get_contents('php://input'), true);
  $audioType = $body['audio_type'] ?? '';

  if (!in_array($audioType, $audioTypes, true)) {
    echo json_encode(['success' => false, 'message' => 'Invalid audio type']);
    exit;
  }

  $pdo = getDBConnection();
  ensureGlobalAudioTable($pdo);

  $stmt = $pdo->prepare(
    "UPDATE global_audio_settings
         SET audio_data = '', audio_mime = ''
         WHERE audio_type = ?"
  );
  $stmt->execute([$audioType]);

  echo json_encode(['success' => true]);
  exit;
}
