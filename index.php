<?php
// index.php - Simple router

$request = trim($_SERVER['REQUEST_URI'], '/');
$request = strtok($request, '?'); // Remove query parameters

switch ($request) {
    case 'database':
        require_once 'portal.php';
        break;
    
    default:
        http_response_code(404);
        echo "Page not found";
        break;
}
?>