<?php
// config/migrate_to_webp.php --> image migration image type to webp
// Place this file in your /config/ folder (same level as config.php)
// Run once via browser: https://proximity3pl.page.gd/config/migrate_to_webp.php?secret=AdminAdmin123

// ─── SECURITY ────────────────────────────────────────────────────────────────
define('MIGRATION_SECRET', 'AdminAdmin123'); // <-- Change before running!

if (($_GET['secret'] ?? '') !== MIGRATION_SECRET) {
  http_response_code(403);
  die('<h2 style="color:red;">403 Forbidden — provide ?secret=YOUR_SECRET in the URL.</h2>');
}

require_once 'config.php';

if (!isset($_SESSION['user_id'])) {
  // Allow running without login only if accessed with ?force=1 alongside secret
  // Useful when running from CLI or before login system is set up
  if (($_GET['force'] ?? '') !== '1') {
    die('<h2>Not logged in. Append &force=1 to the URL to run without a session, or log in first.</h2>');
  }
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
define('UPLOAD_DIR',  __DIR__ . '/../public/uploads/user/');
define('WEBP_QUALITY', 82);   // 0–100, 82 is a good balance
define('MAX_WIDTH',    800);   // Resize if wider than this (px), 0 = no resize
define('DRY_RUN', isset($_GET['dry'])); // Append ?dry to preview without making changes

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function convertToWebP(string $srcPath, string $destPath): bool
{
  if (!function_exists('imagewebp')) {
    return false;
  }

  $ext = strtolower(pathinfo($srcPath, PATHINFO_EXTENSION));

  $src = match ($ext) {
    'jpg', 'jpeg' => @imagecreatefromjpeg($srcPath),
    'png'         => @imagecreatefrompng($srcPath),
    'gif'         => @imagecreatefromgif($srcPath),
    default       => false,
  };

  if (!$src) return false;

  $origW = imagesx($src);
  $origH = imagesy($src);

  // Optional resize
  if (MAX_WIDTH > 0 && $origW > MAX_WIDTH) {
    $newW    = MAX_WIDTH;
    $newH    = (int) round($origH * (MAX_WIDTH / $origW));
    $resized = imagecreatetruecolor($newW, $newH);

    imagealphablending($resized, false);
    imagesavealpha($resized, true);
    $transparent = imagecolorallocatealpha($resized, 0, 0, 0, 127);
    imagefilledrectangle($resized, 0, 0, $newW, $newH, $transparent);
    imagecopyresampled($resized, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);

    imagedestroy($src);
    $src = $resized;
  }

  $ok = imagewebp($src, $destPath, WEBP_QUALITY);
  imagedestroy($src);
  return $ok;
}

function formatBytes(int $bytes): string
{
  if ($bytes >= 1048576) return round($bytes / 1048576, 2) . ' MB';
  if ($bytes >= 1024)    return round($bytes / 1024, 1)    . ' KB';
  return $bytes . ' B';
}

function badge(string $text, string $color): string
{
  return "<span style='background:{$color};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:bold;'>{$text}</span>";
}

// ─── GATHER ALL USER IDs FROM DB ──────────────────────────────────────────────
$userIds = [];
try {
  $pdo  = getMainDBConnection();
  $stmt = $pdo->query("SELECT id FROM users ORDER BY id ASC");
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $userIds[] = $row['id'];
  }
} catch (Exception $e) {
  die('<h2>DB error: ' . htmlspecialchars($e->getMessage()) . '</h2>');
}

if (empty($userIds)) {
  die('<h2>No users found in database.</h2>');
}

// ─── GD CHECK ─────────────────────────────────────────────────────────────────
$gdAvailable  = function_exists('imagewebp');
$gdVersion    = defined('GD_VERSION') ? GD_VERSION : 'unknown';

// ─── OUTPUT HTML ─────────────────────────────────────────────────────────────
?>
<!DOCTYPE html>
<html lang="en">

<head>
  <meta charset="UTF-8">
  <title>WebP Migration</title>
  <style>
    * {
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', sans-serif;
      background: #f0f2f5;
      margin: 0;
      padding: 20px;
      color: #333;
    }

    h1 {
      color: #2c3e50;
    }

    h2 {
      color: #34495e;
      margin-top: 30px;
    }

    .container {
      max-width: 960px;
      margin: 0 auto;
      background: #fff;
      border-radius: 10px;
      padding: 30px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }

    .info-box {
      background: #eaf4ff;
      border-left: 4px solid #3498db;
      padding: 14px 18px;
      border-radius: 4px;
      margin-bottom: 20px;
    }

    .warn-box {
      background: #fff8e1;
      border-left: 4px solid #f39c12;
      padding: 14px 18px;
      border-radius: 4px;
      margin-bottom: 20px;
    }

    .success-box {
      background: #eafaf1;
      border-left: 4px solid #27ae60;
      padding: 14px 18px;
      border-radius: 4px;
      margin-bottom: 20px;
    }

    .error-box {
      background: #fdedec;
      border-left: 4px solid #e74c3c;
      padding: 14px 18px;
      border-radius: 4px;
      margin-bottom: 20px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 13px;
    }

    th {
      background: #2c3e50;
      color: #fff;
      padding: 10px 12px;
      text-align: left;
    }

    td {
      padding: 8px 12px;
      border-bottom: 1px solid #eee;
      vertical-align: middle;
    }

    tr:nth-child(even) td {
      background: #f9f9f9;
    }

    .summary {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin: 20px 0;
    }

    .stat {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 16px 22px;
      flex: 1;
      min-width: 120px;
      text-align: center;
      border: 1px solid #e0e0e0;
    }

    .stat .num {
      font-size: 28px;
      font-weight: bold;
      color: #2c3e50;
    }

    .stat .lbl {
      font-size: 12px;
      color: #888;
      margin-top: 4px;
    }

    .dry-banner {
      background: #fff3cd;
      border: 2px dashed #f39c12;
      padding: 12px 18px;
      border-radius: 6px;
      font-weight: bold;
      color: #856404;
      margin-bottom: 20px;
    }

    img.thumb {
      width: 40px;
      height: 40px;
      object-fit: cover;
      border-radius: 4px;
      border: 1px solid #ddd;
    }
  </style>
</head>

<body>
  <div class="container">
    <h1>🖼️ WebP Image Migration</h1>

    <?php if (DRY_RUN): ?>
      <div class="dry-banner">⚠️ DRY RUN MODE — No files will be changed. Remove &amp;dry from the URL to run for real.</div>
    <?php endif; ?>

    <div class="info-box">
      <strong>GD Library:</strong> <?= $gdAvailable ? '✅ Available (v' . $gdVersion . ')' : '❌ Not available — cannot convert' ?><br>
      <strong>Upload directory:</strong> <?= htmlspecialchars(realpath(UPLOAD_DIR) ?: UPLOAD_DIR) ?><br>
      <strong>WebP quality:</strong> <?= WEBP_QUALITY ?> &nbsp;|&nbsp;
      <strong>Max width:</strong> <?= MAX_WIDTH > 0 ? MAX_WIDTH . 'px' : 'No resize' ?><br>
      <strong>Users found:</strong> <?= count($userIds) ?>
    </div>

    <?php if (!$gdAvailable): ?>
      <div class="error-box">❌ GD WebP support is not enabled on this server. Contact your host to enable the <code>gd</code> extension with WebP support.</div>
  </div>
</body>

</html>
<?php exit;
    endif; ?>

<?php
// ─── MAIN MIGRATION LOOP ──────────────────────────────────────────────────────

$totalConverted = 0;
$totalSkipped   = 0;
$totalFailed    = 0;
$totalAlready   = 0;
$savedBytes     = 0;
$rows           = [];

foreach ($userIds as $userId) {
  try {
    $userPdo = getUserDBConnection($userId);

    // Fetch all employees that have an image
    $stmt = $userPdo->query("SELECT id, fullname, image FROM employees WHERE image IS NOT NULL AND image != ''");
    $emps = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($emps as $emp) {
      $oldFilename = $emp['image'];
      $srcPath     = UPLOAD_DIR . $oldFilename;
      $ext         = strtolower(pathinfo($oldFilename, PATHINFO_EXTENSION));

      // Already WebP
      if ($ext === 'webp') {
        $totalAlready++;
        $rows[] = [
          'user'    => $userId,
          'emp'     => $emp['fullname'],
          'old'     => $oldFilename,
          'new'     => '—',
          'saved'   => '—',
          'status'  => 'already_webp',
        ];
        continue;
      }

      // Source file missing on disk
      if (!file_exists($srcPath)) {
        $totalFailed++;
        $rows[] = [
          'user'    => $userId,
          'emp'     => $emp['fullname'],
          'old'     => $oldFilename,
          'new'     => '—',
          'saved'   => '—',
          'status'  => 'file_missing',
        ];
        continue;
      }

      $newFilename = preg_replace('/\.[^.]+$/', '.webp', $oldFilename);
      $destPath    = UPLOAD_DIR . $newFilename;
      $oldSize     = filesize($srcPath);

      if (DRY_RUN) {
        // Preview only
        $totalConverted++;
        $rows[] = [
          'user'    => $userId,
          'emp'     => $emp['fullname'],
          'old'     => $oldFilename . ' (' . formatBytes($oldSize) . ')',
          'new'     => $newFilename,
          'saved'   => '~' . formatBytes((int)($oldSize * 0.4)) . ' est.',
          'status'  => 'dry_run',
        ];
        continue;
      }

      // Convert
      $ok = convertToWebP($srcPath, $destPath);

      if ($ok && file_exists($destPath)) {
        $newSize  = filesize($destPath);
        $diff     = $oldSize - $newSize;
        $savedBytes += max(0, $diff);

        // Update DB record
        try {
          $upd = $userPdo->prepare("UPDATE employees SET image = :img WHERE id = :id");
          $upd->execute([':img' => $newFilename, ':id' => $emp['id']]);
        } catch (Exception $dbEx) {
          // DB update failed — remove the new webp so nothing is inconsistent
          @unlink($destPath);
          $totalFailed++;
          $rows[] = [
            'user'    => $userId,
            'emp'     => $emp['fullname'],
            'old'     => $oldFilename,
            'new'     => '—',
            'saved'   => '—',
            'status'  => 'db_error',
            'note'    => $dbEx->getMessage(),
          ];
          continue;
        }

        // Remove old file
        @unlink($srcPath);

        $totalConverted++;
        $rows[] = [
          'user'    => $userId,
          'emp'     => $emp['fullname'],
          'old'     => $oldFilename . ' (' . formatBytes($oldSize) . ')',
          'new'     => $newFilename . ' (' . formatBytes($newSize) . ')',
          'saved'   => ($diff > 0 ? '-' . formatBytes($diff) : '+' . formatBytes(abs($diff))),
          'status'  => 'converted',
        ];
      } else {
        $totalFailed++;
        $rows[] = [
          'user'    => $userId,
          'emp'     => $emp['fullname'],
          'old'     => $oldFilename,
          'new'     => '—',
          'saved'   => '—',
          'status'  => 'convert_failed',
        ];
      }
    }
  } catch (Exception $e) {
    $rows[] = [
      'user'    => $userId,
      'emp'     => '—',
      'old'     => '—',
      'new'     => '—',
      'saved'   => '—',
      'status'  => 'user_db_error',
      'note'    => $e->getMessage(),
    ];
  }
}

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
?>

<div class="summary">
  <div class="stat">
    <div class="num" style="color:#27ae60"><?= $totalConverted ?></div>
    <div class="lbl">Converted</div>
  </div>
  <div class="stat">
    <div class="num" style="color:#3498db"><?= $totalAlready  ?></div>
    <div class="lbl">Already WebP</div>
  </div>
  <div class="stat">
    <div class="num" style="color:#e67e22"><?= $totalFailed   ?></div>
    <div class="lbl">Failed</div>
  </div>
  <div class="stat">
    <div class="num" style="color:#9b59b6"><?= formatBytes($savedBytes) ?></div>
    <div class="lbl">Space Saved</div>
  </div>
</div>

<?php if (!DRY_RUN && $totalConverted > 0): ?>
  <div class="success-box">
    ✅ Migration complete! <strong><?= $totalConverted ?></strong> image(s) converted to WebP.
    Total space saved: <strong><?= formatBytes($savedBytes) ?></strong>.<br>
    <strong>⚠️ Delete this file now</strong> — it should not remain on your server.
  </div>
<?php elseif (DRY_RUN): ?>
  <div class="warn-box">
    This is a dry run. <strong><?= $totalConverted ?></strong> image(s) would be converted.
    Remove <code>&amp;dry</code> from the URL to run for real.
  </div>
<?php endif; ?>

<h2>Detail Log</h2>
<table>
  <thead>
    <tr>
      <th>User ID</th>
      <th>Employee</th>
      <th>Original File</th>
      <th>New File</th>
      <th>Space Saved</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <?php foreach ($rows as $r): ?>
      <tr>
        <td><?= htmlspecialchars($r['user']) ?></td>
        <td><?= htmlspecialchars($r['emp']) ?></td>
        <td><?= htmlspecialchars($r['old']) ?></td>
        <td><?= htmlspecialchars($r['new']) ?></td>
        <td><?= htmlspecialchars($r['saved']) ?></td>
        <td>
          <?php
          echo match ($r['status']) {
            'converted'      => badge('✅ Converted',     '#27ae60'),
            'already_webp'   => badge('🔵 Already WebP',  '#3498db'),
            'dry_run'        => badge('🟡 Dry Run',        '#f39c12'),
            'file_missing'   => badge('⚠️ File Missing',  '#e67e22'),
            'convert_failed' => badge('❌ Convert Failed', '#e74c3c'),
            'db_error'       => badge('❌ DB Error',       '#c0392b'),
            'user_db_error'  => badge('❌ User DB Error',  '#c0392b'),
            default          => badge($r['status'],        '#95a5a6'),
          };
          if (!empty($r['note'])) {
            echo '<br><small style="color:#c0392b">' . htmlspecialchars($r['note']) . '</small>';
          }
          ?>
        </td>
      </tr>
    <?php endforeach; ?>
  </tbody>
</table>

</div>
</body>

</html>
<?php
// Log the migration
if (isset($_SESSION['user_id'])) {
  logSystemAction(
    $_SESSION['user_id'],
    'WEBP_MIGRATION',
    "Converted: $totalConverted, Already WebP: $totalAlready, Failed: $totalFailed, Saved: " . formatBytes($savedBytes)
  );
}
?>