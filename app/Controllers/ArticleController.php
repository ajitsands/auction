<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\Article;

class ArticleController extends Controller {
    private Article $articleModel;

    public function __construct() {
        $this->articleModel = new Article();
    }

    public function index(): void {
        $this->requireAuth();
        $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
        $status = $_GET['status'] ?? null;
        $search = $_GET['search'] ?? null;
        $category = $_GET['category'] ?? null;

        $articles = $this->articleModel->getAll($year, $status, $search, $category);
        $this->jsonResponse([
            'success'  => true,
            'year'     => $year,
            'count'    => count($articles),
            'articles' => $articles
        ]);
    }

    public function show(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? 0);
        $article = $this->articleModel->findById($id);
        if (!$article) {
            $this->jsonResponse(['success' => false, 'error' => 'Article not found'], 404);
        }
        $this->jsonResponse(['success' => true, 'article' => $article]);
    }

    public function nextNumber(): void {
        $this->requireAuth();
        $year = isset($_GET['year']) ? (int)$_GET['year'] : (int)date('Y');
        $next = $this->articleModel->generateNextArticleNumber($year);
        $this->jsonResponse([
            'success'             => true,
            'year'                => $year,
            'next_article_number' => $next
        ]);
    }

    public function store(): void {
        $user = $this->requireAuth();
        $data = $this->getJsonInput();

        if (empty($data['applicable_year']) || empty($data['article_name'])) {
            $this->jsonResponse(['success' => false, 'error' => 'Applicable Year and Article Name are required.'], 400);
        }

        $year = (int)$data['applicable_year'];
        
        // System automatically creates unique article number based on selected year (no manual user input)
        $data['article_number'] = $this->articleModel->generateNextArticleNumber($year);

        // If tag_number is empty, generate matching default from article number
        if (empty($data['tag_number'])) {
            $data['tag_number'] = str_replace("ART-{$year}-", "TAG-", $data['article_number']);
        }

        $data['created_by'] = $user['user_id'];
        $id = $this->articleModel->create($data);
        $created = $this->articleModel->findById($id);

        $this->jsonResponse([
            'success' => true,
            'message' => "Article created successfully with Article No [{$data['article_number']}].",
            'article' => $created
        ], 201);
    }

    public function update(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? 0);
        $existing = $this->articleModel->findById($id);
        if (!$existing) {
            $this->jsonResponse(['success' => false, 'error' => 'Article not found'], 404);
        }

        if (strcasecmp($existing['status'] ?? '', 'Available') !== 0) {
            $this->jsonResponse([
                'success' => false,
                'error'   => "Only articles with status 'Available' can be edited. This article is currently marked as '{$existing['status']}'."
            ], 400);
        }

        $data = $this->getJsonInput();
        if (empty($data['article_name'])) {
            $this->jsonResponse(['success' => false, 'error' => 'Article Name is required.'], 400);
        }

        // Article number is system-assigned and strictly preserved (no update by user)
        $data['article_number']  = $existing['article_number'];
        $data['applicable_year'] = $existing['applicable_year'];
        if (empty($data['tag_number'])) {
            $data['tag_number'] = $existing['tag_number'];
        }

        $this->articleModel->update($id, $data);
        $updated = $this->articleModel->findById($id);

        $this->jsonResponse([
            'success' => true,
            'message' => 'Article updated successfully',
            'article' => $updated
        ]);
    }

    public function delete(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? 0);

        $existing = $this->articleModel->findById($id);
        if (!$existing) {
            $this->jsonResponse(['success' => false, 'error' => 'Article not found.'], 404);
        }

        if (strcasecmp($existing['status'] ?? '', 'Available') !== 0) {
            $this->jsonResponse([
                'success' => false,
                'error'   => "Only articles with status 'Available' can be deleted. This article status is currently '{$existing['status']}'."
            ], 400);
        }

        try {
            $this->articleModel->delete($id);
            $this->jsonResponse(['success' => true, 'message' => 'Article deleted successfully']);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }

    public function years(): void {
        $this->requireAuth();
        $years = $this->articleModel->getYears();
        $this->jsonResponse(['success' => true, 'years' => $years]);
    }

    public function categories(): void {
        $this->requireAuth();
        $cats = $this->articleModel->getCategories();
        $detailed = $this->articleModel->getCategoriesWithStats();
        $this->jsonResponse([
            'success'          => true,
            'categories'       => $cats,
            'category_details' => $detailed
        ]);
    }

    public function addCategory(): void {
        $this->requireAuth();
        $data = $this->getJsonInput();
        $name = trim($data['name'] ?? $data['category_name'] ?? '');

        if ($name === '') {
            $this->jsonResponse(['success' => false, 'error' => 'Category name is required.'], 400);
        }

        try {
            $cat = $this->articleModel->addCategory($name);
            $cats = $this->articleModel->getCategories();
            $detailed = $this->articleModel->getCategoriesWithStats();
            $this->jsonResponse([
                'success'          => true,
                'message'          => "Category '{$cat['category_name']}' added successfully.",
                'category'         => $cat,
                'categories'       => $cats,
                'category_details' => $detailed
            ], 201);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }

    public function deleteCategory(array $params): void {
        $this->requireAuth();
        $id = (int)($params['id'] ?? 0);
        try {
            $this->articleModel->deleteCategory($id);
            $cats = $this->articleModel->getCategories();
            $detailed = $this->articleModel->getCategoriesWithStats();
            $this->jsonResponse([
                'success'          => true,
                'message'          => 'Category deleted successfully.',
                'categories'       => $cats,
                'category_details' => $detailed
            ]);
        } catch (\Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 400);
        }
    }
}
