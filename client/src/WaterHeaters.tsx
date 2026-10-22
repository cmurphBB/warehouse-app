// Consigned water heaters: Receive → Pull (ServiceTitan job) → Install (serial
// written to the ST customer) or Return. Lives at the top of the Consign tab.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { useMe } from "./Auth";

type State = ApiResponse<typeof api, "getState">;
type Equip = State["equipment"][number];
type Mode = "receive" | "pull" | "install" | "return" | null;
type Filter = "stock" | "pulled" | "overdue" | "installed" | "sterr" | "all";

const NAVY = "#052A78";
const ORANGE = "#FF6700";
const PURPLE = "#6A1B9A";
const RED = "#C1272D";
const GREEN = "#137333";

const isWH = (e: Equip) => e.isConsigned && /water\s*heater/i.test(`${e.category} ${e.name}`);
const stage = (e: Equip): "stock" | "pulled" | "installed" => (e.installedAt || e.status === "installed" ? "installed" : e.pulledAt ? "pulled" : "stock");
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const remember = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k) ?? ""; localStorage.setItem(k, v); } catch { /* private mode */ } return v ?? ""; };

const field = "mt-1 w-full rounded-xl px-4 py-3.5 text-base font-semibold";
const fieldStyle = { background: "var(--surface2)", border: "1px solid var(--border)" };

export function WaterHeaters({ data, onChanged, toast }: { data: State; onChanged: () => void; toast: (m: string) => void }) {
  const me = useMe();
  const [mode, setMode] = useState<Mode>(null);
  const [filter, setFilter] = useState<Filter>("stock");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const units = useMemo(() => data.equipment.filter(isWH), [data]);
  const warehouses = data.locations.filter((l) => l.kind === "warehouse");
  const trucks = data.locations.filter((l) => l.kind === "truck");
  const s = data.stats;
  const readOnly = me?.role === "VIEW_ONLY";

  const rows = useMemo(() => {
    let r = units;
    if (filter === "stock") r = r.filter((u) => stage(u) === "stock");
    else if (filter === "pulled") r = r.filter((u) => stage(u) === "pulled");
    else if (filter === "overdue") r = r.filter((u) => stage(u) === "pulled" && (u.daysOut ?? 0) >= 7);
    else if (filter === "installed") r = r.filter((u) => stage(u) === "installed");
    else if (filter === "sterr") r = r.filter((u) => u.stSync === "error");
    const t = q.trim().toLowerCase();
    if (t) r = r.filter((u) => [u.serialNumber, u.brandModel, u.jobNumber, u.customerName, u.consignmentOwner, u.currentLocationName, u.assignedTo].some((v) => (v ?? "").toLowerCase().includes(t)));
    return [...r].sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  }, [units, filter, q]);

  const retry = useMutation({ mutationFn: (id: number) => api.whRetrySt({ equipmentId: id }), onSuccess: (r) => { onChanged(); toast(r.message); }, onError: (e: Error) => toast(e.message) });

  const stat = (label: string, n: number, f: Filter, alert = false) => (
    <button onClick={() => setFilter(f)} className="rounded-xl p-3 text-center" style={{ background: alert && n > 0 ? RED : filter === f ? NAVY : "var(--surface)", color: (alert && n > 0) || filter === f ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>
      <p className="font-display font-black text-2xl leading-none">{n}</p>
      <p className="text-[11px] font-bold uppercase tracking-wide mt-1" style={{ opacity: 0.75 }}>{label}</p>
    </button>
  );

  return (
    <section>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display font-black text-lg">🔥 Water heaters — consigned</h2>
        <div className="flex gap-1.5 text-[11px] font-bold">
          <span className="rounded-full px-2 py-1" style={{ background: s.stLive ? "#13733322" : "#B4530922", color: s.stLive ? GREEN : "#B45309" }}>ServiceTitan {s.stLive ? "on" : "off"}</span>
          <span className="rounded-full px-2 py-1" style={{ background: s.mailLive ? "#13733322" : "#B4530922", color: s.mailLive ? GREEN : "#B45309" }}>Emails {s.mailLive ? "on" : "off"}</span>
        </div>
      </div>
      <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>No serial, no move. The supply house bills from the <strong>pull</strong> date; <strong>install</strong> puts the serial on the customer's equipment in ServiceTitan.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        {stat("In stock", s.whInStock, "stock")}
        {stat("Pulled, not installed", s.whPulled, "pulled")}
        {stat("Pulled 7+ days", s.whPulledOverdue, "overdue", true)}
        {stat("ST sync errors", s.whStErrors, "sterr", true)}
      </div>

      {!readOnly && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          {([["receive", "Receive", "From supply house", "#2E7D32"], ["pull", "Pull", "For a ST job", "#1565C0"], ["install", "Install", "At the customer", PURPLE], ["return", "Return", "Not used", "#8D6E63"]] as const).map(([m, t, sub, c]) => (
            <button key={m} onClick={() => setMode(m)} className="rounded-2xl py-5 px-3 text-white text-center active:scale-[.98]" style={{ background: c }}>
              <p className="font-display font-black text-xl leading-none">{t}</p>
              <p className="text-xs font-semibold mt-1 opacity-90">{sub}</p>
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap mt-4">
        {([["stock", "In stock"], ["pulled", "Pulled"], ["overdue", "Overdue"], ["installed", "Installed"], ["sterr", "ST errors"], ["all", "All"]] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: filter === f ? NAVY : "var(--surface)", color: filter === f ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>{label}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial, model, job #, customer" className="mt-2 w-full rounded-xl px-4 py-3 font-semibold outline-none" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />

      <div className="mt-2 space-y-2">
        {rows.length === 0 && <p className="rounded-xl p-5 text-center text-sm" style={{ background: "var(--surface)", border: "1px dashed var(--border)", color: "var(--dim)" }}>{units.length ? "Nothing here." : "No consigned water heaters yet — tap Receive to log the first one."}</p>}
        {rows.slice(0, 100).map((u) => {
          const st = stage(u);
          const overdue = st === "pulled" && (u.daysOut ?? 0) >= 7;
          const badge = overdue ? { t: `Pulled ${u.daysOut}d`, c: RED } : st === "installed" ? { t: "Installed", c: PURPLE } : st === "pulled" ? { t: "Pulled", c: "#1565C0" } : { t: "In stock", c: GREEN };
          const log = openId === u.id ? data.consignmentLogs.filter((l) => l.equipmentId === u.id) : [];
          return (
            <div key={u.id} className="rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `4px solid ${badge.c}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-black tracking-wide">{u.serialNumber}</p>
                  <p className="text-xs font-semibold" style={{ color: "var(--dim)" }}>{[u.brandModel, u.name.replace(/^Water Heater\s*/, "")].filter(Boolean).join(" · ")} · {u.consignmentOwner}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>
                    {st === "stock" ? `${u.currentLocationName} · received ${day(u.created_at)}` : `Job #${u.jobNumber}${u.customerName ? ` · ${u.customerName}` : ""} · pulled ${day(u.pulledAt)}${u.installedAt ? ` · installed ${day(u.installedAt)}` : ` · ${u.currentLocationName}`}`}
                    {u.assignedTo ? ` · ${u.assignedTo}` : ""}
                  </p>
                  {u.stSync === "error" && <p className="text-xs mt-1 font-semibold" style={{ color: RED }}>ServiceTitan: {u.stError}</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase" style={{ background: badge.c + "22", color: badge.c }}>{badge.t}</span>
                  {u.stSync === "ok" && <span className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase" style={{ background: "#13733322", color: GREEN }}>On ST customer</span>}
                  {u.stSync === "error" && !readOnly && <button disabled={retry.isPending} onClick={() => retry.mutate(u.id)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-white" style={{ background: RED }}>Retry ST</button>}
                  <button onClick={() => setOpenId(openId === u.id ? null : u.id)} className="text-xs font-bold underline" style={{ color: NAVY }}>{openId === u.id ? "Hide" : "History"}</button>
                </div>
              </div>
              {openId === u.id && (
                <div className="mt-2 pt-2 space-y-1 text-xs" style={{ borderTop: "1px solid var(--border)" }}>
                  {log.length === 0 && <p style={{ color: "var(--dim)" }}>No history.</p>}
                  {log.map((l) => (
                    <p key={l.id}><strong>{l.action === "checkout" ? "Pulled" : l.action === "checkin" ? "Returned" : l.action === "installed" ? "Installed" : l.action === "created" ? "Received" : l.action}</strong> · {new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{l.performedBy ? ` · ${l.performedBy}` : ""}{l.jobRef ? ` · ${l.jobRef}` : ""} · <span style={{ color: l.emailStatus === "failed" ? RED : "var(--dim)" }}>email {l.emailStatus}</span></p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {mode && <Sheet mode={mode} units={units} warehouses={warehouses} trucks={trucks} close={() => setMode(null)} done={(m) => { setMode(null); onChanged(); toast(m); }} />}
    </section>
  );
}

function Sheet({ mode, units, warehouses, trucks, close, done }: { mode: Exclude<Mode, null>; units: Equip[]; warehouses: State["locations"]; trucks: State["locations"]; close: () => void; done: (msg: string) => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => ({
    serial: "", model: "", brand: "", gallons: "", fuel: "", supplyHouse: remember("wh_sh"), supplyHouseEmail: remember("wh_she"),
    warehouseId: warehouses[0]?.id ?? 0, equipmentId: 0, jobNumber: "", truckId: Number(remember("wh_truck")) || 0, installedOn: todayET(), reason: "Job cancelled",
  }));
  const [jobInfo, setJobInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: typeof x[k] === "number" ? Number(e.target.value) : e.target.value }));

  const pick = mode === "pull" ? units.filter((u) => stage(u) === "stock") : mode === "install" || mode === "return" ? units.filter((u) => stage(u) === "pulled") : [];
  const title = { receive: "Receive a water heater", pull: "Pull for a job", install: "Install at customer", return: "Return to stock" }[mode];
  const sub = {
    receive: "Log a consigned unit the supply house dropped off. Serial and model come off the data plate.",
    pull: "The unit leaves the warehouse. The supply house is emailed and bills from today.",
    install: "Writes the serial to the customer's equipment in ServiceTitan and emails the supply house.",
    return: "Pulled but not installed. Goes back to stock; the supply house is told to void the charge.",
  }[mode];

  const lookup = async () => {
    if (!f.jobNumber.trim()) return;
    setJobInfo({ ok: true, text: "Looking up…" });
    try { const r = await api.stLookupJob({ jobNumber: f.jobNumber }); setJobInfo({ ok: r.found || !r.live, text: r.message }); }
    catch (e) { setJobInfo({ ok: false, text: (e as Error).message }); }
  };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      let msg = "";
      if (mode === "receive") {
        remember("wh_sh", f.supplyHouse); remember("wh_she", f.supplyHouseEmail);
        msg = (await api.whReceive({ serialNumber: f.serial, model: f.model, brand: f.brand, gallons: f.gallons, fuel: f.fuel, supplyHouse: f.supplyHouse, supplyHouseEmail: f.supplyHouseEmail, warehouseLocationId: f.warehouseId || null })).message;
      } else if (!f.equipmentId) {
        throw new Error("Pick the serial first");
      } else if (mode === "pull") {
        remember("wh_truck", String(f.truckId || ""));
        msg = (await api.whPull({ equipmentId: f.equipmentId, jobNumber: f.jobNumber, toLocationId: f.truckId || null })).message;
      } else if (mode === "install") {
        msg = (await api.whInstall({ equipmentId: f.equipmentId, installedOn: f.installedOn })).message;
      } else {
        msg = (await api.whReturn({ equipmentId: f.equipmentId, toLocationId: f.warehouseId || null, reason: f.reason })).message;
      }
      done(msg);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const canSubmit = mode === "receive" ? f.serial.trim().length >= 4 && f.model.trim().length >= 2 && f.supplyHouse.trim() : mode === "pull" ? f.equipmentId && f.jobNumber.trim() : !!f.equipmentId;

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: "rgba(10,20,35,.5)" }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-auto rounded-t-2xl sm:rounded-2xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]" style={{ background: "var(--surface)" }}>
        <p className="font-display font-black text-xl">{title}</p>
        <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>{sub}</p>

        {mode === "receive" ? (
          <>
            <label className="block mt-4 text-xs font-bold">Serial #<input value={f.serial} onChange={set("serial")} autoCapitalize="characters" autoComplete="off" autoFocus className={field} style={fieldStyle} /></label>
            <label className="block mt-3 text-xs font-bold">Model #<input value={f.model} onChange={set("model")} autoCapitalize="characters" autoComplete="off" className={field} style={fieldStyle} /></label>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <label className="block text-xs font-bold">Brand<input value={f.brand} onChange={set("brand")} placeholder="Rheem" className={field} style={fieldStyle} /></label>
              <label className="block text-xs font-bold">Gallons<input value={f.gallons} onChange={set("gallons")} inputMode="numeric" placeholder="50" className={field} style={fieldStyle} /></label>
              <label className="block text-xs font-bold">Fuel<select value={f.fuel} onChange={set("fuel")} className={field} style={fieldStyle}><option value="">—</option><option>Gas</option><option>Electric</option><option>Propane</option><option>Heat pump</option><option>Tankless</option></select></label>
            </div>
            <label className="block mt-3 text-xs font-bold">Supply house<input value={f.supplyHouse} onChange={set("supplyHouse")} placeholder="e.g. Webb" className={field} style={fieldStyle} /></label>
            <label className="block mt-3 text-xs font-bold">Supply house email (gets pull / install / return notices)<input type="email" value={f.supplyHouseEmail} onChange={set("supplyHouseEmail")} inputMode="email" className={field} style={fieldStyle} /></label>
            {warehouses.length > 1 && <label className="block mt-3 text-xs font-bold">Warehouse<select value={f.warehouseId} onChange={set("warehouseId")} className={field} style={fieldStyle}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
          </>
        ) : (
          <>
            <label className="block mt-4 text-xs font-bold">Serial #
              <select value={f.equipmentId} onChange={set("equipmentId")} className={field} style={fieldStyle}>
                <option value={0}>{pick.length ? "Pick a unit…" : mode === "pull" ? "No units in stock" : "No pulled units"}</option>
                {pick.map((u) => <option key={u.id} value={u.id}>{u.serialNumber} — {u.brandModel}{u.jobNumber ? ` — job #${u.jobNumber}` : ""}</option>)}
              </select>
            </label>
            {mode === "pull" && (
              <>
                <label className="block mt-3 text-xs font-bold">ServiceTitan job #
                  <div className="flex gap-2"><input value={f.jobNumber} onChange={(e) => { set("jobNumber")(e); setJobInfo(null); }} onBlur={lookup} inputMode="numeric" autoComplete="off" className={field} style={fieldStyle} /><button type="button" onClick={lookup} className="mt-1 px-4 rounded-xl font-bold shrink-0" style={{ background: "var(--surface2)" }}>Look up</button></div>
                </label>
                {jobInfo && <p className="text-sm font-semibold mt-1" style={{ color: jobInfo.ok ? GREEN : RED }}>{jobInfo.text}</p>}
                <label className="block mt-3 text-xs font-bold">Going on truck<select value={f.truckId} onChange={set("truckId")} className={field} style={fieldStyle}><option value={0}>— not on a truck —</option>{trucks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
              </>
            )}
            {mode === "install" && <label className="block mt-3 text-xs font-bold">Install date<input type="date" value={f.installedOn} max={todayET()} onChange={set("installedOn")} className={field} style={fieldStyle} /></label>}
            {mode === "return" && (
              <>
                <label className="block mt-3 text-xs font-bold">Reason<select value={f.reason} onChange={set("reason")} className={field} style={fieldStyle}><option>Job cancelled</option><option>Wrong unit</option><option>Customer changed mind</option><option>Damaged</option><option>Other</option></select></label>
                {warehouses.length > 1 && <label className="block mt-3 text-xs font-bold">Back to<select value={f.warehouseId} onChange={set("warehouseId")} className={field} style={fieldStyle}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
              </>
            )}
          </>
        )}

        {err && <p className="mt-3 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ background: "#C1272D18", color: RED }}>{err}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={close} className="flex-1 py-3.5 rounded-xl font-bold" style={{ background: "var(--surface2)" }}>Cancel</button>
          <button disabled={busy || !canSubmit} onClick={submit} className="flex-1 py-3.5 rounded-xl text-white font-black disabled:opacity-40" style={{ background: mode === "receive" ? NAVY : ORANGE }}>{busy ? "Working…" : title.split(" ")[0]}</button>
        </div>
      </div>
    </div>
  );
}
