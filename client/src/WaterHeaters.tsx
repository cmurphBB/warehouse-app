// Water heaters.
// Top: the Blue Bear CAGE — owned stock at par, FIFO sign-outs with a finger
// signature, a reorder on each job's PO, and the Tuesday count. Replaces the
// paper sign-out sheet on the cage door.
// Below: consigned units (supply-house owned) keep the old Pull / Install /
// Return flow with owner emails.
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, fileToBase64, type ApiResponse } from "./api";
import { canManage, useMe } from "./Auth";

// Downscales a camera shot to a small JPEG for the AI data-plate reader.
async function plateToJpeg(file: File): Promise<{ dataBase64: string; mimeType: "image/jpeg" }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not read that photo")); i.src = url; });
    const maxDim = 1568;
    let w = img.naturalWidth || 960; let h = img.naturalHeight || 720;
    if (Math.max(w, h) > maxDim) { const s = maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const cx = canvas.getContext("2d"); if (!cx) throw new Error("Canvas unavailable");
    cx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob) throw new Error("Could not process that photo");
    const { dataBase64 } = await fileToBase64(blob);
    return { dataBase64, mimeType: "image/jpeg" };
  } finally { URL.revokeObjectURL(url); }
}

// Best-guess cage type from what the data plate says.
function suggestWhType(fuel: string, gallons: string, model: string): string {
  if (/tankless/i.test(fuel) || /tankless|199/i.test(model)) return "tl199";
  const g = Number(gallons);
  const powerVent = /\bPV\b|POWER\s*VENT|PDV|PDX/i.test(model);
  if (g >= 45 && powerVent) return "50pv";
  if (/electric/i.test(fuel)) return g >= 45 ? "50e" : g >= 35 ? "40e" : "";
  if (/gas|propane/i.test(fuel)) return g >= 45 ? "50g" : g >= 35 ? "40g" : "";
  return "";
}

type State = ApiResponse<typeof api, "getState">;
type Equip = State["equipment"][number];
type Reorder = State["whReorders"][number];
type Mode = "signout" | "receive" | "pull" | "install" | "return" | "count" | null;
type Filter = "cage" | "out" | "consigned" | "installed" | "sterr" | "all";

const NAVY = "#052A78";
const ORANGE = "#FF6700";
const PURPLE = "#6A1B9A";
const RED = "#C1272D";
const GREEN = "#137333";

const isWH = (e: Equip) => (e.isConsigned || !!e.whType) && /water\s*heater/i.test(`${e.category} ${e.name}`);
const stage = (e: Equip): "stock" | "pulled" | "installed" => (e.installedAt || e.status === "installed" ? "installed" : e.pulledAt ? "pulled" : "stock");
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const remember = (k: string, v?: string) => { try { if (v === undefined) return localStorage.getItem(k) ?? ""; localStorage.setItem(k, v); } catch { /* private mode */ } return v ?? ""; };

// Mirror of the server rule (server decides): after hours = outside Mon–Fri 7–5 ET.
function afterHoursNow(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = get("weekday");
  const hour = Number(get("hour")) % 24;
  if (wd === "Sat" || wd === "Sun") return true;
  return hour < 7 || hour >= 17;
}
const isTuesdayET = () => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date()) === "Tue";

const field = "mt-1 w-full rounded-xl px-4 py-3.5 text-base font-semibold";
const fieldStyle = { background: "var(--surface2)", border: "1px solid var(--border)" };

// ---------- Barcode scanning: BarcodeDetector first, zxing fallback, typing always works ----------
function SerialScanButton({ onScan }: { onScan: (serial: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="mt-1 px-4 rounded-xl font-bold shrink-0" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>📷 Scan</button>
      {open && <ScannerOverlay onScan={(s) => { setOpen(false); onScan(s); }} onClose={() => setOpen(false)} />}
    </>
  );
}

function ScannerOverlay({ onScan, onClose }: { onScan: (serial: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let zxingControls: { stop(): void } | null = null;
    let raf = 0;
    const stop = () => { stopped = true; cancelAnimationFrame(raf); zxingControls?.stop(); stream?.getTracks().forEach((t) => t.stop()); };
    (async () => {
      try {
        const video = videoRef.current!;
        const Detector = (window as any).BarcodeDetector;
        if (Detector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
          if (stopped) return stream.getTracks().forEach((t) => t.stop());
          video.srcObject = stream;
          await video.play();
          const detector = new Detector({ formats: ["code_128", "code_39", "ean_13", "upc_a", "upc_e", "qr_code", "data_matrix"] });
          const tick = async () => {
            if (stopped) return;
            try {
              const codes = await detector.detect(video);
              const v = codes?.[0]?.rawValue?.trim();
              if (v) { stop(); onScan(v.toUpperCase()); return; }
            } catch { /* keep trying */ }
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        } else {
          // iPad Safari: no BarcodeDetector — zxing, loaded only when needed.
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
            const v = result?.getText()?.trim();
            if (v && !stopped) { stop(); onScan(v.toUpperCase()); }
          });
        }
      } catch (e) {
        setErr(`Camera not available — type the serial instead. (${(e as Error).message})`);
      }
    })();
    return stop;
  }, [onScan]);
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4" style={{ background: "rgba(5,10,20,.92)" }}>
      <p className="text-white font-display font-black text-lg mb-3">Point at the serial barcode</p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} playsInline muted className="w-full max-w-md rounded-2xl" style={{ background: "#000", aspectRatio: "4/3", objectFit: "cover" }} />
      {err && <p className="mt-3 text-sm font-semibold text-center" style={{ color: "#FFB4A8" }}>{err}</p>}
      <button onClick={onClose} className="mt-4 px-8 py-3.5 rounded-xl font-black text-white" style={{ background: "rgba(255,255,255,.16)" }}>Cancel</button>
    </div>
  );
}

// ---------- Finger signature: plain canvas, no dependencies ----------
function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = canvasRef.current!;
    const scale = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = 160;
    c.width = w * scale; c.height = h * scale;
    const g = c.getContext("2d")!;
    g.scale(scale, scale);
    g.lineWidth = 2.5; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#0A2540";
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
  }, []);
  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    drawing.current = true;
    canvasRef.current!.setPointerCapture(e.pointerId);
    const g = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke();
    dirty.current = true;
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const g = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    g.lineTo(x, y); g.stroke();
  };
  const up = () => {
    drawing.current = false;
    if (dirty.current) onChange(canvasRef.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvasRef.current!;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    dirty.current = false;
    onChange("");
  };
  return (
    <div>
      <canvas ref={canvasRef} data-testid="signature-pad" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="w-full rounded-xl" style={{ height: 160, touchAction: "none", border: "1.5px dashed var(--border)", background: "#fff" }} />
      <div className="flex items-center justify-between mt-1">
        <p className="text-xs" style={{ color: "var(--dim)" }}>Tech signs with a finger</p>
        <button type="button" onClick={clear} className="text-xs font-bold underline" style={{ color: NAVY }}>Clear</button>
      </div>
    </div>
  );
}

// ---------- CSV + print of the sign-out log (matches the paper sheet's columns) ----------
function downloadSignOutCsv(rows: Reorder[]) {
  const esc = (v: string) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const header = ["Date", "Serial", "Model", "Type", "Tech", "Job #", "PO #", "Released by", "After hours", "FIFO override", "Status"];
  const lines = rows.map((r) => [new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/New_York" }), r.serialNumber, r.model, r.whTypeLabel, r.techName, r.jobNumber, r.poNumber, r.releasedByName, r.afterHours ? "YES" : "", r.fifoOverrideReason, r.status].map(esc).join(","));
  const blob = new Blob([[header.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `water-heater-sign-outs-${todayET()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function printSignOutLog(rows: Reorder[]) {
  const esc = (v: string) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const tr = rows.map((r) => `<tr>
    <td>${esc(new Date(r.created_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }))}</td>
    <td class="mono">${esc(r.serialNumber)}</td><td>${esc(r.model)}</td><td>${esc(r.whTypeLabel)}</td><td>${esc(r.techName)}</td>
    <td>${r.signatureUrl ? `<img src="${esc(r.signatureUrl)}" alt="signature" style="height:28px" />` : "—"}</td>
    <td>${esc(r.jobNumber)}${r.poNumber ? ` / PO ${esc(r.poNumber)}` : ""}</td><td>${esc(r.releasedByName)}</td><td>${r.afterHours ? "YES" : ""}</td>
  </tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Water heater sign-out log</title>
  <style>body{font-family:system-ui,sans-serif;margin:24px}h1{font-size:18px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #999;padding:4px 6px;text-align:left}.mono{font-family:ui-monospace,monospace}</style>
  </head><body><h1>Blue Bear — water heater cage sign-out log (printed ${esc(todayET())})</h1>
  <table><thead><tr><th>Date</th><th>Serial</th><th>Model</th><th>Type</th><th>Tech</th><th>Signature</th><th>Job / PO</th><th>Released by</th><th>After hours</th></tr></thead><tbody>${tr}</tbody></table>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return alert("Allow pop-ups to print the log");
  w.document.write(html);
  w.document.close();
}

// ---------- Main panel ----------
export function WaterHeaters({ data, onChanged, toast }: { data: State; onChanged: () => void; toast: (m: string) => void }) {
  const me = useMe();
  const [mode, setMode] = useState<Mode>(null);
  const [filter, setFilter] = useState<Filter>("cage");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [showReorders, setShowReorders] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [pullUnitId, setPullUnitId] = useState<number | null>(null);

  const units = useMemo(() => data.equipment.filter(isWH), [data]);
  const warehouses = data.locations.filter((l) => l.kind === "warehouse");
  const trucks = data.locations.filter((l) => l.kind === "truck");
  const s = data.stats;
  const readOnly = me?.role === "VIEW_ONLY";
  const afterHours = afterHoursNow();
  const lastCount = data.whCounts.find((c) => c.finished_at);
  const openReorders = data.whReorders.filter((r) => r.status === "open" || r.status === "ordered");

  const rows = useMemo(() => {
    let r = units;
    if (filter === "cage") r = r.filter((u) => !!u.whType && stage(u) === "stock");
    else if (filter === "out") r = r.filter((u) => stage(u) === "pulled");
    else if (filter === "consigned") r = r.filter((u) => u.isConsigned && stage(u) !== "installed");
    else if (filter === "installed") r = r.filter((u) => stage(u) === "installed");
    else if (filter === "sterr") r = r.filter((u) => u.stSync === "error");
    const t = q.trim().toLowerCase();
    if (t) r = r.filter((u) => [u.serialNumber, u.brandModel, u.jobNumber, u.customerName, u.consignmentOwner, u.currentLocationName, u.techName, u.releasedByName, u.poNumber].some((v) => (v ?? "").toLowerCase().includes(t)));
    return [...r].sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
  }, [units, filter, q]);

  // If the job # was never verified at pull time, ST's customer must be confirmed by a manager first.
  const retry = useMutation({
    mutationFn: async (id: number) => {
      const r = await api.whRetrySt({ equipmentId: id, confirmJob: false });
      if (!r.needsConfirm) return r;
      if (!canManage(me)) return { ...r, message: "A manager needs to confirm the ServiceTitan customer for this unit" };
      if (!window.confirm(`${r.message}\n\nWrite the serial to that customer?`)) return { ...r, message: "Not written — nothing changed in ServiceTitan" };
      return api.whRetrySt({ equipmentId: id, confirmJob: true });
    },
    onSuccess: (r) => { onChanged(); toast(r.message); },
    onError: (e: Error) => toast(e.message),
  });

  const reorderUpdate = useMutation({
    mutationFn: (a: { reorderId: number; status: "ordered" | "received"; poNumber?: string }) => api.whReorderUpdate(a),
    onSuccess: (r) => { onChanged(); toast(r.message); },
    onError: (e: Error) => toast(e.message),
  });

  return (
    <section>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-display font-black text-lg">🔥 Water heaters</h2>
        <div className="flex gap-1.5 text-[11px] font-bold">
          <span className="rounded-full px-2 py-1" style={{ background: s.stLive ? "#13733322" : "#B4530922", color: s.stLive ? GREEN : "#B45309" }}>ServiceTitan {s.stLive ? "on" : "off"}</span>
          {afterHours && <span className="rounded-full px-2 py-1 text-white" style={{ background: PURPLE }}>🌙 After hours</span>}
        </div>
      </div>
      <p className="text-sm mt-0.5" style={{ color: "var(--dim)" }}>Blue Bear's cage stock: oldest unit goes first, every sign-out gets a signature and a reorder on that job's PO. Inventory every Tuesday 7–9 AM.</p>

      {/* Par board */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-3" data-testid="par-board">
        {data.whTypes.map((t) => (
          <div key={t.key} className="rounded-xl p-3" style={{ background: t.belowPar ? RED : "var(--surface)", color: t.belowPar ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>
            <p className="text-[11px] font-bold uppercase tracking-wide" style={{ opacity: 0.8 }}>{t.label}</p>
            <p className="font-display font-black text-2xl leading-none mt-1">{t.inCage}<span className="text-sm font-bold" style={{ opacity: 0.7 }}> / {t.par} par</span></p>
            <p className="text-[11px] font-semibold mt-1" style={{ opacity: 0.75 }}>{t.inCage === 0 ? (t.belowPar ? "None in cage" : "—") : `Oldest ${t.oldestDays ?? 0}d (${t.oldestSerial})`}</p>
          </div>
        ))}
      </div>

      {/* Last count + log row */}
      <div className="flex gap-2 flex-wrap items-center mt-2 text-xs font-semibold" style={{ color: "var(--dim)" }}>
        {lastCount ? <span>Last count {day(lastCount.finished_at)} by {lastCount.finishedBy || lastCount.startedBy}: {lastCount.scanned}/{lastCount.expected} scanned{lastCount.missing ? <strong style={{ color: RED }}> · {lastCount.missing} missing</strong> : ""}{lastCount.unexpected ? <strong style={{ color: "#B45309" }}> · {lastCount.unexpected} unexpected</strong> : " · clean"}</span> : <span>No cage count yet.</span>}
        <span>·</span>
        <button onClick={() => setShowLog((v) => !v)} className="font-bold underline" style={{ color: NAVY }}>{showLog ? "Hide sign-out log" : `Sign-out log (${data.whReorders.length})`}</button>
      </div>

      {/* Action buttons */}
      {!readOnly && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3">
          {([
            ["signout", "Sign out", afterHours ? "After-hours mode" : "From the cage", ORANGE],
            ["receive", "Receive", "Into the cage", "#2E7D32"],
            ["install", "Install", "At the customer", PURPLE],
            ["return", "Return", "Back to the cage", "#8D6E63"],
            ["count", "Tuesday count", isTuesdayET() ? "It's Tuesday — count!" : "Scan the cage", isTuesdayET() ? NAVY : "#546E7A"],
          ] as const).map(([m, t, sub, c]) => (
            <button key={m} onClick={() => setMode(m)} className="rounded-2xl py-5 px-3 text-white text-center active:scale-[.98]" style={{ background: c, outline: m === "count" && isTuesdayET() ? `3px solid ${ORANGE}` : "none" }}>
              <p className="font-display font-black text-xl leading-none">{t}</p>
              <p className="text-xs font-semibold mt-1 opacity-90">{sub}</p>
            </button>
          ))}
        </div>
      )}

      {afterHours && !readOnly && (
        <p className="mt-2 rounded-xl px-3 py-2.5 text-sm font-bold text-white" style={{ background: PURPLE }}>🌙 After hours (outside Mon–Fri 7–5): the manager releases the cage key, anyone signed in can sign out, and a ServiceTitan job note is required.</p>
      )}

      {/* Reorders */}
      <div className="mt-4 rounded-2xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <button onClick={() => setShowReorders((v) => !v)} className="w-full flex items-center justify-between">
          <p className="font-display font-black">🔁 Reorders {openReorders.length > 0 && <span className="rounded-full px-2 py-0.5 text-[11px] font-black text-white align-middle" style={{ background: openReorders.some((r) => r.status === "open") ? RED : "#B45309" }}>{openReorders.length} waiting</span>}</p>
          <span className="text-xs font-bold" style={{ color: "var(--dim)" }}>{showReorders ? "Hide" : "Show"}</span>
        </button>
        {showReorders && (openReorders.length === 0
          ? <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>Nothing waiting — every sign-out has been reordered and received.</p>
          : <div className="mt-2 space-y-3">
              {data.whTypes.filter((t) => openReorders.some((r) => r.whType === t.key)).map((t) => (
                <div key={t.key}>
                  <p className="text-xs font-black uppercase tracking-wide" style={{ color: "var(--dim)" }}>{t.label}</p>
                  {openReorders.filter((r) => r.whType === t.key).map((r) => <ReorderRow key={r.id} r={r} readOnly={readOnly || me?.role === "TECHNICIAN"} busy={reorderUpdate.isPending} update={(a) => reorderUpdate.mutate(a)} />)}
                </div>
              ))}
            </div>
        )}
      </div>

      {/* Sign-out log */}
      {showLog && (
        <div className="mt-3 rounded-2xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-display font-black">📝 Sign-out log</p>
            <div className="flex gap-2">
              <button onClick={() => printSignOutLog(data.whReorders)} className="px-3 py-2 rounded-lg text-xs font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>🖨 Print</button>
              <button onClick={() => downloadSignOutCsv(data.whReorders)} className="px-3 py-2 rounded-lg text-xs font-bold" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>⬇ CSV</button>
            </div>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: 640 }}>
              <thead><tr className="text-left" style={{ color: "var(--dim)" }}><th className="py-1 pr-2">Date</th><th className="pr-2">Serial</th><th className="pr-2">Tech</th><th className="pr-2">Signature</th><th className="pr-2">Job / PO</th><th className="pr-2">Released by</th><th>Status</th></tr></thead>
              <tbody>
                {data.whReorders.slice(0, 60).map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{r.afterHours ? " 🌙" : ""}</td>
                    <td className="pr-2 font-bold">{r.serialNumber}<span style={{ color: "var(--dim)" }}> {r.whTypeLabel}</span></td>
                    <td className="pr-2">{r.techName}</td>
                    <td className="pr-2">{r.signatureUrl ? <img src={r.signatureUrl} alt="signature" style={{ height: 22, background: "#fff", borderRadius: 4 }} /> : "—"}</td>
                    <td className="pr-2">#{r.jobNumber}{r.poNumber ? ` / PO ${r.poNumber}` : ""}</td>
                    <td className="pr-2">{r.releasedByName}</td>
                    <td className="font-bold" style={{ color: r.status === "open" ? RED : r.status === "ordered" ? "#B45309" : r.status === "received" ? GREEN : "var(--dim)" }}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.whReorders.length === 0 && <p className="text-sm py-2" style={{ color: "var(--dim)" }}>No sign-outs yet.</p>}
          </div>
        </div>
      )}

      {/* Unit list */}
      <div className="flex gap-2 flex-wrap mt-4">
        {([["cage", `In cage (${s.whCageInCage})`], ["out", `Signed out (${s.whCageSignedOut + s.whPulled})`], ["consigned", `Consigned (${s.whInStock + s.whPulled})`], ["installed", "Installed"], ["sterr", "ST errors"], ["all", "All"]] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} className="px-3 py-2 rounded-full text-sm font-bold" style={{ background: filter === f ? NAVY : "var(--surface)", color: filter === f ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>{label}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search serial, model, job #, tech, customer" className="mt-2 w-full rounded-xl px-4 py-3 font-semibold outline-none" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />

      <div className="mt-2 space-y-2">
        {rows.length === 0 && <p className="rounded-xl p-5 text-center text-sm" style={{ background: "var(--surface)", border: "1px dashed var(--border)", color: "var(--dim)" }}>{units.length ? "Nothing here." : "No water heaters yet — tap Receive to log the first one."}</p>}
        {rows.slice(0, 100).map((u) => {
          const st = stage(u);
          const overdue = st === "pulled" && (u.daysOut ?? 0) >= 7;
          const badge = overdue ? { t: `Out ${u.daysOut}d`, c: RED } : st === "installed" ? { t: "Installed", c: PURPLE } : st === "pulled" ? { t: u.whType ? "Signed out" : "Pulled", c: "#1565C0" } : { t: u.whType ? "In cage" : "In stock", c: GREEN };
          const log = openId === u.id ? data.equipmentLogs.filter((l) => l.equipmentId === u.id) : [];
          return (
            <div key={u.id} className="rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderLeft: `4px solid ${badge.c}` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display font-black tracking-wide">{u.serialNumber} {u.afterHours && st === "pulled" && <span title="Signed out after hours">🌙</span>}</p>
                  <p className="text-xs font-semibold" style={{ color: "var(--dim)" }}>{[u.brandModel, u.name.replace(/^Water Heater\s*/, "")].filter(Boolean).join(" · ")}{u.isConsigned ? ` · 🤝 ${u.consignmentOwner}` : u.poNumber ? ` · PO ${u.poNumber}` : ""}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--dim)" }}>
                    {st === "stock" ? `${u.currentLocationName} · received ${day(u.receivedAt || u.created_at)}` : `Job #${u.jobNumber}${u.customerName ? ` · ${u.customerName}` : ""} · ${u.whType ? "signed out" : "pulled"} ${day(u.pulledAt)}${u.installedAt ? ` · installed ${day(u.installedAt)}` : ""}`}
                    {st === "pulled" && u.techName ? ` · tech ${u.techName}` : ""}
                    {st === "pulled" && u.releasedByName ? ` · released by ${u.releasedByName}` : ""}
                  </p>
                  {u.fifoOverrideReason && st === "pulled" && <p className="text-xs mt-0.5 font-semibold" style={{ color: "#B45309" }}>FIFO skipped: {u.fifoOverrideReason}</p>}
                  {u.stSync === "error" && <p className="text-xs mt-1 font-semibold" style={{ color: RED }}>ServiceTitan: {u.stError}</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase" style={{ background: badge.c + "22", color: badge.c }}>{badge.t}</span>
                  {u.stSync === "ok" && <span className="rounded-full px-2 py-0.5 text-[11px] font-bold uppercase" style={{ background: "#13733322", color: GREEN }}>On ST customer</span>}
                  {u.isConsigned && st === "stock" && !readOnly && <button onClick={() => { setPullUnitId(u.id); setMode("pull"); }} className="px-2.5 py-1 rounded-lg text-xs font-bold text-white" style={{ background: "#1565C0" }}>Pull</button>}
                  {u.stSync === "error" && !readOnly && <button disabled={retry.isPending} onClick={() => retry.mutate(u.id)} className="px-2.5 py-1 rounded-lg text-xs font-bold text-white" style={{ background: RED }}>Retry ST</button>}
                  <button onClick={() => setOpenId(openId === u.id ? null : u.id)} className="text-xs font-bold underline" style={{ color: NAVY }}>{openId === u.id ? "Hide" : "History"}</button>
                </div>
              </div>
              {openId === u.id && (
                <div className="mt-2 pt-2 space-y-1 text-xs" style={{ borderTop: "1px solid var(--border)" }}>
                  {log.length === 0 && <p style={{ color: "var(--dim)" }}>No history.</p>}
                  {log.map((l) => (
                    <p key={l.id}><strong>{l.action === "checkout" ? (u.whType ? "Signed out" : "Pulled") : l.action === "checkin" ? "Returned" : l.action === "installed" ? "Installed" : l.action === "created" ? "Received" : l.action}</strong> · {new Date(l.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{l.performedBy ? ` · ${l.performedBy}` : ""}{l.notes ? ` · ${l.notes}` : ""}</p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {mode === "signout" && <SignOutSheet data={data} afterHours={afterHours} close={() => setMode(null)} done={(m) => { setMode(null); onChanged(); toast(m); }} />}
      {mode === "receive" && <ReceiveSheet data={data} warehouses={warehouses} close={() => setMode(null)} done={(m) => { setMode(null); onChanged(); toast(m); }} />}
      {(mode === "pull" || mode === "install" || mode === "return") && <LegacySheet mode={mode} units={units} warehouses={warehouses} trucks={trucks} presetUnitId={pullUnitId} close={() => { setMode(null); setPullUnitId(null); }} done={(m) => { setMode(null); setPullUnitId(null); onChanged(); toast(m); }} />}
      {mode === "count" && <CountSheet close={() => { setMode(null); onChanged(); }} toast={toast} />}
    </section>
  );
}

function ReorderRow({ r, readOnly, busy, update }: { r: Reorder; readOnly: boolean; busy: boolean; update: (a: { reorderId: number; status: "ordered" | "received"; poNumber?: string }) => void }) {
  const [po, setPo] = useState(r.poNumber);
  return (
    <div className="rounded-xl p-2.5 mt-1.5 flex items-center justify-between gap-2 flex-wrap" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }}>
      <div className="min-w-0">
        <p className="text-sm font-bold">{r.serialNumber} → job #{r.jobNumber} {r.afterHours && "🌙"}</p>
        <p className="text-xs" style={{ color: "var(--dim)" }}>Signed out {day(r.created_at)} · tech {r.techName}{r.status === "ordered" ? ` · ordered ${day(r.orderedAt)} on PO ${r.poNumber}` : ""}</p>
      </div>
      {!readOnly && (
        <div className="flex items-center gap-1.5">
          {r.status === "open" && (
            <>
              <input value={po} onChange={(e) => setPo(e.target.value)} placeholder="PO #" className="w-24 rounded-lg px-2 py-2 text-sm font-semibold" style={{ background: "var(--surface)", border: "1px solid var(--border)" }} />
              <button disabled={busy || !po.trim()} onClick={() => update({ reorderId: r.id, status: "ordered", poNumber: po.trim() })} className="px-2.5 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40" style={{ background: "#B45309" }}>Mark ordered</button>
            </>
          )}
          <button disabled={busy} onClick={() => update({ reorderId: r.id, status: "received", poNumber: po.trim() })} className="px-2.5 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40" style={{ background: GREEN }}>Mark received</button>
        </div>
      )}
    </div>
  );
}

// ---------- Cage sign-out ----------
function SignOutSheet({ data, afterHours, close, done }: { data: State; afterHours: boolean; close: () => void; done: (m: string) => void }) {
  const me = useMe();
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [typeKey, setTypeKey] = useState("");
  const [pickOther, setPickOther] = useState(false);
  const [equipmentId, setEquipmentId] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [jobNumber, setJobNumber] = useState("");
  const [techName, setTechName] = useState("");
  const [truckId, setTruckId] = useState(Number(remember("wh_truck")) || 0);
  const [signature, setSignature] = useState("");
  const [jobInfo, setJobInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmSerial, setConfirmSerial] = useState<{ ok: boolean; text: string } | null>(null);

  const type = data.whTypes.find((t) => t.key === typeKey);
  const inCage = useMemo(() => data.equipment
    .filter((e) => e.whType === typeKey && !e.pulledAt && !e.installedAt && e.status === "available")
    .sort((a, b) => (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.id - b.id)), [data, typeKey]);
  const fifo = inCage[0] ?? null;
  const picked = equipmentId ? inCage.find((u) => u.id === equipmentId) ?? null : fifo;
  const needsReason = !!picked && !!fifo && picked.id !== fifo.id;
  const trucks = data.locations.filter((l) => l.kind === "truck");

  const lookup = async () => {
    if (!jobNumber.trim()) return;
    setJobInfo({ ok: true, text: "Looking up…" });
    try { const r = await api.stLookupJob({ jobNumber }); setJobInfo({ ok: r.found || !r.live, text: r.message }); }
    catch (e) { setJobInfo({ ok: false, text: (e as Error).message }); }
  };

  const scanConfirm = (scanned: string) => {
    if (!picked) return;
    const ok = scanned.toUpperCase() === picked.serialNumber.toUpperCase();
    const match = !ok ? inCage.find((u) => u.serialNumber.toUpperCase() === scanned.toUpperCase()) : null;
    if (match) { setEquipmentId(match.id); setConfirmSerial({ ok: true, text: `Scanned ${scanned} — switched to that unit${match.id !== fifo?.id ? " (needs a FIFO reason)" : ""}` }); return; }
    setConfirmSerial(ok ? { ok: true, text: `Scanned ${scanned} — matches` } : { ok: false, text: `Scanned ${scanned} — that's NOT ${picked.serialNumber} and it isn't in the cage list` });
  };

  const submit = async () => {
    if (!picked) return;
    setBusy(true); setErr("");
    try {
      remember("wh_truck", String(truckId || ""));
      const r = await api.whSignOut({ whType: typeKey, equipmentId: picked.id, jobNumber, techName, signaturePngBase64: signature, fifoOverrideReason: overrideReason, toLocationId: truckId || null });
      done(r.message);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const canSubmit = !!picked && jobNumber.trim() && techName.trim().length >= 2 && signature && (!needsReason || overrideReason.trim().length >= 3);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: "rgba(10,20,35,.5)" }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-auto rounded-t-2xl sm:rounded-2xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]" style={{ background: "var(--surface)" }}>
        <p className="font-display font-black text-xl">Sign out of the cage</p>
        <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>Oldest unit goes first. The sign-out opens a reorder on this job's PO.</p>
        {afterHours && <p className="mt-2 rounded-xl px-3 py-2.5 text-sm font-bold text-white" style={{ background: PURPLE }}>🌙 After-hours sign-out — the ServiceTitan job note is required, and the manager must have released the key.</p>}

        <p className="mt-4 text-xs font-bold">Type</p>
        <div className="grid grid-cols-2 gap-2 mt-1">
          {data.whTypes.map((t) => (
            <button key={t.key} disabled={t.inCage === 0} onClick={() => { setTypeKey(t.key); setEquipmentId(null); setOverrideReason(""); setConfirmSerial(null); setPickOther(false); }} className="rounded-xl p-2.5 text-left disabled:opacity-40" style={{ background: typeKey === t.key ? NAVY : "var(--surface2)", color: typeKey === t.key ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>
              <p className="text-sm font-black">{t.label}</p>
              <p className="text-[11px] font-semibold" style={{ opacity: 0.75 }}>{t.inCage} in cage{t.inCage === 0 ? " — none" : ""}</p>
            </button>
          ))}
        </div>

        {type && picked && (
          <>
            <div className="mt-3 rounded-xl p-3" style={{ background: "var(--surface2)", border: `1.5px solid ${needsReason ? "#B45309" : "var(--border)"}` }}>
              <p className="text-xs font-bold" style={{ color: "var(--dim)" }}>{needsReason ? "Picked out of FIFO order" : "FIFO — take this one (oldest in the cage)"}</p>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <p className="font-display font-black text-lg">{picked.serialNumber}</p>
                <SerialScanButton onScan={scanConfirm} />
              </div>
              <p className="text-xs" style={{ color: "var(--dim)" }}>{picked.brandModel || type.label} · received {day(picked.receivedAt)}</p>
              {confirmSerial && <p className="text-xs font-bold mt-1" style={{ color: confirmSerial.ok ? GREEN : RED }}>{confirmSerial.text}</p>}
              {inCage.length > 1 && (
                <button type="button" onClick={() => setPickOther((v) => !v)} className="mt-1.5 text-xs font-bold underline" style={{ color: NAVY }}>{pickOther ? "Hide other units" : "Take a different unit"}</button>
              )}
              {pickOther && (
                <div className="mt-1.5 space-y-1">
                  {inCage.map((u, i) => (
                    <button key={u.id} onClick={() => { setEquipmentId(u.id); setConfirmSerial(null); }} className="w-full text-left rounded-lg px-2.5 py-2 text-sm font-semibold" style={{ background: picked.id === u.id ? NAVY : "var(--surface)", color: picked.id === u.id ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>
                      {u.serialNumber} · received {day(u.receivedAt)}{i === 0 ? " · oldest" : ""}
                    </button>
                  ))}
                </div>
              )}
              {needsReason && (
                <label className="block mt-2 text-xs font-bold">Why skip the oldest ({fifo?.serialNumber})?<input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. dented, wrong venting" className={field} style={fieldStyle} /></label>
              )}
            </div>

            <label className="block mt-3 text-xs font-bold">ServiceTitan job #
              <div className="flex gap-2"><input value={jobNumber} onChange={(e) => { setJobNumber(e.target.value); setJobInfo(null); }} onBlur={lookup} inputMode="numeric" autoComplete="off" className={field} style={fieldStyle} /><button type="button" onClick={lookup} className="mt-1 px-4 rounded-xl font-bold shrink-0" style={{ background: "var(--surface2)" }}>Look up</button></div>
            </label>
            {jobInfo && <p className="text-sm font-semibold mt-1" style={{ color: jobInfo.ok ? GREEN : RED }}>{jobInfo.text}</p>}
            <label className="block mt-3 text-xs font-bold">Tech taking it<input value={techName} onChange={(e) => setTechName(e.target.value)} autoComplete="off" className={field} style={fieldStyle} /></label>
            <label className="block mt-3 text-xs font-bold">Going on truck<select value={truckId} onChange={(e) => setTruckId(Number(e.target.value))} className={field} style={fieldStyle}><option value={0}>— not on a truck —</option>{trucks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <p className="mt-3 text-xs font-bold">Tech signature</p>
            <div className="mt-1"><SignaturePad onChange={setSignature} /></div>
            <p className="mt-2 text-xs font-semibold" style={{ color: "var(--dim)" }}>Released by <strong>{me?.name}</strong> (from your login){afterHours ? " · after hours" : ""}</p>
          </>
        )}

        {err && <p className="mt-3 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ background: "#C1272D18", color: RED }}>{err}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={close} className="flex-1 py-3.5 rounded-xl font-bold" style={{ background: "var(--surface2)" }}>Cancel</button>
          <button disabled={busy || !canSubmit} onClick={submit} className="flex-1 py-3.5 rounded-xl text-white font-black disabled:opacity-40" style={{ background: ORANGE }}>{busy ? "Working…" : "Sign out"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Receive (cage by default; consigned toggle keeps the old flow) ----------
function ReceiveSheet({ data, warehouses, close, done }: { data: State; warehouses: State["locations"]; close: () => void; done: (m: string) => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [consigned, setConsigned] = useState(false);
  const [f, setF] = useState({ whType: "", serial: "", model: "", brand: "", poNumber: "", gallons: "", fuel: "", supplyHouse: remember("wh_sh"), supplyHouseEmail: remember("wh_she"), warehouseId: warehouses[0]?.id ?? 0 });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: typeof x[k] === "number" ? Number(e.target.value) : e.target.value }));
  const plateRef = useRef<HTMLInputElement>(null);
  const [plateBusy, setPlateBusy] = useState(false);
  const [plateNote, setPlateNote] = useState<{ ok: boolean; text: string } | null>(null);

  const readPlate = async (file: File) => {
    setPlateBusy(true); setPlateNote(null);
    try {
      const img = await plateToJpeg(file);
      const r = await api.whReadDataPlate(img);
      setF((x) => ({
        ...x,
        serial: r.serialNumber || x.serial,
        model: r.model || x.model,
        brand: r.brand || x.brand,
        gallons: r.gallons || x.gallons,
        fuel: r.fuel && r.fuel !== "Tankless" ? r.fuel : x.fuel,
        whType: consigned ? x.whType : (suggestWhType(r.fuel, r.gallons, r.model) || x.whType),
      }));
      const filled = [r.serialNumber && "serial", r.model && "model", r.brand && "brand", r.gallons && "gallons"].filter(Boolean).join(", ");
      setPlateNote({ ok: true, text: `Read ${filled || "nothing"} (${r.confidence} confidence).${r.notes ? ` ${r.notes}` : ""} Double-check the serial before saving.` });
    } catch (e) { setPlateNote({ ok: false, text: (e as Error).message }); }
    setPlateBusy(false);
  };

  const submit = async () => {
    setBusy(true); setErr("");
    try {
      let msg = "";
      if (consigned) {
        remember("wh_sh", f.supplyHouse); remember("wh_she", f.supplyHouseEmail);
        msg = (await api.whReceive({ serialNumber: f.serial, model: f.model, brand: f.brand, gallons: f.gallons, fuel: f.fuel, supplyHouse: f.supplyHouse, supplyHouseEmail: f.supplyHouseEmail, warehouseLocationId: f.warehouseId || null })).message;
      } else {
        msg = (await api.whReceive({ serialNumber: f.serial, model: f.model, brand: f.brand, whType: f.whType, poNumber: f.poNumber, warehouseLocationId: f.warehouseId || null })).message;
      }
      done(msg);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  const canSubmit = f.serial.trim().length >= 4 && f.model.trim().length >= 2 && (consigned ? !!f.supplyHouse.trim() : !!f.whType && !!f.poNumber.trim());

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: "rgba(10,20,35,.5)" }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-auto rounded-t-2xl sm:rounded-2xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]" style={{ background: "var(--surface)" }}>
        <p className="font-display font-black text-xl">Receive a water heater</p>
        <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>{consigned ? "Supply-house owned (consigned) — old flow, owner gets emailed on moves." : "Blue Bear-owned cage stock. It arrives on a PO and fills the oldest waiting reorder of its type."}</p>

        <label className="flex items-center gap-2.5 mt-3 cursor-pointer"><input type="checkbox" checked={consigned} onChange={(e) => setConsigned(e.target.checked)} className="h-6 w-6 accent-[#FF6700]" /><span className="text-sm font-black">🤝 This unit is consigned (supply-house owned)</span></label>

        <input ref={plateRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) readPlate(file); }} />
        <button type="button" disabled={plateBusy} onClick={() => plateRef.current?.click()} className="mt-3 w-full py-3 rounded-xl font-black text-white disabled:opacity-50" style={{ background: PURPLE }}>{plateBusy ? "Reading the data plate…" : "📷 Snap the data plate — AI fills the fields"}</button>
        {plateNote && <p className="mt-1.5 text-xs font-bold" style={{ color: plateNote.ok ? GREEN : RED }}>{plateNote.text}</p>}

        {!consigned && (
          <>
            <p className="mt-3 text-xs font-bold">Type</p>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {data.whTypes.map((t) => (
                <button key={t.key} onClick={() => setF((x) => ({ ...x, whType: t.key }))} className="rounded-xl p-2.5 text-left" style={{ background: f.whType === t.key ? NAVY : "var(--surface2)", color: f.whType === t.key ? "#fff" : "var(--text)", border: "1px solid var(--border)" }}>
                  <p className="text-sm font-black">{t.label}</p>
                  <p className="text-[11px] font-semibold" style={{ opacity: 0.75 }}>{t.inCage} / {t.par} par{t.belowPar ? " · below par" : ""}</p>
                </button>
              ))}
            </div>
          </>
        )}

        <label className="block mt-4 text-xs font-bold">Serial #
          <div className="flex gap-2"><input value={f.serial} onChange={set("serial")} autoCapitalize="characters" autoComplete="off" className={field} style={fieldStyle} /><SerialScanButton onScan={(s) => setF((x) => ({ ...x, serial: s }))} /></div>
        </label>
        <label className="block mt-3 text-xs font-bold">Model #<input value={f.model} onChange={set("model")} autoCapitalize="characters" autoComplete="off" className={field} style={fieldStyle} /></label>
        {!consigned ? (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <label className="block text-xs font-bold">Brand<input value={f.brand} onChange={set("brand")} placeholder="Bradford White" className={field} style={fieldStyle} /></label>
            <label className="block text-xs font-bold">Arrived on PO #<input value={f.poNumber} onChange={set("poNumber")} autoComplete="off" className={field} style={fieldStyle} /></label>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <label className="block text-xs font-bold">Brand<input value={f.brand} onChange={set("brand")} placeholder="Rheem" className={field} style={fieldStyle} /></label>
              <label className="block text-xs font-bold">Gallons<input value={f.gallons} onChange={set("gallons")} inputMode="numeric" placeholder="50" className={field} style={fieldStyle} /></label>
              <label className="block text-xs font-bold">Fuel<select value={f.fuel} onChange={set("fuel")} className={field} style={fieldStyle}><option value="">—</option><option>Gas</option><option>Electric</option><option>Propane</option><option>Heat pump</option><option>Tankless</option></select></label>
            </div>
            <label className="block mt-3 text-xs font-bold">Supply house<input value={f.supplyHouse} onChange={set("supplyHouse")} placeholder="e.g. Webb" className={field} style={fieldStyle} /></label>
            <label className="block mt-3 text-xs font-bold">Supply house email (gets pull / install / return notices)<input type="email" value={f.supplyHouseEmail} onChange={set("supplyHouseEmail")} inputMode="email" className={field} style={fieldStyle} /></label>
          </>
        )}
        {warehouses.length > 1 && <label className="block mt-3 text-xs font-bold">Warehouse<select value={f.warehouseId} onChange={set("warehouseId")} className={field} style={fieldStyle}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}

        {err && <p className="mt-3 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ background: "#C1272D18", color: RED }}>{err}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={close} className="flex-1 py-3.5 rounded-xl font-bold" style={{ background: "var(--surface2)" }}>Cancel</button>
          <button disabled={busy || !canSubmit} onClick={submit} className="flex-1 py-3.5 rounded-xl text-white font-black disabled:opacity-40" style={{ background: NAVY }}>{busy ? "Working…" : "Receive"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Legacy pull (consigned) + shared install / return ----------
function LegacySheet({ mode, units, warehouses, trucks, presetUnitId, close, done }: { mode: "pull" | "install" | "return"; units: Equip[]; warehouses: State["locations"]; trucks: State["locations"]; presetUnitId: number | null; close: () => void; done: (msg: string) => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState(() => ({ equipmentId: presetUnitId ?? 0, jobNumber: "", truckId: Number(remember("wh_truck")) || 0, warehouseId: warehouses[0]?.id ?? 0, installedOn: todayET(), reason: "Job cancelled" }));
  const [jobInfo, setJobInfo] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: typeof x[k] === "number" ? Number(e.target.value) : e.target.value }));

  // Pull is consigned-only (cage units use Sign out); install/return cover both.
  const pick = mode === "pull" ? units.filter((u) => u.isConsigned && stage(u) === "stock") : units.filter((u) => stage(u) === "pulled");
  const title = { pull: "Pull a consigned unit", install: "Install at customer", return: "Return to stock" }[mode];
  const sub = {
    pull: "Supply-house owned. The owner is emailed and bills from today.",
    install: "Writes the serial to the customer's equipment in ServiceTitan. Consigned units also email the supply house.",
    return: "Signed out / pulled but not installed. Cage units go back FIFO and the reorder is cancelled; consigned owners are told to void.",
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
      if (!f.equipmentId) throw new Error("Pick the serial first");
      if (mode === "pull") {
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

  const canSubmit = mode === "pull" ? f.equipmentId && f.jobNumber.trim() : !!f.equipmentId;

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: "rgba(10,20,35,.5)" }} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-auto rounded-t-2xl sm:rounded-2xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]" style={{ background: "var(--surface)" }}>
        <p className="font-display font-black text-xl">{title}</p>
        <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>{sub}</p>
        <label className="block mt-4 text-xs font-bold">Serial #
          <select value={f.equipmentId} onChange={set("equipmentId")} className={field} style={fieldStyle}>
            <option value={0}>{pick.length ? "Pick a unit…" : mode === "pull" ? "No consigned units in stock" : "No signed-out units"}</option>
            {pick.map((u) => <option key={u.id} value={u.id}>{u.serialNumber} — {u.brandModel}{u.jobNumber ? ` — job #${u.jobNumber}` : ""}{u.whType ? " — cage" : " — consigned"}</option>)}
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

        {err && <p className="mt-3 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ background: "#C1272D18", color: RED }}>{err}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={close} className="flex-1 py-3.5 rounded-xl font-bold" style={{ background: "var(--surface2)" }}>Cancel</button>
          <button disabled={busy || !canSubmit} onClick={submit} className="flex-1 py-3.5 rounded-xl text-white font-black disabled:opacity-40" style={{ background: ORANGE }}>{busy ? "Working…" : title.split(" ")[0]}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Tuesday count ----------
function CountSheet({ close, toast }: { close: () => void; toast: (m: string) => void }) {
  const [countId, setCountId] = useState<number | null>(null);
  const [expected, setExpected] = useState<{ equipmentId: number; serialNumber: string; whType: string; label: string }[]>([]);
  const [scans, setScans] = useState<{ serial: string; result: string; label: string }[]>([]);
  const [serial, setSerial] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ expected: number; scanned: number; missingSerials: string[]; unexpectedSerials: string[]; message: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.whCountStart({}).then((r) => { setCountId(r.countId); setExpected(r.expected); }).catch((e: Error) => setErr(e.message));
  }, []);

  const scannedSet = new Set(scans.filter((x) => x.result === "scanned").map((x) => x.serial));
  const types = [...new Map(expected.map((e) => [e.whType, e.label])).entries()];

  const scan = async (value: string) => {
    const v = value.trim();
    if (!v || countId === null) return;
    setSerial(""); setErr("");
    try {
      const r = await api.whCountScan({ countId, serial: v });
      if (r.result !== "duplicate") setScans((xs) => [{ serial: r.serialNumber, result: r.result, label: r.whTypeLabel }, ...xs]);
      else toast(`${r.serialNumber} already scanned`);
      inputRef.current?.focus();
    } catch (e) { setErr((e as Error).message); }
  };

  const finish = async () => {
    if (countId === null) return;
    setBusy(true); setErr("");
    try {
      const r = await api.whCountFinish({ countId });
      setResult(r);
      toast(r.message);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center" style={{ background: "rgba(10,20,35,.5)" }}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-auto rounded-t-2xl sm:rounded-2xl p-5 pb-[max(20px,env(safe-area-inset-bottom))]" style={{ background: "var(--surface)" }}>
        <p className="font-display font-black text-xl">🗒 Tuesday cage count</p>
        {!result ? (
          <>
            <p className="text-sm mt-1" style={{ color: "var(--dim)" }}>Scan every serial in the cage, one after another. {expected.length} expected.</p>
            <label className="block mt-4 text-xs font-bold">Scan or type a serial
              <div className="flex gap-2">
                <input ref={inputRef} value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") scan(serial); }} autoFocus autoComplete="off" autoCapitalize="characters" enterKeyHint="done" className={field} style={fieldStyle} />
                <SerialScanButton onScan={scan} />
                <button type="button" onClick={() => scan(serial)} className="mt-1 px-4 rounded-xl font-bold shrink-0 text-white" style={{ background: NAVY }}>Add</button>
              </div>
            </label>
            {/* Live tally per type */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-3">
              {types.map(([key, label]) => {
                const exp = expected.filter((e) => e.whType === key);
                const got = exp.filter((e) => scannedSet.has(e.serialNumber)).length;
                return (
                  <div key={key} className="rounded-xl p-2.5 text-center" style={{ background: got === exp.length ? "#13733322" : "var(--surface2)", border: "1px solid var(--border)" }}>
                    <p className="font-display font-black text-xl leading-none">{got}/{exp.length}</p>
                    <p className="text-[11px] font-bold mt-1" style={{ color: "var(--dim)" }}>{label}</p>
                  </div>
                );
              })}
              {expected.length === 0 && <p className="col-span-3 text-sm" style={{ color: "var(--dim)" }}>Cage is empty — nothing to count.</p>}
            </div>
            {scans.length > 0 && (
              <div className="mt-3 space-y-1 text-sm">
                {scans.slice(0, 12).map((x, i) => (
                  <p key={i} className="font-semibold">{x.result === "scanned" ? "✓" : "⚠"} {x.serial}{x.label ? ` · ${x.label}` : ""}{x.result === "unexpected" ? " · not expected in the cage" : ""}</p>
                ))}
              </div>
            )}
            {err && <p className="mt-3 rounded-xl px-3 py-2.5 text-sm font-semibold" style={{ background: "#C1272D18", color: RED }}>{err}</p>}
            <div className="flex gap-2 mt-5">
              <button onClick={close} className="flex-1 py-3.5 rounded-xl font-bold" style={{ background: "var(--surface2)" }}>Cancel</button>
              <button disabled={busy || countId === null} onClick={finish} className="flex-1 py-3.5 rounded-xl text-white font-black disabled:opacity-40" style={{ background: GREEN }}>{busy ? "Working…" : "Finish count"}</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 rounded-xl px-3 py-2.5 font-bold text-white" style={{ background: result.missingSerials.length || result.unexpectedSerials.length ? RED : GREEN }}>{result.message}</p>
            <p className="mt-3 text-sm font-semibold">{result.scanned} of {result.expected} scanned.</p>
            {result.missingSerials.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-black uppercase" style={{ color: RED }}>Missing — find these or tell a manager</p>
                {result.missingSerials.map((m) => <p key={m} className="font-display font-black">{m}</p>)}
              </div>
            )}
            {result.unexpectedSerials.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-black uppercase" style={{ color: "#B45309" }}>Unexpected — in the cage but not on the books</p>
                {result.unexpectedSerials.map((m) => <p key={m} className="font-display font-black">{m}</p>)}
              </div>
            )}
            <button onClick={close} className="mt-5 w-full py-3.5 rounded-xl text-white font-black" style={{ background: NAVY }}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
