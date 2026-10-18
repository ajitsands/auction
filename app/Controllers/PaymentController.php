<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\Payment;

class PaymentController extends Controller {
    private Payment $paymentModel;

    public function __construct() {
        $this->paymentModel = new Payment();
    }

    public function store(): void {
        $user = $this->requireAuth();
        $data = $this->getJsonInput();

        if (empty($data['transaction_id']) || empty($data['amount_paid'])) {
            $this->jsonResponse(['success' => false, 'error' => 'Transaction ID and Amount Paid are required.'], 400);
        }

        try {
            $result = $this->paymentModel->recordPayment($data, $user['user_id']);
            $this->jsonResponse([
                'success' => true,
                'message' => "Payment of BHD {$result['amount_paid']} recorded. Receipt: {$result['receipt_no']}",
                'data'    => $result
            ], 201);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }

    public function byTransaction(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? 0);
        $payments = $this->paymentModel->getByTransaction($id);
        $this->jsonResponse(['success' => true, 'payments' => $payments]);
    }

    public function receipt(array $params): void {
        $this->requireAuth();
        $receiptNo = $params['receiptNo'] ?? '';
        $receipt = $this->paymentModel->getReceiptDetails($receiptNo);
        if (!$receipt) {
            $this->jsonResponse(['success' => false, 'error' => 'Receipt not found.'], 404);
        }
        $this->jsonResponse(['success' => true, 'receipt' => $receipt]);
    }
}
