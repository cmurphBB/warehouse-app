// ServiceTitan write-back for consigned water heaters.
// Secrets (Supabase > Edge Functions > Secrets, shared by every function in the project):
//   ST_CLIENT_ID, ST_CLIENT_SECRET, ST_APP_KEY, ST_TENANT_ID
//   ST_EQUIPMENT_ID  — pricebook equipment item used for "Water Heater – Consigned" (required by ST for installed equipment)
//   ST_ENV           — "integration" for the sandbox, anything else = production
import { runtimeEnv } from "./sdk.ts";

const env = (k: string) => runtimeEnv.get(k);

export const stLive = () => !!(env("ST_CLIENT_ID") && env("ST_CLIENT_SECRET") && env("ST_APP_KEY") && env("ST_TENANT_ID"));

const hosts = () =>
  env("ST_ENV") === "integration"
    ? { auth: "https://auth-integration.servicetitan.io", api: "https://api-integration.servicetitan.io" }
    : { auth: "https://auth.servicetitan.io", api: "https://api.servicetitan.io" };

let tokenCache: { token: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`${hosts().auth}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: env("ST_CLIENT_ID"), client_secret: env("ST_CLIENT_SECRET") }),
  });
  if (!res.ok) throw new Error(`ServiceTitan sign-in failed (${res.status}) — check the ST_* secrets`);
  const j: any = await res.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 900) * 1000 };
  return tokenCache.token;
}

async function st(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${hosts().api}/${path.replace("{tenant}", env("ST_TENANT_ID"))}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, "ST-App-Key": env("ST_APP_KEY"), "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ServiceTitan ${init.method ?? "GET"} ${path.split("?")[0]!.replace(/tenant\/[^/]+\//, "")} → ${res.status}: ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : {};
}

export type StJob = { jobId: number; customerId: number; locationId: number; customerName: string };

export async function stFindJob(jobNumber: string): Promise<StJob> {
  const num = jobNumber.trim();
  const r = await st(`jpm/v2/tenant/{tenant}/jobs?number=${encodeURIComponent(num)}&pageSize=5`);
  const job = (r.data ?? []).find((j: any) => String(j.jobNumber ?? j.number) === num);
  if (!job) throw new Error(`Job #${num} not found in ServiceTitan`);
  let customerName = "";
  try { const c = await st(`crm/v2/tenant/{tenant}/customers/${job.customerId}`); customerName = c.name ?? ""; } catch { /* nice-to-have */ }
  return { jobId: job.id, customerId: job.customerId, locationId: job.locationId, customerName };
}

export async function stJobNote(jobId: number, text: string): Promise<void> {
  await st(`jpm/v2/tenant/{tenant}/jobs/${jobId}/notes`, { method: "POST", body: JSON.stringify({ text }) });
}

export async function stCreateInstalledEquipment(u: { locationId: number; customerId: number; name: string; installedOn: string; manufacturer: string; model: string; serialNumber: string; memo: string }): Promise<{ id: number | null }> {
  const body: Record<string, unknown> = {
    locationId: u.locationId,
    customerId: u.customerId,
    name: u.name,
    installedOn: u.installedOn,
    manufacturer: u.manufacturer || undefined,
    model: u.model,
    serialNumber: u.serialNumber,
    memo: u.memo,
  };
  if (env("ST_EQUIPMENT_ID")) body.equipmentId = Number(env("ST_EQUIPMENT_ID"));
  const r = await st(`equipmentsystems/v2/tenant/{tenant}/installed-equipment`, { method: "POST", body: JSON.stringify(body) });
  return { id: typeof r.id === "number" ? r.id : null };
}

/** Finds an existing installed-equipment record with this serial at the customer location (retry safety). */
export async function stFindInstalledEquipmentBySerial(locationId: number, serialNumber: string): Promise<number | null> {
  const want = serialNumber.trim().toUpperCase();
  const r = await st(`equipmentsystems/v2/tenant/{tenant}/installed-equipment?locationIds=${locationId}&pageSize=500`);
  const hit = (r.data ?? []).find((x: any) => String(x.serialNumber ?? "").trim().toUpperCase() === want);
  return hit && typeof hit.id === "number" ? hit.id : null;
}
