// Postgres port of the Muse SQLite schema. Every table lives in the
// `inventory` schema of the blue-bear-warehouse Supabase project.
import { bigint, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

const inv = pgSchema("inventory");
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const entries = inv.table("entries", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  text: text("text").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const parts = inv.table("parts", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const locations = inv.table("locations", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["warehouse", "truck"] }).notNull().default("warehouse"),
  assignedTo: text("assigned_to").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const stockLevels = inv.table("stock_levels", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  partId: integer("part_id").notNull(),
  locationId: integer("location_id").notNull(),
  quantity: integer("quantity").notNull().default(0),
  minQty: integer("min_qty").notNull().default(2),
});

export const orders = inv.table("orders", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  vendor: text("vendor").notNull(),
  poNumber: text("po_number").notNull().default(""),
  status: text("status", { enum: ["draft", "ordered", "in_transit", "partial", "received", "cancelled"] }).notNull().default("ordered"),
  eta: text("eta").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const orderLines = inv.table("order_lines", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  orderId: integer("order_id").notNull(),
  partId: integer("part_id"),
  partName: text("part_name").notNull(),
  sku: text("sku").notNull().default(""),
  qty: integer("qty").notNull().default(1),
  receivedQty: integer("received_qty").notNull().default(0),
  unitCost: integer("unit_cost_cents").notNull().default(0),
});

export const stagingJobs = inv.table("staging_jobs", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  customer: text("customer").notNull(),
  jobType: text("job_type").notNull().default("Service"),
  jobDate: text("job_date").notNull().default(""),
  truckLocationId: integer("truck_location_id"),
  // Pipeline (2026-10-30): done drops off the list; ServiceTitan completion sets it too.
  status: text("status", { enum: ["needs_parts", "parts_ordered", "parts_arrived", "scheduled", "done"] }).notNull().default("needs_parts"),
  notes: text("notes").notNull().default(""),
  // Set when the job was auto-pulled from ServiceTitan by stSyncStagingJobs.
  stJobId: bigint("st_job_id", { mode: "number" }),
  stJobNumber: text("st_job_number").notNull().default(""),
  stJobStatus: text("st_job_status").notNull().default(""),
  autoPulled: integer("auto_pulled").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const stagingLines = inv.table("staging_lines", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  stagingId: integer("staging_id").notNull(),
  partId: integer("part_id"),
  partName: text("part_name").notNull(),
  qty: integer("qty").notNull().default(1),
  pulled: integer("pulled").notNull().default(0),
  sourceLocationId: integer("source_location_id"),
});

export const techRequests = inv.table("tech_requests", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const equipment = inv.table("equipment", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: text("name").notNull(),
  category: text("category").notNull().default("Tool"),
  serialNumber: text("serial_number").notNull().default(""),
  assetTag: text("asset_tag").notNull().default(""),
  brandModel: text("brand_model").notNull().default(""),
  status: text("status", { enum: ["available", "in_use", "needs_repair", "out_of_service", "missing", "installed"] }).notNull().default("available"),
  condition: text("condition").notNull().default("good"),
  currentLocationId: integer("current_location_id"),
  assignedTo: text("assigned_to").notNull().default(""),
  notes: text("notes").notNull().default(""),
  // Consignment — equipment only. When isConsigned = 1, every move of this
  // piece writes a consignment_logs row with its owner email composed and
  // queued; server/src/mail.ts sends it.
  isConsigned: integer("is_consigned").notNull().default(0),
  consignmentOwner: text("consignment_owner").notNull().default(""),
  consignmentEmail: text("consignment_email").notNull().default(""),
  consignmentValueCents: integer("consignment_value_cents").notNull().default(0),
  consignmentNotes: text("consignment_notes").notNull().default(""),
  // Water heater flow (job-tied consigned units) + ServiceTitan write-back.
  // pulledAt = left the warehouse for a job (the supply house bills from this
  // date); installedAt = on the customer's home and written to their ST record.
  jobNumber: text("job_number").notNull().default(""),
  customerName: text("customer_name").notNull().default(""),
  pulledAt: ts("pulled_at"),
  installedAt: ts("installed_at"),
  stJobId: bigint("st_job_id", { mode: "number" }),
  stCustomerId: bigint("st_customer_id", { mode: "number" }),
  stLocationId: bigint("st_location_id", { mode: "number" }),
  stEquipmentId: bigint("st_equipment_id", { mode: "number" }),
  stSync: text("st_sync", { enum: ["n/a", "pending", "syncing", "ok", "error"] }).notNull().default("n/a"),
  stError: text("st_error").notNull().default(""),
  // Blue Bear water heater CAGE (owned stock, is_consigned = 0). whType links
  // to wh_types; receivedAt is the FIFO clock (falls back to createdAt). The
  // released* / techName / signature / afterHours fields hold the LATEST
  // sign-out — the per-event record is the wh_reorders row.
  whType: text("wh_type"),
  receivedAt: ts("received_at"),
  poNumber: text("po_number").notNull().default(""),
  releasedBy: text("released_by").notNull().default(""),
  releasedByName: text("released_by_name").notNull().default(""),
  techName: text("tech_name").notNull().default(""),
  signatureBlobKey: text("signature_blob_key").notNull().default(""),
  afterHours: integer("after_hours").notNull().default(0),
  fifoOverrideReason: text("fifo_override_reason").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// The six cage types and their pars (seeded by the migration).
export const whTypes = inv.table("wh_types", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  fuel: text("fuel").notNull().default(""),
  gallons: integer("gallons").notNull().default(0),
  par: integer("par").notNull().default(0),
  sort: integer("sort").notNull().default(0),
});

// One row per cage sign-out; doubles as the job-PO reorder tracker.
export const whReorders = inv.table("wh_reorders", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  whType: text("wh_type").notNull(),
  equipmentId: integer("equipment_id").notNull(),
  serialNumber: text("serial_number").notNull().default(""),
  jobNumber: text("job_number").notNull().default(""),
  status: text("status", { enum: ["open", "ordered", "received", "cancelled"] }).notNull().default("open"),
  poNumber: text("po_number").notNull().default(""),
  techName: text("tech_name").notNull().default(""),
  releasedBy: text("released_by").notNull().default(""),
  releasedByName: text("released_by_name").notNull().default(""),
  signatureBlobKey: text("signature_blob_key").notNull().default(""),
  afterHours: integer("after_hours").notNull().default(0),
  fifoOverrideReason: text("fifo_override_reason").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  orderedAt: ts("ordered_at"),
  orderedBy: text("ordered_by").notNull().default(""),
  receivedAt: ts("received_at"),
  receivedBy: text("received_by").notNull().default(""),
  receivedEquipmentId: integer("received_equipment_id"),
});

// Tuesday cage counts: a session plus a line per serial.
export const whCounts = inv.table("wh_counts", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  startedBy: text("started_by").notNull().default(""),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedBy: text("finished_by").notNull().default(""),
  finishedAt: ts("finished_at"),
  expected: integer("expected").notNull().default(0),
  scanned: integer("scanned").notNull().default(0),
  missing: integer("missing").notNull().default(0),
  unexpected: integer("unexpected").notNull().default(0),
});

export const whCountLines = inv.table("wh_count_lines", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  countId: integer("count_id").notNull(),
  equipmentId: integer("equipment_id"),
  serialNumber: text("serial_number").notNull().default(""),
  whType: text("wh_type").notNull().default(""),
  result: text("result", { enum: ["scanned", "missing", "unexpected"] }).notNull().default("scanned"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const consignmentLogs = inv.table("consignment_logs", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
  emailStatus: text("email_status", { enum: ["pending", "queued", "sending", "sent", "skipped", "failed"] }).notNull().default("pending"),
  emailSentAt: text("email_sent_at").notNull().default(""),
  // In-app outbox: the app composes and stores the exact notification
  // (subject + body) on the log row at move time with status "queued". The
  // sender (server/src/mail.ts, via Resend) claims a row ("sending"), sends
  // it verbatim with an idempotency key, then marks it sent or failed.
  emailSubject: text("email_subject").notNull().default(""),
  emailBody: text("email_body").notNull().default(""),
  emailAttempts: integer("email_attempts").notNull().default(0),
  emailQueuedAt: text("email_queued_at").notNull().default(""),
  emailLastError: text("email_last_error").notNull().default(""),
  // Set when the sender claims the row ("sending"); a stale claim is requeued.
  emailClaimedAt: ts("email_claimed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const equipmentLogs = inv.table("equipment_logs", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  equipmentId: integer("equipment_id").notNull(),
  // Same audit-trail rule as consignment_logs: movement history survives the
  // piece. equipmentName is the snapshot used once the unit itself is gone,
  // and equipmentRemoved flags every entry of a removed piece.
  equipmentName: text("equipment_name").notNull().default(""),
  equipmentRemoved: integer("equipment_removed").notNull().default(0),
  action: text("action", { enum: ["created", "checkout", "checkin", "transfer", "repair_out", "repair_in", "status_change", "note", "installed"] }).notNull().default("transfer"),
  fromLocationId: integer("from_location_id"),
  toLocationId: integer("to_location_id"),
  performedBy: text("performed_by").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const intakeVerifications = inv.table("intake_verifications", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
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
  createdAt: ts("created_at").notNull().defaultNow(),
});
