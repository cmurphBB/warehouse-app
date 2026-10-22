ALTER TABLE consignment_logs ADD COLUMN equipment_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE consignment_logs ADD COLUMN serial_number TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE consignment_logs ADD COLUMN asset_tag TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE consignment_logs ADD COLUMN equipment_removed INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE equipment_logs ADD COLUMN equipment_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE equipment_logs ADD COLUMN equipment_removed INTEGER NOT NULL DEFAULT 0;
