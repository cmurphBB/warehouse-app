// Local end-to-end test of the server actions against an in-memory Postgres
// (PGlite) loaded with the real data from db-dump.sql. No network, no secrets.
//   bun scripts/local-test.ts
import { Actions, isAfterHours, whClock } from "../server/src/actions.ts";
import { flushOutbox } from "../server/src/mail.ts";
import { runtimeEnv, type Ctx } from "../server/src/sdk.ts";
import { makeTestDb } from "./test-db.ts";

const envVals: Record<string, string> = {};
runtimeEnv.get = (k) => envVals[k] ?? "";

let failures = 0;
function check(label: string, cond: unknown, detail?: unknown) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ ${label}`, detail ?? ""); }
}

const db = await makeTestDb();

const ctx: Ctx = {
  db: () => db,
  invalidateQueries() {},
  blobs: { async put() {}, async getUrl(k) { return `signed://${k}`; } },
  inference: { async complete() { throw new Error("no AI in tests"); } },
  mail: { flush: () => flushOutbox(db) },
  user: { id: "u1", email: "test@example.com", name: "Test User", role: "ADMIN" },
};
const run = async (name: keyof typeof Actions, args: any) => (Actions[name] as any).handler(ctx, (Actions[name] as any).request.parse(args));

console.log("getState on imported data");
let t0 = performance.now();
let s = await run("getState", {});
console.log(`  (${Math.round(performance.now() - t0)} ms, ${(JSON.stringify(s).length / 1e6).toFixed(2)} MB)`);
check("631 parts", s.parts.length === 631, s.parts.length);
check("619 priced parts", s.stats.pricedParts === 619, s.stats.pricedParts);
check("20 locations", s.locations.length === 20);
check("651 equipment", s.equipment.length === 651);
check("orders payload capped at the newest 1000", s.orders.length === 1000 && s.stats.totalOrders === 4122, { sent: s.orders.length, total: s.stats.totalOrders });
check("R-454B avg $577.17", s.parts.find((p: any) => p.sku === "454B")?.avgCostCents === 57717);

console.log("recalcPricing is idempotent on the imported data");
const before = JSON.stringify(s.parts.map((p: any) => [p.id, p.avgCostCents, p.lastCostCents, p.priceCount]));
t0 = performance.now();
const rp = await run("recalcPricing", {});
console.log(`  (${Math.round(performance.now() - t0)} ms)`);
s = await run("getState", {});
check("prices unchanged after re-run", JSON.stringify(s.parts.map((p: any) => [p.id, p.avgCostCents, p.lastCostCents, p.priceCount])) === before);
check("partsPriced 619", rp.partsPriced === 619, rp.partsPriced);

console.log("water heater flow (ServiceTitan + email off)");
const wh = s.locations.find((l: any) => l.kind === "warehouse")!;
const truck = s.locations.find((l: any) => l.kind === "truck")!;
const rec = await run("whReceive", { serialNumber: "a1234567890", model: "xe50t10", brand: "Rheem", gallons: "50", fuel: "Gas", supplyHouse: "Webb", supplyHouseEmail: "orders@webb.example", warehouseLocationId: wh.id, performedBy: "Tester" });
check("receive creates unit", rec.id > 0);
let dupErr = ""; try { await run("whReceive", { serialNumber: "A1234567890", model: "XE50", supplyHouse: "Webb" }); } catch (e) { dupErr = (e as Error).message; }
check("duplicate serial rejected", /already in the system/.test(dupErr), dupErr);
let pullErr = ""; try { await run("whPull", { equipmentId: rec.id, jobNumber: "" }); } catch (e) { pullErr = String(e); }
check("pull requires job #", pullErr.length > 0);
const pull = await run("whPull", { equipmentId: rec.id, jobNumber: "12345678", toLocationId: truck.id, performedBy: "Mike" });
check("pull ok", pull.ok, pull);
let installErr = ""; try { await run("whInstall", { equipmentId: rec.id, installedOn: "2099-01-01" }); } catch (e) { installErr = (e as Error).message; }
check("future install date rejected", /future/.test(installErr), installErr);
const inst = await run("whInstall", { equipmentId: rec.id, performedBy: "Mike" });
check("install ok, ST n/a", inst.ok && inst.stSync === "n/a", inst);
s = await run("getState", {});
const unit = s.equipment.find((e: any) => e.id === rec.id);
check("unit installed with dates", unit.status === "installed" && unit.pulledAt && unit.installedAt && unit.currentLocationId === null, unit);
const logs = s.consignmentLogs.filter((l: any) => l.equipmentId === rec.id);
check("3 consignment log rows (receive, pull, install)", logs.length === 3, logs.map((l: any) => l.action));
check("receive did not queue an email", logs.find((l: any) => l.action === "created")?.emailStatus === "skipped");
check("pull + install queued emails", logs.filter((l: any) => l.emailStatus === "queued").length === 2);
check("install email names the customer job", /Job #12345678/.test(logs.find((l: any) => l.action === "installed")?.emailBody ?? ""));

const rec2 = await run("whReceive", { serialNumber: "B999000111", model: "M2", supplyHouse: "Webb", supplyHouseEmail: "orders@webb.example", warehouseLocationId: wh.id });
await run("whPull", { equipmentId: rec2.id, jobNumber: "555", toLocationId: truck.id });
const ret = await run("whReturn", { equipmentId: rec2.id, toLocationId: wh.id, reason: "Job cancelled" });
check("return ok", ret.ok);
s = await run("getState", {});
const u2 = s.equipment.find((e: any) => e.id === rec2.id);
check("returned unit back in stock, job cleared", u2.status === "available" && !u2.jobNumber && !u2.pulledAt && u2.currentLocationId === wh.id, u2);
check("WH stats: 1 in stock, 0 pulled", s.stats.whInStock === 1 && s.stats.whPulled === 0, s.stats);
check("installed unit drops out of consigned totals", !s.consignmentByOwner.some((o: any) => o.count > 1));

console.log("review fixes: races, guards, roles");
const r3 = await run("whReceive", { serialNumber: "RACE0001", model: "M3", supplyHouse: "Webb", supplyHouseEmail: "orders@webb.example", warehouseLocationId: wh.id });
const raced = await Promise.allSettled([run("whPull", { equipmentId: r3.id, jobNumber: "111" }), run("whPull", { equipmentId: r3.id, jobNumber: "222" })]);
check("two simultaneous pulls → exactly one wins", raced.filter((x) => x.status === "fulfilled").length === 1, raced.map((x) => x.status));
s = await run("getState", {});
check("race loser left no extra log rows", s.consignmentLogs.filter((l: any) => l.equipmentId === r3.id && l.action === "checkout").length === 1);
const doubleInstall = await Promise.allSettled([run("whInstall", { equipmentId: r3.id }), run("whInstall", { equipmentId: r3.id })]);
check("two simultaneous installs → exactly one wins", doubleInstall.filter((x) => x.status === "fulfilled").length === 1);
let guardErr = ""; try { await run("moveEquipment", { equipmentId: rec2.id, toLocationId: truck.id, action: "checkout" }); } catch (e) { guardErr = (e as Error).message; }
check("generic move refuses consigned water heaters", /Water heaters/.test(guardErr), guardErr);
let statusErr = ""; try { await run("updateEquipmentStatus", { id: rec.id, status: "available" }); } catch (e) { statusErr = (e as Error).message; }
check("status change refuses consigned water heaters", /Water heaters/.test(statusErr), statusErr);
const techCtx = { ...ctx, user: { ...ctx.user, role: "TECHNICIAN" as const } };
const ts = await (Actions.getState as any).handler(techCtx, {});
check("techs don't see costs or vendor emails", ts.parts.every((p: any) => p.avgCostCents === 0) && ts.partPrices.length === 0 && ts.equipment.every((e: any) => !e.consignmentEmail));
const whCtx = { ...ctx, user: { ...ctx.user, role: "WAREHOUSE" as const } };
const before2 = s.equipment.find((e: any) => e.id === rec2.id);
await (Actions.updateEquipment as any).handler(whCtx, (Actions.updateEquipment as any).request.parse({ id: rec2.id, name: before2.name, category: before2.category, serialNumber: before2.serialNumber, assetTag: "", brandModel: before2.brandModel, condition: "new", assignedTo: "", notes: "", consignmentEmail: "evil@example.com" }));
s = await run("getState", {});
check("warehouse role can't change who gets consignment emails", s.equipment.find((e: any) => e.id === rec2.id).consignmentEmail === "orders@webb.example");
const notFailed = s.consignmentLogs.find((l: any) => l.emailStatus === "queued");
const rq = await run("retryConsignmentEmail", { logId: notFailed.id });
check("retry refused while an email is still on its way", !rq.queued, rq);

console.log("email outbox");
let r = await flushOutbox(db);
check("mail off → queued emails left waiting", r.skipped === 6 && r.sent === 0, r);
envVals.RESEND_API_KEY = "re_test"; envVals.EMAIL_FROM = "Inventory <inv@example.com>";
const sentKeys: string[] = [];
const realFetch = globalThis.fetch;
(globalThis as any).fetch = async (_url: string, init: any) => { sentKeys.push(init.headers["Idempotency-Key"]); return new Response("{}", { status: sentKeys.length === 2 ? 422 : 200 }); };
const [a, b] = await Promise.all([flushOutbox(db), flushOutbox(db)]); // overlapping flushes
check("overlapping flushes never double-send", sentKeys.length === 6 && new Set(sentKeys).size === 6, sentKeys);
check("5 sent, 1 failed", a.sent + b.sent === 5 && a.failed + b.failed === 1, { a, b });
s = await run("getState", {});
const failed = s.consignmentLogs.find((l: any) => l.emailStatus === "failed");
check("failure recorded with error", failed && /Resend 422/.test(failed.emailLastError), failed);
const retry = await run("retryConsignmentEmail", { logId: failed.id });
check("retry re-queues", retry.queued);
r = await flushOutbox(db);
check("retry sends with a fresh idempotency key", r.sent === 1 && new Set(sentKeys).size === 7, sentKeys);
r = await flushOutbox(db);
check("nothing left to send", r.sent === 0 && r.failed === 0);
(globalThis as any).fetch = realFetch;

console.log("generic consigned equipment move still emails the owner");
const eq = await run("createEquipment", { name: "Rental jetter", isConsigned: true, consignmentOwner: "Acme Rentals", consignmentEmail: "a@acme.example", currentLocationId: wh.id });
await run("moveEquipment", { equipmentId: eq.id, toLocationId: truck.id, action: "checkout" });
s = await run("getState", {});
check("move queued an owner email", s.consignmentLogs.filter((l: any) => l.equipmentId === eq.id && l.emailStatus === "queued").length === 2);

// ---- Water heater CAGE (Blue Bear-owned stock, 2026-10-27 process) ----
console.log("water heater cage — hours rule");
const runAs = (c: Ctx, name: keyof typeof Actions, args: any) => (Actions[name] as any).handler(c, (Actions[name] as any).request.parse(args));
const businessHrs = new Date("2026-10-28T14:00:00Z"); // Wed 10:00 AM ET (EDT)
const nightHrs = new Date("2026-10-29T00:30:00Z");    // Wed 8:30 PM ET
whClock.now = () => businessHrs;
check("Wed 10:00 AM ET is business hours", !isAfterHours(businessHrs));
check("Wed 8:30 PM ET is after hours", isAfterHours(nightHrs));
check("Sat noon ET is after hours", isAfterHours(new Date("2026-10-31T16:00:00Z")));
check("Fri 4:30 PM ET is business hours (7–5)", !isAfterHours(new Date("2026-10-30T20:30:00Z")));
check("Mon 6:30 AM ET is after hours", isAfterHours(new Date("2026-10-26T10:30:00Z")));

console.log("cage receive, par board, FIFO");
const SIG = "A".repeat(400); // valid base64, long enough to count as a signature
const c1 = await run("whReceive", { serialNumber: "CAGE0001", model: "PROG50", brand: "Rheem", whType: "50g", poNumber: "PO-1001", warehouseLocationId: wh.id });
check("cage receive ok", c1.id > 0);
let cagePoErr = ""; try { await run("whReceive", { serialNumber: "CAGE0002", model: "PROG50", whType: "50g" }); } catch (e) { cagePoErr = (e as Error).message; }
check("cage receive requires a PO #", /PO #/.test(cagePoErr), cagePoErr);
let badTypeErr = ""; try { await run("whReceive", { serialNumber: "CAGE0002", model: "PROG50", whType: "60g", poNumber: "PO-X" }); } catch (e) { badTypeErr = (e as Error).message; }
check("unknown cage type rejected", /Unknown water heater type/.test(badTypeErr), badTypeErr);
const c2 = await run("whReceive", { serialNumber: "CAGE0002", model: "PROG50", whType: "50g", poNumber: "PO-1002", warehouseLocationId: wh.id });
s = await run("getState", {});
check("6 cage types seeded", s.whTypes.length === 6, s.whTypes.length);
const t50g = () => s.whTypes.find((t: any) => t.key === "50g");
check("par board: 2 × 50 gal Gas in cage, at par", t50g().inCage === 2 && !t50g().belowPar, t50g());
check("par board: the 5 empty types show below par", s.whTypes.filter((t: any) => t.belowPar).length === 5 && s.stats.whCageBelowPar === 5);
check("FIFO oldest is the first one received", t50g().oldestSerial === "CAGE0001");
check("cage units are not consigned", s.equipment.find((e: any) => e.id === c1.id).isConsigned === false);

console.log("sign-out: roles, FIFO, signature, reorder");
let fifoErr = ""; try { await runAs(whCtx, "whSignOut", { whType: "50g", equipmentId: c2.id, jobNumber: "777", techName: "Mike T", signaturePngBase64: SIG }); } catch (e) { fifoErr = (e as Error).message; }
check("newer unit without a reason is refused", /FIFO/.test(fifoErr) && /CAGE0001/.test(fifoErr), fifoErr);
let techErr = ""; try { await runAs(techCtx, "whSignOut", { whType: "50g", jobNumber: "777", techName: "Mike T", signaturePngBase64: SIG }); } catch (e) { techErr = (e as Error).message; }
check("TECHNICIAN refused during business hours", /Only the warehouse/.test(techErr), techErr);
const so1 = await runAs(whCtx, "whSignOut", { whType: "50g", jobNumber: "777", techName: "Mike T", signaturePngBase64: SIG });
check("warehouse sign-out picks the FIFO oldest", so1.ok && so1.serialNumber === "CAGE0001" && !so1.afterHours, so1);
s = await run("getState", {});
check("sign-out opened a reorder on the job", s.whReorders.some((r: any) => r.status === "open" && r.serialNumber === "CAGE0001" && r.jobNumber === "777"));
check("sign-out row has tech, releaser and signature", (() => { const r = s.whReorders.find((x: any) => x.serialNumber === "CAGE0001"); return r.techName === "Mike T" && r.releasedByName === "Test User" && r.signatureUrl.includes("wh-signatures/"); })(), s.whReorders[0]);
check("generic move refuses cage water heaters too", await run("moveEquipment", { equipmentId: c2.id, toLocationId: truck.id, action: "checkout" }).then(() => false, (e: Error) => /Water heaters/.test(e.message)));

console.log("receive fills the oldest open reorder; override; reorder flow");
const c3 = await run("whReceive", { serialNumber: "CAGE0003", model: "PROG50", whType: "50g", poNumber: "PO-1003", warehouseLocationId: wh.id });
check("receive says the reorder was filled", /filled/.test(c3.message), c3.message);
s = await run("getState", {});
check("receiving closed the oldest open reorder", s.whReorders.find((r: any) => r.serialNumber === "CAGE0001").status === "received");
const so3 = await runAs(whCtx, "whSignOut", { whType: "50g", equipmentId: c3.id, jobNumber: "778", techName: "Joe P", signaturePngBase64: SIG, fifoOverrideReason: "Oldest unit dented" });
check("FIFO override with a written reason works", so3.ok && so3.serialNumber === "CAGE0003");
s = await run("getState", {});
check("override reason stored on the sign-out", s.whReorders.find((r: any) => r.jobNumber === "778").fifoOverrideReason === "Oldest unit dented");
const open778 = s.whReorders.find((r: any) => r.jobNumber === "778");
let poErr = ""; try { await runAs(whCtx, "whReorderUpdate", { reorderId: open778.id, status: "ordered" }); } catch (e) { poErr = (e as Error).message; }
check("mark ordered requires a PO #", /PO #/.test(poErr), poErr);
await runAs(whCtx, "whReorderUpdate", { reorderId: open778.id, status: "ordered", poNumber: "PO-2000" });
await runAs(whCtx, "whReorderUpdate", { reorderId: open778.id, status: "received" });
s = await run("getState", {});
check("reorder ordered → received, PO kept", (() => { const r = s.whReorders.find((x: any) => x.id === open778.id); return r.status === "received" && r.poNumber === "PO-2000"; })());

console.log("return, race, par goes red");
await runAs(whCtx, "whSignOut", { whType: "50g", jobNumber: "779", techName: "Mike T", signaturePngBase64: SIG }); // takes CAGE0002
s = await run("getState", {});
check("par board red once the cage is empty of a type", t50g().inCage === 0 && t50g().belowPar, t50g());
await run("whReturn", { equipmentId: c2.id, toLocationId: wh.id, reason: "Job cancelled" });
s = await run("getState", {});
check("return put the unit back in the cage", t50g().inCage === 1 && t50g().oldestSerial === "CAGE0002");
check("return cancelled that job's open reorder", s.whReorders.find((r: any) => r.jobNumber === "779").status === "cancelled");
const race2 = await Promise.allSettled([
  runAs(whCtx, "whSignOut", { whType: "50g", jobNumber: "801", techName: "Al B", signaturePngBase64: SIG }),
  runAs(whCtx, "whSignOut", { whType: "50g", jobNumber: "802", techName: "Bo C", signaturePngBase64: SIG }),
]);
check("two iPads, one unit → exactly one sign-out wins", race2.filter((x) => x.status === "fulfilled").length === 1, race2.map((x) => x.status));
s = await run("getState", {});
check("race loser left no reorder behind", s.whReorders.filter((r: any) => (r.jobNumber === "801" || r.jobNumber === "802") && r.status === "open").length === 1);
await run("whReturn", { equipmentId: c2.id, toLocationId: wh.id, reason: "race test" });

console.log("Tuesday count");
const c4 = await run("whReceive", { serialNumber: "CAGE0404", model: "E40", whType: "40e", poNumber: "PO-3000", warehouseLocationId: wh.id });
const count = await runAs(whCtx, "whCountStart", {});
check("count expects the in-cage units", count.expected.length === 2, count.expected);
const scan1 = await runAs(whCtx, "whCountScan", { countId: count.countId, serial: "cage0404" });
check("scan matches (case-insensitive) with its type", scan1.result === "scanned" && scan1.whTypeLabel === "40 gal Electric", scan1);
const scanDup = await runAs(whCtx, "whCountScan", { countId: count.countId, serial: "CAGE0404" });
check("duplicate scan flagged, not double-counted", scanDup.result === "duplicate" && scanDup.scannedCount === 1, scanDup);
const scanBogus = await runAs(whCtx, "whCountScan", { countId: count.countId, serial: "GHOST999" });
check("unknown serial comes back unexpected", scanBogus.result === "unexpected");
const fin = await runAs(whCtx, "whCountFinish", { countId: count.countId });
check("count reports the missing serial", fin.missingSerials.length === 1 && fin.missingSerials[0] === "CAGE0002", fin);
check("count reports the unexpected serial", fin.unexpectedSerials.length === 1 && fin.unexpectedSerials[0] === "GHOST999", fin);
s = await run("getState", {});
check("count session stored with its lines", (() => { const c = s.whCounts[0]; return !!c.finished_at && c.missing === 1 && c.unexpected === 1 && c.scanned === 1 && c.missingSerials[0] === "CAGE0002"; })(), s.whCounts[0]);
let finErr = ""; try { await runAs(whCtx, "whCountFinish", { countId: count.countId }); } catch (e) { finErr = (e as Error).message; }
check("double finish refused", /already finished/.test(finErr), finErr);

console.log("after hours: tech allowed, ServiceTitan note mandatory");
whClock.now = () => nightHrs;
let stOffErr = ""; try { await runAs(techCtx, "whSignOut", { whType: "40e", jobNumber: "900", techName: "Night Tech", signaturePngBase64: SIG }); } catch (e) { stOffErr = (e as Error).message; }
check("after hours with ServiceTitan off is refused", /ServiceTitan is off/.test(stOffErr), stOffErr);
envVals.ST_CLIENT_ID = "id"; envVals.ST_CLIENT_SECRET = "sec"; envVals.ST_APP_KEY = "key"; envVals.ST_TENANT_ID = "t1";
const stNotes: string[] = [];
let failNotes = true;
const realFetch2 = globalThis.fetch;
(globalThis as any).fetch = async (url: any, init?: any) => {
  const u = String(url);
  if (u.includes("/connect/token")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 900 }), { status: 200 });
  if (u.includes("/jobs?number=")) { const num = decodeURIComponent(u.split("number=")[1]!.split("&")[0]!); return new Response(JSON.stringify({ data: [{ id: 9001, jobNumber: num, customerId: 77, locationId: 55 }] }), { status: 200 }); }
  if (u.includes("/customers/")) return new Response(JSON.stringify({ name: "Night Customer" }), { status: 200 });
  if (u.includes("/notes")) { if (failNotes) return new Response("boom", { status: 500 }); stNotes.push(JSON.parse(String(init?.body ?? "{}")).text); return new Response("{}", { status: 200 }); }
  return new Response("{}", { status: 200 });
};
let noteErr = ""; try { await runAs(techCtx, "whSignOut", { whType: "40e", jobNumber: "900", techName: "Night Tech", signaturePngBase64: SIG }); } catch (e) { noteErr = (e as Error).message; }
check("failed ST note fails the whole sign-out", /job note/.test(noteErr), noteErr);
s = await run("getState", {});
check("unit stayed in the cage after the failed note", s.whTypes.find((t: any) => t.key === "40e").inCage === 1);
check("no reorder left behind by the failed sign-out", !s.whReorders.some((r: any) => r.jobNumber === "900"));
failNotes = false;
const night = await runAs(techCtx, "whSignOut", { whType: "40e", jobNumber: "900", techName: "Night Tech", signaturePngBase64: SIG });
check("tech sign-out accepted after hours, flagged", night.ok && night.afterHours && night.serialNumber === "CAGE0404", night);
check("after-hours ST note posted on the job", stNotes.some((n) => /AFTER-HOURS/.test(n) && /CAGE0404/.test(n)), stNotes);
s = await run("getState", {});
check("after-hours flag stored on the sign-out row", s.whReorders.find((r: any) => r.jobNumber === "900").afterHours === true);
check("cage stats count the signed-out unit", s.stats.whCageSignedOut >= 1 && s.stats.whOpenReorders >= 1, s.stats.whCageSignedOut);

console.log("generic equipment sign-out posts a ServiceTitan job note");
const heater = await run("createEquipment", { name: "Space Heater 60k BTU", serialNumber: "SH-60-001", currentLocationId: wh.id });
const mv1 = await run("moveEquipment", { equipmentId: heater.id, toLocationId: truck.id, action: "checkout", jobRef: "Smith — ST #4242", performedBy: "Mike R." });
check("checkout with a job # posts the note", mv1.ok && /note added to ServiceTitan job #4242/.test(mv1.message), mv1.message);
check("note names the gear, serial and move", stNotes.some((n) => /SIGNED OUT to this job/.test(n) && /Space Heater 60k BTU/.test(n) && /SH-60-001/.test(n)), stNotes);
failNotes = true;
const mv2 = await run("moveEquipment", { equipmentId: heater.id, toLocationId: wh.id, action: "checkin", jobRef: "4242" });
check("failed ST note never blocks the move", mv2.ok && /note failed/.test(mv2.message) && /move still logged/.test(mv2.message), mv2.message);
failNotes = false;
const mv3 = await run("moveEquipment", { equipmentId: heater.id, toLocationId: truck.id, action: "transfer", jobRef: "shop use" });
check("no job # in the ref → no note attempted", mv3.ok && !/ServiceTitan/.test(mv3.message), mv3.message);
const notesBefore = stNotes.length;
await run("moveEquipment", { equipmentId: heater.id, toLocationId: null, action: "note", jobRef: "4242", notes: "filter cleaned" });
check("note-only entries never post to ST", stNotes.length === notesBefore);
(globalThis as any).fetch = realFetch2;
delete envVals.ST_CLIENT_ID; delete envVals.ST_CLIENT_SECRET; delete envVals.ST_APP_KEY; delete envVals.ST_TENANT_ID;
whClock.now = () => new Date();
void c4;

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
