@echo off
title Church Auction Portal (http://localhost:8080)
echo ========================================================
echo   Starting Church Auction Server on http://localhost:8080
echo   Press Ctrl+C to stop the server
echo ========================================================
php -S localhost:8080 router.php
pause
