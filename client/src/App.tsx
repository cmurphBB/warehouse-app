import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64, type ApiResponse } from "./api";
import { WaterHeaters } from "./WaterHeaters";

type State = ApiResponse<typeof api, "getState">;
type LocRow = State["locations"][number];

// ---- Size-aware sorting -------------------------------------------------
// Part names carry inch sizes: 1/2" , 1 1/4" , 1-1/4" , 2" , 1/2" x 3/4".
// Only inch-marked numbers count as sizes — degrees (Black Malleable 90),
// voltages (9V), wire gauges (14/2), model numbers (#30, 454B, 1738) and
// counts (100 ct) have no inch mark and stay in the name-sorted group.
const sizeCache = new Map<string, number[]>();
function partSizes(name: string): number[] {
  const cached = sizeCache.get(name);
  if (cached) return cached;
  const norm = (name || "").replace(/”/g, '"');
  const re = /(\d+)\s+(\d+)\s*\/\s*(\d+)\s*"|(\d+)\s*-\s*(\d+)\s*\/\s*(\d+)\s*"|(\d+)\s*\/\s*(\d+)\s*"|(\d+(?:\.\d+)?)\s*"/g;
  const sizes: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(norm)) !== null) {
    if (m[1] !== undefined && m[2] !== undefined && m[3] !== undefined) sizes.push(Number(m[1]) + Number(m[2]) / Number(m[3]));
    else if (m[4] !== undefined && m[5] !== undefined && m[6] !== undefined) sizes.push(Number(m[4]) + Number(m[5]) / Number(m[6]));
    else if (m[7] !== undefined && m[8] !== undefined) sizes.push(Number(m[7]) / Number(m[8]));
    else if (m[9] !== undefined) sizes.push(Number(m[9]));
  }
  sizeCache.set(name, sizes);
  return sizes;
}
// Sized parts first, by first size then second size (numeric, ascending);
// parts with no size fall back to name order after the sized ones.
function compareBySize(aName: string, bName: string): number {
  const a = partSizes(aName), b = partSizes(bName);
  if (a.length > 0 && b.length === 0) return -1;
  if (a.length === 0 && b.length > 0) return 1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i], bv = b[i];
    if (av === undefined && bv === undefined) break;
    if (av === undefined) return -1;
    if (bv === undefined) return 1;
    if (av !== bv) return av - bv;
  }
  return aName.localeCompare(bName, undefined, { sensitivity: "base" });
}

// ---- Location grouping for the finder -----------------------------------
// Real trucks are named "55 - Will Gordon - Plumbing Van"; the 4 template
// locations carry no truck number ("Plumbing Van", "HVAC Service", …).
function isTemplateLoc(l: LocRow): boolean {
  return l.kind === "truck" && (/template/i.test(l.name) || !/^\s*\d+\s*[-–—]/.test(l.name));
}
function truckGroupKey(l: LocRow): string {
  const n = l.name.toLowerCase();
  if (n.includes("plumbing")) return "Plumbing";
  if (n.includes("install")) return "HVAC Install";
  if (n.includes("service")) return "HVAC Service";
  return "Other trucks";
}
const TRUCK_GROUP_ORDER = ["Plumbing", "HVAC Service", "HVAC Install", "Other trucks"];
type Tab = "board" | "stock" | "orders" | "verify" | "staging" | "requests" | "equipment" | "consignment";
type PhotoData = { dataBase64: string; mimeType: string; preview: string };

async function processPhoto(file: File): Promise<PhotoData> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not read that photo")); i.src = url; });
    const maxDim = 1280;
    let w = img.naturalWidth || 960; let h = img.naturalHeight || 720;
    if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const cx = canvas.getContext("2d"); if (!cx) throw new Error("Canvas unavailable");
    cx.drawImage(img, 0, 0, w, h);
    const preview = canvas.toDataURL("image/jpeg", 0.7);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob) throw new Error("Could not process that photo");
    const { dataBase64 } = await fileToBase64(blob);
    return { dataBase64, mimeType: "image/jpeg", preview };
  } finally { URL.revokeObjectURL(url); }
}

function verdictStyle(v: string): { bg: string; label: string; icon: string } {
  if (v === "match") return { bg: "#137333", label: "✓ MATCH — part matches invoice", icon: "✓" };
  if (v === "likely_match") return { bg: "#B45309", label: "LIKELY MATCH — one detail unreadable", icon: "~" };
  if (v === "mismatch") return { bg: "#C1272D", label: "✕ MISMATCH — do not stock yet", icon: "✕" };
  return { bg: "#5B6B82", label: "? UNCLEAR — retake or check by hand", icon: "?" };
}

const NAVY = "#052A78";
const ORANGE = "#FF6700";

function Badge({ children, color }: { children: React.ReactNode; color?: string }) {
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ background: color ? color + "22" : "var(--surface2)", color: color || "var(--dim)", border: `1px solid ${color ? color + "44" : "var(--border)"}` }}>{children}</span>;
}
function statusColor(s: string) {
  const m: Record<string, string> = { received: "#137333", done: "#137333", picked_up: "#137333", staged: "#137333", loaded: "#052A78", ordered: "#052A78", in_transit: "#7C3AED", partial: "#B45309", picking: "#B45309", needed: "#C1272D", new: "#C1272D", urgent: "#C1272D", emergency: "#C1272D", draft: "#5B6B82", cancelled: "#5B6B82", ready: "#137333", available: "#137333", in_use: "#052A78", needs_repair: "#C1272D", out_of_service: "#C1272D", missing: "#7C2D12", installed: "#6A1B9A" };
  return m[s] || "#5B6B82";
}
function equipStatusLabel(s: string) { return s.replace(/_/g, " "); }
function equipActionLabel(a: string) { const m: Record<string, string> = { created: "Added", checkout: "Checked out", checkin: "Checked in", transfer: "Transferred", repair_out: "Sent for repair", repair_in: "Back from repair", status_change: "Status change", note: "Note", removed: "Removed from inventory" }; return m[a] || a; }
function emailStatusStyle(s: string): { bg: string; label: string } {
  if (s === "sent") return { bg: "#137333", label: "✉ Sent" };
  if (s === "queued") return { bg: "#052A78", label: "✉ Queued" };
  if (s === "pending") return { bg: "#052A78", label: "✉ Queued" };
  if (s === "failed") return { bg: "#C1272D", label: "✉ Failed — re-queue" };
  return { bg: "#5B6B82", label: "No email — skipped" };
}
const EQUIP_CATEGORIES = ["Tool", "Recovery Machine", "Vacuum Pump", "Manifold / Gauges", "Leak Detector", "Torch / Welding", "Drain Machine", "Test Instrument", "Power Tool", "Hand Tool", "Ladder / Access", "Safety", "Other"];
const DEPARTMENTS = ["Pipe & Tubing", "Fittings", "Valves", "HVAC Parts", "Fixtures & Trim", "Pumps, Filters & Water", "Electrical & Controls", "Hardware & Hangers", "Consumables & Safety", "Other"] as const;
const DEPARTMENT_META: Record<string, { icon: string; blurb: string; shelf: string }> = {
  "Pipe & Tubing": { icon: "━", blurb: "Copper, PEX pipe, black & brass nipples, smoke pipe", shelf: "Aisle A — Pipe rack" },
  "Fittings": { icon: "⬢", blurb: "ProPress, MegaPress, PVC, 1738, PEX, brass, sweat & push", shelf: "Aisle B — Fitting bins" },
  "Valves": { icon: "◉", blurb: "Ball valves, stops, gas cocks & flex, mixing valves", shelf: "Aisle B — Valve wall" },
  "HVAC Parts": { icon: "❄", blurb: "Boiler, hydro, thermo, Navien, tanks, refrigeration, condensate", shelf: "Aisle C — HVAC parts" },
  "Fixtures & Trim": { icon: "⬣", blurb: "Toilet, lavatory, faucet, tub & shower, disposals, sill cocks", shelf: "Aisle C — Fixtures" },
  "Pumps, Filters & Water": { icon: "💧", blurb: "Pumps, filters, water testing & treatment", shelf: "Aisle C — Pumps / Filters" },
  "Electrical & Controls": { icon: "⚡", blurb: "Wire, disconnects, transformers, contactors, batteries, alarms", shelf: "Aisle D — Electrical" },
  "Hardware & Hangers": { icon: "🔩", blurb: "Hangers, clips, clamps, brackets, screws & hardware", shelf: "Aisle D — Hardware bins" },
  "Consumables & Safety": { icon: "🧴", blurb: "Glue, primer, tape, putty, solder, rags, gloves & safety", shelf: "Aisle E — Consumables" },
  "Other": { icon: "•", blurb: "Unsorted parts — assign a department to file them", shelf: "Unsorted" },
};
const CATEGORY_TO_DEPT: Record<string, string> = {
  "Black Nips": "Pipe & Tubing", "Brass Nips": "Pipe & Tubing", "Pex Pipe": "Pipe & Tubing", "Pipe & Tubing": "Pipe & Tubing", "Smoke Pipe": "Pipe & Tubing",
  "BM": "Fittings", "Brass": "Fittings", "Mega": "Fittings", "PVC": "Fittings", "Propress": "Fittings", "Pex": "Fittings", "Push": "Fittings", "Sweat": "Fittings",
  "Ball Valve": "Valves", "Stop": "Valves", "Gas Cock": "Valves", "Gas Flex": "Valves", "Mixing Valve": "Valves",
  "Boiler": "HVAC Parts", "Hydro": "HVAC Parts", "Thermo": "HVAC Parts", "Navien": "HVAC Parts", "Tank": "HVAC Parts", "Refrigeration": "HVAC Parts", "Condensate": "HVAC Parts", "Contactor": "HVAC Parts", "Transformer": "HVAC Parts", "HVAC": "HVAC Parts",
  "Toilet": "Fixtures & Trim", "Lavatory": "Fixtures & Trim", "Faucet": "Fixtures & Trim", "Tub & Shower": "Fixtures & Trim", "Sill": "Fixtures & Trim", "Disposal": "Fixtures & Trim",
  "Filters": "Pumps, Filters & Water", "Pump": "Pumps, Filters & Water",
  "Electrical": "Electrical & Controls", "Alarm": "Electrical & Controls", "Battery": "Electrical & Controls",
  "Hardware": "Hardware & Hangers", "Hangers, Clips & Clamps": "Hardware & Hangers",
  "Consumables": "Consumables & Safety", "Safety": "Consumables & Safety",
  "General": "Other", "Plumbing": "Fittings", "Water Heaters": "HVAC Parts", "Fittings": "Fittings", "Valves": "Valves", "Tools/Consumables": "Consumables & Safety",
};
function deptForCategory(cat: string): string { return CATEGORY_TO_DEPT[cat] || "Other"; }
function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return iso; } }
function fmtMoney(cents: number) { return cents > 0 ? `$${(cents / 100).toFixed(2)}` : "—"; }
function moneyToCents(raw: string): number {
  const cleaned = (raw || "").replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}
// ---- Daily PO import: parse pasted/uploaded PO text and preview matches ----
// Expected columns (header row recommended): Vendor, PO #, Code/SKU,
// Description, Qty, Unit Price. Without a header: PO #, Code, Description,
// Qty, Unit Price (5) or Code, Description, Qty, Unit Price (4).
type PoRow = { vendor: string; poNumber: string; sku: string; partName: string; qty: number; unitCostCents: number };
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function parsePoText(text: string): { rows: PoRow[]; skipped: number } {
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return { rows: [], skipped: 0 };
  const delim = (rawLines[0]!.match(/\t/g)?.length ?? 0) > (rawLines[0]!.match(/,/g)?.length ?? 0) ? "\t" : rawLines[0]!.includes(";") && !rawLines[0]!.includes(",") ? ";" : ",";
  const table = rawLines.map(l => splitCsvLine(l, delim));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const first = table[0]!.map(norm);
  const findCol = (...tests: ((c: string) => boolean)[]) => { for (const t of tests) { const i = first.findIndex(t); if (i >= 0) return i; } return -1; };
  const idx = {
    price: findCol(c => c.includes("unitprice") || c.includes("unitcost") || c === "price" || c === "cost" || c.includes("priceeach")),
    total: findCol(c => c.includes("ext") || c.includes("linetotal") || c === "total" || c === "amount"),
    qty: findCol(c => c === "qty" || c.includes("quantity") || c.includes("ordered")),
    sku: findCol(c => c.includes("sku") || c.includes("itemnumber") || c.includes("partnumber") || c.includes("code") || c.includes("mfr")),
    name: findCol(c => c.includes("description") || c.includes("partname") || c === "name" || c === "item" || c.includes("material")),
    po: findCol(c => c === "po" || c.includes("ponumber") || c.includes("ordernumber") || c === "order"),
    vendor: findCol(c => c.includes("vendor") || c.includes("supplier")),
  };
  const hasHeader = (idx.name >= 0 || idx.sku >= 0) && (idx.price >= 0 || idx.total >= 0);
  const rows: PoRow[] = []; let skipped = 0;
  const body = hasHeader ? table.slice(1) : table;
  for (const cells of body) {
    const get = (i: number) => (i >= 0 && i < cells.length ? cells[i]! : "");
    let vendor = "", poNumber = "", sku = "", partName = "", qtyRaw = "", priceRaw = "", totalRaw = "";
    if (hasHeader) { vendor = get(idx.vendor); poNumber = get(idx.po); sku = get(idx.sku); partName = get(idx.name); qtyRaw = get(idx.qty); priceRaw = get(idx.price); totalRaw = get(idx.total); }
    else if (cells.length >= 6) { [vendor, poNumber, sku, partName, qtyRaw, priceRaw] = [cells[0]!, cells[1]!, cells[2]!, cells[3]!, cells[4]!, cells[5]!]; }
    else if (cells.length === 5) { [poNumber, sku, partName, qtyRaw, priceRaw] = [cells[0]!, cells[1]!, cells[2]!, cells[3]!, cells[4]!]; }
    else if (cells.length === 4) { [sku, partName, qtyRaw, priceRaw] = [cells[0]!, cells[1]!, cells[2]!, cells[3]!]; }
    else if (cells.length === 3) { [partName, qtyRaw, priceRaw] = [cells[0]!, cells[1]!, cells[2]!]; }
    else { skipped++; continue; }
    if (!partName) { skipped++; continue; }
    let qty = Math.max(1, Math.round(Number((qtyRaw || "1").replace(/[^0-9.]/g, "")) || 1));
    let unitCostCents = moneyToCents(priceRaw);
    if (!unitCostCents && totalRaw) { const tot = moneyToCents(totalRaw); if (tot > 0) unitCostCents = Math.round(tot / qty); }
    rows.push({ vendor, poNumber, sku, partName, qty, unitCostCents });
  }
  return { rows, skipped };
}
function normSkuClient(s: string): string { return (s || "").trim().toUpperCase().replace(/[\s\-_]+/g, ""); }
function normNameClient(s: string): string { return (s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
type ClientMatch = { label: string; color: string; partName: string };
function clientMatchPart(parts: { name: string; sku: string }[], row: PoRow): ClientMatch {
  const skuKey = normSkuClient(row.sku);
  if (skuKey) {
    const bySku = parts.filter(p => normSkuClient(p.sku) === skuKey);
    if (bySku.length === 1) return { label: "Code match", color: "#137333", partName: bySku[0]!.name };
    if (bySku.length > 1) {
      const byName = bySku.filter(p => normNameClient(p.name) === normNameClient(row.partName));
      if (byName.length === 1) return { label: "Code + name match", color: "#137333", partName: byName[0]!.name };
      return { label: `Ambiguous — code on ${bySku.length} parts`, color: "#B45309", partName: "" };
    }
  }
  const nameKey = normNameClient(row.partName);
  if (nameKey) {
    const byName = parts.filter(p => normNameClient(p.name) === nameKey);
    if (byName.length === 1) return { label: "Name match", color: "#137333", partName: byName[0]!.name };
    if (byName.length > 1) return { label: "Ambiguous — duplicate name", color: "#B45309", partName: "" };
  }
  return { label: "No match — won't be priced", color: "#C1272D", partName: "" };
}
function LineCostEditor({ lineId, unitCostCents }: { lineId: number; unitCostCents: number }) {
  const qc2 = useQueryClient();
  const [val, setVal] = useState<string | null>(null);
  const current = val ?? (unitCostCents ? (unitCostCents / 100).toFixed(2) : "");
  const mut = useMutation({ mutationFn: () => api.updateOrderLine({ lineId, unitCostCents: moneyToCents(current), partId: null }), onSuccess: () => { qc2.invalidateQueries({ queryKey: ["state"] }); setVal(null); } });
  const dirty = val !== null && moneyToCents(current) !== unitCostCents;
  return (
    <span className="inline-flex items-center gap-1.5">
      <label className="text-[11px] font-bold" style={{ color: "var(--dim)" }}>Unit $ <input aria-label="Unit cost in dollars for this PO line" inputMode="decimal" value={current} onChange={e => setVal(e.target.value)} placeholder="0.00" className="w-20 rounded-md px-2 py-1 text-xs font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
      {dirty && <button onClick={() => mut.mutate()} disabled={mut.isPending} className="px-2 py-1 rounded-md text-[11px] font-black text-white disabled:opacity-50" style={{ background: NAVY }}>{mut.isPending ? "Saving…" : "Save price"}</button>}
    </span>
  );
}
function fmtJobDate(d: string) { if (!d) return "No date set"; try { const dt = new Date(d + "T12:00:00"); return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }); } catch { return d; } }

// ---- Van / location dropdown --------------------------------------------
// One picker instead of a wall of van cards. Options are grouped:
// Warehouse, then real vans by trade, then templates at the bottom.
function LocationDropdown({ locations, value, onChange, ariaLabel, placeholder, includeAll, allLabel }: {
  locations: LocRow[];
  value: string;
  onChange: (raw: string) => void;
  ariaLabel: string;
  placeholder?: string;
  includeAll?: boolean;
  allLabel?: string;
}) {
  const warehouses = locations.filter(l => l.kind === "warehouse");
  const templates = locations.filter(isTemplateLoc);
  const byGroup = new Map<string, LocRow[]>();
  for (const l of locations) {
    if (l.kind !== "truck" || isTemplateLoc(l)) continue;
    const k = truckGroupKey(l);
    byGroup.set(k, [...(byGroup.get(k) ?? []), l]);
  }
  const groups = TRUCK_GROUP_ORDER.filter(k => byGroup.has(k)).map(k => ({ key: k, locations: [...(byGroup.get(k) ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) }));
  const opt = (l: LocRow) => <option key={l.id} value={String(l.id)}>{l.kind === "warehouse" ? "🏭 " : "🚐 "}{l.name}{l.assignedTo ? ` — ${l.assignedTo}` : ""}</option>;
  return (
    <div className="relative">
      <select aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)} className="w-full appearance-none rounded-xl pl-4 pr-10 py-3.5 font-bold text-[15px] outline-none cursor-pointer" style={{ background: "var(--surface)", border: "1.5px solid var(--border)", color: "var(--text)" }}>
        {includeAll ? <option value="all">{allLabel ?? "All locations"}</option> : <option value="">{placeholder ?? "Choose a warehouse or van…"}</option>}
        {warehouses.length > 0 && <optgroup label="Warehouse">{warehouses.map(opt)}</optgroup>}
        {groups.map(g => <optgroup key={g.key} label={`${g.key} vans`}>{g.locations.map(opt)}</optgroup>)}
        {templates.length > 0 && <optgroup label="Templates — master stock lists">{templates.map(opt)}</optgroup>}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-black" style={{ color: "var(--dim)" }}>▾</span>
    </div>
  );
}

export function App() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("board");
  const [search, setSearch] = useState("");
  const [stockLocFilter, setStockLocFilter] = useState<number | "all">("all");
  const [stockDeptFilter, setStockDeptFilter] = useState<string>("all");
  const [stockSubcatFilter, setStockSubcatFilter] = useState<string>("all");
  const [stockQtyFilter, setStockQtyFilter] = useState<"all" | "onhand" | "low">("all");
  const [stockLimit, setStockLimit] = useState(50);
  const [catalogLimit, setCatalogLimit] = useState(50);
  const [equipLimit, setEquipLimit] = useState(50);
  const [orderLimit, setOrderLimit] = useState(50); // rendering thousands of PO cards froze the Orders tab
  const [stockOpenId, setStockOpenId] = useState<number | null>(null); // which minimal stock row is expanded
  const [stockManageOpen, setStockManageOpen] = useState(false); // admin sections live behind one fold
  const [boardLocPick, setBoardLocPick] = useState("");
  const [finderLocPick, setFinderLocPick] = useState("");
  const [showAllLogs, setShowAllLogs] = useState(false);

  const q = useQuery({ queryKey: ["state"], queryFn: () => api.getState({}) });
  const inv = () => qc.invalidateQueries({ queryKey: ["state"] });

  // forms state
  const [partForm, setPartForm] = useState({ name: "", sku: "", category: "General", department: "Other", unit: "ea" });
  const [locForm, setLocForm] = useState({ name: "", kind: "warehouse" as "warehouse" | "truck", assignedTo: "" });
  const [stockForm, setStockForm] = useState({ partId: 0, locationId: 0, quantity: 10, minQty: 2 });
  // Bulk transfer — one From → one To, many parts checked off at once.
  // bulkQty maps partId → qty to move; presence in the map = selected.
  const [bulkFromId, setBulkFromId] = useState(0);
  const [bulkToId, setBulkToId] = useState(0);
  const [bulkQty, setBulkQty] = useState<Record<number, number>>({});
  const [bulkSearch, setBulkSearch] = useState("");
  const [bulkLimit, setBulkLimit] = useState(50);
  const [bulkResult, setBulkResult] = useState<{ ok: boolean; transferredCount: number; totalUnits: number; message: string; failed: { partId: number; partName: string; qty: number; reason: string }[] } | null>(null);
  const [orderForm, setOrderForm] = useState({ vendor: "", poNumber: "", eta: "", notes: "", lines: [{ partName: "", sku: "", qty: 1, unitCost: "", partId: null as number | null }] });
  // Daily PO price-match state
  const [poText, setPoText] = useState("");
  const [poVendor, setPoVendor] = useState("");
  const [poResult, setPoResult] = useState<any>(null);
  const [priceHistoryPartId, setPriceHistoryPartId] = useState<number | null>(null);
  const poFileRef = useRef<HTMLInputElement>(null);
  const [stageForm, setStageForm] = useState({ customer: "", jobType: "Service", jobDate: "", truckLocationId: null as number | null, notes: "", lines: [{ partName: "", qty: 1, partId: null as number | null }] });
  const [reqForm, setReqForm] = useState({ techName: "", partDescription: "", qty: 1, urgency: "normal" as "low" | "normal" | "urgent" | "emergency", jobRef: "", notes: "" });
  const [receiveLoc, setReceiveLoc] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  // Equipment state
  const [equipForm, setEquipForm] = useState({ name: "", category: "Tool", serialNumber: "", assetTag: "", brandModel: "", status: "available" as "available" | "in_use" | "needs_repair" | "out_of_service" | "missing", condition: "good", currentLocationId: null as number | null, assignedTo: "", notes: "", performedBy: "", isConsigned: false, consignmentOwner: "", consignmentEmail: "", consignmentValue: "", consignmentNotes: "" });
  const [equipSearch, setEquipSearch] = useState("");
  const [equipLocFilter, setEquipLocFilter] = useState<number | "all">("all");
  const [equipStatusFilter, setEquipStatusFilter] = useState<string>("all");
  const [moveForm, setMoveForm] = useState({ equipmentId: 0, toLocationId: null as number | null, action: "transfer" as "checkout" | "checkin" | "transfer" | "repair_out" | "repair_in" | "status_change" | "note", performedBy: "", assignedTo: "", notes: "", jobRef: "" });
  const [historyEquipId, setHistoryEquipId] = useState<number | null>(null);
  // Consignment state
  const [equipConsignFilter, setEquipConsignFilter] = useState<"all" | "consigned" | "owned">("all");
  const [consignEditId, setConsignEditId] = useState<number | null>(null);
  const [consignEditForm, setConsignEditForm] = useState({ isConsigned: false, consignmentOwner: "", consignmentEmail: "", consignmentValue: "", consignmentNotes: "", performedBy: "" });
  const [consignOwnerFilter, setConsignOwnerFilter] = useState<string>("all");
  const [consignEmailFilter, setConsignEmailFilter] = useState<string>("all");
  const [showAllConsignLogs, setShowAllConsignLogs] = useState(false);
  const [expandedEmailId, setExpandedEmailId] = useState<number | null>(null);
  // AI photo state
  const [techPhoto, setTechPhoto] = useState<PhotoData | null>(null);
  const [techHint, setTechHint] = useState("");
  const [aiResult, setAiResult] = useState<{ partName: string; partDescription: string; equipmentType: string; equipmentBrandModel: string; confidence: string; reasoning: string; alternatives: string[]; suggestedQtyNote: string } | null>(null);
  const [aiError, setAiError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const techPhotoRef = useRef<HTMLInputElement>(null);
  // Intake verification state
  const [invoicePhoto, setInvoicePhoto] = useState<PhotoData | null>(null);
  const [partPhoto, setPartPhoto] = useState<PhotoData | null>(null);
  const [intakeForm, setIntakeForm] = useState({ orderId: null as number | null, vendor: "", poNumber: "", checkedBy: "", expectedParts: "" });
  const [intakeResult, setIntakeResult] = useState<any>(null);
  const [intakeError, setIntakeError] = useState("");
  const invoicePhotoRef = useRef<HTMLInputElement>(null);
  const partPhotoRef = useRef<HTMLInputElement>(null);

  const createPart = useMutation({ mutationFn: () => api.createPart(partForm), onSuccess: () => { inv(); setPartForm({ name: "", sku: "", category: "General", department: "Other", unit: "ea" }); setToast("Part added to catalog"); } });
  const setPartDept = useMutation({ mutationFn: (a: { partId: number; department: string }) => (api as any).setPartDepartment(a), onSuccess: inv });
  const createLoc = useMutation({ mutationFn: () => api.createLocation(locForm), onSuccess: () => { inv(); setLocForm({ name: "", kind: "warehouse", assignedTo: "" }); setToast("Location added"); } });
  const upsertStock = useMutation({ mutationFn: () => api.upsertStock(stockForm), onSuccess: () => { inv(); setToast("Stock updated"); } });
  // Optimistic: the count moves the instant the button is tapped; the
  // background refetch reconciles, and an error puts the old number back.
  const adjustStock = useMutation({
    mutationFn: (a: { stockId: number; delta: number }) => api.adjustStock(a),
    onMutate: async (a) => {
      await qc.cancelQueries({ queryKey: ["state"] });
      const prev = qc.getQueryData<State>(["state"]);
      if (prev) qc.setQueryData<State>(["state"], { ...prev, stock: prev.stock.map(s => s.id === a.stockId ? { ...s, quantity: Math.max(0, s.quantity + a.delta) } : s) });
      return { prev };
    },
    onError: (_e, _a, ctx) => { if (ctx?.prev) qc.setQueryData(["state"], ctx.prev); },
    onSettled: () => inv(),
  });
  const bulkTransfer = useMutation({
    mutationFn: () => api.transferStockBulk({ fromLocationId: bulkFromId, toLocationId: bulkToId, items: Object.entries(bulkQty).map(([partId, qty]) => ({ partId: Number(partId), qty })) }),
    onSuccess: (r) => {
      inv(); setBulkResult(r); setToast(r.message);
      if (r.ok) { setBulkQty({}); }
      else if (r.transferredCount > 0) {
        // Keep only the failed items selected so they can be fixed and retried.
        const failedIds = new Set(r.failed.map(f => f.partId));
        setBulkQty(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => failedIds.has(Number(id)))));
      }
    },
    onError: (e: any) => setBulkResult({ ok: false, transferredCount: 0, totalUnits: 0, message: e?.message || "Transfer failed — try again.", failed: [] }),
  });
  const createOrder = useMutation({ mutationFn: () => api.createOrder({ vendor: orderForm.vendor, poNumber: orderForm.poNumber, eta: orderForm.eta, notes: orderForm.notes, status: "ordered", lines: orderForm.lines.filter(l => l.partName.trim()).map(l => ({ partId: l.partId, partName: l.partName, sku: l.sku, qty: l.qty, unitCostCents: moneyToCents(l.unitCost) })) }), onSuccess: () => { inv(); setOrderForm({ vendor: "", poNumber: "", eta: "", notes: "", lines: [{ partName: "", sku: "", qty: 1, unitCost: "", partId: null }] }); setToast("Order placed — priced lines matched to materials"); } });
  const importPo = useMutation({ mutationFn: () => { const { rows } = parsePoText(poText); return api.importPoLines({ vendor: poVendor, notes: "Imported from daily PO — prices matched to materials (multi-price = average)", lines: rows }); }, onSuccess: (r) => { inv(); setPoResult(r); setPoText(""); setToast(`PO import done — ${r.matchedLines} priced lines matched, ${r.partsPriced} materials priced`); }, onError: (e: any) => setPoResult({ error: e?.message || "Import failed — check the pasted format and try again." }) });
  const recalcPricing = useMutation({ mutationFn: () => api.recalcPricing({}), onSuccess: (r) => { inv(); setPoResult(r); setToast(`Price match re-run — ${r.partsPriced} materials priced from ${r.pricedLines} PO lines`); }, onError: (e: any) => setPoResult({ error: e?.message || "Re-run failed." }) });
  const updateOrder = useMutation({ mutationFn: (a: any) => api.updateOrder(a), onSuccess: inv });
  const receiveLine = useMutation({ mutationFn: (a: { lineId: number; qty: number }) => api.receiveOrderLine({ lineId: a.lineId, qty: a.qty, warehouseLocationId: receiveLoc }), onSuccess: () => { inv(); setToast("Received into warehouse stock"); } });
  const deleteOrder = useMutation({ mutationFn: (id: number) => api.deleteOrder({ id }), onSuccess: inv });
  const createStage = useMutation({ mutationFn: () => api.createStaging({ customer: stageForm.customer, jobType: stageForm.jobType, jobDate: stageForm.jobDate, truckLocationId: stageForm.truckLocationId, notes: stageForm.notes, lines: stageForm.lines.filter(l => l.partName.trim()).map(l => ({ partId: l.partId, partName: l.partName, qty: l.qty, sourceLocationId: null })) }), onSuccess: () => { inv(); setStageForm({ customer: "", jobType: "Service", jobDate: "", truckLocationId: null, notes: "", lines: [{ partName: "", qty: 1, partId: null }] }); setToast("Job staged — pick list created"); } });
  const updateStage = useMutation({ mutationFn: (a: { id: number; status: any }) => api.updateStagingStatus(a), onSuccess: inv });
  const toggleLine = useMutation({ mutationFn: (a: { lineId: number; pulled: boolean }) => api.toggleStagingLine(a), onSuccess: inv });
  const loadTruck = useMutation({ mutationFn: (id: number) => api.loadStagingToTruck({ stagingId: id }), onSuccess: (r) => { inv(); setToast(r.message); } });
  const deleteStage = useMutation({ mutationFn: (id: number) => api.deleteStaging({ id }), onSuccess: inv });
  const createReq = useMutation({ mutationFn: () => api.createTechRequest({ ...reqForm, imageDataBase64: techPhoto?.dataBase64 ?? "", imageMimeType: techPhoto?.mimeType ?? "image/jpeg", aiPartName: aiResult?.partName ?? "", aiEquipment: [aiResult?.equipmentType, aiResult?.equipmentBrandModel].filter(Boolean).join(" — "), aiConfidence: aiResult?.confidence ?? "", aiNotes: aiResult ? `${aiResult.reasoning} ${aiResult.suggestedQtyNote}`.trim() : "" }), onSuccess: () => { inv(); setReqForm({ techName: "", partDescription: "", qty: 1, urgency: "normal", jobRef: "", notes: "" }); setTechPhoto(null); setAiResult(null); setTechHint(""); setToast("Request submitted — warehouse will see it"); } });
  const analyzePhoto = useMutation({
    mutationFn: () => api.analyzePartPhoto({ dataBase64: techPhoto!.dataBase64, mimeType: techPhoto!.mimeType, hint: techHint }),
    onSuccess: (r) => { setAiResult(r); setAiError(""); setReqForm(f => ({ ...f, partDescription: r.partDescription || r.partName })); },
    onError: (e: any) => setAiError(e?.message || "AI couldn't read that photo. Try a closer, well-lit shot of the part or nameplate."),
  });
  const verifyIntakeMut = useMutation({
    mutationFn: () => api.verifyIntake({ orderId: intakeForm.orderId, vendor: intakeForm.vendor, poNumber: intakeForm.poNumber, checkedBy: intakeForm.checkedBy, expectedParts: intakeForm.expectedParts, invoiceDataBase64: invoicePhoto?.dataBase64 ?? "", invoiceMimeType: invoicePhoto?.mimeType ?? "image/jpeg", partDataBase64: partPhoto?.dataBase64 ?? "", partMimeType: partPhoto?.mimeType ?? "image/jpeg" }),
    onSuccess: (r) => { setIntakeResult(r); setIntakeError(""); inv(); setToast(r.verdict === "match" ? "Verified ✓ — matches the invoice" : r.verdict === "mismatch" ? "⚠ Mismatch flagged — hold this part" : "Verification saved"); },
    onError: (e: any) => setIntakeError(e?.message || "Verification failed. Check both photos are clear and try again."),
  });
  const deleteIntake = useMutation({ mutationFn: (id: number) => api.deleteIntakeVerification({ id }), onSuccess: inv });
  const updateReq = useMutation({ mutationFn: (a: { id: number; status: any }) => api.updateTechRequest(a), onSuccess: inv });
  const deletePart = useMutation({ mutationFn: (id: number) => api.deletePart({ id }), onSuccess: inv });
  const deleteReq = useMutation({ mutationFn: (id: number) => api.deleteTechRequest({ id }), onSuccess: inv });
  const createEquip = useMutation({ mutationFn: () => api.createEquipment({ name: equipForm.name, category: equipForm.category, serialNumber: equipForm.serialNumber, assetTag: equipForm.assetTag, brandModel: equipForm.brandModel, status: equipForm.status, condition: equipForm.condition, currentLocationId: equipForm.currentLocationId, assignedTo: equipForm.assignedTo, notes: equipForm.notes, performedBy: equipForm.performedBy, isConsigned: equipForm.isConsigned, consignmentOwner: equipForm.consignmentOwner, consignmentEmail: equipForm.consignmentEmail, consignmentValueCents: moneyToCents(equipForm.consignmentValue), consignmentNotes: equipForm.consignmentNotes }), onSuccess: () => { inv(); setEquipForm({ name: "", category: "Tool", serialNumber: "", assetTag: "", brandModel: "", status: "available", condition: "good", currentLocationId: null, assignedTo: "", notes: "", performedBy: "", isConsigned: false, consignmentOwner: "", consignmentEmail: "", consignmentValue: "", consignmentNotes: "" }); setToast("Equipment added — now tracked by location"); } });
  const moveEquip = useMutation({ mutationFn: () => api.moveEquipment({ equipmentId: moveForm.equipmentId, toLocationId: moveForm.toLocationId, action: moveForm.action, performedBy: moveForm.performedBy, assignedTo: moveForm.assignedTo, notes: moveForm.notes, jobRef: moveForm.jobRef, newStatus: null }), onSuccess: (r) => { inv(); setToast(r.message); setMoveForm(f => ({ ...f, notes: "", jobRef: "" })); } });
  const setConsignment = useMutation({ mutationFn: (a: { equipmentId: number; isConsigned: boolean; consignmentOwner: string; consignmentEmail: string; consignmentValueCents: number; consignmentNotes: string; performedBy: string }) => (api as any).setEquipmentConsignment(a), onSuccess: (r: any) => { inv(); setToast(r.message); setConsignEditId(null); } });
  const dispatchEmails = useMutation({ mutationFn: () => (api as any).dispatchConsignmentEmails({}), onSuccess: (r: any) => { inv(); setToast(r.message); }, onError: (e: any) => setToast(e?.message || "Couldn't check the queue — entries stay queued") });
  const retryEmail = useMutation({ mutationFn: (logId: number) => (api as any).retryConsignmentEmail({ logId }), onSuccess: (r: any) => { inv(); setToast(r.message); }, onError: (e: any) => setToast(e?.message || "Couldn't re-queue that email — it stays as-is") });
  const updateEquipStatus = useMutation({ mutationFn: (a: { id: number; status: any }) => api.updateEquipmentStatus({ id: a.id, status: a.status, performedBy: "", notes: "" }), onSuccess: inv });
  const deleteEquip = useMutation({ mutationFn: (id: number) => api.deleteEquipment({ id }), onSuccess: () => { inv(); setToast("Equipment removed — its movement history and consignment log entries stay in the logs, marked as a removed piece"); } });

  const data: State | undefined = q.data;
  const warehouseLocs = useMemo(() => data?.locations.filter(l => l.kind === "warehouse") ?? [], [data]);
  const truckLocs = useMemo(() => data?.locations.filter(l => l.kind === "truck") ?? [], [data]);

  const filteredStock = useMemo(() => {
    if (!data) return [];
    let rows = data.stock;
    if (stockLocFilter !== "all") rows = rows.filter(r => r.locationId === stockLocFilter);
    if (stockDeptFilter !== "all") rows = rows.filter(r => (r as any).department === stockDeptFilter);
    if (stockSubcatFilter !== "all") rows = rows.filter(r => r.category === stockSubcatFilter);
    if (stockQtyFilter === "low") rows = rows.filter(r => r.quantity <= r.minQty);
    else if (stockQtyFilter === "onhand") rows = rows.filter(r => r.quantity > 0);
    if (search.trim()) { const s = search.toLowerCase(); rows = rows.filter(r => r.partName.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s) || r.locationName.toLowerCase().includes(s) || r.category.toLowerCase().includes(s) || ((r as any).department || "").toLowerCase().includes(s)); }
    return [...rows].sort((a, b) => compareBySize(a.partName, b.partName) || a.locationName.localeCompare(b.locationName) || a.sku.localeCompare(b.sku));
  }, [data, stockLocFilter, stockDeptFilter, stockSubcatFilter, stockQtyFilter, search]);

  const sortedParts = useMemo(() => {
    if (!data) return [];
    return [...data.parts].sort((a, b) => compareBySize(a.name, b.name) || a.sku.localeCompare(b.sku));
  }, [data]);

  const catalogParts = useMemo(() => {
    if (!data) return [];
    let rows = sortedParts;
    if (stockDeptFilter !== "all") rows = rows.filter(p => (p as any).department === stockDeptFilter);
    if (stockSubcatFilter !== "all") rows = rows.filter(p => p.category === stockSubcatFilter);
    if (search.trim()) { const s = search.toLowerCase(); rows = rows.filter(p => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.category.toLowerCase().includes(s) || ((p as any).department || "").toLowerCase().includes(s)); }
    return rows;
  }, [data, sortedParts, stockDeptFilter, stockSubcatFilter, search]);

  // Paginated lists restart at the first page whenever the view changes.
  useEffect(() => { setStockLimit(50); }, [stockLocFilter, stockDeptFilter, stockSubcatFilter, stockQtyFilter, search]);
  useEffect(() => { setCatalogLimit(50); }, [stockDeptFilter, stockSubcatFilter, search]);
  useEffect(() => { setEquipLimit(50); }, [equipLocFilter, equipStatusFilter, equipSearch, equipConsignFilter]);

  // Bulk transfer derived data
  useEffect(() => { if (!bulkFromId && warehouseLocs[0]) setBulkFromId(warehouseLocs[0].id); }, [warehouseLocs, bulkFromId]);
  useEffect(() => { setBulkLimit(50); }, [bulkSearch, bulkFromId]);
  const bulkSourceStock = useMemo(() => {
    if (!data || !bulkFromId) return [];
    return data.stock.filter(s => s.locationId === bulkFromId && s.quantity > 0).sort((a, b) => compareBySize(a.partName, b.partName) || a.sku.localeCompare(b.sku));
  }, [data, bulkFromId]);
  const bulkFilteredStock = useMemo(() => {
    if (!bulkSearch.trim()) return bulkSourceStock;
    const s = bulkSearch.toLowerCase();
    return bulkSourceStock.filter(r => r.partName.toLowerCase().includes(s) || r.sku.toLowerCase().includes(s) || r.category.toLowerCase().includes(s) || ((r as any).department || "").toLowerCase().includes(s));
  }, [bulkSourceStock, bulkSearch]);
  const bulkSelectedEntries = useMemo(() => Object.entries(bulkQty).map(([partId, qty]) => ({ partId: Number(partId), qty })), [bulkQty]);
  const bulkSelectedCount = bulkSelectedEntries.length;
  const bulkTotalUnits = bulkSelectedEntries.reduce((a, e) => a + e.qty, 0);
  const bulkInvalid = useMemo(() => {
    if (!bulkFromId || !bulkToId || bulkFromId === bulkToId || bulkSelectedCount === 0) return true;
    return bulkSelectedEntries.some(e => {
      const row = bulkSourceStock.find(s => s.partId === e.partId);
      return !row || e.qty < 1 || e.qty > row.quantity;
    });
  }, [bulkFromId, bulkToId, bulkSelectedCount, bulkSelectedEntries, bulkSourceStock]);
  const toggleBulkPart = (partId: number) => {
    setBulkResult(null);
    setBulkQty(prev => {
      const next = { ...prev };
      if (partId in next) delete next[partId]; else next[partId] = 1;
      return next;
    });
  };
  const setBulkPartQty = (partId: number, qty: number, max: number) => {
    setBulkResult(null);
    const clamped = Math.max(1, Math.min(max, Math.floor(qty) || 1));
    setBulkQty(prev => ({ ...prev, [partId]: clamped }));
  };

  const warehouseId = useMemo(() => warehouseLocs[0]?.id ?? null, [warehouseLocs]);
  const isWarehouseSelected = useMemo(() => {
    if (stockLocFilter === "all") return false;
    return warehouseLocs.some(l => l.id === stockLocFilter);
  }, [stockLocFilter, warehouseLocs]);
  const activeDeptData = useMemo(() => {
    if (!data || stockDeptFilter === "all") return null;
    return data.warehouseDepartments.find(d => d.department === stockDeptFilter) ?? null;
  }, [data, stockDeptFilter]);
  const subcategoriesForDept = useMemo(() => {
    if (!data) return [] as { category: string; count: number }[];
    if (stockDeptFilter === "all") {
      // all categories present in current location scope
      const map = new Map<string, number>();
      for (const p of data.parts) map.set(p.category, (map.get(p.category) ?? 0) + 1);
      return Array.from(map.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));
    }
    return activeDeptData?.subcategories ?? [];
  }, [data, stockDeptFilter, activeDeptData]);

  const goToWarehouseDept = (dept: string) => {
    if (warehouseId) setStockLocFilter(warehouseId);
    setStockDeptFilter(dept);
    setStockSubcatFilter("all");
    setTab("stock");
  };

  const lowStock = useMemo(() => [...(data?.stock.filter(s => s.quantity <= s.minQty) ?? [])].sort((a, b) => compareBySize(a.partName, b.partName) || a.locationName.localeCompare(b.locationName)), [data]);
  const filteredEquipment = useMemo(() => {
    if (!data) return [];
    let rows = data.equipment;
    if (equipLocFilter !== "all") rows = rows.filter(r => r.currentLocationId === equipLocFilter);
    if (equipStatusFilter !== "all") rows = rows.filter(r => r.status === equipStatusFilter);
    else rows = rows.filter(r => r.status !== "installed");
    if (equipConsignFilter === "consigned") rows = rows.filter(r => (r as any).isConsigned);
    else if (equipConsignFilter === "owned") rows = rows.filter(r => !(r as any).isConsigned);
    if (equipSearch.trim()) { const s = equipSearch.toLowerCase(); rows = rows.filter(r => r.name.toLowerCase().includes(s) || r.serialNumber.toLowerCase().includes(s) || r.assetTag.toLowerCase().includes(s) || r.brandModel.toLowerCase().includes(s) || r.category.toLowerCase().includes(s) || r.currentLocationName.toLowerCase().includes(s) || r.assignedTo.toLowerCase().includes(s) || ((r as any).consignmentOwner || "").toLowerCase().includes(s)); }
    return rows;
  }, [data, equipLocFilter, equipStatusFilter, equipSearch, equipConsignFilter]);
  const filteredEquipLogs = useMemo(() => {
    if (!data) return [];
    if (historyEquipId) return data.equipmentLogs.filter(l => l.equipmentId === historyEquipId);
    return data.equipmentLogs;
  }, [data, historyEquipId]);
  const consignedEquipment = useMemo(() => (data?.equipment.filter(e => (e as any).isConsigned) ?? []), [data]);
  const filteredConsignLogs = useMemo(() => {
    if (!data) return [];
    let rows = (data as any).consignmentLogs as any[];
    if (consignOwnerFilter !== "all") rows = rows.filter((l: any) => l.owner === consignOwnerFilter);
    if (consignEmailFilter !== "all") rows = rows.filter((l: any) => consignEmailFilter === "queued" ? (l.emailStatus === "queued" || l.emailStatus === "pending") : l.emailStatus === consignEmailFilter);
    if (historyEquipId) rows = rows.filter((l: any) => l.equipmentId === historyEquipId);
    return rows;
  }, [data, consignOwnerFilter, consignEmailFilter, historyEquipId]);
  const poPreview = useMemo(() => {
    if (!poText.trim() || !data) return null;
    const { rows, skipped } = parsePoText(poText);
    const matched = rows.map(r => ({ row: r, match: clientMatchPart(data.parts, r) }));
    return { rows, skipped, matched, matchCount: matched.filter(m => m.match.partName).length, noPrice: rows.filter(r => !r.unitCostCents).length };
  }, [poText, data]);

  if (q.isPending) return <div className="min-h-screen flex items-center justify-center p-6"><p className="font-display font-bold text-lg" style={{ color: NAVY }}>Loading inventory…</p></div>;
  if (q.error || !data) return <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-3"><p className="font-bold">Couldn't load inventory.</p><button onClick={() => q.refetch()} className="px-5 py-3 rounded-xl text-white font-bold" style={{ background: NAVY }}>Retry</button></div>;

  const needsSetup = data.locations.length === 0;

  // Stock navigation: finder (pick a location) → department (warehouse) → parts.
  const finderMode = stockLocFilter === "all" && stockDeptFilter === "all" && stockSubcatFilter === "all" && stockQtyFilter === "all" && !search.trim();
  const locCounts = (locId: number) => { const rows = data.stock.filter(s => s.locationId === locId); return { rows: rows.length, units: rows.reduce((a, s) => a + s.quantity, 0), low: rows.filter(s => s.quantity <= s.minQty).length }; };
  const openLocation = (l: LocRow) => { setStockLocFilter(l.id); setStockDeptFilter("all"); setStockSubcatFilter("all"); setStockQtyFilter("all"); };
  const resetStockNav = () => { setStockLocFilter("all"); setStockDeptFilter("all"); setStockSubcatFilter("all"); setStockQtyFilter("all"); setSearch(""); };
  const visibleStock = filteredStock.slice(0, stockLimit);
  const visibleCatalog = catalogParts.slice(0, catalogLimit);
  const visibleEquipment = filteredEquipment.slice(0, equipLimit);

  return (
    <div className="min-h-screen pb-28" style={{ background: "var(--bg)" }}>
      {/* Header strip */}
      <div className="sticky top-0 z-20 px-4 pt-[env(safe-area-inset-top)] pb-3" style={{ background: NAVY }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 pt-3">
          <div>
            <p className="font-display font-black text-white text-xl leading-none tracking-tight">BLUE BEAR <span style={{ color: ORANGE }}>INVENTORY</span></p>
            <p className="text-white/70 text-xs font-semibold mt-1">Warehouse • Trucks • Equipment • Consignment • Orders • Staging</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-white font-display font-black text-2xl leading-none">{data.stats.totalUnits}</p>
            <p className="text-white/70 text-[11px] font-bold uppercase tracking-wide">units on hand</p>
          </div>
        </div>
        {/* Stats row */}
        <div className="max-w-5xl mx-auto grid grid-cols-4 gap-2 mt-3">
          {[
            { label: "Low stock", value: data.stats.lowStockCount, color: data.stats.lowStockCount > 0 ? "#FF8A7A" : "#fff", tab: "stock" as Tab, action: () => { setTab("stock"); resetStockNav(); setStockQtyFilter("low"); } },
            { label: "Open orders", value: data.stats.openOrders, color: "#fff", tab: "orders" as Tab, action: () => setTab("orders") },
            { label: "To stage", value: data.stats.stagingNeeded, color: "#fff", tab: "staging" as Tab, action: () => setTab("staging") },
            { label: "Tech asks", value: data.stats.newTechRequests, color: data.stats.newTechRequests > 0 ? "#FFB37A" : "#fff", tab: "requests" as Tab, action: () => setTab("requests") },
          ].map(s => (
            <button key={s.label} onClick={s.action} className="rounded-xl bg-white/10 border border-white/15 px-2 py-2 text-left active:bg-white/20">
              <p className="font-display font-black text-xl leading-none" style={{ color: s.color }}>{s.value}</p>
              <p className="text-white/70 text-[11px] font-bold uppercase tracking-wide mt-1">{s.label}</p>
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 pt-4 space-y-5">
        {toast && <div className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-white" style={{ background: "#137333" }}><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast("")} className="ml-3 text-white/80 font-black">✕</button></div>}

        {needsSetup && tab === "board" && (
          <section className="rounded-2xl p-5 border-2 border-dashed" style={{ background: "var(--surface)", borderColor: ORANGE }}>
            <h2 className="font-display font-black text-lg">Start here — set up your locations</h2>
            <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>Add your warehouse first, then each van/truck. After that you can catalog parts, set stock levels, place orders, stage jobs, and take tech requests. Everything below is ready to use — it just starts empty because it's your real inventory.</p>
            <button onClick={() => { setTab("stock"); setStockManageOpen(true); }} className="mt-3 px-5 py-3 rounded-xl text-white font-bold" style={{ background: ORANGE }}>Set up locations & parts →</button>
          </section>
        )}

        {tab === "board" && (
          <>
            {/* AI photo tools */}
            <section>
              <h2 className="font-display font-black text-lg">📸 AI photo tools</h2>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button onClick={() => setTab("requests")} className="rounded-2xl p-4 text-left text-white" style={{ background: NAVY }}>
                  <p className="text-2xl leading-none">🔥</p>
                  <p className="font-display font-black mt-2 leading-tight">Tech photo ID</p>
                  <p className="text-white/75 text-xs mt-1 font-semibold">Snap a furnace or part — “I need a flame sensor for this” — AI names the exact part and files the request.</p>
                </button>
                <button onClick={() => setTab("verify")} className="rounded-2xl p-4 text-left text-white" style={{ background: ORANGE }}>
                  <p className="text-2xl leading-none">📦</p>
                  <p className="font-display font-black mt-2 leading-tight">Verify a delivery</p>
                  <p className="text-white/85 text-xs mt-1 font-semibold">Photo of the PO/invoice + photo of the actual part. AI confirms it's really at the shop and matches.</p>
                </button>
              </div>
              {data.stats.intakeMismatches > 0 && <button onClick={() => setTab("verify")} className="mt-2 w-full rounded-xl p-3 text-left font-bold text-sm text-white" style={{ background: "#C1272D" }}>⚠ {data.stats.intakeMismatches} intake mismatch{data.stats.intakeMismatches > 1 ? "es" : ""} on record — check Verify before stocking those parts</button>}
              <p className="text-xs mt-2 font-semibold" style={{ color: "var(--dim)" }}>{data.stats.intakeChecks} intake verification{data.stats.intakeChecks === 1 ? "" : "s"} logged so far</p>
            </section>
            {/* Low stock alerts */}
            <section>
              <div className="flex items-center justify-between"><h2 className="font-display font-black text-lg">⚠ Low stock — reorder soon</h2><button onClick={() => { setTab("stock"); resetStockNav(); setStockQtyFilter("low"); }} className="text-sm font-bold" style={{ color: NAVY }}>See all stock</button></div>
              {lowStock.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>Nothing at or below minimum right now. When a part hits its min, it shows up here.</p> : (
                <div className="mt-2 space-y-2">{lowStock.slice(0, 8).map(s => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "4px solid #C1272D" }}>
                    <div className="min-w-0"><p className="font-bold truncate">{s.partName} {s.sku && <span className="font-medium text-xs" style={{ color: "var(--dim)" }}>• {s.sku}</span>}</p><p className="text-xs" style={{ color: "var(--dim)" }}>{s.locationName} • Min {s.minQty}</p></div>
                    <div className="text-right shrink-0"><p className="font-display font-black text-xl" style={{ color: "#C1272D" }}>{s.quantity} left</p><button onClick={() => { setOrderForm(f => ({ ...f, lines: [{ partName: s.partName, sku: s.sku, qty: Math.max(5, s.minQty * 3), unitCost: "", partId: s.partId }] })); setTab("orders"); }} className="text-xs font-bold underline" style={{ color: NAVY }}>Reorder</button></div>
                  </div>
                ))}</div>
              )}
            </section>

            {/* Today's staging */}
            <section>
              <div className="flex items-center justify-between"><h2 className="font-display font-black text-lg">Jobs to stage</h2><button onClick={() => setTab("staging")} className="text-sm font-bold" style={{ color: NAVY }}>All staging</button></div>
              {data.staging.filter(s => s.status !== "done").length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No jobs waiting to be staged. Create one in Staging when a job is scheduled.</p> : (
                <div className="mt-2 space-y-2">{data.staging.filter(s => s.status !== "done").slice(0, 5).map(s => {
                  const pulled = s.lines.filter(l => l.pulled).length;
                  return <button key={s.id} onClick={() => setTab("staging")} className="w-full text-left rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div><p className="font-bold">{s.customer} <span className="font-medium text-xs" style={{ color: "var(--dim)" }}>• {s.jobType}</span></p><p className="text-xs" style={{ color: "var(--dim)" }}>{fmtJobDate(s.jobDate)}{s.truckName ? ` • → ${s.truckName}` : ""} • {pulled}/{s.lines.length} pulled</p></div>
                    <Badge color={statusColor(s.status)}>{s.status}</Badge>
                  </button>;
                })}</div>
              )}
            </section>

            {/* Incoming orders */}
            <section>
              <div className="flex items-center justify-between"><h2 className="font-display font-black text-lg">Orders in motion</h2><button onClick={() => setTab("orders")} className="text-sm font-bold" style={{ color: NAVY }}>All orders</button></div>
              {data.orders.filter(o => !["received", "cancelled"].includes(o.status)).length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No open purchase orders. Place one in Orders when you buy from a vendor.</p> : (
                <div className="mt-2 space-y-2">{data.orders.filter(o => !["received", "cancelled"].includes(o.status)).slice(0, 5).map(o => (
                  <button key={o.id} onClick={() => setTab("orders")} className="w-full text-left rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div><p className="font-bold">{o.vendor} {o.poNumber && <span className="font-medium text-xs" style={{ color: "var(--dim)" }}>• {o.poNumber}</span>}</p><p className="text-xs" style={{ color: "var(--dim)" }}>{o.receivedQty}/{o.totalQty} units received{o.eta ? ` • ETA ${o.eta}` : ""} • {fmtDate(o.created_at)}</p></div>
                    <Badge color={statusColor(o.status)}>{o.status.replace("_", " ")}</Badge>
                  </button>
                ))}</div>
              )}
            </section>

            {/* Material pricing from POs */}
            <section>
              <div className="flex items-center justify-between"><h2 className="font-display font-black text-lg">💲 Material pricing — from your POs</h2><button onClick={() => setTab("orders")} className="text-sm font-bold" style={{ color: NAVY }}>Import daily POs</button></div>
              <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>Costs come from your purchase orders, matched to materials by code, then name. A part bought at several prices carries the <strong>average</strong> of all of them.</p>
              {data.stats.pricedParts === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No PO prices matched yet. Paste or upload a daily PO in Orders → Daily PO price match, and every matched material gets its average cost here and in the catalog.</p> : (
                <>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none">{data.stats.pricedParts}<span className="text-sm" style={{ color: "var(--dim)" }}> / {data.stats.totalParts}</span></p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Materials priced</p></div>
                    <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none">{data.stats.pricedLines}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Priced PO lines</p></div>
                    <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none" style={{ color: data.stats.unmatchedPricedLines > 0 ? "#C1272D" : "var(--text)" }}>{data.stats.unmatchedPricedLines}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Priced but unmatched</p></div>
                  </div>
                  {data.partPrices.length > 0 && <div className="mt-2 space-y-1.5">{data.partPrices.slice(0, 5).map((pp, i) => (
                    <div key={`${pp.partId}-${pp.poNumber}-${i}`} className="rounded-xl px-3 py-2 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <p className="text-sm font-semibold truncate min-w-0">{pp.partName} <span className="font-normal" style={{ color: "var(--dim)" }}>• {pp.vendor}{pp.poNumber ? ` • PO ${pp.poNumber}` : ""} • {pp.date}</span></p>
                      <p className="font-display font-black shrink-0">{fmtMoney(pp.unitCostCents)}</p>
                    </div>
                  ))}</div>}
                  {data.stats.unmatchedPricedLines > 0 && <p className="text-xs font-bold mt-2" style={{ color: "#C1272D" }}>{data.stats.unmatchedPricedLines} priced PO line{data.stats.unmatchedPricedLines > 1 ? "s" : ""} didn't match a catalog part — open Orders and re-run the match to see exactly which ones and why.</p>}
                </>
              )}
            </section>

            {/* Tech requests preview */}
            <section>
              <div className="flex items-center justify-between"><h2 className="font-display font-black text-lg">New tech requests</h2><button onClick={() => setTab("requests")} className="text-sm font-bold" style={{ color: NAVY }}>All requests</button></div>
              {data.techRequests.filter(r => r.status === "new").length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No new requests. Techs submit specific parts they need in the Requests tab.</p> : (
                <div className="mt-2 space-y-2">{data.techRequests.filter(r => r.status === "new").slice(0, 5).map(r => (
                  <div key={r.id} className="rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div><p className="font-bold">{r.partDescription} ×{r.qty}</p><p className="text-xs" style={{ color: "var(--dim)" }}>{r.techName}{r.jobRef ? ` • ${r.jobRef}` : ""} • {fmtDate(r.created_at)}</p></div>
                    <Badge color={r.urgency === "urgent" || r.urgency === "emergency" ? "#C1272D" : undefined}>{r.urgency}</Badge>
                  </div>
                ))}</div>
              )}
            </section>

            {/* Equipment snapshot */}
            <section>
              <div className="flex items-center justify-between"><h2 className="font-display font-black text-lg">🧰 Equipment — where is it now?</h2><button onClick={() => setTab("equipment")} className="text-sm font-bold" style={{ color: NAVY }}>All equipment</button></div>
              <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>Tools, recovery machines, vacuum pumps and test gear tracked by van — every move is logged.</p>
              <div className="grid grid-cols-4 gap-2 mt-2">
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none">{data.stats.totalEquipment}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Total</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none" style={{ color: "#137333" }}>{data.stats.equipmentAvailable}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Available</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none" style={{ color: NAVY }}>{data.stats.equipmentInUse}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>In use</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none" style={{ color: data.stats.equipmentNeedsRepair + data.stats.equipmentMissing > 0 ? "#C1272D" : "var(--text)" }}>{data.stats.equipmentNeedsRepair + data.stats.equipmentMissing}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Repair / Missing</p></div>
              </div>
              {data.equipment.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No equipment tracked yet. Add your recovery machines, vacuum pumps, drain machines and specialty tools in the Equipment tab — assign each to a van or the warehouse.</p> : (
                <div className="mt-2 space-y-2">{data.equipment.filter(e => e.status === "needs_repair" || e.status === "out_of_service" || e.status === "missing").slice(0, 4).map(e => (
                  <button key={e.id} onClick={() => { setTab("equipment"); setHistoryEquipId(e.id); }} className="w-full text-left rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: "4px solid #C1272D" }}>
                    <div><p className="font-bold">{e.name} {e.assetTag && <span className="text-xs font-medium" style={{ color: "var(--dim)" }}>• {e.assetTag}</span>}</p><p className="text-xs" style={{ color: "var(--dim)" }}>{e.currentLocationName}{e.assignedTo ? ` • ${e.assignedTo}` : ""} • {e.category}</p></div>
                    <Badge color={statusColor(e.status)}>{equipStatusLabel(e.status)}</Badge>
                  </button>
                ))}
                {data.equipment.slice(0, 3).map(e => (
                  <button key={`recent-${e.id}`} onClick={() => setTab("equipment")} className="w-full text-left rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div><p className="font-bold">{e.name}</p><p className="text-xs" style={{ color: "var(--dim)" }}>📍 {e.currentLocationName}{e.assignedTo ? ` • ${e.assignedTo}` : ""}</p></div>
                    <Badge color={statusColor(e.status)}>{equipStatusLabel(e.status)}</Badge>
                  </button>
                ))}</div>
              )}
              {data.equipmentLogs.length > 0 && <div className="mt-2"><p className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>Latest movement</p><p className="text-sm font-semibold mt-0.5">{data.equipmentLogs[0]!.equipmentName} — {equipActionLabel(data.equipmentLogs[0]!.action)}{data.equipmentLogs[0]!.toLocationName ? ` → ${data.equipmentLogs[0]!.toLocationName}` : ""}{data.equipmentLogs[0]!.performedBy ? ` by ${data.equipmentLogs[0]!.performedBy}` : ""} • {fmtDate(data.equipmentLogs[0]!.created_at)}</p></div>}
            </section>

            {/* Consignment snapshot — equipment only */}
            <section>
              <div className="flex items-center justify-between"><h2 className="font-display font-black text-lg">🤝 Consignment — vendor-owned equipment</h2><button onClick={() => setTab("consignment")} className="text-sm font-bold" style={{ color: NAVY }}>Consignment log</button></div>
              <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>Equipment that belongs to a vendor, not Blue Bear. Every move is logged automatically and the owner is emailed.</p>
              {data.stats.totalConsigned === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>Nothing on consignment right now. Mark any piece of equipment as consigned in the Equipment tab — set its owner and notify email once — and its moves start logging and queuing owner emails from there.</p> : (
                <>
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none">{data.stats.totalConsigned}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Pieces consigned</p></div>
                    <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none">{data.stats.consignmentValueCents > 0 ? fmtMoney(data.stats.consignmentValueCents) : "—"}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Value on hand</p></div>
                    <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-xl leading-none" style={{ color: (data.stats as any).consignmentActionableEmails > 0 ? "#B45309" : "var(--text)" }}>{(data.stats as any).consignmentActionableEmails}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Emails not sent yet</p></div>
                  </div>
                  <div className="mt-2 space-y-2">
                    {(data as any).consignmentByOwner.map((o: any) => (
                      <button key={o.owner} onClick={() => { setConsignOwnerFilter(o.owner); setTab("consignment"); }} className="w-full text-left rounded-xl p-3 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                        <div className="min-w-0"><p className="font-bold truncate">{o.owner} <span className="font-medium text-xs" style={{ color: "var(--dim)" }}>• {o.count} piece{o.count === 1 ? "" : "s"}{o.valueCents > 0 ? ` • ${fmtMoney(o.valueCents)}` : ""}</span></p><p className="text-xs truncate" style={{ color: "var(--dim)" }}>{o.locations.join(" • ")}{o.email ? ` • ✉ ${o.email}` : " • ⚠ no email on file"}</p></div>
                        <span className="text-xs font-black shrink-0" style={{ color: NAVY }}>Log →</span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {consignedEquipment.slice(0, 4).map(e => (
                      <button key={e.id} onClick={() => setTab("consignment")} className="w-full text-left rounded-xl px-3 py-2 flex items-center justify-between gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                        <p className="text-sm font-semibold truncate min-w-0">{e.name} <span className="font-normal" style={{ color: "var(--dim)" }}>• {(e as any).consignmentOwner || "Owner?"}</span></p>
                        <p className="text-xs font-bold shrink-0" style={{ color: "var(--dim)" }}>📍 {e.currentLocationName}</p>
                      </button>
                    ))}
                  </div>
                  {(data.stats as any).consignmentActionableEmails > 0 && <button onClick={() => dispatchEmails.mutate()} disabled={dispatchEmails.isPending} className="mt-2 w-full py-3 rounded-xl text-white font-bold disabled:opacity-50" style={{ background: ORANGE }}>{dispatchEmails.isPending ? "Checking…" : `✉ Check queue — ${(data.stats as any).consignmentActionableEmails} email${(data.stats as any).consignmentActionableEmails === 1 ? "" : "s"} not sent yet`}</button>}
                </>
              )}
            </section>

            {/* Warehouse departments */}
            <section>
              <div className="flex items-center justify-between"><h2 className="font-display font-black text-lg">🏭 Warehouse — by department</h2><button onClick={() => { if (warehouseId) setStockLocFilter(warehouseId); setStockDeptFilter("all"); setStockSubcatFilter("all"); setTab("stock"); }} className="text-sm font-bold" style={{ color: NAVY }}>Open warehouse</button></div>
              <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>The warehouse is split so you don't scroll 658 parts. Tap a department, then a shelf category — pipe, fittings, valves and the rest each live in their own section.</p>
              {data.warehouseDepartments.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No warehouse stock yet. Departments appear once parts are catalogued.</p> : (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {data.warehouseDepartments.filter(d => d.department !== "Other").map(d => {
                    const meta = DEPARTMENT_META[d.department] ?? DEPARTMENT_META["Other"]!;
                    return <button key={d.department} onClick={() => goToWarehouseDept(d.department)} className="rounded-xl p-3 text-left" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderTop: `3px solid ${NAVY}` }}>
                      <div className="flex items-start justify-between gap-2"><p className="font-display font-black leading-tight">{d.department}</p><span className="text-xs font-black px-1.5 py-0.5 rounded" style={{ background: "var(--surface2)" }}>{d.partCount}</span></div>
                      <p className="text-[11px] mt-1 leading-snug" style={{ color: "var(--dim)" }}>{meta.blurb}</p>
                      <p className="text-[11px] font-bold mt-1.5" style={{ color: "var(--dim)" }}>{meta.shelf} • {d.totalUnits} units{d.lowStockCount > 0 ? ` • ` : ""}{d.lowStockCount > 0 && <span style={{ color: "#C1272D" }}>{d.lowStockCount} low</span>}</p>
                      {d.subcategories.length > 0 && <p className="text-[11px] mt-1 truncate" style={{ color: "var(--dim)" }}>{d.subcategories.slice(0, 3).map(s => s.category).join(" • ")}{d.subcategories.length > 3 ? ` +${d.subcategories.length - 3} more` : ""}</p>}
                    </button>;
                  })}
                  {data.warehouseDepartments.find(d => d.department === "Other") && (() => { const d = data.warehouseDepartments.find(x => x.department === "Other")!; return <button onClick={() => goToWarehouseDept("Other")} className="rounded-xl p-3 text-left border-dashed" style={{ background: "var(--surface)", border: "1px dashed var(--border)" }}><p className="font-display font-black leading-tight">Other / Unsorted</p><p className="text-[11px] mt-1" style={{ color: "var(--dim)" }}>{d.partCount} parts need a department — tap to sort them</p></button>; })()}
                </div>
              )}
            </section>

            {/* Locations — one dropdown, no wall of van cards */}
            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display font-black text-lg">Jump to a van or the warehouse</h2>
                <span className="text-xs font-bold shrink-0" style={{ color: "var(--dim)" }}>{data.locations.length} locations</span>
              </div>
              {data.locations.length === 0 ? <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>No locations yet — add them in Stock.</p> : (
                <>
                  <div className="mt-3 flex gap-2">
                    <div className="flex-1 min-w-0">
                      <LocationDropdown ariaLabel="Pick a van or location to view" locations={data.locations} value={boardLocPick} onChange={setBoardLocPick} placeholder="Choose a warehouse or van…" />
                    </div>
                    <button disabled={!boardLocPick} onClick={() => { const l = data.locations.find(x => x.id === Number(boardLocPick)); if (l) { openLocation(l); setTab("stock"); } }} className="px-5 rounded-xl text-white font-black shrink-0 disabled:opacity-40" style={{ background: ORANGE }}>View →</button>
                  </div>
                  {boardLocPick && (() => { const l = data.locations.find(x => x.id === Number(boardLocPick)); if (!l) return null; const c = locCounts(l.id); return <p className="text-sm font-semibold mt-2.5" style={{ color: "var(--dim)" }}>{l.kind === "warehouse" ? "🏭" : "🚐"} <span style={{ color: "var(--text)" }}>{l.name}</span> — {c.units} units • {c.rows} parts{c.low > 0 ? <> • <span style={{ color: "#C1272D" }}>{c.low} at/below min</span></> : " • nothing low"}</p>; })()}
                </>
              )}
            </section>
          </>
        )}

        {tab === "stock" && (
          <div className="space-y-5">
            {/* Sticky search + quick filters — pinned while a short list scrolls */}
            <div className="sticky top-[136px] z-10 -mx-4 px-4 py-2 space-y-2" style={{ background: "var(--bg)" }}>
              <div className="flex gap-2">
                {stockLocFilter !== "all" && <button onClick={resetStockNav} aria-label="Back to all locations" className="px-3 py-3 rounded-xl text-sm font-black text-white shrink-0" style={{ background: NAVY }}>← Locations</button>}
                <input aria-label="Search parts" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search part, SKU, category, or department…" className="flex-1 min-w-0 rounded-xl px-4 py-3 font-semibold outline-none" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
              </div>
              <div className="flex gap-2 flex-wrap items-center">
                <div className="flex rounded-full overflow-hidden" style={{ border: "1px solid var(--border)" }} role="group" aria-label="Quantity filter">
                  {([["all", "All"], ["onhand", "On hand"], ["low", "Low only"]] as const).map(([v, label]) => (
                    <button key={v} onClick={() => setStockQtyFilter(v)} aria-pressed={stockQtyFilter === v} className="px-3 py-2 text-sm font-bold" style={{ background: stockQtyFilter === v ? (v === "low" ? "#C1272D" : NAVY) : "var(--surface)", color: stockQtyFilter === v ? "#fff" : "var(--text)" }}>{label}</button>
                  ))}
                </div>
                {stockLocFilter !== "all" && (
                  <span className="inline-block w-56 max-w-[62vw]">
                    <LocationDropdown ariaLabel="Switch van or location" locations={data.locations} value={String(stockLocFilter)} onChange={raw => { const l = data.locations.find(x => x.id === Number(raw)); if (l) openLocation(l); }} placeholder="Switch location…" />
                  </span>
                )}
                {!isWarehouseSelected && stockDeptFilter !== "all" && (
                  <span className="flex gap-1.5 flex-wrap items-center">
                    <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--dim)" }}>Department:</span>
                    {DEPARTMENTS.filter(d => d !== "Other").map(d => <button key={d} onClick={() => { setStockDeptFilter(d); setStockSubcatFilter("all"); }} aria-pressed={stockDeptFilter === d} className="px-2.5 py-1.5 rounded-full text-xs font-bold" style={{ background: stockDeptFilter === d ? NAVY : "var(--surface)", color: stockDeptFilter === d ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>{d}</button>)}
                  </span>
                )}
                {(stockDeptFilter !== "all" || stockSubcatFilter !== "all") && <button onClick={() => { setStockDeptFilter("all"); setStockSubcatFilter("all"); }} className="px-3 py-2 rounded-full text-sm font-bold text-white" style={{ background: ORANGE }}>Clear department ✕</button>}
              </div>
            </div>

            {finderMode ? (
              /* Finder — one dropdown picks the location; no van wall */
              <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <h2 className="font-display font-black text-lg">Find stock by location</h2>
                <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>Pick a warehouse or van from the dropdown — or just search above to find a part anywhere. Parts load one location at a time, smallest size first, 50 at a time.</p>
                {data.locations.length === 0 ? <p className="mt-3 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface2)", color: "var(--dim)" }}>No locations yet — add your warehouse and vans in the Locations section below.</p> : (
                  <>
                    <div className="mt-3 flex gap-2">
                      <div className="flex-1 min-w-0">
                        <LocationDropdown ariaLabel="Pick a van or location to browse stock" locations={data.locations} value={finderLocPick} onChange={setFinderLocPick} placeholder="Choose a warehouse or van…" />
                      </div>
                      <button disabled={!finderLocPick} onClick={() => { const l = data.locations.find(x => x.id === Number(finderLocPick)); if (l) openLocation(l); }} className="px-5 rounded-xl text-white font-black shrink-0 disabled:opacity-40" style={{ background: NAVY }}>View stock →</button>
                    </div>
                    {finderLocPick && (() => { const l = data.locations.find(x => x.id === Number(finderLocPick)); if (!l) return null; const c = locCounts(l.id); return <p className="text-sm font-semibold mt-2.5" style={{ color: "var(--dim)" }}>{c.units} units on hand • {c.rows} parts stocked{c.low > 0 ? <> • <span style={{ color: "#C1272D" }}>{c.low} at/below min</span></> : ""}{l.kind === "warehouse" ? " • Opens by department" : ""}</p>; })()}
                    <div className="flex gap-2 mt-3 flex-wrap">
                      <button onClick={() => setStockQtyFilter("low")} className="px-3.5 py-2 rounded-full text-sm font-bold text-white" style={{ background: "#C1272D" }}>⚠ Low stock everywhere</button>
                      {warehouseLocs[0] && <button onClick={() => openLocation(warehouseLocs[0]!)} className="px-3.5 py-2 rounded-full text-sm font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>🏭 Warehouse departments</button>}
                    </div>
                  </>
                )}
              </section>
            ) : (<>
            {/* Warehouse departments — compact chips, only inside the warehouse */}
            {isWarehouseSelected && !search.trim() && (
              <section>
                <div className="flex gap-2 flex-wrap items-center">
                  <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--dim)" }}>Department:</span>
                  <button onClick={() => { setStockDeptFilter("all"); setStockSubcatFilter("all"); }} aria-pressed={stockDeptFilter === "all"} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: stockDeptFilter === "all" ? NAVY : "var(--surface)", color: stockDeptFilter === "all" ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>All</button>
                  {data.warehouseDepartments.map(d => (
                    <button key={d.department} onClick={() => goToWarehouseDept(d.department)} aria-pressed={stockDeptFilter === d.department} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: stockDeptFilter === d.department ? NAVY : "var(--surface)", color: stockDeptFilter === d.department ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>
                      {d.department} {d.lowStockCount > 0 ? <span style={{ color: stockDeptFilter === d.department ? "#FFB4A8" : "#C1272D" }}>•{d.lowStockCount}</span> : ""}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* Subcategory shelves — only when a department is picked */}
            {stockDeptFilter !== "all" && subcategoriesForDept.length > 0 && (
              <section>
                <h3 className="font-display font-black">Shelves in {stockDeptFilter}</h3>
                <p className="text-xs font-semibold" style={{ color: "var(--dim)" }}>{DEPARTMENT_META[stockDeptFilter]?.blurb} • {DEPARTMENT_META[stockDeptFilter]?.shelf}</p>
                <div className="flex gap-2 flex-wrap mt-2">
                  <button onClick={() => setStockSubcatFilter("all")} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: stockSubcatFilter === "all" ? NAVY : "var(--surface)", color: stockSubcatFilter === "all" ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>All shelves ({activeDeptData?.partCount ?? 0})</button>
                  {subcategoriesForDept.map(sc => <button key={sc.category} onClick={() => setStockSubcatFilter(sc.category)} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: stockSubcatFilter === sc.category ? NAVY : "var(--surface)", color: stockSubcatFilter === sc.category ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>{sc.category} ({sc.count})</button>)}
                </div>
              </section>
            )}

            {/* Stock list — minimal rows: name, count, +/-; tap the name for details */}
            <section>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h2 className="font-display font-black text-lg">
                  {stockLocFilter !== "all" ? (data.locations.find(l => l.id === stockLocFilter)?.name ?? "Stock") : "All locations"}{stockDeptFilter !== "all" ? ` — ${stockDeptFilter}` : ""}{stockSubcatFilter !== "all" ? ` › ${stockSubcatFilter}` : ""} ({filteredStock.length})
                </h2>
                {stockLocFilter !== "all" && <button onClick={() => { setStockManageOpen(true); setBulkFromId(stockLocFilter); setBulkQty({}); setBulkResult(null); setTimeout(() => document.getElementById("bulk-transfer")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); }} className="px-3 py-2 rounded-full text-xs font-black text-white" style={{ background: ORANGE }}>↔ Bulk transfer from here</button>}
              </div>
              {filteredStock.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No stock rows match. Try another department, clear the search, or switch location.</p> : (
                <>
                  <div className="mt-2 space-y-1.5">{visibleStock.map(s => {
                    const low = s.quantity <= s.minQty;
                    const open = stockOpenId === s.id;
                    return <div key={s.id} className="rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: low ? "4px solid #C1272D" : "4px solid transparent" }}>
                      <div className="flex items-center gap-2 p-2">
                        <button onClick={() => setStockOpenId(open ? null : s.id)} aria-expanded={open} aria-label={`Details for ${s.partName}`} className="min-w-0 flex-1 text-left pl-1">
                          <p className="font-bold leading-tight truncate">{s.partName}</p>
                          {stockLocFilter === "all" && <p className="text-[11px] font-semibold truncate" style={{ color: "var(--dim)" }}>{s.locationName}</p>}
                        </button>
                        <button aria-label={`Remove one ${s.partName} from ${s.locationName}`} onClick={() => adjustStock.mutate({ stockId: s.id, delta: -1 })} className="w-12 py-2.5 rounded-lg font-black text-lg shrink-0" style={{ background: "var(--surface2)" }}>−</button>
                        <p className="font-display font-black text-2xl leading-none w-11 text-center shrink-0" style={{ color: low ? "#C1272D" : "var(--text)" }}>{s.quantity}</p>
                        <button aria-label={`Add one ${s.partName} to ${s.locationName}`} onClick={() => adjustStock.mutate({ stockId: s.id, delta: 1 })} className="w-12 py-2.5 rounded-lg font-black text-lg text-white shrink-0" style={{ background: NAVY }}>+</button>
                      </div>
                      {open && (
                        <div className="px-3 pb-3 pt-2 mx-2 mb-2 rounded-lg text-xs font-semibold space-y-1.5" style={{ background: "var(--surface2)", color: "var(--dim)" }}>
                          <p>{s.sku || "No SKU"} • {s.category} • {(s as any).department} • {s.locationName}{s.priceCount > 0 ? ` • Avg ${fmtMoney(s.avgCostCents)}` : ""}</p>
                          <p style={low ? { color: "#C1272D", fontWeight: 800 } : undefined}>Reorder at {s.minQty}{low ? " — at/below min now" : ""}</p>
                          <button aria-label={`Add five ${s.partName} to ${s.locationName}`} onClick={() => adjustStock.mutate({ stockId: s.id, delta: 5 })} className="px-4 py-2 rounded-lg font-bold text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>+5</button>
                        </div>
                      )}
                    </div>;
                  })}</div>
                  {filteredStock.length > stockLimit && <button onClick={() => setStockLimit(v => v + 50)} className="mt-3 w-full py-3 rounded-xl text-sm font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>Show next 50 — {filteredStock.length - stockLimit} more below</button>}
                </>
              )}
            </section>
            </>)}

            {/* Admin lives behind one fold — the day-to-day screen is just find and count */}
            {!stockManageOpen ? (
              <button onClick={() => setStockManageOpen(true)} className="w-full py-3.5 rounded-2xl text-sm font-bold" style={{ background: "var(--surface)", border: "1px dashed var(--border)", color: "var(--dim)" }}>🛠 Manage — set stock levels · bulk transfer · parts catalog · locations</button>
            ) : (<>
            <div className="flex items-center justify-between">
              <h3 className="font-display font-black text-lg">🛠 Manage</h3>
              <button onClick={() => setStockManageOpen(false)} className="px-3 py-2 rounded-full text-xs font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>Hide ✕</button>
            </div>

            {/* Set stock */}
            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h3 className="font-display font-black">Set stock for a part</h3>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-xs font-bold col-span-2">Part<select aria-label="Part for stock" value={stockForm.partId} onChange={e => setStockForm(f => ({ ...f, partId: Number(e.target.value) }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}><option value={0}>Choose part…</option>{sortedParts.map(p => <option key={p.id} value={p.id}>{p.name} {p.sku ? `(${p.sku})` : ""}</option>)}</select></label>
                <label className="text-xs font-bold col-span-2">Location<select aria-label="Location for stock" value={stockForm.locationId} onChange={e => setStockForm(f => ({ ...f, locationId: Number(e.target.value) }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}><option value={0}>Choose location…</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name} ({l.kind})</option>)}</select></label>
                <label className="text-xs font-bold">Quantity<input aria-label="Quantity on hand" type="number" min={0} value={stockForm.quantity} onChange={e => setStockForm(f => ({ ...f, quantity: Number(e.target.value) }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">Min (reorder at)<input aria-label="Minimum quantity" type="number" min={0} value={stockForm.minQty} onChange={e => setStockForm(f => ({ ...f, minQty: Number(e.target.value) }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
              </div>
              <button disabled={!stockForm.partId || !stockForm.locationId} onClick={() => upsertStock.mutate()} className="mt-3 w-full py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: NAVY }}>Save stock level</button>
            </section>

            {/* Bulk transfer — many parts, one move */}
            <section id="bulk-transfer" className="rounded-2xl p-4 scroll-mt-36" style={{ background: "var(--surface)", border: "2px solid " + ORANGE }}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="font-display font-black text-lg leading-tight">↔ Bulk transfer — move many parts at once</h3>
                  <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>Pick a source and a destination once, check off every part you want to move, set each quantity, then transfer them all in one tap. No more one-by-one.</p>
                </div>
                {bulkSelectedCount > 0 && <span className="px-3 py-1.5 rounded-full text-xs font-black text-white shrink-0" style={{ background: NAVY }}>{bulkSelectedCount} part{bulkSelectedCount === 1 ? "" : "s"} • {bulkTotalUnits} units selected</span>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-2 mt-3 items-end">
                <label className="text-xs font-bold block">From — source location
                  <span className="block mt-1"><LocationDropdown ariaLabel="Bulk transfer from location" locations={data.locations} value={bulkFromId ? String(bulkFromId) : ""} onChange={raw => { setBulkFromId(Number(raw) || 0); setBulkQty({}); setBulkResult(null); }} placeholder="Choose source…" /></span>
                </label>
                <button aria-label="Swap transfer source and destination" onClick={() => { const f = bulkFromId; setBulkFromId(bulkToId); setBulkToId(f); setBulkQty({}); setBulkResult(null); }} className="px-4 py-3 rounded-xl font-black text-white sm:mb-0.5" style={{ background: NAVY }}>⇄ Swap</button>
                <label className="text-xs font-bold block">To — destination location
                  <span className="block mt-1"><LocationDropdown ariaLabel="Bulk transfer to location" locations={data.locations} value={bulkToId ? String(bulkToId) : ""} onChange={raw => { setBulkToId(Number(raw) || 0); setBulkResult(null); }} placeholder="Choose destination…" /></span>
                </label>
              </div>
              {bulkFromId !== 0 && bulkToId !== 0 && bulkFromId === bulkToId && <p className="mt-2 text-sm font-bold" style={{ color: "#C1272D" }}>Source and destination are the same — pick a different destination.</p>}

              {!bulkFromId ? (
                <p className="mt-3 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface2)", color: "var(--dim)" }}>Choose a source location above to see everything on hand there and start checking parts off.</p>
              ) : bulkSourceStock.length === 0 ? (
                <p className="mt-3 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface2)", color: "var(--dim)" }}>Nothing on hand at {data.locations.find(l => l.id === bulkFromId)?.name ?? "that location"} right now — every part there is at zero, so there's nothing to transfer out.</p>
              ) : (
                <>
                  <div className="flex gap-2 mt-3">
                    <input aria-label="Search parts to transfer" value={bulkSearch} onChange={e => setBulkSearch(e.target.value)} placeholder="Search parts at source — name, SKU, category…" className="flex-1 min-w-0 rounded-xl px-4 py-3 font-semibold outline-none" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} />
                    {bulkSearch && <button onClick={() => setBulkSearch("")} className="px-3 py-2 rounded-xl text-sm font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Clear ✕</button>}
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    <button onClick={() => { const next = { ...bulkQty }; for (const s of bulkFilteredStock.slice(0, bulkLimit)) if (!(s.partId in next)) next[s.partId] = 1; setBulkQty(next); setBulkResult(null); }} className="px-3 py-2 rounded-full text-xs font-black text-white" style={{ background: NAVY }}>☑ Select visible ({Math.min(bulkLimit, bulkFilteredStock.length)})</button>
                    <button onClick={() => { const next = { ...bulkQty }; for (const s of bulkFilteredStock) if (!(s.partId in next)) next[s.partId] = 1; setBulkQty(next); setBulkResult(null); }} className="px-3 py-2 rounded-full text-xs font-black" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Select all {bulkFilteredStock.length} at source</button>
                    {bulkSelectedCount > 0 && <>
                      <button onClick={() => { const next: Record<number, number> = {}; for (const [pid, q] of Object.entries(bulkQty)) { const row = bulkSourceStock.find(s => s.partId === Number(pid)); next[Number(pid)] = row ? row.quantity : q; } setBulkQty(next); }} className="px-3 py-2 rounded-full text-xs font-black" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Set selected to full on-hand qty</button>
                      <button onClick={() => { const next: Record<number, number> = {}; for (const pid of Object.keys(bulkQty)) next[Number(pid)] = 1; setBulkQty(next); }} className="px-3 py-2 rounded-full text-xs font-black" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Set selected to 1 each</button>
                      <button onClick={() => { setBulkQty({}); setBulkResult(null); }} className="px-3 py-2 rounded-full text-xs font-black text-white" style={{ background: "#C1272D" }}>Clear selection</button>
                    </>}
                    <span className="text-xs font-semibold" style={{ color: "var(--dim)" }}>{bulkFilteredStock.length} parts on hand at source • sorted by size</span>
                  </div>

                  {bulkFilteredStock.length === 0 ? <p className="mt-3 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface2)", color: "var(--dim)" }}>No parts at the source match that search.</p> : (
                    <div className="mt-2 space-y-2">
                      {bulkFilteredStock.slice(0, bulkLimit).map(s => {
                        const selected = s.partId in bulkQty;
                        const qty = bulkQty[s.partId] ?? 1;
                        return (
                          <div key={s.id} className="rounded-xl p-3" style={{ background: selected ? "var(--surface2)" : "var(--surface)", border: selected ? `2px solid ${NAVY}` : "1px solid var(--border)" }}>
                            <div className="flex items-start gap-3">
                              <input type="checkbox" aria-label={`Select ${s.partName} for bulk transfer`} checked={selected} onChange={() => toggleBulkPart(s.partId)} className="mt-1 h-6 w-6 shrink-0 cursor-pointer accent-[#052A78]" />
                              <div className="min-w-0 flex-1">
                                <p className="font-bold leading-tight">{s.partName}</p>
                                <p className="text-xs" style={{ color: "var(--dim)" }}>{s.sku || "No SKU"} • {s.category} • {(s as any).department} • <strong>{s.quantity} on hand</strong> at source</p>
                              </div>
                              {selected && <span className="text-[11px] font-black uppercase tracking-wide px-2 py-1 rounded-full text-white shrink-0" style={{ background: "#137333" }}>Selected</span>}
                            </div>
                            {selected && (
                              <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                                <span className="text-xs font-black uppercase tracking-wide" style={{ color: "var(--dim)" }}>Move:</span>
                                <button aria-label={`Decrease transfer quantity for ${s.partName}`} onClick={() => setBulkPartQty(s.partId, qty - 1, s.quantity)} className="px-3 py-2 rounded-lg font-black" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>−</button>
                                <input aria-label={`Transfer quantity for ${s.partName}`} type="number" min={1} max={s.quantity} value={qty} onChange={e => setBulkPartQty(s.partId, Number(e.target.value), s.quantity)} className="w-20 rounded-lg px-3 py-2 font-black text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
                                <button aria-label={`Increase transfer quantity for ${s.partName}`} onClick={() => setBulkPartQty(s.partId, qty + 1, s.quantity)} className="px-3 py-2 rounded-lg font-black text-white" style={{ background: NAVY }}>+</button>
                                <button aria-label={`Transfer all on hand of ${s.partName}`} onClick={() => setBulkPartQty(s.partId, s.quantity, s.quantity)} className="px-3 py-2 rounded-lg font-bold text-sm" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>All {s.quantity}</button>
                                <span className="text-xs font-semibold" style={{ color: "var(--dim)" }}>of {s.quantity} on hand</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {bulkFilteredStock.length > bulkLimit && <button onClick={() => setBulkLimit(v => v + 50)} className="w-full py-3 rounded-xl text-sm font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Show next 50 — {bulkFilteredStock.length - bulkLimit} more at source</button>}
                    </div>
                  )}

                  <div className="sticky bottom-24 z-10 mt-3 rounded-2xl p-3 flex items-center justify-between gap-3 flex-wrap" style={{ background: NAVY, boxShadow: "0 8px 24px rgba(0,0,0,0.25)" }}>
                    <p className="text-white font-bold text-sm">{bulkSelectedCount === 0 ? "Check parts above to build your transfer" : `${bulkSelectedCount} part${bulkSelectedCount === 1 ? "" : "s"} selected • ${bulkTotalUnits} units total`}{bulkToId ? <> → <span style={{ color: "#FFB37A" }}>{data.locations.find(l => l.id === bulkToId)?.name}</span></> : " • pick a destination above"}</p>
                    <button disabled={bulkInvalid || bulkTransfer.isPending} onClick={() => bulkTransfer.mutate()} className="px-5 py-3 rounded-xl text-white font-black disabled:opacity-40" style={{ background: ORANGE }}>{bulkTransfer.isPending ? "Transferring…" : bulkSelectedCount > 0 ? `Transfer ${bulkSelectedCount} part${bulkSelectedCount === 1 ? "" : "s"} →` : "Transfer selected →"}</button>
                  </div>
                </>
              )}

              {bulkResult && (
                <div className="mt-3 rounded-xl p-3" style={{ background: bulkResult.ok ? "#13733322" : "#C1272D18", border: `1px solid ${bulkResult.ok ? "#137333" : "#C1272D"}` }}>
                  <p className="text-sm font-black" style={{ color: bulkResult.ok ? "#137333" : "#C1272D" }}>{bulkResult.ok ? "✓ " : "⚠ "}{bulkResult.message}</p>
                  {bulkResult.failed.length > 0 && <ul className="mt-1.5 space-y-1">{bulkResult.failed.map(f => <li key={f.partId} className="text-xs font-semibold">• {f.partName} ×{f.qty} — {f.reason}. It's still selected above — fix the quantity and transfer again.</li>)}</ul>}
                </div>
              )}
            </section>

            {/* Parts catalog — grouped by department */}
            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-display font-black">Parts catalog ({catalogParts.length}){stockDeptFilter !== "all" ? ` in ${stockDeptFilter}` : ""}</h3>
                {stockDeptFilter !== "all" && <button onClick={() => { setStockDeptFilter("all"); setStockSubcatFilter("all"); }} className="text-xs font-bold" style={{ color: NAVY }}>Show all departments</button>}
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>Every part lives in one warehouse department. Change the department with the dropdown on its row — that's how you re-file a part to a different aisle.</p>
              {catalogParts.length > 0 && <div className="mt-2 space-y-1.5">{visibleCatalog.map(p => {
                const total = data.stock.filter(s => s.partId === p.id).reduce((a, s) => a + s.quantity, 0);
                const dept = (p as any).department as string;
                return <div key={p.id} className="rounded-lg px-3 py-2" style={{ background: "var(--surface2)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate min-w-0">{p.name} <span className="font-normal" style={{ color: "var(--dim)" }}>{p.sku} • {p.category} • {total} total</span></p>
                    <button aria-label={`Delete part ${p.name}`} onClick={() => { deletePart.mutate(p.id); }} className="text-xs font-bold shrink-0" style={{ color: "#C1272D" }}>Delete</button>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--dim)" }}>Dept:</span>
                    <select aria-label={`Department for ${p.name}`} value={dept} onChange={e => setPartDept.mutate({ partId: p.id, department: e.target.value })} className="text-xs font-bold rounded-md px-2 py-1" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>{DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}</select>
                    <span className="text-[11px] font-semibold" style={{ color: "var(--dim)" }}>{DEPARTMENT_META[dept]?.shelf}</span>
                  </div>
                  {p.priceCount > 0 ? (
                    <div className="mt-1.5">
                      <p className="text-[11px] font-bold" style={{ color: "#137333" }}>Avg cost {fmtMoney(p.avgCostCents)} <span className="font-semibold" style={{ color: "var(--dim)" }}>• last {fmtMoney(p.lastCostCents)} • {p.priceCount} PO price{p.priceCount > 1 ? "s" : ""} averaged • {p.lastVendor}{p.lastPricedAt ? ` • ${p.lastPricedAt}` : ""}</span></p>
                      <button aria-label={`Toggle PO price history for ${p.name}`} onClick={() => setPriceHistoryPartId(priceHistoryPartId === p.id ? null : p.id)} className="text-[11px] font-black underline" style={{ color: NAVY }}>{priceHistoryPartId === p.id ? "Hide price history" : "Price history"}</button>
                      {priceHistoryPartId === p.id && <div className="mt-1 space-y-1">{data.partPrices.filter(pp => pp.partId === p.id).map((pp, i) => <p key={i} className="text-[11px] font-semibold rounded px-2 py-1" style={{ background: "var(--surface)" }}>{pp.date} • {pp.vendor}{pp.poNumber ? ` • PO ${pp.poNumber}` : ""} • <strong>{fmtMoney(pp.unitCostCents)}</strong> ea ×{pp.qty}</p>)}{data.partPrices.filter(pp => pp.partId === p.id).length === 0 && <p className="text-[11px] font-semibold" style={{ color: "var(--dim)" }}>No priced PO lines found for this part.</p>}</div>}
                    </div>
                  ) : <p className="text-[11px] font-semibold mt-1.5" style={{ color: "var(--dim)" }}>No PO price yet — it lands here when a daily PO matches this part</p>}
                </div>;
              })}</div>}
              {catalogParts.length === 0 && <p className="text-sm font-semibold mt-2" style={{ color: "var(--dim)" }}>No parts match — try a different department or clear the search.</p>}
              {catalogParts.length > catalogLimit && <button onClick={() => setCatalogLimit(v => v + 50)} className="mt-2 w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Show next 50 parts — {catalogParts.length - catalogLimit} more</button>}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-xs font-bold col-span-2">Part name<input aria-label="New part name" value={partForm.name} onChange={e => setPartForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. PEX elbow 3-4 inch" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">SKU / Mfr #<input aria-label="Part SKU" value={partForm.sku} onChange={e => setPartForm(f => ({ ...f, sku: e.target.value }))} placeholder="Optional" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">Shelf category (original)<select aria-label="Part category" value={partForm.category} onChange={e => setPartForm(f => ({ ...f, category: e.target.value, department: deptForCategory(e.target.value) }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>{["General", "Plumbing", "HVAC", "Water Heaters", "Fittings", "Valves", "Electrical", "Filters", "Tools/Consumables", "Propress", "PVC", "Pex", "BM", "Mega", "Brass", "Sweat", "Push", "Ball Valve", "Stop", "Gas Cock", "Pipe & Tubing", "Black Nips", "Brass Nips", "Pex Pipe", "Smoke Pipe", "Boiler", "Hydro", "Thermo", "Navien", "Tank", "Toilet", "Lavatory", "Faucet", "Tub & Shower", "Hardware", "Hangers, Clips & Clamps", "Consumables", "Safety"].map(c => <option key={c}>{c}</option>)}</select></label>
                <label className="text-xs font-bold col-span-2">Warehouse department<select aria-label="Part department" value={partForm.department} onChange={e => setPartForm(f => ({ ...f, department: e.target.value }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>{DEPARTMENTS.map(d => <option key={d} value={d}>{d} — {DEPARTMENT_META[d]?.shelf}</option>)}</select><span className="block mt-1 font-semibold normal-case" style={{ color: "var(--dim)" }}>Auto-filled from the shelf category — change it if the part belongs on a different aisle.</span></label>
              </div>
              <button disabled={!partForm.name.trim()} onClick={() => createPart.mutate()} className="mt-3 w-full py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: NAVY }}>Add part to {partForm.department}</button>
            </section>

            {/* Locations */}
            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h3 className="font-display font-black">Locations — warehouse & vans ({data.locations.length})</h3>
              <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>All {data.locations.length} locations live in the dropdowns at the top of Stock, the Board, and Equipment — pick one there to view it. Add a new location below.</p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-xs font-bold col-span-2">Location name<input aria-label="New location name" value={locForm.name} onChange={e => setLocForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Norwell Warehouse, Van 3" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">Type<select aria-label="Location type" value={locForm.kind} onChange={e => setLocForm(f => ({ ...f, kind: e.target.value as any }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}><option value="warehouse">Warehouse</option><option value="truck">Truck / Van</option></select></label>
                <label className="text-xs font-bold">Assigned tech<input aria-label="Assigned technician" value={locForm.assignedTo} onChange={e => setLocForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="For trucks" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
              </div>
              <button disabled={!locForm.name.trim()} onClick={() => createLoc.mutate()} className="mt-3 w-full py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: NAVY }}>Add location</button>
              <p className="text-xs mt-2" style={{ color: "var(--dim)" }}>Tip: name vans by number + tech (e.g. “Van 2 — Mike”) so staging and transfers are obvious on the floor.</p>
            </section>
            </>)}
          </div>
        )}

        {tab === "orders" && (
          <div className="space-y-5">
            <button onClick={() => setTab("verify")} className="w-full rounded-2xl p-4 text-left text-white" style={{ background: ORANGE }}>
              <p className="font-display font-black">📸 New delivery? Verify it with AI photos first →</p>
              <p className="text-white/85 text-sm font-semibold mt-0.5">Photograph the PO/invoice and the actual part — AI confirms the right part is at the shop before you receive it below.</p>
            </button>
            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h3 className="font-display font-black text-lg">Warehouse intake — receive into</h3>
              <select aria-label="Warehouse location for receiving" value={receiveLoc ?? ""} onChange={e => setReceiveLoc(e.target.value ? Number(e.target.value) : null)} className="mt-2 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
                <option value="">Choose warehouse… (receiving adds stock here)</option>
                {warehouseLocs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
              {warehouseLocs.length === 0 && <p className="text-xs mt-1 font-semibold" style={{ color: "#C1272D" }}>Add a warehouse location in Stock first so received parts have somewhere to land.</p>}
            </section>

            {/* Daily PO price match */}
            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "2px solid " + NAVY }}>
              <h3 className="font-display font-black text-lg">💲 Daily PO price match — price your materials</h3>
              <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>Give me your daily POs and I'll match the pricing onto your materials. Each line is matched <strong>by code (SKU) first, then by exact part name</strong> — a shared code uses the name to pick the right part. When a material shows up at <strong>multiple prices, its cost is the average</strong> of all of them. Lines that match nothing are listed, never guessed.</p>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="rounded-xl p-2.5 text-center" style={{ background: "var(--surface2)" }}><p className="font-display font-black text-lg leading-none">{data.stats.pricedParts} / {data.stats.totalParts}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Materials priced</p></div>
                <div className="rounded-xl p-2.5 text-center" style={{ background: "var(--surface2)" }}><p className="font-display font-black text-lg leading-none">{data.stats.pricedLines}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Priced PO lines</p></div>
                <div className="rounded-xl p-2.5 text-center" style={{ background: "var(--surface2)" }}><p className="font-display font-black text-lg leading-none" style={{ color: data.stats.unmatchedPricedLines > 0 ? "#C1272D" : "var(--text)" }}>{data.stats.unmatchedPricedLines}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Unmatched</p></div>
              </div>
              <label className="text-xs font-bold block mt-4">Vendor (used for any rows without one)<input aria-label="Default vendor for PO import" value={poVendor} onChange={e => setPoVendor(e.target.value)} placeholder="e.g. F.W. Webb, Ferguson, Brookaire" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
              <label className="text-xs font-bold block mt-3">Paste your daily PO export (CSV or spreadsheet copy-paste)
                <textarea aria-label="Paste daily PO data" value={poText} onChange={e => setPoText(e.target.value)} rows={6} placeholder={"Vendor,PO #,Code,Description,Qty,Unit Price\nF.W. Webb,88412,1/2BDDO,1/2\" Boiler Drain Draw Off,10,4.85"} className="mt-1 w-full rounded-lg px-3 py-2.5 font-mono text-xs font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} />
              </label>
              <div className="flex gap-2 mt-2 flex-wrap items-center">
                <input ref={poFileRef} type="file" accept=".csv,.txt,.tsv" aria-label="Upload a PO CSV file" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { setPoText(await f.text()); } catch { setPoResult({ error: "Couldn't read that file — try pasting the PO text instead." }); } }} />
                <button onClick={() => poFileRef.current?.click()} className="px-4 py-2.5 rounded-xl text-sm font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>📄 Upload CSV file</button>
                <details className="text-xs font-semibold" style={{ color: "var(--dim)" }}><summary className="cursor-pointer font-bold">What format?</summary><p className="mt-1 max-w-md">Best: a header row — Vendor, PO #, Code, Description, Qty, Unit Price (a Line Total column works too; it's divided by qty). No header? Columns in this order: PO #, Code, Description, Qty, Unit Price. Copy-paste straight from Excel works — tabs are fine.</p></details>
              </div>
              {poPreview && poPreview.rows.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-bold">{poPreview.rows.length} lines read • {poPreview.matchCount} will match a material • {poPreview.rows.length - poPreview.matchCount} won't{poPreview.noPrice > 0 ? ` • ${poPreview.noPrice} without a price` : ""}{poPreview.skipped > 0 ? ` • ${poPreview.skipped} rows skipped (no description)` : ""}</p>
                  <div className="mt-2 space-y-1.5 max-h-64 overflow-auto">{poPreview.matched.slice(0, 40).map((m, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: "var(--surface2)" }}>
                      <p className="text-xs font-semibold min-w-0 truncate">{m.row.partName} <span className="font-normal" style={{ color: "var(--dim)" }}>{m.row.sku ? `• ${m.row.sku}` : ""} • ×{m.row.qty} • {m.row.unitCostCents ? fmtMoney(m.row.unitCostCents) + " ea" : "no price"}{m.match.partName && m.match.partName !== m.row.partName ? ` → ${m.match.partName}` : ""}</span></p>
                      <Badge color={m.match.color}>{m.match.label}</Badge>
                    </div>
                  ))}{poPreview.matched.length > 40 && <p className="text-xs font-semibold" style={{ color: "var(--dim)" }}>+ {poPreview.matched.length - 40} more lines — all included in the import.</p>}</div>
                  <button disabled={importPo.isPending} onClick={() => importPo.mutate()} className="mt-3 w-full py-3 rounded-xl text-white font-black disabled:opacity-50" style={{ background: ORANGE }}>{importPo.isPending ? "Importing & matching prices…" : `Import ${poPreview.rows.length} lines & update material prices`}</button>
                </div>
              )}
              {poPreview && poPreview.rows.length === 0 && poText.trim() && <p className="mt-2 text-sm font-bold" style={{ color: "#C1272D" }}>Couldn't read any PO lines from that — check the format help above.</p>}
              <button disabled={recalcPricing.isPending} onClick={() => recalcPricing.mutate()} className="mt-3 w-full py-2.5 rounded-xl text-sm font-bold disabled:opacity-50" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>{recalcPricing.isPending ? "Re-matching…" : "↻ Re-run price match on all POs already in the app"}</button>
              {poResult && (
                <div className="mt-3 rounded-xl p-3" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
                  {poResult.error ? <p className="text-sm font-bold" style={{ color: "#C1272D" }}>{poResult.error}</p> : (
                    <>
                      <p className="text-sm font-black" style={{ color: "#137333" }}>✓ {poResult.ordersCreated > 0 ? `${poResult.ordersCreated} PO${poResult.ordersCreated > 1 ? "s" : ""} created • ` : ""}{poResult.matchedLines} of {poResult.pricedLines} priced lines matched • {poResult.partsPriced} materials now carry an average cost</p>
                      {poResult.unmatched?.length > 0 ? (
                        <div className="mt-2">
                          <p className="text-xs font-black uppercase tracking-wide" style={{ color: "#C1272D" }}>Didn't match — not priced ({poResult.unmatched.length})</p>
                          <div className="mt-1 space-y-1 max-h-48 overflow-auto">{poResult.unmatched.map((u: any, i: number) => <p key={i} className="text-xs font-semibold">{u.partName} {u.sku ? `(${u.sku})` : ""} — {fmtMoney(u.unitCostCents)} • {u.vendor}{u.poNumber ? ` PO ${u.poNumber}` : ""} • <span style={{ color: "var(--dim)" }}>{u.reason}</span></p>)}</div>
                          <p className="text-xs mt-1.5" style={{ color: "var(--dim)" }}>Fix the code/name in the catalog (or add the part), then re-run the match — the price is saved on the PO line either way.</p>
                        </div>
                      ) : <p className="text-xs font-semibold mt-1" style={{ color: "var(--dim)" }}>Every priced line matched a material. Averages are live in the catalog and on the Board.</p>}
                    </>
                  )}
                </div>
              )}
            </section>

            <section>
              <h2 className="font-display font-black text-lg">Purchase orders ({data.stats.totalOrders})</h2>
              {data.orders.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No orders yet. Place your first one below — vendor, lines, and ETA — then track it from ordered → in transit → received.</p> : (
                <div className="mt-2 space-y-3">{data.orders.slice(0, orderLimit).map(o => (
                  <div key={o.id} className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-display font-bold text-base leading-tight">{o.vendor}</p><p className="text-xs" style={{ color: "var(--dim)" }}>{o.poNumber ? `PO ${o.poNumber} • ` : ""}Placed {fmtDate(o.created_at)}{o.eta ? ` • ETA ${o.eta}` : ""}</p></div>
                      <Badge color={statusColor(o.status)}>{o.status.replace("_", " ")}</Badge>
                    </div>
                    {o.notes && <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>{o.notes}</p>}
                    <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}><div className="h-full rounded-full" style={{ width: o.totalQty ? `${(o.receivedQty / o.totalQty) * 100}%` : "0%", background: "#137333" }} /></div>
                    <p className="text-xs font-bold mt-1">{o.receivedQty} of {o.totalQty} units received</p>
                    {o.lines.some(l => l.unitCostCents > 0) && <p className="text-xs font-bold mt-0.5">PO value {fmtMoney(o.lines.reduce((a, l) => a + l.qty * l.unitCostCents, 0))}{o.lines.some(l => !l.unitCostCents) ? <span className="font-semibold" style={{ color: "var(--dim)" }}> (some lines unpriced)</span> : ""} • priced lines feed each material's average cost</p>}
                    <div className="mt-2 space-y-1.5">
                      {o.lines.map(l => (
                        <div key={l.id} className="rounded-lg px-3 py-2" style={{ background: "var(--surface2)" }}>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold min-w-0 truncate">{l.partName} {l.sku && <span className="font-normal" style={{ color: "var(--dim)" }}>({l.sku})</span>}</p>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-bold">{l.receivedQty}/{l.qty}</span>
                              {l.receivedQty < l.qty && <button aria-label={`Receive one ${l.partName}`} onClick={() => receiveLine.mutate({ lineId: l.id, qty: 1 })} className="px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: "#137333" }}>Receive 1</button>}
                              {l.receivedQty < l.qty && <button aria-label={`Receive all remaining ${l.partName}`} onClick={() => receiveLine.mutate({ lineId: l.id, qty: l.qty - l.receivedQty })} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>All</button>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-1.5">
                            {l.partId ? <Badge color="#137333">✓ Matched to catalog</Badge> : <Badge color="#B45309">Not in catalog</Badge>}
                            {l.unitCostCents > 0 ? <span className="text-xs font-bold">{fmtMoney(l.unitCostCents)} ea • {fmtMoney(l.unitCostCents * l.qty)} line total</span> : <span className="text-xs font-semibold" style={{ color: "var(--dim)" }}>No price on this line</span>}
                            <LineCostEditor lineId={l.id} unitCostCents={l.unitCostCents} />
                          </div>
                        </div>
                      ))}
                      {o.lines.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No lines on this order.</p>}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {(["ordered", "in_transit", "partial", "received", "cancelled"] as const).map(s => o.status !== s && <button key={s} onClick={() => updateOrder.mutate({ id: o.id, status: s })} className="px-3 py-1.5 rounded-full text-xs font-bold capitalize" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>→ {s.replace("_", " ")}</button>)}
                      <button aria-label={`Delete order from ${o.vendor}`} onClick={() => { deleteOrder.mutate(o.id); }} className="px-3 py-1.5 rounded-full text-xs font-bold ml-auto" style={{ color: "#C1272D" }}>Delete</button>
                    </div>
                  </div>
                ))}
                {data.orders.length > orderLimit && <button onClick={() => setOrderLimit(n => n + 50)} className="w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>Show older orders ({data.orders.length - orderLimit} more loaded{data.stats.totalOrders > data.orders.length ? `, ${data.stats.totalOrders} total` : ""})</button>}
                </div>
              )}
            </section>

            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h3 className="font-display font-black">Place a new order</h3>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-xs font-bold col-span-2">Vendor<input aria-label="Vendor name" value={orderForm.vendor} onChange={e => setOrderForm(f => ({ ...f, vendor: e.target.value }))} placeholder="e.g. F.W. Webb, Ferguson, Brookaire" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">PO #<input aria-label="PO number" value={orderForm.poNumber} onChange={e => setOrderForm(f => ({ ...f, poNumber: e.target.value }))} placeholder="Optional" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">ETA<input aria-label="Order ETA" type="date" value={orderForm.eta} onChange={e => setOrderForm(f => ({ ...f, eta: e.target.value }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold col-span-2">Notes<input aria-label="Order notes" value={orderForm.notes} onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))} placeholder="Job, urgency, delivery notes…" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
              </div>
              <p className="text-xs font-bold mt-4 mb-1">Order lines</p>
              <div className="space-y-2">
                {orderForm.lines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <input aria-label={`Order line ${i + 1} part name`} value={l.partName} onChange={e => { const lines = [...orderForm.lines]; lines[i] = { ...lines[i]!, partName: e.target.value }; const match = data.parts.find(p => p.name.toLowerCase() === e.target.value.toLowerCase()); if (match) lines[i] = { ...lines[i]!, partId: match.id, sku: match.sku }; setOrderForm(f => ({ ...f, lines })); }} placeholder="Part name (pick from catalog or type new)" list="parts-list" className="flex-1 min-w-0 rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} />
                    <input aria-label={`Order line ${i + 1} quantity`} type="number" min={1} value={l.qty} onChange={e => { const lines = [...orderForm.lines]; lines[i] = { ...lines[i]!, qty: Number(e.target.value) }; setOrderForm(f => ({ ...f, lines })); }} className="w-20 rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} />
                    <input aria-label={`Order line ${i + 1} unit cost in dollars`} inputMode="decimal" value={l.unitCost} onChange={e => { const lines = [...orderForm.lines]; lines[i] = { ...lines[i]!, unitCost: e.target.value }; setOrderForm(f => ({ ...f, lines })); }} placeholder="$ ea" className="w-24 rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} />
                  </div>
                ))}
                <datalist id="parts-list">{sortedParts.map(p => <option key={p.id} value={p.name} />)}</datalist>
                <button onClick={() => setOrderForm(f => ({ ...f, lines: [...f.lines, { partName: "", sku: "", qty: 1, unitCost: "", partId: null }] }))} className="text-sm font-bold" style={{ color: NAVY }}>+ Add line</button>
                <p className="text-xs font-semibold" style={{ color: "var(--dim)" }}>Add a unit price on a line and it's matched to the material automatically — multiple prices on the same part are averaged.</p>
              </div>
              <button disabled={!orderForm.vendor.trim() || orderForm.lines.every(l => !l.partName.trim())} onClick={() => createOrder.mutate()} className="mt-3 w-full py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: NAVY }}>Place order</button>
            </section>
          </div>
        )}

        {tab === "verify" && (
          <div className="space-y-5">
            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h2 className="font-display font-black text-lg">📸 Intake verification — is it really at the shop?</h2>
              <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>Warehouse: take two photos — <strong>1) the PO / invoice / packing slip</strong> and <strong>2) the actual part in your hand</strong>. AI reads both, names what's on the paperwork vs. what's physically here, and flags a mismatch before it goes on the shelf.</p>

              <label className="text-xs font-bold block mt-4">Link to an open order (optional — fills in what's expected)
                <select aria-label="Order to verify against" value={intakeForm.orderId ?? ""} onChange={e => { const oid = e.target.value ? Number(e.target.value) : null; const o = data.orders.find(x => x.id === oid); setIntakeForm(f => ({ ...f, orderId: oid, vendor: o?.vendor ?? f.vendor, poNumber: o?.poNumber ?? f.poNumber, expectedParts: o ? o.lines.map(l => `${l.partName}${l.sku ? ` (${l.sku})` : ""} ×${l.qty}`).join("; ") : f.expectedParts })); }} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
                  <option value="">No linked order — verify photos only</option>
                  {data.orders.filter(o => o.status !== "cancelled").map(o => <option key={o.id} value={o.id}>{o.vendor}{o.poNumber ? ` • PO ${o.poNumber}` : ""} — {o.receivedQty}/{o.totalQty} received</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="text-xs font-bold">Checked by<input aria-label="Checked by" value={intakeForm.checkedBy} onChange={e => setIntakeForm(f => ({ ...f, checkedBy: e.target.value }))} placeholder="Your name" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">PO #<input aria-label="Intake PO number" value={intakeForm.poNumber} onChange={e => setIntakeForm(f => ({ ...f, poNumber: e.target.value }))} placeholder="Optional" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
              </div>
              {intakeForm.expectedParts && <p className="text-xs font-semibold mt-2 rounded-lg px-3 py-2" style={{ background: "var(--surface2)", color: "var(--dim)" }}>Expected: {intakeForm.expectedParts}</p>}

              <div className="grid grid-cols-2 gap-3 mt-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide">1 · PO / Invoice photo</p>
                  <input ref={invoicePhotoRef} type="file" accept="image/*" capture="environment" aria-label="Take photo of PO or invoice" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setPhotoBusy(true); try { setInvoicePhoto(await processPhoto(f)); } catch { setIntakeError("Couldn't read that invoice photo — try again."); } finally { setPhotoBusy(false); } }} />
                  {invoicePhoto ? (
                    <div className="mt-1.5 relative">
                      <img src={invoicePhoto.preview} alt="PO or invoice photo" className="w-full h-36 object-cover rounded-xl border" style={{ borderColor: "var(--border)" }} />
                      <button aria-label="Retake invoice photo" onClick={() => invoicePhotoRef.current?.click()} className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: NAVY }}>Retake</button>
                      <button aria-label="Remove invoice photo" onClick={() => setInvoicePhoto(null)} className="absolute top-2 right-2 w-7 h-7 rounded-full text-white text-xs font-black" style={{ background: "#C1272D" }}>✕</button>
                    </div>
                  ) : (
                    <button onClick={() => invoicePhotoRef.current?.click()} className="mt-1.5 w-full h-36 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 font-bold text-sm" style={{ borderColor: NAVY, color: NAVY, background: "var(--surface2)" }}><span className="text-3xl">🧾</span>Tap to photograph<br />the paperwork</button>
                  )}
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-wide">2 · Actual part photo</p>
                  <input ref={partPhotoRef} type="file" accept="image/*" capture="environment" aria-label="Take photo of actual part" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setPhotoBusy(true); try { setPartPhoto(await processPhoto(f)); } catch { setIntakeError("Couldn't read that part photo — try again."); } finally { setPhotoBusy(false); } }} />
                  {partPhoto ? (
                    <div className="mt-1.5 relative">
                      <img src={partPhoto.preview} alt="Actual part photo" className="w-full h-36 object-cover rounded-xl border" style={{ borderColor: "var(--border)" }} />
                      <button aria-label="Retake part photo" onClick={() => partPhotoRef.current?.click()} className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: NAVY }}>Retake</button>
                      <button aria-label="Remove part photo" onClick={() => setPartPhoto(null)} className="absolute top-2 right-2 w-7 h-7 rounded-full text-white text-xs font-black" style={{ background: "#C1272D" }}>✕</button>
                    </div>
                  ) : (
                    <button onClick={() => partPhotoRef.current?.click()} className="mt-1.5 w-full h-36 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 font-bold text-sm" style={{ borderColor: ORANGE, color: ORANGE, background: "var(--surface2)" }}><span className="text-3xl">📷</span>Tap to photograph<br />the part itself</button>
                  )}
                </div>
              </div>
              <p className="text-xs mt-2 font-semibold" style={{ color: "var(--dim)" }}>Tip: get the part's label / stamped model number in frame, and the invoice line items readable — that's what the AI compares.</p>
              {intakeError && <p className="mt-2 rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ background: "#C1272D" }}>{intakeError}</p>}
              <button disabled={(!invoicePhoto && !partPhoto) || verifyIntakeMut.isPending || photoBusy} onClick={() => verifyIntakeMut.mutate()} className="mt-3 w-full py-3.5 rounded-xl text-white font-black disabled:opacity-40" style={{ background: NAVY }}>{verifyIntakeMut.isPending ? "AI is comparing the photos…" : "🔍 Verify with AI — does the part match?"}</button>

              {intakeResult && (() => { const vs = verdictStyle(intakeResult.verdict); return (
                <div className="mt-4 rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                  <div className="px-4 py-3 text-white font-display font-black" style={{ background: vs.bg }}>{vs.label} <span className="font-body font-bold text-xs opacity-80">• {intakeResult.confidence} confidence</span></div>
                  <div className="px-4 py-3 space-y-2" style={{ background: "var(--surface2)" }}>
                    <p className="text-sm font-semibold">{intakeResult.summary}</p>
                    {intakeResult.invoiceParts && <p className="text-sm"><strong>On the paperwork:</strong> {intakeResult.invoiceParts}{intakeResult.invoiceVendor ? ` — ${intakeResult.invoiceVendor}` : ""}{intakeResult.invoicePoNumber ? ` • ${intakeResult.invoicePoNumber}` : ""}</p>}
                    {intakeResult.physicalPart && <p className="text-sm"><strong>In hand at the shop:</strong> {intakeResult.physicalPart}</p>}
                    {intakeResult.discrepancies && <p className="text-sm font-bold" style={{ color: "#C1272D" }}>Discrepancies: {intakeResult.discrepancies}</p>}
                    <p className="text-sm font-bold" style={{ color: NAVY }}>Next: {intakeResult.recommendedAction}</p>
                    {intakeResult.verdict === "match" && intakeForm.orderId && <button onClick={() => setTab("orders")} className="px-4 py-2 rounded-lg text-white text-sm font-bold" style={{ background: "#137333" }}>Now receive it in Orders →</button>}
                  </div>
                </div> ); })()}
            </section>

            <section>
              <h2 className="font-display font-black text-lg">Verification history ({data.intakeVerifications.length})</h2>
              {data.intakeVerifications.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No verifications yet. The first delivery you check with photos will be logged here — paperwork photo, part photo, and the AI verdict — so there's proof of what actually arrived.</p> : (
                <div className="mt-2 space-y-3">{data.intakeVerifications.map(v => { const vs = verdictStyle(v.verdict); return (
                  <div key={v.id} className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `5px solid ${vs.bg}` }}>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-display font-black" style={{ color: vs.bg }}>{vs.label}</p><p className="text-xs" style={{ color: "var(--dim)" }}>{fmtDate(v.created_at)}{v.checkedBy ? ` • Checked by ${v.checkedBy}` : ""}{(v.vendor || v.invoiceVendor) ? ` • ${v.vendor || v.invoiceVendor}` : ""}{(v.poNumber || v.invoicePoNumber) ? ` • PO ${v.poNumber || v.invoicePoNumber}` : ""}</p></div>
                      {v.confidence && <Badge>{v.confidence} conf.</Badge>}
                    </div>
                    <p className="text-sm font-semibold mt-1.5">{v.summary}</p>
                    {v.invoiceParts && <p className="text-sm mt-1"><strong>Paperwork:</strong> {v.invoiceParts}</p>}
                    {v.physicalPart && <p className="text-sm"><strong>In hand:</strong> {v.physicalPart}</p>}
                    {v.discrepancies && <p className="text-sm font-bold mt-1" style={{ color: "#C1272D" }}>Discrepancies: {v.discrepancies}</p>}
                    {v.recommendedAction && <p className="text-sm font-bold mt-1" style={{ color: NAVY }}>Next: {v.recommendedAction}</p>}
                    <div className="flex gap-2 mt-2">
                      {v.invoiceImageUrl && <img src={v.invoiceImageUrl} alt="Invoice photo for this verification" className="w-24 h-20 object-cover rounded-lg border" style={{ borderColor: "var(--border)" }} />}
                      {v.partImageUrl && <img src={v.partImageUrl} alt="Part photo for this verification" className="w-24 h-20 object-cover rounded-lg border" style={{ borderColor: "var(--border)" }} />}
                    </div>
                    <button aria-label={`Delete verification from ${fmtDate(v.created_at)}`} onClick={() => deleteIntake.mutate(v.id)} className="text-xs font-bold mt-2" style={{ color: "#C1272D" }}>Delete record</button>
                  </div> ); })}</div>
              )}
            </section>
          </div>
        )}

        {tab === "staging" && (
          <div className="space-y-5">
            <section>
              <h2 className="font-display font-black text-lg">Staging for scheduled jobs ({data.staging.length})</h2>
              <p className="text-sm" style={{ color: "var(--dim)" }}>Build the pick list per job, check parts off as you pull them, then load to the truck — stock moves from warehouse to van automatically.</p>
              {data.staging.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No staging jobs yet. Create one below when a job hits the schedule.</p> : (
                <div className="mt-3 space-y-3">{data.staging.map(s => {
                  const pulled = s.lines.filter(l => l.pulled).length;
                  const allPulled = s.lines.length > 0 && pulled === s.lines.length;
                  return <div key={s.id} className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-display font-bold leading-tight">{s.customer}</p><p className="text-xs" style={{ color: "var(--dim)" }}>{s.jobType} • {fmtJobDate(s.jobDate)}{s.truckName ? ` • → ${s.truckName}` : " • No truck assigned"}</p></div>
                      <Badge color={statusColor(s.status)}>{s.status}</Badge>
                    </div>
                    {s.notes && <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>{s.notes}</p>}
                    <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: "var(--surface2)" }}><div className="h-full" style={{ width: s.lines.length ? `${(pulled / s.lines.length) * 100}%` : "0%", background: ORANGE }} /></div>
                    <p className="text-xs font-bold mt-1">{pulled} of {s.lines.length} lines pulled</p>
                    <div className="mt-2 space-y-1.5">
                      {s.lines.map(l => {
                        const avail = l.partId ? data.stock.filter(st => st.partId === l.partId).reduce((a, st) => a + st.quantity, 0) : null;
                        return <label key={l.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer" style={{ background: l.pulled ? "#13733318" : "var(--surface2)" }}>
                          <input type="checkbox" aria-label={`Mark ${l.partName} pulled for ${s.customer}`} checked={l.pulled} onChange={e => toggleLine.mutate({ lineId: l.id, pulled: e.target.checked })} className="w-5 h-5 accent-[#052A78]" />
                          <span className={`text-sm font-semibold flex-1 ${l.pulled ? "line-through opacity-60" : ""}`}>{l.partName} ×{l.qty}</span>
                          {avail !== null && <span className="text-xs font-bold" style={{ color: avail >= l.qty ? "#137333" : "#C1272D" }}>{avail} on hand</span>}
                        </label>;
                      })}
                      {s.lines.length === 0 && <p className="text-sm" style={{ color: "var(--dim)" }}>No lines yet — recreate the job with lines, or track pulls on the next job.</p>}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {s.status === "needed" && <button onClick={() => updateStage.mutate({ id: s.id, status: "picking" })} className="px-3 py-2 rounded-lg text-white text-sm font-bold" style={{ background: NAVY }}>Start picking</button>}
                      {(s.status === "picking" || s.status === "needed") && <button disabled={!allPulled} onClick={() => updateStage.mutate({ id: s.id, status: "staged" })} className="px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-40" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Mark staged</button>}
                      {s.status !== "loaded" && s.status !== "done" && <button disabled={!s.truckLocationId} onClick={() => loadTruck.mutate(s.id)} className="px-3 py-2 rounded-lg text-white text-sm font-bold disabled:opacity-40" style={{ background: ORANGE }}>Load to truck →</button>}
                      {s.status === "loaded" && <button onClick={() => updateStage.mutate({ id: s.id, status: "done" })} className="px-3 py-2 rounded-lg text-white text-sm font-bold" style={{ background: "#137333" }}>Job done ✓</button>}
                      <button aria-label={`Delete staging job for ${s.customer}`} onClick={() => { deleteStage.mutate(s.id); }} className="px-3 py-2 rounded-lg text-sm font-bold ml-auto" style={{ color: "#C1272D" }}>Delete</button>
                    </div>
                    {!s.truckLocationId && s.status !== "done" && <p className="text-xs mt-1 font-semibold" style={{ color: "#B45309" }}>Assign a truck when creating the job to use Load to truck.</p>}
                  </div>;
                })}</div>
              )}
            </section>

            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h3 className="font-display font-black">Stage a new job</h3>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-xs font-bold col-span-2">Customer / Job<input aria-label="Staging customer" value={stageForm.customer} onChange={e => setStageForm(f => ({ ...f, customer: e.target.value }))} placeholder="e.g. Smith — water heater swap" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">Job type<select aria-label="Staging job type" value={stageForm.jobType} onChange={e => setStageForm(f => ({ ...f, jobType: e.target.value }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>{["Service", "Install — Plumbing", "Install — HVAC", "Water Heater", "Drain", "Maintenance", "Other"].map(t => <option key={t}>{t}</option>)}</select></label>
                <label className="text-xs font-bold">Job date<input aria-label="Staging job date" type="date" value={stageForm.jobDate} onChange={e => setStageForm(f => ({ ...f, jobDate: e.target.value }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold col-span-2">Assign truck<select aria-label="Staging truck" value={stageForm.truckLocationId ?? ""} onChange={e => setStageForm(f => ({ ...f, truckLocationId: e.target.value ? Number(e.target.value) : null }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}><option value="">No truck yet</option>{truckLocs.map(l => <option key={l.id} value={l.id}>{l.name}{l.assignedTo ? ` — ${l.assignedTo}` : ""}</option>)}</select></label>
                <label className="text-xs font-bold col-span-2">Notes<input aria-label="Staging notes" value={stageForm.notes} onChange={e => setStageForm(f => ({ ...f, notes: e.target.value }))} placeholder="Gate code, ServiceTitan job #, etc." className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
              </div>
              <p className="text-xs font-bold mt-4 mb-1">Parts to pull</p>
              <div className="space-y-2">
                {stageForm.lines.map((l, i) => (
                  <div key={i} className="flex gap-2">
                    <input aria-label={`Staging line ${i + 1} part name`} value={l.partName} onChange={e => { const lines = [...stageForm.lines]; lines[i] = { ...lines[i]!, partName: e.target.value }; const match = data.parts.find(p => p.name.toLowerCase() === e.target.value.toLowerCase()); if (match) lines[i] = { ...lines[i]!, partId: match.id }; setStageForm(f => ({ ...f, lines })); }} placeholder="Part name" list="parts-list" className="flex-1 min-w-0 rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} />
                    <input aria-label={`Staging line ${i + 1} quantity`} type="number" min={1} value={l.qty} onChange={e => { const lines = [...stageForm.lines]; lines[i] = { ...lines[i]!, qty: Number(e.target.value) }; setStageForm(f => ({ ...f, lines })); }} className="w-20 rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} />
                  </div>
                ))}
                <button onClick={() => setStageForm(f => ({ ...f, lines: [...f.lines, { partName: "", qty: 1, partId: null }] }))} className="text-sm font-bold" style={{ color: NAVY }}>+ Add part</button>
              </div>
              <button disabled={!stageForm.customer.trim()} onClick={() => createStage.mutate()} className="mt-3 w-full py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: NAVY }}>Create staging job</button>
            </section>
          </div>
        )}

        {tab === "requests" && (
          <div className="space-y-5">
            <section className="rounded-2xl p-4" style={{ background: NAVY }}>
              <h3 className="font-display font-black text-white text-lg">Tech ordering intake</h3>
              <p className="text-white/75 text-sm mt-0.5">Techs: name the exact part and piece you need — or let AI name it from a photo. Warehouse sees it instantly, orders it, and marks it ready for pickup.</p>

              {/* AI Photo ID */}
              <div className="mt-3 rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.1)", border: "1px dashed rgba(255,255,255,0.45)" }}>
                <p className="font-display font-black text-white">📸 AI Photo ID — snap it, AI names the part</p>
                <p className="text-white/75 text-xs font-semibold mt-0.5">Photo the furnace, boiler, or the bad part itself. Say what you need (“flame sensor for this furnace”) and AI identifies the exact part for the warehouse.</p>
                <input ref={techPhotoRef} type="file" accept="image/*" capture="environment" aria-label="Take photo of equipment or part to identify" className="hidden" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setPhotoBusy(true); setAiResult(null); setAiError(""); try { setTechPhoto(await processPhoto(f)); } catch { setAiError("Couldn't read that photo — try again."); } finally { setPhotoBusy(false); } }} />
                {techPhoto ? (
                  <div className="mt-2 relative">
                    <img src={techPhoto.preview} alt="Equipment or part photo to identify" className="w-full h-44 object-cover rounded-xl" />
                    <button aria-label="Retake identification photo" onClick={() => techPhotoRef.current?.click()} className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: NAVY }}>Retake</button>
                    <button aria-label="Remove identification photo" onClick={() => { setTechPhoto(null); setAiResult(null); }} className="absolute top-2 right-2 w-7 h-7 rounded-full text-white text-xs font-black" style={{ background: "#C1272D" }}>✕</button>
                  </div>
                ) : (
                  <button onClick={() => techPhotoRef.current?.click()} className="mt-2 w-full h-28 rounded-xl flex flex-col items-center justify-center gap-1 font-bold text-sm text-white" style={{ background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.3)" }}><span className="text-3xl">📷</span>Tap to photograph the furnace / part</button>
                )}
                <label className="text-xs font-bold text-white/80 block mt-2">What do you need from it?
                  <input aria-label="What part you need from the photo" value={techHint} onChange={e => setTechHint(e.target.value)} placeholder="e.g. I need a flame sensor for this furnace" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" />
                </label>
                {aiError && <p className="mt-2 rounded-lg px-3 py-2 text-sm font-bold text-white" style={{ background: "#C1272D" }}>{aiError}</p>}
                <button disabled={!techPhoto || analyzePhoto.isPending || photoBusy} onClick={() => analyzePhoto.mutate()} className="mt-2 w-full py-3 rounded-xl font-black text-white disabled:opacity-40" style={{ background: ORANGE }}>{analyzePhoto.isPending ? "AI is identifying the part…" : "🔍 Identify the part with AI"}</button>
                {aiResult && (
                  <div className="mt-2 rounded-xl p-3 text-black" style={{ background: "#FFF7ED" }}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-display font-black leading-tight">{aiResult.partName}</p>
                      <Badge color={aiResult.confidence === "high" ? "#137333" : aiResult.confidence === "medium" ? "#B45309" : "#C1272D"}>{aiResult.confidence} confidence</Badge>
                    </div>
                    <p className="text-sm font-semibold mt-0.5">{aiResult.partDescription}</p>
                    {(aiResult.equipmentType || aiResult.equipmentBrandModel) && <p className="text-xs font-bold mt-1" style={{ color: "var(--dim)" }}>Equipment: {[aiResult.equipmentType, aiResult.equipmentBrandModel].filter(Boolean).join(" — ")}</p>}
                    <p className="text-xs mt-1" style={{ color: "var(--dim)" }}>{aiResult.reasoning}{aiResult.suggestedQtyNote ? ` ${aiResult.suggestedQtyNote}` : ""}</p>
                    {aiResult.alternatives.length > 0 && <div className="mt-2"><p className="text-xs font-bold" style={{ color: "var(--dim)" }}>Could also be — tap to use instead:</p><div className="flex flex-wrap gap-1.5 mt-1">{aiResult.alternatives.map(a => <button key={a} onClick={() => setReqForm(f => ({ ...f, partDescription: a }))} className="px-2.5 py-1.5 rounded-full text-xs font-bold bg-white" style={{ border: "1px solid var(--border)" }}>{a}</button>)}</div></div>}
                    <p className="text-xs font-bold mt-2" style={{ color: "#137333" }}>✓ Filled in below — the photo + AI ID attach to your request so the warehouse sees exactly what you saw.</p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-xs font-bold text-white/80">Your name<input aria-label="Tech name" value={reqForm.techName} onChange={e => setReqForm(f => ({ ...f, techName: e.target.value }))} placeholder="e.g. Mike R." className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" /></label>
                <label className="text-xs font-bold text-white/80">Qty<input aria-label="Request quantity" type="number" min={1} value={reqForm.qty} onChange={e => setReqForm(f => ({ ...f, qty: Number(e.target.value) }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" /></label>
                <label className="text-xs font-bold text-white/80 col-span-2">Part / piece needed<input aria-label="Part description" value={reqForm.partDescription} onChange={e => setReqForm(f => ({ ...f, partDescription: e.target.value }))} placeholder="Be specific — brand, size, model. e.g. Moen 1225 cartridge" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" /></label>
                <label className="text-xs font-bold text-white/80">Urgency<select aria-label="Request urgency" value={reqForm.urgency} onChange={e => setReqForm(f => ({ ...f, urgency: e.target.value as any }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white"><option value="low">Low — stock up</option><option value="normal">Normal</option><option value="urgent">Urgent — job waiting</option><option value="emergency">Emergency — customer down</option></select></label>
                <label className="text-xs font-bold text-white/80">Job / customer<input aria-label="Request job reference" value={reqForm.jobRef} onChange={e => setReqForm(f => ({ ...f, jobRef: e.target.value }))} placeholder="Optional" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" /></label>
                <label className="text-xs font-bold text-white/80 col-span-2">Notes<input aria-label="Request notes" value={reqForm.notes} onChange={e => setReqForm(f => ({ ...f, notes: e.target.value }))} placeholder="Truck it's for, deadline, photo details…" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" /></label>
              </div>
              <button disabled={!reqForm.techName.trim() || !reqForm.partDescription.trim()} onClick={() => createReq.mutate()} className="mt-3 w-full py-3 rounded-xl font-black text-white disabled:opacity-40" style={{ background: ORANGE }}>Submit request</button>
            </section>

            <section>
              <h2 className="font-display font-black text-lg">Requests ({data.techRequests.length})</h2>
              {data.techRequests.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No requests yet. The first tech request will land here with status tracking: New → Ordered → Ready → Picked up.</p> : (
                <div className="mt-2 space-y-2">{data.techRequests.map(r => (
                  <div key={r.id} className="rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: (r.urgency === "urgent" || r.urgency === "emergency") && r.status === "new" ? "4px solid #C1272D" : "4px solid transparent" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="font-bold leading-tight">{r.partDescription} <span style={{ color: "var(--dim)" }}>×{r.qty}</span></p><p className="text-xs" style={{ color: "var(--dim)" }}>{r.techName}{r.jobRef ? ` • ${r.jobRef}` : ""} • {fmtDate(r.created_at)}{r.notes ? ` • ${r.notes}` : ""}</p>
                      {r.aiPartName && <p className="text-xs font-bold mt-1" style={{ color: NAVY }}>🤖 AI ID: {r.aiPartName}{r.aiConfidence ? ` • ${r.aiConfidence} confidence` : ""}{r.aiEquipment ? ` • ${r.aiEquipment}` : ""}</p>}
                      {r.aiNotes && <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>{r.aiNotes}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0"><Badge color={statusColor(r.status)}>{r.status.replace("_", " ")}</Badge><Badge color={r.urgency === "urgent" || r.urgency === "emergency" ? "#C1272D" : undefined}>{r.urgency}</Badge></div>
                    </div>
                    {r.imageUrl && <img src={r.imageUrl} alt={`Photo attached to request for ${r.partDescription}`} className="mt-2 w-full h-40 object-cover rounded-lg border" style={{ borderColor: "var(--border)" }} />}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {r.status === "new" && <><button onClick={() => updateReq.mutate({ id: r.id, status: "ordered" })} className="px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: NAVY }}>Mark ordered</button><button onClick={() => { setOrderForm(f => ({ ...f, lines: [{ partName: r.partDescription, sku: "", qty: r.qty, unitCost: "", partId: null }] })); setTab("orders"); }} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Create PO from this →</button></>}
                      {r.status === "ordered" && <button onClick={() => updateReq.mutate({ id: r.id, status: "ready" })} className="px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: "#137333" }}>Mark ready for pickup</button>}
                      {r.status === "ready" && <button onClick={() => updateReq.mutate({ id: r.id, status: "picked_up" })} className="px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: "#137333" }}>Picked up ✓</button>}
                      {r.status !== "cancelled" && r.status !== "picked_up" && <button onClick={() => updateReq.mutate({ id: r.id, status: "cancelled" })} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "var(--surface2)" }}>Cancel</button>}
                      <button aria-label={`Delete request ${r.partDescription}`} onClick={() => { deleteReq.mutate(r.id); }} className="px-3 py-1.5 rounded-lg text-xs font-bold ml-auto" style={{ color: "#C1272D" }}>Delete</button>
                    </div>
                  </div>
                ))}</div>
              )}
            </section>
          </div>
        )}

        {tab === "equipment" && (
          <div className="space-y-5">
            {/* Summary */}
            <section>
              <h2 className="font-display font-black text-lg">🧰 Equipment by van — where is everything?</h2>
              <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>Every tool, recovery machine, vacuum pump and specialty item is one tracked asset with a home van. Check it out, move it, or send it for repair — the log shows who had it last and when.</p>
              <div className="grid grid-cols-4 gap-2 mt-3">
                <div className="rounded-xl p-3 text-center" style={{ background: NAVY, color: "#fff" }}><p className="font-display font-black text-2xl leading-none">{data.stats.totalEquipment}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1 text-white/70">Tracked</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-2xl leading-none" style={{ color: "#137333" }}>{data.stats.equipmentAvailable}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Available</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-2xl leading-none" style={{ color: NAVY }}>{data.stats.equipmentInUse}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>In use</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-2xl leading-none" style={{ color: data.stats.equipmentNeedsRepair + data.stats.equipmentMissing > 0 ? "#C1272D" : "var(--text)" }}>{data.stats.equipmentNeedsRepair + data.stats.equipmentMissing}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Repair / Missing</p></div>
              </div>
            </section>

            {/* By van / location — one dropdown instead of a card per van */}
            <section>
              <h3 className="font-display font-black">Equipment by van</h3>
              {data.locations.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>Add your warehouse and vans in Stock first — equipment is assigned to those same locations.</p> : (
                <>
                  <div className="mt-2">
                    <LocationDropdown ariaLabel="Filter equipment by van or location" locations={data.locations} value={equipLocFilter === "all" ? "all" : String(equipLocFilter)} onChange={raw => setEquipLocFilter(raw === "all" || raw === "" ? "all" : Number(raw))} includeAll allLabel={`All locations — ${data.equipment.length} items`} placeholder="Choose a van…" />
                  </div>
                  {equipLocFilter !== "all" && (() => { const l = data.locations.find(x => x.id === equipLocFilter); if (!l) return null; const items = data.equipment.filter(e => e.currentLocationId === l.id); const issues = items.filter(e => e.status === "needs_repair" || e.status === "out_of_service" || e.status === "missing").length; return <p className="text-sm font-semibold mt-2" style={{ color: "var(--dim)" }}>{items.length} item{items.length === 1 ? "" : "s"} on this {l.kind === "warehouse" ? "location" : "van"}{issues > 0 ? <> • <span style={{ color: "#C1272D" }}>⚠ {issues} need{issues === 1 ? "s" : ""} attention</span></> : ""}</p>; })()}
                  {data.equipment.filter(e => !e.currentLocationId).length > 0 && <p className="text-xs font-semibold mt-2" style={{ color: "var(--dim)" }}>{data.equipment.filter(e => !e.currentLocationId).length} unassigned items — assign them to a van from their row below.</p>}
                </>
              )}
            </section>

            {/* Search + status filters */}
            <div className="flex flex-col gap-2">
              <input aria-label="Search equipment" value={equipSearch} onChange={e => setEquipSearch(e.target.value)} placeholder="Search tool, serial #, asset tag, van, tech, or consignment owner…" className="w-full rounded-xl px-4 py-3 font-semibold outline-none" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
              <div className="flex gap-2 flex-wrap">
                {[{ v: "all", label: "All statuses" }, { v: "available", label: "Available" }, { v: "in_use", label: "In use" }, { v: "needs_repair", label: "Needs repair" }, { v: "out_of_service", label: "Out of service" }, { v: "missing", label: "Missing" }, { v: "installed", label: "Installed at customer" }].map(f => (
                  <button key={f.v} onClick={() => setEquipStatusFilter(f.v)} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: equipStatusFilter === f.v ? NAVY : "var(--surface)", color: equipStatusFilter === f.v ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>{f.label}</button>
                ))}
                {equipLocFilter !== "all" && <button onClick={() => setEquipLocFilter("all")} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: ORANGE, color: "#fff" }}>Clear van filter ✕</button>}
              </div>
              <div className="flex gap-2 flex-wrap items-center" role="group" aria-label="Consignment filter">
                <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--dim)" }}>Ownership:</span>
                {([["all", "All equipment"], ["consigned", `🤝 Consigned only (${data.stats.totalConsigned})`], ["owned", "Blue Bear owned"]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setEquipConsignFilter(v)} aria-pressed={equipConsignFilter === v} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: equipConsignFilter === v ? (v === "consigned" ? ORANGE : NAVY) : "var(--surface)", color: equipConsignFilter === v ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>{label}</button>
                ))}
                <button onClick={() => setTab("consignment")} className="px-3 py-2 rounded-full text-sm font-bold ml-auto" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Open consignment log →</button>
              </div>
            </div>

            {/* Equipment list */}
            <section>
              <div className="flex items-center justify-between"><h3 className="font-display font-black text-lg">Equipment ({filteredEquipment.length})</h3>{historyEquipId && <button onClick={() => setHistoryEquipId(null)} className="text-sm font-bold" style={{ color: NAVY }}>Show all history</button>}</div>
              {filteredEquipment.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>{data.equipment.length === 0 ? "No equipment yet. Add your first recovery machine, vacuum pump, or specialty tool below — give it an asset tag so techs can spot it on the van." : "No equipment matches those filters."}</p> : (
                <div className="mt-2 space-y-2">{visibleEquipment.map(e => {
                  const lastLog = data.equipmentLogs.find(l => l.equipmentId === e.id);
                  const isAlert = e.status === "needs_repair" || e.status === "out_of_service" || e.status === "missing";
                  const isConsigned = (e as any).isConsigned as boolean;
                  const editingConsign = consignEditId === e.id;
                  return <div key={e.id} className="rounded-2xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: isConsigned ? `4px solid ${ORANGE}` : isAlert ? "4px solid #C1272D" : e.status === "in_use" ? "4px solid #052A78" : "4px solid #137333" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold leading-tight">{e.name} {e.assetTag && <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--surface2)", color: "var(--dim)" }}>{e.assetTag}</span>} {isConsigned && <span className="text-[11px] font-black px-1.5 py-0.5 rounded-full text-white align-middle" style={{ background: ORANGE }}>🤝 CONSIGNED</span>}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>{e.category}{e.brandModel ? ` • ${e.brandModel}` : ""}{e.serialNumber ? ` • S/N ${e.serialNumber}` : ""}</p>
                        <p className="text-sm font-bold mt-1">📍 {e.currentLocationName}{e.assignedTo ? <span className="font-semibold" style={{ color: "var(--dim)" }}> — {e.assignedTo}</span> : ""}</p>
                        {isConsigned && <p className="text-xs font-bold mt-1 rounded-lg px-2 py-1.5" style={{ background: "#FF670018", color: "var(--text)" }}>Owner: {(e as any).consignmentOwner || "— not set"}{(e as any).consignmentValueCents > 0 ? ` • Value ${fmtMoney((e as any).consignmentValueCents)}` : ""}<br /><span className="font-semibold" style={{ color: "var(--dim)" }}>{(e as any).consignmentEmail ? `✉ Moves queue an email to ${(e as any).consignmentEmail}` : "⚠ No notify email — moves log but don't queue an email"}{(e as any).consignmentNotes ? ` • ${(e as any).consignmentNotes}` : ""}</span></p>}
                        {e.notes && <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>{e.notes}</p>}
                        {lastLog && <p className="text-[11px] mt-1 font-semibold" style={{ color: "var(--dim)" }}>Last: {equipActionLabel(lastLog.action)}{lastLog.toLocationName ? ` → ${lastLog.toLocationName}` : ""}{lastLog.performedBy ? ` by ${lastLog.performedBy}` : ""} • {fmtDate(lastLog.created_at)}</p>}
                      </div>
                      <Badge color={statusColor(e.status)}>{equipStatusLabel(e.status)}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      <button onClick={() => { setMoveForm(f => ({ ...f, equipmentId: e.id, toLocationId: e.currentLocationId, action: "transfer" })); document.getElementById("equip-move-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} className="px-3 py-1.5 rounded-lg text-white text-xs font-bold" style={{ background: NAVY }}>Move / Check out →</button>
                      <button onClick={() => { if (editingConsign) { setConsignEditId(null); } else { setConsignEditId(e.id); setConsignEditForm({ isConsigned, consignmentOwner: (e as any).consignmentOwner ?? "", consignmentEmail: (e as any).consignmentEmail ?? "", consignmentValue: (e as any).consignmentValueCents ? ((e as any).consignmentValueCents / 100).toFixed(2) : "", consignmentNotes: (e as any).consignmentNotes ?? "", performedBy: "" }); } }} aria-expanded={editingConsign} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: editingConsign ? "#5B6B82" : ORANGE }}>{editingConsign ? "Close consignment" : isConsigned ? "🤝 Consignment ✓" : "🤝 Mark consigned"}</button>
                      <button onClick={() => setHistoryEquipId(historyEquipId === e.id ? null : e.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: historyEquipId === e.id ? ORANGE : "var(--surface2)", color: historyEquipId === e.id ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>{historyEquipId === e.id ? "Hide history" : "History"}</button>
                      {e.status !== "available" && <button onClick={() => updateEquipStatus.mutate({ id: e.id, status: "available" })} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white" style={{ background: "#137333" }}>Mark available</button>}
                      {e.status !== "needs_repair" && <button onClick={() => updateEquipStatus.mutate({ id: e.id, status: "needs_repair" })} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "#C1272D" }}>Needs repair</button>}
                      {e.status !== "missing" && <button onClick={() => updateEquipStatus.mutate({ id: e.id, status: "missing" })} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Missing</button>}
                      <button aria-label={`Delete equipment ${e.name}`} onClick={() => deleteEquip.mutate(e.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold ml-auto" style={{ color: "#C1272D" }}>Delete</button>
                    </div>
                    {editingConsign && (
                      <div className="mt-3 rounded-xl p-3" style={{ background: "var(--surface2)", border: `1.5px solid ${ORANGE}` }}>
                        <p className="font-display font-black text-sm">Consignment for {e.name}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>Set once. While consigned, every move of this piece writes to the Consignment Log and queues an email to the owner. Parts and stock are never consigned — equipment only.</p>
                        <label className="flex items-center gap-2.5 mt-2.5 cursor-pointer"><input type="checkbox" aria-label={`Consigned toggle for ${e.name}`} checked={consignEditForm.isConsigned} onChange={ev => setConsignEditForm(f => ({ ...f, isConsigned: ev.target.checked }))} className="h-6 w-6 accent-[#FF6700]" /><span className="text-sm font-black">This piece is consigned (vendor-owned)</span></label>
                        {consignEditForm.isConsigned && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <label className="text-xs font-bold col-span-2 sm:col-span-1">Owner / vendor<input aria-label={`Consignment owner for ${e.name}`} value={consignEditForm.consignmentOwner} onChange={ev => setConsignEditForm(f => ({ ...f, consignmentOwner: ev.target.value }))} placeholder="e.g. F.W. Webb, Johnstone Supply" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                            <label className="text-xs font-bold col-span-2 sm:col-span-1">Notify email<input aria-label={`Consignment notify email for ${e.name}`} type="email" value={consignEditForm.consignmentEmail} onChange={ev => setConsignEditForm(f => ({ ...f, consignmentEmail: ev.target.value }))} placeholder="owner@example.com" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                            <label className="text-xs font-bold">Value on hand ($)<input aria-label={`Consignment value for ${e.name}`} inputMode="decimal" value={consignEditForm.consignmentValue} onChange={ev => setConsignEditForm(f => ({ ...f, consignmentValue: ev.target.value }))} placeholder="0.00 — optional" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                            <label className="text-xs font-bold">Your name (for the log)<input aria-label="Your name for consignment log" value={consignEditForm.performedBy} onChange={ev => setConsignEditForm(f => ({ ...f, performedBy: ev.target.value }))} placeholder="Optional" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                            <label className="text-xs font-bold col-span-2">Consignment notes<input aria-label={`Consignment notes for ${e.name}`} value={consignEditForm.consignmentNotes} onChange={ev => setConsignEditForm(f => ({ ...f, consignmentNotes: ev.target.value }))} placeholder="Terms, return-by, agreement #…" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                            {!consignEditForm.consignmentEmail.trim() && <p className="col-span-2 text-xs font-bold" style={{ color: "#B45309" }}>⚠ No email yet — moves will be logged, but no owner email will be queued until an address is saved here.</p>}
                          </div>
                        )}
                        <div className="flex gap-2 mt-3">
                          <button disabled={setConsignment.isPending || (consignEditForm.isConsigned && !consignEditForm.consignmentOwner.trim())} onClick={() => setConsignment.mutate({ equipmentId: e.id, isConsigned: consignEditForm.isConsigned, consignmentOwner: consignEditForm.consignmentOwner, consignmentEmail: consignEditForm.consignmentEmail, consignmentValueCents: moneyToCents(consignEditForm.consignmentValue), consignmentNotes: consignEditForm.consignmentNotes, performedBy: consignEditForm.performedBy })} className="flex-1 py-2.5 rounded-xl text-white font-black text-sm disabled:opacity-40" style={{ background: NAVY }}>{setConsignment.isPending ? "Saving…" : "Save consignment"}</button>
                          <button onClick={() => setConsignEditId(null)} className="px-4 py-2.5 rounded-xl text-sm font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>;
                })}</div>
              )}
              {filteredEquipment.length > equipLimit && <button onClick={() => setEquipLimit(v => v + 50)} className="mt-3 w-full py-3 rounded-xl text-sm font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>Show next 50 — {filteredEquipment.length - equipLimit} more pieces of equipment</button>}
            </section>

            {/* Move / checkout */}
            <section id="equip-move-form" className="rounded-2xl p-4 scroll-mt-24" style={{ background: NAVY }}>
              <h3 className="font-display font-black text-white">Move / check out equipment</h3>
              <p className="text-white/75 text-xs font-semibold mt-0.5">This is the log. Every checkout, return, van-to-van move, and repair trip is recorded with who did it — so you can answer “where is it?” in seconds. If the piece is consigned, the same move also lands in the Consignment Log and queues an email to its owner automatically.</p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-xs font-bold text-white/80 col-span-2">Equipment
                  <select aria-label="Equipment to move" value={moveForm.equipmentId} onChange={e => { const id = Number(e.target.value); const eq = data.equipment.find(x => x.id === id); setMoveForm(f => ({ ...f, equipmentId: id, toLocationId: eq?.currentLocationId ?? null, assignedTo: eq?.assignedTo ?? "" })); }} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white"><option value={0}>Choose equipment…</option>{data.equipment.map(e => <option key={e.id} value={e.id}>{e.name}{e.assetTag ? ` (${e.assetTag})` : ""}{(e as any).isConsigned ? " 🤝 CONSIGNED" : ""} — currently {e.currentLocationName}</option>)}</select>
                </label>
                <label className="text-xs font-bold text-white/80">Action
                  <select aria-label="Equipment movement action" value={moveForm.action} onChange={e => setMoveForm(f => ({ ...f, action: e.target.value as any }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white"><option value="checkout">Check out to van / job</option><option value="checkin">Check in / return</option><option value="transfer">Transfer van ↔ warehouse</option><option value="repair_out">Send out for repair</option><option value="repair_in">Return from repair</option><option value="note">Log a note only</option></select>
                </label>
                <label className="text-xs font-bold text-white/80">Move to location
                  <select aria-label="Move equipment to location" value={moveForm.toLocationId ?? ""} onChange={e => setMoveForm(f => ({ ...f, toLocationId: e.target.value ? Number(e.target.value) : null }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white"><option value="">Stay at current location</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.kind === "warehouse" ? "🏭 " : "🚐 "}{l.name}</option>)}</select>
                </label>
                <label className="text-xs font-bold text-white/80">Who is moving it / taking it?
                  <input aria-label="Person moving equipment" value={moveForm.performedBy} onChange={e => setMoveForm(f => ({ ...f, performedBy: e.target.value }))} placeholder="e.g. Mike R." className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" />
                </label>
                <label className="text-xs font-bold text-white/80">Assign to (tech name)
                  <input aria-label="Assign equipment to tech" value={moveForm.assignedTo} onChange={e => setMoveForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="Leave blank to keep current" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" />
                </label>
                <label className="text-xs font-bold text-white/80">Job / customer — a ServiceTitan job # here puts a note on that job
                  <input aria-label="Job or customer for this move" value={moveForm.jobRef} onChange={e => setMoveForm(f => ({ ...f, jobRef: e.target.value }))} placeholder="e.g. Smith — AC swap, ST #12345" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" />
                  {/\d{4,}/.test(moveForm.jobRef) && ["checkout", "checkin", "transfer", "repair_out", "repair_in"].includes(moveForm.action) && <p className="text-[11px] font-bold mt-1 text-white/85">📝 A note will be posted on ServiceTitan job #{moveForm.jobRef.match(/\d{4,}/)?.[0]}</p>}
                </label>
                <label className="text-xs font-bold text-white/80">Notes — reason for the move
                  <input aria-label="Equipment movement notes" value={moveForm.notes} onChange={e => setMoveForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Recovery for AC swap, due back Friday" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold text-black bg-white" />
                </label>
              </div>
              {moveForm.equipmentId > 0 && (() => { const eq = data.equipment.find(x => x.id === moveForm.equipmentId); if (!eq) return null; const consigned = (eq as any).isConsigned as boolean; return (
                <div className="mt-2 space-y-1.5">
                  <p className="text-white/80 text-xs font-bold">Currently: {eq.name} is at {eq.currentLocationName} • {equipStatusLabel(eq.status)}{eq.assignedTo ? ` • ${eq.assignedTo}` : ""}</p>
                  {consigned && moveForm.action !== "note" && <p className="text-xs font-black rounded-lg px-3 py-2 text-white" style={{ background: ORANGE }}>🤝 Consigned — this move will queue an email to {(eq as any).consignmentOwner || "the owner"}{(eq as any).consignmentEmail ? ` at ${(eq as any).consignmentEmail}` : " (⚠ no email on file — it will log but not queue an email)"} for the external dispatcher</p>}
                  {consigned && moveForm.action === "note" && <p className="text-white/85 text-xs font-bold rounded-lg px-3 py-2" style={{ background: "rgba(255,255,255,0.14)" }}>🤝 Consigned, but a note-only entry isn't a move — it won't queue an owner email. Pick checkout / check-in / transfer for a move.</p>}
                </div> ); })()}
              <button disabled={!moveForm.equipmentId} onClick={() => moveEquip.mutate()} className="mt-3 w-full py-3 rounded-xl font-black text-white disabled:opacity-40" style={{ background: ORANGE }}>{moveEquip.isPending ? "Logging…" : "Log this move ✓"}</button>
              {moveEquip.data && !moveEquip.data.ok && <p className="mt-2 text-sm font-bold text-white rounded-lg px-3 py-2" style={{ background: "#C1272D" }}>{moveEquip.data.message}</p>}
            </section>

            {/* Add equipment */}
            <section className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h3 className="font-display font-black">Add equipment to track</h3>
              <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>One row per physical item — not a quantity. Two identical recovery machines = two rows, each with its own serial / asset tag and van.</p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="text-xs font-bold col-span-2">Equipment name<input aria-label="Equipment name" value={equipForm.name} onChange={e => setEquipForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Recovery Machine #2, ProPress, Drain Camera" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">Type / category<select aria-label="Equipment category" value={equipForm.category} onChange={e => setEquipForm(f => ({ ...f, category: e.target.value }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>{EQUIP_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
                <label className="text-xs font-bold">Brand / model<input aria-label="Equipment brand and model" value={equipForm.brandModel} onChange={e => setEquipForm(f => ({ ...f, brandModel: e.target.value }))} placeholder="e.g. Appion G5 Twin" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">Serial #<input aria-label="Equipment serial number" value={equipForm.serialNumber} onChange={e => setEquipForm(f => ({ ...f, serialNumber: e.target.value }))} placeholder="From the plate" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">Asset tag<input aria-label="Equipment asset tag" value={equipForm.assetTag} onChange={e => setEquipForm(f => ({ ...f, assetTag: e.target.value }))} placeholder="e.g. BB-EQ-014" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold col-span-2">Starts at location<select aria-label="Equipment starting location" value={equipForm.currentLocationId ?? ""} onChange={e => setEquipForm(f => ({ ...f, currentLocationId: e.target.value ? Number(e.target.value) : null }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}><option value="">Unassigned — pick later</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.kind === "warehouse" ? "🏭 " : "🚐 "}{l.name}{l.assignedTo ? ` — ${l.assignedTo}` : ""}</option>)}</select></label>
                <label className="text-xs font-bold">Assigned to<input aria-label="Equipment assigned to" value={equipForm.assignedTo} onChange={e => setEquipForm(f => ({ ...f, assignedTo: e.target.value }))} placeholder="Tech name" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold">Status<select aria-label="Equipment status" value={equipForm.status} onChange={e => setEquipForm(f => ({ ...f, status: e.target.value as any }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}><option value="available">Available</option><option value="in_use">In use</option><option value="needs_repair">Needs repair</option><option value="out_of_service">Out of service</option><option value="missing">Missing</option></select></label>
                <label className="text-xs font-bold">Condition<select aria-label="Equipment condition" value={equipForm.condition} onChange={e => setEquipForm(f => ({ ...f, condition: e.target.value }))} className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}><option value="good">Good</option><option value="fair">Fair — watch it</option><option value="poor">Poor</option><option value="new">Like new</option></select></label>
                <label className="text-xs font-bold">Added by<input aria-label="Equipment added by" value={equipForm.performedBy} onChange={e => setEquipForm(f => ({ ...f, performedBy: e.target.value }))} placeholder="Your name" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
                <label className="text-xs font-bold col-span-2">Notes<input aria-label="Equipment notes" value={equipForm.notes} onChange={e => setEquipForm(f => ({ ...f, notes: e.target.value }))} placeholder="Hoses included, calibration due, case color…" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} /></label>
              </div>
              {/* Consignment — set at add time or later from the equipment row */}
              <div className="mt-3 rounded-xl p-3" style={{ background: "var(--surface2)", border: equipForm.isConsigned ? `1.5px solid ${ORANGE}` : "1px solid var(--border)" }}>
                <label className="flex items-center gap-2.5 cursor-pointer"><input type="checkbox" aria-label="New equipment is consigned" checked={equipForm.isConsigned} onChange={e => setEquipForm(f => ({ ...f, isConsigned: e.target.checked }))} className="h-6 w-6 accent-[#FF6700]" /><span className="text-sm font-black">🤝 This piece is consigned (vendor-owned equipment)</span></label>
                <p className="text-xs mt-1" style={{ color: "var(--dim)" }}>Consignment is equipment-only. While it's on, every move is written to the Consignment Log and the owner is emailed.</p>
                {equipForm.isConsigned && (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <label className="text-xs font-bold col-span-2 sm:col-span-1">Owner / vendor<input aria-label="New equipment consignment owner" value={equipForm.consignmentOwner} onChange={e => setEquipForm(f => ({ ...f, consignmentOwner: e.target.value }))} placeholder="e.g. F.W. Webb" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                    <label className="text-xs font-bold col-span-2 sm:col-span-1">Notify email<input aria-label="New equipment consignment email" type="email" value={equipForm.consignmentEmail} onChange={e => setEquipForm(f => ({ ...f, consignmentEmail: e.target.value }))} placeholder="owner@example.com" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                    <label className="text-xs font-bold">Value ($, optional)<input aria-label="New equipment consignment value" inputMode="decimal" value={equipForm.consignmentValue} onChange={e => setEquipForm(f => ({ ...f, consignmentValue: e.target.value }))} placeholder="0.00" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                    <label className="text-xs font-bold">Consignment notes<input aria-label="New equipment consignment notes" value={equipForm.consignmentNotes} onChange={e => setEquipForm(f => ({ ...f, consignmentNotes: e.target.value }))} placeholder="Terms, agreement #…" className="mt-1 w-full rounded-lg px-3 py-2.5 font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} /></label>
                  </div>
                )}
              </div>
              <button disabled={!equipForm.name.trim() || (equipForm.isConsigned && !equipForm.consignmentOwner.trim())} onClick={() => createEquip.mutate()} className="mt-3 w-full py-3 rounded-xl text-white font-bold disabled:opacity-40" style={{ background: NAVY }}>Add equipment</button>
              {data.locations.length === 0 && <p className="text-xs mt-2 font-semibold" style={{ color: "#B45309" }}>No vans/warehouse yet — add locations in Stock first, or add equipment as Unassigned and assign it later.</p>}
            </section>

            {/* Movement log */}
            <section>
              <div className="flex items-center justify-between"><h3 className="font-display font-black text-lg">Movement log {historyEquipId ? `— ${data.equipment.find(e => e.id === historyEquipId)?.name ?? ""}` : `(${data.equipmentLogs.length})`}</h3>{historyEquipId && <button onClick={() => setHistoryEquipId(null)} className="text-sm font-bold" style={{ color: NAVY }}>Clear filter</button>}</div>
              <p className="text-sm" style={{ color: "var(--dim)" }}>Every checkout, return, transfer and repair trip — newest first. This is your proof of where a piece was and who moved it.</p>
              {filteredEquipLogs.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>No movements logged yet. The first time you add or move a piece of equipment, it will show up here.</p> : (
                <div className="mt-2 space-y-1.5">{filteredEquipLogs.slice(0, showAllLogs ? 60 : 10).map(l => (
                  <div key={l.id} className="rounded-xl px-3 py-2.5 flex items-start gap-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <span className="text-lg leading-none mt-0.5">{l.action === "created" ? "➕" : l.action === "checkout" ? "📤" : l.action === "checkin" ? "📥" : l.action === "repair_out" || l.action === "repair_in" ? "🔧" : "🔀"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-tight">{l.equipmentName} {(l as any).equipmentRemoved && <span className="text-[11px] font-black px-1.5 py-0.5 rounded-full text-white align-middle" style={{ background: "#5B6B82" }}>REMOVED PIECE</span>} <span className="font-semibold" style={{ color: "var(--dim)" }}>— {equipActionLabel(l.action)}</span></p>
                      <p className="text-xs" style={{ color: "var(--dim)" }}>{l.fromLocationName && l.toLocationName && l.fromLocationName !== l.toLocationName ? `${l.fromLocationName} → ${l.toLocationName}` : l.toLocationName ? `At ${l.toLocationName}` : l.fromLocationName ? `From ${l.fromLocationName}` : "No location change"}{l.performedBy ? ` • by ${l.performedBy}` : ""} • {new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
                      {l.notes && <p className="text-xs mt-0.5">{l.notes}</p>}
                    </div>
                  </div>
                ))}</div>
              )}
              {filteredEquipLogs.length > 10 && <button onClick={() => setShowAllLogs(v => !v)} aria-expanded={showAllLogs} className="mt-2 w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>{showAllLogs ? "Show only the 10 most recent" : `Show older movements (${Math.min(filteredEquipLogs.length, 60) - 10} more)`}</button>}
            </section>
          </div>
        )}

        {tab === "consignment" && (
          <div className="space-y-5">
            <WaterHeaters data={data} onChanged={inv} toast={setToast} />
            <section>
              <h2 className="font-display font-black text-lg">🤝 Consignment log — equipment only</h2>
              <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>Vendor-owned equipment pieces. Mark a piece as consigned once (owner + notify email) in the Equipment tab — from then on, every move of that piece is written here automatically and the owner is emailed. Parts and stock levels are never consigned. This log is the audit trail: entries are never deleted — if a piece is removed from inventory, its history stays here, marked as a removed piece.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                <div className="rounded-xl p-3 text-center" style={{ background: NAVY, color: "#fff" }}><p className="font-display font-black text-2xl leading-none">{data.stats.totalConsigned}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1 text-white/70">Pieces consigned</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-2xl leading-none">{data.stats.consignmentMoves}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Moves logged</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-2xl leading-none" style={{ color: (data.stats as any).consignmentActionableEmails > 0 ? "#B45309" : "var(--text)" }}>{(data.stats as any).consignmentActionableEmails}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Emails not sent yet</p></div>
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}><p className="font-display font-black text-2xl leading-none">{data.stats.consignmentValueCents > 0 ? fmtMoney(data.stats.consignmentValueCents) : "—"}</p><p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ color: "var(--dim)" }}>Value on hand</p></div>
              </div>
              <div className="mt-3 rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-display font-black">✉ Email outbox</p>
                    <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>The moment a consigned piece moves, the app composes the owner's notification and queues it here with the exact subject and body stored on that move's log entry — tap <strong>View email</strong> on any entry to read precisely what will go out. Emails send automatically right after the move (and again every 15 minutes if anything is waiting). The entry flips to <strong>Sent</strong> with the time on success, or to <strong>Failed</strong> with the error if the send fails. Use the button below to send anything still waiting now.</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button disabled={dispatchEmails.isPending} onClick={() => dispatchEmails.mutate()} className="px-5 py-3 rounded-xl text-white font-black disabled:opacity-40" style={{ background: ORANGE }}>{dispatchEmails.isPending ? "Checking…" : (data.stats as any).consignmentActionableEmails > 0 ? `Check queue — ${(data.stats as any).consignmentActionableEmails} not sent yet` : "Check queue — outbox clear"}</button>
                  {data.stats.consignmentQueuedEmails > 0 && <span className="px-3 py-3 rounded-xl text-sm font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>{data.stats.consignmentQueuedEmails} waiting to send</span>}
                  {(data.stats as any).consignmentFailedEmails > 0 && <span className="px-3 py-3 rounded-xl text-sm font-bold text-white" style={{ background: "#C1272D" }}>{(data.stats as any).consignmentFailedEmails} failed — see the reason on the entry and re-queue</span>}
                </div>
                {dispatchEmails.data && <p className="text-sm font-bold mt-2" style={{ color: (dispatchEmails.data as any).ok ? "#137333" : "#C1272D" }}>{(dispatchEmails.data as any).message}</p>}
              </div>
            </section>

            {/* What's consigned, where it sits now */}
            <section>
              <div className="flex items-center justify-between gap-3 flex-wrap"><h3 className="font-display font-black text-lg">What's consigned — where it sits now ({consignedEquipment.length})</h3><button onClick={() => setTab("equipment")} className="text-sm font-bold" style={{ color: NAVY }}>Manage in Equipment →</button></div>
              {consignedEquipment.length === 0 ? (
                <div className="mt-2 rounded-xl p-4" style={{ background: "var(--surface)", border: "1px dashed var(--border)" }}>
                  <p className="text-sm font-semibold" style={{ color: "var(--dim)" }}>No equipment is marked consigned yet. To start: go to Equipment, find the vendor-owned piece, tap <strong>🤝 Mark consigned</strong>, and set its owner + notify email once. You can also set it when you add new equipment. Its next move will appear in this log and queue an owner email.</p>
                  <button onClick={() => setTab("equipment")} className="mt-3 px-5 py-3 rounded-xl text-white font-bold" style={{ background: NAVY }}>Go to Equipment →</button>
                </div>
              ) : (
                <>
                  {(data as any).consignmentByOwner.length > 0 && (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(data as any).consignmentByOwner.map((o: any) => (
                        <button key={o.owner} onClick={() => setConsignOwnerFilter(consignOwnerFilter === o.owner ? "all" : o.owner)} aria-pressed={consignOwnerFilter === o.owner} className="rounded-xl p-3 text-left" style={{ background: consignOwnerFilter === o.owner ? NAVY : "var(--surface)", color: consignOwnerFilter === o.owner ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>
                          <p className="font-display font-black leading-tight">{o.owner} <span className="font-body text-xs font-bold opacity-75">• {o.count} piece{o.count === 1 ? "" : "s"}{o.valueCents > 0 ? ` • ${fmtMoney(o.valueCents)}` : ""}</span></p>
                          <p className={`text-xs mt-0.5 ${consignOwnerFilter === o.owner ? "text-white/75" : ""}`} style={consignOwnerFilter === o.owner ? undefined : { color: "var(--dim)" }}>{o.email ? `✉ ${o.email}` : "⚠ No email on file"} • At: {o.locations.join(", ")}</p>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 space-y-2">{consignedEquipment.map(e => {
                    const lastConsign = ((data as any).consignmentLogs as any[]).find((l: any) => l.equipmentId === e.id);
                    return <div key={e.id} className="rounded-2xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `4px solid ${ORANGE}` }}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-bold leading-tight">{e.name} {e.assetTag && <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--surface2)", color: "var(--dim)" }}>{e.assetTag}</span>}</p>
                          <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>{(e as any).consignmentOwner || "Owner not set"}{e.serialNumber ? ` • S/N ${e.serialNumber}` : ""}{e.brandModel ? ` • ${e.brandModel}` : ""}{(e as any).consignmentValueCents > 0 ? ` • ${fmtMoney((e as any).consignmentValueCents)}` : ""}</p>
                          <p className="text-sm font-bold mt-1">📍 {e.currentLocationName}{e.assignedTo ? <span className="font-semibold" style={{ color: "var(--dim)" }}> — {e.assignedTo}</span> : ""} <Badge color={statusColor(e.status)}>{equipStatusLabel(e.status)}</Badge></p>
                          {lastConsign && <p className="text-[11px] mt-1 font-semibold" style={{ color: "var(--dim)" }}>Last consignment move: {equipActionLabel(lastConsign.action)}{lastConsign.toLocationName ? ` → ${lastConsign.toLocationName}` : ""} • {fmtDate(lastConsign.created_at)} • {emailStatusStyle(lastConsign.emailStatus).label}</p>}
                        </div>
                        <button onClick={() => { setMoveForm(f => ({ ...f, equipmentId: e.id, toLocationId: e.currentLocationId, action: "transfer" })); setTab("equipment"); setTimeout(() => document.getElementById("equip-move-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); }} className="px-3 py-2 rounded-lg text-white text-xs font-bold shrink-0" style={{ background: NAVY }}>Move →</button>
                      </div>
                    </div>;
                  })}</div>
                </>
              )}
            </section>

            {/* The log itself */}
            <section>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="font-display font-black text-lg">Consignment moves ({filteredConsignLogs.length}{(consignOwnerFilter !== "all" || consignEmailFilter !== "all" || historyEquipId) ? " filtered" : ""})</h3>
                {(consignOwnerFilter !== "all" || consignEmailFilter !== "all" || historyEquipId) && <button onClick={() => { setConsignOwnerFilter("all"); setConsignEmailFilter("all"); setHistoryEquipId(null); }} className="text-sm font-bold" style={{ color: NAVY }}>Clear filters</button>}
              </div>
              <div className="flex gap-2 flex-wrap mt-2" role="group" aria-label="Consignment log filters">
                {(data as any).consignmentByOwner.length > 1 && (
                  <select aria-label="Filter consignment log by owner" value={consignOwnerFilter} onChange={e => setConsignOwnerFilter(e.target.value)} className="rounded-full px-3 py-2 text-sm font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <option value="all">All owners</option>
                    {(data as any).consignmentByOwner.map((o: any) => <option key={o.owner} value={o.owner}>{o.owner}</option>)}
                  </select>
                )}
                {([["all", "All email states"], ["queued", "Queued"], ["sent", "Sent"], ["failed", "Failed"], ["skipped", "Skipped — no email"]] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setConsignEmailFilter(v)} aria-pressed={consignEmailFilter === v} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: consignEmailFilter === v ? NAVY : "var(--surface)", color: consignEmailFilter === v ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>{label}</button>
                ))}
              </div>
              {filteredConsignLogs.length === 0 ? <p className="mt-2 rounded-xl p-4 text-sm font-semibold" style={{ background: "var(--surface)", color: "var(--dim)" }}>{(data as any).consignmentLogs.length === 0 ? "No consignment moves yet. When a consigned piece is moved — checked out, checked in, transferred, or sent for repair — the move lands here with its from → to, who moved it, the job, and the queued owner email's status." : "No moves match those filters."}</p> : (
                <div className="mt-2 space-y-2">{filteredConsignLogs.slice(0, showAllConsignLogs ? 60 : 15).map((l: any) => {
                  const es = emailStatusStyle(l.emailStatus);
                  return <div key={l.id} className="rounded-2xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold leading-tight">{l.equipmentName} {(l as any).equipmentRemoved && <span className="text-[11px] font-black px-1.5 py-0.5 rounded-full text-white align-middle" style={{ background: "#5B6B82" }}>REMOVED PIECE</span>} <span className="font-semibold text-xs" style={{ color: "var(--dim)" }}>— {equipActionLabel(l.action)}{l.assetTag ? ` • ${l.assetTag}` : ""}{l.serialNumber ? ` • S/N ${l.serialNumber}` : ""}</span></p>
                        {l.action === "removed" ? <p className="text-sm font-bold mt-1">Removed from inventory — history kept in this log</p> : <p className="text-sm font-bold mt-1">{l.fromLocationName ? l.fromLocationName : "— first placement"} <span style={{ color: ORANGE }}>→</span> {l.toLocationName || "Unassigned"}</p>}
                        <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>Owner: {l.owner || "—"}{l.notifyEmail ? ` • ${l.notifyEmail}` : ""} • {new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{l.performedBy ? ` • moved by ${l.performedBy}` : ""}</p>
                        {l.jobRef && <p className="text-xs mt-0.5"><strong>Job:</strong> {l.jobRef}</p>}
                        {l.notes && <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>{l.notes}</p>}
                        {l.emailStatus === "sent" && l.emailSentAt && <p className="text-[11px] mt-0.5 font-semibold" style={{ color: "#137333" }}>Emailed {new Date(l.emailSentAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{l.emailAttempts > 1 ? ` • took ${l.emailAttempts} attempts` : ""}</p>}
                        {(l.emailStatus === "queued" || l.emailStatus === "pending") && <p className="text-[11px] mt-0.5 font-semibold" style={{ color: "var(--dim)" }}>Queued{l.emailQueuedAt ? ` ${new Date(l.emailQueuedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""} — sending shortly</p>}
                        {l.emailStatus === "failed" && l.emailLastError && <p className="text-[11px] mt-0.5 font-bold" style={{ color: "#C1272D" }}>⚠ {l.emailLastError}</p>}
                        {l.emailStatus === "failed" && !l.emailLastError && <p className="text-[11px] mt-0.5 font-bold" style={{ color: "#C1272D" }}>⚠ Send failed — no reason recorded</p>}
                      </div>
                      <span className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-black text-white shrink-0" style={{ background: es.bg }}>{es.label}</span>
                    </div>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {(l.emailSubject || l.emailBody) && <button onClick={() => setExpandedEmailId(expandedEmailId === l.id ? null : l.id)} aria-expanded={expandedEmailId === l.id} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>{expandedEmailId === l.id ? "Hide email" : l.emailStatus === "sent" ? "View the email that was sent" : "View queued email"}</button>}
                      {l.emailStatus === "failed" && <button onClick={() => retryEmail.mutate(l.id)} disabled={retryEmail.isPending} className="px-3 py-1.5 rounded-lg text-white text-xs font-bold disabled:opacity-50" style={{ background: "#C1272D" }}>{retryEmail.isPending ? "Re-queuing…" : "Retry send"}</button>}
                      {l.emailStatus === "skipped" && !(l as any).equipmentRemoved && <button onClick={() => setTab("equipment")} className="px-3 py-1.5 rounded-lg text-xs font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>Add owner email in Equipment →</button>}
                    </div>
                    {expandedEmailId === l.id && (l.emailSubject || l.emailBody) && (
                      <div className="mt-2 rounded-xl p-3 text-left" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
                        <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: "var(--dim)" }}>To: {l.notifyEmail || "—"}</p>
                        <p className="text-sm font-black mt-1">{l.emailSubject}</p>
                        <pre className="text-xs font-body whitespace-pre-wrap mt-1.5 leading-relaxed" style={{ color: "var(--text)" }}>{l.emailBody}</pre>
                      </div>
                    )}
                  </div>;
                })}</div>
              )}
              {filteredConsignLogs.length > 15 && <button onClick={() => setShowAllConsignLogs(v => !v)} aria-expanded={showAllConsignLogs} className="mt-2 w-full py-2.5 rounded-xl text-sm font-bold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>{showAllConsignLogs ? "Show only the 15 most recent" : `Show older moves (${Math.min(filteredConsignLogs.length, 60) - 15} more)`}</button>}
            </section>
          </div>
        )}
      </main>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t pb-[env(safe-area-inset-bottom)]" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Inventory sections">
        <div className="max-w-5xl mx-auto grid grid-cols-8">
          {([
            { id: "board" as Tab, label: "Board", icon: "📋", badge: data.stats.lowStockCount + data.stats.newTechRequests },
            { id: "stock" as Tab, label: "Stock", icon: "📦", badge: data.stats.lowStockCount },
            { id: "orders" as Tab, label: "Orders", icon: "🚚", badge: data.stats.openOrders },
            { id: "verify" as Tab, label: "Verify", icon: "📸", badge: data.stats.intakeMismatches },
            { id: "staging" as Tab, label: "Staging", icon: "🎯", badge: data.stats.stagingNeeded },
            { id: "requests" as Tab, label: "Requests", icon: "🔧", badge: data.stats.newTechRequests },
            { id: "equipment" as Tab, label: "Equip", icon: "🧰", badge: data.stats.equipmentNeedsRepair + data.stats.equipmentMissing },
            { id: "consignment" as Tab, label: "Consign", icon: "🤝", badge: (data.stats as any).consignmentActionableEmails },
          ]).map(n => (
            <button key={n.id} onClick={() => setTab(n.id)} aria-current={tab === n.id ? "page" : undefined} aria-label={`${n.label} section`} className="relative py-2.5 px-0.5 flex flex-col items-center gap-0.5 min-w-0">
              <span className="text-lg leading-none">{n.icon}</span>
              <span className="text-[10px] font-bold truncate max-w-full" style={{ color: tab === n.id ? NAVY : "var(--dim)" }}>{n.label}</span>
              {tab === n.id && <span className="absolute top-0 left-1/2 -translate-x-1/2 h-1 w-8 rounded-b-full" style={{ background: ORANGE }} />}
              {n.badge > 0 && <span className="absolute top-1 right-1 min-w-5 h-5 px-1 rounded-full text-[11px] font-black text-white flex items-center justify-center" style={{ background: "#C1272D" }}>{n.badge}</span>}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
