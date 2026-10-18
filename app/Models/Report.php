<?php
namespace App\Models;

use App\Core\Model;
use PDO;

class Report extends Model {
    public function getYearlySummary(int $year): array {
        $stmt = $this->db->prepare("
            SELECT 
                COUNT(DISTINCT a.article_id) as total_articles,
                SUM(CASE WHEN a.status = 'Sold' THEN 1 ELSE 0 END) as sold_articles,
                SUM(CASE WHEN a.status = 'Auctioned' THEN 1 ELSE 0 END) as auctioned_unpaid_articles,
                SUM(CASE WHEN a.status = 'Available' THEN 1 ELSE 0 END) as available_articles,
                COALESCE(SUM(a.estimated_value), 0) as total_estimated_value,
                COALESCE(SUM(t.winning_bid_amount), 0) as total_auction_revenue,
                COALESCE(SUM(
                    COALESCE(
                        (SELECT SUM(c.contribution_amount) 
                         FROM acc_contribution c 
                         WHERE c.article_id = t.article_id 
                           AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                        t.paid_amount,
                        0
                    )
                ), 0) as total_collected_amount,
                COALESCE(SUM(
                    CASE 
                        WHEN EXISTS (
                            SELECT 1 FROM acc_promises p 
                            WHERE (t.acc_promise_id IS NOT NULL AND p.promise_id = t.acc_promise_id) 
                               OR (p.article_id = t.article_id AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR p.member_id = t.buyer_member_id))
                        ) THEN (
                            SELECT p.balance_amount FROM acc_promises p 
                            WHERE (t.acc_promise_id IS NOT NULL AND p.promise_id = t.acc_promise_id) 
                               OR (p.article_id = t.article_id AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR p.member_id = t.buyer_member_id))
                            ORDER BY p.promise_id DESC LIMIT 1
                        )
                        ELSE GREATEST(0, t.winning_bid_amount - COALESCE(
                            (SELECT SUM(c.contribution_amount) 
                             FROM acc_contribution c 
                             WHERE c.article_id = t.article_id 
                               AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                            t.paid_amount,
                            0
                        ))
                    END
                ), 0) as total_receivable_promises,
                COUNT(DISTINCT t.buyer_name) as total_bidders
            FROM hf_articles a
            LEFT JOIN hf_auction_transactions t ON a.article_id = t.article_id AND t.applicable_year = :year
            WHERE a.applicable_year = :year2
        ");
        $stmt->execute(['year' => $year, 'year2' => $year]);
        $summary = $stmt->fetch() ?: [];

        // Category breakdown
        $catStmt = $this->db->prepare("
            SELECT 
                a.category,
                COUNT(a.article_id) as article_count,
                SUM(CASE WHEN a.status IN ('Sold', 'Auctioned') THEN 1 ELSE 0 END) as sold_count,
                COALESCE(SUM(a.estimated_value), 0) as estimated_val,
                COALESCE(SUM(t.winning_bid_amount), 0) as total_bid_val
            FROM hf_articles a
            LEFT JOIN hf_auction_transactions t ON a.article_id = t.article_id
            WHERE a.applicable_year = :year
            GROUP BY a.category
            ORDER BY total_bid_val DESC
        ");
        $catStmt->execute(['year' => $year]);
        $summary['category_breakdown'] = $catStmt->fetchAll();

        return $summary;
    }

    public function getBuyerSummaryReport(int $year): array {
        $stmt = $this->db->prepare("
            SELECT 
                sub.buyer_name,
                sub.buyer_code_c,
                sub.buyer_phone,
                m.cpr_no,
                m.prayer_group_name,
                COUNT(sub.transaction_id) as items_purchased,
                SUM(sub.winning_bid_amount) as total_purchased,
                SUM(sub.paid_amount) as total_paid,
                SUM(sub.balance_amount) as total_balance,
                CASE 
                    WHEN SUM(sub.balance_amount) <= 0.0001 THEN 'Paid'
                    WHEN SUM(sub.paid_amount) > 0.0001 THEN 'Partial'
                    ELSE 'Pending'
                END as overall_status
            FROM (
                SELECT 
                    t.transaction_id,
                    t.buyer_name,
                    t.buyer_code_c,
                    t.buyer_phone,
                    t.buyer_member_id,
                    t.winning_bid_amount,
                    COALESCE(
                        (SELECT SUM(c.contribution_amount) 
                         FROM acc_contribution c 
                         WHERE c.article_id = t.article_id 
                           AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                        t.paid_amount,
                        0
                    ) as paid_amount,
                    CASE 
                        WHEN EXISTS (
                            SELECT 1 FROM acc_promises p 
                            WHERE (t.acc_promise_id IS NOT NULL AND p.promise_id = t.acc_promise_id) 
                               OR (p.article_id = t.article_id AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR p.member_id = t.buyer_member_id))
                        ) THEN (
                            SELECT p.balance_amount FROM acc_promises p 
                            WHERE (t.acc_promise_id IS NOT NULL AND p.promise_id = t.acc_promise_id) 
                               OR (p.article_id = t.article_id AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR p.member_id = t.buyer_member_id))
                            ORDER BY p.promise_id DESC LIMIT 1
                        )
                        ELSE GREATEST(0, t.winning_bid_amount - COALESCE(
                            (SELECT SUM(c.contribution_amount) 
                             FROM acc_contribution c 
                             WHERE c.article_id = t.article_id 
                               AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                            t.paid_amount,
                            0
                        ))
                    END as balance_amount
                FROM hf_auction_transactions t
                WHERE t.applicable_year = :year
            ) sub
            LEFT JOIN tbl_primary_member m ON sub.buyer_member_id = m.primary_member_id
            GROUP BY sub.buyer_name, sub.buyer_code_c, sub.buyer_phone, m.cpr_no, m.prayer_group_name
            ORDER BY total_purchased DESC
        ");
        $stmt->execute(['year' => $year]);
        $buyers = $stmt->fetchAll();

        // Fetch item details (tag, name, article number) for transactions of this year
        $itemsStmt = $this->db->prepare("
            SELECT 
                t.transaction_id,
                t.buyer_name,
                t.buyer_code_c,
                t.buyer_phone,
                t.winning_bid_amount,
                a.article_id,
                a.article_number,
                a.tag_number,
                a.article_name,
                a.category
            FROM hf_auction_transactions t
            JOIN hf_articles a ON t.article_id = a.article_id
            WHERE t.applicable_year = :year
            ORDER BY a.tag_number ASC, a.article_number ASC
        ");
        $itemsStmt->execute(['year' => $year]);
        $allItems = $itemsStmt->fetchAll();

        // Group items by buyer signature (name + code_c + phone)
        $itemsByBuyer = [];
        foreach ($allItems as $item) {
            $key = trim($item['buyer_name']) . '|' . trim((string)($item['buyer_code_c'] ?? '')) . '|' . trim((string)($item['buyer_phone'] ?? ''));
            if (!isset($itemsByBuyer[$key])) {
                $itemsByBuyer[$key] = [];
            }
            $itemsByBuyer[$key][] = [
                'article_id'         => (int)$item['article_id'],
                'article_number'     => $item['article_number'],
                'tag_number'         => $item['tag_number'],
                'article_name'       => $item['article_name'],
                'category'           => $item['category'],
                'winning_bid_amount' => (float)$item['winning_bid_amount']
            ];
        }

        // Attach items array to each buyer
        foreach ($buyers as &$b) {
            $key = trim($b['buyer_name']) . '|' . trim((string)($b['buyer_code_c'] ?? '')) . '|' . trim((string)($b['buyer_phone'] ?? ''));
            $b['items'] = $itemsByBuyer[$key] ?? [];
        }
        unset($b);

        return $buyers;
    }
}
