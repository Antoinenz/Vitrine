ALTER TABLE `profiles` ADD `licence` text DEFAULT 'all-rights-reserved' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `footer_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `footer_links` text DEFAULT '[]' NOT NULL;