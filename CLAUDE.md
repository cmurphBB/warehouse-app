# Working in this repo

This app was moved off Muse. Ignore any Muse/"space"/`@hatch` instructions in `HANDOFF.md` — they describe the old platform. See `README.md` for the current architecture.

- Server logic: `server/src/actions.ts` (defineAction contract in `server/src/sdk.ts`). Keep imports with explicit `.ts` extensions — the same files run in Deno (Supabase) and are type-checked by tsc.
- Runtime/auth/roles: `supabase/functions/inventory/index.ts`. New actions need a role decision there (`READ` / `TECH` / `OFFICE_ONLY`).
- Schema changes: add a SQL file in `supabase/migrations/` (schema `inventory`) and mirror it in `server/src/schema.ts`.
- Before pushing: `npm run typecheck && npm test`. For UI changes also `npm run build && bun scripts/ui-check.ts`.
- Deploy = push to `main` (Vercel builds client + deploys the function). Do not hand-deploy the function with retyped code.
- Data lives only in Supabase. `db-dump.sql` is the 2026-10-22 Muse snapshot, used by tests.
