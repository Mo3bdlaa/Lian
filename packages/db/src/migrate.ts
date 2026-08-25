// Migration runner.  Plain .sql files applied in filename order, each in one
// transaction, recorded in schema_migrations.  No ORM: the schema is the
// product's most durable artefact and it should be readable without one.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from './client.ts';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url).pathname;

export async function migrate(log: (line: string) => void = console.log): Promise<string[]> {
  const pool = db();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`  applied ${file}`);
      ran.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return ran;
}
