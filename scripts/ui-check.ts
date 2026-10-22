// Browser check of the built app at iPad size, with the Supabase function
// mocked by the real server actions running on an in-memory copy of the data.
//   npm run build && bun scripts/ui-check.ts   → screenshots in ./ui-shots/
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { Actions } from "../server/src/actions.ts";
import { flushOutbox } from "../server/src/mail.ts";
import { runtimeEnv, type Ctx } from "../server/src/sdk.ts";
import { makeTestDb } from "./test-db.ts";

runtimeEnv.get = () => "";
const db = await makeTestDb();
const role = (process.env.ROLE ?? "WAREHOUSE") as Ctx["user"]["role"];
const user = { id: "u1", email: "mike@bluebear.example", name: "Mike R.", role };
const ctx: Ctx = { db: () => db, invalidateQueries() {}, blobs: { async put() {}, async getUrl(k) { return k; } }, inference: { async complete() { throw new Error("AI off in test"); } }, mail: { flush: () => flushOutbox(db) }, user };

const server = Bun.serve({ port: 4317, async fetch(req) {
  const path = new URL(req.url).pathname;
  const file = Bun.file(`dist${path === "/" ? "/index.html" : path}`);
  return (await file.exists()) ? new Response(file) : new Response(Bun.file("dist/index.html"));
} });

mkdirSync("ui-shots", { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
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

// 3. Consign tab → water heaters
await page.getByRole("button", { name: /consign/i }).last().click();
await page.waitForSelector("text=Water heaters — consigned");
await page.screenshot({ path: "ui-shots/3-wh-empty.png" });

// 4. Receive
await page.getByRole("button", { name: /^Receive/ }).click();
await page.getByLabel("Serial #").fill("A1234567890");
await page.getByLabel("Model #").fill("XE50T10H45U0");
await page.getByLabel("Brand").fill("Rheem");
await page.getByLabel("Gallons").fill("50");
await page.getByLabel("Fuel").selectOption("Gas");
await page.getByLabel("Supply house", { exact: true }).fill("Webb");
await page.getByLabel(/Supply house email/).fill("orders@webb.example");
await page.screenshot({ path: "ui-shots/4-receive-form.png" });
await page.getByRole("button", { name: "Receive", exact: true }).click();
await page.waitForSelector("text=A1234567890");

// 5. Pull
await page.getByRole("button", { name: /^Pull/ }).first().click();
await page.getByLabel("Serial #").selectOption({ index: 1 });
await page.getByLabel("ServiceTitan job #").fill("12345678");
await page.getByLabel("Going on truck").selectOption({ index: 1 });
await page.screenshot({ path: "ui-shots/5-pull-form.png" });
await page.getByRole("button", { name: "Pull", exact: true }).click();
await page.getByRole("button", { name: "Pulled", exact: true }).click();
await page.waitForSelector("text=Job #12345678");
await page.screenshot({ path: "ui-shots/6-pulled-list.png" });

// 6. Install
await page.getByRole("button", { name: /^Install/ }).first().click();
await page.getByLabel("Serial #").selectOption({ index: 1 });
await page.getByRole("button", { name: "Install", exact: true }).click();
await page.getByRole("button", { name: "Installed", exact: true }).click();
await page.getByRole("button", { name: "History" }).first().click();
await page.waitForSelector("text=email queued");
await page.screenshot({ path: "ui-shots/7-installed-history.png", fullPage: false });

// 7. Error path: pull with nothing in stock
await page.getByRole("button", { name: /^Pull/ }).first().click();
await page.locator("option", { hasText: "No units in stock" }).waitFor({ state: "attached" });
await page.screenshot({ path: "ui-shots/8-pull-empty.png" });
await page.getByRole("button", { name: "Cancel" }).click();

// 8. Equipment tab still works
await page.getByRole("button", { name: /equip/i }).last().click();
await page.waitForTimeout(500);
await page.screenshot({ path: "ui-shots/9-equipment.png" });

console.log(errors.length ? `Page errors:\n${errors.join("\n")}` : "No page errors");
await browser.close();
server.stop();
