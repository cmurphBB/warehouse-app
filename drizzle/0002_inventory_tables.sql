CREATE TABLE parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'General',
  unit TEXT NOT NULL DEFAULT 'ea',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'warehouse',
  assigned_to TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE stock_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 2
);
--> statement-breakpoint
CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor TEXT NOT NULL,
  po_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ordered',
  eta TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE order_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  part_id INTEGER,
  part_name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL DEFAULT 1,
  received_qty INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE staging_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'Service',
  job_date TEXT NOT NULL DEFAULT '',
  truck_location_id INTEGER,
  status TEXT NOT NULL DEFAULT 'needed',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE staging_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staging_id INTEGER NOT NULL,
  part_id INTEGER,
  part_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  pulled INTEGER NOT NULL DEFAULT 0,
  source_location_id INTEGER
);
--> statement-breakpoint
CREATE TABLE tech_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tech_name TEXT NOT NULL,
  part_description TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  urgency TEXT NOT NULL DEFAULT 'normal',
  job_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
