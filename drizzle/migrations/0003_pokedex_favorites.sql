CREATE TABLE `pokedex_favorites` (
	`user_id` text NOT NULL,
	`dex` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`user_id`, `dex`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_pokedex_fav_user` ON `pokedex_favorites` (`user_id`);
