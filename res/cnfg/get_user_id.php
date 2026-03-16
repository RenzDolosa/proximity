<?php
session_start();
header('Content-Type: application/json');

// Return the current user ID from the session
$user_id = $_SESSION['user_id'] ?? 'default';

echo json_encode(['user_id' => $user_id]);
?>