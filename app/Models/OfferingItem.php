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
                `default_amount` decimal(10,3) NOT NULL DEFAULT 0.000,
                `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (`item_id`),
                UNIQUE KEY `uq_type_desc` (`offering_type`, `item_description`),
                KEY `idx_offering_type` (`offering_type`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        ";
        $this->db->exec($sql);

        // Ensure default_amount column exists on existing installations
        if (!$this->hasColumn('hf_offering_items', 'default_amount')) {
            $this->db->exec("ALTER TABLE `hf_offering_items` ADD COLUMN `default_amount` decimal(10,3) NOT NULL DEFAULT 0.000 AFTER `item_description`");
        }

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

            $stmt = $this->db->prepare("INSERT IGNORE INTO hf_offering_items (offering_type, item_description, default_amount) VALUES (:type, :desc, 0.000)");
            foreach ($defaultGold as $item) {
                $stmt->execute(['type' => 'Gold', 'desc' => $item]);
            }
            foreach ($defaultBedSheet as $item) {
                $stmt->execute(['type' => 'BedSheet', 'desc' => $item]);
            }
        }

        self::$tableChecked = true;
    }

    public function getById(int $id): ?array {
        $stmt = $this->db->prepare("
            SELECT item_id, item_id AS id, offering_type, item_description, item_description AS description, 
                   default_amount, default_amount AS value_amount, default_amount AS amount, created_at 
            FROM hf_offering_items 
            WHERE item_id = :id
        ");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $row['default_amount'] = number_format((float)($row['default_amount'] ?? 0), 3, '.', '');
            $row['value_amount'] = $row['default_amount'];
            $row['amount'] = $row['default_amount'];
            return $row;
        }
        return null;
    }

    public function getAll(?string $offeringType = null): array {
        if ($offeringType && in_array($offeringType, ['Gold', 'BedSheet'])) {
            $stmt = $this->db->prepare("
                SELECT item_id, item_id AS id, offering_type, item_description, item_description AS description, 
                       default_amount, default_amount AS value_amount, default_amount AS amount, created_at 
                FROM hf_offering_items 
                WHERE offering_type = :type 
                ORDER BY item_description ASC
            ");
            $stmt->execute(['type' => $offeringType]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } else {
            $stmt = $this->db->query("
                SELECT item_id, item_id AS id, offering_type, item_description, item_description AS description, 
                       default_amount, default_amount AS value_amount, default_amount AS amount, created_at 
                FROM hf_offering_items 
                ORDER BY offering_type ASC, item_description ASC
            ");
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        }

        foreach ($rows as &$r) {
            $r['default_amount'] = number_format((float)($r['default_amount'] ?? 0), 3, '.', '');
            $r['value_amount'] = $r['default_amount'];
            $r['amount'] = $r['default_amount'];
        }
        unset($r);

        return $rows;
    }

    public function add(string $offeringType, string $description, float $defaultAmount = 0.0): array {
        $offeringType = ($offeringType === 'BedSheet') ? 'BedSheet' : 'Gold';
        $description = trim($description);
        $defaultAmount = max(0.0, (float)$defaultAmount);

        if ($description === '') {
            throw new \Exception('Item description cannot be empty.');
        }

        // Check if already exists
        $check = $this->db->prepare("
            SELECT item_id, item_id AS id, offering_type, item_description, item_description AS description, 
                   default_amount, default_amount AS value_amount, default_amount AS amount, created_at 
            FROM hf_offering_items 
            WHERE offering_type = :type AND LOWER(TRIM(item_description)) = LOWER(:desc)
        ");
        $check->execute(['type' => $offeringType, 'desc' => $description]);
        $existing = $check->fetch(PDO::FETCH_ASSOC);
        if ($existing) {
            if ($defaultAmount > 0 && (float)$existing['default_amount'] !== $defaultAmount) {
                return $this->update((int)$existing['item_id'], ['default_amount' => $defaultAmount]);
            }
            $existing['default_amount'] = number_format((float)($existing['default_amount'] ?? 0), 3, '.', '');
            $existing['value_amount'] = $existing['default_amount'];
            $existing['amount'] = $existing['default_amount'];
            return $existing;
        }

        $stmt = $this->db->prepare("
            INSERT INTO hf_offering_items (offering_type, item_description, default_amount) 
            VALUES (:type, :desc, :amt)
        ");
        $stmt->execute([
            'type' => $offeringType, 
            'desc' => $description,
            'amt'  => $defaultAmount
        ]);
        $newId = (int)$this->db->lastInsertId();

        return $this->getById($newId);
    }

    public function update(int $id, array $data): array {
        $item = $this->getById($id);
        if (!$item) {
            throw new \Exception('Item not found.');
        }

        $desc = isset($data['item_description']) ? trim($data['item_description']) : (isset($data['description']) ? trim($data['description']) : $item['item_description']);
        $amount = isset($data['default_amount']) ? (float)$data['default_amount'] : (isset($data['value_amount']) ? (float)$data['value_amount'] : (isset($data['amount']) ? (float)$data['amount'] : (float)$item['default_amount']));

        if ($desc === '') {
            throw new \Exception('Item description cannot be empty.');
        }
        if ($amount < 0) {
            throw new \Exception('Value amount cannot be negative.');
        }

        $stmt = $this->db->prepare("
            UPDATE hf_offering_items 
            SET item_description = :desc, default_amount = :amt 
            WHERE item_id = :id
        ");
        $stmt->execute([
            'desc' => $desc,
            'amt'  => $amount,
            'id'   => $id
        ]);

        return $this->getById($id);
    }

    public function delete(int $id): bool {
        $stmt = $this->db->prepare("DELETE FROM hf_offering_items WHERE item_id = :id");
        return $stmt->execute(['id' => $id]);
    }
}
