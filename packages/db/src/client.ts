// The database client.  Every query in the product goes through here, and
// every query in the product lives in this package (tools/gates/boundaries.ts
// enforces the second half).
import pg from 'pg';

// Money is bigint minor units; node-postgres hands bigint back as a string by
// default.  Parse int8 to number — safe to 2^53, which is 90 trillion fils.
pg.types.setTypeParser(20, (v: string) => Number(v));

export type Sql = { query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>> };

let pool: pg.Pool | undefined;

export function databaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url === '') {
    throw new Error('DATABASE_URL is not set. Required context is an error, not a default.');
  }
  return url;
}

export function db(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: databaseUrl(), max: 10 });
  return pool;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Run a unit of work in one transaction. */
export async function transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
