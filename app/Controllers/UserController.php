<?php
namespace App\Controllers;

use App\Core\Controller;
use App\Models\User;
use Exception;

class UserController extends Controller {
    private User $userModel;

    public function __construct() {
        $this->userModel = new User();
    }

    private function requireAdmin(): array {
        $user = $this->requireAuth();
        if (($user['user_type'] ?? '') !== 'Administrator') {
            $this->jsonResponse([
                'success' => false,
                'error'   => 'Access denied. Administrator privileges are required to view users.'
            ], 403);
        }
        return $user;
    }

    /**
     * List all Administrator and HF data entry users from tbl_users
     */
    public function index(): void {
        $this->requireAdmin();
        try {
            $users = $this->userModel->getAllUsers();
            $this->jsonResponse([
                'success' => true,
                'users'   => $users
            ]);
        } catch (Exception $e) {
            $this->jsonResponse(['success' => false, 'error' => $e->getMessage()], 500);
        }
    }

    /**
     * User creation disabled (read-only from tbl_users)
     */
    public function store(): void {
        $this->requireAdmin();
        $this->jsonResponse([
            'success' => false,
            'error'   => 'User creation is disabled. Users are managed through the central church system (tbl_users).'
        ], 403);
    }

    /**
     * User editing disabled
     */
    public function update(array $params): void {
        $this->requireAdmin();
        $this->jsonResponse([
            'success' => false,
            'error'   => 'User editing is disabled. Users are managed through the central church system (tbl_users).'
        ], 403);
    }

    /**
     * User status modification disabled
     */
    public function updateStatus(array $params): void {
        $this->requireAdmin();
        $this->jsonResponse([
            'success' => false,
            'error'   => 'Activating or deactivating users is disabled. User statuses are managed through tbl_users.'
        ], 403);
    }

    /**
     * Password reset disabled
     */
    public function resetPassword(array $params): void {
        $this->requireAdmin();
        $this->jsonResponse([
            'success' => false,
            'error'   => 'Password reset is disabled in this portal. Credentials are authenticated through tbl_users.'
        ], 403);
    }

    /**
     * User deletion disabled
     */
    public function delete(array $params): void {
        $this->requireAdmin();
        $this->jsonResponse([
            'success' => false,
            'error'   => 'User deletion is disabled. Users are managed through the central church system (tbl_users).'
        ], 403);
    }
}
