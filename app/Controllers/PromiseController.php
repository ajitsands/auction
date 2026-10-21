<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\Promise;

class PromiseController extends Controller {
    private Promise $promiseModel;

    public function __construct() {
        $this->promiseModel = new Promise();
    }

    public function index(): void {
        $this->requireAuth();
        $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
        $status = $_GET['status'] ?? null;
        $search = $_GET['search'] ?? null;
        $stream = $_GET['stream'] ?? $_GET['offering_type'] ?? 'All';

        $promises = $this->promiseModel->getAll($year, $status, $search, $stream);
        $summary = $this->promiseModel->getStreamSummary($year);

        $this->jsonResponse([
            'success'  => true,
            'year'     => $year,
            'stream'   => $stream,
            'count'    => count($promises),
            'summary'  => $summary,
            'promises' => $promises
        ]);
    }
}
