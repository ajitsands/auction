<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\Member;

class MemberController extends Controller {
    private Member $memberModel;

    public function __construct() {
        $this->memberModel = new Member();
    }

    public function search(): void {
        $this->requireAuth();
        $query = $_GET['q'] ?? '';
        $members = $this->memberModel->search($query);
        $this->jsonResponse(['success' => true, 'members' => $members]);
    }

    public function outstanding(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? 0);
        $member = $this->memberModel->findById($id);
        if (!$member) {
            $this->jsonResponse(['success' => false, 'error' => 'Member not found.'], 404);
        }

        $paymentModel = new \App\Models\Payment();
        $balance = $paymentModel->getMemberOutstandingBalance(
            !empty($member['code_c']) ? (int)$member['code_c'] : null,
            $id
        );

        $this->jsonResponse([
            'success'             => true,
            'primary_member_id'   => $id,
            'code_c'              => $member['code_c'],
            'primary_member_name' => $member['primary_member_name'],
            'outstanding_balance' => $balance
        ]);
    }
}
