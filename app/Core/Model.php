<?php
namespace App\Core;

use App\Config\Database;
use PDO;

abstract class Model {
    protected PDO $db;
    private static array $columnCache = [];
    private static bool $schemaEnsured = false;

    public function __construct() {
        $this->db = Database::getConnection();
        $this->ensureAuctionSchema();
    }

    /**
     * Check if a specific column exists in a given table.
     * Caches result in memory for the request duration.
     */
    public function hasColumn(string $table, string $column): bool {
        $key = strtolower("{$table}.{$column}");
        if (isset(self::$columnCache[$key])) {
            return self::$columnCache[$key];
        }

        try {
            $stmt = $this->db->prepare("
                SELECT 1 
                FROM information_schema.COLUMNS 
                WHERE TABLE_SCHEMA = DATABASE() 
                  AND TABLE_NAME = :table 
                  AND COLUMN_NAME = :column
                LIMIT 1
            ");
            $stmt->execute(['table' => $table, 'column' => $column]);
            $exists = (bool)$stmt->fetchColumn();
            self::$columnCache[$key] = $exists;
            return $exists;
        } catch (\Throwable $e) {
            try {
                $cols = $this->db->query("SHOW COLUMNS FROM `{$table}` LIKE '{$column}'")->fetchAll();
                $exists = !empty($cols);
                self::$columnCache[$key] = $exists;
                return $exists;
            } catch (\Throwable $ex) {
                return false;
            }
        }
    }

    /**
     * Ensures a column exists by adding it if missing (self-healing migration).
     */
    public function ensureColumn(string $table, string $column, string $definition): bool {
        if ($this->hasColumn($table, $column)) {
            return true;
        }

        try {
            $this->db->exec("ALTER TABLE `{$table}` ADD COLUMN `{$column}` {$definition}");
            self::$columnCache[strtolower("{$table}.{$column}")] = true;
            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Ensure optional/extended schema columns are present on base church tables.
     */
    protected function ensureAuctionSchema(): void {
        if (self::$schemaEnsured) {
            return;
        }
        self::$schemaEnsured = true;

        // Auto-heal base tables if database user has ALTER privileges
        $this->ensureColumn('acc_promises', 'article_id', 'int(11) DEFAULT 0');
        $this->ensureColumn('acc_contribution', 'article_id', 'int(11) DEFAULT 0');
        $this->ensureColumn('acc_ledger_entries', 'article_id', 'int(11) DEFAULT 0');
        $this->ensureSettingsTable();
    }

    /**
     * Ensure hf_settings table exists
     */
    public function ensureSettingsTable(): void {
        try {
            $this->db->exec("
                CREATE TABLE IF NOT EXISTS `hf_settings` (
                    `setting_key` varchar(100) NOT NULL,
                    `setting_value` longtext DEFAULT NULL,
                    `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (`setting_key`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ");
        } catch (\Throwable $e) {}
    }
}
