<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\AccountHead;

class AccountController extends Controller {
    private AccountHead $accountModel;

    public function __construct() {
        $this->accountModel = new AccountHead();
    }

    public function heads(): void {
        $this->requireAuth();
        $data = $this->accountModel->getAllHeadsAndEvents();
        $this->jsonResponse(array_merge(['success' => true], $data));
    }

    public function contributionHeads(): void {
        $this->requireAuth();
        $this->jsonResponse([
            'success'      => true,
            'debit_heads'  => $this->accountModel->getContributionDebitHeads(),
            'credit_heads' => $this->accountModel->getContributionCreditHeads(),
        ]);
    }

    public function promiseHeads(): void {
        $this->requireAuth();
        $this->jsonResponse([
            'success'      => true,
            'debit_heads'  => $this->accountModel->getPromiseDebitHeads(),
            'credit_heads' => $this->accountModel->getPromiseCreditHeads(),
        ]);
    }

    public function events(): void {
        $this->requireAuth();
        $this->jsonResponse([
            'success' => true,
            'events'  => $this->accountModel->getActiveEvents(),
        ]);
    }
}
