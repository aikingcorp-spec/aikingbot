import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "../config/env.js";
import { createPool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl);
  try {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())"
    );
    const dir = join(here, "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await pool.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [file]);
      if (done.rowCount) continue;
      const sql = readFileSync(join(dir, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`applied ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
  } finally {
    await pool.end();
  }
}

// Allow `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations(loadConfig().databaseUrl).then(() => process.exit(0));
}
