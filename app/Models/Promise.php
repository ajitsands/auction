<?php
namespace App\Models;

use App\Core\Model;
use PDO;

class Promise extends Model {
    public function getAll(int $year, ?string $status = null, ?string $search = null, ?string $stream = null): array {
        $baseSql = "
            SELECT 
                p.hf_promise_id,
                p.transaction_id,
                p.article_id,
                p.member_id,
                p.applicable_year,
                p.member_name,
                p.member_code_c,
                p.member_phone,
                p.total_promise_amount,
                COALESCE(
                    (SELECT SUM(c.contribution_amount) 
                     FROM acc_contribution c 
                     WHERE c.article_id = p.article_id 
                       AND (p.member_id IS NULL OR p.member_id = 0 OR c.member_id = p.member_id)),
                    p.paid_amount,
                    0
                ) as paid_amount,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM acc_promises p_acc 
                        WHERE (p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id) 
                           OR (p_acc.article_id = p.article_id AND (p.member_id IS NULL OR p.member_id = 0 OR p_acc.member_id = p.member_id))
                    ) THEN (
                        SELECT p_acc.balance_amount FROM acc_promises p_acc 
                        WHERE (p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id) 
                           OR (p_acc.article_id = p.article_id AND (p.member_id IS NULL OR p.member_id = 0 OR p_acc.member_id = p.member_id))
                        ORDER BY p_acc.promise_id DESC LIMIT 1
                    )
                    ELSE GREATEST(0, p.total_promise_amount - COALESCE(
                        (SELECT SUM(c.contribution_amount) 
                         FROM acc_contribution c 
                         WHERE c.article_id = p.article_id 
                           AND (p.member_id IS NULL OR p.member_id = 0 OR c.member_id = p.member_id)),
                        p.paid_amount,
                        0
                    ))
                END as balance_amount,
                p.due_date,
                CASE 
                    WHEN (
                        CASE 
                            WHEN EXISTS (
                                SELECT 1 FROM acc_promises p_acc 
                                WHERE (p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id) 
                                   OR (p_acc.article_id = p.article_id AND (p.member_id IS NULL OR p.member_id = 0 OR p_acc.member_id = p.member_id))
                            ) THEN (
                                SELECT p_acc.balance_amount FROM acc_promises p_acc 
                                WHERE (p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id) 
                                   OR (p_acc.article_id = p.article_id AND (p.member_id IS NULL OR p.member_id = 0 OR p_acc.member_id = p.member_id))
                                ORDER BY p_acc.promise_id DESC LIMIT 1
                            )
                            ELSE GREATEST(0, p.total_promise_amount - COALESCE(
                                (SELECT SUM(c.contribution_amount) 
                                 FROM acc_contribution c 
                                 WHERE c.article_id = p.article_id 
                                   AND (p.member_id IS NULL OR p.member_id = 0 OR c.member_id = p.member_id)),
                                p.paid_amount,
                                0
                            ))
                        END
                    ) <= 0.0001 THEN 'Fulfilled'
                    ELSE 'Active'
                END as promise_status,
                p.created_at,
                p.dr_code,
                p.dr_name,
                p.cr_code,
                p.cr_name,
                p.voucher_no,
                p.acc_promise_id,
                p.event_id,
                p.event_name,
                t.auction_ref_no, t.auction_date, t.manual_receipt_no as receipt_no, t.receipt_book_no,
                COALESCE(t.offering_type, 'Auction') as offering_type,
                t.item_description,
                COALESCE(
                    (SELECT p_acc.remarks FROM acc_promises p_acc WHERE p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id LIMIT 1),
                    (SELECT p_acc.narration FROM acc_promises p_acc WHERE p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id LIMIT 1),
                    t.item_description
                ) as remarks,
                a.article_number, a.tag_number, a.article_name, a.category,
                m.cpr_no as member_cpr, m.prayer_group_name as member_prayer_group
            FROM hf_promises p
            JOIN hf_auction_transactions t ON p.transaction_id = t.transaction_id
            JOIN hf_articles a ON p.article_id = a.article_id
            LEFT JOIN tbl_primary_member m ON p.member_id = m.primary_member_id
            WHERE p.applicable_year = :year
        ";

        $sql = "SELECT * FROM ({$baseSql}) q WHERE 1=1";
        $params = ['year' => $year];

        if ($stream && $stream !== 'All') {
            if ($stream === 'Auction') {
                $sql .= " AND (q.offering_type = 'Auction' OR q.offering_type IS NULL OR q.offering_type = '')";
            } elseif ($stream === 'Gold') {
                $sql .= " AND q.offering_type = 'Gold'";
            } elseif ($stream === 'BedSheet') {
                $sql .= " AND q.offering_type = 'BedSheet'";
            }
        }

        if ($status && $status !== 'All') {
            $sql .= " AND q.promise_status = :status";
            $params['status'] = $status;
        }

        if ($search && trim($search) !== '') {
            $sql .= " AND (q.member_name LIKE :search1
                        OR q.auction_ref_no LIKE :search2
                        OR q.article_number LIKE :search3
                        OR q.tag_number LIKE :search4
                        OR q.article_name LIKE :search5
                        OR q.item_description LIKE :search6
                        OR q.member_code_c LIKE :search7)";
            $term = "%" . trim($search) . "%";
            $params['search1'] = $term;
            $params['search2'] = $term;
            $params['search3'] = $term;
            $params['search4'] = $term;
            $params['search5'] = $term;
            $params['search6'] = $term;
            $params['search7'] = $term;
        }

        $sql .= " ORDER BY q.balance_amount DESC, q.hf_promise_id DESC";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findById(int $id): ?array {
        $stmt = $this->db->prepare("
            SELECT 
                p.hf_promise_id,
                p.transaction_id,
                p.article_id,
                p.member_id,
                p.applicable_year,
                p.member_name,
                p.member_code_c,
                p.member_phone,
                p.total_promise_amount,
                COALESCE(
                    (SELECT SUM(c.contribution_amount) 
                     FROM acc_contribution c 
                     WHERE c.article_id = p.article_id 
                       AND (p.member_id IS NULL OR p.member_id = 0 OR c.member_id = p.member_id)),
                    p.paid_amount,
                    0
                ) as paid_amount,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM acc_promises p_acc 
                        WHERE (p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id) 
                           OR (p_acc.article_id = p.article_id AND (p.member_id IS NULL OR p.member_id = 0 OR p_acc.member_id = p.member_id))
                    ) THEN (
                        SELECT p_acc.balance_amount FROM acc_promises p_acc 
                        WHERE (p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id) 
                           OR (p_acc.article_id = p.article_id AND (p.member_id IS NULL OR p.member_id = 0 OR p_acc.member_id = p.member_id))
                        ORDER BY p_acc.promise_id DESC LIMIT 1
                    )
                    ELSE GREATEST(0, p.total_promise_amount - COALESCE(
                        (SELECT SUM(c.contribution_amount) 
                         FROM acc_contribution c 
                         WHERE c.article_id = p.article_id 
                           AND (p.member_id IS NULL OR p.member_id = 0 OR c.member_id = p.member_id)),
                        p.paid_amount,
                        0
                    ))
                END as balance_amount,
                p.due_date,
                CASE 
                    WHEN (
                        CASE 
                            WHEN EXISTS (
                                SELECT 1 FROM acc_promises p_acc 
                                WHERE (p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id) 
                                   OR (p_acc.article_id = p.article_id AND (p.member_id IS NULL OR p.member_id = 0 OR p_acc.member_id = p.member_id))
                            ) THEN (
                                SELECT p_acc.balance_amount FROM acc_promises p_acc 
                                WHERE (p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id) 
                                   OR (p_acc.article_id = p.article_id AND (p.member_id IS NULL OR p.member_id = 0 OR p_acc.member_id = p.member_id))
                        ORDER BY p_acc.promise_id DESC LIMIT 1
                            )
                            ELSE GREATEST(0, p.total_promise_amount - COALESCE(
                                (SELECT SUM(c.contribution_amount) 
                                 FROM acc_contribution c 
                                 WHERE c.article_id = p.article_id 
                                   AND (p.member_id IS NULL OR p.member_id = 0 OR c.member_id = p.member_id)),
                                p.paid_amount,
                                0
                            ))
                        END
                    ) <= 0.0001 THEN 'Fulfilled'
                    ELSE 'Active'
                END as promise_status,
                p.created_at,
                p.dr_code,
                p.dr_name,
                p.cr_code,
                p.cr_name,
                p.voucher_no,
                p.acc_promise_id,
                p.event_id,
                p.event_name,
                t.auction_ref_no, t.auction_date, t.manual_receipt_no as receipt_no, t.receipt_book_no,
                COALESCE(t.offering_type, 'Auction') as offering_type,
                t.item_description,
                COALESCE(
                    (SELECT p_acc.remarks FROM acc_promises p_acc WHERE p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id LIMIT 1),
                    (SELECT p_acc.narration FROM acc_promises p_acc WHERE p.acc_promise_id IS NOT NULL AND p_acc.promise_id = p.acc_promise_id LIMIT 1),
                    t.item_description
                ) as remarks,
                a.article_number, a.tag_number, a.article_name, a.category,
                m.cpr_no as member_cpr, m.prayer_group_name as member_prayer_group
            FROM hf_promises p
            JOIN hf_auction_transactions t ON p.transaction_id = t.transaction_id
            JOIN hf_articles a ON p.article_id = a.article_id
            LEFT JOIN tbl_primary_member m ON p.member_id = m.primary_member_id
            WHERE p.hf_promise_id = :id
            LIMIT 1
        ");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Get consolidated & per-stream promises summary (All, Auction, Gold, BedSheet)
     */
    public function getStreamSummary(int $year): array {
        $all = $this->getAll($year, null, null, null);

        $initBucket = fn() => [
            'count'           => 0,
            'total_promise'   => 0.0,
            'paid_amount'     => 0.0,
            'balance_amount'  => 0.0,
            'active_count'    => 0,
            'fulfilled_count' => 0
        ];

        $summary = [
            'overall'  => $initBucket(),
            'auction'  => $initBucket(),
            'gold'     => $initBucket(),
            'bedsheet' => $initBucket(),
        ];

        foreach ($all as $p) {
            $st = $p['offering_type'] ?? 'Auction';
            $bucketKey = match($st) {
                'Gold'     => 'gold',
                'BedSheet' => 'bedsheet',
                default    => 'auction'
            };

            $pAmt = (float)($p['total_promise_amount'] ?? 0);
            $paid = (float)($p['paid_amount'] ?? 0);
            $bal  = (float)($p['balance_amount'] ?? 0);
            $isAct = (($p['promise_status'] ?? '') === 'Active');

            // Stream Bucket
            $summary[$bucketKey]['count']++;
            $summary[$bucketKey]['total_promise'] += $pAmt;
            $summary[$bucketKey]['paid_amount'] += $paid;
            $summary[$bucketKey]['balance_amount'] += $bal;
            if ($isAct) $summary[$bucketKey]['active_count']++;
            else $summary[$bucketKey]['fulfilled_count']++;

            // Overall Combined Bucket
            $summary['overall']['count']++;
            $summary['overall']['total_promise'] += $pAmt;
            $summary['overall']['paid_amount'] += $paid;
            $summary['overall']['balance_amount'] += $bal;
            if ($isAct) $summary['overall']['active_count']++;
            else $summary['overall']['fulfilled_count']++;
        }

        return $summary;
    }
}
