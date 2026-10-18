<?php
namespace App\Models;

use App\Core\Model;
use PDO;

class Member extends Model {
    public function search(string $term, int $limit = 30): array {
        $term = trim($term);
        if ($term === '') {
            $stmt = $this->db->prepare("
                SELECT primary_member_id, primary_member_name, code_c, code_m, cpr_no, bahrain_contact_no, email_id, prayer_group_name
                FROM tbl_primary_member
                WHERE primary_member_id > 1 AND primary_member_name != 'NA'
                ORDER BY code_c ASC
                LIMIT :limit
            ");
            $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
            $stmt->execute();
            return $stmt->fetchAll();
        }

        $stmt = $this->db->prepare("
            SELECT primary_member_id, primary_member_name, code_c, code_m, cpr_no, bahrain_contact_no, email_id, prayer_group_name
            FROM tbl_primary_member
            WHERE (primary_member_name LIKE :term1
               OR code_c = :code_exact
               OR cpr_no LIKE :term2
               OR bahrain_contact_no LIKE :term3)
              AND primary_member_id > 1
            ORDER BY code_c ASC
            LIMIT :limit
        ");
        $exactCode = is_numeric($term) ? (int)$term : -1;
        $likeTerm = "%{$term}%";
        $stmt->bindValue(':term1', $likeTerm);
        $stmt->bindValue(':term2', $likeTerm);
        $stmt->bindValue(':term3', $likeTerm);
        $stmt->bindValue(':code_exact', $exactCode, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function findById(int $memberId): ?array {
        $stmt = $this->db->prepare("
            SELECT primary_member_id, primary_member_name, code_c, code_m, cpr_no, bahrain_contact_no, email_id, prayer_group_name
            FROM tbl_primary_member
            WHERE primary_member_id = :id
            LIMIT 1
        ");
        $stmt->execute(['id' => $memberId]);
        $res = $stmt->fetch();
        return $res ?: null;
    }
}
