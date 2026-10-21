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
            LEFT JOIN hf_auction_transactions t ON a.article_id = t.article_id AND t.applicable_year = :year AND (t.offering_type IS NULL OR t.offering_type NOT IN ('Gold', 'BedSheet'))
            WHERE a.applicable_year = :year2
              AND a.article_number NOT LIKE 'OFFER-GOLD-%' 
              AND a.article_number NOT LIKE 'OFFER-BEDSHEET-%'
        ");
        $stmt->execute(['year' => $year, 'year2' => $year]);
        $summary = $stmt->fetch() ?: [];

        // Category breakdown (Floor Auction categories only)
        $catStmt = $this->db->prepare("
            SELECT 
                a.category,
                COUNT(a.article_id) as article_count,
                SUM(CASE WHEN a.status IN ('Sold', 'Auctioned') THEN 1 ELSE 0 END) as sold_count,
                COALESCE(SUM(a.estimated_value), 0) as estimated_val,
                COALESCE(SUM(t.winning_bid_amount), 0) as total_bid_val
            FROM hf_articles a
            LEFT JOIN hf_auction_transactions t ON a.article_id = t.article_id AND (t.offering_type IS NULL OR t.offering_type NOT IN ('Gold', 'BedSheet'))
            WHERE a.applicable_year = :year
              AND a.article_number NOT LIKE 'OFFER-GOLD-%' 
              AND a.article_number NOT LIKE 'OFFER-BEDSHEET-%'
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
                  AND (t.offering_type IS NULL OR t.offering_type NOT IN ('Gold', 'BedSheet'))
            ) sub
            LEFT JOIN tbl_primary_member m ON sub.buyer_member_id = m.primary_member_id
            GROUP BY sub.buyer_name, sub.buyer_code_c, sub.buyer_phone, m.cpr_no, m.prayer_group_name
            ORDER BY total_purchased DESC
        ");
        $stmt->execute(['year' => $year]);
        $buyers = $stmt->fetchAll();

        // Fetch item details (tag, name, article number) for transactions of this year (Live Auction only)
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
              AND (t.offering_type IS NULL OR t.offering_type NOT IN ('Gold', 'BedSheet'))
              AND a.article_number NOT LIKE 'OFFER-GOLD-%' 
              AND a.article_number NOT LIKE 'OFFER-BEDSHEET-%'
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

    /**
     * Special Offerings Summary (Gold & Bed Sheet)
     */
    public function getOfferingsSummary(int $year): array {
        $stmt = $this->db->prepare("
            SELECT 
                COUNT(*) as total_offerings_count,
                COALESCE(SUM(winning_bid_amount), 0) as total_offerings_revenue,
                COALESCE(SUM(paid_amount), 0) as total_collected_amount,
                COALESCE(SUM(balance_amount), 0) as total_receivable_promises,
                COUNT(DISTINCT buyer_name) as total_devotees,
                
                SUM(CASE WHEN offering_type = 'Gold' THEN 1 ELSE 0 END) as gold_count,
                COALESCE(SUM(CASE WHEN offering_type = 'Gold' THEN winning_bid_amount ELSE 0 END), 0) as gold_revenue,
                COALESCE(SUM(CASE WHEN offering_type = 'Gold' THEN paid_amount ELSE 0 END), 0) as gold_collected,
                COALESCE(SUM(CASE WHEN offering_type = 'Gold' THEN balance_amount ELSE 0 END), 0) as gold_pending,

                SUM(CASE WHEN offering_type = 'BedSheet' THEN 1 ELSE 0 END) as bedsheet_count,
                COALESCE(SUM(CASE WHEN offering_type = 'BedSheet' THEN winning_bid_amount ELSE 0 END), 0) as bedsheet_revenue,
                COALESCE(SUM(CASE WHEN offering_type = 'BedSheet' THEN paid_amount ELSE 0 END), 0) as bedsheet_collected,
                COALESCE(SUM(CASE WHEN offering_type = 'BedSheet' THEN balance_amount ELSE 0 END), 0) as bedsheet_pending
            FROM hf_auction_transactions
            WHERE applicable_year = :year AND offering_type IN ('Gold', 'BedSheet')
        ");
        $stmt->execute(['year' => $year]);
        $summary = $stmt->fetch() ?: [];

        // Category breakdown (Gold Offering vs Bed Sheet Offering)
        $catStmt = $this->db->prepare("
            SELECT 
                CASE WHEN offering_type = 'Gold' THEN 'Gold Offering' ELSE 'Bed Sheet Offering' END as category,
                offering_type as offering_code,
                COUNT(*) as offerings_count,
                SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) as settled_count,
                SUM(CASE WHEN payment_status = 'Partial' THEN 1 ELSE 0 END) as partial_count,
                SUM(CASE WHEN payment_status = 'Pending' THEN 1 ELSE 0 END) as pending_count,
                COALESCE(SUM(winning_bid_amount), 0) as total_offering_val,
                COALESCE(SUM(paid_amount), 0) as total_collected_val,
                COALESCE(SUM(balance_amount), 0) as total_balance_val
            FROM hf_auction_transactions
            WHERE applicable_year = :year AND offering_type IN ('Gold', 'BedSheet')
            GROUP BY offering_type
            ORDER BY total_offering_val DESC
        ");
        $catStmt->execute(['year' => $year]);
        $summary['category_breakdown'] = $catStmt->fetchAll();

        return $summary;
    }

    /**
     * Special Offerings Devotees Ledger Report
     */
    public function getOfferingsDevoteesReport(int $year, ?string $type = null): array {
        $typeCondition = "";
        $params = ['year' => $year];
        if ($type && in_array($type, ['Gold', 'BedSheet'])) {
            $typeCondition = " AND t.offering_type = :offering_type";
            $params['offering_type'] = $type;
        }

        $stmt = $this->db->prepare("
            SELECT 
                sub.buyer_name,
                sub.buyer_code_c,
                sub.buyer_phone,
                m.cpr_no,
                m.prayer_group_name,
                COUNT(sub.transaction_id) as offerings_count,
                SUM(sub.winning_bid_amount) as total_offered,
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
                    t.paid_amount,
                    t.balance_amount
                FROM hf_auction_transactions t
                WHERE t.applicable_year = :year 
                  AND t.offering_type IN ('Gold', 'BedSheet')
                  {$typeCondition}
            ) sub
            LEFT JOIN tbl_primary_member m ON sub.buyer_member_id = m.primary_member_id
            GROUP BY sub.buyer_name, sub.buyer_code_c, sub.buyer_phone, m.cpr_no, m.prayer_group_name
            ORDER BY total_offered DESC
        ");
        $stmt->execute($params);
        $devotees = $stmt->fetchAll();

        // Fetch detailed offering items
        $itemParams = ['year' => $year];
        $itemTypeCondition = "";
        if ($type && in_array($type, ['Gold', 'BedSheet'])) {
            $itemTypeCondition = " AND t.offering_type = :offering_type";
            $itemParams['offering_type'] = $type;
        }

        $itemsStmt = $this->db->prepare("
            SELECT 
                t.transaction_id,
                t.auction_ref_no,
                t.offering_type,
                t.item_description,
                a.article_number,
                t.winning_bid_amount,
                t.paid_amount,
                t.balance_amount,
                t.payment_status,
                t.auction_date,
                COALESCE(t.manual_receipt_no, t.contrib_voucher_no) as receipt_no,
                t.buyer_name,
                t.buyer_code_c,
                t.buyer_phone
            FROM hf_auction_transactions t
            LEFT JOIN hf_articles a ON t.article_id = a.article_id
            WHERE t.applicable_year = :year 
              AND t.offering_type IN ('Gold', 'BedSheet')
              {$itemTypeCondition}
            ORDER BY t.transaction_id DESC
        ");
        $itemsStmt->execute($itemParams);
        $allItems = $itemsStmt->fetchAll();

        $itemsByBuyer = [];
        foreach ($allItems as $item) {
            $key = trim($item['buyer_name']) . '|' . trim((string)($item['buyer_code_c'] ?? '')) . '|' . trim((string)($item['buyer_phone'] ?? ''));
            if (!isset($itemsByBuyer[$key])) {
                $itemsByBuyer[$key] = [];
            }
            $itemsByBuyer[$key][] = [
                'transaction_id'     => (int)$item['transaction_id'],
                'auction_ref_no'     => $item['auction_ref_no'],
                'offering_type'      => $item['offering_type'],
                'item_description'   => $item['item_description'],
                'article_number'     => $item['article_number'],
                'winning_bid_amount' => (float)$item['winning_bid_amount'],
                'paid_amount'        => (float)$item['paid_amount'],
                'balance_amount'     => (float)$item['balance_amount'],
                'payment_status'     => $item['payment_status'],
                'auction_date'       => $item['auction_date'],
                'receipt_no'         => $item['receipt_no']
            ];
        }

        foreach ($devotees as &$d) {
            $key = trim($d['buyer_name']) . '|' . trim((string)($d['buyer_code_c'] ?? '')) . '|' . trim((string)($d['buyer_phone'] ?? ''));
            $d['items'] = $itemsByBuyer[$key] ?? [];
        }
        unset($d);

        return $devotees;
    }
}

