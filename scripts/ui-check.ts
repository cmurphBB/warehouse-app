// Browser check of the built app at iPad size, with the Supabase function
// mocked by the real server actions running on an in-memory copy of the data.
//   npm run build && bun scripts/ui-check.ts   → screenshots in ./ui-shots/
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { Actions, whClock } from "../server/src/actions.ts";
import { flushOutbox } from "../server/src/mail.ts";
import { runtimeEnv, type Ctx } from "../server/src/sdk.ts";
import { makeTestDb } from "./test-db.ts";

runtimeEnv.get = () => "";
whClock.now = () => new Date("2026-10-28T14:00:00Z"); // Wed 10 AM ET: business hours, so the cage flow is deterministic
const db = await makeTestDb();
const role = (process.env.ROLE ?? "WAREHOUSE") as Ctx["user"]["role"];
const user = { id: "u1", email: "mike@bluebear.example", name: "Mike R.", role };
const blobs = new Map<string, ArrayBuffer>();
const ctx: Ctx = { db: () => db, invalidateQueries() {}, blobs: { async put(k, d) { blobs.set(k, d); }, async getUrl(k) { return `http://localhost:4317/blob/${k}`; } }, inference: { async complete() { throw new Error("AI off in test"); } }, mail: { flush: () => flushOutbox(db) }, user };

const server = Bun.serve({ port: 4317, async fetch(req) {
  const path = new URL(req.url).pathname;
  if (path.startsWith("/blob/")) {
    const b = blobs.get(path.slice("/blob/".length));
    return b ? new Response(b, { headers: { "Content-Type": "image/png" } }) : new Response("", { status: 404 });
  }
  const file = Bun.file(`dist${path === "/" ? "/index.html" : path}`);
  return (await file.exists()) ? new Response(file) : new Response(Bun.file("dist/index.html"));
} });

mkdirSync("ui-shots", { recursive: true });
const linuxChrome = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch(existsSync(linuxChrome) ? { executablePath: linuxChrome } : {});
const page = await browser.newPage({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.route("https://sxyeasllycwzioskvswn.supabase.co/functions/v1/inventory", async (route) => {
  const { action, args } = route.request().postDataJSON();
  try {
    if (action === "whoAmI") return route.fulfill({ json: { name: user.name, email: user.email, role: user.role } });
    const a = (Actions as any)[action];
    const raw = { ...args };
    for (const f of ["performedBy", "techName", "checkedBy"]) if (f in a.request.shape && !String(raw[f] ?? "").trim()) raw[f] = user.name;
    const r = await a.handler(ctx, a.request.parse(raw));
    return route.fulfill({ json: r });
  } catch (e) { return route.fulfill({ status: 400, json: { error: String((e as Error).message ?? e) } }); }
});
await page.route("https://sxyeasllycwzioskvswn.supabase.co/auth/**", (route) => route.fulfill({ json: {} }));
await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ body: "" }));

// 1. Login screen
await page.goto("http://localhost:4317/");
await page.waitForSelector("text=Sign in with your Blue Bear warehouse login");
await page.screenshot({ path: "ui-shots/1-login.png" });

// 2. Signed in (stored session)
const session = { access_token: "test", refresh_token: "test", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated" } };
await page.evaluate((s) => localStorage.setItem("sb-sxyeasllycwzioskvswn-auth-token", JSON.stringify(s)), session);
await page.reload();
await page.waitForSelector("text=units on hand", { timeout: 30000 });
await page.screenshot({ path: "ui-shots/2-board.png" });

// 3. Consign tab → water heaters: par board, all types below par
await page.getByRole("button", { name: /consign/i }).last().click();
await page.waitForSelector("text=🔥 Water heaters");
await page.waitForSelector('[data-testid="par-board"]');
await page.waitForSelector("text=50 gal Gas");
await page.screenshot({ path: "ui-shots/3-wh-par-empty.png" });

// 4. Receive a CAGE unit (type + serial + model + PO)
await page.getByRole("button", { name: /^Receive Into the cage/ }).click();
await page.getByRole("button", { name: /^50 gal Gas/ }).click();
await page.getByLabel("Serial #").fill("CAGE50G001");
await page.getByLabel("Model #").fill("RG250T6N");
await page.getByLabel("Brand").fill("Rheem");
await page.getByLabel(/Arrived on PO #/).fill("PO-7001");
await page.screenshot({ path: "ui-shots/4-receive-cage.png" });
await page.getByRole("button", { name: "Receive", exact: true }).click();
await page.waitForSelector("text=CAGE50G001");

// 5. Sign out: FIFO serial preselected, job + tech + finger signature
await page.getByRole("button", { name: /^Sign out/ }).last().click();
await page.getByRole("button", { name: /^50 gal Gas/ }).click();
await page.waitForSelector("text=FIFO — take this one");
await page.getByLabel("ServiceTitan job #").fill("12345678");
await page.getByLabel("Tech taking it").fill("Mike R.");
const pad = page.locator('[data-testid="signature-pad"]');
const box = (await pad.boundingBox())!;
await page.mouse.move(box.x + 30, box.y + 80);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + 40, { steps: 8 });
await page.mouse.move(box.x + 220, box.y + 110, { steps: 8 });
await page.mouse.up();
await page.screenshot({ path: "ui-shots/5-signout-form.png" });
await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
await page.waitForSelector("text=1 waiting"); // reorders badge
await page.screenshot({ path: "ui-shots/6-signed-out.png" });

// 6. Reorder: mark ordered with a PO, then received
await page.getByPlaceholder("PO #").fill("PO-8002");
await page.getByRole("button", { name: "Mark ordered" }).click();
await page.waitForSelector("text=on PO PO-8002");
await page.getByRole("button", { name: "Mark received" }).click();
await page.waitForSelector("text=Nothing waiting — every sign-out has been reordered and received.");

// 7. Sign-out log shows the entry with its signature
await page.getByRole("button", { name: /Sign-out log \(/ }).click();
await page.waitForSelector("text=📝 Sign-out log");
await page.waitForSelector('img[alt="signature"]');
await page.screenshot({ path: "ui-shots/7-signout-log.png" });

// 8. Receive a CONSIGNED unit (old flow still works) and pull it
await page.getByRole("button", { name: /^Receive Into the cage/ }).click();
await page.getByText("This unit is consigned (supply-house owned)").click();
await page.getByLabel("Serial #").fill("WEBB000111");
await page.getByLabel("Model #").fill("XE50T10");
await page.getByLabel("Supply house", { exact: true }).fill("Webb");
await page.getByLabel(/Supply house email/).fill("orders@webb.example");
await page.getByRole("button", { name: "Receive", exact: true }).click();
await page.waitForSelector("text=WEBB000111");
await page.getByRole("button", { name: /^Consigned \(/ }).click();
await page.waitForSelector("text=🤝 Webb");
await page.getByRole("button", { name: "Pull", exact: true }).first().click();
await page.waitForSelector("text=Pull a consigned unit");
await page.getByLabel("ServiceTitan job #").fill("555001");
await page.screenshot({ path: "ui-shots/8-pull-consigned.png" });
await page.getByRole("button", { name: "Pull", exact: true }).last().click();
await page.getByRole("button", { name: /^Signed out \(/ }).click();
await page.waitForSelector("text=Job #555001");

// 9. Tuesday count: receive another cage unit, scan it, finish clean
await page.getByRole("button", { name: /^Receive Into the cage/ }).click();
await page.getByRole("button", { name: /^40 gal Electric/ }).click();
await page.getByLabel("Serial #").fill("CAGE40E001");
await page.getByLabel("Model #").fill("E40H");
await page.getByLabel(/Arrived on PO #/).fill("PO-7002");
await page.getByRole("button", { name: "Receive", exact: true }).click();
await page.waitForSelector("text=CAGE40E001");
await page.getByRole("button", { name: /Tuesday count/ }).click();
await page.waitForSelector("text=🗒 Tuesday cage count");
await page.getByLabel(/Scan or type a serial/).fill("CAGE40E001");
await page.getByRole("button", { name: "Add", exact: true }).click();
await page.waitForSelector("text=✓ CAGE40E001");
await page.screenshot({ path: "ui-shots/9-count.png" });
await page.getByRole("button", { name: "Finish count" }).click();
await page.waitForSelector("text=Count clean");
await page.getByRole("button", { name: "Done", exact: true }).click();

// 10. Equipment tab still works
await page.getByRole("button", { name: /equip/i }).last().click();
await page.waitForTimeout(500);
await page.screenshot({ path: "ui-shots/10-equipment.png" });

console.log(errors.length ? `Page errors:\n${errors.join("\n")}` : "No page errors");
await browser.close();
server.stop();
process.exit(errors.length ? 1 : 0);
