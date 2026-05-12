<?php
// config/paths.php — single source of truth for filesystem roots (no trailing slash).

if (!defined('ROOT_PATH')) {
  define('ROOT_PATH', dirname(__DIR__));
}

if (!defined('PATH_CONFIG')) {
  define('PATH_CONFIG', __DIR__);
}

if (!defined('PATH_APP')) {
  define('PATH_APP', ROOT_PATH . '/app');
}

if (!defined('PATH_APP_HTTP')) {
  define('PATH_APP_HTTP', PATH_APP . '/http');
}

if (!defined('PATH_APP_CONTROLLERS')) {
  define('PATH_APP_CONTROLLERS', PATH_APP_HTTP . '/controllers');
}

if (!defined('PATH_APP_SERVICES')) {
  define('PATH_APP_SERVICES', PATH_APP . '/services');
}

if (!defined('PATH_RESOURCE')) {
  define('PATH_RESOURCE', ROOT_PATH . '/resource');
}

if (!defined('PATH_VIEWS')) {
  define('PATH_VIEWS', PATH_RESOURCE . '/views');
}

if (!defined('PATH_VIEWS_IFRAME')) {
  define('PATH_VIEWS_IFRAME', PATH_VIEWS . '/iframe');
}

if (!defined('PATH_TESTS')) {
  define('PATH_TESTS', ROOT_PATH . '/tests');
}
