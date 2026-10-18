<?php
// Support for PHP CLI built-in web server routing: serve existing static files directly
if (php_sapi_name() === 'cli-server') {
    $filePath = __DIR__ . parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
    if (is_file($filePath)) {
        return false;
    }
}

// Start output buffering and session
ob_start();
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Simple PSR-4 Autoloader for App namespace
spl_autoload_register(function ($class) {
    $prefix = 'App\\';
    $baseDir = __DIR__ . '/../app/';

    $len = strlen($prefix);
    if (strncmp($prefix, $class, $len) !== 0) {
        return;
    }

    $relativeClass = substr($class, $len);
    $file = $baseDir . str_replace('\\', '/', $relativeClass) . '.php';

    if (file_exists($file)) {
        require_once $file;
    }
});

use App\Core\Router;
use App\Controllers\HomeController;
use App\Controllers\AuthController;
use App\Controllers\ArticleController;
use App\Controllers\ExcelImportController;
use App\Controllers\AuctionController;
use App\Controllers\PaymentController;
use App\Controllers\PromiseController;
use App\Controllers\MemberController;
use App\Controllers\ReportController;
use App\Controllers\UserController;
use App\Controllers\AccountController;

$router = new Router();

// Web Home
$router->get('/', [HomeController::class, 'index']);

// Account Heads & Events Endpoints
$router->get('/api/accounts/heads', [AccountController::class, 'heads']);
$router->get('/api/accounts/heads/contribution', [AccountController::class, 'contributionHeads']);
$router->get('/api/accounts/heads/promise', [AccountController::class, 'promiseHeads']);
$router->get('/api/accounts/events', [AccountController::class, 'events']);

// Auth Endpoints
$router->post('/api/auth/login', [AuthController::class, 'login']);
$router->post('/api/auth/logout', [AuthController::class, 'logout']);
$router->get('/api/auth/me', [AuthController::class, 'me']);

// Article Endpoints
$router->get('/api/articles', [ArticleController::class, 'index']);
$router->get('/api/articles/years', [ArticleController::class, 'years']);
$router->get('/api/articles/categories', [ArticleController::class, 'categories']);
$router->get('/api/articles/next-number', [ArticleController::class, 'nextNumber']);
$router->post('/api/articles/categories', [ArticleController::class, 'addCategory']);
$router->delete('/api/articles/categories/{id}', [ArticleController::class, 'deleteCategory']);
$router->post('/api/articles', [ArticleController::class, 'store']);
$router->get('/api/articles/{id}', [ArticleController::class, 'show']);
$router->put('/api/articles/{id}', [ArticleController::class, 'update']);
$router->delete('/api/articles/{id}', [ArticleController::class, 'delete']);

// Excel Import Endpoints
$router->get('/api/excel/template', [ExcelImportController::class, 'template']);
$router->post('/api/excel/import', [ExcelImportController::class, 'import']);

// Auction Transactions & Stats Endpoints
$router->get('/api/auctions', [AuctionController::class, 'index']);
$router->post('/api/auctions', [AuctionController::class, 'store']);
$router->get('/api/auctions/stats', [AuctionController::class, 'stats']);

// Payments & Receipts Endpoints
$router->post('/api/payments', [PaymentController::class, 'store']);
$router->get('/api/payments/transaction/{id}', [PaymentController::class, 'byTransaction']);
$router->get('/api/payments/receipt/{receiptNo}', [PaymentController::class, 'receipt']);

// Promises Endpoints
$router->get('/api/promises', [PromiseController::class, 'index']);

// Member Lookup
$router->get('/api/members/search', [MemberController::class, 'search']);

// Reports Endpoints
$router->get('/api/reports/summary', [ReportController::class, 'summary']);
$router->get('/api/reports/buyers', [ReportController::class, 'buyers']);

// User Administration Endpoints (tbl_users)
$router->get('/api/users', [UserController::class, 'index']);
$router->post('/api/users', [UserController::class, 'store']);
$router->put('/api/users/{id}', [UserController::class, 'update']);
$router->post('/api/users/{id}/status', [UserController::class, 'updateStatus']);
$router->post('/api/users/{id}/reset-password', [UserController::class, 'resetPassword']);
$router->delete('/api/users/{id}', [UserController::class, 'delete']);

// Dispatch
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri = $_SERVER['REQUEST_URI'] ?? '/';

$router->dispatch($method, $uri);
