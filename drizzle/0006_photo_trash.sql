ALTER TABLE `photos` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `photos_deleted_idx` ON `photos` (`deleted_at`);