<?php
// config/asset.php — serves static assets through an opaque token

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';

const ASSET_TOKENS = [
  // Images / icons / logo / sounds
  's3t4u' => '/resource/assets/icon/database-icon.svg',
  'xpet4' => '/resource/assets/icon/excel.svg',
  'g4ld2' => '/resource/assets/icon/face-id.svg',
  'gnks2' => '/resource/assets/icon/nfc-icon.svg',
  'sszj3' => '/resource/assets/icon/qr-icon.svg',
  'rjr54' => '/resource/assets/icon/scan-icon.svg',
  'asc4s' => '/resource/assets/icon/scanTest.svg',

  'fgbk4' => '/resource/assets/logo/coming-soon.svg',
  'v5w6x' => '/resource/assets/logo/database.svg',
  't43us' => '/resource/assets/logo/manual.svg',
  'dfk34' => '/resource/assets/logo/mysql-logo.svg',
  'sk4ds' => '/resource/assets/logo/mysql.svg',
  'cfk4d' => '/resource/assets/logo/nfc-logo.svg',
  'aur2d' => '/resource/assets/logo/proximity-logo.svg',

  'jg5df' => '/resource/assets/sounds/checkout.mp3',
  'ert26' => '/resource/assets/sounds/inactive.mp3',
  'sdh3f' => '/resource/assets/sounds/noresultsfound.mp3',
  'l45wd' => '/resource/assets/sounds/ohh-ow.mp3',
  'ero67' => '/resource/assets/sounds/success.mp3',
  
  // CSS
  'l234w' => '/resource/css/about.css',
  'h46e2' => '/resource/css/acct.css',
  'rtf2w' => '/resource/css/alert.css',
  'c24hj' => '/resource/css/btn.css',
  'a5dh7' => '/resource/css/date-range-picker.css',
  'n8hsr' => '/resource/css/emp-db.css',
  'fg6r2' => '/resource/css/full-screen.css',
  'j35za' => '/resource/css/is.css',
  'q5fwr' => '/resource/css/loading.css',
  'k95g3' => '/resource/css/m-i.css',
  'a57s4' => '/resource/css/main.css',
  'g5f2v' => '/resource/css/modal.css',
  'p5sdi' => '/resource/css/opt-btn.css',
  'x48xd' => '/resource/css/pg.css',
  'mq4wc' => '/resource/css/ptl.css',
  'zdsj4' => '/resource/css/qp.css',
  'a1b2c' => '/resource/css/r-l.css',
  'f48sv' => '/resource/css/req.css',
  'jrsb4' => '/resource/css/root.css',
  'ht5sf' => '/resource/css/sbar.css',
  'by9d3' => '/resource/css/sett.css',
  'qx2p1' => '/resource/css/system-camera.css',
  'yde24' => '/resource/css/system.css',

  // JS
  'xar14' => '/resource/js/act.js',
  'cq4da' => '/resource/js/attendancelog.js',
  'm6efw' => '/resource/js/btn.js',
  'kg56e' => '/resource/js/clock.js',
  'kter8' => '/resource/js/date-picker.js',
  'kaew3' => '/resource/js/date-range-picker.js',
  'acwr3' => '/resource/js/dtl.js',
  'j445s' => '/resource/js/ea-attendancelog.js',
  'mt6ed' => '/resource/js/ea-dtl.js',
  'dxer5' => '/resource/js/eas.js',
  'dsf23' => '/resource/js/full-screen.js',
  'xd6ls' => '/resource/js/global_audio_settings.js',
  'fjhc5' => '/resource/js/i-dtl.js',
  'ds6ed' => '/resource/js/ipc.js',
  'd9fsd' => '/resource/js/is.js',
  'g5h6i' => '/resource/js/li.js',
  'oqw56' => '/resource/js/loading.js',
  'sdk4s' => '/resource/js/m-i v2.js',
  'sft2s' => '/resource/js/main.js',
  'ipe4s' => '/resource/js/notifications.js',
  'as3ks' => '/resource/js/opt-btn.js',
  'edrg3' => '/resource/js/pagination.js',
  'zdsf5' => '/resource/js/panel.js',
  'jl4ds' => '/resource/js/portal.js',
  'xzjg8' => '/resource/js/proxcode.js',
  'xjf3w' => '/resource/js/qp.js',
  'zgq2a' => '/resource/js/reg.js',
  'j7k8l' => '/resource/js/req.js',
  'p1q2r' => '/resource/js/route.js',
  'aw4sa' => '/resource/js/st.js',
  'ves34' => '/resource/js/sync.js',
  'gl67w' => '/resource/js/system-camera.js',
  'ahc32' => '/resource/js/system.js',
  'm9n0o' => '/resource/js/ver.js',
  'jrk23' => '/resource/js/violation.js',
];

$token = $_GET['t'] ?? '';

if (!isset(ASSET_TOKENS[$token])) {
  http_response_code(404);
  exit;
}

$relativePath = ASSET_TOKENS[$token];
$filePath     = ROOT_PATH . $relativePath;

if (!file_exists($filePath)) {
  http_response_code(404);
  exit;
}

// MIME map
$ext  = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
$mime = match ($ext) {
  'css'  => 'text/css',
  'js'   => 'application/javascript',
  'png'  => 'image/png',
  'svg'  => 'image/svg+xml',
  'ico'  => 'image/x-icon',
  default => 'application/octet-stream',
};

// Cache headers — assets are static, aggressive caching is fine
header("Content-Type: $mime");
header('Cache-Control: private, max-age=3600');
header('X-Content-Type-Options: nosniff');

readfile($filePath);
exit;
