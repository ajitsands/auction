<?php
namespace App\Models;

use App\Core\Model;
use PDO;
use Exception;

class User extends Model {
    public function __construct() {
        parent::__construct();
    }

    /**
     * Authenticate user directly against tbl_users
     */
    public function authenticate(string $username, string $password): ?array {
        try {
            $stmt = $this->db->prepare("
                SELECT user_id, user_type, user_name, user_loginusername, user_password, user_email, user_phone, user_status, user_created_on
                FROM tbl_users
                WHERE LOWER(TRIM(user_loginusername)) = LOWER(TRIM(:username)) 
                  AND user_status = 'Active'
                LIMIT 1
            ");
            $stmt->execute([':username' => $username]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            if ($user) {
                // Support both plain text passwords and bcrypt / password_verify hashes
                $storedPassword = $user['user_password'] ?? '';
                $authenticated = false;

                if ($storedPassword === $password) {
                    $authenticated = true;
                } elseif (password_verify($password, $storedPassword)) {
                    $authenticated = true;
                }

                if ($authenticated) {
                    return [
                        'id'                 => (int)$user['user_id'],
                        'user_id'            => (int)$user['user_id'],
                        'user_type'          => $user['user_type'],
                        'user_name'          => $user['user_name'],
                        'profile_name'       => $user['user_name'],
                        'user_loginusername' => $user['user_loginusername'],
                        'username'           => $user['user_loginusername'],
                        'user_phone'         => ($user['user_phone'] !== 'NA' ? $user['user_phone'] : ''),
                        'mobile_number'      => ($user['user_phone'] !== 'NA' ? $user['user_phone'] : ''),
                        'user_status'        => $user['user_status'],
                        'status'             => $user['user_status'],
                        'user_email'         => ($user['user_email'] !== 'NA' ? $user['user_email'] : ''),
                        'email'              => ($user['user_email'] !== 'NA' ? $user['user_email'] : ''),
                        'created_at'         => $user['user_created_on'] ?? ''
                    ];
                }
            }
        } catch (Exception $e) {
            error_log('User authenticate error: ' . $e->getMessage());
        }

        return null;
    }

    /**
     * Find user by id in tbl_users
     */
    public function findById(int $userId): ?array {
        try {
            $stmt = $this->db->prepare("
                SELECT user_id, user_type, user_name, user_loginusername, user_email, user_phone, user_status, user_created_on
                FROM tbl_users
                WHERE user_id = :id
                LIMIT 1
            ");
            $stmt->execute([':id' => $userId]);
            $user = $stmt->fetch(PDO::FETCH_ASSOC);

            if ($user) {
                return [
                    'id'                 => (int)$user['user_id'],
                    'user_id'            => (int)$user['user_id'],
                    'user_type'          => $user['user_type'],
                    'user_name'          => $user['user_name'],
                    'profile_name'       => $user['user_name'],
                    'user_loginusername' => $user['user_loginusername'],
                    'username'           => $user['user_loginusername'],
                    'user_phone'         => ($user['user_phone'] !== 'NA' ? $user['user_phone'] : ''),
                    'mobile_number'      => ($user['user_phone'] !== 'NA' ? $user['user_phone'] : ''),
                    'user_status'        => $user['user_status'],
                    'status'             => $user['user_status'],
                    'user_email'         => ($user['user_email'] !== 'NA' ? $user['user_email'] : ''),
                    'email'              => ($user['user_email'] !== 'NA' ? $user['user_email'] : ''),
                    'created_at'         => $user['user_created_on'] ?? ''
                ];
            }
        } catch (Exception $e) {
            error_log('User findById error: ' . $e->getMessage());
        }

        return null;
    }

    /**
     * Get all Administrator and Harvest Festival / HF data entry users from tbl_users
     */
    public function getAllUsers(): array {
        $stmt = $this->db->query("
            SELECT 
                user_id AS id,
                user_id,
                user_name AS profile_name,
                user_name,
                user_loginusername AS username,
                user_loginusername,
                user_phone AS mobile_number,
                user_phone,
                user_type,
                user_status AS status,
                user_status,
                user_email,
                user_created_on AS created_at
            FROM tbl_users
            WHERE user_type IN ('Administrator', 'Harvest Festival')
               OR user_name LIKE '%HF%'
               OR user_loginusername LIKE 'hf%'
            ORDER BY 
                CASE WHEN user_type = 'Administrator' THEN 0 ELSE 1 END,
                user_name ASC
        ");
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$row) {
            $row['id'] = (int)$row['id'];
            $row['user_id'] = (int)$row['user_id'];
            if ($row['mobile_number'] === 'NA') {
                $row['mobile_number'] = '';
                $row['user_phone'] = '';
            }
            if ($row['user_email'] === 'NA') {
                $row['user_email'] = '';
            }
            $row['email'] = $row['user_email'];
        }
        return $rows;
    }

    /**
     * Backward-compatible alias for getAllUsers
     */
    public function getAllHfUsers(): array {
        return $this->getAllUsers();
    }

    /**
     * Backward-compatible alias for findById
     */
    public function findHfUserById(int $id): ?array {
        return $this->findById($id);
    }

    /**
     * Check if username already exists in tbl_users
     */
    public function usernameExists(string $username, ?int $excludeId = null): bool {
        if ($excludeId !== null) {
            $stmt = $this->db->prepare("SELECT user_id FROM tbl_users WHERE LOWER(TRIM(user_loginusername)) = LOWER(TRIM(:username)) AND user_id != :id LIMIT 1");
            $stmt->execute([':username' => $username, ':id' => $excludeId]);
        } else {
            $stmt = $this->db->prepare("SELECT user_id FROM tbl_users WHERE LOWER(TRIM(user_loginusername)) = LOWER(TRIM(:username)) LIMIT 1");
            $stmt->execute([':username' => $username]);
        }
        return (bool)$stmt->fetch();
    }

    /**
     * Read-only stubs to protect tbl_users from inadvertent modification
     */
    public function createHfUser(array $data): int {
        throw new Exception("Adding users is disabled. Users are read from tbl_users.");
    }

    public function updateHfUser(int $id, array $data): bool {
        throw new Exception("Editing users is disabled. Users are read from tbl_users.");
    }

    public function setHfUserStatus(int $id, string $status): bool {
        throw new Exception("Activating or deactivating users is disabled. Users are read from tbl_users.");
    }

    public function resetHfUserPassword(int $id, string $newPassword): bool {
        throw new Exception("Password reset is disabled. Passwords are managed in tbl_users.");
    }

    public function deleteHfUser(int $id): bool {
        throw new Exception("Deleting users is disabled. Users are read from tbl_users.");
    }
}
