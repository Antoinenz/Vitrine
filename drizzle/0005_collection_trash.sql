ALTER TABLE `collections` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `collections_deleted_idx` ON `collections` (`owner_id`,`deleted_at`);