CREATE TABLE `legal_pages` (
	`slug` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
