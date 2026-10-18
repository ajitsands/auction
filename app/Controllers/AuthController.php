<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\User;

class AuthController extends Controller {
    private User $userModel;

    public function __construct() {
        $this->userModel = new User();
    }

    public function login(): void {
        $input = $this->getJsonInput();
        $username = trim($input['username'] ?? '');
        $password = trim($input['password'] ?? '');

        if ($username === '' || $password === '') {
            $this->jsonResponse(['success' => false, 'error' => 'Please provide both username and password.'], 400);
        }

        $user = $this->userModel->authenticate($username, $password);
        if (!$user) {
            $this->jsonResponse(['success' => false, 'error' => 'Invalid username or password.'], 401);
        }

        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        $_SESSION['user'] = $user;

        $this->jsonResponse([
            'success' => true,
            'message' => 'Login successful',
            'user'    => $user
        ]);
    }

    public function me(): void {
        $user = $this->getAuthenticatedUser();
        if (!$user) {
            $this->jsonResponse(['authenticated' => false, 'user' => null]);
        }
        $this->jsonResponse(['authenticated' => true, 'user' => $user]);
    }

    public function logout(): void {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
        $_SESSION = [];
        if (ini_get("session.use_cookies")) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000,
                $params["path"], $params["domain"],
                $params["secure"], $params["httponly"]
            );
        }
        session_destroy();
        $this->jsonResponse(['success' => true, 'message' => 'Logged out successfully']);
    }
}
