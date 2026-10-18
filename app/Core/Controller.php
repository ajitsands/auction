<?php
namespace App\Core;

abstract class Controller {
    public function jsonResponse(array $data, int $statusCode = 200): void {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
        exit;
    }

    public function getJsonInput(): array {
        $raw = file_get_contents('php://input');
        if (empty($raw)) {
            return $_POST ?: [];
        }
        $data = json_decode($raw, true);
        return is_array($data) ? $data : [];
    }

    public function view(string $viewName, array $data = []): void {
        extract($data);
        $file = __DIR__ . '/../Views/' . $viewName . '.php';
        if (file_exists($file)) {
            require_once $file;
        } else {
            http_response_code(404);
            echo "View [{$viewName}] not found.";
        }
        exit;
    }

    public function getAuthenticatedUser(): ?array {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        return $_SESSION['user'] ?? null;
    }

    public function requireAuth(): array {
        $user = $this->getAuthenticatedUser();
        if (!$user) {
            $this->jsonResponse([
                'success' => false,
                'error' => 'Unauthenticated. Please log in.'
            ], 401);
        }
        return $user;
    }
}
