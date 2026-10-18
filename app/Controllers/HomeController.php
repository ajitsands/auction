<?php
namespace App\Controllers;

use App\Core\Controller;

class HomeController extends Controller {
    public function index(): void {
        $user = $this->getAuthenticatedUser();
        $this->view('index', [
            'user' => $user,
            'title' => 'St. Mary\'s Cathedral - Harvest Festival & Article Auction'
        ]);
    }
}
