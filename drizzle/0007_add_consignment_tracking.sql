ALTER TABLE equipment ADD COLUMN is_consigned INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE equipment ADD COLUMN consignment_owner TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE equipment ADD COLUMN consignment_email TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE equipment ADD COLUMN consignment_value_cents INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE equipment ADD COLUMN consignment_notes TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE consignment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  owner TEXT NOT NULL DEFAULT '',
  notify_email TEXT NOT NULL DEFAULT '',
  from_location_id INTEGER,
  to_location_id INTEGER,
  action TEXT NOT NULL DEFAULT 'transfer',
  performed_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  job_ref TEXT NOT NULL DEFAULT '',
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_sent_at TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
