CREATE TABLE `card_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_id` text NOT NULL,
	`collection_entry_id` text,
	`quantity` integer NOT NULL,
	`variant` text NOT NULL,
	`grade` text DEFAULT 'raw' NOT NULL,
	`sale_currency` text DEFAULT 'USD' NOT NULL,
	`sale_price_minor` integer NOT NULL,
	`fee_minor` integer,
	`purchase_price_minor` integer,
	`purchase_currency` text DEFAULT 'USD' NOT NULL,
	`purchase_date` text,
	`sold_date` text NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`card_id`) REFERENCES `pokemon_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_entry_id`) REFERENCES `collection_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_card_sales_user_date` ON `card_sales` (`user_id`,`sold_date`);--> statement-breakpoint
CREATE INDEX `idx_card_sales_card` ON `card_sales` (`card_id`);
