<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Auction Portal | Harvest Festival & Article Auction Management</title>
    <!-- Fonts from Staging Parallel: Material Icons & Open Sans -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="/css/app.css?v=<?= time() ?>">
    <link rel="stylesheet" href="/css/vendor/sweetalert.css">
    <!-- Console filter for non-fatal in-browser Babel transformer styling notice -->
    <script>
    (function() {
        const origError = console.error;
        const origWarn = console.warn;
        console.error = function(...args) {
            if (typeof args[0] === 'string' && args[0].includes('[BABEL] Note: The code generator has deoptimised')) {
                return;
            }
            origError.apply(console, args);
        };
        console.warn = function(...args) {
            if (typeof args[0] === 'string' && args[0].includes('You are using the in-browser Babel transformer')) {
                return;
            }
            origWarn.apply(console, args);
        };
    })();
    </script>
</head>
<body>
    <div id="root">
        <div class="initial-loader">
            <div class="spinner"></div>
            <p>Loading Auction Portal...</p>
        </div>
    </div>

    <!-- Vendor Libraries -->
    <script src="/js/vendor/react.production.min.js"></script>
    <script src="/js/vendor/react-dom.production.min.js"></script>
    <script src="/js/vendor/babel.min.js?v=<?= filemtime(__DIR__ . '/../../public/js/vendor/babel.min.js') ?>"></script>
    <script src="/js/vendor/xlsx.full.min.js"></script>
    <script src="/js/vendor/sweetalert.min.js"></script>

    <!-- React Application Component Scripts -->
    <script type="text/babel" src="/js/app.js?v=<?= time() ?>"></script>
</body>
</html>
