-- ==============================================================================
-- St. Mary's Indian Orthodox Cathedral, Bahrain
-- Harvest Festival & Article Auction Management Module
-- Database Schema Migration Script for Server Deployment
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";

-- ------------------------------------------------------------------------------
-- 1. Table: `hf_articles` (Auction Article Master)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hf_articles` (
  `article_id` int(11) NOT NULL AUTO_INCREMENT,
  `article_number` varchar(50) NOT NULL,
  `tag_number` varchar(50) NOT NULL,
  `applicable_year` int(11) NOT NULL,
  `article_name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `category` varchar(100) DEFAULT 'General',
  `donor_member_id` int(11) DEFAULT NULL,
  `donor_name` varchar(255) DEFAULT NULL,
  `donor_code_c` int(11) DEFAULT NULL,
  `donor_phone` varchar(100) DEFAULT NULL,
  `donor_cpr` varchar(100) DEFAULT NULL,
  `estimated_value` decimal(18,3) DEFAULT '0.000',
  `reserve_price` decimal(18,3) DEFAULT '0.000',
  `status` enum('Available','Auctioned','Sold','Delivered','Cancelled') DEFAULT 'Available',
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`article_id`),
  UNIQUE KEY `uq_year_article` (`applicable_year`,`article_number`),
  KEY `idx_year_tag` (`applicable_year`,`tag_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 2. Table: `hf_auction_transactions` (Live Auction Bidding & Winning Transactions)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hf_auction_transactions` (
  `transaction_id` int(11) NOT NULL AUTO_INCREMENT,
  `auction_ref_no` varchar(50) NOT NULL,
  `article_id` int(11) NOT NULL,
  `applicable_year` int(11) NOT NULL,
  `buyer_member_id` int(11) DEFAULT NULL,
  `buyer_name` varchar(255) NOT NULL,
  `buyer_code_c` int(11) DEFAULT NULL,
  `buyer_phone` varchar(100) DEFAULT NULL,
  `winning_bid_amount` decimal(18,3) NOT NULL,
  `paid_amount` decimal(18,3) DEFAULT '0.000',
  `balance_amount` decimal(18,3) DEFAULT '0.000',
  `payment_status` enum('Paid','Partial','Pending') DEFAULT 'Pending',
  `auction_date` date NOT NULL,
  `notes` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `event_id` int(11) DEFAULT NULL,
  `event_name` varchar(255) DEFAULT NULL,
  `contrib_dr_code` varchar(50) DEFAULT NULL,
  `contrib_dr_name` varchar(255) DEFAULT NULL,
  `contrib_cr_code` varchar(50) DEFAULT NULL,
  `contrib_cr_name` varchar(255) DEFAULT NULL,
  `contrib_voucher_no` int(11) DEFAULT NULL,
  `acc_contribution_id` int(11) DEFAULT NULL,
  `promise_dr_code` varchar(50) DEFAULT NULL,
  `promise_dr_name` varchar(255) DEFAULT NULL,
  `promise_cr_code` varchar(50) DEFAULT NULL,
  `promise_cr_name` varchar(255) DEFAULT NULL,
  `promise_voucher_no` int(11) DEFAULT NULL,
  `acc_promise_id` int(11) DEFAULT NULL,
  `receipt_book_no` varchar(100) DEFAULT NULL,
  `manual_receipt_no` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`transaction_id`),
  UNIQUE KEY `auction_ref_no` (`auction_ref_no`),
  KEY `idx_article` (`article_id`),
  KEY `idx_year_buyer` (`applicable_year`,`buyer_member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 3. Table: `hf_categories` (Article Categories Master)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hf_categories` (
  `category_id` int(11) NOT NULL AUTO_INCREMENT,
  `category_name` varchar(100) NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`category_id`),
  UNIQUE KEY `category_name` (`category_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 4. Table: `hf_payments` (Settlement & Receipt Ledger Log)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hf_payments` (
  `payment_id` int(11) NOT NULL AUTO_INCREMENT,
  `receipt_no` varchar(50) NOT NULL,
  `transaction_id` int(11) NOT NULL,
  `payment_date` date NOT NULL,
  `amount_paid` decimal(18,3) NOT NULL,
  `payment_mode` varchar(50) DEFAULT 'Cash',
  `reference_no` varchar(100) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `dr_code` varchar(50) DEFAULT NULL,
  `dr_name` varchar(255) DEFAULT NULL,
  `cr_code` varchar(50) DEFAULT NULL,
  `cr_name` varchar(255) DEFAULT NULL,
  `voucher_no` int(11) DEFAULT NULL,
  `acc_contribution_id` int(11) DEFAULT NULL,
  `receipt_book_no` varchar(100) DEFAULT NULL,
  `manual_receipt_no` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`payment_id`),
  UNIQUE KEY `receipt_no` (`receipt_no`),
  KEY `idx_transaction` (`transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 5. Table: `hf_promises` (Auction Promises & Dues Log)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hf_promises` (
  `hf_promise_id` int(11) NOT NULL AUTO_INCREMENT,
  `transaction_id` int(11) NOT NULL,
  `article_id` int(11) NOT NULL,
  `applicable_year` int(11) NOT NULL,
  `member_id` int(11) DEFAULT NULL,
  `member_name` varchar(255) NOT NULL,
  `member_code_c` int(11) DEFAULT NULL,
  `member_phone` varchar(100) DEFAULT NULL,
  `total_promise_amount` decimal(18,3) NOT NULL,
  `paid_amount` decimal(18,3) DEFAULT '0.000',
  `balance_amount` decimal(18,3) NOT NULL,
  `due_date` date DEFAULT NULL,
  `promise_status` enum('Active','Fulfilled','Cancelled') DEFAULT 'Active',
  `acc_promise_id` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `dr_code` varchar(50) DEFAULT NULL,
  `dr_name` varchar(255) DEFAULT NULL,
  `cr_code` varchar(50) DEFAULT NULL,
  `cr_name` varchar(255) DEFAULT NULL,
  `voucher_no` int(11) DEFAULT NULL,
  `event_id` int(11) DEFAULT NULL,
  `event_name` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`hf_promise_id`),
  KEY `idx_transaction` (`transaction_id`),
  KEY `idx_year_status` (`applicable_year`,`promise_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 6. Table: `hf_users` (Standalone User Backup Table)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hf_users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profile_name` varchar(255) NOT NULL,
  `username` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `mobile_number` varchar(50) DEFAULT NULL,
  `user_type` enum('Administrator','User') NOT NULL DEFAULT 'User',
  `status` enum('Active','Inactive') NOT NULL DEFAULT 'Active',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------------------------
-- 7. Alter Base Church Tables (`acc_contribution`, `acc_promises` & `acc_ledger_entries`)
-- Links accounting receipts, promises, and ledger entries back to Harvest Festival article items
-- (If article_id is already present, these lines can be safely skipped)
-- ------------------------------------------------------------------------------
ALTER TABLE `acc_contribution` ADD COLUMN `article_id` int(11) DEFAULT 0;
ALTER TABLE `acc_contribution` ADD INDEX `idx_article_id` (`article_id`);

ALTER TABLE `acc_promises` ADD COLUMN `article_id` int(11) DEFAULT 0;
ALTER TABLE `acc_promises` ADD INDEX `idx_article_id` (`article_id`);

ALTER TABLE `acc_ledger_entries` ADD COLUMN `article_id` int(11) DEFAULT 0;
ALTER TABLE `acc_ledger_entries` ADD INDEX `idx_article_id` (`article_id`);

-- ------------------------------------------------------------------------------
-- 8. Seed Default Categories
-- ------------------------------------------------------------------------------
INSERT INTO `hf_categories` (`category_name`) VALUES 
('General'),
('Traditional & Brass'),
('Jewellery'),
('Food & Delicacy'),
('Handicrafts'),
('Electronics'),
('Apparel & Silk'),
('Plants & Flowers')
ON DUPLICATE KEY UPDATE `category_name` = VALUES(`category_name`);

-- ------------------------------------------------------------------------------
-- 9. Table: `hf_settings` (Application & Default Ledger Settings)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `hf_settings` (
  `setting_key` varchar(100) NOT NULL,
  `setting_value` longtext DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ==============================================================================
-- End of Migration Script
-- ==============================================================================

