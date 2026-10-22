CREATE TABLE equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Tool',
  serial_number TEXT NOT NULL DEFAULT '',
  asset_tag TEXT NOT NULL DEFAULT '',
  brand_model TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'available',
  condition TEXT NOT NULL DEFAULT 'good',
  current_location_id INTEGER,
  assigned_to TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE equipment_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  equipment_id INTEGER NOT NULL,
  action TEXT NOT NULL DEFAULT 'transfer',
  from_location_id INTEGER,
  to_location_id INTEGER,
  performed_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
