// Consignment email sender (Resend). Replaces Muse's external Outlook dispatcher.
//
// The outbox design from the handoff is kept: every consignment move stores
// its exact subject + body on a consignment_logs row with status "queued".
// This module sends those rows. Duplicate-send guards:
//   1. Atomic claim — a row moves queued → sending in ONE conditional UPDATE,
//      so two overlapping flushes (cron + a user action) can never both send it.
//   2. Resend idempotency key per (row, queue generation) — if a send's outcome
//      was unclear and the claim went stale, the re-send is deduplicated by
//      Resend. A manual "retry" re-queues with a new emailQueuedAt, so a
//      genuinely failed email gets a fresh key.
//   3. A row already marked "sent" is never touched again.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (e.g. "Blue Bear Inventory <inventory@bluebearplumbing.com>")
// Optional: CONSIGN_CC — comma-separated office addresses copied on every consignment email.
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import * as schema from "./schema.ts";
import { runtimeEnv } from "./sdk.ts";

const t = schema.consignmentLogs;
const env = (k: string) => runtimeEnv.get(k);
const STALE_CLAIM_MS = 10 * 60 * 1000;

export const mailLive = () => !!(env("RESEND_API_KEY") && env("EMAIL_FROM"));

export async function flushOutbox(db: any, limit = 15): Promise<{ sent: number; failed: number; skipped: number }> {
  const out = { sent: 0, failed: 0, skipped: 0 };
  // A claim older than 10 minutes means the sender died mid-send: requeue it
  // (the idempotency key keeps a resend from duplicating a delivered email).
  await db.update(t).set({ emailStatus: "queued", emailClaimedAt: null })
    .where(and(eq(t.emailStatus, "sending"), lt(t.emailClaimedAt, new Date(Date.now() - STALE_CLAIM_MS))));

  const waiting: any[] = await db.select({ id: t.id }).from(t)
    .where(and(inArray(t.emailStatus, ["queued", "pending"]), ne(t.notifyEmail, "")))
    .orderBy(asc(t.createdAt)).limit(limit);
  if (waiting.length === 0) return out;
  if (!mailLive()) { out.skipped = waiting.length; return out; }

  const cc = env("CONSIGN_CC").split(",").map((s) => s.trim()).filter(Boolean);
  for (const w of waiting) {
    const [row] = await db.update(t)
      .set({ emailStatus: "sending", emailClaimedAt: new Date(), emailAttempts: sql`${t.emailAttempts} + 1` })
      .where(and(eq(t.id, w.id), inArray(t.emailStatus, ["queued", "pending"])))
      .returning();
    if (!row) continue; // another flush claimed it first
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env("RESEND_API_KEY")}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `bb-consign-${row.id}-${row.emailQueuedAt || "0"}`,
        },
        body: JSON.stringify({ from: env("EMAIL_FROM"), to: [row.notifyEmail], cc: cc.length ? cc : undefined, subject: row.emailSubject, text: row.emailBody }),
      });
      if (res.ok) {
        await db.update(t).set({ emailStatus: "sent", emailSentAt: new Date().toISOString(), emailQueuedAt: "", emailLastError: "", emailClaimedAt: null })
          .where(and(eq(t.id, row.id), eq(t.emailStatus, "sending")));
        out.sent++;
      } else {
        const detail = (await res.text()).slice(0, 500);
        await db.update(t).set({ emailStatus: "failed", emailLastError: `Resend ${res.status}: ${detail}`, emailClaimedAt: null })
          .where(and(eq(t.id, row.id), eq(t.emailStatus, "sending")));
        out.failed++;
      }
    } catch (e) {
      // Network error: outcome unknown. Leave it "sending" — the stale-claim
      // sweep requeues it in 10 minutes and the idempotency key dedupes.
      await db.update(t).set({ emailLastError: `Send outcome unknown (${String((e as Error).message ?? e).slice(0, 200)}) — will retry automatically` })
        .where(eq(t.id, row.id));
      out.failed++;
    }
  }
  return out;
}
