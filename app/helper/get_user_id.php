<?php
// app/helper/get_user_id.php --> get user id

session_start();
header('Content-Type: application/json');

$user_id = $_SESSION['user_id'] ?? 'default';

echo json_encode(['user_id' => $user_id]);
?>