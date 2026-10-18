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
}
