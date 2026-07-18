ALTER TABLE `collection_entries` ADD `grade` text DEFAULT 'raw' NOT NULL;--> statement-breakpoint
CREATE TABLE `card_graded_prices` (
	`card_id` text NOT NULL,
	`grade` text NOT NULL,
	`currency` text NOT NULL,
	`from_minor` integer NOT NULL,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`card_id`, `grade`, `currency`),
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `card_graded_price_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` text NOT NULL,
	`grade` text NOT NULL,
	`currency` text NOT NULL,
	`price_minor` integer NOT NULL,
	`recorded_date` text NOT NULL,
	`observed_at` integer NOT NULL,
	`granularity` text DEFAULT 'daily' NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_graded_history_card_grade_currency_date` ON `card_graded_price_history` (`card_id`,`grade`,`currency`,`recorded_date`);--> statement-breakpoint
CREATE INDEX `idx_graded_history_lookup` ON `card_graded_price_history` (`card_id`,`grade`,`recorded_date`);
