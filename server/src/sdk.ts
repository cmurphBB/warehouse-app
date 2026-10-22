// Local replacement for the Muse `@hatch/space-sdk` server surface.
// Keeps the exact `defineAction({ request, response, handler })` contract so
// actions.ts ports with only import changes. The runtime that fills `ctx`
// lives in supabase/functions/inventory/index.ts.
import { z } from "zod";

export { z };

export type AppRole = "ADMIN" | "MANAGER" | "WAREHOUSE" | "TECHNICIAN" | "VIEW_ONLY";

export type InferenceImage = { dataBase64: string; mimeType: "image/jpeg" | "image/png"; caption?: string };

export interface Ctx {
  /** Drizzle (Postgres) database handle. Generic kept for source compatibility with the Muse SDK. */
  db<_TSchema = unknown>(): any;
  /** No-op on this platform: the client refetches after every mutation. */
  invalidateQueries(): void;
  blobs: {
    put(key: string, data: ArrayBuffer, opts: { contentType: string }): Promise<void>;
    getUrl(key: string): Promise<string>;
  };
  inference: {
    complete<S extends z.ZodTypeAny>(prompt: string, opts: { schema: S; images?: InferenceImage[] }): Promise<z.infer<S>>;
  };
  /** Sends any queued consignment emails right now (bounded). Returns a short report. */
  mail: { flush(): Promise<{ sent: number; failed: number; skipped: number }> };
  user: { id: string; email: string; name: string; role: AppRole };
}

/** Environment access, wired by the runtime (Deno.env in the edge function). */
export const runtimeEnv: { get(key: string): string } = { get: () => "" };

export type ActionDef<Req extends z.ZodTypeAny = z.ZodTypeAny, Res extends z.ZodTypeAny = z.ZodTypeAny> = {
  request: Req;
  response: Res;
  handler: (ctx: Ctx, args: z.output<Req>) => Promise<z.input<Res>>;
};

export function defineAction<Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(def: ActionDef<Req, Res>): ActionDef<Req, Res> {
  return def;
}

export type ActionsModule = Record<string, ActionDef<any, any>>;
