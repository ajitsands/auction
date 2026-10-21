<?php
namespace App\Config;

use PDO;
use PDOException;

// Ensure Asia/Bahrain timezone is active globally across all database & application operations
date_default_timezone_set('Asia/Bahrain');

class Database {
    private static ?PDO $instance = null;

    public static function getConnection(): PDO {
        if (self::$instance === null) {
            // 1. Check for .env file in root directory
            $envFile = dirname(__DIR__, 2) . '/.env';
            $hasEnv = false;
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
                        $hasEnv = true;
                    }
                }
            }

            // 2. Detect environment: Server (stmarysbahrain.com / Linux host) vs Local
            $httpHost = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? '';
            $isServer = str_contains($httpHost, 'stmarysbahrain.com')
                || (PHP_OS_FAMILY !== 'Windows' && php_sapi_name() !== 'cli-server' && !str_contains($httpHost, 'localhost'));

            // Server Credentials:
            // mysqli_connect("localhost", "church_testing_dbv2_user", "Syskode123#$#", "church_testing_dbv2")
            // Local Credentials:
            // "127.0.0.1", "root", "S@nds1@b", "church_testing_dbv2"
            $defaultHost = $isServer ? 'localhost' : '127.0.0.1';
            $defaultPort = '3306';
            $defaultDb   = 'church_testing_dbv2';
            $defaultUser = $isServer ? 'church_testing_dbv2_user' : 'root';
            $defaultPass = $isServer ? 'Syskode123#$#' : 'S@nds1@b';

            $host = getenv('DB_HOST') ?: ($_ENV['DB_HOST'] ?? $defaultHost);
            $port = getenv('DB_PORT') ?: ($_ENV['DB_PORT'] ?? $defaultPort);
            $db   = getenv('DB_NAME') ?: ($_ENV['DB_NAME'] ?? $defaultDb);
            $user = getenv('DB_USER') ?: ($_ENV['DB_USER'] ?? $defaultUser);
            $pass = getenv('DB_PASS') !== false ? getenv('DB_PASS') : ($_ENV['DB_PASS'] ?? $defaultPass);
            $charset = 'utf8mb4';

            date_default_timezone_set('Asia/Bahrain');

            $options = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+03:00'"
            ];

            $dsn = "mysql:host=$host;port=$port;dbname=$db;charset=$charset";

            try {
                self::$instance = new PDO($dsn, $user, $pass, $options);
                self::$instance->exec("SET time_zone = '+03:00'");
            } catch (PDOException $e) {
                // If primary connection fails and no explicit .env was provided, attempt fallback credentials
                if (!$hasEnv) {
                    $fallbackUser = ($user === 'root') ? 'church_testing_dbv2_user' : 'root';
                    $fallbackPass = ($user === 'root') ? 'Syskode123#$#' : 'S@nds1@b';
                    $fallbackHost = ($host === '127.0.0.1') ? 'localhost' : '127.0.0.1';
                    $fallbackDsn  = "mysql:host=$fallbackHost;port=$port;dbname=$db;charset=$charset";

                    try {
                        self::$instance = new PDO($fallbackDsn, $fallbackUser, $fallbackPass, $options);
                        self::$instance->exec("SET time_zone = '+03:00'");
                        return self::$instance;
                    } catch (PDOException) {
                        // Fallback also failed, bubble up original exception
                    }
                }

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
