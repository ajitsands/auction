<?php
namespace App\Models;

use App\Core\Model;
use PDO;

class Article extends Model {
    public function getAll(int $year, ?string $status = null, ?string $search = null, ?string $category = null, string $order = 'ASC', bool $excludeOfferings = false): array {
        $sql = "
            SELECT a.*, 
                   COALESCE(a.donor_code_c, m.code_c) as donor_code_c, 
                   COALESCE(a.donor_phone, m.bahrain_contact_no) as donor_phone,
                   COALESCE(a.donor_cpr, m.cpr_no) as donor_cpr
            FROM hf_articles a
            LEFT JOIN tbl_primary_member m ON a.donor_member_id = m.primary_member_id
            WHERE a.applicable_year = :year
        ";
        $params = ['year' => $year];

        if ($excludeOfferings) {
            $sql .= " AND a.tag_number NOT IN ('GOLD', 'BEDSHEET')";
        }

        if ($status && $status !== 'All') {
            $sql .= " AND a.status = :status";
            $params['status'] = $status;
        }

        if ($category && $category !== 'All') {
            $sql .= " AND a.category = :category";
            $params['category'] = $category;
        }

        if ($search && trim($search) !== '') {
            $sql .= " AND (a.article_number LIKE :search1 
                        OR a.tag_number LIKE :search2 
                        OR a.article_name LIKE :search3 
                        OR a.donor_name LIKE :search4)";
            $term = "%" . trim($search) . "%";
            $params['search1'] = $term;
            $params['search2'] = $term;
            $params['search3'] = $term;
            $params['search4'] = $term;
        }

        $dir = strtoupper(trim($order)) === 'DESC' ? 'DESC' : 'ASC';
        $sql .= " ORDER BY a.article_id {$dir}";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findById(int $id): ?array {
        $stmt = $this->db->prepare("
            SELECT a.*, 
                   COALESCE(a.donor_code_c, m.code_c) as donor_code_c, 
                   COALESCE(a.donor_phone, m.bahrain_contact_no) as donor_phone,
                   COALESCE(a.donor_cpr, m.cpr_no) as donor_cpr
            FROM hf_articles a
            LEFT JOIN tbl_primary_member m ON a.donor_member_id = m.primary_member_id
            WHERE a.article_id = :id
            LIMIT 1
        ");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function getYears(): array {
        $stmt = $this->db->query("
            SELECT DISTINCT yr FROM (
                SELECT applicable_year as yr FROM hf_articles WHERE applicable_year > 2000
                UNION
                SELECT applicable_year as yr FROM hf_auction_transactions WHERE applicable_year > 2000
                UNION
                SELECT applicable_year as yr FROM hf_promises WHERE applicable_year > 2000
            ) t ORDER BY yr DESC
        ");
        $years = array_values(array_map('intval', $stmt->fetchAll(PDO::FETCH_COLUMN)));
        $currentYear = (int)date('Y');

        if (empty($years)) {
            return [$currentYear];
        }

        return $years;
    }

    public function getCategories(): array {
        $stmt = $this->db->query("
            SELECT category_name 
            FROM hf_categories 
            ORDER BY category_name ASC
        ");
        $cats = $stmt->fetchAll(PDO::FETCH_COLUMN);
        return $cats ?: ['General', 'Traditional & Brass', 'Jewellery', 'Food & Delicacy', 'Handicrafts', 'Electronics', 'Apparel & Silk'];
    }

    public function getCategoriesWithStats(): array {
        $stmt = $this->db->query("
            SELECT c.category_id, c.category_name, COUNT(a.article_id) as article_count
            FROM hf_categories c
            LEFT JOIN hf_articles a ON a.category = c.category_name
            GROUP BY c.category_id, c.category_name
            ORDER BY c.category_name ASC
        ");
        return $stmt->fetchAll();
    }

    public function addCategory(string $name): array {
        $name = trim($name);
        if ($name === '') {
            throw new \Exception('Category name cannot be empty.');
        }

        $check = $this->db->prepare("SELECT category_id, category_name FROM hf_categories WHERE LOWER(category_name) = LOWER(:name)");
        $check->execute(['name' => $name]);
        $existing = $check->fetch();
        if ($existing) {
            throw new \Exception("Category '{$existing['category_name']}' already exists.");
        }

        $stmt = $this->db->prepare("INSERT INTO hf_categories (category_name) VALUES (:name)");
        $stmt->execute(['name' => $name]);
        $id = (int)$this->db->lastInsertId();
        return [
            'category_id'   => $id,
            'category_name' => $name,
            'article_count' => 0
        ];
    }

    public function deleteCategory(int $id): bool {
        $stmt = $this->db->prepare("SELECT category_id, category_name FROM hf_categories WHERE category_id = :id");
        $stmt->execute(['id' => $id]);
        $cat = $stmt->fetch();
        if (!$cat) {
            throw new \Exception('Category not found.');
        }

        if (strcasecmp($cat['category_name'], 'General') === 0) {
            throw new \Exception("The default 'General' category cannot be deleted.");
        }

        $check = $this->db->prepare("SELECT COUNT(*) FROM hf_articles WHERE category = :cat");
        $check->execute(['cat' => $cat['category_name']]);
        $count = (int)$check->fetchColumn();
        if ($count > 0) {
            throw new \Exception("Cannot delete category '{$cat['category_name']}' because it has {$count} active article(s) assigned.");
        }

        $del = $this->db->prepare("DELETE FROM hf_categories WHERE category_id = :id");
        return $del->execute(['id' => $id]);
    }

    public function create(array $data): int {
        $stmt = $this->db->prepare("
            INSERT INTO hf_articles (
                article_number, tag_number, applicable_year, article_name, description,
                category, donor_member_id, donor_name, donor_code_c, donor_phone, donor_cpr,
                estimated_value, reserve_price, status, created_by
            ) VALUES (
                :article_number, :tag_number, :applicable_year, :article_name, :description,
                :category, :donor_member_id, :donor_name, :donor_code_c, :donor_phone, :donor_cpr,
                :estimated_value, :reserve_price, :status, :created_by
            )
        ");
        $stmt->execute([
            'article_number'  => trim($data['article_number']),
            'tag_number'      => trim($data['tag_number']),
            'applicable_year' => (int)$data['applicable_year'],
            'article_name'    => trim($data['article_name']),
            'description'     => $data['description'] ?? null,
            'category'        => $data['category'] ?? 'General',
            'donor_member_id' => !empty($data['donor_member_id']) ? (int)$data['donor_member_id'] : null,
            'donor_name'      => $data['donor_name'] ?? null,
            'donor_code_c'    => !empty($data['donor_code_c']) ? (int)$data['donor_code_c'] : null,
            'donor_phone'     => !empty($data['donor_phone']) ? trim($data['donor_phone']) : null,
            'donor_cpr'       => !empty($data['donor_cpr']) ? trim($data['donor_cpr']) : null,
            'estimated_value' => (float)($data['estimated_value'] ?? 0),
            'reserve_price'   => (float)($data['reserve_price'] ?? 0),
            'status'          => $data['status'] ?? 'Available',
            'created_by'      => !empty($data['created_by']) ? (int)$data['created_by'] : null,
        ]);
        return (int)$this->db->lastInsertId();
    }

    public function update(int $id, array $data): bool {
        $stmt = $this->db->prepare("
            UPDATE hf_articles SET
                article_number  = :article_number,
                tag_number      = :tag_number,
                applicable_year = :applicable_year,
                article_name    = :article_name,
                description     = :description,
                category        = :category,
                donor_member_id = :donor_member_id,
                donor_name      = :donor_name,
                donor_code_c    = :donor_code_c,
                donor_phone     = :donor_phone,
                donor_cpr       = :donor_cpr,
                estimated_value = :estimated_value,
                reserve_price   = :reserve_price,
                status          = :status
            WHERE article_id = :id
        ");
        return $stmt->execute([
            'article_number'  => trim($data['article_number']),
            'tag_number'      => trim($data['tag_number']),
            'applicable_year' => (int)$data['applicable_year'],
            'article_name'    => trim($data['article_name']),
            'description'     => $data['description'] ?? null,
            'category'        => $data['category'] ?? 'General',
            'donor_member_id' => !empty($data['donor_member_id']) ? (int)$data['donor_member_id'] : null,
            'donor_name'      => $data['donor_name'] ?? null,
            'donor_code_c'    => !empty($data['donor_code_c']) ? (int)$data['donor_code_c'] : null,
            'donor_phone'     => !empty($data['donor_phone']) ? trim($data['donor_phone']) : null,
            'donor_cpr'       => !empty($data['donor_cpr']) ? trim($data['donor_cpr']) : null,
            'estimated_value' => (float)($data['estimated_value'] ?? 0),
            'reserve_price'   => (float)($data['reserve_price'] ?? 0),
            'status'          => $data['status'] ?? 'Available',
            'id'              => $id
        ]);
    }

    public function delete(int $id): bool {
        // Only allow delete if not part of an auction transaction
        $check = $this->db->prepare("SELECT COUNT(*) FROM hf_auction_transactions WHERE article_id = :id");
        $check->execute(['id' => $id]);
        if ($check->fetchColumn() > 0) {
            throw new \Exception("Cannot delete article because it is linked to an auction transaction.");
        }

        $stmt = $this->db->prepare("DELETE FROM hf_articles WHERE article_id = :id");
        return $stmt->execute(['id' => $id]);
    }

    public function generateNextArticleNumber(int $year): string {
        $stmt = $this->db->prepare("
            SELECT article_number 
            FROM hf_articles 
            WHERE applicable_year = :year
        ");
        $stmt->execute(['year' => $year]);
        $numbers = $stmt->fetchAll(PDO::FETCH_COLUMN);

        $maxSeq = 0;
        $prefix = "ART-{$year}-";

        foreach ($numbers as $num) {
            $trimmed = trim($num);
            if (str_starts_with($trimmed, $prefix)) {
                $suffix = substr($trimmed, strlen($prefix));
                if (ctype_digit($suffix)) {
                    $val = (int)$suffix;
                    if ($val > $maxSeq) {
                        $maxSeq = $val;
                    }
                }
            } elseif (preg_match('/(\d+)$/', $trimmed, $m)) {
                $val = (int)$m[1];
                if ($val > $maxSeq) {
                    $maxSeq = $val;
                }
            }
        }

        $nextSeq = $maxSeq + 1;
        $candidate = sprintf("ART-%d-%03d", $year, $nextSeq);

        while ($this->checkExists($year, $candidate)) {
            $nextSeq++;
            $candidate = sprintf("ART-%d-%03d", $year, $nextSeq);
        }

        return $candidate;
    }

    public function checkExists(int $year, string $articleNumber, ?int $excludeId = null): bool {
        $sql = "SELECT COUNT(*) FROM hf_articles WHERE applicable_year = :year AND article_number = :num";
        $params = ['year' => $year, 'num' => trim($articleNumber)];
        if ($excludeId !== null) {
            $sql .= " AND article_id != :exclude_id";
            $params['exclude_id'] = $excludeId;
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchColumn() > 0;
    }

    public function batchImport(array $rows, int $userId, bool $updateExisting = false): array {
        $imported = 0;
        $updated  = 0;
        $skipped  = 0;
        $errors   = [];

        $this->db->beginTransaction();
        try {
            // Pre-load master categories map for case-insensitive matching and auto-registration
            $catQuery = $this->db->query("SELECT category_name FROM hf_categories");
            $existingCategories = $catQuery ? $catQuery->fetchAll(PDO::FETCH_COLUMN) : [];
            $categoryMap = [];
            foreach ($existingCategories as $catName) {
                $categoryMap[strtolower(trim($catName))] = trim($catName);
            }

            $addCategoryStmt = $this->db->prepare("INSERT IGNORE INTO hf_categories (category_name) VALUES (:name)");

            // Member lookup statement by roll number (code_c)
            $memberStmt = $this->db->prepare("
                SELECT primary_member_id, primary_member_name, code_c, bahrain_contact_no, cpr_no 
                FROM tbl_primary_member 
                WHERE code_c = :code_c 
                LIMIT 1
            ");

            // Check existing article by article number
            $checkStmt = $this->db->prepare("
                SELECT article_id, article_number, tag_number, status, applicable_year 
                FROM hf_articles 
                WHERE applicable_year = :year AND article_number = :num
                LIMIT 1
            ");

            // Check existing article by tag number (for sheets where Article No is omitted)
            $checkByTagStmt = $this->db->prepare("
                SELECT article_id, article_number, tag_number, status, applicable_year 
                FROM hf_articles 
                WHERE applicable_year = :year AND tag_number = :tag
                LIMIT 1
            ");

            // Insert statement with all Article Master fields
            $insertStmt = $this->db->prepare("
                INSERT INTO hf_articles (
                    article_number, tag_number, applicable_year, article_name, description,
                    category, donor_member_id, donor_name, donor_code_c, donor_phone, donor_cpr,
                    estimated_value, reserve_price, status, created_by
                ) VALUES (
                    :article_number, :tag_number, :applicable_year, :article_name, :description,
                    :category, :donor_member_id, :donor_name, :donor_code_c, :donor_phone, :donor_cpr,
                    :estimated_value, :reserve_price, 'Available', :created_by
                )
            ");

            // Update statement for existing articles
            $updateStmt = $this->db->prepare("
                UPDATE hf_articles SET
                    tag_number      = :tag_number,
                    article_name    = :article_name,
                    description     = :description,
                    category        = :category,
                    donor_member_id = :donor_member_id,
                    donor_name      = :donor_name,
                    donor_code_c    = :donor_code_c,
                    donor_phone     = :donor_phone,
                    donor_cpr       = :donor_cpr,
                    estimated_value = :estimated_value,
                    reserve_price   = :reserve_price
                WHERE article_id = :id
            ");

            // Track assigned sequences in this batch to prevent collisions
            $allocatedNumbers = [];

            foreach ($rows as $index => $row) {
                $rowNum = $index + 2; // account for header line in spreadsheet
                $hasExplicitArtNo = !empty(trim($row['article_number'] ?? ''));
                $artNo  = trim($row['article_number'] ?? '');
                $tagNo  = trim($row['tag_number'] ?? '');
                $year   = (int)($row['applicable_year'] ?? date('Y'));
                if ($year <= 2000) $year = (int)date('Y');
                $name   = trim($row['article_name'] ?? '');

                // Check if article already exists:
                // 1) If Article No is explicitly provided in sheet, check by Article No
                // 2) If Article No is omitted, check by Tag No
                $existingArticle = null;
                if ($hasExplicitArtNo) {
                    $checkStmt->execute(['year' => $year, 'num' => $artNo]);
                    $existingArticle = $checkStmt->fetch();
                } elseif ($tagNo !== '') {
                    $checkByTagStmt->execute(['year' => $year, 'tag' => $tagNo]);
                    $existingArticle = $checkByTagStmt->fetch();
                    if ($existingArticle) {
                        $artNo = $existingArticle['article_number'];
                    }
                }

                // If article does not exist and Article No is blank, auto-generate sequential unique Article No
                if (!$existingArticle && $artNo === '') {
                    $nextSeq = 1;
                    $candidate = sprintf("ART-%d-%03d", $year, $nextSeq);
                    while ($this->checkExists($year, $candidate) || in_array($candidate, $allocatedNumbers, true)) {
                        $nextSeq++;
                        $candidate = sprintf("ART-%d-%03d", $year, $nextSeq);
                    }
                    $artNo = $candidate;
                    $allocatedNumbers[] = $artNo;
                } else {
                    $allocatedNumbers[] = $artNo;
                }

                // Auto-generate tag number if blank
                if ($tagNo === '') {
                    $tagNo = str_replace("ART-{$year}-", "TAG-", $artNo);
                    if ($tagNo === $artNo) {
                        $tagNo = "TAG-" . substr($artNo, -3);
                    }
                }

                if ($name === '') {
                    $name = "Article " . $artNo;
                }

                // Check if article already exists
                $checkStmt->execute(['year' => $year, 'num' => $artNo]);
                $existingArticle = $checkStmt->fetch();

                if ($existingArticle) {
                    if (!$updateExisting) {
                        $errors[] = "Row {$rowNum}: Article [{$artNo}] already exists for year {$year} (Skipped).";
                        $skipped++;
                        continue;
                    }

                    // Only update if status is 'Available'
                    if (strcasecmp($existingArticle['status'] ?? '', 'Available') !== 0) {
                        $errors[] = "Row {$rowNum}: Article [{$artNo}] status is '{$existingArticle['status']}' (not Available) and cannot be updated.";
                        $skipped++;
                        continue;
                    }
                }

                // Resolve category against Master categories (or auto-register)
                $rawCategory = !empty($row['category']) ? trim($row['category']) : 'General';
                $lowerCategory = strtolower($rawCategory);
                if (isset($categoryMap[$lowerCategory])) {
                    $finalCategory = $categoryMap[$lowerCategory];
                } else {
                    try {
                        $addCategoryStmt->execute(['name' => $rawCategory]);
                        $categoryMap[$lowerCategory] = $rawCategory;
                    } catch (\Exception $ex) {}
                    $finalCategory = $rawCategory;
                }

                // Resolve Donor & Member details
                $donorMemberId = !empty($row['donor_member_id']) ? (int)$row['donor_member_id'] : null;
                $donorCodeC    = !empty($row['donor_code_c']) ? (int)$row['donor_code_c'] : null;
                $donorName     = !empty($row['donor_name']) ? trim($row['donor_name']) : null;
                $donorPhone    = !empty($row['donor_phone']) ? trim($row['donor_phone']) : null;
                $donorCpr      = !empty($row['donor_cpr']) ? trim($row['donor_cpr']) : null;

                // If Donor Roll No is provided, look up parish member directory
                if ($donorCodeC && !$donorMemberId) {
                    $memberStmt->execute(['code_c' => $donorCodeC]);
                    $member = $memberStmt->fetch();
                    if ($member) {
                        $donorMemberId = (int)$member['primary_member_id'];
                        if (empty($donorName) || strcasecmp($donorName, 'Well-Wisher') === 0 || strcasecmp($donorName, 'N/A') === 0) {
                            $donorName = $member['primary_member_name'];
                        }
                        if (empty($donorPhone) && !empty($member['bahrain_contact_no'])) {
                            $donorPhone = $member['bahrain_contact_no'];
                        }
                        if (empty($donorCpr) && !empty($member['cpr_no'])) {
                            $donorCpr = $member['cpr_no'];
                        }
                    }
                }

                if (empty($donorName) || strcasecmp($donorName, 'N/A') === 0) {
                    $donorName = 'Well-Wisher';
                }

                $estValue = (float)($row['estimated_value'] ?? 0);
                $resPrice = (float)($row['reserve_price'] ?? 0);
                if ($resPrice <= 0 && $estValue > 0) {
                    $resPrice = $estValue;
                }
                $description = !empty($row['description']) ? trim($row['description']) : 'Imported via Excel template';

                if ($existingArticle && $updateExisting) {
                    $updateStmt->execute([
                        'id'              => (int)$existingArticle['article_id'],
                        'tag_number'      => $tagNo,
                        'article_name'    => $name,
                        'description'     => $description,
                        'category'        => $finalCategory,
                        'donor_member_id' => $donorMemberId,
                        'donor_name'      => $donorName,
                        'donor_code_c'    => $donorCodeC,
                        'donor_phone'     => $donorPhone,
                        'donor_cpr'       => $donorCpr,
                        'estimated_value' => $estValue,
                        'reserve_price'   => $resPrice
                    ]);
                    $updated++;
                } else {
                    $insertStmt->execute([
                        'article_number'  => $artNo,
                        'tag_number'      => $tagNo,
                        'applicable_year' => $year,
                        'article_name'    => $name,
                        'description'     => $description,
                        'category'        => $finalCategory,
                        'donor_member_id' => $donorMemberId,
                        'donor_name'      => $donorName,
                        'donor_code_c'    => $donorCodeC,
                        'donor_phone'     => $donorPhone,
                        'donor_cpr'       => $donorCpr,
                        'estimated_value' => $estValue,
                        'reserve_price'   => $resPrice,
                        'created_by'      => $userId
                    ]);
                    $imported++;
                }
            }

            $this->db->commit();
        } catch (\Exception $e) {
            $this->db->rollBack();
            throw $e;
        }

        return [
            'imported' => $imported,
            'updated'  => $updated,
            'skipped'  => $skipped,
            'errors'   => $errors
        ];
    }
}
