ALTER TABLE `user_profiles` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `plan_status` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `plan_interval` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `stripe_subscription_id` text;--> statement-breakpoint
ALTER TABLE `user_profiles` ADD `premium_until` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_profiles_stripe_customer` ON `user_profiles` (`stripe_customer_id`);
