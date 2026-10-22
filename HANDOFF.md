> **Superseded 2026-10-22:** this app now runs on Supabase + Vercel — see README.md. This file is kept as the Muse handoff record.

# Blue Bear Inventory — Handoff for Claude

**What this is:** the complete source + data of the "Blue Bear Inventory" app (warehouse + truck inventory for Blue Bear Plumbing, Heating & Air, Norwell MA), built as a hosted fullstack web app ("ts-space") on the Muse platform. The owner (Chris Murphy) likes this UI better than the earlier warehouse app and wants this project re-hosted on GitHub/Vercel. A separate earlier repo exists at `cmurphBB/bluebear-warehouse` — do not overwrite or merge into it; this is its own project.

## Stack

- **Runtime/build:** Bun 1.3 (`packageManager: bun@1.3.10`), TypeScript 5.6
- **Client:** React 19, Tailwind CSS 4, TanStack Query, Recharts — `client/` (`src/App.tsx`, `src/api.ts`, `build.mjs`)
- **Server:** a single actions module — `server/src/actions.ts` — with the Drizzle schema in `server/src/schema.ts`
- **DB:** Drizzle ORM 0.45 + SQLite. Migrations in `drizzle/` (`0001`–`0009` + `meta/_journal.json`)
- **Platform layer (the one thing to replace):** `@hatch/space-sdk` is a `file:` dependency pointing at the Muse runtime. It provides action dispatch, single-user auth, and scheduled-job hooks. Everything else is stock open source.

## Data — read this first

- `db-dump.sql` is a **full dump of the production `app.db`** (SQLite). It recreates the database exactly: schema + every row. The binary `app.db` itself is not in this repo (the push channel is text-only); the owner has the binary.
- **Verified data state at handoff (2026-10-22):** 631 parts (619 priced), 5,701 order/price lines, 4,122 orders, 651 equipment units, 20 locations, 7,103 stock rows, 682 equipment-log rows, 3 consignment-log rows (all TEST fixtures — see Consignment).
- Warehouse on-hand quantities are **0 by design** — the warehouse was never physically counted; truck-template rows carry par levels as minimums. Pricing is fully loaded; counts are not.
- `seed-data/` holds the original source data the catalog was built from (master parts catalog CSV, vehicle roster CSV) plus `blue-bear-price-watchlist.csv` — the standing part↔vendor-SKU map used to flag price increases on future PO imports.
- Pricing rules baked into the data: multiple buys for a part → **simple average** unit price; pipe priced **per 10-ft stick**; consumables priced **per single unit** unless a note says otherwise (one exception: brazing rod is priced per 1-lb bundle, owner's ruling).
- Known data quirks: (1) part `410A`'s displayed average ($409.90) blends 5 historical R-454B lines misrouted by an old shared code — `454B` itself is correctly priced ($577.17); averages recompute from order lines, so there is no surgical fix. (2) 173 stock rows are inert zeroed rows (legacy cleanup artifacts; the app has no stock-row delete).

## App structure

Sections (bottom nav): Board (dashboard), Stock, Orders, Staging, Requests, Verify, Equip, Consign.
Key concepts: **Locations** = warehouse + 4 truck-type templates + 15 real vehicles (Plumbing ×5, HVAC Service ×6, HVAC Install ×3, Maintenance ×1); locations deliberately have **no delete** (removed after an accidental deletion; server action was removed too). **Stock** is finder-style drill-down location → department (9 warehouse departments) → shelf → parts, parts sorted by parsed numerical size. **Orders** includes a CSV PO import (`importpolines`) that matches by BB code/SKU then exact name, is idempotent, and maintains each part's avg/last cost. **Requests/Verify** use AI photo actions (see platform notes). **Equip** tracks serialized equipment per unit with a movement log.

### Actions (server API surface)

addentry, addorderline, addstagingline, adjuststock, analyzepartphoto, backfilldepartments, createequipment, createlocation, createorder, createpart, createstaging, createtechrequest, deleteequipment, deleteintakeverification, deleteorder, deletepart, deletestaging, deletetechrequest, dispatchconsignmentemails, getstate, importpolines, listentries, loadstagingtotruck, markconsignmentemailfailed, markconsignmentemailsent, moveequipment, recalcpricing, receiveorderline, retryconsignmentemail, setequipmentconsignment, setpartdepartment, togglestagingline, transferstock, transferstockbulk, updateequipment, updateequipmentstatus, updateorder, updateorderline, updatepart, updatestagingstatus, updatetechrequest, upsertstock, verifyintake

## Consignment (newest feature — read carefully)

- Scope: **equipment pieces only** (owner's decision). `setequipmentconsignment` marks a unit consigned with owner name, notify email, optional value (`consignmentValueCents`).
- Every move of a consigned unit (checkout/check-in/transfer/repair) auto-writes a `consignment_logs` row. Migration `0008` added the **outbox columns**: the app composes the notification at move time and stores `emailSubject`/`emailBody` on the row, with `emailAttempts`, `emailQueuedAt`, `emailLastError`.
- **The log is a permanent audit trail (migration `0009`):** log rows snapshot the piece's identity (name/serial/tag) when written. Deleting an equipment unit does **not** delete its history — the unit's consignment and movement entries are flagged `equipmentRemoved`, and a closing entry (action `removed`, email skipped) is appended. History is never deleted.
- **Email architecture — the app composes and queues ONLY; it never sends.** An earlier design spawned an in-app sender task; it died in production because each send waited on a human Outlook approval prompt ("Outlook send timed out awaiting approval"). That sender is removed (no `spawnTask` remains in `actions.ts`). Sending is done by an **external dispatcher**: it reads the queue via `dispatchconsignmentemails` (report-only — returns queued/failed-unsent entries with recipient, subject, body), sends each email **from the owner's Outlook (cmurphy@bluebearplumbing.com)**, and stamps the outcome back via `markconsignmentemailsent` (Sent + timestamp) or `markconsignmentemailfailed` (error text into `emailLastError`). Both callbacks refuse to modify an entry already marked Sent. `retryconsignmentemail` simply re-queues a failed entry for the dispatcher. In the current deployment the dispatcher is a scheduled agent job running every 15 minutes.
- **For Vercel:** map the dispatcher to Vercel Cron → an endpoint that reads the queue the same way, sends via Microsoft Graph sendMail on the owner's mailbox (or another mail API), and calls the same mark-sent / mark-failed callbacks. Guard against duplicate sends: process entries one at a time, re-check an entry's status immediately before sending, and if a send's outcome is unclear, verify Sent Items before retrying (an overlapped flush in production once produced duplicate copies). Keep the outbox design — it is what makes failures visible and retryable.
- **TEST fixtures in the data:** `consignment_logs` rows 3–5 (equipment id 713, owner `TEST`) are leftovers from the 2026-10-22 production end-to-end test of this flow — the piece itself was deleted (hence the `removed` row and `equipmentRemoved` flags, retained by design). Both notification emails were sent and stamped Sent by the external dispatcher. These 3 rows are safe to purge from `consignment_logs`; no real piece has ever been marked consigned (production starts clean).

## Known issues / planned work

1. **Consignment log retention — FIXED in this snapshot (migration `0009`).** Deleting an equipment unit no longer deletes its consignment or movement history: entries snapshot the piece's identity, are flagged `equipmentRemoved`, and a closing "removed" entry is appended (see Consignment). Nothing outstanding here.
2. **Single-user only:** the app runs under the owner's account; technicians cannot log in. Crew logins/roles + iPad rollout are future work (owner is aware; deliberate).
3. **AI photo actions** (`analyzepartphoto`, `verifyintake`) call the host platform's vision model. On Vercel, wire them to a vision API (Claude or other) with the same request/response shape.
4. `icon.webp` (app icon) is not in this repo (binary; push channel is text-only).

## Vercel migration notes

- Client is plain React + Vite-style build (`client/build.mjs`) — ports directly.
- Server actions assume Bun + the space SDK router; re-implement as API routes or server actions behind the same names/response shapes and the client needs almost no changes (`client/src/api.ts` is the single seam).
- SQLite on Vercel: use libsql/Turso or swap Drizzle to Postgres; keep `drizzle/` migrations as the schema source of truth.
- No `.env` or secrets exist in this project. Nothing in the repo is a credential.
