// Runs in the Vercel build (production only): deploys the `inventory`
// Supabase Edge Function from this commit, so the server always ships with
// the client that matches it. Needs the SUPABASE_ACCESS_TOKEN env var in Vercel
// (a Supabase personal access token). Without it the step is skipped.
//
// The function imports the shared server code from ../../../server/src. The
// Supabase CLI expects everything under supabase/functions, so this stages a
// self-contained copy (imports rewritten) in a temp project and deploys that.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_REF = "sxyeasllycwzioskvswn";
const FN = "inventory";

if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
  console.log(`[deploy-functions] ${process.env.VERCEL_ENV} build — skipping Supabase deploy`);
  process.exit(0);
}
if (!process.env.SUPABASE_ACCESS_TOKEN && !process.env.DRY_RUN) {
  console.log("[deploy-functions] SUPABASE_ACCESS_TOKEN not set — skipping Supabase deploy");
  process.exit(0);
}

const root = process.cwd();
const stage = join(root, ".fn-stage");
rmSync(stage, { recursive: true, force: true });
const fnDir = join(stage, "supabase", "functions", FN);
mkdirSync(join(fnDir, "server"), { recursive: true });

for (const f of readdirSync(join(root, "server", "src"))) {
  if (f.endsWith(".ts")) cpSync(join(root, "server", "src", f), join(fnDir, "server", f));
}
const entry = readFileSync(join(root, "supabase", "functions", FN, "index.ts"), "utf8").replaceAll("../../../server/src/", "./server/");
writeFileSync(join(fnDir, "index.ts"), entry);
cpSync(join(root, "supabase", "functions", FN, "deno.json"), join(fnDir, "deno.json"));
writeFileSync(join(stage, "supabase", "config.toml"), `project_id = "${PROJECT_REF}"\n\n[functions.${FN}]\nverify_jwt = true\n`);

if (process.env.DRY_RUN) { console.log(`[deploy-functions] dry run — staged at ${stage}`); process.exit(0); }
console.log(`[deploy-functions] deploying ${FN} to ${PROJECT_REF}…`);
execFileSync("npx", ["--yes", "supabase@2", "functions", "deploy", FN, "--project-ref", PROJECT_REF, "--use-api"], { cwd: stage, stdio: "inherit", env: process.env });
rmSync(stage, { recursive: true, force: true });
console.log("[deploy-functions] done");
