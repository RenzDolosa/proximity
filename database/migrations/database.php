<?php
// database/migration/database.php --> database redirect access

require_once $_SERVER['DOCUMENT_ROOT'] . '/config/config.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/config/db.php';

if (isset($_SESSION['user_id'])) {
  header('Location:', ROUTE_HOME);
  exit();
}

?>