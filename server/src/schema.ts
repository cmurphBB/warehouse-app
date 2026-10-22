import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const entries = sqliteTable("entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const parts = sqliteTable("parts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sku: text("sku").notNull().default(""),
  category: text("category").notNull().default("General"),
  department: text("department").notNull().default("Other"),
  unit: text("unit").notNull().default("ea"),
  // PO pricing — maintained by the price-match engine in actions.ts from
  // order lines. avg = simple average of every priced PO line matched to
  // this part (Chris's rule: multiple prices → take the average).
  avgCostCents: integer("avg_cost_cents").notNull().default(0),
  lastCostCents: integer("last_cost_cents").notNull().default(0),
  priceCount: integer("price_count").notNull().default(0),
  lastVendor: text("last_vendor").notNull().default(""),
  lastPricedAt: text("last_priced_at").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const locations = sqliteTable("locations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["warehouse", "truck"] }).notNull().default("warehouse"),
  assignedTo: text("assigned_to").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const stockLevels = sqliteTable("stock_levels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  partId: integer("part_id").notNull(),
  locationId: integer("location_id").notNull(),
  quantity: integer("quantity").notNull().default(0),
  minQty: integer("min_qty").notNull().default(2),
});

export const orders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vendor: text("vendor").notNull(),
  poNumber: text("po_number").notNull().default(""),
  status: text("status", { enum: ["draft", "ordered", "in_transit", "partial", "received", "cancelled"] }).notNull().default("ordered"),
  eta: text("eta").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const orderLines = sqliteTable("order_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  partId: integer("part_id"),
  partName: text("part_name").notNull(),
  sku: text("sku").notNull().default(""),
  qty: integer("qty").notNull().default(1),
  receivedQty: integer("received_qty").notNull().default(0),
  unitCost: integer("unit_cost_cents").notNull().default(0),
});

export const stagingJobs = sqliteTable("staging_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer: text("customer").notNull(),
  jobType: text("job_type").notNull().default("Service"),
  jobDate: text("job_date").notNull().default(""),
  truckLocationId: integer("truck_location_id"),
  status: text("status", { enum: ["needed", "picking", "staged", "loaded", "done"] }).notNull().default("needed"),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const stagingLines = sqliteTable("staging_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stagingId: integer("staging_id").notNull(),
  partId: integer("part_id"),
  partName: text("part_name").notNull(),
  qty: integer("qty").notNull().default(1),
  pulled: integer("pulled").notNull().default(0),
  sourceLocationId: integer("source_location_id"),
});

export const techRequests = sqliteTable("tech_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  techName: text("tech_name").notNull(),
  partDescription: text("part_description").notNull(),
  qty: integer("qty").notNull().default(1),
  urgency: text("urgency", { enum: ["low", "normal", "urgent", "emergency"] }).notNull().default("normal"),
  jobRef: text("job_ref").notNull().default(""),
  status: text("status", { enum: ["new", "ordered", "ready", "picked_up", "cancelled"] }).notNull().default("new"),
  notes: text("notes").notNull().default(""),
  imageBlobKey: text("image_blob_key").notNull().default(""),
  aiPartName: text("ai_part_name").notNull().default(""),
  aiEquipment: text("ai_equipment").notNull().default(""),
  aiConfidence: text("ai_confidence").notNull().default(""),
  aiNotes: text("ai_notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const equipment = sqliteTable("equipment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default("Tool"),
  serialNumber: text("serial_number").notNull().default(""),
  assetTag: text("asset_tag").notNull().default(""),
  brandModel: text("brand_model").notNull().default(""),
  status: text("status", { enum: ["available", "in_use", "needs_repair", "out_of_service", "missing"] }).notNull().default("available"),
  condition: text("condition").notNull().default("good"),
  currentLocationId: integer("current_location_id"),
  assignedTo: text("assigned_to").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // Consignment — equipment only. When isConsigned = 1, every move of this
  // piece writes a consignment_logs row with the composed email queued for
  // the external dispatcher (the app itself never sends).
  isConsigned: integer("is_consigned").notNull().default(0),
  consignmentOwner: text("consignment_owner").notNull().default(""),
  consignmentEmail: text("consignment_email").notNull().default(""),
  consignmentValueCents: integer("consignment_value_cents").notNull().default(0),
  consignmentNotes: text("consignment_notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const consignmentLogs = sqliteTable("consignment_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id").notNull(),
  // Snapshot of the piece's identity, written when the entry is created (and
  // backfilled at removal time for older entries). The Consign tab is the
  // audit trail: entries are NEVER deleted with the equipment unit — when a
  // piece is removed, its entries stay, keep showing the piece's real name /
  // serial / tag from this snapshot, and are flagged equipmentRemoved = 1.
  equipmentName: text("equipment_name").notNull().default(""),
  serialNumber: text("serial_number").notNull().default(""),
  assetTag: text("asset_tag").notNull().default(""),
  equipmentRemoved: integer("equipment_removed").notNull().default(0),
  owner: text("owner").notNull().default(""),
  notifyEmail: text("notify_email").notNull().default(""),
  fromLocationId: integer("from_location_id"),
  toLocationId: integer("to_location_id"),
  action: text("action").notNull().default("transfer"),
  performedBy: text("performed_by").notNull().default(""),
  notes: text("notes").notNull().default(""),
  jobRef: text("job_ref").notNull().default(""),
  emailStatus: text("email_status", { enum: ["pending", "queued", "sent", "skipped", "failed"] }).notNull().default("pending"),
  emailSentAt: text("email_sent_at").notNull().default(""),
  // In-app outbox: the app itself composes and stores the exact notification
  // (subject + body) on the log row at move time with status "queued", so
  // the email the external dispatcher sends is the one recorded here — the
  // log is the outbox, not just a queue flag. The dispatcher reports back
  // via markConsignmentEmailSent / markConsignmentEmailFailed (the latter
  // writes its error text to emailLastError and never touches a sent row).
  emailSubject: text("email_subject").notNull().default(""),
  emailBody: text("email_body").notNull().default(""),
  emailAttempts: integer("email_attempts").notNull().default(0),
  emailQueuedAt: text("email_queued_at").notNull().default(""),
  emailLastError: text("email_last_error").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const equipmentLogs = sqliteTable("equipment_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  equipmentId: integer("equipment_id").notNull(),
  // Same audit-trail rule as consignment_logs: movement history survives the
  // piece. equipmentName is the snapshot used once the unit itself is gone,
  // and equipmentRemoved flags every entry of a removed piece.
  equipmentName: text("equipment_name").notNull().default(""),
  equipmentRemoved: integer("equipment_removed").notNull().default(0),
  action: text("action", { enum: ["created", "checkout", "checkin", "transfer", "repair_out", "repair_in", "status_change", "note"] }).notNull().default("transfer"),
  fromLocationId: integer("from_location_id"),
  toLocationId: integer("to_location_id"),
  performedBy: text("performed_by").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const intakeVerifications = sqliteTable("intake_verifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id"),
  vendor: text("vendor").notNull().default(""),
  poNumber: text("po_number").notNull().default(""),
  checkedBy: text("checked_by").notNull().default(""),
  verdict: text("verdict", { enum: ["match", "likely_match", "mismatch", "unclear"] }).notNull().default("unclear"),
  confidence: text("confidence").notNull().default(""),
  invoiceBlobKey: text("invoice_blob_key").notNull().default(""),
  partBlobKey: text("part_blob_key").notNull().default(""),
  invoiceVendor: text("invoice_vendor").notNull().default(""),
  invoicePoNumber: text("invoice_po_number").notNull().default(""),
  invoiceParts: text("invoice_parts").notNull().default(""),
  physicalPart: text("physical_part").notNull().default(""),
  summary: text("summary").notNull().default(""),
  discrepancies: text("discrepancies").notNull().default(""),
  recommendedAction: text("recommended_action").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
