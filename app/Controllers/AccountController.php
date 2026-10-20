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

    public function getDefaultHeads(): void {
        $this->requireAuth();
        $this->jsonResponse([
            'success'       => true,
            'default_heads' => $this->accountModel->getDefaultHeads(),
        ]);
    }

    public function saveDefaultHeads(): void {
        $user = $this->requireAuth();
        if (($user['user_type'] ?? '') !== 'Administrator') {
            $this->jsonResponse(['success' => false, 'error' => 'Access denied. Administrator privileges are required to configure default posting heads.'], 403);
        }

        $input = $this->getJsonInput();
        $saved = $this->accountModel->saveDefaultHeads($input);
        $this->jsonResponse([
            'success'       => $saved,
            'message'       => 'Default Live Auction posting heads saved successfully!',
            'default_heads' => $this->accountModel->getDefaultHeads(),
        ]);
    }
}
