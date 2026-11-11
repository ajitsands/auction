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
        $offeringType = $_GET['offering_type'] ?? null;

        $transactions = $this->auctionModel->getAll($year, $status, $search, $offeringType);
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

        $offeringType = in_array($data['offering_type'] ?? '', ['Gold', 'BedSheet']) ? $data['offering_type'] : 'Auction';
        $isOffering = ($offeringType !== 'Auction');

        if ($isOffering) {
            if (empty($data['item_description']) || empty($data['winning_bid_amount']) || empty($data['buyer_name'])) {
                $this->jsonResponse(['success' => false, 'error' => 'Item Description, Offering Amount, and Devotee Name are required.'], 400);
            }
        } else {
            if (empty($data['article_id']) || empty($data['winning_bid_amount']) || empty($data['buyer_name'])) {
                $this->jsonResponse(['success' => false, 'error' => 'Article, Winning Bid Amount, and Buyer Name are required.'], 400);
            }
        }

        $accountModel = new \App\Models\AccountHead();
        $defaults = $accountModel->getDefaultHeads();
        $isAdmin = ($user['user_type'] ?? '') === 'Administrator';

        if ($offeringType === 'Gold') {
            // Gold Offering: Always post to administrator-configured Gold default ledgers
            $data['contrib_dr_code'] = $defaults['gold_contrib_dr_code'] ?? '02123';
            $data['contrib_dr_name'] = $defaults['gold_contrib_dr_name'] ?? 'Cash on Hand-Harvest Festival';
            $data['contrib_cr_code'] = $defaults['gold_contrib_cr_code'] ?? '07613';
            $data['contrib_cr_name'] = $defaults['gold_contrib_cr_name'] ?? 'Harvest Festival - Gold';

            $data['promise_dr_code'] = $defaults['gold_promise_dr_code'] ?? '07743';
            $data['promise_dr_name'] = $defaults['gold_promise_dr_name'] ?? 'A/R Harvest Festival 2011 - Gold Offer';
            $data['promise_cr_code'] = $defaults['gold_promise_cr_code'] ?? '07637';
            $data['promise_cr_name'] = $defaults['gold_promise_cr_name'] ?? 'Gold not auctioned from Vanchi';
        } elseif ($offeringType === 'BedSheet') {
            // Bed Sheet Offering: Always post to administrator-configured Bed Sheet default ledgers
            $data['contrib_dr_code'] = $defaults['bed_contrib_dr_code'] ?? '02123';
            $data['contrib_dr_name'] = $defaults['bed_contrib_dr_name'] ?? 'Cash on Hand-Harvest Festival';
            $data['contrib_cr_code'] = $defaults['bed_contrib_cr_code'] ?? '07502';
            $data['contrib_cr_name'] = $defaults['bed_contrib_cr_name'] ?? 'Harvest Festival - Bed Sheet';

            $data['promise_dr_code'] = $defaults['bed_promise_dr_code'] ?? '07744';
            $data['promise_dr_name'] = $defaults['bed_promise_dr_name'] ?? 'A/R Harvest Festival 2011 - Bedsheet Offer';
            $data['promise_cr_code'] = $defaults['bed_promise_cr_code'] ?? '07503';
            $data['promise_cr_name'] = $defaults['bed_promise_cr_name'] ?? 'Harvest Festival - Article Auction';
        } else {
            // Live Floor Auction: Non-administrators must use administrator-configured default heads
            if (!$isAdmin) {
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
        }

        if (empty($data['event_id']) && !empty($defaults['event_id'])) {
            $data['event_id'] = $defaults['event_id'];
            $data['event_name'] = $defaults['event_name'];
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

    public function postingDetails(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? ($_GET['id'] ?? 0));
        if ($id <= 0) {
            $this->jsonResponse(['success' => false, 'error' => 'Invalid transaction ID.'], 400);
        }
        $data = $this->auctionModel->getAccountPostingDetails($id);
        if (empty($data)) {
            $this->jsonResponse(['success' => false, 'error' => 'Transaction not found.'], 404);
        }
        $this->jsonResponse(array_merge(['success' => true], $data));
    }

    public function getOfferingItems(): void {
        $this->requireAuth();
        $type = $_GET['offering_type'] ?? null;
        $itemModel = new \App\Models\OfferingItem();
        $items = $itemModel->getAll($type);
        $this->jsonResponse([
            'success' => true,
            'count'   => count($items),
            'items'   => $items
        ]);
    }

    public function addOfferingItem(): void {
        $this->requireAuth();
        $data = $this->getJsonInput();
        $type = trim($data['offering_type'] ?? 'Gold');
        $desc = trim($data['item_description'] ?? $data['description'] ?? '');
        $amount = (float)($data['default_amount'] ?? $data['value_amount'] ?? $data['amount'] ?? 0);

        if ($desc === '') {
            $this->jsonResponse(['success' => false, 'error' => 'Item description is required.'], 400);
        }

        try {
            $itemModel = new \App\Models\OfferingItem();
            $item = $itemModel->add($type, $desc, $amount);
            $items = $itemModel->getAll();
            $this->jsonResponse([
                'success' => true,
                'message' => "Item '{$item['item_description']}' added to {$type} master.",
                'item'    => $item,
                'items'   => $items
            ], 201);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }

    public function updateOfferingItem(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? 0);

        if ($id <= 0) {
            $this->jsonResponse(['success' => false, 'error' => 'Invalid item ID.'], 400);
        }

        $data = $this->getJsonInput();
        try {
            $itemModel = new \App\Models\OfferingItem();
            $item = $itemModel->update($id, $data);
            $items = $itemModel->getAll();
            $this->jsonResponse([
                'success' => true,
                'message' => "Item '{$item['item_description']}' updated successfully.",
                'item'    => $item,
                'items'   => $items
            ]);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }

    public function deleteOfferingItem(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? 0);

        if ($id <= 0) {
            $this->jsonResponse(['success' => false, 'error' => 'Invalid item ID.'], 400);
        }

        try {
            $itemModel = new \App\Models\OfferingItem();
            $itemModel->delete($id);
            $items = $itemModel->getAll();
            $this->jsonResponse([
                'success' => true,
                'message' => 'Item description deleted successfully.',
                'items'   => $items
            ]);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }
}
