ALTER TABLE `collections` ADD `dated_at` integer;--> statement-breakpoint
CREATE INDEX `collections_dated_idx` ON `collections` (`owner_id`,`dated_at`);--> statement-breakpoint
ALTER TABLE `profiles` ADD `collection_order` text DEFAULT 'date' NOT NULL;--> statement-breakpoint
-- Backfill, hand-written: existing collections keep the order they already had.
-- Without this every pre-existing collection would sort as null and the artist
-- page would reshuffle itself the moment this migration ran.
UPDATE `collections` SET `dated_at` = `created_at` WHERE `dated_at` IS NULL;