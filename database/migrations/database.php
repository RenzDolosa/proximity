<?php
// database/migration/database.php --> database redirect access

require_once '../../config/config.php';
require_once '../../config/db.php';

if (isset($_SESSION['user_id'])) {
  header('Location: ../../portal.php');
  exit();
}

?>