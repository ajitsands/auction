<?php
namespace App\Models;

use App\Core\Model;
use PDO;

class Payment extends Model {
    public function getByTransaction(int $transactionId): array {
        $stmt = $this->db->prepare("
            SELECT p.*, u.user_name as recorded_by
            FROM hf_payments p
            LEFT JOIN tbl_users u ON p.created_by = u.user_id
            WHERE p.transaction_id = :id
            ORDER BY p.payment_id ASC
        ");
        $stmt->execute(['id' => $transactionId]);
        return $stmt->fetchAll();
    }

    public function recordPayment(array $data, int $userId): array {
        try {
            $transactionId = (int)$data['transaction_id'];
            $amount = (float)$data['amount_paid'];
            if ($amount <= 0) {
                throw new \Exception("Payment amount must be greater than zero.");
            }

            // Fetch transaction
            $tStmt = $this->db->prepare("
                SELECT t.*, a.article_number, a.tag_number, a.article_name, a.category, a.donor_name, a.estimated_value 
                FROM hf_auction_transactions t
                JOIN hf_articles a ON t.article_id = a.article_id
                WHERE t.transaction_id = :id
            ");
            $tStmt->execute(['id' => $transactionId]);
            $trans = $tStmt->fetch();
            if (!$trans) {
                throw new \Exception("Auction transaction not found.");
            }

            $currentBalance = (float)$trans['balance_amount'];
            if ($amount > ($currentBalance + 0.0001)) {
                throw new \Exception("Payment amount ({$amount}) exceeds outstanding balance ({$currentBalance}).");
            }

            $newPaid = (float)$trans['paid_amount'] + $amount;
            $newBalance = max(0, (float)$trans['winning_bid_amount'] - $newPaid);
            $newStatus = ($newBalance <= 0) ? 'Paid' : 'Partial';

            // Pre-fetch associated promise from hf_promises or hf_auction_transactions
            $prStmt = $this->db->prepare("
                SELECT hf_promise_id, paid_amount, balance_amount, total_promise_amount, acc_promise_id, voucher_no 
                FROM hf_promises 
                WHERE transaction_id = :tid 
                LIMIT 1
            ");
            $prStmt->execute(['tid' => $transactionId]);
            $prom = $prStmt->fetch();

            $targetAccPromiseId = !empty($trans['acc_promise_id']) 
                ? (int)$trans['acc_promise_id'] 
                : (!empty($prom['acc_promise_id']) ? (int)$prom['acc_promise_id'] : 0);

            // Generate receipt no
            $year = (int)$trans['applicable_year'];
            $payCount = $this->db->prepare("SELECT COUNT(*) FROM hf_payments");
            $payCount->execute();
            $pSeq = $payCount->fetchColumn() + 1;
            $receiptNo = sprintf("RCPT-%d-%04d", $year, $pSeq);
            $paymentDate = !empty($data['payment_date']) ? $data['payment_date'] : date('Y-m-d');

            // Determine member code_m
            $memberCodeM = 0;
            if (!empty($trans['buyer_member_id'])) {
                $mStmt = $this->db->prepare("SELECT code_m FROM tbl_primary_member WHERE primary_member_id = :id");
                $mStmt->execute(['id' => (int)$trans['buyer_member_id']]);
                $memberCodeM = (int)($mStmt->fetchColumn() ?: 0);
            }

            // --- Post Contribution Entry to Accounts as per acc_member_contribution_batch_hf.php ---
            $contribVoucherNo = null;
            $accContribId = null;

            $drCode = !empty($data['dr_code']) ? trim($data['dr_code']) : (!empty($trans['contrib_dr_code']) ? $trans['contrib_dr_code'] : '02123');
            $drName = !empty($data['dr_name']) ? trim($data['dr_name']) : (!empty($trans['contrib_dr_name']) ? $trans['contrib_dr_name'] : 'Cash on Hand-Harvest Festival');
            $crCode = !empty($data['cr_code']) ? trim($data['cr_code']) : (!empty($trans['contrib_cr_code']) ? $trans['contrib_cr_code'] : '02206');
            $crName = !empty($data['cr_name']) ? trim($data['cr_name']) : (!empty($trans['contrib_cr_name']) ? $trans['contrib_cr_name'] : 'Church Building Fund - Harvest Festival');

            $eventId = !empty($data['event_id']) ? (int)$data['event_id'] : (!empty($trans['event_id']) ? (int)$trans['event_id'] : 10);
            $eventName = !empty($data['event_name']) ? trim($data['event_name']) : (!empty($trans['event_name']) ? $trans['event_name'] : ('Budget ' . $year));

            $receiptBookNo = !empty($data['receipt_book_no']) ? trim($data['receipt_book_no']) : (!empty($trans['receipt_book_no']) ? $trans['receipt_book_no'] : '0');
            $manualReceiptNo = !empty($data['manual_receipt_no']) ? trim($data['manual_receipt_no']) : (!empty($data['receipt_no']) ? trim($data['receipt_no']) : (!empty($trans['manual_receipt_no']) ? $trans['manual_receipt_no'] : '0'));
            $effectiveReceiptNo = ($manualReceiptNo !== '0' && !empty($manualReceiptNo)) ? $manualReceiptNo : $receiptNo;

            if (!empty($drCode) && !empty($crCode)) {
                $artTag = !empty($trans['tag_number']) ? $trans['tag_number'] : ('#' . $trans['article_id']);
                $artNo = !empty($trans['article_number']) ? $trans['article_number'] : ('ART-' . $trans['article_id']);
                $artName = !empty($trans['article_name']) ? $trans['article_name'] : 'Article';
                $artCategory = !empty($trans['category']) ? $trans['category'] : 'Auction';
                $artDonor = !empty($trans['donor_name']) ? $trans['donor_name'] : 'Church';
                $artEstValue = isset($trans['estimated_value']) ? number_format((float)$trans['estimated_value'], 3) : '0.000';
                $articleDetails = sprintf("Tag: %s | Art No: %s | %s | Cat: %s | Donor: %s | Est: %s BHD", $artTag, $artNo, $artName, $artCategory, $artDonor, $artEstValue);

                $cNarration = sprintf(
                    "Auction Payment: [%s / %s] %s * %s * %s",
                    $artTag,
                    $artNo,
                    $artName,
                    $trans['auction_ref_no'],
                    trim($trans['buyer_name'])
                );
                if (!empty($trans['buyer_code_c'])) {
                    $cNarration .= " (Roll: " . $trans['buyer_code_c'] . ")";
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
                    'contrib_date'     => $paymentDate,
                    'contrib_year'     => (int)$year,
                    'member_id'        => !empty($trans['buyer_member_id']) ? (int)$trans['buyer_member_id'] : 0,
                    'member_ccode'     => !empty($trans['buyer_code_c']) ? (int)$trans['buyer_code_c'] : 0,
                    'member_mcode'     => $memberCodeM,
                    'member_name'      => trim($trans['buyer_name']),
                    'narration'        => $cNarration,
                    'cr_code'          => $crCode,
                    'cr_name'          => $crName,
                    'dr_code'          => $drCode,
                    'dr_name'          => $drName,
                    'amount'           => $amount,
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
                    $updC = $this->db->prepare("
                        UPDATE acc_contribution 
                        SET article_id = :art_id,
                            promise_id = :promise_id,
                            item_description = :art_details,
                            narration = :narration,
                            manual_book_no = :bno,
                            manual_receipt_no = :rno
                        WHERE contribution_id = :cid
                    ");
                    $updC->execute([
                        'art_id'      => (int)$trans['article_id'],
                        'promise_id'  => $targetAccPromiseId,
                        'art_details' => $articleDetails,
                        'narration'   => $cNarration,
                        'bno'         => $receiptBookNo,
                        'rno'         => $effectiveReceiptNo,
                        'cid'         => $accContribId
                    ]);

                    // Connect article_id, promise_id, and narration directly in acc_ledger_entries
                    $updLE = $this->db->prepare("
                        UPDATE acc_ledger_entries 
                        SET article_id = :art_id,
                            promise_id = :promise_id,
                            narration = :narration
                        WHERE contribution_id = :cid AND entry_type = 'HRCPT'
                    ");
                    $updLE->execute([
                        'art_id'     => (int)$trans['article_id'],
                        'promise_id' => $targetAccPromiseId,
                        'narration'  => $cNarration,
                        'cid'        => $accContribId
                    ]);
                } else {
                    throw new \Exception("Contribution batch posting failed: " . ($cRes['msg'] ?? 'Unknown error'));
                }
            }

            // Insert payment in hf_payments
            $pStmt = $this->db->prepare("
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
            $pStmt->execute([
                'receipt_no'          => $receiptNo,
                'transaction_id'      => $transactionId,
                'payment_date'        => $paymentDate,
                'amount_paid'         => $amount,
                'payment_mode'        => $data['payment_mode'] ?? 'Cash',
                'reference_no'        => $data['reference_no'] ?? null,
                'remarks'             => $data['remarks'] ?? sprintf('Installment settlement for %s [%s / %s]', $trans['auction_ref_no'], $artTag, $artNo),
                'created_by'          => $userId,
                'dr_code'             => $drCode,
                'dr_name'             => $drName,
                'cr_code'             => $crCode,
                'cr_name'             => $crName,
                'voucher_no'          => $contribVoucherNo,
                'acc_contribution_id' => $accContribId,
                'receipt_book_no'     => $receiptBookNo !== '0' ? $receiptBookNo : null,
                'manual_receipt_no'   => $manualReceiptNo !== '0' ? $manualReceiptNo : null
            ]);

            // Update transaction
            $uStmt = $this->db->prepare("
                UPDATE hf_auction_transactions SET
                    paid_amount    = :paid,
                    balance_amount = :bal,
                    payment_status = :status
                WHERE transaction_id = :id
            ");
            $uStmt->execute([
                'paid'   => $newPaid,
                'bal'    => $newBalance,
                'status' => $newStatus,
                'id'     => $transactionId
            ]);

            // Update Promise in hf_promises and acc_promises if one exists
            if ($prom) {
                $pNewPaid = (float)$prom['paid_amount'] + $amount;
                $pNewBal = max(0, (float)$prom['total_promise_amount'] - $pNewPaid);
                $pStatus = ($pNewBal <= 0) ? 'Fulfilled' : 'Active';

                $uPr = $this->db->prepare("
                    UPDATE hf_promises SET
                        paid_amount    = :paid,
                        balance_amount = :bal,
                        promise_status = :status
                    WHERE hf_promise_id = :pid
                ");
                $uPr->execute([
                    'paid'   => $pNewPaid,
                    'bal'    => $pNewBal,
                    'status' => $pStatus,
                    'pid'    => $prom['hf_promise_id']
                ]);
            }

            // Update core acc_promises balance and last payment date
            if ($targetAccPromiseId > 0) {
                $uAccP = $this->db->prepare("
                    UPDATE acc_promises SET
                        balance_amount    = GREATEST(0, balance_amount - :paid),
                        last_payment_date = :pdate,
                        modified_date     = :mdate,
                        modified_id       = :uid,
                        promise_status    = CASE WHEN balance_amount - :paid2 <= 0 THEN 'Received' ELSE 'Active' END
                    WHERE promise_id = :pid
                ");
                $uAccP->execute([
                    'paid'  => $amount,
                    'pdate' => $paymentDate,
                    'mdate' => date('Y-m-d'),
                    'uid'   => $userId,
                    'paid2' => $amount,
                    'pid'   => $targetAccPromiseId
                ]);
            }

            // If fully paid, mark article as 'Sold'
            if ($newStatus === 'Paid') {
                $uArt = $this->db->prepare("UPDATE hf_articles SET status = 'Sold' WHERE article_id = :id");
                $uArt->execute(['id' => $trans['article_id']]);
            }

            return [
                'success'             => true,
                'receipt_no'          => ($manualReceiptNo !== '0' && !empty($manualReceiptNo)) ? $manualReceiptNo : $receiptNo,
                'manual_receipt_no'   => ($manualReceiptNo !== '0' && !empty($manualReceiptNo)) ? $manualReceiptNo : null,
                'receipt_book_no'     => ($receiptBookNo !== '0' && !empty($receiptBookNo)) ? $receiptBookNo : null,
                'amount_paid'         => $amount,
                'new_balance'         => $newBalance,
                'payment_status'      => $newStatus,
                'voucher_no'          => $contribVoucherNo,
                'voucher_number'      => $contribVoucherNo,
                'contrib_voucher_no'  => $contribVoucherNo,
                'contribution_id'     => $accContribId,
                'acc_contribution_id' => $accContribId,
                'promise_id'          => $targetAccPromiseId ?: null
            ];
        } catch (\Exception $e) {
            throw $e;
        }
    }

    public function getReceiptDetails(string $receiptNo): ?array {
        $cleanNo = trim($receiptNo);
        if ($cleanNo === '') return null;

        // 1. Try matching hf_payments by receipt_no, manual_receipt_no, voucher_no, acc_contribution_id
        $stmt = $this->db->prepare("
            SELECT p.*, 
                   t.auction_ref_no, t.auction_date, t.winning_bid_amount, 
                   COALESCE(
                       (SELECT SUM(c.contribution_amount) 
                        FROM acc_contribution c 
                        WHERE c.article_id = t.article_id 
                          AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                       t.paid_amount,
                       0
                   ) as total_transaction_paid,
                   CASE 
                       WHEN EXISTS (
                           SELECT 1 FROM acc_promises p_acc 
                           WHERE (t.acc_promise_id IS NOT NULL AND p_acc.promise_id = t.acc_promise_id) 
                              OR (p_acc.article_id = t.article_id AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR p_acc.member_id = t.buyer_member_id))
                       ) THEN (
                           SELECT p_acc.balance_amount FROM acc_promises p_acc 
                           WHERE (t.acc_promise_id IS NOT NULL AND p_acc.promise_id = t.acc_promise_id) 
                              OR (p_acc.article_id = t.article_id AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR p_acc.member_id = t.buyer_member_id))
                           ORDER BY p_acc.promise_id DESC LIMIT 1
                       )
                       ELSE GREATEST(0, t.winning_bid_amount - COALESCE(
                           (SELECT SUM(c.contribution_amount) 
                            FROM acc_contribution c 
                            WHERE c.article_id = t.article_id 
                              AND (t.buyer_member_id IS NULL OR t.buyer_member_id = 0 OR c.member_id = t.buyer_member_id)),
                           t.paid_amount,
                           0
                       ))
                   END as total_transaction_balance,
                   t.buyer_name, t.buyer_code_c, 
                   COALESCE(NULLIF(t.buyer_phone, ''), m.bahrain_contact_no) as buyer_phone,
                   t.contrib_voucher_no as initial_contrib_voucher, t.promise_voucher_no as initial_promise_voucher,
                   t.acc_contribution_id as initial_acc_contrib_id, t.acc_promise_id as initial_acc_promise_id,
                   a.article_number, a.tag_number, a.article_name, a.category, a.applicable_year,
                   m.cpr_no as buyer_cpr, m.prayer_group_name as buyer_prayer_group,
                   u.user_name as cashier_name
            FROM hf_payments p
            JOIN hf_auction_transactions t ON p.transaction_id = t.transaction_id
            JOIN hf_articles a ON t.article_id = a.article_id
            LEFT JOIN tbl_primary_member m ON t.buyer_member_id = m.primary_member_id
            LEFT JOIN tbl_users u ON p.created_by = u.user_id
            WHERE p.receipt_no = :rno 
               OR (p.manual_receipt_no = :rno_manual AND p.manual_receipt_no IS NOT NULL AND p.manual_receipt_no != '0' AND p.manual_receipt_no != '')
               OR CAST(p.voucher_no AS CHAR) = :rno_vno
               OR CAST(p.acc_contribution_id AS CHAR) = :rno_cid
               OR CAST(t.contrib_voucher_no AS CHAR) = :rno_tvno
               OR CAST(t.acc_contribution_id AS CHAR) = :rno_tcid
            ORDER BY p.payment_id DESC
            LIMIT 1
        ");
        $stmt->execute([
            'rno'        => $cleanNo, 
            'rno_manual' => $cleanNo,
            'rno_vno'    => $cleanNo,
            'rno_cid'    => $cleanNo,
            'rno_tvno'   => $cleanNo,
            'rno_tcid'   => $cleanNo
        ]);
        $row = $stmt->fetch();
        if ($row) return $row;

        // 2. Fallback directly to acc_contribution if no hf_payments row exists
        $stmtAcc = $this->db->prepare("
            SELECT 
                c.contribution_id as payment_id,
                COALESCE(NULLIF(p.receipt_no, ''), CONCAT('HRCPT-', c.voucher_ref_no)) as receipt_no,
                COALESCE(t.transaction_id, 0) as transaction_id,
                c.contribution_date as payment_date,
                c.contribution_amount as amount_paid,
                'Cash' as payment_mode,
                c.voucher_ref_no as voucher_no,
                c.contribution_id as acc_contribution_id,
                c.manual_book_no as receipt_book_no,
                c.manual_receipt_no,
                c.dr_code, c.dr_name, c.cr_code, c.cr_name,
                COALESCE(t.auction_ref_no, CONCAT('AUC-', a.applicable_year, '-', LPAD(c.article_id, 4, '0'))) as auction_ref_no,
                COALESCE(t.auction_date, c.contribution_date) as auction_date,
                COALESCE(t.winning_bid_amount, c.contribution_amount) as winning_bid_amount,
                COALESCE(
                    (SELECT SUM(c2.contribution_amount) 
                     FROM acc_contribution c2 
                     WHERE c2.article_id = c.article_id 
                       AND (c.member_id IS NULL OR c.member_id = 0 OR c2.member_id = c.member_id)),
                    c.contribution_amount
                ) as total_transaction_paid,
                CASE 
                    WHEN EXISTS (
                        SELECT 1 FROM acc_promises p_acc 
                        WHERE p_acc.article_id = c.article_id AND (c.member_id IS NULL OR c.member_id = 0 OR p_acc.member_id = c.member_id)
                    ) THEN (
                        SELECT p_acc.balance_amount FROM acc_promises p_acc 
                        WHERE p_acc.article_id = c.article_id AND (c.member_id IS NULL OR c.member_id = 0 OR p_acc.member_id = c.member_id)
                        ORDER BY p_acc.promise_id DESC LIMIT 1
                    )
                    ELSE GREATEST(0, COALESCE(t.winning_bid_amount, c.contribution_amount) - c.contribution_amount)
                END as total_transaction_balance,
                COALESCE(NULLIF(t.buyer_name, ''), c.member_name) as buyer_name,
                COALESCE(t.buyer_code_c, c.member_ccode) as buyer_code_c,
                COALESCE(NULLIF(t.buyer_phone, ''), m.bahrain_contact_no) as buyer_phone,
                c.voucher_ref_no as initial_contrib_voucher,
                t.promise_voucher_no as initial_promise_voucher,
                c.contribution_id as initial_acc_contrib_id,
                t.acc_promise_id as initial_acc_promise_id,
                a.article_number, a.tag_number, a.article_name, a.category, a.applicable_year,
                m.cpr_no as buyer_cpr, m.prayer_group_name as buyer_prayer_group,
                'Cathedral Accounts' as cashier_name
            FROM acc_contribution c
            LEFT JOIN hf_auction_transactions t ON (c.article_id = t.article_id AND (t.buyer_member_id = c.member_id OR t.buyer_member_id IS NULL OR t.buyer_member_id = 0))
            LEFT JOIN hf_articles a ON c.article_id = a.article_id
            LEFT JOIN tbl_primary_member m ON c.member_id = m.primary_member_id
            LEFT JOIN hf_payments p ON (p.acc_contribution_id = c.contribution_id OR p.voucher_no = c.voucher_ref_no)
            WHERE CAST(c.voucher_ref_no AS CHAR) = :rno_vno 
               OR CAST(c.contribution_id AS CHAR) = :rno_cid
               OR (c.manual_receipt_no = :rno_manual AND c.manual_receipt_no IS NOT NULL AND c.manual_receipt_no != '0')
            ORDER BY c.contribution_id DESC
            LIMIT 1
        ");
        $stmtAcc->execute([
            'rno_vno'    => $cleanNo,
            'rno_cid'    => $cleanNo,
            'rno_manual' => $cleanNo
        ]);
        $rowAcc = $stmtAcc->fetch();
        return $rowAcc ?: null;
    }
}
