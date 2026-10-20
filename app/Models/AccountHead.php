<?php
namespace App\Models;

use App\Core\Model;
use PDO;

class AccountHead extends Model {
    /**
     * Get contribution debit heads as defined in acc_member_contribution_batch_hf.php
     */
    public function getContributionDebitHeads(): array {
        $sql = "
            SELECT head_id, head_code, REPLACE(head_name, '\\'', '') as head_name 
            FROM acc_heads 
            WHERE head_type = 'L' 
              AND entry_status = 'Yes' 
              AND main_group = 'A' 
              AND head_status = 'Active' 
              AND group_id IN (210, 212) 
              AND head_code IN (SELECT head_code FROM acc_parallel_sur_defi_heads)
            ORDER BY head_name ASC
        ";
        return $this->db->query($sql)->fetchAll();
    }

    /**
     * Get contribution credit heads as defined in acc_member_contribution_batch_hf.php
     * including heads under group_id = 214 (Receivables & Harvest Festival heads)
     */
    public function getContributionCreditHeads(): array {
        $sql = "
            SELECT DISTINCT head_id, head_code, REPLACE(head_name, '\\'', '') as head_name 
            FROM acc_heads 
            WHERE head_type = 'L' 
              AND entry_status = 'Yes' 
              AND head_status = 'Active' 
              AND (
                  (
                      main_group IN ('I', 'L') 
                      AND head_code NOT IN ('07101', 'AccCo') 
                      AND group_id NOT IN (241, 233, 259) 
                      AND main_ledger_code NOT IN ('07773', '07774', '07618') 
                      AND head_code IN (SELECT head_code FROM acc_parallel_sur_defi_heads)
                  )
                  OR 
                  (
                      group_id = 214
                  )
              )
            ORDER BY head_name ASC
        ";
        return $this->db->query($sql)->fetchAll();
    }

    /**
     * Get promise debit heads as defined in acc_member_receivables_v1.php
     */
    public function getPromiseDebitHeads(): array {
        $sql = "
            SELECT head_id, head_code, REPLACE(head_name, '\\'', '') as head_name 
            FROM acc_heads 
            WHERE head_type = 'L' 
              AND entry_status = 'Yes' 
              AND main_group IN ('A', 'E') 
              AND head_status = 'Active' 
              AND group_id NOT IN (241, 233, 259) 
              AND main_ledger_code NOT IN ('07773', '07774', '07618') 
              AND head_code NOT IN ('AccCo')
            ORDER BY head_name ASC
        ";
        return $this->db->query($sql)->fetchAll();
    }

    /**
     * Get promise credit heads as defined in acc_member_receivables_v1.php
     */
    public function getPromiseCreditHeads(): array {
        $sql = "
            SELECT head_id, head_code, REPLACE(head_name, '\\'', '') as head_name 
            FROM acc_heads 
            WHERE head_type = 'L' 
              AND entry_status = 'Yes' 
              AND main_group IN ('I', 'L') 
              AND head_status = 'Active' 
              AND head_code NOT IN ('07101', 'AccCo') 
              AND group_id NOT IN (241, 233, 259) 
              AND main_ledger_code NOT IN ('07773', '07774', '07618')
            ORDER BY head_name ASC
        ";
        return $this->db->query($sql)->fetchAll();
    }

    /**
     * Get active budget events
     */
    public function getActiveEvents(): array {
        $sql = "
            SELECT event_id, REPLACE(event_name, '\\'', '') as event_name, default_status 
            FROM acc_events 
            WHERE event_status = 'Active' 
            ORDER BY event_id DESC
        ";
        return $this->db->query($sql)->fetchAll();
    }

    /**
     * Get default auction posting heads configured by Administrator
     */
    public function getDefaultHeads(): array {
        $this->ensureSettingsTable();
        try {
            $stmt = $this->db->prepare("SELECT setting_value FROM hf_settings WHERE setting_key = 'auction_default_heads'");
            $stmt->execute();
            $val = $stmt->fetchColumn();
            if ($val) {
                $decoded = json_decode($val, true);
                if (is_array($decoded)) {
                    return $decoded;
                }
            }
        } catch (\Throwable $e) {}

        // Fallback standard default heads if none configured yet
        return [
            'event_id'         => null,
            'event_name'       => null,
            'contrib_dr_code'  => '02123',
            'contrib_dr_name'  => 'Cash on Hand-Harvest Festival',
            'contrib_cr_code'  => '02206',
            'contrib_cr_name'  => 'Church Building Fund - Harvest Festival',
            'promise_dr_code'  => '08583',
            'promise_dr_name'  => 'Harvest Festival Auction Receivable',
            'promise_cr_code'  => '07503',
            'promise_cr_name'  => 'Harvest Festival - Article Auction'
        ];
    }

    /**
     * Save default auction posting heads (Administrator only)
     */
    public function saveDefaultHeads(array $settings): bool {
        $this->ensureSettingsTable();
        $payload = [
            'event_id'         => !empty($settings['event_id']) ? (int)$settings['event_id'] : null,
            'event_name'       => !empty($settings['event_name']) ? trim($settings['event_name']) : null,
            'contrib_dr_code'  => !empty($settings['contrib_dr_code']) ? trim($settings['contrib_dr_code']) : '02123',
            'contrib_dr_name'  => !empty($settings['contrib_dr_name']) ? trim($settings['contrib_dr_name']) : 'Cash on Hand-Harvest Festival',
            'contrib_cr_code'  => !empty($settings['contrib_cr_code']) ? trim($settings['contrib_cr_code']) : '02206',
            'contrib_cr_name'  => !empty($settings['contrib_cr_name']) ? trim($settings['contrib_cr_name']) : 'Church Building Fund - Harvest Festival',
            'promise_dr_code'  => !empty($settings['promise_dr_code']) ? trim($settings['promise_dr_code']) : '08583',
            'promise_dr_name'  => !empty($settings['promise_dr_name']) ? trim($settings['promise_dr_name']) : 'Harvest Festival Auction Receivable',
            'promise_cr_code'  => !empty($settings['promise_cr_code']) ? trim($settings['promise_cr_code']) : '07503',
            'promise_cr_name'  => !empty($settings['promise_cr_name']) ? trim($settings['promise_cr_name']) : 'Harvest Festival - Article Auction',
            'updated_at'       => date('Y-m-d H:i:s')
        ];

        $json = json_encode($payload);
        $stmt = $this->db->prepare("
            INSERT INTO hf_settings (setting_key, setting_value, updated_at)
            VALUES ('auction_default_heads', :val, NOW())
            ON DUPLICATE KEY UPDATE setting_value = :val2, updated_at = NOW()
        ");
        return $stmt->execute(['val' => $json, 'val2' => $json]);
    }

    /**
     * Get all heads and active events for client-side caching & selection
     */
    public function getAllHeadsAndEvents(): array {
        return [
            'contribution_debit_heads'  => $this->getContributionDebitHeads(),
            'contribution_credit_heads' => $this->getContributionCreditHeads(),
            'promise_debit_heads'       => $this->getPromiseDebitHeads(),
            'promise_credit_heads'      => $this->getPromiseCreditHeads(),
            'events'                    => $this->getActiveEvents(),
            'default_heads'             => $this->getDefaultHeads(),
        ];
    }
}
