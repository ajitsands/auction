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
     */
    public function getContributionCreditHeads(): array {
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
              AND head_code IN (SELECT head_code FROM acc_parallel_sur_defi_heads)
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
     * Get all heads and active events for client-side caching & selection
     */
    public function getAllHeadsAndEvents(): array {
        return [
            'contribution_debit_heads'  => $this->getContributionDebitHeads(),
            'contribution_credit_heads' => $this->getContributionCreditHeads(),
            'promise_debit_heads'       => $this->getPromiseDebitHeads(),
            'promise_credit_heads'      => $this->getPromiseCreditHeads(),
            'events'                    => $this->getActiveEvents(),
        ];
    }
}
