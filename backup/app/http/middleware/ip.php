<?php
// app/http/middleware/ip.php

$servername = "192.168.1.50"; // IP address of XAMPP server
$username = "remote_user";
$password = "";
$dbname = "system_database";
$port = 3306; // MySQL port

// Using MySQLi
$conn = new mysqli($servername, $username, $password, $dbname, $port);

// Check connection
if ($conn->connect_error) {
    die("Connection failed: " . $conn->connect_error);
}
echo "Connected successfully";

// Using PDO
try {
    $pdo = new PDO("mysql:host=$servername;port=$port;dbname=$dbname", $username, $password);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    echo "Connected successfully with PDO";
} catch(PDOException $e) {
    echo "Connection failed: " . $e->getMessage();
}
?>