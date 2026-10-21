<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\Auction;

class AuctionController extends Controller {
    private Auction $auctionModel;

    public function __construct() {
        $this->auctionModel = new Auction();
    }

    public function index(): void {
        $this->requireAuth();
        $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
        $status = $_GET['status'] ?? null;
        $search = $_GET['search'] ?? null;

        $transactions = $this->auctionModel->getAll($year, $status, $search);
        $this->jsonResponse([
            'success'         => true,
            'year'            => $year,
            'count'           => count($transactions),
            'server_time'     => date('c'),
            'server_timezone' => 'Asia/Bahrain',
            'transactions'    => $transactions
        ]);
    }

    public function store(): void {
        $user = $this->requireAuth();
        $data = $this->getJsonInput();

        if (empty($data['article_id']) || empty($data['winning_bid_amount']) || empty($data['buyer_name'])) {
            $this->jsonResponse(['success' => false, 'error' => 'Article, Winning Bid Amount, and Buyer Name are required.'], 400);
        }

        // Non-administrators must use administrator-configured default posting heads
        $isAdmin = ($user['user_type'] ?? '') === 'Administrator';
        if (!$isAdmin) {
            $accountModel = new \App\Models\AccountHead();
            $defaults = $accountModel->getDefaultHeads();

            if (!empty($defaults['event_id'])) {
                $data['event_id'] = $defaults['event_id'];
                $data['event_name'] = $defaults['event_name'];
            }
            if (!empty($defaults['contrib_dr_code'])) {
                $data['contrib_dr_code'] = $defaults['contrib_dr_code'];
                $data['contrib_dr_name'] = $defaults['contrib_dr_name'];
            }
            if (!empty($defaults['contrib_cr_code'])) {
                $data['contrib_cr_code'] = $defaults['contrib_cr_code'];
                $data['contrib_cr_name'] = $defaults['contrib_cr_name'];
            }
            if (!empty($defaults['promise_dr_code'])) {
                $data['promise_dr_code'] = $defaults['promise_dr_code'];
                $data['promise_dr_name'] = $defaults['promise_dr_name'];
            }
            if (!empty($defaults['promise_cr_code'])) {
                $data['promise_cr_code'] = $defaults['promise_cr_code'];
                $data['promise_cr_name'] = $defaults['promise_cr_name'];
            }
        }

        try {
            $result = $this->auctionModel->recordAuction($data, $user['user_id']);
            $this->jsonResponse([
                'success' => true,
                'message' => 'Auction sale recorded successfully!',
                'data'    => $result
            ], 201);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }

    public function stats(): void {
        $this->requireAuth();
        $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
        $stats = $this->auctionModel->getStats($year);
        $this->jsonResponse([
            'success' => true,
            'year'    => $year,
            'stats'   => $stats
        ]);
    }
}
