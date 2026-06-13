<?php
// config/paths.php — single source of truth for filesystem roots (no trailing slash).

if (!defined('ROOT_PATH'))                define('ROOT_PATH',               dirname(__DIR__));
if (!defined('PATH_CONFIG'))              define('PATH_CONFIG',             __DIR__);
if (!defined('PATH_APP'))                 define('PATH_APP',                ROOT_PATH     . '/app');
if (!defined('PATH_APP_HTTP'))            define('PATH_APP_HTTP',           PATH_APP      . '/http');
if (!defined('PATH_APP_CONTROLLERS'))     define('PATH_APP_CONTROLLERS',    PATH_APP_HTTP . '/controllers');
if (!defined('PATH_APP_SERVICES'))        define('PATH_APP_SERVICES',       PATH_APP      . '/services');
if (!defined('PATH_RESOURCE'))            define('PATH_RESOURCE',           ROOT_PATH     . '/resource');
if (!defined('PATH_VIEWS'))               define('PATH_VIEWS',              PATH_RESOURCE . '/views');
if (!defined('PATH_VIEWS_IFRAME'))        define('PATH_VIEWS_IFRAME',       PATH_VIEWS    . '/iframe');
if (!defined('PATH_TESTS'))               define('PATH_TESTS',              ROOT_PATH     . '/tests');

// ── Base URL segments ──
if (!defined('URL_VIEWS_IFRAME'))         define('URL_VIEWS_IFRAME',        '/resource/views/iframe');
if (!defined('URL_VIEWS'))                define('URL_VIEWS',               '/resource/views');
if (!defined('URL_APP_SERVICES'))         define('URL_APP_SERVICES',        '/app/services');
if (!defined('URL_APP_HTTP'))             define('URL_APP_HTTP',            '/app/http/controllers');
if (!defined('URL_TESTS'))                define('URL_TESTS',               '/tests');

// ── ROUTES (iframe src targets) ──
if (!defined('ROUTE_HOME'))               define('ROUTE_HOME',              URL_VIEWS_IFRAME  . '/main.php');
if (!defined('ROUTE_DASHBOARD'))          define('ROUTE_DASHBOARD',         URL_VIEWS_IFRAME  . '/main.php?page=employee+dashboard');
if (!defined('ROUTE_ADMIN_PANEL'))        define('ROUTE_ADMIN_PANEL',       URL_VIEWS_IFRAME  . '/main.php?page=admin+panel');
if (!defined('ROUTE_SETTINGS'))           define('ROUTE_SETTINGS',          URL_VIEWS_IFRAME  . '/main.php?page=settings');
if (!defined('ROUTE_ACCOUNT'))            define('ROUTE_ACCOUNT',           URL_VIEWS_IFRAME  . '/main.php?page=account');
if (!defined('ROUTE_ABOUT'))              define('ROUTE_ABOUT',             URL_VIEWS_IFRAME  . '/main.php?page=about');
if (!defined('ROUTE_README'))             define('ROUTE_README',            '/app/models/readme.php');

// ── DIR_ROUTES (window.location.href targets) ──
if (!defined('ROUTE_PROXIMITY'))          define('ROUTE_PROXIMITY',         '/proximity.php');
if (!defined('ROUTE_QR_PROX'))            define('ROUTE_QR_PROX',           '/proximity.php?page=qr proximity');
if (!defined('ROUTE_FACIAL'))             define('ROUTE_FACIAL',            '/proximity.php?page=facial-identification');
if (!defined('ROUTE_MANUAL'))             define('ROUTE_MANUAL',            '/proximity.php?page=manual input');
if (!defined('ROUTE_PORTAL'))             define('ROUTE_PORTAL',            '/portal.php');
if (!defined('ROUTE_LOGIN'))              define('ROUTE_LOGIN',             '/index.php');
if (!defined('ROUTE_FORGET'))             define('ROUTE_FORGET',            '/index.php?page=forget');
if (!defined('ROUTE_REGISTER'))           define('ROUTE_REGISTER',          URL_VIEWS         . '/reg.php');

// ── APP_ROUTES (navigateWithLoading targets) ──
if (!defined('ROUTE_APP_EMPLOYEES'))      define('ROUTE_APP_EMPLOYEES',     URL_APP_SERVICES  . '/table panel.php?tab=employees');
if (!defined('ROUTE_APP_DATALOG'))        define('ROUTE_APP_DATALOG',       URL_APP_SERVICES  . '/table panel.php?tab=datalog');
if (!defined('ROUTE_APP_PROXIMITY'))      define('ROUTE_APP_PROXIMITY',     URL_APP_SERVICES  . '/table panel.php?tab=proximity');
if (!defined('ROUTE_APP_REMARKS'))        define('ROUTE_APP_REMARKS',       URL_APP_SERVICES  . '/table panel.php?tab=remarks');
if (!defined('ROUTE_APP_ATTENDANCE'))     define('ROUTE_APP_ATTENDANCE',    URL_APP_SERVICES  . '/table panel.php?tab=attendance');
if (!defined('ROUTE_APP_SCAN_TEST'))      define('ROUTE_APP_SCAN_TEST',     URL_APP_HTTP      . '/scan test.php');
if (!defined('ROUTE_APP_QR_PROX'))        define('ROUTE_APP_QR_PROX',       URL_APP_HTTP      . '/qr proximity.php');
if (!defined('ROUTE_APP_MANUAL_INPUT'))   define('ROUTE_APP_MANUAL_INPUT',  URL_APP_HTTP      . '/manual input.php');
if (!defined('ROUTE_APP_TEST'))           define('ROUTE_APP_TEST',          URL_TESTS         . '/m-i v2.php');

// ── APP_ROUTES (admin panel sections) ──
if (!defined('ROUTE_APP_USERS'))          define('ROUTE_APP_USERS',         '/resource/views/admin panel.php#users');
if (!defined('ROUTE_APP_GROUP'))          define('ROUTE_APP_GROUP',         '/resource/views/admin panel.php#group');
if (!defined('ROUTE_APP_LOGS'))           define('ROUTE_APP_LOGS',          '/resource/views/admin panel.php#logs');
if (!defined('ROUTE_APP_MYADMIN'))        define('ROUTE_APP_MYADMIN',       '/resource/views/admin panel.php#myadmin');

// ── ENDPOINT_ROUTES ──
if (!defined('ROUTE_END_EMPLOYEES'))      define('ROUTE_END_EMPLOYEES',     '/app/services/manpower_backend.php');
if (!defined('ROUTE_END_DATALOG'))        define('ROUTE_END_DATALOG',       '/app/services/datalog_backend.php');
if (!defined('ROUTE_END_PROXIMITY'))      define('ROUTE_END_PROXIMITY',     '/app/services/proxcode_backend.php');
if (!defined('ROUTE_END_REMARKS'))        define('ROUTE_END_REMARKS',       '/app/services/violation_log_backend.php');
if (!defined('ROUTE_END_ATTENDANCE'))     define('ROUTE_END_ATTENDANCE',    '/app/services/attendancelog_backend.php');
if (!defined('ROUTE_END_QR_PROX'))        define('ROUTE_END_QR_PROX',       '/app/services/qr_search_backend.php');
if (!defined('ROUTE_END_SCAN_TEST'))      define('ROUTE_END_SCAN_TEST',     '/app/services/scanTest_search_backend.php');
if (!defined('ROUTE_END_AUDIO'))          define('ROUTE_END_AUDIO',         '/app/services/global_audio.php');
if (!defined('ROUTE_END_NOTIF'))          define('ROUTE_END_NOTIF',         '/app/services/notifications_backend.php');
if (!defined('ROUTE_END_USERID'))         define('ROUTE_END_USERID',        '/app/helper/get_user_id.php');

// ── SYNC_ROUTSE ──
if (!defined('ROUTE_END_SYNC')) define('ROUTE_END_SYNC', '/app/http/middleware/sync_queue.php');

const ROUTE_TOKENS = [
  'x7k2m' => ROUTE_HOME,
  'p9q4n' => ROUTE_DASHBOARD,
  'r3w8j' => ROUTE_ADMIN_PANEL,
  'z1v5t' => ROUTE_SETTINGS,
  'b6h0c' => ROUTE_ACCOUNT,
  'f2s9d' => ROUTE_ABOUT,
  'n8x1q' => ROUTE_README,

  'gfe43' => ROUTE_PROXIMITY,
  'mert3' => ROUTE_QR_PROX,
  'sdf63' => ROUTE_FACIAL,
  'nf35d' => ROUTE_MANUAL,

  'ger34' => ROUTE_APP_EMPLOYEES,
  'fvn53' => ROUTE_APP_DATALOG,
  'f74fa' => ROUTE_APP_PROXIMITY,
  'hft21' => ROUTE_APP_ATTENDANCE,
  'g434s' => ROUTE_APP_REMARKS,
  'sc4nt' => ROUTE_APP_SCAN_TEST,
  'mi4f2' => ROUTE_APP_MANUAL_INPUT,
  'tst03' => ROUTE_APP_TEST,

  'adm01' => ROUTE_APP_USERS,
  'adm02' => ROUTE_APP_GROUP,
  'adm03' => ROUTE_APP_LOGS,
  'adm04' => ROUTE_APP_MYADMIN,

  'tg54d' => ROUTE_END_EMPLOYEES,
  'qe52g' => ROUTE_END_DATALOG,
  'l4gs2' => ROUTE_END_PROXIMITY,
  'vf3df' => ROUTE_END_REMARKS,
  'ul3a4' => ROUTE_END_ATTENDANCE,
  'i5es2' => ROUTE_END_QR_PROX,
  'hefs4' => ROUTE_END_SCAN_TEST,
  'ght3s' => ROUTE_END_AUDIO,
  'gdh43' => ROUTE_END_NOTIF,
  'fger4' => ROUTE_END_USERID,

  'sy1nc' => ROUTE_END_SYNC,
];

const PUBLIC_TOKENS = [
  'bvdf4' => ROUTE_LOGIN,
  'h23as' => ROUTE_FORGET,
  'l23fa' => ROUTE_REGISTER,
];