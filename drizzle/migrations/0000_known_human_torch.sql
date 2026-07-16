CREATE TABLE `admin_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_admin` ON `admin_audit_logs` (`admin_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `binder_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`binder_id` text NOT NULL,
	`collection_entry_id` text,
	`card_id` text,
	`page_number` integer NOT NULL,
	`side` text NOT NULL,
	`slot_number` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`binder_id`) REFERENCES `binders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_entry_id`) REFERENCES `collection_entries`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_binder_slot_position` ON `binder_slots` (`binder_id`,`page_number`,`side`,`slot_number`);--> statement-breakpoint
CREATE INDEX `idx_binder_slots_binder_page` ON `binder_slots` (`binder_id`,`page_number`);--> statement-breakpoint
CREATE INDEX `idx_binder_slots_entry` ON `binder_slots` (`collection_entry_id`);--> statement-breakpoint
CREATE TABLE `binders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`visibility` text DEFAULT 'private' NOT NULL,
	`public_slug` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `binders_public_slug_unique` ON `binders` (`public_slug`);--> statement-breakpoint
CREATE INDEX `idx_binders_user` ON `binders` (`user_id`);--> statement-breakpoint
CREATE TABLE `card_price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` text NOT NULL,
	`source` text NOT NULL,
	`variant` text NOT NULL,
	`currency` text NOT NULL,
	`price_minor` integer NOT NULL,
	`recorded_date` text NOT NULL,
	`observed_at` integer NOT NULL,
	`source_updated_at` text,
	`granularity` text DEFAULT 'daily' NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_history_card_source_variant_currency_date` ON `card_price_history` (`card_id`,`source`,`variant`,`currency`,`recorded_date`);--> statement-breakpoint
CREATE INDEX `idx_history_card_lookup` ON `card_price_history` (`card_id`,`variant`,`source`,`recorded_date`);--> statement-breakpoint
CREATE INDEX `idx_history_recorded_date` ON `card_price_history` (`recorded_date`);--> statement-breakpoint
CREATE TABLE `card_prices_current` (
	`card_id` text NOT NULL,
	`source` text NOT NULL,
	`variant` text NOT NULL,
	`currency` text NOT NULL,
	`normalized_price_minor` integer NOT NULL,
	`low_minor` integer,
	`mid_minor` integer,
	`high_minor` integer,
	`market_minor` integer,
	`direct_low_minor` integer,
	`trend_minor` integer,
	`average_sell_minor` integer,
	`source_updated_at` text,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `source`, `variant`, `currency`),
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_prices_source_observed` ON `card_prices_current` (`source`,`observed_at`);--> statement-breakpoint
CREATE TABLE `collection_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`variant` text NOT NULL,
	`condition` text DEFAULT 'Near Mint' NOT NULL,
	`language` text DEFAULT 'English' NOT NULL,
	`purchase_price_minor` integer,
	`purchase_currency` text DEFAULT 'USD' NOT NULL,
	`purchase_date` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_collection_user` ON `collection_entries` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_collection_user_card` ON `collection_entries` (`user_id`,`card_id`);--> statement-breakpoint
CREATE INDEX `idx_collection_user_updated` ON `collection_entries` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_collection_card` ON `collection_entries` (`card_id`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`mode` text NOT NULL,
	`total_rows` integer DEFAULT 0 NOT NULL,
	`processed_rows` integer DEFAULT 0 NOT NULL,
	`successful_rows` integer DEFAULT 0 NOT NULL,
	`failed_rows` integer DEFAULT 0 NOT NULL,
	`payload_json` text,
	`error_report_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_import_jobs_user` ON `import_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`payload_json` text,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `pokemon_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`set_id` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`number` text NOT NULL,
	`number_sort` integer NOT NULL,
	`supertype` text,
	`subtypes_json` text,
	`hp` integer,
	`types_json` text,
	`rarity` text,
	`artist` text,
	`national_pokedex_numbers_json` text,
	`regulation_mark` text,
	`image_small_url` text,
	`image_large_url` text,
	`tcgplayer_url` text,
	`cardmarket_url` text,
	`search_text` text NOT NULL,
	`source_updated_at` text,
	`synced_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `pokemon_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pokemon_cards_slug_unique` ON `pokemon_cards` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_cards_set` ON `pokemon_cards` (`set_id`);--> statement-breakpoint
CREATE INDEX `idx_cards_name_normalized` ON `pokemon_cards` (`name_normalized`);--> statement-breakpoint
CREATE INDEX `idx_cards_rarity` ON `pokemon_cards` (`rarity`);--> statement-breakpoint
CREATE INDEX `idx_cards_set_number` ON `pokemon_cards` (`set_id`,`number_sort`,`number`);--> statement-breakpoint
CREATE TABLE `pokemon_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`series` text NOT NULL,
	`printed_total` integer,
	`total` integer,
	`release_date` text,
	`symbol_url` text,
	`logo_url` text,
	`source_updated_at` text,
	`synced_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pokemon_sets_slug_unique` ON `pokemon_sets` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_sets_series` ON `pokemon_sets` (`series`);--> statement-breakpoint
CREATE INDEX `idx_sets_release_date` ON `pokemon_sets` (`release_date`);--> statement-breakpoint
CREATE INDEX `idx_sets_name_normalized` ON `pokemon_sets` (`name_normalized`);--> statement-breakpoint
CREATE TABLE `portfolio_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`currency` text NOT NULL,
	`market_value_minor` integer NOT NULL,
	`cost_basis_minor` integer NOT NULL,
	`unrealized_pl_minor` integer NOT NULL,
	`unique_card_count` integer NOT NULL,
	`total_quantity` integer NOT NULL,
	`priced_entry_count` integer NOT NULL,
	`unpriced_entry_count` integer NOT NULL,
	`calculated_at` integer NOT NULL,
	`granularity` text DEFAULT 'daily' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_snapshot_user_date_currency` ON `portfolio_snapshots` (`user_id`,`snapshot_date`,`currency`);--> statement-breakpoint
CREATE INDEX `idx_snapshots_user_date` ON `portfolio_snapshots` (`user_id`,`snapshot_date`);--> statement-breakpoint
CREATE TABLE `price_alert_events` (
	`id` text PRIMARY KEY NOT NULL,
	`wishlist_item_id` text NOT NULL,
	`card_id` text NOT NULL,
	`user_id` text NOT NULL,
	`price_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`delivery_in_app` integer DEFAULT false NOT NULL,
	`delivery_email` integer DEFAULT false NOT NULL,
	`delivery_error` text,
	`triggered_at` integer NOT NULL,
	FOREIGN KEY (`wishlist_item_id`) REFERENCES `wishlist_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_alert_events_user` ON `price_alert_events` (`user_id`,`triggered_at`);--> statement-breakpoint
CREATE TABLE `set_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`set_id` text NOT NULL,
	`checklist_mode` text DEFAULT 'standard' NOT NULL,
	`target_date` text,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_id`) REFERENCES `pokemon_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_set_goals_user_set_mode` ON `set_goals` (`user_id`,`set_id`,`checklist_mode`);--> statement-breakpoint
CREATE INDEX `idx_set_goals_user` ON `set_goals` (`user_id`);--> statement-breakpoint
CREATE TABLE `set_progress_cache` (
	`user_id` text NOT NULL,
	`set_id` text NOT NULL,
	`checklist_mode` text NOT NULL,
	`owned_count` integer NOT NULL,
	`total_count` integer NOT NULL,
	`missing_count` integer NOT NULL,
	`missing_value_minor` integer,
	`calculated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `set_id`, `checklist_mode`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_id`) REFERENCES `pokemon_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sync_job_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` text NOT NULL,
	`level` text NOT NULL,
	`event` text NOT NULL,
	`metadata_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `sync_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sync_job_logs_job` ON `sync_job_logs` (`job_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`cursor` text,
	`payload_json` text,
	`idempotency_key` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`locked_until` integer,
	`run_after` integer,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_sync_jobs_claim` ON `sync_jobs` (`status`,`run_after`,`locked_until`);--> statement-breakpoint
CREATE INDEX `idx_sync_jobs_type_status` ON `sync_jobs` (`type`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sync_jobs_idempotency` ON `sync_jobs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`total_pages` integer,
	`completed_pages` integer DEFAULT 0 NOT NULL,
	`cards_upserted` integer DEFAULT 0 NOT NULL,
	`sets_upserted` integer DEFAULT 0 NOT NULL,
	`prices_upserted` integer DEFAULT 0 NOT NULL,
	`malformed_skipped` integer DEFAULT 0 NOT NULL,
	`api_request_count` integer DEFAULT 0 NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `idx_sync_runs_kind_status` ON `sync_runs` (`kind`,`status`,`started_at`);--> statement-breakpoint
CREATE TABLE `tracked_cards` (
	`card_id` text PRIMARY KEY NOT NULL,
	`collection_reference_count` integer DEFAULT 0 NOT NULL,
	`wishlist_reference_count` integer DEFAULT 0 NOT NULL,
	`popularity_score` integer DEFAULT 0 NOT NULL,
	`last_viewed_at` integer,
	`last_history_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tracked_popularity` ON `tracked_cards` (`popularity_score`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`display_name` text,
	`username` text,
	`default_currency` text DEFAULT 'USD' NOT NULL,
	`locale` text DEFAULT 'en-US' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`onboarding_completed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profiles_username_unique` ON `user_profiles` (`username`);--> statement-breakpoint
CREATE TABLE `wishlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`variant` text NOT NULL,
	`target_price_minor` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`alert_direction` text DEFAULT 'below' NOT NULL,
	`alert_enabled` integer DEFAULT false NOT NULL,
	`prior_threshold_state` text,
	`last_alerted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_wishlist_user_card_variant_currency` ON `wishlist_items` (`user_id`,`card_id`,`variant`,`currency`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_user` ON `wishlist_items` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_card` ON `wishlist_items` (`card_id`);--> statement-breakpoint
CREATE INDEX `idx_wishlist_alerts` ON `wishlist_items` (`alert_enabled`,`card_id`);--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);