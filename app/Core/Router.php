<?php
namespace App\Core;

class Router {
    private array $routes = [];

    public function get(string $path, array $handler): void {
        $this->addRoute('GET', $path, $handler);
    }

    public function post(string $path, array $handler): void {
        $this->addRoute('POST', $path, $handler);
    }

    public function put(string $path, array $handler): void {
        $this->addRoute('PUT', $path, $handler);
    }

    public function delete(string $path, array $handler): void {
        $this->addRoute('DELETE', $path, $handler);
    }

    private function addRoute(string $method, string $path, array $handler): void {
        // Convert {param} to regex named group
        $pattern = preg_replace('/\{([a-zA-Z0-9_]+)\}/', '(?P<$1>[^/]+)', $path);
        $pattern = "#^" . $pattern . "$#";
        $this->routes[] = [
            'method' => strtoupper($method),
            'pattern' => $pattern,
            'handler' => $handler,
            'path' => $path
        ];
    }

    public function dispatch(string $method, string $uri): void {
        $uri = parse_url($uri, PHP_URL_PATH);
        $uri = rtrim($uri, '/');
        if ($uri === '') {
            $uri = '/';
        }

        foreach ($this->routes as $route) {
            if ($route['method'] === strtoupper($method) && preg_match($route['pattern'], $uri, $matches)) {
                $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);
                [$controllerClass, $action] = $route['handler'];
                $controller = new $controllerClass();
                $controller->$action($params);
                return;
            }
        }

        // If it is an API request, return 404 JSON
        if (str_starts_with($uri, '/api/')) {
            http_response_code(404);
            header('Content-Type: application/json');
            echo json_encode(['success' => false, 'error' => "Endpoint not found: [{$method} {$uri}]"]);
            return;
        }

        // Fallback for single page application routes: serve the index view!
        $homeController = new \App\Controllers\HomeController();
        $homeController->index();
    }
}
