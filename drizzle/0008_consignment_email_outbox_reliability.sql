ALTER TABLE consignment_logs ADD COLUMN email_subject TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE consignment_logs ADD COLUMN email_body TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE consignment_logs ADD COLUMN email_attempts INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE consignment_logs ADD COLUMN email_queued_at TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE consignment_logs ADD COLUMN email_last_error TEXT NOT NULL DEFAULT '';
