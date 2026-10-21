<?php
namespace App\Models;

use App\Core\Model;
use PDO;

class Auction extends Model {
    public function getAll(int $year, ?string $paymentStatus = null, ?string $search = null, ?string $offeringType = null): array {
        $baseSql = "
            SELECT 
                t.transaction_id,
                t.auction_ref_no,
                t.article_id,
                t.applicable_year,
                COALESCE(t.offering_type, 'Auction') as offering_type,
                t.item_description,
                t.buyer_member_id,
                t.buyer_name,
                t.buyer_code_c,
                COALESCE(NULLIF(t.buyer_phone, ''), m.bahrain_contact_no) as buyer_phone,
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
                END as balance_amount,
                CASE 
                    WHEN (
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
                    ) <= 0.0001 THEN 'Paid'
                    WHEN COALESCE(
                        (SELECT SUM(c.contribution_amount) 
                         FROM acc_contribution c 
                         WHERE c.article_id = t.article_id 
                           AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                        t.paid_amount,
                        0
                    ) > 0.0001 THEN 'Partial'
                    ELSE 'Pending'
                END as payment_status,
                t.auction_date,
                t.notes,
                t.created_by,
                t.created_at,
                NOW() as current_time_bahrain,
                GREATEST(0, TIMESTAMPDIFF(SECOND, COALESCE(t.created_at, CONCAT(t.auction_date, ' 00:00:00')), NOW())) as elapsed_seconds,
                GREATEST(0, LEAST(86400, 86400 - GREATEST(0, TIMESTAMPDIFF(SECOND, COALESCE(t.created_at, CONCAT(t.auction_date, ' 00:00:00')), NOW())))) as remaining_seconds,
                CASE 
                    WHEN TIMESTAMPDIFF(SECOND, COALESCE(t.created_at, CONCAT(t.auction_date, ' 00:00:00')), NOW()) <= 86400 THEN 1 
                    ELSE 0 
                END as is_within_24h,
                t.event_id,
                t.event_name,
                t.contrib_dr_code,
                t.contrib_dr_name,
                t.contrib_cr_code,
                t.contrib_cr_name,
                t.contrib_voucher_no,
                t.acc_contribution_id,
                t.promise_dr_code,
                t.promise_dr_name,
                t.promise_cr_code,
                t.promise_cr_name,
                t.promise_voucher_no,
                t.acc_promise_id,
                t.receipt_book_no,
                t.manual_receipt_no,
                a.article_number, a.tag_number, a.article_name, a.category, a.estimated_value, a.donor_name,
                m.primary_member_name, m.cpr_no as buyer_cpr, m.bahrain_contact_no as member_mobile, m.prayer_group_name as buyer_prayer_group
            FROM hf_auction_transactions t
            JOIN hf_articles a ON t.article_id = a.article_id
            LEFT JOIN tbl_primary_member m ON t.buyer_member_id = m.primary_member_id
            WHERE t.applicable_year = :year
        ";

        $sql = "SELECT * FROM ({$baseSql}) q WHERE 1=1";
        $params = ['year' => $year];

        if ($paymentStatus && $paymentStatus !== 'All') {
            $sql .= " AND q.payment_status = :status";
            $params['status'] = $paymentStatus;
        }

        if ($offeringType && $offeringType !== 'All') {
            if ($offeringType === 'Auction') {
                $sql .= " AND (q.offering_type = 'Auction' OR q.offering_type IS NULL OR q.offering_type = '')";
            } elseif ($offeringType === 'Offerings') {
                $sql .= " AND q.offering_type IN ('Gold', 'BedSheet')";
            } elseif (in_array($offeringType, ['Gold', 'BedSheet'])) {
                $sql .= " AND q.offering_type = :offering_type";
                $params['offering_type'] = $offeringType;
            }
        }

        if ($search && trim($search) !== '') {
            $sql .= " AND (q.auction_ref_no LIKE :search1
                        OR q.buyer_name LIKE :search2
                        OR q.article_number LIKE :search3
                        OR q.tag_number LIKE :search4
                        OR q.article_name LIKE :search5
                        OR q.buyer_code_c LIKE :search6
                        OR q.buyer_phone LIKE :search7
                        OR q.buyer_cpr LIKE :search8
                        OR q.item_description LIKE :search9)";
            $term = "%" . trim($search) . "%";
            for ($i = 1; $i <= 9; $i++) {
                $params["search{$i}"] = $term;
            }
        }

        $sql .= " ORDER BY q.transaction_id DESC";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $this->enrichTransactionsWithAccounts($rows);
        return $rows;
    }

    public function findById(int $transactionId): ?array {
        $stmt = $this->db->prepare("
            SELECT 
                t.transaction_id,
                t.auction_ref_no,
                t.article_id,
                t.applicable_year,
                t.buyer_member_id,
                t.buyer_name,
                t.buyer_code_c,
                COALESCE(NULLIF(t.buyer_phone, ''), m.bahrain_contact_no) as buyer_phone,
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
                END as balance_amount,
                CASE 
                    WHEN (
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
                    ) <= 0.0001 THEN 'Paid'
                    WHEN COALESCE(
                        (SELECT SUM(c.contribution_amount) 
                         FROM acc_contribution c 
                         WHERE c.article_id = t.article_id 
                           AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                        t.paid_amount,
                        0
                    ) > 0.0001 THEN 'Partial'
                    ELSE 'Pending'
                END as payment_status,
                t.auction_date,
                COALESCE(t.offering_type, 'Auction') as offering_type,
                t.item_description,
                t.notes,
                t.created_by,
                t.created_at,
                NOW() as current_time_bahrain,
                GREATEST(0, TIMESTAMPDIFF(SECOND, COALESCE(t.created_at, CONCAT(t.auction_date, ' 00:00:00')), NOW())) as elapsed_seconds,
                GREATEST(0, LEAST(86400, 86400 - GREATEST(0, TIMESTAMPDIFF(SECOND, COALESCE(t.created_at, CONCAT(t.auction_date, ' 00:00:00')), NOW())))) as remaining_seconds,
                CASE 
                    WHEN TIMESTAMPDIFF(SECOND, COALESCE(t.created_at, CONCAT(t.auction_date, ' 00:00:00')), NOW()) <= 86400 THEN 1 
                    ELSE 0 
                END as is_within_24h,
                t.event_id,
                t.event_name,
                t.contrib_dr_code,
                t.contrib_dr_name,
                t.contrib_cr_code,
                t.contrib_cr_name,
                t.contrib_voucher_no,
                t.acc_contribution_id,
                t.promise_dr_code,
                t.promise_dr_name,
                t.promise_cr_code,
                t.promise_cr_name,
                t.promise_voucher_no,
                t.acc_promise_id,
                t.receipt_book_no,
                t.manual_receipt_no,
                a.article_number, a.tag_number, a.article_name, a.category, a.estimated_value, a.donor_name,
                m.primary_member_name, m.cpr_no as buyer_cpr, m.bahrain_contact_no as member_mobile, m.prayer_group_name as buyer_prayer_group
            FROM hf_auction_transactions t
            JOIN hf_articles a ON t.article_id = a.article_id
            LEFT JOIN tbl_primary_member m ON t.buyer_member_id = m.primary_member_id
            WHERE t.transaction_id = :id
            LIMIT 1
        ");
        $stmt->execute(['id' => $transactionId]);
        $row = $stmt->fetch();
        if ($row) {
            $single = [$row];
            $this->enrichTransactionsWithAccounts($single);
            return $single[0];
        }
        return null;
    }

    private function enrichTransactionsWithAccounts(array &$rows): void {
        if (empty($rows)) {
            return;
        }

        $auctionRows = array_filter($rows, fn($r) => empty($r['offering_type']) || $r['offering_type'] === 'Auction');
        $articleIds = array_values(array_unique(array_filter(array_column($auctionRows, 'article_id'))));
        $contribIds = array_values(array_unique(array_filter(array_column($rows, 'acc_contribution_id'))));
        $promiseIds = array_values(array_unique(array_filter(array_column($rows, 'acc_promise_id'))));

        // 1. Fetch contributions from acc_contribution
        $contribMap = [];
        if (!empty($articleIds) || !empty($contribIds)) {
            $cWhere = [];
            $cParams = [];
            if (!empty($articleIds)) {
                $cWhere[] = "c.article_id IN (" . implode(',', array_fill(0, count($articleIds), '?')) . ")";
                $cParams = array_merge($cParams, $articleIds);
            }
            if (!empty($contribIds)) {
                $cWhere[] = "c.contribution_id IN (" . implode(',', array_fill(0, count($contribIds), '?')) . ")";
                $cParams = array_merge($cParams, $contribIds);
            }

            $cSql = "
                SELECT 
                    c.contribution_id,
                    c.article_id,
                    c.member_id,
                    c.voucher_ref_no as voucher_no,
                    c.contribution_amount,
                    c.contribution_date,
                    c.manual_book_no,
                    c.manual_receipt_no,
                    c.dr_code, c.dr_name, c.cr_code, c.cr_name,
                    p.receipt_no
                FROM acc_contribution c
                LEFT JOIN hf_payments p ON (p.acc_contribution_id = c.contribution_id OR p.voucher_no = c.voucher_ref_no)
                WHERE " . implode(' OR ', $cWhere) . "
                ORDER BY c.contribution_id ASC
            ";
            $cStmt = $this->db->prepare($cSql);
            $cStmt->execute($cParams);
            $allContribs = $cStmt->fetchAll();

            foreach ($allContribs as $cb) {
                $artId = (int)$cb['article_id'];
                $memId = (int)$cb['member_id'];
                $cid = (int)$cb['contribution_id'];

                if ($artId > 0 && $memId > 0) {
                    $contribMap['art_' . $artId . '_mem_' . $memId][] = $cb;
                } elseif ($artId > 0) {
                    $contribMap['art_' . $artId][] = $cb;
                }
                if ($cid > 0) {
                    $contribMap['cid_' . $cid] = $cb;
                }
            }
        }

        // 2. Fetch promises from acc_promises
        $promiseMap = [];
        if (!empty($articleIds) || !empty($promiseIds)) {
            $pWhere = [];
            $pParams = [];
            if (!empty($articleIds)) {
                $pWhere[] = "pr.article_id IN (" . implode(',', array_fill(0, count($articleIds), '?')) . ")";
                $pParams = array_merge($pParams, $articleIds);
            }
            if (!empty($promiseIds)) {
                $pWhere[] = "pr.promise_id IN (" . implode(',', array_fill(0, count($promiseIds), '?')) . ")";
                $pParams = array_merge($pParams, $promiseIds);
            }

            $pSql = "
                SELECT 
                    pr.promise_id,
                    pr.article_id,
                    pr.member_id,
                    pr.voucher_ref_no as voucher_no,
                    pr.promise_amount,
                    pr.balance_amount,
                    pr.promise_date,
                    pr.promise_status,
                    pr.dr_code, pr.dr_name, pr.cr_code, pr.cr_name
                FROM acc_promises pr
                WHERE " . implode(' OR ', $pWhere) . "
                ORDER BY pr.promise_id ASC
            ";
            $pStmt = $this->db->prepare($pSql);
            $pStmt->execute($pParams);
            $allPromises = $pStmt->fetchAll();

            foreach ($allPromises as $pm) {
                $artId = (int)$pm['article_id'];
                $memId = (int)$pm['member_id'];
                $pid = (int)$pm['promise_id'];

                if ($artId > 0 && $memId > 0) {
                    $promiseMap['art_' . $artId . '_mem_' . $memId][] = $pm;
                } elseif ($artId > 0) {
                    $promiseMap['art_' . $artId][] = $pm;
                }
                if ($pid > 0) {
                    $promiseMap['pid_' . $pid] = $pm;
                }
            }
        }

        // 3. Attach to transactions
        foreach ($rows as &$t) {
            $isOffering = !empty($t['offering_type']) && $t['offering_type'] !== 'Auction';
            $artId = (int)($t['article_id'] ?? 0);
            $memId = (int)($t['buyer_member_id'] ?? 0);
            $cid = (int)($t['acc_contribution_id'] ?? 0);
            $pid = (int)($t['acc_promise_id'] ?? 0);

            $cKeyMem = 'art_' . $artId . '_mem_' . $memId;
            $cKeyArt = 'art_' . $artId;
            $cKeyId  = 'cid_' . $cid;

            $cList = [];
            if ($cid > 0 && isset($contribMap[$cKeyId])) {
                $cList = [$contribMap[$cKeyId]];
            } elseif (!$isOffering && $artId > 0 && $memId > 0 && isset($contribMap[$cKeyMem])) {
                $cList = $contribMap[$cKeyMem];
            } elseif (!$isOffering && $artId > 0 && isset($contribMap[$cKeyArt])) {
                $cList = $contribMap[$cKeyArt];
            } elseif (!empty($t['contrib_voucher_no'])) {
                $cList = [[
                    'contribution_id'     => $t['acc_contribution_id'],
                    'voucher_no'          => $t['contrib_voucher_no'],
                    'contribution_amount' => $t['paid_amount'],
                    'contribution_date'   => $t['auction_date'],
                    'manual_receipt_no'   => $t['manual_receipt_no'],
                    'receipt_no'          => null
                ]];
            }

            $uniqueContribs = [];
            $seenC = [];
            foreach ($cList as $item) {
                $key = !empty($item['contribution_id']) ? 'id_' . $item['contribution_id'] : ('vno_' . $item['voucher_no']);
                if (!isset($seenC[$key])) {
                    $seenC[$key] = true;
                    $uniqueContribs[] = $item;
                }
            }
            $t['contributions'] = $uniqueContribs;

            $pKeyMem = 'art_' . $artId . '_mem_' . $memId;
            $pKeyArt = 'art_' . $artId;
            $pKeyId  = 'pid_' . $pid;

            $pList = [];
            if ($pid > 0 && isset($promiseMap[$pKeyId])) {
                $pList = [$promiseMap[$pKeyId]];
            } elseif (!$isOffering && $artId > 0 && $memId > 0 && isset($promiseMap[$pKeyMem])) {
                $pList = $promiseMap[$pKeyMem];
            } elseif (!$isOffering && $artId > 0 && isset($promiseMap[$pKeyArt])) {
                $pList = $promiseMap[$pKeyArt];
            } elseif (!empty($t['promise_voucher_no'])) {
                $pList = [[
                    'promise_id'     => $t['acc_promise_id'],
                    'voucher_no'     => $t['promise_voucher_no'],
                    'promise_amount' => $t['balance_amount'],
                    'balance_amount' => $t['balance_amount'],
                    'promise_date'   => $t['auction_date']
                ]];
            }

            $uniquePromises = [];
            $seenP = [];
            foreach ($pList as $pItem) {
                $key = !empty($pItem['promise_id']) ? 'id_' . $pItem['promise_id'] : ('vno_' . $pItem['voucher_no']);
                if (!isset($seenP[$key])) {
                    $seenP[$key] = true;
                    $uniquePromises[] = $pItem;
                }
            }
            $t['promises'] = $uniquePromises;
        }
        unset($t);
    }

    /**
     * Get or create default offering article master for Gold or Bed Sheet
     */
    public function getOrCreateDefaultOfferingArticle(int $year, string $type): array {
        $tag = ($type === 'Gold') ? 'GOLD' : 'BEDSHEET';
        $name = ($type === 'Gold') ? 'Gold Offering' : 'Bed Sheet Offering';
        $artNum = ($type === 'Gold') ? "OFFER-GOLD-{$year}" : "OFFER-BEDSHEET-{$year}";
        $category = ($type === 'Gold') ? 'Gold Offering' : 'Bed Sheet Offering';

        $stmt = $this->db->prepare("SELECT * FROM hf_articles WHERE applicable_year = :year AND tag_number = :tag LIMIT 1");
        $stmt->execute(['year' => $year, 'tag' => $tag]);
        $existing = $stmt->fetch();
        if ($existing) {
            return $existing;
        }

        // Insert default article for this festival year
        $ins = $this->db->prepare("
            INSERT INTO hf_articles (
                article_number, tag_number, applicable_year, article_name,
                description, category, donor_name, estimated_value, reserve_price, status
            ) VALUES (
                :num, :tag, :year, :name,
                :desc, :cat, 'Devotee / Well-Wisher', 0, 0, 'Available'
            )
        ");
        $ins->execute([
            'num'  => $artNum,
            'tag'  => $tag,
            'year' => $year,
            'name' => $name,
            'desc' => "Default master item for {$name}",
            'cat'  => $category
        ]);
        $id = (int)$this->db->lastInsertId();

        $getStmt = $this->db->prepare("SELECT * FROM hf_articles WHERE article_id = :id");
        $getStmt->execute(['id' => $id]);
        return $getStmt->fetch() ?: [];
    }

    public function recordAuction(array $data, int $userId): array {
        try {
            $offeringType = in_array($data['offering_type'] ?? '', ['Gold', 'BedSheet']) ? $data['offering_type'] : 'Auction';
            $isOffering = ($offeringType !== 'Auction');
            $year = !empty($data['applicable_year']) ? (int)$data['applicable_year'] : (int)date('Y');
            $bidAmount = (float)($data['winning_bid_amount'] ?? ($data['bid_amount'] ?? 0));
            $paidAmount = (float)($data['paid_amount'] ?? ($data['amount_paid'] ?? 0));
            $balanceAmount = max(0, $bidAmount - $paidAmount);

            if ($isOffering) {
                $itemDescription = trim($data['item_description'] ?? '');
                if ($itemDescription === '') {
                    throw new \Exception("Item description is required for {$offeringType} offerings.");
                }
                $art = $this->getOrCreateDefaultOfferingArticle($year, $offeringType);
                $articleId = (int)$art['article_id'];
            } else {
                $articleId = (int)($data['article_id'] ?? 0);
                if ($articleId <= 0) {
                    throw new \Exception("Please select an article for Live Auction.");
                }
                // Fetch article info
                $artStmt = $this->db->prepare("SELECT * FROM hf_articles WHERE article_id = :id");
                $artStmt->execute(['id' => $articleId]);
                $art = $artStmt->fetch() ?: [];
                if (empty($art)) {
                    throw new \Exception("Article not found.");
                }

                $year = !empty($art['applicable_year']) ? (int)$art['applicable_year'] : $year;

                // Validate against article reserve price
                $reservePrice = !empty($art['reserve_price']) ? (float)$art['reserve_price'] : 0.0;
                if ($reservePrice > 0.0001 && $bidAmount < ($reservePrice - 0.0001)) {
                    throw new \Exception(sprintf(
                        "Winning bid amount (BHD %.3f) cannot be less than the article's reserve price of BHD %.3f.",
                        $bidAmount,
                        $reservePrice
                    ));
                }
            }

            // Fetch member code_m if buyer_member_id given
            $memberCodeM = 0;
            if (!empty($data['buyer_member_id'])) {
                $mStmt = $this->db->prepare("SELECT code_m FROM tbl_primary_member WHERE primary_member_id = :id");
                $mStmt->execute(['id' => (int)$data['buyer_member_id']]);
                $memberCodeM = (int)($mStmt->fetchColumn() ?: 0);
            }

            $paymentStatus = 'Pending';
            if ($balanceAmount <= 0) {
                $paymentStatus = 'Paid';
            } elseif ($paidAmount > 0) {
                $paymentStatus = 'Partial';
            }

            // Generate unique auction/offering ref no with dedicated prefixes
            if ($isOffering) {
                $prefix = ($offeringType === 'Gold') ? 'GLD' : 'BED';
                $countStmt = $this->db->prepare("SELECT COUNT(*) FROM hf_auction_transactions WHERE applicable_year = :year AND auction_ref_no LIKE :prefix");
                $countStmt->execute(['year' => $year, 'prefix' => "{$prefix}-%"]);
                $seq = $countStmt->fetchColumn() + 1;
                $auctionRefNo = sprintf("%s-%d-%04d", $prefix, $year, $seq);
            } else {
                $countStmt = $this->db->prepare("SELECT COUNT(*) FROM hf_auction_transactions WHERE applicable_year = :year AND auction_ref_no LIKE 'AUC-%'");
                $countStmt->execute(['year' => $year]);
                $seq = $countStmt->fetchColumn() + 1;
                $auctionRefNo = sprintf("AUC-%d-%04d", $year, $seq);
            }

            $eventId = !empty($data['event_id']) ? (int)$data['event_id'] : 10;
            $eventName = !empty($data['event_name']) ? trim($data['event_name']) : ('Budget ' . $year);
            $auctionDate = !empty($data['auction_date']) ? $data['auction_date'] : date('Y-m-d');

            // Build article details and narration
            $artTag = !empty($art['tag_number']) ? $art['tag_number'] : ($isOffering ? strtoupper($offeringType) : ('#' . $articleId));
            $artNo = !empty($art['article_number']) ? $art['article_number'] : ('ART-' . $articleId);
            $artName = !empty($art['article_name']) ? $art['article_name'] : ($isOffering ? "{$offeringType} Offering" : 'Article');

            if ($isOffering) {
                $articleDetails = sprintf("[%s] %s", $artTag, $itemDescription);
                $pNarration = sprintf("%s Offering: [%s] %s * %s * %s", $offeringType, $artTag, $itemDescription, $auctionRefNo, trim($data['buyer_name']));
                $cNarration = sprintf("%s Offering Payment: [%s] %s * %s * %s", $offeringType, $artTag, $itemDescription, $auctionRefNo, trim($data['buyer_name']));
            } else {
                $artCategory = !empty($art['category']) ? $art['category'] : 'General';
                $artDonor = !empty($art['donor_name']) ? $art['donor_name'] : 'Well-Wisher';
                $artEst = number_format((float)($art['estimated_value'] ?? 0), 3);
                $articleDetails = sprintf("Tag: %s | Art No: %s | %s | Cat: %s | Donor: %s | Est: %s BHD", $artTag, $artNo, $artName, $artCategory, $artDonor, $artEst);
                $pNarration = sprintf("Auction Promise: [%s / %s] %s (Art ID: %d) * %s * %s", $artTag, $artNo, $artName, $articleId, $auctionRefNo, trim($data['buyer_name']));
                $cNarration = sprintf("Auction Floor Payment: [%s / %s] %s (Art ID: %d) * %s * %s", $artTag, $artNo, $artName, $articleId, $auctionRefNo, trim($data['buyer_name']));
            }

            $receiptBookNo = !empty($data['receipt_book_no']) ? trim($data['receipt_book_no']) : '0';
            $receiptNoInput = !empty($data['receipt_no']) ? trim($data['receipt_no']) : '0';

            // Generate receipt number sequence if no manual receipt number provided
            $payCount = $this->db->prepare("SELECT COUNT(*) FROM hf_payments");
            $payCount->execute();
            $pSeq = $payCount->fetchColumn() + 1;
            $generatedReceiptNo = sprintf("RCPT-%d-%04d", $year, $pSeq);
            $effectiveReceiptNo = ($receiptNoInput !== '0' && $receiptNoInput !== '') ? $receiptNoInput : $generatedReceiptNo;

            // --- 1. Post Promise Entry (Member Receivable) for the full Winning Bid Amount ---
            $promiseVoucherNo = null;
            $accPromiseId = null;

            $promiseDrCode = !empty($data['promise_dr_code']) ? trim($data['promise_dr_code']) : '08583';
            $promiseDrName = !empty($data['promise_dr_name']) ? trim($data['promise_dr_name']) : 'A/R Harvest Festival 2025 - Auction';
            $promiseCrCode = !empty($data['promise_cr_code']) ? trim($data['promise_cr_code']) : '07503';
            $promiseCrName = !empty($data['promise_cr_name']) ? trim($data['promise_cr_name']) : 'Harvest Festival - Article Auction';

            $pNarration = sprintf("Auction Promise: [%s / %s] %s (Art ID: %d) * %s * %s", $artTag, $artNo, $artName, $articleId, $auctionRefNo, trim($data['buyer_name']));
            if (!empty($data['buyer_code_c'])) {
                $pNarration .= " (Roll: " . $data['buyer_code_c'] . ")";
            }

            // Execute stored procedure with Winning Bid Amount ($bidAmount) so promise_amount and acc_ledger_entries reflect the winning bid
            $pProc = $this->db->prepare('CALL acc_proc_add_member_receivables_v1(
                :event_id, :event_name, :promise_date, :promise_year,
                :member_id, :member_ccode, :member_mcode, :member_name, :narration,
                "By Amount", 0, :cr_code, :cr_name, 0, :dr_code, :dr_name,
                :amount, "Yes", "NA", :item_description, "not_found.jpg", :created_date, :user_id, 0,
                @msg, @p_ids, @v_ids
            )');
            $pProc->execute([
                'event_id'         => $eventId,
                'event_name'       => $eventName,
                'promise_date'     => $auctionDate,
                'promise_year'     => (string)$year,
                'member_id'        => !empty($data['buyer_member_id']) ? (int)$data['buyer_member_id'] : 0,
                'member_ccode'     => !empty($data['buyer_code_c']) ? (int)$data['buyer_code_c'] : 0,
                'member_mcode'     => $memberCodeM,
                'member_name'      => trim($data['buyer_name']),
                'narration'        => $pNarration,
                'cr_code'          => $promiseCrCode,
                'cr_name'          => $promiseCrName,
                'dr_code'          => $promiseDrCode,
                'dr_name'          => $promiseDrName,
                'amount'           => $bidAmount, // Winning bid amount posted as promise
                'item_description' => $articleDetails,
                'created_date'     => date('Y-m-d'),
                'user_id'          => $userId
            ]);

            $pRes = $this->db->query('SELECT @msg as msg, @p_ids as p_ids, @v_ids as v_ids')->fetch();
            if (!empty($pRes['v_ids']) && $pRes['msg'] === 'success') {
                $accPromiseId = (int)$pRes['p_ids']; // Generated Promise ID
                $promiseVoucherNo = (int)$pRes['v_ids']; // Generated Promise Voucher No (MP)

                // Submit promises to post to acc_ledger_entries (at full winning amount) and activate in acc_voucher_nos & acc_promises
                $subP = $this->db->prepare('CALL acc_proc_submit_promises(:vno, @ret)');
                $subP->execute(['vno' => $promiseVoucherNo]);

                // Calculate balance amount as winning amount - paid amount
                $promiseStatus = ($balanceAmount <= 0.0001) ? 'Received' : 'Active';
                $lastPaymentDate = ($paidAmount > 0) ? $auctionDate : null;

                // Update acc_promises: winning amount as promise_amount, balance as (winning - paid), last payment date, article link
                $hasPromiseArt = $this->hasColumn('acc_promises', 'article_id');
                $pArtClause = $hasPromiseArt ? "article_id = :art_id," : "";

                $updP = $this->db->prepare("
                    UPDATE acc_promises 
                    SET promise_amount    = :promise_amount,
                        balance_amount    = :balance_amount,
                        last_payment_date = :last_payment_date,
                        promise_status    = :promise_status,
                        {$pArtClause}
                        item_description  = :art_details,
                        narration         = :narration
                    WHERE promise_id = :pid
                ");
                $pParams = [
                    'promise_amount'    => $bidAmount,
                    'balance_amount'    => $balanceAmount,
                    'last_payment_date' => $lastPaymentDate,
                    'promise_status'    => $promiseStatus,
                    'art_details'       => $articleDetails,
                    'narration'         => $pNarration,
                    'pid'               => $accPromiseId
                ];
                if ($hasPromiseArt) {
                    $pParams['art_id'] = $articleId;
                }
                $updP->execute($pParams);

                // Connect article_id and narration in acc_ledger_entries for MP entry
                $hasLedgerArt = $this->hasColumn('acc_ledger_entries', 'article_id');
                $leArtClause = $hasLedgerArt ? "article_id = :art_id," : "";

                $updLEP = $this->db->prepare("
                    UPDATE acc_ledger_entries 
                    SET {$leArtClause}
                        narration = :narration
                    WHERE promise_id = :pid AND entry_type = 'MP'
                ");
                $leParams = [
                    'narration' => $pNarration,
                    'pid'       => $accPromiseId
                ];
                if ($hasLedgerArt) {
                    $leParams['art_id'] = $articleId;
                }
                $updLEP->execute($leParams);
            } else {
                throw new \Exception("Promise posting failed: " . ($pRes['msg'] ?? 'Unknown error'));
            }

            // --- 2. Post Contribution Entry (Receipt) if paidAmount > 0 for paid amount ---
            $contribVoucherNo = null;
            $contribBatchCode = null;
            $accContribId = null;

            $contribDrCode = !empty($data['contrib_dr_code']) ? trim($data['contrib_dr_code']) : '02123';
            $contribDrName = !empty($data['contrib_dr_name']) ? trim($data['contrib_dr_name']) : 'Cash on Hand-Harvest Festival';
            $contribCrCode = !empty($data['contrib_cr_code']) ? trim($data['contrib_cr_code']) : '02206';
            $contribCrName = !empty($data['contrib_cr_name']) ? trim($data['contrib_cr_name']) : 'Church Building Fund - Harvest Festival';

            if ($paidAmount > 0) {
                $cNarration = sprintf("Auction Sale: [%s / %s] %s (Art ID: %d) * %s * %s", $artTag, $artNo, $artName, $articleId, $auctionRefNo, trim($data['buyer_name']));
                if (!empty($data['buyer_code_c'])) {
                    $cNarration .= " (Roll: " . $data['buyer_code_c'] . ")";
                }

                $cProc = $this->db->prepare('CALL hf_acc_proc_add_member_contributions_batch_new_v1(
                    :event_id, :event_name, :contrib_date, :contrib_year,
                    :member_id, :member_ccode, :member_mcode, :member_name, :narration,
                    "By Amount", 0, :cr_code, :cr_name, 0, :dr_code, :dr_name,
                    :amount, :item_description, :created_date, :user_id, 0,
                    :receipt_book_no, :receipt_no, 0, "NA",
                    @msg, @p_ids, @v_ids, @vnos_ids
                )');
                $cProc->execute([
                    'event_id'         => $eventId,
                    'event_name'       => $eventName,
                    'contrib_date'     => $auctionDate,
                    'contrib_year'     => (int)$year,
                    'member_id'        => !empty($data['buyer_member_id']) ? (int)$data['buyer_member_id'] : 0,
                    'member_ccode'     => !empty($data['buyer_code_c']) ? (int)$data['buyer_code_c'] : 0,
                    'member_mcode'     => $memberCodeM,
                    'member_name'      => trim($data['buyer_name']),
                    'narration'        => $cNarration,
                    'cr_code'          => $contribCrCode,
                    'cr_name'          => $contribCrName,
                    'dr_code'          => $contribDrCode,
                    'dr_name'          => $contribDrName,
                    'amount'           => $paidAmount, // Paid amount posted as contribution
                    'item_description' => $articleDetails,
                    'created_date'     => date('Y-m-d'),
                    'user_id'          => $userId,
                    'receipt_book_no'  => $receiptBookNo,
                    'receipt_no'       => $effectiveReceiptNo
                ]);

                $cRes = $this->db->query('SELECT @msg as msg, @p_ids as p_ids, @v_ids as v_ids, @vnos_ids as vnos_ids')->fetch();
                if (!empty($cRes['msg']) && $cRes['msg'] === 'success') {
                    $accContribId = (int)$cRes['p_ids']; // Generated Contribution ID
                    $contribBatchCode = (int)$cRes['v_ids']; // Generated Batch Code
                    $contribVoucherNo = (int)$cRes['vnos_ids']; // Generated Voucher Number (HRCPT)

                    // Connect article_id, promise_id, details, and receipt numbers directly in acc_contribution
                    $hasContribArt = $this->hasColumn('acc_contribution', 'article_id');
                    $cArtClause = $hasContribArt ? "article_id = :art_id," : "";

                    $updC = $this->db->prepare("
                        UPDATE acc_contribution 
                        SET {$cArtClause}
                            promise_id = :promise_id,
                            item_description = :art_details,
                            narration = :narration,
                            manual_book_no = :bno,
                            manual_receipt_no = :rno
                        WHERE contribution_id = :cid
                    ");
                    $cParams = [
                        'promise_id'  => $accPromiseId,
                        'art_details' => $articleDetails,
                        'narration'   => $cNarration,
                        'bno'         => $receiptBookNo,
                        'rno'         => $effectiveReceiptNo,
                        'cid'         => $accContribId
                    ];
                    if ($hasContribArt) {
                        $cParams['art_id'] = $articleId;
                    }
                    $updC->execute($cParams);

                    // Connect article_id, promise_id, and narration directly in acc_ledger_entries
                    $leContribArtClause = $hasLedgerArt ? "article_id = :art_id," : "";
                    $updLE = $this->db->prepare("
                        UPDATE acc_ledger_entries 
                        SET {$leContribArtClause}
                            promise_id = :promise_id,
                            narration = :narration
                        WHERE contribution_id = :cid AND entry_type = 'HRCPT'
                    ");
                    $leContribParams = [
                        'promise_id' => $accPromiseId,
                        'narration'  => $cNarration,
                        'cid'        => $accContribId
                    ];
                    if ($hasLedgerArt) {
                        $leContribParams['art_id'] = $articleId;
                    }
                    $updLE->execute($leContribParams);
                } else {
                    throw new \Exception("Contribution posting failed: " . ($cRes['msg'] ?? 'Unknown error'));
                }
            }

            // --- 3. Insert auction transaction ---
            $stmt = $this->db->prepare("
                INSERT INTO hf_auction_transactions (
                    auction_ref_no, article_id, applicable_year, buyer_member_id,
                    buyer_name, buyer_code_c, buyer_phone, winning_bid_amount,
                    paid_amount, balance_amount, payment_status, auction_date, notes, created_by,
                    event_id, event_name,
                    contrib_dr_code, contrib_dr_name, contrib_cr_code, contrib_cr_name,
                    contrib_voucher_no, acc_contribution_id,
                    promise_dr_code, promise_dr_name, promise_cr_code, promise_cr_name,
                    promise_voucher_no, acc_promise_id,
                    receipt_book_no, manual_receipt_no,
                    offering_type, item_description,
                    created_at
                ) VALUES (
                    :auction_ref_no, :article_id, :applicable_year, :buyer_member_id,
                    :buyer_name, :buyer_code_c, :buyer_phone, :winning_bid_amount,
                    :paid_amount, :balance_amount, :payment_status, :auction_date, :notes, :created_by,
                    :event_id, :event_name,
                    :contrib_dr_code, :contrib_dr_name, :contrib_cr_code, :contrib_cr_name,
                    :contrib_voucher_no, :acc_contribution_id,
                    :promise_dr_code, :promise_dr_name, :promise_cr_code, :promise_cr_name,
                    :promise_voucher_no, :acc_promise_id,
                    :receipt_book_no, :manual_receipt_no,
                    :offering_type, :item_description,
                    :created_at
                )
            ");
            $stmt->execute([
                'auction_ref_no'      => $auctionRefNo,
                'article_id'          => $articleId,
                'applicable_year'     => $year,
                'buyer_member_id'     => !empty($data['buyer_member_id']) ? (int)$data['buyer_member_id'] : null,
                'buyer_name'          => trim($data['buyer_name']),
                'buyer_code_c'        => !empty($data['buyer_code_c']) ? (int)$data['buyer_code_c'] : null,
                'buyer_phone'         => $data['buyer_phone'] ?? null,
                'winning_bid_amount'  => $bidAmount,
                'paid_amount'         => $paidAmount,
                'balance_amount'      => $balanceAmount,
                'payment_status'      => $paymentStatus,
                'auction_date'        => $auctionDate,
                'notes'               => $data['notes'] ?? null,
                'created_by'          => $userId,
                'event_id'            => $eventId,
                'event_name'          => $eventName,
                'contrib_dr_code'     => $paidAmount > 0 ? $contribDrCode : null,
                'contrib_dr_name'     => $paidAmount > 0 ? $contribDrName : null,
                'contrib_cr_code'     => $paidAmount > 0 ? $contribCrCode : null,
                'contrib_cr_name'     => $paidAmount > 0 ? $contribCrName : null,
                'contrib_voucher_no'  => $contribVoucherNo,
                'acc_contribution_id' => $accContribId,
                'promise_dr_code'     => $promiseDrCode,
                'promise_dr_name'     => $promiseDrName,
                'promise_cr_code'     => $promiseCrCode,
                'promise_cr_name'     => $promiseCrName,
                'promise_voucher_no'  => $promiseVoucherNo,
                'acc_promise_id'      => $accPromiseId,
                'receipt_book_no'     => $receiptBookNo !== '0' ? $receiptBookNo : null,
                'manual_receipt_no'   => $receiptNoInput !== '0' ? $receiptNoInput : null,
                'offering_type'       => $offeringType,
                'item_description'    => $isOffering ? $itemDescription : null,
                'created_at'          => date('Y-m-d H:i:s')
            ]);
            $transactionId = (int)$this->db->lastInsertId();

            if (!$isOffering) {
                // Update article status to 'Sold' or 'Auctioned'
                $artStatus = ($paymentStatus === 'Paid') ? 'Sold' : 'Auctioned';
                $updArt = $this->db->prepare("UPDATE hf_articles SET status = :status WHERE article_id = :id");
                $updArt->execute(['status' => $artStatus, 'id' => $articleId]);
            }

            $receiptNo = null;
            // --- 4. Record payment in hf_payments if paidAmount > 0 ---
            if ($paidAmount > 0) {
                $payCount = $this->db->prepare("SELECT COUNT(*) FROM hf_payments");
                $payCount->execute();
                $pSeq = $payCount->fetchColumn() + 1;
                $receiptNo = sprintf("RCPT-%d-%04d", $year, $pSeq);

                $payStmt = $this->db->prepare("
                    INSERT INTO hf_payments (
                        receipt_no, transaction_id, payment_date, amount_paid,
                        payment_mode, reference_no, remarks, created_by,
                        dr_code, dr_name, cr_code, cr_name,
                        voucher_no, acc_contribution_id,
                        receipt_book_no, manual_receipt_no
                    ) VALUES (
                        :receipt_no, :transaction_id, :payment_date, :amount_paid,
                        :payment_mode, :reference_no, :remarks, :created_by,
                        :dr_code, :dr_name, :cr_code, :cr_name,
                        :voucher_no, :acc_contribution_id,
                        :receipt_book_no, :manual_receipt_no
                    )
                ");
                $payStmt->execute([
                    'receipt_no'          => $receiptNo,
                    'transaction_id'      => $transactionId,
                    'payment_date'        => $auctionDate,
                    'amount_paid'         => $paidAmount,
                    'payment_mode'        => $data['payment_mode'] ?? 'Cash',
                    'reference_no'        => $data['reference_no'] ?? null,
                    'remarks'             => sprintf('Initial payment for Auction %s [%s / %s]', $auctionRefNo, $artTag, $artNo),
                    'created_by'          => $userId,
                    'dr_code'             => $contribDrCode,
                    'dr_name'             => $contribDrName,
                    'cr_code'             => $contribCrCode,
                    'cr_name'             => $contribCrName,
                    'voucher_no'          => $contribVoucherNo,
                    'acc_contribution_id' => $accContribId,
                    'receipt_book_no'     => $receiptBookNo !== '0' ? $receiptBookNo : null,
                    'manual_receipt_no'   => $receiptNoInput !== '0' ? $receiptNoInput : null
                ]);
            }

            // --- 5. Always record promise in hf_promises (mirrors acc_promises for festival ledger) ---
            $promStmt = $this->db->prepare("
                INSERT INTO hf_promises (
                    transaction_id, article_id, applicable_year, member_id,
                    member_name, member_code_c, member_phone,
                    total_promise_amount, paid_amount, balance_amount, due_date, promise_status,
                    acc_promise_id, dr_code, dr_name, cr_code, cr_name, voucher_no,
                    event_id, event_name
                ) VALUES (
                    :transaction_id, :article_id, :applicable_year, :member_id,
                    :member_name, :member_code_c, :member_phone,
                    :total_promise_amount, :paid_amount, :balance_amount, :due_date, :promise_status,
                    :acc_promise_id, :dr_code, :dr_name, :cr_code, :cr_name, :voucher_no,
                    :event_id, :event_name
                )
            ");
            $promStmt->execute([
                'transaction_id'       => $transactionId,
                'article_id'           => $articleId,
                'applicable_year'      => $year,
                'member_id'            => !empty($data['buyer_member_id']) ? (int)$data['buyer_member_id'] : null,
                'member_name'          => trim($data['buyer_name']),
                'member_code_c'        => !empty($data['buyer_code_c']) ? (int)$data['buyer_code_c'] : null,
                'member_phone'         => $data['buyer_phone'] ?? null,
                'total_promise_amount' => $bidAmount, // Winning bid amount
                'paid_amount'          => $paidAmount,
                'balance_amount'       => $balanceAmount, // Winning amount - paid amount
                'due_date'             => !empty($data['due_date']) ? $data['due_date'] : date('Y-m-d', strtotime('+30 days')),
                'promise_status'       => ($balanceAmount <= 0.0001) ? 'Fulfilled' : 'Active',
                'acc_promise_id'       => $accPromiseId,
                'dr_code'              => $promiseDrCode,
                'dr_name'              => $promiseDrName,
                'cr_code'              => $promiseCrCode,
                'cr_name'              => $promiseCrName,
                'voucher_no'           => $promiseVoucherNo,
                'event_id'             => $eventId,
                'event_name'           => $eventName
            ]);

            return [
                'success'             => true,
                'transaction_id'      => $transactionId,
                'auction_ref_no'      => $auctionRefNo,
                'promise_id'          => $accPromiseId,
                'acc_promise_id'      => $accPromiseId,
                'contribution_id'     => $accContribId,
                'acc_contribution_id' => $accContribId,
                'voucher_no'          => $contribVoucherNo ?: $promiseVoucherNo,
                'voucher_number'      => $contribVoucherNo ?: $promiseVoucherNo,
                'contrib_voucher_no'  => $contribVoucherNo,
                'promise_voucher_no'  => $promiseVoucherNo,
                'receipt_no'          => ($receiptNoInput !== '0' && !empty($receiptNoInput)) ? $receiptNoInput : $receiptNo,
                'manual_receipt_no'   => ($receiptNoInput !== '0' && !empty($receiptNoInput)) ? $receiptNoInput : null,
                'receipt_book_no'     => ($receiptBookNo !== '0' && !empty($receiptBookNo)) ? $receiptBookNo : null,
                'payment_status'      => $paymentStatus
            ];
        } catch (\Exception $e) {
            throw $e;
        }
    }

    public function getStats(int $year): array {
        // 1. Article stats
        $artStmt = $this->db->prepare("
            SELECT 
                COUNT(*) as total_articles,
                SUM(CASE WHEN status IN ('Sold', 'Auctioned', 'Delivered') THEN 1 ELSE 0 END) as sold_articles,
                SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) as available_articles,
                COALESCE(SUM(estimated_value), 0) as total_estimated_value
            FROM hf_articles
            WHERE applicable_year = :year
        ");
        $artStmt->execute(['year' => $year]);
        $artStats = $artStmt->fetch() ?: [];

        // 2. Live Floor Auction stats (excluding Gold and Bed Sheet special offerings)
        $liveStmt = $this->db->prepare("
            SELECT 
                COUNT(*) as live_auction_count,
                COALESCE(SUM(t.winning_bid_amount), 0) as live_auction_sales,
                COALESCE(SUM(
                    COALESCE(
                        (SELECT SUM(c.contribution_amount) 
                         FROM acc_contribution c 
                         WHERE c.article_id = t.article_id 
                           AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                        t.paid_amount,
                        0
                    )
                ), 0) as live_auction_collected,
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
                ), 0) as live_auction_pending,
                COUNT(DISTINCT t.buyer_name) as unique_buyers
            FROM hf_auction_transactions t
            WHERE t.applicable_year = :year 
              AND (t.offering_type IS NULL OR t.offering_type NOT IN ('Gold', 'BedSheet'))
        ");
        $liveStmt->execute(['year' => $year]);
        $liveStats = $liveStmt->fetch() ?: [];

        // 3. Special Offerings Stats (Gold and Bed Sheet detailed breakdown)
        $offeringStmt = $this->db->prepare("
            SELECT 
                COUNT(*) as total_offerings,
                COALESCE(SUM(t.winning_bid_amount), 0) as total_offerings_amount,
                COALESCE(SUM(t.paid_amount), 0) as total_offerings_collected,
                COALESCE(SUM(t.balance_amount), 0) as total_offerings_pending,
                
                -- Gold Offerings Breakdown
                COALESCE(SUM(CASE WHEN t.offering_type = 'Gold' THEN 1 ELSE 0 END), 0) as gold_offerings_count,
                COALESCE(SUM(CASE WHEN t.offering_type = 'Gold' THEN t.winning_bid_amount ELSE 0 END), 0) as gold_offerings_amount,
                COALESCE(SUM(CASE WHEN t.offering_type = 'Gold' THEN t.paid_amount ELSE 0 END), 0) as gold_collected_amount,
                COALESCE(SUM(CASE WHEN t.offering_type = 'Gold' THEN t.balance_amount ELSE 0 END), 0) as gold_pending_amount,

                -- Bed Sheet Offerings Breakdown
                COALESCE(SUM(CASE WHEN t.offering_type = 'BedSheet' THEN 1 ELSE 0 END), 0) as bedsheet_offerings_count,
                COALESCE(SUM(CASE WHEN t.offering_type = 'BedSheet' THEN t.winning_bid_amount ELSE 0 END), 0) as bedsheet_offerings_amount,
                COALESCE(SUM(CASE WHEN t.offering_type = 'BedSheet' THEN t.paid_amount ELSE 0 END), 0) as bedsheet_collected_amount,
                COALESCE(SUM(CASE WHEN t.offering_type = 'BedSheet' THEN t.balance_amount ELSE 0 END), 0) as bedsheet_pending_amount
            FROM hf_auction_transactions t
            WHERE t.applicable_year = :year AND t.offering_type IN ('Gold', 'BedSheet')
        ");
        $offeringStmt->execute(['year' => $year]);
        $offeringStats = $offeringStmt->fetch() ?: [];

        // 4. Overall Festival Totals (Live Floor Auction + Special Offerings)
        $grandSales = (float)($liveStats['live_auction_sales'] ?? 0) + (float)($offeringStats['total_offerings_amount'] ?? 0);
        $grandCollected = (float)($liveStats['live_auction_collected'] ?? 0) + (float)($offeringStats['total_offerings_collected'] ?? 0);
        $grandPending = (float)($liveStats['live_auction_pending'] ?? 0) + (float)($offeringStats['total_offerings_pending'] ?? 0);
        $grandCount = (int)($liveStats['live_auction_count'] ?? 0) + (int)($offeringStats['total_offerings'] ?? 0);

        $overallStats = [
            'total_transactions'      => $grandCount,
            'total_auction_sales'     => $grandSales,
            'total_collected'         => $grandCollected,
            'total_pending_promises'  => $grandPending,
            'grand_total_sales'       => $grandSales,
            'grand_total_collected'   => $grandCollected,
            'grand_total_pending'     => $grandPending,
            'grand_total_count'       => $grandCount
        ];

        // 5. Active promises count & balance directly from acc_promises
        $promStmt = $this->db->prepare("
            SELECT 
                COUNT(*) as active_promises_count, 
                COALESCE(SUM(p.balance_amount), 0) as active_promises_balance
            FROM acc_promises p
            JOIN hf_auction_transactions t ON (t.acc_promise_id = p.promise_id OR (p.article_id = t.article_id AND (t.buyer_member_id IS NULL OR p.member_id = t.buyer_member_id)))
            WHERE t.applicable_year = :year AND p.balance_amount > 0 AND p.promise_status = 'Active'
        ");
        $promStmt->execute(['year' => $year]);
        $promStats = $promStmt->fetch() ?: [];

        return array_merge($artStats, $liveStats, $offeringStats, $overallStats, $promStats);
    }
}
