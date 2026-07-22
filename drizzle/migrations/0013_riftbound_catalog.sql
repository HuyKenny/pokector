CREATE TABLE `riftbound_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`release_date` text,
	`image_url` text,
	`synced_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `riftbound_sets_slug_unique` ON `riftbound_sets` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_rb_sets_release` ON `riftbound_sets` (`release_date`);--> statement-breakpoint
CREATE TABLE `riftbound_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`set_id` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`number` text NOT NULL,
	`number_sort` integer NOT NULL,
	`rarity` text,
	`image_small_url` text,
	`image_large_url` text,
	`tcgplayer_id` text,
	`search_text` text NOT NULL,
	`source_updated_at` text,
	`synced_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `riftbound_sets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `riftbound_cards_slug_unique` ON `riftbound_cards` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_rb_cards_set` ON `riftbound_cards` (`set_id`);--> statement-breakpoint
CREATE INDEX `idx_rb_cards_set_number` ON `riftbound_cards` (`set_id`,`number_sort`,`number`);--> statement-breakpoint
CREATE INDEX `idx_rb_cards_source_updated` ON `riftbound_cards` (`source_updated_at`);--> statement-breakpoint
CREATE TABLE `riftbound_prices_current` (
	`card_id` text NOT NULL,
	`source` text NOT NULL,
	`variant` text NOT NULL,
	`currency` text NOT NULL,
	`normalized_price_minor` integer NOT NULL,
	`low_minor` integer,
	`mid_minor` integer,
	`high_minor` integer,
	`market_minor` integer,
	`source_updated_at` text,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `source`, `variant`, `currency`),
	FOREIGN KEY (`card_id`) REFERENCES `riftbound_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_rb_prices_source` ON `riftbound_prices_current` (`source`);--> statement-breakpoint
CREATE TABLE `riftbound_price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` text NOT NULL,
	`source` text NOT NULL,
	`variant` text NOT NULL,
	`currency` text NOT NULL,
	`price_minor` integer NOT NULL,
	`recorded_date` text NOT NULL,
	`observed_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `riftbound_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_rb_history_card_source_variant_currency_date` ON `riftbound_price_history` (`card_id`,`source`,`variant`,`currency`,`recorded_date`);--> statement-breakpoint
CREATE INDEX `idx_rb_history_card_lookup` ON `riftbound_price_history` (`card_id`,`variant`,`source`,`recorded_date`);
