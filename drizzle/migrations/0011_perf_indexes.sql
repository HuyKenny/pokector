CREATE INDEX IF NOT EXISTS `idx_cards_source_updated` ON `pokemon_cards` (`source_updated_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cards_supertype` ON `pokemon_cards` (`supertype`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_prices_source_currency` ON `card_prices_current` (`source`,`currency`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `catalog_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL
);
