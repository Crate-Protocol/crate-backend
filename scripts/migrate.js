import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "db", "migrations");

async function runMigrations() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const { rows } = await client.query("SELECT version FROM schema_migrations WHERE version = $1", [file]);
      if (rows.length > 0) {
        console.log(`[migrate] already applied: ${file}`);
        continue;
      }

      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[migrate] applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`[migrate] failed: ${file}`, err);
        process.exit(1);
      }
    }

    console.log("[migrate] all migrations applied.");
  } finally {
    await client.end();
  }
}

runMigrations();
