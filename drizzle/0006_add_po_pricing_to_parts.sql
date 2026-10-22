ALTER TABLE `parts` ADD COLUMN `avg_cost_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `parts` ADD COLUMN `last_cost_cents` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `parts` ADD COLUMN `price_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `parts` ADD COLUMN `last_vendor` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `parts` ADD COLUMN `last_priced_at` text DEFAULT '' NOT NULL;
