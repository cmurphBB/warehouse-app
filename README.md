# Blue Bear Inventory

Warehouse + truck inventory, equipment tracking, PO pricing, AI photo checks, and consignment (including consigned water heaters tied to ServiceTitan jobs) for Blue Bear Plumbing, Heating & Air.

Originally built on Muse (see `HANDOFF.md`); re-platformed to **Supabase + Vercel** on 2026-10-22.

## How it fits together

| Piece | Where | Notes |
| --- | --- | --- |
| Screens (React 19 + Tailwind 4) | `client/` → Vercel | iPad-first. Static build in `dist/`. |
| Server actions | `server/src/actions.ts` | Unchanged Muse business logic + water heater actions. |
| Server runtime | `supabase/functions/inventory/` → Supabase Edge Function | Auth + roles, Postgres (Drizzle), photo storage, Claude vision, email. |
| Database | Supabase project `blue-bear-warehouse`, schema `inventory` | SQL in `supabase/migrations/`. Tables are locked to the server (RLS on, no grants). |
| Email | `server/src/mail.ts` → Resend | Sent right after each consignment move + every 15 min (`pg_cron`). |
| ServiceTitan | `server/src/servicetitan.ts` | Job lookup, job notes, installed equipment on the customer. |

`client/src/api.ts` is the only seam between screens and server: `api.<actionName>(args)` → POST `{ action, args }` to the function with the user's login token.

## Deploys

Push to `main` → Vercel builds the client **and** (production only) deploys the Supabase function from the same commit (`scripts/deploy-functions.mjs`). That needs one Vercel env var:

- `SUPABASE_ACCESS_TOKEN` — Supabase → Account → Access Tokens. Without it, the client still deploys but the server is left as-is.

## Secrets (Supabase → Edge Functions → Secrets)

| Secret | For |
| --- | --- |
| `RESEND_API_KEY`, `EMAIL_FROM` | Consignment emails (`EMAIL_FROM` must be on a domain verified in Resend) |
| `CONSIGN_CC` (optional) | Office addresses copied on every consignment email, comma-separated |
| `ST_CLIENT_ID`, `ST_CLIENT_SECRET`, `ST_APP_KEY`, `ST_TENANT_ID` | ServiceTitan API |
| `ST_EQUIPMENT_ID` | Pricebook equipment item used for consigned water heaters on customer records |
| `ST_ENV` (optional) | `integration` to point at the ServiceTitan sandbox |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (optional) | AI photo ID + delivery verification |

Anything not set simply turns that feature off; the app shows "ServiceTitan off" / "Emails off".

## Logins and roles

Same accounts as the warehouse app (`public.profiles`). Roles: **Admin/Manager** everything · **Warehouse** day-to-day (no deletes or pricing admin) · **Technician** requests, photo ID, equipment moves, water heater pull/install/return · **View only** read. "Performed by" fields fill in from the login when left blank.

## Water heater consignment

Receive (no email) → **Pull** for a ServiceTitan job (job # required and verified; supply house emailed; bills from this date; ST job note) → **Install** (serial written to the customer's installed equipment in ST; supply house emailed) or **Return** (back to stock; ST note; supply house told to void). Units pulled 7+ days without install are flagged.

## Local checks

```bash
npm install
npm run typecheck          # client + server, strict
npm test                   # server actions on an in-memory Postgres loaded from db-dump.sql
npm run build && bun scripts/ui-check.ts   # iPad-size browser run, screenshots in ui-shots/
```
