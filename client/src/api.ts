// Typed RPC client. Types come straight from `server/src/actions.ts` — no
// codegen. Each call POSTs `{ action, args }` to the `inventory` Supabase
// function with the signed-in user's token and returns the typed response.
//
// `import type` keeps every server runtime import out of the browser bundle.
import type { z } from "zod";
import type { Actions } from "../../server/src/actions";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from "./supabase";

type A = typeof Actions;
type Client = { [K in keyof A]: (args: z.input<A[K]["request"]>) => Promise<z.output<A[K]["response"]>> };

export type ApiRequest<_C, K extends keyof A> = z.input<A[K]["request"]>;
export type ApiResponse<_C, K extends keyof A> = z.output<A[K]["response"]>;

export async function callAction<T = unknown>(action: string, args: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/inventory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
    body: JSON.stringify({ action, args }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) await supabase.auth.signOut();
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = new Proxy({} as Client, {
  get: (_t, name: string) => (args: unknown) => callAction(name, args ?? {}),
});

/** Replaces the Muse SDK helper: File/Blob → base64 (no data: prefix). */
export async function fileToBase64(file: Blob): Promise<{ dataBase64: string; mimeType: string }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { dataBase64: btoa(bin), mimeType: file.type || "application/octet-stream" };
}
