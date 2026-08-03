CREATE TABLE `collections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`password_hash` text,
	`cover_photo_id` text,
	`sort_key` text NOT NULL,
	`downloads_enabled` integer DEFAULT false NOT NULL,
	`zip_enabled` integer DEFAULT false NOT NULL,
	`strip_exif_on_download` integer DEFAULT false NOT NULL,
	`metadata_fields` text DEFAULT '[]' NOT NULL,
	`published_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_owner_slug_idx` ON `collections` (`owner_id`,`slug`);--> statement-breakpoint
CREATE INDEX `collections_visibility_idx` ON `collections` (`visibility`);--> statement-breakpoint
CREATE INDEX `collections_sort_idx` ON `collections` (`owner_id`,`sort_key`);--> statement-breakpoint
CREATE TABLE `derivatives` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`format` text NOT NULL,
	`storage_key` text NOT NULL,
	`bytes` integer NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `derivatives_photo_width_format_idx` ON `derivatives` (`photo_id`,`width`,`format`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`collection_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`thumbhash` text,
	`dominant_color` text,
	`crc32` integer,
	`exif` text,
	`caption` text DEFAULT '' NOT NULL,
	`alt_text` text DEFAULT '' NOT NULL,
	`sort_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photos_collection_sort_idx` ON `photos` (`collection_id`,`sort_key`);--> statement-breakpoint
CREATE INDEX `photos_status_idx` ON `photos` (`status`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`bio` text DEFAULT '' NOT NULL,
	`avatar_photo_id` text,
	`social_links` text DEFAULT '[]' NOT NULL,
	`accent_color` text DEFAULT '#1c1917' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);