CREATE TABLE `counters` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL
);
