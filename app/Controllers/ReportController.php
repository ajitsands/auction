<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\Report;

class ReportController extends Controller {
    private Report $reportModel;

    public function __construct() {
        $this->reportModel = new Report();
    }

    public function summary(): void {
        $this->requireAuth();
        $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
        $summary = $this->reportModel->getYearlySummary($year);
        $this->jsonResponse(['success' => true, 'year' => $year, 'summary' => $summary]);
    }

    public function buyers(): void {
        $this->requireAuth();
        $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
        $buyers = $this->reportModel->getBuyerSummaryReport($year);
        $this->jsonResponse(['success' => true, 'year' => $year, 'buyers' => $buyers]);
    }
}
