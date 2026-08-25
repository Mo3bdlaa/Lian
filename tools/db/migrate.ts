import { migrate } from '../../packages/db/src/migrate.ts';
import { closeDb } from '../../packages/db/src/client.ts';
const ran = await migrate();
console.log(ran.length === 0 ? '  nothing to apply' : `  ${ran.length} migration(s) applied`);
await closeDb();
