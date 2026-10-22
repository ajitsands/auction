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
        date_default_timezone_set('Asia/Bahrain');
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

        $this->ensureSettingsTable();

        // Fast path: avoid running heavy ALTER checks and table scans on every HTTP request
        try {
            $stmt = $this->db->prepare("SELECT setting_value FROM hf_settings WHERE setting_key = 'schema_migrated_v2' LIMIT 1");
            $stmt->execute();
            if ($stmt->fetchColumn() === '1') {
                return;
            }
        } catch (\Throwable $e) {}

        // Auto-heal base tables if database user has ALTER privileges
        $this->ensureColumn('acc_promises', 'article_id', 'int(11) DEFAULT 0');
        $this->ensureColumn('acc_promises', 'remarks', 'VARCHAR(2000) DEFAULT NULL');
        $this->ensureColumn('acc_contribution', 'article_id', 'int(11) DEFAULT 0');
        $this->ensureColumn('acc_ledger_entries', 'article_id', 'int(11) DEFAULT 0');
        $this->ensureColumn('hf_promises', 'remarks', 'VARCHAR(2000) DEFAULT NULL');
        $this->ensureColumn('hf_auction_transactions', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        $this->ensureColumn('hf_auction_transactions', 'offering_type', "VARCHAR(50) DEFAULT 'Auction'");
        $this->ensureColumn('hf_auction_transactions', 'item_description', 'TEXT DEFAULT NULL');
        $this->backfillSpecialOfferingRemarks();

        try {
            $stmt = $this->db->prepare("INSERT INTO hf_settings (setting_key, setting_value) VALUES ('schema_migrated_v2', '1') ON DUPLICATE KEY UPDATE setting_value = '1'");
            $stmt->execute();
        } catch (\Throwable $e) {}
    }

    /**
     * Backfill remarks and narration for existing special offerings in acc_promises
     */
    protected function backfillSpecialOfferingRemarks(): void {
        try {
            $hasRemarks = $this->hasColumn('acc_promises', 'remarks');
            $remSet = $hasRemarks ? ", p.remarks = t.item_description" : "";

            $this->db->exec("
                UPDATE acc_promises p
                JOIN hf_auction_transactions t ON p.promise_id = t.acc_promise_id
                SET p.narration = t.item_description {$remSet}
                WHERE t.offering_type IN ('Gold', 'BedSheet')
                  AND t.item_description IS NOT NULL
                  AND t.item_description != ''
                  AND (p.narration LIKE 'Auction Promise:%' OR p.narration = '' OR p.narration IS NULL)
            ");

            $this->db->exec("
                UPDATE acc_ledger_entries le
                JOIN hf_auction_transactions t ON le.promise_id = t.acc_promise_id
                SET le.narration = t.item_description
                WHERE le.entry_type = 'MP'
                  AND t.offering_type IN ('Gold', 'BedSheet')
                  AND t.item_description IS NOT NULL
                  AND t.item_description != ''
                  AND (le.narration LIKE 'Auction Promise:%' OR le.narration = '' OR le.narration IS NULL)
            ");
        } catch (\Throwable $e) {}
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
