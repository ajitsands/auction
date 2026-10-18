<?php
namespace App\Config;

use PDO;
use PDOException;

class Database {
    private static ?PDO $instance = null;

    public static function getConnection(): PDO {
        if (self::$instance === null) {
            $host = '127.0.0.1';
            $port = '3306';
            $db   = 'church_testing_dbv2';
            $user = 'root';
            $pass = 'S@nds1@b';
            $charset = 'utf8mb4';

            $dsn = "mysql:host=$host;port=$port;dbname=$db;charset=$charset";
            $options = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ];

            try {
                self::$instance = new PDO($dsn, $user, $pass, $options);
            } catch (PDOException $e) {
                // Return clean JSON error if called via API
                if (str_contains($_SERVER['REQUEST_URI'] ?? '', '/api/')) {
                    header('Content-Type: application/json', true, 500);
                    echo json_encode(['success' => false, 'error' => 'Database connection failed: ' . $e->getMessage()]);
                    exit;
                }
                die("Database connection failed: " . htmlspecialchars($e->getMessage()));
            }
        }
        return self::$instance;
    }
}
