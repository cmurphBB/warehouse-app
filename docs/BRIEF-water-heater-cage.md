# Build brief: water heater cage (launch blocker)

**Owner:** Chris Murphy · **Written:** 2026-10-29 · **For:** Claude Code working in this repo (read `CLAUDE.md` + `README.md` first)

## Why

The app's water heater panel was built for *supply-house consignment* (vendor owns the unit, bills on pull, gets emailed). That is **not** Blue Bear's process. On 2026-10-27 Blue Bear rolled out a cage process for **its own stock**. Rework the panel to match it so the paper sign-out sheet can be retired.

## The real process (source of truth)

- 11 units live in a locked, chained cage at **par**: 2 × 40 gal electric · 2 × 40 gal gas · 2 × 50 gal electric · 2 × 50 gal gas · 1 × 50 gal power vent · 1 × State tankless 199k BTU.
- **Only the warehouse employee releases units.** Each sign-out records: serial (barcode sticker), model, tech, tech signature, job location / PO, and the releasing warehouse employee.
- **Inventory every Tuesday 7–9 AM.** Replenishment ordered the same day for delivery.
- A unit sent to a job is **reordered on that job's PO** (job costing).
- **First in, first out** — oldest unit of a type goes first.
- **After hours** is the only exception: a non-warehouse person may sign out (manager discloses the key). Same sign-out rules **plus a ServiceTitan job note**.

## Step 0 — get it running (before any feature work)

1. Run `supabase/migrations/20261022180000_profiles_block_self_role_escalation.sql` against project `sxyeasllycwzioskvswn` (closes "any user can make themselves ADMIN"). Verify a non-admin `update profiles set role='ADMIN'` now fails.
2. Deploy the function: `DRY_RUN=1 node scripts/deploy-functions.mjs`, then `cd .fn-stage && npx supabase functions deploy inventory --project-ref sxyeasllycwzioskvswn --use-api` with Chris's Supabase login (or set `SUPABASE_ACCESS_TOKEN` in Vercel so pushes deploy it).
3. Run the self-test: POST to the function with header `x-cron-token` (value in `inventory.app_config`) and body `{"action":"selftest"}` → expect `ok: true` and the real counts (631 parts, 651 equipment).
4. Chris sets `ST_CLIENT_ID`, `ST_CLIENT_SECRET`, `ST_APP_KEY`, `ST_TENANT_ID`, `ST_EQUIPMENT_ID` in Supabase secrets. Email (Resend) is **not** needed for launch.
5. Connect the Vercel project `blue-bear-inventory` to the GitHub repo so pushes to `main` deploy (currently deployments were created by API and are not git-linked).

## What to change

### Data (`supabase/migrations/` + `server/src/schema.ts`)
- `inventory.wh_types`: `key`, `label`, `fuel`, `gallons`, `par`, `sort`. Seed the 6 types above with their pars.
- On `inventory.equipment` for water heaters: `wh_type` (fk key), `received_at` (FIFO clock; default created_at), `po_number` (the PO it arrived on), `released_by` / `released_by_name`, `tech_name`, `signature_blob_key`, `after_hours` (bool), `fifo_override_reason`.
- `inventory.wh_reorders`: one row per sign-out → `wh_type`, `job_number`, `equipment_id`, `status` (`open` → `ordered` → `received`), `po_number`, timestamps, who.
- `inventory.wh_counts` + `wh_count_lines`: a Tuesday count session (who, started/finished) and each serial scanned / missing / unexpected.
- Water heaters become **Blue Bear-owned** (`is_consigned = 0`). Remove supply-house owner/email from the WH flow; no consignment emails for water heaters. Keep the generic consignment feature for other equipment untouched.

### Server (`server/src/actions.ts`, roles in `supabase/functions/inventory/index.ts`)
- `whReceive`: requires `whType`, serial, model, PO #. If it fills an open reorder of that type, mark that reorder `received`.
- `whSignOut` (replaces `whPull`):
  - Required: job # (verified in ServiceTitan as today), tech name, and signature image (PNG, stored in the `inventory-photos` bucket).
  - The releaser is the logged-in user. **Only WAREHOUSE / MANAGER / ADMIN may release**, except in after-hours mode.
  - **FIFO:** the server computes the oldest in-cage unit of the requested type. Picking a different serial requires `fifoOverrideReason`.
  - **After hours** (outside Mon–Fri 7:00–16:00 ET — confirm with Chris): any signed-in role may sign out, `after_hours = true`, and a ServiceTitan job note is **required**. If the note fails, the sign-out fails.
  - Creates the `wh_reorders` row (`open`, job #). Keep the conditional-update race guard.
- `whInstall` and `whReturn`: keep as-is (ServiceTitan installed-equipment write-back stays). Return also cancels that unit's open reorder.
- `whReorderUpdate`: mark reorders ordered (with PO #) / received. Office or warehouse role.
- `whCountStart` / `whCountScan` / `whCountFinish`: expected = units in the cage. Report missing and unexpected serials. Finishing stores the result.
- Retire the consignment email path for water heaters (no `insertConsignmentLog` emails). Still write `equipment_logs` for the audit trail.

### Screens (`client/src/WaterHeaters.tsx`)
- **Top:** par board — one tile per type showing *in cage / par*, red when below par, plus the oldest unit's age.
- **Buttons:** Sign out · Receive · Install · Return · **Tuesday count** (highlighted on Tuesdays).
- **Sign-out sheet:**
  1. Pick the type. The FIFO serial is preselected and can be scanned to confirm.
  2. Enter job # (look up the customer) and tech.
  3. Tech signs with a finger. Use a canvas signature pad, no new heavy dependencies.
  4. The releaser is shown from the login.
  5. After-hours banner when applicable.
- **Barcode scan** of the serial sticker: camera + `BarcodeDetector` where supported, with a lightweight zxing fallback for iPad Safari. Typing always works.
- **Reorders list:** open reorders grouped by type, with "Mark ordered (PO #)" and "Mark received".
- **Count screen:** scan serials one after another, with a live tally per type. Finish shows missing and unexpected.
- **Printable / CSV sign-out log** matching the paper sheet's columns (date, serial, model, tech, signature thumbnail, job/PO, released by, after-hours) for the warehouse wall and audits.

## Acceptance (add to `scripts/local-test.ts` and `scripts/ui-check.ts`)
- FIFO: with 2 units of the same type, sign-out picks the older one. Picking the newer one without a reason is refused.
- A TECHNICIAN sign-out is refused during business hours. After hours it is accepted, flagged, and requires the ServiceTitan note (mock the ServiceTitan call in tests).
- A sign-out creates an open reorder. Receiving the same type closes the oldest open reorder.
- The par board goes red when in-cage count < par.
- Tuesday count reports a missing serial and an unexpected serial correctly.
- Two iPads signing out the same unit → exactly one succeeds (existing race test pattern).
- All existing checks still pass. `npm run typecheck`, `npm test`, `npm run build && bun scripts/ui-check.ts` are clean.

## Out of scope for launch
- Supply-house emails (Resend).
- AI photo features: they need `ANTHROPIC_API_KEY`. Hide or leave them; don't block launch.
- The 7,098 "low stock" badge noise: the warehouse was never counted. Separate task: mark imported price-history POs `received` and do a first count.

## Open questions for Chris (ask before building the related piece)
1. What are after-hours exactly? Assumed outside Mon–Fri 7:00–16:00 ET.
2. Who are the "warehouse employees" who can release? Assumed every WAREHOUSE-role login.
3. Is the reorder placed on the **same** ServiceTitan job's PO in ServiceTitan? Should the app create that PO through the API, or only track it? Assumed track only.
4. Do any supply houses still do true consignment on water heaters? If not, delete the consignment-specific WH code instead of hiding it.

## Launch plan
Pilot one Tuesday count and one week of sign-outs in the app alongside the paper sheet. If they reconcile, retire the sheet.
