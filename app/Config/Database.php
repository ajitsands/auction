<?php
namespace App\Config;

use PDO;
use PDOException;

class Database {
    private static ?PDO $instance = null;

    public static function getConnection(): PDO {
        if (self::$instance === null) {
            // Load .env file if present
            $envFile = dirname(__DIR__, 2) . '/.env';
            if (file_exists($envFile)) {
                $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                foreach ($lines as $line) {
                    $line = trim($line);
                    if ($line === '' || str_starts_with($line, '#')) continue;
                    if (str_contains($line, '=')) {
                        [$k, $v] = explode('=', $line, 2);
                        $k = trim($k);
                        $v = trim($v, " \t\n\r\0\x0B\"'");
                        if (!isset($_ENV[$k])) {
                            $_ENV[$k] = $v;
                            putenv("$k=$v");
                        }
                    }
                }
            }

            $host = getenv('DB_HOST') ?: ($_ENV['DB_HOST'] ?? '127.0.0.1');
            $port = getenv('DB_PORT') ?: ($_ENV['DB_PORT'] ?? '3306');
            $db   = getenv('DB_NAME') ?: ($_ENV['DB_NAME'] ?? 'church_testing_dbv2');
            $user = getenv('DB_USER') ?: ($_ENV['DB_USER'] ?? 'root');
            $pass = getenv('DB_PASS') ?: ($_ENV['DB_PASS'] ?? 'S@nds1@b');
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
