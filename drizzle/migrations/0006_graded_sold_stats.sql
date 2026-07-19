ALTER TABLE `card_graded_prices` ADD `low_minor` integer;--> statement-breakpoint
ALTER TABLE `card_graded_prices` ADD `high_minor` integer;--> statement-breakpoint
ALTER TABLE `card_graded_prices` ADD `sample_size` integer;--> statement-breakpoint
ALTER TABLE `card_graded_prices` ADD `source` text DEFAULT 'listing' NOT NULL;
