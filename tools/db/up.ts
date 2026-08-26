// Bring the database up.
//
//   node tools/db/up.ts
//
// Creates the database if it does not exist, installs the extensions the
// schema needs, and runs the migrations. Idempotent: running it twice is a
// no-op, which is what makes it safe to put in front of every start.
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { migrate } from '@lian/db';

const url = process.env['DATABASE_URL'] ?? '';
if (url === '') {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(78);
}

const target = new URL(url);
const database = target.pathname.slice(1);

async function ensureDatabase(): Promise<void> {
  const admin = new URL(url);
  // Connect to the server's own catalogue rather than the database we are
  // about to create.
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (error) {
    console.error(`cannot reach Postgres at ${target.host}: ${(error as Error).message}`);
    console.error('Start one, or point DATABASE_URL at one that is running.');
    process.exit(69); // EX_UNAVAILABLE
  }
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (rows.length === 0) {
    // Identifiers cannot be parameterised; the name comes from our own URL.
    await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    console.log(`created database ${database}`);
  }
  await client.end();
}

await ensureDatabase();
await migrate((line) => { console.log(line); });
console.log(`database ready: ${target.host}/${database}`);

// A courtesy check rather than a requirement: psql is not needed to run the
// product, only to poke at it.
try {
  execFileSync('psql', ['--version'], { stdio: 'ignore' });
} catch {
  console.log('(psql is not installed — not required, but handy)');
}
process.exit(0);
