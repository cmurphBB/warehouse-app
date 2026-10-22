import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { asc, desc, eq } from "drizzle-orm";
import * as schema from "./schema";

export const DEPARTMENTS = ["Pipe & Tubing", "Fittings", "Valves", "HVAC Parts", "Fixtures & Trim", "Pumps, Filters & Water", "Electrical & Controls", "Hardware & Hangers", "Consumables & Safety", "Other"] as const;
export type Department = typeof DEPARTMENTS[number];

const CATEGORY_TO_DEPARTMENT: Record<string, string> = {
  "alarm": "Electrical & Controls",
  "bm": "Fittings",
  "ball valve": "Valves",
  "battery": "Electrical & Controls",
  "black nips": "Pipe & Tubing",
  "boiler": "HVAC Parts",
  "boiler / thermo": "HVAC Parts",
  "brass": "Fittings",
  "brass / refrigeration": "Fittings",
  "brass nips": "Pipe & Tubing",
  "condensate": "HVAC Parts",
  "consumables": "Consumables & Safety",
  "consumables / hand tool / hardware": "Consumables & Safety",
  "consumables / hardware": "Consumables & Safety",
  "consumables / safety": "Consumables & Safety",
  "contactor": "HVAC Parts",
  "disposal": "Fixtures & Trim",
  "electrical": "Electrical & Controls",
  "electrical / thermo": "Electrical & Controls",
  "faucet": "Fixtures & Trim",
  "filters": "Pumps, Filters & Water",
  "gas cock": "Valves",
  "gas flex": "Valves",
  "gauge": "HVAC Parts",
  "hvac": "HVAC Parts",
  "hangers, clips & clamps": "Hardware & Hangers",
  "hangers, clips & clamps / pipe & tubing": "Hardware & Hangers",
  "hardware": "Hardware & Hangers",
  "hydro": "HVAC Parts",
  "lavatory": "Fixtures & Trim",
  "liberty 331 / m18": "Pumps, Filters & Water",
  "maintenance": "Pumps, Filters & Water",
  "mega": "Fittings",
  "mixing valve": "Valves",
  "navien": "HVAC Parts",
  "nylon": "Fittings",
  "pvc": "Fittings",
  "pvc / refrigeration": "Fittings",
  "pvc — 1738 vent fittings": "Fittings",
  "pex": "Fittings",
  "pex pipe": "Pipe & Tubing",
  "pipe & tubing": "Pipe & Tubing",
  "plug": "Fittings",
  "propress": "Fittings",
  "pump": "Pumps, Filters & Water",
  "push": "Fittings",
  "refrigeration": "HVAC Parts",
  "safety": "Consumables & Safety",
  "sill": "Fixtures & Trim",
  "smoke pipe": "Pipe & Tubing",
  "stop": "Valves",
  "sweat": "Fittings",
  "tank": "HVAC Parts",
  "test cap": "Fittings",
  "thermo": "HVAC Parts",
  "toilet": "Fixtures & Trim",
  "toilet, faucet, lavatory": "Fixtures & Trim",
  "transformer": "HVAC Parts",
  "tub & shower": "Fixtures & Trim",
  "water test": "Pumps, Filters & Water",
  // generic UI categories
  "general": "Other",
  "plumbing": "Fittings",
  "water heaters": "HVAC Parts",
  "fittings": "Fittings",
  "valves": "Valves",
  "tools/consumables": "Consumables & Safety",
};

export function departmentForCategory(category: string): string {
  const key = (category || "").trim().toLowerCase();
  if (CATEGORY_TO_DEPARTMENT[key]) return CATEGORY_TO_DEPARTMENT[key];
  // heuristics for unseen categories
  if (key.includes("pipe") || key.includes("tubing") || key.includes("nip")) return "Pipe & Tubing";
  if (key.includes("valve") || key.includes("stop") || key.includes("cock") || key.includes("flex")) return "Valves";
  if (key.includes("electr") || key.includes("battery") || key.includes("alarm")) return "Electrical & Controls";
  if (key.includes("filter") || key.includes("pump") || key.includes("water")) return "Pumps, Filters & Water";
  if (key.includes("toilet") || key.includes("faucet") || key.includes("lav") || key.includes("shower") || key.includes("tub") || key.includes("disposal") || key.includes("sill")) return "Fixtures & Trim";
  if (key.includes("hanger") || key.includes("clamp") || key.includes("hardware")) return "Hardware & Hangers";
  if (key.includes("consum") || key.includes("safety")) return "Consumables & Safety";
  if (key.includes("hvac") || key.includes("boiler") || key.includes("thermo") || key.includes("refrig") || key.includes("navien") || key.includes("tank") || key.includes("hydro")) return "HVAC Parts";
  if (key.includes("fitting") || key.includes("propress") || key.includes("press") || key.includes("pvc") || key.includes("pex") || key.includes("brass") || key.includes("sweat") || key.includes("push")) return "Fittings";
  return "Other";
}

export function resolveDepartment(category: string, explicit?: string): string {
  if (explicit && explicit.trim() && (DEPARTMENTS as readonly string[]).includes(explicit.trim())) return explicit.trim();
  return departmentForCategory(category);
}

const partOut = z.object({ id: z.number(), name: z.string(), sku: z.string(), category: z.string(), department: z.string(), unit: z.string(), avgCostCents: z.number(), lastCostCents: z.number(), priceCount: z.number(), lastVendor: z.string(), lastPricedAt: z.string(), created_at: z.string() });
const locOut = z.object({ id: z.number(), name: z.string(), kind: z.string(), assignedTo: z.string(), created_at: z.string() });
const stockOut = z.object({ id: z.number(), partId: z.number(), locationId: z.number(), quantity: z.number(), minQty: z.number(), partName: z.string(), sku: z.string(), category: z.string(), department: z.string(), avgCostCents: z.number(), priceCount: z.number(), locationName: z.string(), locationKind: z.string() });
const partPriceOut = z.object({ partId: z.number(), partName: z.string(), sku: z.string(), vendor: z.string(), poNumber: z.string(), unitCostCents: z.number(), qty: z.number(), date: z.string() });
const orderLineOut = z.object({ id: z.number(), orderId: z.number(), partId: z.number().nullable(), partName: z.string(), sku: z.string(), qty: z.number(), receivedQty: z.number(), unitCostCents: z.number() });
const orderOut = z.object({ id: z.number(), vendor: z.string(), poNumber: z.string(), status: z.string(), eta: z.string(), notes: z.string(), created_at: z.string(), updated_at: z.string(), lines: z.array(orderLineOut), totalQty: z.number(), receivedQty: z.number() });
const stagingLineOut = z.object({ id: z.number(), stagingId: z.number(), partId: z.number().nullable(), partName: z.string(), qty: z.number(), pulled: z.boolean(), sourceLocationId: z.number().nullable() });
const stagingOut = z.object({ id: z.number(), customer: z.string(), jobType: z.string(), jobDate: z.string(), truckLocationId: z.number().nullable(), truckName: z.string(), status: z.string(), notes: z.string(), created_at: z.string(), lines: z.array(stagingLineOut) });
const techOut = z.object({ id: z.number(), techName: z.string(), partDescription: z.string(), qty: z.number(), urgency: z.string(), jobRef: z.string(), status: z.string(), notes: z.string(), imageUrl: z.string(), aiPartName: z.string(), aiEquipment: z.string(), aiConfidence: z.string(), aiNotes: z.string(), created_at: z.string() });
const intakeOut = z.object({ id: z.number(), orderId: z.number().nullable(), vendor: z.string(), poNumber: z.string(), checkedBy: z.string(), verdict: z.string(), confidence: z.string(), invoiceImageUrl: z.string(), partImageUrl: z.string(), invoiceVendor: z.string(), invoicePoNumber: z.string(), invoiceParts: z.string(), physicalPart: z.string(), summary: z.string(), discrepancies: z.string(), recommendedAction: z.string(), created_at: z.string() });
const equipmentOut = z.object({ id: z.number(), name: z.string(), category: z.string(), serialNumber: z.string(), assetTag: z.string(), brandModel: z.string(), status: z.string(), condition: z.string(), currentLocationId: z.number().nullable(), currentLocationName: z.string(), currentLocationKind: z.string(), assignedTo: z.string(), notes: z.string(), isConsigned: z.boolean(), consignmentOwner: z.string(), consignmentEmail: z.string(), consignmentValueCents: z.number(), consignmentNotes: z.string(), created_at: z.string(), updated_at: z.string() });
const equipmentLogOut = z.object({ id: z.number(), equipmentId: z.number(), equipmentName: z.string(), equipmentRemoved: z.boolean(), action: z.string(), fromLocationId: z.number().nullable(), fromLocationName: z.string(), toLocationId: z.number().nullable(), toLocationName: z.string(), performedBy: z.string(), notes: z.string(), created_at: z.string() });
const consignmentLogOut = z.object({ id: z.number(), equipmentId: z.number(), equipmentName: z.string(), equipmentRemoved: z.boolean(), serialNumber: z.string(), assetTag: z.string(), owner: z.string(), notifyEmail: z.string(), action: z.string(), fromLocationId: z.number().nullable(), fromLocationName: z.string(), toLocationId: z.number().nullable(), toLocationName: z.string(), performedBy: z.string(), notes: z.string(), jobRef: z.string(), emailStatus: z.string(), emailSentAt: z.string(), emailSubject: z.string(), emailBody: z.string(), emailAttempts: z.number(), emailQueuedAt: z.string(), emailLastError: z.string(), created_at: z.string() });

const getStateResponse = z.object({
  parts: z.array(partOut),
  locations: z.array(locOut),
  stock: z.array(stockOut),
  orders: z.array(orderOut),
  staging: z.array(stagingOut),
  techRequests: z.array(techOut),
  intakeVerifications: z.array(intakeOut),
  equipment: z.array(equipmentOut),
  equipmentLogs: z.array(equipmentLogOut),
  consignmentLogs: z.array(consignmentLogOut),
  consignmentByOwner: z.array(z.object({ owner: z.string(), email: z.string(), count: z.number(), valueCents: z.number(), locations: z.array(z.string()) })),
  partPrices: z.array(partPriceOut),
  stats: z.object({ totalParts: z.number(), totalLocations: z.number(), lowStockCount: z.number(), openOrders: z.number(), stagingNeeded: z.number(), newTechRequests: z.number(), totalUnits: z.number(), intakeChecks: z.number(), intakeMismatches: z.number(), totalEquipment: z.number(), equipmentNeedsRepair: z.number(), equipmentMissing: z.number(), equipmentInUse: z.number(), equipmentAvailable: z.number(), pricedParts: z.number(), pricedLines: z.number(), unmatchedPricedLines: z.number(), totalConsigned: z.number(), consignmentPendingEmails: z.number(), consignmentQueuedEmails: z.number(), consignmentFailedEmails: z.number(), consignmentActionableEmails: z.number(), consignmentStuckEmails: z.number(), consignmentValueCents: z.number(), consignmentMoves: z.number() }),
  warehouseDepartments: z.array(z.object({ department: z.string(), partCount: z.number(), stockRows: z.number(), totalUnits: z.number(), lowStockCount: z.number(), subcategories: z.array(z.object({ category: z.string(), count: z.number() })) })),
});

// ---------- PO price matching ----------
// Chris's rule (2026-10-21): daily POs get matched to catalog materials and
// when a material has multiple prices, its cost is the AVERAGE of them.
// Matching order: already-linked line → exact code (SKU) → code+name when a
// code is shared by several parts → exact normalized name. Anything that
// matches zero parts, or several parts with no way to tell them apart, is
// reported as unmatched/ambiguous and never priced by a guess.
export function normalizeSkuCode(s: string): string {
  return (s || "").trim().toUpperCase().replace(/[\s\-_]+/g, "");
}
export function normalizePartName(s: string): string {
  return (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

type MatchResult = { part: any | null; method: "linked" | "sku" | "sku+name" | "name" | "none" | "ambiguous"; candidates: number };

export function matchPartForLine(parts: any[], line: { partId?: number | null; sku?: string; partName?: string }): MatchResult {
  if (line.partId) {
    const p = parts.find((x: any) => x.id === line.partId);
    if (p) return { part: p, method: "linked", candidates: 1 };
  }
  const skuKey = normalizeSkuCode(line.sku ?? "");
  if (skuKey) {
    const bySku = parts.filter((x: any) => normalizeSkuCode(x.sku ?? "") === skuKey);
    if (bySku.length === 1) return { part: bySku[0], method: "sku", candidates: 1 };
    if (bySku.length > 1) {
      // Shared code (known in this catalog, e.g. PDOPE): use the name to pick
      // the right one among the parts carrying that code.
      const nameKey = normalizePartName(line.partName ?? "");
      const byName = bySku.filter((x: any) => normalizePartName(x.name) === nameKey);
      if (byName.length === 1) return { part: byName[0], method: "sku+name", candidates: bySku.length };
      return { part: null, method: "ambiguous", candidates: bySku.length };
    }
  }
  const nameKey = normalizePartName(line.partName ?? "");
  if (nameKey) {
    const byName = parts.filter((x: any) => normalizePartName(x.name) === nameKey);
    if (byName.length === 1) return { part: byName[0], method: "name", candidates: 1 };
    if (byName.length > 1) return { part: null, method: "ambiguous", candidates: byName.length };
  }
  return { part: null, method: "none", candidates: 0 };
}

type PriceObs = { unitCostCents: number; vendor: string; poNumber: string; dateMs: number; date: string; lineId: number };

// Rebuilds every part's PO pricing from scratch out of all non-cancelled
// order lines that carry a price. Idempotent: averages never double-count,
// and deleting/editing a PO re-prices correctly on the next run.
async function recomputePricing(db: any): Promise<{ pricedLines: number; matchedLines: number; unmatched: { partName: string; sku: string; unitCostCents: number; vendor: string; poNumber: string; reason: string }[]; partsPriced: number }> {
  const parts = await db.select().from(schema.parts);
  const orders = await db.select().from(schema.orders);
  const lines = await db.select().from(schema.orderLines);
  const orderMap = new Map<number, any>(orders.map((o: any) => [o.id, o] as [number, any]));
  const obsByPart = new Map<number, PriceObs[]>();
  const unmatched: { partName: string; sku: string; unitCostCents: number; vendor: string; poNumber: string; reason: string }[] = [];
  let pricedLines = 0; let matchedLines = 0;
  for (const line of lines) {
    const cost = line.unitCost ?? 0;
    if (!cost || cost <= 0) continue;
    const order = orderMap.get(line.orderId);
    if (!order || order.status === "cancelled") continue;
    pricedLines++;
    const m = matchPartForLine(parts, line);
    if (!m.part) {
      unmatched.push({ partName: line.partName, sku: line.sku ?? "", unitCostCents: cost, vendor: order.vendor, poNumber: order.poNumber ?? "", reason: m.method === "ambiguous" ? `Code/name matches ${m.candidates} different parts — can't tell which one` : "No catalog part with this code or name" });
      continue;
    }
    matchedLines++;
    // Link the line to the part it matched, so receiving + history use it too.
    if (!line.partId || line.partId !== m.part.id) {
      await db.update(schema.orderLines).set({ partId: m.part.id }).where(eq(schema.orderLines.id, line.id));
    }
    const arr = obsByPart.get(m.part.id) ?? [];
    const d = order.createdAt instanceof Date ? order.createdAt : new Date(order.createdAt);
    arr.push({ unitCostCents: cost, vendor: order.vendor, poNumber: order.poNumber ?? "", dateMs: d.getTime(), date: d.toISOString().slice(0, 10), lineId: line.id });
    obsByPart.set(m.part.id, arr);
  }
  for (const p of parts) {
    const obs = obsByPart.get(p.id) ?? [];
    if (obs.length === 0) {
      if ((p.avgCostCents ?? 0) !== 0 || (p.priceCount ?? 0) !== 0) {
        await db.update(schema.parts).set({ avgCostCents: 0, lastCostCents: 0, priceCount: 0, lastVendor: "", lastPricedAt: "" }).where(eq(schema.parts.id, p.id));
      }
      continue;
    }
    const avg = Math.round(obs.reduce((a, o) => a + o.unitCostCents, 0) / obs.length);
    const sorted = [...obs].sort((a, b) => b.dateMs - a.dateMs || b.lineId - a.lineId);
    const last = sorted[0]!;
    await db.update(schema.parts).set({ avgCostCents: avg, lastCostCents: last.unitCostCents, priceCount: obs.length, lastVendor: last.vendor, lastPricedAt: last.date }).where(eq(schema.parts.id, p.id));
  }
  return { pricedLines, matchedLines, unmatched, partsPriced: obsByPart.size };
}

const priceMatchSummary = z.object({ ok: z.boolean(), ordersCreated: z.number(), linesImported: z.number(), pricedLines: z.number(), matchedLines: z.number(), partsPriced: z.number(), unmatched: z.array(z.object({ partName: z.string(), sku: z.string(), unitCostCents: z.number(), vendor: z.string(), poNumber: z.string(), reason: z.string() })) });

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function mimeToExt(mime: string): string { return mime.includes("png") ? "png" : "jpg"; }
type GetState = z.infer<typeof getStateResponse>;

async function buildState(ctx: any): Promise<GetState> {
  const db: any = ctx.db();
  const [parts, locs, stockRows, orders, orderLines, staging, stagingLines, tech, intakes, equipmentRows, equipLogs, consignLogs] = await Promise.all([
    db.select().from(schema.parts).orderBy(asc(schema.parts.name)),
    db.select().from(schema.locations).orderBy(asc(schema.locations.name)),
    db.select().from(schema.stockLevels),
    db.select().from(schema.orders).orderBy(desc(schema.orders.createdAt)),
    db.select().from(schema.orderLines),
    db.select().from(schema.stagingJobs).orderBy(asc(schema.stagingJobs.jobDate)),
    db.select().from(schema.stagingLines),
    db.select().from(schema.techRequests).orderBy(desc(schema.techRequests.createdAt)),
    db.select().from(schema.intakeVerifications).orderBy(desc(schema.intakeVerifications.createdAt)),
    db.select().from(schema.equipment).orderBy(asc(schema.equipment.name)),
    db.select().from(schema.equipmentLogs).orderBy(desc(schema.equipmentLogs.createdAt)),
    db.select().from(schema.consignmentLogs).orderBy(desc(schema.consignmentLogs.createdAt)),
  ]);
  // Resolve blob URLs for photos
  const techWithUrls: any[] = [];
  for (const t of tech) {
    let imageUrl = "";
    if (t.imageBlobKey) { try { imageUrl = await ctx.blobs.getUrl(t.imageBlobKey); } catch { imageUrl = ""; } }
    techWithUrls.push({ id: t.id, techName: t.techName, partDescription: t.partDescription, qty: t.qty, urgency: t.urgency, jobRef: t.jobRef, status: t.status, notes: t.notes, imageUrl, aiPartName: t.aiPartName ?? "", aiEquipment: t.aiEquipment ?? "", aiConfidence: t.aiConfidence ?? "", aiNotes: t.aiNotes ?? "", created_at: t.createdAt.toISOString() });
  }
  const intakeWithUrls: any[] = [];
  for (const v of intakes) {
    let invoiceImageUrl = ""; let partImageUrl = "";
    if (v.invoiceBlobKey) { try { invoiceImageUrl = await ctx.blobs.getUrl(v.invoiceBlobKey); } catch { invoiceImageUrl = ""; } }
    if (v.partBlobKey) { try { partImageUrl = await ctx.blobs.getUrl(v.partBlobKey); } catch { partImageUrl = ""; } }
    intakeWithUrls.push({ id: v.id, orderId: v.orderId ?? null, vendor: v.vendor, poNumber: v.poNumber, checkedBy: v.checkedBy, verdict: v.verdict, confidence: v.confidence, invoiceImageUrl, partImageUrl, invoiceVendor: v.invoiceVendor, invoicePoNumber: v.invoicePoNumber, invoiceParts: v.invoiceParts, physicalPart: v.physicalPart, summary: v.summary, discrepancies: v.discrepancies, recommendedAction: v.recommendedAction, created_at: v.createdAt.toISOString() });
  }
  const partMap: Map<number, any> = new Map(parts.map((p: any) => [p.id, p] as [number, any]));
  const locMap: Map<number, any> = new Map(locs.map((l: any) => [l.id, l] as [number, any]));
  const deptOf = (p: any) => {
    const stored = (p?.department ?? "").trim();
    if (stored && stored !== "Other") return stored;
    // Fallback: derive from category so rows loaded before the migration still group correctly
    const derived = departmentForCategory(p?.category ?? "");
    if (derived !== "Other") return derived;
    return stored || "Other";
  };
  const stock = stockRows.map((s: any) => {
    const p = partMap.get(s.partId); const l = locMap.get(s.locationId);
    return { id: s.id, partId: s.partId, locationId: s.locationId, quantity: s.quantity, minQty: s.minQty, partName: p?.name ?? "Unknown part", sku: p?.sku ?? "", category: p?.category ?? "", department: p ? deptOf(p) : "Other", avgCostCents: p?.avgCostCents ?? 0, priceCount: p?.priceCount ?? 0, locationName: l?.name ?? "Unknown", locationKind: l?.kind ?? "warehouse" };
  });
  // PO price history per part (from priced, non-cancelled order lines),
  // newest first — powers the catalog price-history view and Board recents.
  const orderMapForPrices: Map<number, any> = new Map(orders.map((o: any) => [o.id, o] as [number, any]));
  const partPrices: any[] = [];
  let pricedLinesCount = 0; let unmatchedPricedLines = 0;
  for (const ol of orderLines) {
    const cost = ol.unitCost ?? 0;
    if (!cost || cost <= 0) continue;
    const o = orderMapForPrices.get(ol.orderId);
    if (!o || o.status === "cancelled") continue;
    pricedLinesCount++;
    const m = matchPartForLine(parts, ol);
    if (!m.part) { unmatchedPricedLines++; continue; }
    const d = o.createdAt instanceof Date ? o.createdAt : new Date(o.createdAt);
    partPrices.push({ partId: m.part.id, partName: m.part.name, sku: m.part.sku ?? "", vendor: o.vendor, poNumber: o.poNumber ?? "", unitCostCents: cost, qty: ol.qty, date: d.toISOString().slice(0, 10), _ms: d.getTime(), _lineId: ol.id });
  }
  partPrices.sort((a, b) => b._ms - a._ms || b._lineId - a._lineId);
  const partPricesOut = partPrices.slice(0, 600).map(({ _ms, _lineId, ...rest }: any) => rest);
  const ordersOut = orders.map((o: any) => {
    const lines = orderLines.filter((ol: any) => ol.orderId === o.id).map((ol: any) => ({ id: ol.id, orderId: ol.orderId, partId: ol.partId ?? null, partName: ol.partName, sku: ol.sku, qty: ol.qty, receivedQty: ol.receivedQty, unitCostCents: ol.unitCost }));
    return { id: o.id, vendor: o.vendor, poNumber: o.poNumber, status: o.status, eta: o.eta, notes: o.notes, created_at: o.createdAt.toISOString(), updated_at: o.updatedAt.toISOString(), lines, totalQty: lines.reduce((a: number, l: any) => a + l.qty, 0), receivedQty: lines.reduce((a: number, l: any) => a + l.receivedQty, 0) };
  });
  const stagingOut = staging.map((s: any) => {
    const lines = stagingLines.filter((sl: any) => sl.stagingId === s.id).map((sl: any) => ({ id: sl.id, stagingId: sl.stagingId, partId: sl.partId ?? null, partName: sl.partName, qty: sl.qty, pulled: sl.pulled === 1, sourceLocationId: sl.sourceLocationId ?? null }));
    const truck = s.truckLocationId ? locMap.get(s.truckLocationId) : null;
    return { id: s.id, customer: s.customer, jobType: s.jobType, jobDate: s.jobDate, truckLocationId: s.truckLocationId ?? null, truckName: truck?.name ?? "", status: s.status, notes: s.notes, created_at: s.createdAt.toISOString(), lines };
  });
  const lowStockCount = stock.filter((s: any) => s.quantity <= s.minQty).length;
  const equipMap: Map<number, any> = new Map(equipmentRows.map((e: any) => [e.id, e] as [number, any]));
  const equipmentOutList = equipmentRows.map((e: any) => {
    const loc = e.currentLocationId ? locMap.get(e.currentLocationId) : null;
    return { id: e.id, name: e.name, category: e.category, serialNumber: e.serialNumber ?? "", assetTag: e.assetTag ?? "", brandModel: e.brandModel ?? "", status: e.status, condition: e.condition ?? "good", currentLocationId: e.currentLocationId ?? null, currentLocationName: loc?.name ?? "Unassigned", currentLocationKind: loc?.kind ?? "", assignedTo: e.assignedTo ?? "", notes: e.notes ?? "", isConsigned: (e.isConsigned ?? 0) === 1, consignmentOwner: e.consignmentOwner ?? "", consignmentEmail: e.consignmentEmail ?? "", consignmentValueCents: e.consignmentValueCents ?? 0, consignmentNotes: e.consignmentNotes ?? "", created_at: e.createdAt.toISOString(), updated_at: e.updatedAt.toISOString() };
  });
  const equipmentLogsOut = equipLogs.slice(0, 200).map((l: any) => {
    const eq = equipMap.get(l.equipmentId);
    const fromLoc = l.fromLocationId ? locMap.get(l.fromLocationId) : null;
    const toLoc = l.toLocationId ? locMap.get(l.toLocationId) : null;
    // A removed piece's history stays in the log: the name comes from the
    // entry's snapshot once the unit itself is gone, flagged as removed.
    const removed = !eq || (l.equipmentRemoved ?? 0) === 1;
    return { id: l.id, equipmentId: l.equipmentId, equipmentName: eq?.name ?? ((l.equipmentName ?? "") || "Removed equipment"), equipmentRemoved: removed, action: l.action, fromLocationId: l.fromLocationId ?? null, fromLocationName: fromLoc?.name ?? "", toLocationId: l.toLocationId ?? null, toLocationName: toLoc?.name ?? "", performedBy: l.performedBy ?? "", notes: l.notes ?? "", created_at: l.createdAt.toISOString() };
  });
  const consignmentLogsOut = (consignLogs as any[]).slice(0, 300).map((l: any) => {
    const eq = equipMap.get(l.equipmentId);
    const fromLoc = l.fromLocationId ? locMap.get(l.fromLocationId) : null;
    const toLoc = l.toLocationId ? locMap.get(l.toLocationId) : null;
    const d = l.createdAt instanceof Date ? l.createdAt : new Date(l.createdAt);
    // Audit trail rule: consignment entries are never deleted with the unit.
    // Identity (name / serial / tag) falls back to the entry's own snapshot
    // and the entry is flagged removed, so the trail stays readable forever.
    const removed = !eq || (l.equipmentRemoved ?? 0) === 1;
    return { id: l.id, equipmentId: l.equipmentId, equipmentName: eq?.name ?? ((l.equipmentName ?? "") || "Removed equipment"), equipmentRemoved: removed, serialNumber: eq?.serialNumber ?? (l.serialNumber ?? ""), assetTag: eq?.assetTag ?? (l.assetTag ?? ""), owner: l.owner ?? "", notifyEmail: l.notifyEmail ?? "", action: l.action, fromLocationId: l.fromLocationId ?? null, fromLocationName: fromLoc?.name ?? "", toLocationId: l.toLocationId ?? null, toLocationName: toLoc?.name ?? "", performedBy: l.performedBy ?? "", notes: l.notes ?? "", jobRef: l.jobRef ?? "", emailStatus: l.emailStatus ?? "pending", emailSentAt: l.emailSentAt ?? "", emailSubject: l.emailSubject ?? "", emailBody: l.emailBody ?? "", emailAttempts: l.emailAttempts ?? 0, emailQueuedAt: l.emailQueuedAt ?? "", emailLastError: l.emailLastError ?? "", created_at: d.toISOString() };
  });
  // Consignment rollup by owner — what's consigned, where it sits, value on hand
  const consignedRows = (equipmentRows as any[]).filter((e: any) => (e.isConsigned ?? 0) === 1);
  const ownerMap = new Map<string, { owner: string; email: string; count: number; valueCents: number; locations: Set<string> }>();
  for (const e of consignedRows) {
    const owner = (e.consignmentOwner ?? "").trim() || "Unnamed owner";
    const key = owner.toLowerCase();
    const cur = ownerMap.get(key) ?? { owner, email: e.consignmentEmail ?? "", count: 0, valueCents: 0, locations: new Set<string>() };
    cur.count++;
    cur.valueCents += e.consignmentValueCents ?? 0;
    if (!cur.email && e.consignmentEmail) cur.email = e.consignmentEmail;
    const loc = e.currentLocationId ? locMap.get(e.currentLocationId) : null;
    cur.locations.add(loc?.name ?? "Unassigned");
    ownerMap.set(key, cur);
  }
  const consignmentByOwner = Array.from(ownerMap.values()).map(o => ({ owner: o.owner, email: o.email, count: o.count, valueCents: o.valueCents, locations: Array.from(o.locations).sort() })).sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner));
  // Warehouse department breakdown — based on warehouse locations only, so the
  // department cards reflect what's actually on warehouse shelves.
  const warehouseLocIds = new Set(locs.filter((l: any) => l.kind === "warehouse").map((l: any) => l.id));
  const warehouseStock = stock.filter((s: any) => warehouseLocIds.has(s.locationId));
  const warehouseDepartments = DEPARTMENTS.map((dept) => {
    const deptParts = parts.filter((p: any) => deptOf(p) === dept);
    const deptStock = warehouseStock.filter((s: any) => s.department === dept);
    // subcategories = original categories inside this department, with counts of distinct parts
    const subMap = new Map<string, number>();
    for (const p of deptParts) {
      const cat = (p.category || "General").trim() || "General";
      subMap.set(cat, (subMap.get(cat) ?? 0) + 1);
    }
    const subcategories = Array.from(subMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
    return {
      department: dept,
      partCount: deptParts.length,
      stockRows: deptStock.length,
      totalUnits: deptStock.reduce((a: number, s: any) => a + s.quantity, 0),
      lowStockCount: deptStock.filter((s: any) => s.quantity <= s.minQty).length,
      subcategories,
    };
  }).filter((d) => d.partCount > 0 || d.department !== "Other");

  return {
    parts: parts.map((p: any) => ({ id: p.id, name: p.name, sku: p.sku, category: p.category, department: deptOf(p), unit: p.unit, avgCostCents: p.avgCostCents ?? 0, lastCostCents: p.lastCostCents ?? 0, priceCount: p.priceCount ?? 0, lastVendor: p.lastVendor ?? "", lastPricedAt: p.lastPricedAt ?? "", created_at: p.createdAt.toISOString() })),
    partPrices: partPricesOut,
    locations: locs.map((l: any) => ({ id: l.id, name: l.name, kind: l.kind, assignedTo: l.assignedTo, created_at: l.createdAt.toISOString() })),
    stock,
    orders: ordersOut,
    staging: stagingOut,
    techRequests: techWithUrls,
    intakeVerifications: intakeWithUrls,
    equipment: equipmentOutList,
    equipmentLogs: equipmentLogsOut,
    consignmentLogs: consignmentLogsOut,
    consignmentByOwner,
    stats: { totalParts: parts.length, totalLocations: locs.length, lowStockCount, openOrders: orders.filter((o: any) => !["received", "cancelled"].includes(o.status)).length, stagingNeeded: staging.filter((s: any) => s.status === "needed" || s.status === "picking").length, newTechRequests: tech.filter((t: any) => t.status === "new").length, totalUnits: stock.reduce((a: number, s: any) => a + s.quantity, 0), intakeChecks: intakes.length, intakeMismatches: intakes.filter((v: any) => v.verdict === "mismatch").length, totalEquipment: equipmentRows.length, equipmentNeedsRepair: equipmentRows.filter((e: any) => e.status === "needs_repair" || e.status === "out_of_service").length, equipmentMissing: equipmentRows.filter((e: any) => e.status === "missing").length, equipmentInUse: equipmentRows.filter((e: any) => e.status === "in_use").length, equipmentAvailable: equipmentRows.filter((e: any) => e.status === "available").length, pricedParts: parts.filter((p: any) => (p.priceCount ?? 0) > 0).length, pricedLines: pricedLinesCount, unmatchedPricedLines, totalConsigned: consignedRows.length, consignmentPendingEmails: (consignLogs as any[]).filter((l: any) => l.emailStatus === "pending").length, consignmentQueuedEmails: (consignLogs as any[]).filter((l: any) => l.emailStatus === "queued" || l.emailStatus === "pending").length, consignmentFailedEmails: (consignLogs as any[]).filter((l: any) => l.emailStatus === "failed").length, consignmentActionableEmails: (consignLogs as any[]).filter((l: any) => l.emailStatus === "queued" || l.emailStatus === "pending" || l.emailStatus === "failed").length, consignmentStuckEmails: 0, consignmentValueCents: consignedRows.reduce((a: number, e: any) => a + (e.consignmentValueCents ?? 0), 0), consignmentMoves: (consignLogs as any[]).filter((l: any) => l.action !== "removed").length },
    warehouseDepartments,
  };
}

// ---- Consignment email outbox — compose-and-queue ONLY ----
// The app composes the owner's notification itself, at the moment the move
// is recorded, and stores the exact subject + body on the log row with
// status "queued". That row IS the outbox: the UI shows the precise email.
// The app NEVER sends mail itself and NEVER spawns a sender task. Sending
// is done exclusively by an external dispatcher that reads the queued
// entries (via dispatchConsignmentEmails), sends each one from Blue Bear
// Outlook verbatim, and reports back: markConsignmentEmailSent on success,
// markConsignmentEmailFailed (with the error text) on failure.
const CONSIGN_ACTION_LABEL: Record<string, string> = { created: "Placed into inventory", checkout: "Checked out", checkin: "Checked in", transfer: "Transferred", repair_out: "Sent for repair", repair_in: "Back from repair", status_change: "Status change", note: "Note" };

export function composeConsignmentEmail(input: { equipmentName: string; serialNumber?: string; assetTag?: string; brandModel?: string; owner: string; action: string; fromName: string; toName: string; performedBy: string; jobRef: string; notes: string; atIso: string }): { subject: string; body: string } {
  const ident = [input.serialNumber ? `S/N ${input.serialNumber}` : "", input.assetTag ? `Tag ${input.assetTag}` : "", input.brandModel ?? ""].filter(Boolean).join(" • ");
  const subject = `Consignment move: ${input.equipmentName} — ${input.fromName} → ${input.toName}`;
  const when = new Date(input.atIso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const lines = [
    `Hello ${input.owner || "there"},`,
    ``,
    `A consigned equipment piece owned by ${input.owner || "you"} was moved in the Blue Bear Inventory system.`,
    ``,
    `Equipment: ${input.equipmentName}${ident ? ` (${ident})` : ""}`,
    `Move: ${CONSIGN_ACTION_LABEL[input.action] ?? input.action}`,
    `From: ${input.fromName}`,
    `To: ${input.toName}`,
    `When: ${when} ET`,
    `Moved by: ${input.performedBy || "—"}`,
  ];
  if (input.jobRef) lines.push(`Job / reference: ${input.jobRef}`);
  if (input.notes) lines.push(`Notes: ${input.notes}`);
  lines.push(``, `This notification was generated automatically by Blue Bear Inventory when the move was recorded.`, ``, `— Blue Bear Plumbing, Heating & Air — Inventory`);
  return { subject, body: lines.join("\n") };
}

// Inserts a consignment log row with its email fully composed by the app
// and queued for the external dispatcher. Location names are resolved here
// so the stored email stays accurate even if locations are renamed later.
// Compose-and-queue only: this writes status "queued" + emailQueuedAt and
// NEVER spawns a sender — the external dispatcher does the sending.
async function insertConsignmentLog(db: any, args: { equipmentId: number; owner: string; notifyEmail: string; fromLocationId: number | null; toLocationId: number | null; action: string; performedBy: string; notes: string; jobRef: string }): Promise<{ id: number }> {
  const email = (args.notifyEmail ?? "").trim();
  const equipRows = await db.select().from(schema.equipment);
  const locRows = await db.select().from(schema.locations);
  const eq = (equipRows as any[]).find((e: any) => e.id === args.equipmentId);
  const locName = (id: number | null) => id ? ((locRows as any[]).find((l: any) => l.id === id)?.name ?? "Unknown location") : null;
  const fromName = args.fromLocationId ? (locName(args.fromLocationId) ?? "Unknown location") : "— (new / first placement)";
  const toName = args.toLocationId ? (locName(args.toLocationId) ?? "Unknown location") : "Unassigned";
  const nowIso = new Date().toISOString();
  const composed = email ? composeConsignmentEmail({ equipmentName: eq?.name ?? "Equipment", serialNumber: eq?.serialNumber ?? "", assetTag: eq?.assetTag ?? "", brandModel: eq?.brandModel ?? "", owner: args.owner, action: args.action, fromName, toName, performedBy: args.performedBy, jobRef: args.jobRef, notes: args.notes, atIso: nowIso }) : { subject: "", body: "" };
  const [cl] = await db.insert(schema.consignmentLogs).values({ equipmentId: args.equipmentId, equipmentName: eq?.name ?? "", serialNumber: eq?.serialNumber ?? "", assetTag: eq?.assetTag ?? "", equipmentRemoved: 0, owner: args.owner, notifyEmail: email, fromLocationId: args.fromLocationId, toLocationId: args.toLocationId, action: args.action, performedBy: args.performedBy, notes: args.notes, jobRef: args.jobRef, emailStatus: email ? "queued" : "skipped", emailSentAt: "", emailSubject: composed.subject, emailBody: composed.body, emailAttempts: 0, emailQueuedAt: email ? nowIso : "", emailLastError: "" }).returning({ id: schema.consignmentLogs.id });
  return { id: cl!.id };
}

// Kept for backwards compatibility with any stored references. In the
// compose-and-queue model there is no in-app sender, so nothing is ever
// "stuck" inside the app — a queued entry simply waits for the external
// dispatcher, however long that takes.
export const CONSIGNMENT_STUCK_MS = 10 * 60 * 1000;
export function isStuckQueued(_l: any, _nowMs: number): boolean {
  return false;
}

// Response shapes for the consignment dispatcher contract, hoisted so the
// literal/boolean types don't widen at the handler boundary.
const markSentResponse = z.object({ ok: z.boolean(), alreadySent: z.boolean(), message: z.string() });
const markFailedResponse = z.object({ ok: z.boolean(), alreadySent: z.boolean(), message: z.string() });
const dispatchReportResponse = z.object({
  ok: z.boolean(),
  pendingCount: z.number(),
  queuedCount: z.number(),
  recoveredCount: z.number(),
  queuedEntries: z.array(z.object({ id: z.number(), equipmentId: z.number(), equipmentName: z.string(), owner: z.string(), notifyEmail: z.string(), emailSubject: z.string(), emailBody: z.string(), emailQueuedAt: z.string(), created_at: z.string() })),
  message: z.string(),
});

export const Actions = {
  getState: defineAction({
    request: z.object({}),
    response: getStateResponse,
    async handler(ctx): Promise<GetState> { return buildState(ctx as any); },
  }),

  createPart: defineAction({
    request: z.object({ name: z.string().min(1), sku: z.string().default(""), category: z.string().default("General"), department: z.string().default(""), unit: z.string().default("ea") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const cat = args.category.trim() || "General";
      const dept = resolveDepartment(cat, args.department);
      const [r] = await db.insert(schema.parts).values({ name: args.name.trim(), sku: args.sku.trim(), category: cat, department: dept, unit: args.unit.trim() || "ea" }).returning({ id: schema.parts.id });
      ctx.invalidateQueries(); return { id: r!.id };
    },
  }),
  updatePart: defineAction({
    request: z.object({ id: z.number(), name: z.string().min(1), sku: z.string(), category: z.string(), department: z.string().default(""), unit: z.string() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const dept = resolveDepartment(args.category, args.department);
      await db.update(schema.parts).set({ name: args.name, sku: args.sku, category: args.category, department: dept, unit: args.unit }).where(eq(schema.parts.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  setPartDepartment: defineAction({
    request: z.object({ partId: z.number(), department: z.string().min(1) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const dept = (DEPARTMENTS as readonly string[]).includes(args.department) ? args.department : "Other";
      await db.update(schema.parts).set({ department: dept }).where(eq(schema.parts.id, args.partId));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  backfillDepartments: defineAction({
    request: z.object({}),
    response: z.object({ ok: z.boolean(), updated: z.number() }),
    async handler(ctx) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.parts);
      let updated = 0;
      for (const p of rows) {
        const derived = departmentForCategory(p.category);
        const current = (p as any).department as string | undefined;
        if (!current || current === "Other" || current.trim() === "") {
          if (derived !== "Other") {
            await db.update(schema.parts).set({ department: derived }).where(eq(schema.parts.id, p.id));
            updated++;
          }
        }
      }
      ctx.invalidateQueries(); return { ok: true, updated };
    },
  }),
  deletePart: defineAction({
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.stockLevels).where(eq(schema.stockLevels.partId, args.id));
      await db.delete(schema.parts).where(eq(schema.parts.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  createLocation: defineAction({
    request: z.object({ name: z.string().min(1), kind: z.enum(["warehouse", "truck"]), assignedTo: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [r] = await db.insert(schema.locations).values({ name: args.name.trim(), kind: args.kind, assignedTo: args.assignedTo.trim() }).returning({ id: schema.locations.id });
      ctx.invalidateQueries(); return { id: r!.id };
    },
  }),
  upsertStock: defineAction({
    request: z.object({ partId: z.number(), locationId: z.number(), quantity: z.number().int().min(0), minQty: z.number().int().min(0).default(2) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const existing = await db.select().from(schema.stockLevels).where(eq(schema.stockLevels.partId, args.partId));
      const match = existing.find((e: any) => e.locationId === args.locationId);
      if (match) await db.update(schema.stockLevels).set({ quantity: args.quantity, minQty: args.minQty }).where(eq(schema.stockLevels.id, match.id));
      else await db.insert(schema.stockLevels).values({ partId: args.partId, locationId: args.locationId, quantity: args.quantity, minQty: args.minQty });
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  adjustStock: defineAction({
    request: z.object({ stockId: z.number(), delta: z.number().int() }),
    response: z.object({ ok: z.boolean(), newQty: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [row] = await db.select().from(schema.stockLevels).where(eq(schema.stockLevels.id, args.stockId));
      if (!row) return { ok: false, newQty: 0 };
      const newQty = Math.max(0, row.quantity + args.delta);
      await db.update(schema.stockLevels).set({ quantity: newQty }).where(eq(schema.stockLevels.id, args.stockId));
      ctx.invalidateQueries(); return { ok: true, newQty };
    },
  }),
  transferStock: defineAction({
    request: z.object({ partId: z.number(), fromLocationId: z.number(), toLocationId: z.number(), qty: z.number().int().positive() }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const all = await db.select().from(schema.stockLevels).where(eq(schema.stockLevels.partId, args.partId));
      const from = all.find((s: any) => s.locationId === args.fromLocationId);
      if (!from || from.quantity < args.qty) return { ok: false, message: "Not enough stock at source" };
      const to = all.find((s: any) => s.locationId === args.toLocationId);
      await db.update(schema.stockLevels).set({ quantity: from.quantity - args.qty }).where(eq(schema.stockLevels.id, from.id));
      if (to) await db.update(schema.stockLevels).set({ quantity: to.quantity + args.qty }).where(eq(schema.stockLevels.id, to.id));
      else await db.insert(schema.stockLevels).values({ partId: args.partId, locationId: args.toLocationId, quantity: args.qty, minQty: from.minQty });
      ctx.invalidateQueries(); return { ok: true, message: "Transferred" };
    },
  }),
  transferStockBulk: defineAction({
    request: z.object({
      fromLocationId: z.number(),
      toLocationId: z.number(),
      items: z.array(z.object({ partId: z.number(), qty: z.number().int().positive() })).min(1).max(500),
    }),
    response: z.object({
      ok: z.boolean(),
      transferredCount: z.number(),
      totalUnits: z.number(),
      message: z.string(),
      failed: z.array(z.object({ partId: z.number(), partName: z.string(), qty: z.number(), reason: z.string() })),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      if (args.fromLocationId === args.toLocationId) {
        return { ok: false, transferredCount: 0, totalUnits: 0, message: "Source and destination are the same location", failed: [] };
      }
      // Merge duplicate partIds (sum quantities) so a part listed twice
      // in the sheet transfers once with the combined amount.
      const merged = new Map<number, number>();
      for (const it of args.items) merged.set(it.partId, (merged.get(it.partId) ?? 0) + it.qty);
      const partRows = await db.select().from(schema.parts);
      const partMap = new Map<number, any>(partRows.map((p: any) => [p.id, p] as [number, any]));
      const allStock = await db.select().from(schema.stockLevels);
      const failed: { partId: number; partName: string; qty: number; reason: string }[] = [];
      let transferredCount = 0;
      let totalUnits = 0;
      for (const [partId, qty] of merged.entries()) {
        const partName = partMap.get(partId)?.name ?? `Part #${partId}`;
        const from = allStock.find((s: any) => s.partId === partId && s.locationId === args.fromLocationId);
        if (!from) { failed.push({ partId, partName, qty, reason: "No stock row at the source location" }); continue; }
        if (from.quantity < qty) { failed.push({ partId, partName, qty, reason: `Only ${from.quantity} on hand at source` }); continue; }
        const to = allStock.find((s: any) => s.partId === partId && s.locationId === args.toLocationId);
        await db.update(schema.stockLevels).set({ quantity: from.quantity - qty }).where(eq(schema.stockLevels.id, from.id));
        // Keep the in-memory copy in sync in case of any later lookup.
        (from as any).quantity = from.quantity - qty;
        if (to) {
          await db.update(schema.stockLevels).set({ quantity: to.quantity + qty }).where(eq(schema.stockLevels.id, to.id));
          (to as any).quantity = to.quantity + qty;
        } else {
          const [created] = await db.insert(schema.stockLevels).values({ partId, locationId: args.toLocationId, quantity: qty, minQty: from.minQty }).returning({ id: schema.stockLevels.id });
          allStock.push({ id: created!.id, partId, locationId: args.toLocationId, quantity: qty, minQty: from.minQty } as any);
        }
        transferredCount++;
        totalUnits += qty;
      }
      ctx.invalidateQueries();
      const ok = failed.length === 0 && transferredCount > 0;
      const message = transferredCount === 0
        ? "Nothing transferred — check the quantities and source stock"
        : failed.length === 0
          ? `Transferred ${totalUnits} units across ${transferredCount} part${transferredCount === 1 ? "" : "s"}`
          : `Transferred ${totalUnits} units across ${transferredCount} part${transferredCount === 1 ? "" : "s"} — ${failed.length} item${failed.length === 1 ? "" : "s"} could not move`;
      return { ok, transferredCount, totalUnits, message, failed };
    },
  }),

  createOrder: defineAction({
    request: z.object({ vendor: z.string().min(1), poNumber: z.string().default(""), eta: z.string().default(""), notes: z.string().default(""), status: z.enum(["draft", "ordered", "in_transit", "partial", "received", "cancelled"]).default("ordered"), lines: z.array(z.object({ partId: z.number().nullable().default(null), partName: z.string().min(1), sku: z.string().default(""), qty: z.number().int().positive(), unitCostCents: z.number().int().min(0).default(0) })).default([]) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [o] = await db.insert(schema.orders).values({ vendor: args.vendor.trim(), poNumber: args.poNumber, eta: args.eta, notes: args.notes, status: args.status }).returning({ id: schema.orders.id });
      const oid = o!.id;
      for (const l of args.lines) await db.insert(schema.orderLines).values({ orderId: oid, partId: l.partId, partName: l.partName, sku: l.sku, qty: l.qty, unitCost: l.unitCostCents });
      if (args.lines.some(l => l.unitCostCents > 0)) await recomputePricing(db as any);
      ctx.invalidateQueries(); return { id: oid };
    },
  }),
  updateOrder: defineAction({
    request: z.object({ id: z.number(), status: z.enum(["draft", "ordered", "in_transit", "partial", "received", "cancelled"]).optional(), eta: z.string().optional(), notes: z.string().optional(), vendor: z.string().optional(), poNumber: z.string().optional() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const patch: any = { updatedAt: new Date() };
      if (args.status !== undefined) patch.status = args.status;
      if (args.eta !== undefined) patch.eta = args.eta;
      if (args.notes !== undefined) patch.notes = args.notes;
      if (args.vendor !== undefined) patch.vendor = args.vendor;
      if (args.poNumber !== undefined) patch.poNumber = args.poNumber;
      await db.update(schema.orders).set(patch).where(eq(schema.orders.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  addOrderLine: defineAction({
    request: z.object({ orderId: z.number(), partId: z.number().nullable().default(null), partName: z.string().min(1), sku: z.string().default(""), qty: z.number().int().positive(), unitCostCents: z.number().int().min(0).default(0) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [r] = await db.insert(schema.orderLines).values({ orderId: args.orderId, partId: args.partId, partName: args.partName, sku: args.sku, qty: args.qty, unitCost: args.unitCostCents }).returning({ id: schema.orderLines.id });
      if (args.unitCostCents > 0) await recomputePricing(db as any);
      ctx.invalidateQueries(); return { id: r!.id };
    },
  }),
  receiveOrderLine: defineAction({
    request: z.object({ lineId: z.number(), qty: z.number().int().positive(), warehouseLocationId: z.number().nullable().default(null) }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [line] = await db.select().from(schema.orderLines).where(eq(schema.orderLines.id, args.lineId));
      if (!line) return { ok: false, message: "Line not found" };
      const newReceived = Math.min(line.qty, line.receivedQty + args.qty);
      const actual = newReceived - line.receivedQty;
      await db.update(schema.orderLines).set({ receivedQty: newReceived }).where(eq(schema.orderLines.id, args.lineId));
      // add to stock if we know part + warehouse
      let partId = line.partId;
      if (!partId) {
        // try match by name/sku to existing part, else create part
        const parts = await db.select().from(schema.parts);
        const match = parts.find((p: any) => p.name.toLowerCase() === line.partName.toLowerCase() || (line.sku && p.sku === line.sku));
        if (match) partId = match.id;
        else { const [np] = await db.insert(schema.parts).values({ name: line.partName, sku: line.sku, category: "General", department: "Other", unit: "ea" }).returning({ id: schema.parts.id }); partId = np!.id; await db.update(schema.orderLines).set({ partId }).where(eq(schema.orderLines.id, args.lineId)); }
      }
      if (args.warehouseLocationId && partId && actual > 0) {
        const stock = await db.select().from(schema.stockLevels).where(eq(schema.stockLevels.partId, partId));
        const s = stock.find((x: any) => x.locationId === args.warehouseLocationId);
        if (s) await db.update(schema.stockLevels).set({ quantity: s.quantity + actual }).where(eq(schema.stockLevels.id, s.id));
        else await db.insert(schema.stockLevels).values({ partId, locationId: args.warehouseLocationId, quantity: actual, minQty: 2 });
      }
      // update order status
      const allLines = await db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, line.orderId));
      const allReceived = allLines.every((l: any) => (l.id === args.lineId ? newReceived : l.receivedQty) >= l.qty);
      const anyReceived = allLines.some((l: any) => (l.id === args.lineId ? newReceived : l.receivedQty) > 0);
      const newStatus = allReceived ? "received" : anyReceived ? "partial" : undefined;
      if (newStatus) await db.update(schema.orders).set({ status: newStatus as any, updatedAt: new Date() }).where(eq(schema.orders.id, line.orderId));
      ctx.invalidateQueries(); return { ok: true, message: `Received ${actual}` };
    },
  }),
  deleteOrder: defineAction({
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.orderLines).where(eq(schema.orderLines.orderId, args.id));
      await db.delete(schema.orders).where(eq(schema.orders.id, args.id));
      await recomputePricing(db as any);
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  importPoLines: defineAction({
    request: z.object({
      vendor: z.string().default(""),
      notes: z.string().default(""),
      lines: z.array(z.object({
        vendor: z.string().default(""),
        poNumber: z.string().default(""),
        sku: z.string().default(""),
        partName: z.string().min(1),
        qty: z.number().int().positive().default(1),
        unitCostCents: z.number().int().min(0).default(0),
      })).min(1).max(2000),
    }),
    response: priceMatchSummary,
    async handler(ctx, args): Promise<z.infer<typeof priceMatchSummary>> {
      const db = ctx.db<typeof schema>();
      // Group lines into POs by vendor + PO number (a daily PO export usually
      // holds several POs; rows without a PO number group under the vendor).
      const groups = new Map<string, { vendor: string; poNumber: string; lines: typeof args.lines }>();
      for (const l of args.lines) {
        const vendor = (l.vendor || args.vendor || "Daily PO import").trim() || "Daily PO import";
        const poNumber = (l.poNumber || "").trim();
        const key = `${vendor.toLowerCase()}|${poNumber.toLowerCase()}`;
        const g = groups.get(key) ?? { vendor, poNumber, lines: [] as typeof args.lines };
        g.lines.push(l);
        groups.set(key, g);
      }
      let ordersCreated = 0;
      for (const g of groups.values()) {
        const [o] = await db.insert(schema.orders).values({ vendor: g.vendor, poNumber: g.poNumber, eta: "", notes: args.notes || "Imported from daily PO — prices matched to materials (multi-price = average)", status: "ordered" }).returning({ id: schema.orders.id });
        const oid = o!.id;
        ordersCreated++;
        for (const l of g.lines) {
          await db.insert(schema.orderLines).values({ orderId: oid, partId: null, partName: l.partName.trim(), sku: (l.sku || "").trim(), qty: l.qty, unitCost: l.unitCostCents });
        }
      }
      const r = await recomputePricing(db as any);
      ctx.invalidateQueries();
      return { ok: true, ordersCreated, linesImported: args.lines.length, pricedLines: r.pricedLines, matchedLines: r.matchedLines, partsPriced: r.partsPriced, unmatched: r.unmatched.slice(0, 100) };
    },
  }),
  recalcPricing: defineAction({
    request: z.object({}),
    response: priceMatchSummary,
    async handler(ctx): Promise<z.infer<typeof priceMatchSummary>> {
      const db = ctx.db<typeof schema>();
      const r = await recomputePricing(db as any);
      ctx.invalidateQueries();
      return { ok: true, ordersCreated: 0, linesImported: 0, pricedLines: r.pricedLines, matchedLines: r.matchedLines, partsPriced: r.partsPriced, unmatched: r.unmatched.slice(0, 100) };
    },
  }),
  updateOrderLine: defineAction({
    request: z.object({ lineId: z.number(), unitCostCents: z.number().int().min(0), partId: z.number().nullable().default(null) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const patch: any = { unitCost: args.unitCostCents };
      if (args.partId) patch.partId = args.partId;
      await db.update(schema.orderLines).set(patch).where(eq(schema.orderLines.id, args.lineId));
      await recomputePricing(db as any);
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  createStaging: defineAction({
    request: z.object({ customer: z.string().min(1), jobType: z.string().default("Service"), jobDate: z.string().default(""), truckLocationId: z.number().nullable().default(null), notes: z.string().default(""), lines: z.array(z.object({ partId: z.number().nullable().default(null), partName: z.string().min(1), qty: z.number().int().positive(), sourceLocationId: z.number().nullable().default(null) })).default([]) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [s] = await db.insert(schema.stagingJobs).values({ customer: args.customer.trim(), jobType: args.jobType, jobDate: args.jobDate, truckLocationId: args.truckLocationId, notes: args.notes, status: "needed" }).returning({ id: schema.stagingJobs.id });
      const sid = s!.id;
      for (const l of args.lines) await db.insert(schema.stagingLines).values({ stagingId: sid, partId: l.partId, partName: l.partName, qty: l.qty, sourceLocationId: l.sourceLocationId, pulled: 0 });
      ctx.invalidateQueries(); return { id: sid };
    },
  }),
  updateStagingStatus: defineAction({
    request: z.object({ id: z.number(), status: z.enum(["needed", "picking", "staged", "loaded", "done"]) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.update(schema.stagingJobs).set({ status: args.status }).where(eq(schema.stagingJobs.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  addStagingLine: defineAction({
    request: z.object({ stagingId: z.number(), partId: z.number().nullable().default(null), partName: z.string().min(1), qty: z.number().int().positive(), sourceLocationId: z.number().nullable().default(null) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [r] = await db.insert(schema.stagingLines).values({ stagingId: args.stagingId, partId: args.partId, partName: args.partName, qty: args.qty, sourceLocationId: args.sourceLocationId, pulled: 0 }).returning({ id: schema.stagingLines.id });
      ctx.invalidateQueries(); return { id: r!.id };
    },
  }),
  toggleStagingLine: defineAction({
    request: z.object({ lineId: z.number(), pulled: z.boolean() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.update(schema.stagingLines).set({ pulled: args.pulled ? 1 : 0 }).where(eq(schema.stagingLines.id, args.lineId));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  loadStagingToTruck: defineAction({
    request: z.object({ stagingId: z.number() }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [job] = await db.select().from(schema.stagingJobs).where(eq(schema.stagingJobs.id, args.stagingId));
      if (!job || !job.truckLocationId) return { ok: false, message: "No truck assigned to this job" };
      const lines = await db.select().from(schema.stagingLines).where(eq(schema.stagingLines.stagingId, args.stagingId));
      for (const line of lines) {
        if (!line.partId) continue;
        // deduct from source (or warehouse default: any location with stock)
        const stock = await db.select().from(schema.stockLevels).where(eq(schema.stockLevels.partId, line.partId));
        let source = line.sourceLocationId ? stock.find((s: any) => s.locationId === line.sourceLocationId) : stock.find((s: any) => s.quantity >= line.qty);
        if (!source) source = stock[0];
        if (source && source.locationId !== job.truckLocationId) {
          const deduct = Math.min(source.quantity, line.qty);
          await db.update(schema.stockLevels).set({ quantity: source.quantity - deduct }).where(eq(schema.stockLevels.id, source.id));
          const dest = stock.find((s: any) => s.locationId === job.truckLocationId);
          if (dest) await db.update(schema.stockLevels).set({ quantity: dest.quantity + deduct }).where(eq(schema.stockLevels.id, dest.id));
          else await db.insert(schema.stockLevels).values({ partId: line.partId, locationId: job.truckLocationId, quantity: deduct, minQty: 2 });
        }
        await db.update(schema.stagingLines).set({ pulled: 1 }).where(eq(schema.stagingLines.id, line.id));
      }
      await db.update(schema.stagingJobs).set({ status: "loaded" }).where(eq(schema.stagingJobs.id, args.stagingId));
      ctx.invalidateQueries(); return { ok: true, message: "Loaded to truck" };
    },
  }),
  deleteStaging: defineAction({
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.stagingLines).where(eq(schema.stagingLines.stagingId, args.id));
      await db.delete(schema.stagingJobs).where(eq(schema.stagingJobs.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  createTechRequest: defineAction({
    request: z.object({ techName: z.string().min(1), partDescription: z.string().min(1), qty: z.number().int().positive().default(1), urgency: z.enum(["low", "normal", "urgent", "emergency"]).default("normal"), jobRef: z.string().default(""), notes: z.string().default(""), imageDataBase64: z.string().default(""), imageMimeType: z.string().default("image/jpeg"), aiPartName: z.string().default(""), aiEquipment: z.string().default(""), aiConfidence: z.string().default(""), aiNotes: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      let imageBlobKey = "";
      if (args.imageDataBase64) {
        const ext = mimeToExt(args.imageMimeType || "image/jpeg");
        imageBlobKey = `tech-req/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        try {
          const bytes = base64ToBytes(args.imageDataBase64);
          await ctx.blobs.put(imageBlobKey, bytes.buffer as ArrayBuffer, { contentType: args.imageMimeType || "image/jpeg" });
        } catch { imageBlobKey = ""; }
      }
      const [r] = await db.insert(schema.techRequests).values({ techName: args.techName.trim(), partDescription: args.partDescription.trim(), qty: args.qty, urgency: args.urgency, jobRef: args.jobRef, notes: args.notes, status: "new", imageBlobKey, aiPartName: args.aiPartName, aiEquipment: args.aiEquipment, aiConfidence: args.aiConfidence, aiNotes: args.aiNotes }).returning({ id: schema.techRequests.id });
      ctx.invalidateQueries(); return { id: r!.id };
    },
  }),

  analyzePartPhoto: defineAction({
    request: z.object({ dataBase64: z.string().min(10), mimeType: z.string().default("image/jpeg"), hint: z.string().default("") }),
    response: z.object({ partName: z.string(), partDescription: z.string(), equipmentType: z.string(), equipmentBrandModel: z.string(), confidence: z.string(), reasoning: z.string(), alternatives: z.array(z.string()), suggestedQtyNote: z.string() }),
    async handler(ctx, args) {
      const mime = (args.mimeType === "image/png" ? "image/png" : "image/jpeg") as "image/jpeg" | "image/png";
      const schemaOut = z.object({
        partName: z.string().describe("Short name of the part identified, e.g. Flame Sensor, Hot Surface Ignitor, Moen 1225 Cartridge"),
        partDescription: z.string().describe("Full specific description a warehouse person can order from: brand, type, size/model details visible"),
        equipmentType: z.string().describe("Equipment in photo, e.g. Gas Furnace, Boiler, Water Heater, Faucet, AC Condenser, or Unknown"),
        equipmentBrandModel: z.string().describe("Brand and model/serial read from nameplate or markings, or empty if not readable"),
        confidence: z.enum(["high", "medium", "low"]).describe("How confident the identification is"),
        reasoning: z.string().describe("1-2 sentences: what visual clues led to this ID"),
        alternatives: z.array(z.string()).describe("Other plausible parts if uncertain, up to 3"),
        suggestedQtyNote: z.string().describe("Any note about quantity, wear, or condition"),
      });
      const hintText = args.hint.trim() ? `\nTech's note / spoken request: "${args.hint.trim()}" — use this context. Example: if they say they need a flame sensor for this furnace, identify the flame sensor location/type for that furnace even if the photo shows the whole furnace.` : "";
      const result = await ctx.inference.complete(
        `You are a veteran HVAC and plumbing parts counter expert helping a field tech identify a part from a photo. Look at the photo carefully: read any nameplate, model number, brand, markings, and the shape/condition of the part or equipment.${hintText}\nIdentify the specific part the tech most likely needs. Be specific enough to order: include type, and any size/model detail you can see. If the photo shows a whole furnace/boiler/appliance, identify the requested component on it. If you cannot tell, say so with low confidence and list alternatives. Do not invent a model number you cannot read.`,
        { schema: schemaOut, images: [{ dataBase64: args.dataBase64, mimeType: mime, caption: "Tech photo of equipment / part needing identification" }] }
      );
      return { partName: result.partName, partDescription: result.partDescription, equipmentType: result.equipmentType, equipmentBrandModel: result.equipmentBrandModel, confidence: result.confidence, reasoning: result.reasoning, alternatives: result.alternatives, suggestedQtyNote: result.suggestedQtyNote };
    },
  }),

  verifyIntake: defineAction({
    request: z.object({
      orderId: z.number().nullable().default(null),
      vendor: z.string().default(""),
      poNumber: z.string().default(""),
      checkedBy: z.string().default(""),
      expectedParts: z.string().default(""),
      invoiceDataBase64: z.string().default(""),
      invoiceMimeType: z.string().default("image/jpeg"),
      partDataBase64: z.string().default(""),
      partMimeType: z.string().default("image/jpeg"),
    }),
    response: z.object({ id: z.number(), verdict: z.string(), confidence: z.string(), invoiceVendor: z.string(), invoicePoNumber: z.string(), invoiceParts: z.string(), physicalPart: z.string(), summary: z.string(), discrepancies: z.string(), recommendedAction: z.string() }),
    async handler(ctx, args) {
      // Each photo is analyzed in its OWN single-image inference call (far more
      // reliable than one combined multi-image call), then a text-only call
      // compares the two readings. A leg that fails degrades to a note, not a
      // total failure.
      let invoiceBlobKey = ""; let partBlobKey = "";
      const hasInvoice = !!args.invoiceDataBase64;
      const hasPart = !!args.partDataBase64;
      if (!hasInvoice && !hasPart) throw new Error("Add at least one photo — the invoice/PO or the part itself.");
      if (hasInvoice) {
        const mime = (args.invoiceMimeType === "image/png" ? "image/png" : "image/jpeg") as "image/jpeg" | "image/png";
        invoiceBlobKey = `intake/${Date.now()}-invoice.${mimeToExt(mime)}`;
        try { const b = base64ToBytes(args.invoiceDataBase64); await ctx.blobs.put(invoiceBlobKey, b.buffer as ArrayBuffer, { contentType: mime }); } catch { invoiceBlobKey = ""; }
      }
      if (hasPart) {
        const mime = (args.partMimeType === "image/png" ? "image/png" : "image/jpeg") as "image/jpeg" | "image/png";
        partBlobKey = `intake/${Date.now()}-part.${mimeToExt(mime)}`;
        try { const b = base64ToBytes(args.partDataBase64); await ctx.blobs.put(partBlobKey, b.buffer as ArrayBuffer, { contentType: mime }); } catch { partBlobKey = ""; }
      }

      // Leg 1: read the paperwork
      let invoiceReading = { vendor: "", poNumber: "", parts: [] as string[], legible: false, notes: "No invoice/PO photo provided." };
      if (hasInvoice) {
        try {
          const s = z.object({
            vendor: z.string().describe("Vendor name on the document, or empty if unreadable"),
            poNumber: z.string().describe("PO or invoice number on the document, or empty"),
            parts: z.array(z.string()).describe("Each line item as 'Part name (SKU/model) xQty'"),
            legible: z.boolean().describe("True if the document text was readable"),
            notes: z.string().describe("Anything else notable: totals, damage notes, unreadable areas"),
          });
          const r = await ctx.inference.complete(
            `Read this PO, invoice, or packing slip photo from a plumbing/HVAC delivery. Extract the vendor, the PO/invoice number, and every line item with part name, SKU/model, and quantity. If text is unreadable or this is not a document, set legible to false and say what you actually see in notes. Do not invent numbers you cannot read.`,
            { schema: s, images: [{ dataBase64: args.invoiceDataBase64, mimeType: (args.invoiceMimeType === "image/png" ? "image/png" : "image/jpeg") as "image/jpeg" | "image/png", caption: "PO / invoice / packing slip photo" }] }
          );
          invoiceReading = { vendor: r.vendor, poNumber: r.poNumber, parts: r.parts, legible: r.legible, notes: r.notes };
        } catch { invoiceReading = { vendor: "", poNumber: "", parts: [], legible: false, notes: "The invoice photo could not be analyzed — it may be blurry or unreadable. Retake it flat, well-lit, with line items in frame." }; }
      }

      // Leg 2: identify the physical part
      let partReading = { identified: "", markings: "", condition: "", legible: false };
      if (hasPart) {
        try {
          const s = z.object({
            identified: z.string().describe("What this physical part actually is, specific enough to compare against an invoice line"),
            markings: z.string().describe("Brand, model, SKU, stamped or label text readable on the part/packaging, or empty"),
            condition: z.string().describe("Apparent condition: new in box, loose, damaged, used, etc."),
            legible: z.boolean().describe("True if the part is clearly visible enough to identify"),
          });
          const r = await ctx.inference.complete(
            `Identify the physical part in this photo, taken at a plumbing/HVAC warehouse receiving bench. Name what it is, read any brand/model/label/markings, and note its condition. If the photo is too dark, blurry, or ambiguous to identify, set legible to false and describe only what is actually visible. Do not guess a brand or model you cannot see.`,
            { schema: s, images: [{ dataBase64: args.partDataBase64, mimeType: (args.partMimeType === "image/png" ? "image/png" : "image/jpeg") as "image/jpeg" | "image/png", caption: "Actual physical part received at the shop" }] }
          );
          partReading = { identified: r.identified, markings: r.markings, condition: r.condition, legible: r.legible };
        } catch { partReading = { identified: "", markings: "", condition: "", legible: false }; }
      }

      // Leg 3: text-only comparison of the two readings
      const schemaOut = z.object({
        verdict: z.enum(["match", "likely_match", "mismatch", "unclear"]).describe("match = physical part clearly matches invoice/PO; likely_match = probably matches but a detail is unreadable; mismatch = physical part does NOT match invoice; unclear = not enough info from the readings"),
        confidence: z.enum(["high", "medium", "low"]),
        summary: z.string().describe("Plain-language verdict in 1-3 sentences for warehouse staff"),
        discrepancies: z.array(z.string()).describe("Each mismatch or concern. Empty if none."),
        recommendedAction: z.string().describe("What to do next: e.g. Receive into stock, Hold — do not stock, contact vendor, retake photo"),
      });
      const expected = args.expectedParts.trim() ? args.expectedParts.trim() : "(none provided)";
      const result = await ctx.inference.complete(
        `You are the receiving checker at a plumbing/HVAC warehouse. Two photo readings were taken of a delivery:\n\nPAPERWORK READING (PO/invoice photo): vendor="${invoiceReading.vendor}", po/invoice #="${invoiceReading.poNumber}", legible=${invoiceReading.legible}, line items=[${invoiceReading.parts.join("; ")}], notes="${invoiceReading.notes}"\n\nPHYSICAL PART READING (photo of the actual part at the shop): identified="${partReading.identified}", markings="${partReading.markings}", condition="${partReading.condition}", clearly visible=${partReading.legible}\n\nORDER CONTEXT: vendor selected="${args.vendor}", PO #="${args.poNumber}", expected parts from the system PO: ${expected}\n\nDecide: does the physical part that arrived match what the paperwork/system says should have arrived? Use mismatch only when the readings clearly conflict. Use unclear when either reading is missing or illegible — never guess a match. If the paperwork reading failed but the part matches the system-expected parts, likely_match is the strongest verdict available.`,
        { schema: schemaOut }
      );
      const physicalPartStr = [partReading.identified, partReading.markings, partReading.condition].filter(Boolean).join(" — ") || (hasPart ? "Part photo could not be analyzed — retake it well-lit with the label in frame." : "");
      const resultFull = { ...result, invoiceVendor: invoiceReading.vendor || args.vendor, invoicePoNumber: invoiceReading.poNumber || args.poNumber, invoiceParts: invoiceReading.parts, physicalPartIdentified: physicalPartStr };
      const db = ctx.db<typeof schema>();
      const invoicePartsStr = resultFull.invoiceParts.join("; ");
      const discrepanciesStr = result.discrepancies.join("; ");
      const [r] = await db.insert(schema.intakeVerifications).values({
        orderId: args.orderId, vendor: args.vendor, poNumber: args.poNumber, checkedBy: args.checkedBy,
        verdict: result.verdict, confidence: result.confidence,
        invoiceBlobKey, partBlobKey,
        invoiceVendor: resultFull.invoiceVendor, invoicePoNumber: resultFull.invoicePoNumber, invoiceParts: invoicePartsStr,
        physicalPart: resultFull.physicalPartIdentified, summary: result.summary, discrepancies: discrepanciesStr, recommendedAction: result.recommendedAction,
      }).returning({ id: schema.intakeVerifications.id });
      ctx.invalidateQueries();
      return { id: r!.id, verdict: result.verdict, confidence: result.confidence, invoiceVendor: resultFull.invoiceVendor, invoicePoNumber: resultFull.invoicePoNumber, invoiceParts: invoicePartsStr, physicalPart: resultFull.physicalPartIdentified, summary: result.summary, discrepancies: discrepanciesStr, recommendedAction: result.recommendedAction };
    },
  }),

  deleteIntakeVerification: defineAction({
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.intakeVerifications).where(eq(schema.intakeVerifications.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  updateTechRequest: defineAction({
    request: z.object({ id: z.number(), status: z.enum(["new", "ordered", "ready", "picked_up", "cancelled"]) }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.update(schema.techRequests).set({ status: args.status }).where(eq(schema.techRequests.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  deleteTechRequest: defineAction({
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.delete(schema.techRequests).where(eq(schema.techRequests.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  createEquipment: defineAction({
    request: z.object({ name: z.string().min(1), category: z.string().default("Tool"), serialNumber: z.string().default(""), assetTag: z.string().default(""), brandModel: z.string().default(""), status: z.enum(["available", "in_use", "needs_repair", "out_of_service", "missing"]).default("available"), condition: z.string().default("good"), currentLocationId: z.number().nullable().default(null), assignedTo: z.string().default(""), notes: z.string().default(""), performedBy: z.string().default(""), isConsigned: z.boolean().default(false), consignmentOwner: z.string().default(""), consignmentEmail: z.string().default(""), consignmentValueCents: z.number().int().min(0).default(0), consignmentNotes: z.string().default("") }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const isConsigned = args.isConsigned ? 1 : 0;
      const [r] = await db.insert(schema.equipment).values({ name: args.name.trim(), category: args.category.trim() || "Tool", serialNumber: args.serialNumber.trim(), assetTag: args.assetTag.trim(), brandModel: args.brandModel.trim(), status: args.status, condition: args.condition, currentLocationId: args.currentLocationId, assignedTo: args.assignedTo.trim(), notes: args.notes.trim(), isConsigned, consignmentOwner: args.consignmentOwner.trim(), consignmentEmail: args.consignmentEmail.trim(), consignmentValueCents: args.consignmentValueCents, consignmentNotes: args.consignmentNotes.trim() }).returning({ id: schema.equipment.id });
      const eid = r!.id;
      await db.insert(schema.equipmentLogs).values({ equipmentId: eid, equipmentName: args.name.trim(), equipmentRemoved: 0, action: "created", fromLocationId: null, toLocationId: args.currentLocationId, performedBy: args.performedBy.trim(), notes: args.notes.trim() ? `Added: ${args.notes.trim()}` : "Equipment added to inventory" });
      // Initial placement of a consigned piece is its first consignment log
      // entry — composed and queued for the external dispatcher (no send here).
      if (isConsigned === 1) {
        const email = args.consignmentEmail.trim();
        await insertConsignmentLog(db as any, { equipmentId: eid, owner: args.consignmentOwner.trim(), notifyEmail: email, fromLocationId: null, toLocationId: args.currentLocationId, action: "created", performedBy: args.performedBy.trim(), notes: args.consignmentNotes.trim() || "Consigned equipment placed into inventory", jobRef: "" });
      }
      ctx.invalidateQueries(); return { id: eid };
    },
  }),
  updateEquipment: defineAction({
    request: z.object({ id: z.number(), name: z.string().min(1), category: z.string(), serialNumber: z.string(), assetTag: z.string(), brandModel: z.string(), condition: z.string(), assignedTo: z.string(), notes: z.string(), isConsigned: z.boolean().default(false), consignmentOwner: z.string().default(""), consignmentEmail: z.string().default(""), consignmentValueCents: z.number().int().min(0).default(0), consignmentNotes: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      await db.update(schema.equipment).set({ name: args.name.trim(), category: args.category, serialNumber: args.serialNumber, assetTag: args.assetTag, brandModel: args.brandModel, condition: args.condition, assignedTo: args.assignedTo, notes: args.notes, isConsigned: args.isConsigned ? 1 : 0, consignmentOwner: args.consignmentOwner.trim(), consignmentEmail: args.consignmentEmail.trim(), consignmentValueCents: args.consignmentValueCents, consignmentNotes: args.consignmentNotes.trim(), updatedAt: new Date() }).where(eq(schema.equipment.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  setEquipmentConsignment: defineAction({
    request: z.object({ equipmentId: z.number(), isConsigned: z.boolean(), consignmentOwner: z.string().default(""), consignmentEmail: z.string().default(""), consignmentValueCents: z.number().int().min(0).default(0), consignmentNotes: z.string().default(""), performedBy: z.string().default("") }),
    response: z.object({ ok: z.boolean(), message: z.string() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [eqRow] = await db.select().from(schema.equipment).where(eq(schema.equipment.id, args.equipmentId));
      if (!eqRow) return { ok: false, message: "Equipment not found" };
      const wasConsigned = (eqRow as any).isConsigned === 1;
      await db.update(schema.equipment).set({ isConsigned: args.isConsigned ? 1 : 0, consignmentOwner: args.consignmentOwner.trim(), consignmentEmail: args.consignmentEmail.trim(), consignmentValueCents: args.consignmentValueCents, consignmentNotes: args.consignmentNotes.trim(), updatedAt: new Date() }).where(eq(schema.equipment.id, args.equipmentId));
      // Turning consignment ON records where the piece sits right now as the
      // starting point — composed and queued, never sent by the app itself.
      if (args.isConsigned && !wasConsigned) {
        const email = args.consignmentEmail.trim();
        await insertConsignmentLog(db as any, { equipmentId: args.equipmentId, owner: args.consignmentOwner.trim(), notifyEmail: email, fromLocationId: null, toLocationId: eqRow.currentLocationId ?? null, action: "created", performedBy: args.performedBy.trim(), notes: args.consignmentNotes.trim() || "Marked as consigned — starting location recorded", jobRef: "" });
      }
      ctx.invalidateQueries();
      return { ok: true, message: args.isConsigned ? "Consignment on — moves will be logged and an owner email queued for the external dispatcher" : "Consignment off — moves will no longer queue owner emails" };
    },
  }),
  deleteEquipment: defineAction({
    request: z.object({ id: z.number() }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [eqRow] = await db.select().from(schema.equipment).where(eq(schema.equipment.id, args.id));
      if (!eqRow) return { ok: false };
      // AUDIT TRAIL RULE: the log tables are never deleted with the unit.
      // The Consign tab is the consignment audit trail and the movement log
      // is the piece's history — both must survive the piece itself. Before
      // the unit row goes, stamp every one of its log entries with the
      // piece's identity (for entries written before snapshots existed) and
      // flag them as belonging to a removed piece.
      const snapName = eqRow.name ?? "";
      const snapSerial = (eqRow as any).serialNumber ?? "";
      const snapTag = (eqRow as any).assetTag ?? "";
      const existingConsign = await db.select().from(schema.consignmentLogs).where(eq(schema.consignmentLogs.equipmentId, args.id));
      for (const l of existingConsign as any[]) {
        await db.update(schema.consignmentLogs).set({ equipmentRemoved: 1, equipmentName: (l.equipmentName ?? "").trim() || snapName, serialNumber: (l.serialNumber ?? "").trim() || snapSerial, assetTag: (l.assetTag ?? "").trim() || snapTag }).where(eq(schema.consignmentLogs.id, l.id));
      }
      const existingMoves = await db.select().from(schema.equipmentLogs).where(eq(schema.equipmentLogs.equipmentId, args.id));
      for (const l of existingMoves as any[]) {
        await db.update(schema.equipmentLogs).set({ equipmentRemoved: 1, equipmentName: (l.equipmentName ?? "").trim() || snapName }).where(eq(schema.equipmentLogs.id, l.id));
      }
      // Close each history with a removal entry so the trail itself shows
      // when the piece left inventory — not just a badge on older entries.
      const lastLocationId = eqRow.currentLocationId ?? null;
      await db.insert(schema.equipmentLogs).values({ equipmentId: args.id, equipmentName: snapName, equipmentRemoved: 1, action: "note", fromLocationId: lastLocationId, toLocationId: null, performedBy: "", notes: "Piece removed from inventory — its movement history is kept in this log" });
      if ((eqRow as any).isConsigned === 1 || existingConsign.length > 0) {
        await db.insert(schema.consignmentLogs).values({ equipmentId: args.id, equipmentName: snapName, serialNumber: snapSerial, assetTag: snapTag, equipmentRemoved: 1, owner: (eqRow as any).consignmentOwner ?? "", notifyEmail: (eqRow as any).consignmentEmail ?? "", fromLocationId: lastLocationId, toLocationId: null, action: "removed", performedBy: "", notes: "Piece removed from inventory — its consignment history is kept in this log", jobRef: "", emailStatus: "skipped", emailSentAt: "", emailSubject: "", emailBody: "", emailAttempts: 0, emailQueuedAt: "", emailLastError: "" });
      }
      // Only the unit itself is deleted. Its logs stay.
      await db.delete(schema.equipment).where(eq(schema.equipment.id, args.id));
      ctx.invalidateQueries(); return { ok: true };
    },
  }),
  moveEquipment: defineAction({
    request: z.object({ equipmentId: z.number(), toLocationId: z.number().nullable(), action: z.enum(["checkout", "checkin", "transfer", "repair_out", "repair_in", "status_change", "note"]).default("transfer"), newStatus: z.enum(["available", "in_use", "needs_repair", "out_of_service", "missing"]).nullable().default(null), assignedTo: z.string().default(""), performedBy: z.string().default(""), notes: z.string().default(""), jobRef: z.string().default("") }),
    response: z.object({ ok: z.boolean(), message: z.string(), consignmentLogged: z.boolean(), consignmentEmailQueued: z.boolean() }),
    async handler(ctx, args): Promise<{ ok: boolean; message: string; consignmentLogged: boolean; consignmentEmailQueued: boolean }> {
      const db = ctx.db<typeof schema>();
      const [eqRow] = await db.select().from(schema.equipment).where(eq(schema.equipment.id, args.equipmentId));
      if (!eqRow) return { ok: false, message: "Equipment not found", consignmentLogged: false, consignmentEmailQueued: false };
      const fromLocationId = eqRow.currentLocationId ?? null;
      const toLocationId = args.toLocationId !== null && args.toLocationId !== undefined ? args.toLocationId : fromLocationId;
      // Derive status if not explicitly provided
      let status = args.newStatus ?? eqRow.status;
      if (!args.newStatus) {
        if (args.action === "checkout") status = "in_use";
        else if (args.action === "checkin") status = "available";
        else if (args.action === "repair_out") status = "needs_repair";
        else if (args.action === "repair_in") status = "available";
      }
      const patch: any = { updatedAt: new Date(), status };
      if (args.toLocationId !== null && args.toLocationId !== undefined) patch.currentLocationId = args.toLocationId;
      if (args.assignedTo !== undefined) patch.assignedTo = args.assignedTo;
      await db.update(schema.equipment).set(patch).where(eq(schema.equipment.id, args.equipmentId));
      await db.insert(schema.equipmentLogs).values({ equipmentId: args.equipmentId, equipmentName: eqRow.name, equipmentRemoved: 0, action: args.action, fromLocationId, toLocationId, performedBy: args.performedBy.trim(), notes: args.notes.trim() });
      // Consignment hook — equipment only. A move counts when the location
      // changes OR the action is a physical move (checkout / checkin /
      // transfer / repair). A note-only entry with no location change is not
      // a move and does not email the owner.
      const isConsigned = (eqRow as any).isConsigned === 1;
      const locationChanged = fromLocationId !== toLocationId;
      const isMoveAction = ["checkout", "checkin", "transfer", "repair_out", "repair_in"].includes(args.action);
      const countsAsMove = locationChanged || isMoveAction;
      let consignmentLogged = false;
      let consignmentEmailQueued = false;
      if (isConsigned && countsAsMove && args.action !== "note") {
        const owner = ((eqRow as any).consignmentOwner ?? "").trim();
        const email = ((eqRow as any).consignmentEmail ?? "").trim();
        // Compose-and-queue only: the log entry carries the exact
        // emailSubject/emailBody with status "queued". The app does not
        // send it and does not spawn a sender — the external dispatcher
        // sends it from Outlook and reports back.
        await insertConsignmentLog(db as any, { equipmentId: args.equipmentId, owner, notifyEmail: email, fromLocationId, toLocationId, action: args.action, performedBy: args.performedBy.trim(), notes: args.notes.trim(), jobRef: args.jobRef.trim() });
        consignmentLogged = true;
        consignmentEmailQueued = !!email;
      }
      ctx.invalidateQueries();
      const message = consignmentLogged
        ? !consignmentEmailQueued
          ? "Equipment movement logged — consignment move recorded (no owner email on file, notification skipped)"
          : "Equipment movement logged — consignment email composed and queued for the external dispatcher"
        : "Equipment movement logged";
      return { ok: true, message, consignmentLogged, consignmentEmailQueued };
    },
  }),
  updateEquipmentStatus: defineAction({
    request: z.object({ id: z.number(), status: z.enum(["available", "in_use", "needs_repair", "out_of_service", "missing"]), performedBy: z.string().default(""), notes: z.string().default("") }),
    response: z.object({ ok: z.boolean() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [eqRow] = await db.select().from(schema.equipment).where(eq(schema.equipment.id, args.id));
      if (!eqRow) return { ok: false };
      await db.update(schema.equipment).set({ status: args.status, updatedAt: new Date() }).where(eq(schema.equipment.id, args.id));
      await db.insert(schema.equipmentLogs).values({ equipmentId: args.id, equipmentName: eqRow.name, equipmentRemoved: 0, action: "status_change", fromLocationId: eqRow.currentLocationId ?? null, toLocationId: eqRow.currentLocationId ?? null, performedBy: args.performedBy, notes: args.notes || `Status changed ${eqRow.status} → ${args.status}` });
      ctx.invalidateQueries(); return { ok: true };
    },
  }),

  // ---- Consignment email outbox — compose-and-queue contract ----
  // Every consignment move writes its notification INTO the app first: the
  // log row carries the exact subject + body the app composed, with status
  // "queued". The app never sends and never spawns a sender task. An
  // external dispatcher reads the queued entries via
  // dispatchConsignmentEmails, sends each stored email verbatim from Blue
  // Bear Outlook, then reports the outcome back here:
  //   success → markConsignmentEmailSent
  //   failure → markConsignmentEmailFailed (error text → emailLastError)
  // An entry already marked "sent" is final: neither callback may change it.
  markConsignmentEmailSent: defineAction({
    request: z.object({ logId: z.number(), status: z.enum(["sent", "failed"]).default("sent"), error: z.string().default("") }),
    response: markSentResponse,
    async handler(ctx, args): Promise<z.infer<typeof markSentResponse>> {
      const db = ctx.db<typeof schema>();
      const [row] = await db.select().from(schema.consignmentLogs).where(eq(schema.consignmentLogs.id, args.logId));
      if (!row) return { ok: false, alreadySent: false, message: "That log entry no longer exists" };
      // Already-sent is final — a late or duplicate callback (including a
      // "failed" report for a mail that did go out) must never flip it.
      if ((row as any).emailStatus === "sent") {
        return { ok: true, alreadySent: true, message: "Already marked sent — left unchanged" };
      }
      if (args.status === "sent") {
        await db.update(schema.consignmentLogs).set({ emailStatus: "sent", emailSentAt: new Date().toISOString(), emailQueuedAt: "", emailLastError: "", emailAttempts: ((row as any).emailAttempts ?? 0) + 1 }).where(eq(schema.consignmentLogs.id, args.logId));
        ctx.invalidateQueries();
        return { ok: true, alreadySent: false, message: "Marked sent" };
      }
      // Backwards-compatible failed report through this action; the
      // dedicated markConsignmentEmailFailed action is the preferred path.
      const errorText = (args.error || "Delivery failed — no reason reported.").slice(0, 1000);
      await db.update(schema.consignmentLogs).set({ emailStatus: "failed", emailQueuedAt: "", emailLastError: errorText, emailAttempts: ((row as any).emailAttempts ?? 0) + 1 }).where(eq(schema.consignmentLogs.id, args.logId));
      ctx.invalidateQueries();
      return { ok: true, alreadySent: false, message: "Marked failed with the error recorded" };
    },
  }),
  markConsignmentEmailFailed: defineAction({
    request: z.object({ logId: z.number(), error: z.string().default(""), emailLastError: z.string().default("") }),
    response: markFailedResponse,
    async handler(ctx, args): Promise<z.infer<typeof markFailedResponse>> {
      const db = ctx.db<typeof schema>();
      const [row] = await db.select().from(schema.consignmentLogs).where(eq(schema.consignmentLogs.id, args.logId));
      if (!row) return { ok: false, alreadySent: false, message: "That log entry no longer exists" };
      // Never overwrite a delivered notification: if the external
      // dispatcher already reported this entry sent, a failure report
      // (stale, duplicated, or for a different attempt) changes nothing.
      if ((row as any).emailStatus === "sent") {
        return { ok: false, alreadySent: true, message: "Already marked sent — failure not recorded, entry left unchanged" };
      }
      const errorText = ((args.error || args.emailLastError || "").trim() || "Delivery failed — no reason reported.").slice(0, 1000);
      await db.update(schema.consignmentLogs).set({ emailStatus: "failed", emailQueuedAt: "", emailLastError: errorText, emailAttempts: ((row as any).emailAttempts ?? 0) + 1 }).where(eq(schema.consignmentLogs.id, args.logId));
      ctx.invalidateQueries();
      return { ok: true, alreadySent: false, message: "Failure recorded on the entry (emailLastError)" };
    },
  }),
  retryConsignmentEmail: defineAction({
    request: z.object({ logId: z.number() }),
    response: z.object({ ok: z.boolean(), queued: z.boolean(), message: z.string() }),
    async handler(ctx, args): Promise<{ ok: boolean; queued: boolean; message: string }> {
      const db = ctx.db<typeof schema>();
      const [row] = await db.select().from(schema.consignmentLogs).where(eq(schema.consignmentLogs.id, args.logId));
      if (!row) return { ok: false, queued: false, message: "That log entry no longer exists" };
      if ((row as any).emailStatus === "sent") return { ok: false, queued: false, message: "That email was already sent — nothing to re-queue" };
      if (!(row as any).notifyEmail?.trim()) return { ok: false, queued: false, message: "No owner email on file for this entry — add one on the equipment first" };
      // Re-queue only: put the entry back to "queued" for the external
      // dispatcher. The app does not send it and spawns nothing.
      await db.update(schema.consignmentLogs).set({ emailStatus: "queued", emailSentAt: "", emailQueuedAt: new Date().toISOString(), emailLastError: "" }).where(eq(schema.consignmentLogs.id, args.logId));
      ctx.invalidateQueries();
      return { ok: true, queued: true, message: "Re-queued — the external dispatcher will send it from Outlook and mark it sent here" };
    },
  }),
  dispatchConsignmentEmails: defineAction({
    request: z.object({ fromCron: z.boolean().default(false) }),
    response: dispatchReportResponse,
    async handler(ctx, _args): Promise<z.infer<typeof dispatchReportResponse>> {
      const db = ctx.db<typeof schema>();
      // REPORT ONLY. This action never sends and never hands entries to an
      // internal sender (no spawned task, no approval wait). It simply
      // reports the entries currently queued for the external dispatcher,
      // with the exact composed email on each one, oldest first. Legacy
      // "pending" rows are normalized to "queued" so the dispatcher sees
      // every waiting entry in one state.
      const all = await db.select().from(schema.consignmentLogs).orderBy(asc(schema.consignmentLogs.createdAt));
      const nowIso = new Date().toISOString();
      const queuedEntries: z.infer<typeof dispatchReportResponse>["queuedEntries"] = [];
      for (const l of all as any[]) {
        const status = l.emailStatus ?? "";
        if (status !== "queued" && status !== "pending") continue;
        if (!(l.notifyEmail ?? "").trim()) continue;
        if (status === "pending") {
          await db.update(schema.consignmentLogs).set({ emailStatus: "queued", emailQueuedAt: (l.emailQueuedAt ?? "").trim() || nowIso }).where(eq(schema.consignmentLogs.id, l.id));
          l.emailStatus = "queued";
          if (!(l.emailQueuedAt ?? "").trim()) l.emailQueuedAt = nowIso;
        }
        const d = l.createdAt instanceof Date ? l.createdAt : new Date(l.createdAt);
        queuedEntries.push({ id: l.id, equipmentId: l.equipmentId, equipmentName: l.equipmentName ?? "", owner: l.owner ?? "", notifyEmail: l.notifyEmail ?? "", emailSubject: l.emailSubject ?? "", emailBody: l.emailBody ?? "", emailQueuedAt: l.emailQueuedAt ?? "", created_at: d.toISOString() });
      }
      ctx.invalidateQueries();
      const n = queuedEntries.length;
      return { ok: true, pendingCount: n, queuedCount: n, recoveredCount: 0, queuedEntries, message: n === 0 ? "No consignment emails queued — the outbox is clear" : `${n} consignment email${n === 1 ? "" : "s"} queued for the external dispatcher — the app queues only; sending happens from Outlook outside the app` };
    },
  }),

  // keep scaffold compat
  listEntries: defineAction({
    request: z.object({ limit: z.number().int().positive().max(100).default(20) }),
    response: z.object({ entries: z.array(z.object({ id: z.number(), text: z.string(), created_at: z.string() })) }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db.select().from(schema.entries).orderBy(desc(schema.entries.id)).limit(args.limit);
      return { entries: rows.map((r: any) => ({ id: r.id, text: r.text, created_at: r.createdAt.toISOString() })) };
    },
  }),
  addEntry: defineAction({
    request: z.object({ text: z.string().min(1) }),
    response: z.object({ id: z.number() }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const [r] = await db.insert(schema.entries).values({ text: args.text }).returning({ id: schema.entries.id });
      ctx.invalidateQueries(); return { id: r!.id };
    },
  }),
} satisfies ActionsModule;
