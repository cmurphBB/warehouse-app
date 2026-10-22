// Blue Bear Inventory — server runtime (Supabase Edge Function).
// Replaces the Muse `@hatch/space-sdk` host: auth + roles, the action
// dispatcher, Postgres (Drizzle), photo storage, AI vision and email.
//
// Request: POST { action: "<name in server/src/actions.ts>", args: {...} }
//          with the signed-in user's Supabase JWT.
// Cron:    POST with header x-cron-token (value in inventory.app_config) → sends queued emails.
//
// Secrets (Supabase > Edge Functions > Secrets): see README.md.
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { Actions } from "../../../server/src/actions.ts";
import { flushOutbox } from "../../../server/src/mail.ts";
import * as schema from "../../../server/src/schema.ts";
import { runtimeEnv, z, type AppRole, type Ctx, type InferenceImage } from "../../../server/src/sdk.ts";

runtimeEnv.get = (k: string) => Deno.env.get(k) ?? "";
const env = runtimeEnv.get;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
// getState is ~4.5 MB of JSON for the full catalog + PO history; gzip it (~10x smaller) for iPads on cellular.
function jsonMaybeGzip(req: Request, body: unknown): Response {
  const text = JSON.stringify(body);
  if (text.length < 32_000 || !/\bgzip\b/.test(req.headers.get("Accept-Encoding") ?? "")) return json(body);
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream, { status: 200, headers: { ...cors, "Content-Type": "application/json", "Content-Encoding": "gzip", Vary: "Accept-Encoding" } });
}

const sqlClient = postgres(env("SUPABASE_DB_URL"), { prepare: false, max: 4, idle_timeout: 20 });
const db = drizzle(sqlClient, { schema });
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const BUCKET = "inventory-photos";

// ---------- permissions ----------
// VIEW_ONLY: read. TECHNICIAN: field actions. WAREHOUSE: day-to-day ops.
// MANAGER/ADMIN: everything, including deletes and pricing admin.
const READ = new Set(["getState", "listEntries", "stLookupJob"]);
const TECH = new Set(["createTechRequest", "analyzePartPhoto", "moveEquipment", "updateEquipmentStatus", "toggleStagingLine", "whPull", "whInstall", "whReturn", "whRetrySt"]);
const OFFICE_ONLY = new Set([
  "deletePart", "deleteOrder", "deleteStaging", "deleteTechRequest", "deleteEquipment", "deleteIntakeVerification",
  "recalcPricing", "backfillDepartments", "markConsignmentEmailSent", "markConsignmentEmailFailed", "createLocation",
  // Pricing and who-owns-what / who-gets-emailed are office decisions.
  "updateOrderLine", "importPoLines", "setEquipmentConsignment",
]);
function allowed(role: AppRole, action: string): boolean {
  if (role === "ADMIN" || role === "MANAGER") return true;
  if (READ.has(action)) return true;
  if (role === "VIEW_ONLY") return false;
  if (TECH.has(action)) return true;
  if (role === "TECHNICIAN") return false;
  return role === "WAREHOUSE" && !OFFICE_ONLY.has(action);
}
// Actions that can queue a consignment email → send right away.
const SENDS_MAIL = new Set(["createEquipment", "setEquipmentConsignment", "moveEquipment", "retryConsignmentEmail", "whPull", "whInstall", "whReturn"]);
// "Who did it" fields the old single-user app asked people to type: filled from the login when left blank.
const NAME_FIELDS = ["performedBy", "techName", "checkedBy"];

// ---------- AI vision (Claude) ----------
async function complete<S extends z.ZodTypeAny>(prompt: string, opts: { schema: S; images?: InferenceImage[] }): Promise<z.infer<S>> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) throw new Error("AI photo checks aren't set up yet — add ANTHROPIC_API_KEY in Supabase secrets");
  const inputSchema: any = z.toJSONSchema(opts.schema);
  delete inputSchema.$schema;
  const content: any[] = [];
  for (const img of opts.images ?? []) {
    if (img.caption) content.push({ type: "text", text: img.caption });
    content.push({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.dataBase64 } });
  }
  content.push({ type: "text", text: prompt });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: env("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
      max_tokens: 2048,
      tools: [{ name: "respond", description: "Return the structured answer.", input_schema: inputSchema }],
      tool_choice: { type: "tool", name: "respond" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const body: any = await res.json();
  const tool = (body.content ?? []).find((c: any) => c.type === "tool_use");
  if (!tool) throw new Error("AI returned no structured answer");
  return opts.schema.parse(tool.input);
}

function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------- deploy self-test (cron token only) ----------
// Loads the real state, then runs a full water-heater cycle inside a
// transaction that is always rolled back. Nothing is written or emailed.
async function selfTest() {
  const out: Record<string, unknown> = {};
  const rollback = new Error("selftest-rollback");
  try {
    await db.transaction(async (tx) => {
      const ctx: Ctx = {
        db: () => tx, invalidateQueries: () => {},
        blobs: { put: async () => {}, getUrl: async (k) => k },
        inference: { complete },
        mail: { flush: async () => ({ sent: 0, failed: 0, skipped: 0 }) },
        user: { id: "selftest", email: "", name: "Self test", role: "ADMIN" },
      };
      const run = (n: string, a: unknown) => (Actions as any)[n].handler(ctx, (Actions as any)[n].request.parse(a));
      const t0 = Date.now();
      const s = await run("getState", {});
      out.getStateMs = Date.now() - t0;
      out.counts = { parts: s.parts.length, pricedParts: s.stats.pricedParts, orders: s.orders.length, equipment: s.equipment.length, locations: s.locations.length };
      const wh = s.locations.find((l: any) => l.kind === "warehouse");
      const r = await run("whReceive", { serialNumber: "SELFTEST0001", model: "TEST50", supplyHouse: "Self test", supplyHouseEmail: "nobody@example.invalid", warehouseLocationId: wh?.id ?? null });
      await tx.update(schema.equipment).set({ pulledAt: new Date(), jobNumber: "0", status: "in_use" }).where(eq(schema.equipment.id, r.id));
      const i = await run("whInstall", { equipmentId: r.id });
      const after = await run("getState", {});
      const logs = after.consignmentLogs.filter((l: any) => l.equipmentId === r.id);
      out.waterHeater = { received: r.id > 0, installed: i.ok, logRows: logs.length, queuedEmails: logs.filter((l: any) => l.emailStatus === "queued").length };
      out.stLive = after.stats.stLive; out.mailLive = after.stats.mailLive;
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) return { ok: false, error: String((e as Error)?.message ?? e), partial: out };
  }
  return { ok: true, ...out };
}

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Scheduled email sweep (pg_cron → pg_net). Token lives in inventory.app_config.
  const cronToken = req.headers.get("x-cron-token");
  if (cronToken) {
    const [row] = await sqlClient`select value from inventory.app_config where key = 'cron_token'`;
    if (!row || !sameSecret(String(row.value), cronToken)) return json({ error: "forbidden" }, 403);
    const b = await req.json().catch(() => ({}));
    if (b?.action === "selftest") return json(await selfTest());
    return json({ ok: true, ...(await flushOutbox(db, 50)) });
  }

  // Who's calling?
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  if (!auth?.user) return json({ error: "Please sign in" }, 401);
  const { data: profile } = await admin.from("profiles").select("full_name, role, active").eq("id", auth.user.id).maybeSingle();
  if (!profile || profile.active === false) return json({ error: "Your account isn't active — ask the office to turn it on" }, 403);
  const user = { id: auth.user.id, email: auth.user.email ?? "", name: profile.full_name || auth.user.email || "", role: String(profile.role) as AppRole };

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const name = String(body?.action ?? "");
  if (name === "whoAmI") return json({ name: user.name, email: user.email, role: user.role });
  const action = (Actions as Record<string, any>)[name];
  if (!action) return json({ error: `Unknown action ${name}` }, 400);
  if (!allowed(user.role, name)) return json({ error: "Your role can't do that — ask a manager" }, 403);

  const raw = { ...(body.args ?? {}) };
  for (const f of NAME_FIELDS) if (f in action.request.shape && !String(raw[f] ?? "").trim()) raw[f] = user.name;
  const parsed = action.request.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return json({ error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input" }, 400);
  }

  const ctx: Ctx = {
    db: () => db,
    invalidateQueries: () => {},
    blobs: {
      async put(key, data, opts) {
        const { error } = await admin.storage.from(BUCKET).upload(key, new Uint8Array(data), { contentType: opts.contentType, upsert: true });
        if (error) throw error;
      },
      async getUrl(key) {
        const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(key, 60 * 60);
        if (error) throw error;
        return data.signedUrl;
      },
    },
    inference: { complete },
    mail: { flush: () => flushOutbox(db, 15) },
    user,
  };

  try {
    const result = await action.handler(ctx, parsed.data);
    if (SENDS_MAIL.has(name)) { try { await flushOutbox(db, 5); } catch { /* the cron sweep retries */ } }
    return jsonMaybeGzip(req, result ?? {});
  } catch (e) {
    console.error(name, e);
    return json({ error: String((e as Error)?.message ?? e) }, 400);
  }
});
