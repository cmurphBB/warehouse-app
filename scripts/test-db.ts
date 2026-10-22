// Builds an in-memory Postgres (PGlite) with the real migration and the real
// data from db-dump.sql. Shared by local-test.ts and ui-check.ts.
import { PGlite } from "@electric-sql/pglite";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import * as schema from "../server/src/schema.ts";

export async function makeTestDb() {
  // 1. Schema (the real migration, minus Supabase-only bits)
  const pg = new PGlite();
  let ddl = readFileSync(new URL("../supabase/migrations/20261022161739_inventory_schema_v1.sql", import.meta.url), "utf8");
  ddl = ddl.replace(/revoke all on schema[^;]+;/, "")
    .replace(/encode\(gen_random_bytes\(24\), 'hex'\)/, "'test-token'")
    .replace(/do \$\$[\s\S]*?end \$\$;/, "")
    .replace(/insert into storage\.buckets[\s\S]*?do nothing;/, "");
  await pg.exec(ddl);

  // 2. Data (same conversion as the production import)
  const lite = new Database(":memory:");
  lite.exec(readFileSync(new URL("../db-dump.sql", import.meta.url), "utf8"));
  const TABLES = ["parts", "locations", "stock_levels", "orders", "order_lines", "tech_requests", "equipment", "equipment_logs"];
  for (const t of TABLES) {
    const rows = lite.query(`select * from "${t}"`).all() as Record<string, any>[];
    if (!rows.length) continue;
    const cols = Object.keys(rows[0]!);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const params: any[] = [];
      const values = chunk.map((r) => `(${cols.map((c) => { let v = r[c]; if ((c === "created_at" || c === "updated_at") && typeof v === "number") v = new Date(v).toISOString(); params.push(v); return `$${params.length}`; }).join(",")})`).join(",");
      await pg.query(`insert into inventory.${t} (${cols.join(",")}) values ${values}`, params);
    }
    await pg.query(`select setval(pg_get_serial_sequence('inventory.${t}','id'), (select max(id) from inventory.${t}))`);
  }
  const db = drizzle(pg, { schema });
  return db;
}
