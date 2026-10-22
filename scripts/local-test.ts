// Local end-to-end test of the server actions against an in-memory Postgres
// (PGlite) loaded with the real data from db-dump.sql. No network, no secrets.
//   bun scripts/local-test.ts
import { Actions } from "../server/src/actions.ts";
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
check("4122 orders", s.orders.length === 4122);
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

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
