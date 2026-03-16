<?php
// database.php

require_once 'res/cnfg/config.php';
require_once 'res/cnfg/db.php';

// Redirect to login if not authenticated
if (isset($_SESSION['user_id'])) {
  header('Location: portal.php');
  exit();
}

?>