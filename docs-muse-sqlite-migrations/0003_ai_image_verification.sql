ALTER TABLE tech_requests ADD COLUMN image_blob_key TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE tech_requests ADD COLUMN ai_part_name TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE tech_requests ADD COLUMN ai_equipment TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE tech_requests ADD COLUMN ai_confidence TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE tech_requests ADD COLUMN ai_notes TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE TABLE intake_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  vendor TEXT NOT NULL DEFAULT '',
  po_number TEXT NOT NULL DEFAULT '',
  checked_by TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL DEFAULT 'unclear',
  confidence TEXT NOT NULL DEFAULT '',
  invoice_blob_key TEXT NOT NULL DEFAULT '',
  part_blob_key TEXT NOT NULL DEFAULT '',
  invoice_vendor TEXT NOT NULL DEFAULT '',
  invoice_po_number TEXT NOT NULL DEFAULT '',
  invoice_parts TEXT NOT NULL DEFAULT '',
  physical_part TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  discrepancies TEXT NOT NULL DEFAULT '',
  recommended_action TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
