// Migrations, on their own.
//
//   npm run migrate
//
// The server migrates on boot and the test suite migrates on first use, so
// this exists for the one case where neither is what you want: CI, which
// needs the schema to be a STEP that can fail with its own name. Seventeen
// red runs presented as three hundred cancelled tests, and the actual cause
// was one CREATE EXTENSION failing on an image without pgvector.
import { migrate, closeDb } from '@lian/db';

if ((process.env['DATABASE_URL'] ?? '') === '') {
  console.error('DATABASE_URL is not set — there is nothing to migrate.');
  process.exit(1);
}

try {
  const applied = await migrate((line) => { console.log(line); });
  console.log(applied.length === 0 ? 'schema already up to date' : `applied ${applied.length} migration(s)`);
} catch (error) {
  console.error(`✗ migrate — ${(error as Error).message}`);
  process.exit(1);
} finally {
  await closeDb();
}
