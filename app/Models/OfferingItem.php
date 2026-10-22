<?php
namespace App\Models;

use App\Core\Model;
use PDO;

class OfferingItem extends Model {
    private static bool $tableChecked = false;

    public function __construct() {
        parent::__construct();
        $this->ensureTable();
    }

    private function ensureTable(): void {
        if (self::$tableChecked) return;

        $sql = "
            CREATE TABLE IF NOT EXISTS `hf_offering_items` (
                `item_id` int(11) NOT NULL AUTO_INCREMENT,
                `offering_type` varchar(50) NOT NULL,
                `item_description` varchar(255) NOT NULL,
                `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (`item_id`),
                UNIQUE KEY `uq_type_desc` (`offering_type`, `item_description`),
                KEY `idx_offering_type` (`offering_type`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";
        $this->db->exec($sql);

        // Seed initial default items if table is empty
        $count = (int)$this->db->query("SELECT COUNT(*) FROM hf_offering_items")->fetchColumn();
        if ($count === 0) {
            $defaultGold = [
                '1 Sovereign Gold Coin',
                '1/2 Sovereign Gold Coin',
                '1/4 Sovereign Gold Coin',
                '8 Gram Gold Coin (1 Pavan)',
                '5 Gram Gold Coin',
                '2 Gram Gold Coin',
                '1 Gram Gold Coin',
                'Gold Ring',
                'Gold Chain',
                'Gold Cross / Locket',
                'Gold Bangle',
                'Gold Earring'
            ];

            $defaultBedSheet = [
                'King Size Double Bed Sheet Set',
                'Queen Size Bed Sheet Set',
                'Single Bed Sheet Set',
                'Cotton Double Bed Sheet with 2 Pillow Covers',
                'Embroidered Double Bed Sheet Set',
                'Fitted Double Bed Sheet Set',
                'Floral Print Double Bed Sheet Set',
                'Satin Stripe Bed Sheet Set'
            ];

            $stmt = $this->db->prepare("INSERT IGNORE INTO hf_offering_items (offering_type, item_description) VALUES (:type, :desc)");
            foreach ($defaultGold as $item) {
                $stmt->execute(['type' => 'Gold', 'desc' => $item]);
            }
            foreach ($defaultBedSheet as $item) {
                $stmt->execute(['type' => 'BedSheet', 'desc' => $item]);
            }
        }

        self::$tableChecked = true;
    }

    public function getAll(?string $offeringType = null): array {
        if ($offeringType && in_array($offeringType, ['Gold', 'BedSheet'])) {
            $stmt = $this->db->prepare("
                SELECT item_id, item_id AS id, offering_type, item_description, item_description AS description, created_at 
                FROM hf_offering_items 
                WHERE offering_type = :type 
                ORDER BY item_description ASC
            ");
            $stmt->execute(['type' => $offeringType]);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        }

        $stmt = $this->db->query("
            SELECT item_id, item_id AS id, offering_type, item_description, item_description AS description, created_at 
            FROM hf_offering_items 
            ORDER BY offering_type ASC, item_description ASC
        ");
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public function add(string $offeringType, string $description): array {
        $offeringType = ($offeringType === 'BedSheet') ? 'BedSheet' : 'Gold';
        $description = trim($description);

        if ($description === '') {
            throw new \Exception('Item description cannot be empty.');
        }

        // Check if already exists
        $check = $this->db->prepare("
            SELECT item_id, item_id AS id, offering_type, item_description, item_description AS description, created_at 
            FROM hf_offering_items 
            WHERE offering_type = :type AND LOWER(TRIM(item_description)) = LOWER(:desc)
        ");
        $check->execute(['type' => $offeringType, 'desc' => $description]);
        $existing = $check->fetch(PDO::FETCH_ASSOC);
        if ($existing) {
            return $existing;
        }

        $stmt = $this->db->prepare("
            INSERT INTO hf_offering_items (offering_type, item_description) 
            VALUES (:type, :desc)
        ");
        $stmt->execute(['type' => $offeringType, 'desc' => $description]);
        $newId = (int)$this->db->lastInsertId();

        return [
            'item_id' => $newId,
            'id' => $newId,
            'offering_type' => $offeringType,
            'item_description' => $description,
            'description' => $description,
            'created_at' => date('Y-m-d H:i:s')
        ];
    }

    public function delete(int $id): bool {
        $stmt = $this->db->prepare("DELETE FROM hf_offering_items WHERE item_id = :id");
        return $stmt->execute(['id' => $id]);
    }
}
