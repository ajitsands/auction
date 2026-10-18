<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\Article;

class ExcelImportController extends Controller {
    private Article $articleModel;

    public function __construct() {
        $this->articleModel = new Article();
    }

    public function template(): void {
        $year = (int)date('Y');
        $filename = "article_import_template_{$year}.csv";
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');

        $output = fopen('php://output', 'w');
        // Fetch real categories from Master
        $masterCategories = $this->articleModel->getCategories();
        
        // Header columns
        fputcsv($output, ['article_number', 'tag_number', 'applicable_year', 'article_name', 'category', 'estimated_value', 'donor_name', 'description']);
        
        // Sample rows with categories directly from Master
        $cat1 = $masterCategories[0] ?? 'General';
        $cat2 = $masterCategories[1] ?? 'Traditional & Brass';
        $cat3 = $masterCategories[2] ?? 'Jewellery';
        $cat4 = $masterCategories[3] ?? 'Food & Delicacy';

        fputcsv($output, ["ART-{$year}-001", "TAG-001", $year, "Nilavilakku Traditional Brass Lamp", $cat2, "85.000", "Well-Wisher", "Heavy traditional lamp"]);
        fputcsv($output, ["ART-{$year}-002", "TAG-002", $year, "Gold Sovereign 22K Coin", $cat3, "220.000", "Parish Member", "Donated for cathedral"]);
        fputcsv($output, ["ART-{$year}-003", "TAG-003", $year, "Harvest Organic Spices Gift Hamper", $cat4, "40.000", "Youth Movement", "Cardamom, pepper, honey"]);
        fputcsv($output, ["ART-{$year}-004", "TAG-004", $year, "Handloom Kasavu Silk Set", $cat1, "55.000", "Anonymous", "Pristine fabric item"]);

        fclose($output);
        exit;
    }

    public function import(): void {
        $user = $this->requireAuth();
        $input = $this->getJsonInput();
        $rows = [];

        // Check if rows passed as JSON array
        if (!empty($input['rows']) && is_array($input['rows'])) {
            $rows = $input['rows'];
        } elseif (isset($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
            // Handle uploaded CSV file directly
            $tmpPath = $_FILES['file']['tmp_name'];
            $handle = fopen($tmpPath, 'r');
            if ($handle !== false) {
                $header = fgetcsv($handle);
                if ($header) {
                    $header = array_map(function($h) {
                        return strtolower(trim(str_replace([' ', '-', '#'], '_', $h)));
                    }, $header);

                    while (($data = fgetcsv($handle)) !== false) {
                        if (empty(array_filter($data))) continue;
                        $row = [];
                        foreach ($header as $i => $col) {
                            $row[$col] = $data[$i] ?? '';
                        }
                        $rows[] = $row;
                    }
                }
                fclose($handle);
            }
        }

        if (empty($rows)) {
            $this->jsonResponse(['success' => false, 'error' => 'No valid article rows found in file.'], 400);
        }

        try {
            $result = $this->articleModel->batchImport($rows, $user['user_id']);
            $this->jsonResponse([
                'success'  => true,
                'message'  => "Import completed: {$result['imported']} imported, {$result['skipped']} skipped.",
                'imported' => $result['imported'],
                'skipped'  => $result['skipped'],
                'errors'   => $result['errors']
            ]);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 500);
        }
    }
}
