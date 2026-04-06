<?php
// database.php

require_once '../../config/config.php';
require_once '../../config/db.php';

// Redirect to login if not authenticated
if (isset($_SESSION['user_id'])) {
  header('Location: ../../portal.php');
  exit();
}

?>