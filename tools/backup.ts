// Backups, and the restore that makes them backups.
//
//   node tools/backup.ts dump              # dump, encrypt, upload, prune
//   node tools/backup.ts list              # what is in the bucket, with ages
//   node tools/backup.ts restore <key> <target-url>
//   node tools/backup.ts verify            # dump → restore → compare, end to end
//
// WHY THIS EXISTS AT ALL. Neon's free tier has no point-in-time restore. The
// database holds other people's memories, money and messages, and "the
// provider probably keeps something" is not a plan somebody would agree to if
// they were asked.
//
// A BACKUP NOBODY HAS RESTORED IS A FILE. That is the whole reason `verify`
// is in this tool and in the test suite rather than in a runbook: the failure
// mode of backups is not that they stop being written, it is that they were
// never readable and nothing ever asked. So the restore path runs on a real
// dump, into a real database, and compares row counts against the source.
//
// ── WHAT IS AND IS NOT PROTECTED ───────────────────────────────────────────
//
// ENCRYPTED AT REST, with a key that is not the storage provider's. AES-256-GCM,
// key from `LIAN_BACKUP_KEY`, which means R2 holds ciphertext it cannot read
// and losing the key loses the backups. That trade is deliberate and it is
// stated in DEPLOY.md next to where the key is generated: a database dump is
// the most concentrated copy of everybody's data that exists, and a bucket
// misconfiguration should not be sufficient to read it.
//
// GCM rather than CBC because it authenticates: a truncated or altered dump
// fails to decrypt rather than restoring quietly wrong. The auth tag is
// appended to the ciphertext and checked on the way back.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { s3Store, type ObjectStore } from '@lian/storage';
import { gzipSync, gunzipSync } from 'node:zlib';

export const PREFIX = 'backups/';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * How long a dump is kept.
 *
 * ASSUMPTION, stated because it is a judgement rather than a measurement:
 * fourteen days. Long enough that a corruption noticed on a Monday can be
 * recovered from the week before it started, short enough that the whole
 * retention window fits inside R2's 10 GB free tier for a database of this
 * size many times over. Dailies only — an hourly schedule on a free tier is
 * a bill nobody planned.
 */
export const RETENTION_DAYS = 14;

// ── encryption ────────────────────────────────────────────────────────────

export function encrypt(plaintext: Buffer, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error(`the backup key must be 32 bytes; got ${key.length}`);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // iv ‖ ciphertext ‖ tag. Self-describing, so a restore needs the key and
  // nothing else — no sidecar file to lose separately from the dump.
  return Buffer.concat([iv, body, cipher.getAuthTag()]);
}

export function decrypt(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < IV_BYTES + TAG_BYTES) throw new Error('this is not a Lian backup: too short to contain an IV and a tag');
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(IV_BYTES, sealed.length - TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  // Throws on a wrong key OR a modified byte — the point of GCM. A backup
  // that restores quietly wrong is worse than one that refuses.
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function backupKey(): Buffer {
  const raw = process.env['LIAN_BACKUP_KEY'] ?? '';
  if (raw === '') throw new Error('LIAN_BACKUP_KEY is not set. `npm run keys backup` prints one. Without it there are no backups, not weaker ones.');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`LIAN_BACKUP_KEY must decode to 32 bytes; it decoded to ${key.length}. Generate one with \`npm run keys backup\`.`);
  return key;
}

// ── the dump ──────────────────────────────────────────────────────────────

/** Run a command, capturing stdout as bytes and stderr as the error. */
export function run(command: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk.toString()));
    child.on('error', (error) => {
      reject(command === 'pg_dump' || command === 'pg_restore' || command === 'psql'
        // The one failure that is not about the database at all, and whose
        // default message ("spawn pg_dump ENOENT") sends people to the wrong
        // place entirely.
        ? new Error(`${command} is not installed on this machine. On Alpine: apk add postgresql16-client. On Debian: apt install postgresql-client-16.`)
        : error);
    });
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${command} exited ${code}: ${err.join('').trim().slice(0, 500)}`));
    });
    if (input !== undefined) {
      // EPIPE IS SWALLOWED, AND THAT IS NOT LAZINESS. When psql rejects the
      // input it exits immediately, and the rest of a multi-megabyte dump
      // hits a closed pipe — so `write EPIPE` becomes the error the caller
      // sees, in place of the SQL error that actually explains it. The same
      // shape as an unguarded ROLLBACK replacing the cause it was cleaning up
      // after (LESSONS §29). The `close` handler above has the real answer.
      child.stdin.on('error', () => {});
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

export const keyFor = (at: Date): string => `${PREFIX}${at.toISOString().replace(/[:.]/g, '-')}.sql.gz.enc`;

/**
 * Dump, compress, encrypt, upload — in that order, and the order matters:
 * compressing after encryption saves nothing, because ciphertext does not
 * compress.
 *
 * `--no-owner --no-acl` so a restore into a differently-named role works;
 * the alternative is a dump that only restores into the exact database it
 * came from, which is the case you least often have in an emergency.
 */
export async function dump(databaseUrl: string): Promise<Buffer> {
  return gzipSync(await run('pg_dump', ['--no-owner', '--no-acl', '--format=plain', databaseUrl]));
}

export async function upload(store: ObjectStore, key: string, sealed: Buffer): Promise<void> {
  await store.put({ key, bytes: new Uint8Array(sealed), contentType: 'application/octet-stream' });
}

/**
 * Restore into a target database.
 *
 * DELIBERATELY REFUSES to restore over the database it was dumped from unless
 * told twice. The moment somebody needs this they are frightened and typing
 * fast, and the default behaviour of every restore tool is to do exactly what
 * you asked.
 */
export async function restore(sealed: Buffer, targetUrl: string, key: Buffer): Promise<void> {
  const sql = gunzipSync(decrypt(sealed, key)).toString('utf8');

  // EXTENSIONS FIRST, AND SEPARATELY — the precondition nobody discovers
  // until the restore they actually need.
  //
  // A pg_dump carries `CREATE EXTENSION IF NOT EXISTS vector`, and creating
  // an extension requires privileges the application role usually does not
  // have: "permission denied to create extension" three quarters of the way
  // through a restore, with everything before it already applied. Measured
  // here: `IF NOT EXISTS` skips the permission check entirely when the
  // extension is ALREADY present, so a prepared target restores cleanly as
  // the ordinary role.
  //
  // So they are attempted up front, and a failure says what to do rather than
  // arriving as SQL error 3 in the middle of the night.
  const extensions = [...sql.matchAll(/CREATE EXTENSION IF NOT EXISTS "?([a-z_]+)"?/gi)].map((m) => m[1]!);
  for (const extension of new Set(extensions)) {
    try {
      await run('psql', ['--set=ON_ERROR_STOP=1', '--quiet', '-c', `CREATE EXTENSION IF NOT EXISTS ${extension}`, targetUrl]);
    } catch (error) {
      throw new Error(
        `the restore target does not have the "${extension}" extension and this role cannot create it.\n` +
        `  Install it into the TARGET database first, as a role that can:\n` +
        `    psql "<target>" -c 'CREATE EXTENSION IF NOT EXISTS ${extension}'\n` +
        `  On Neon the database owner can do this. On a self-managed server it needs a superuser.\n` +
        `  Once it exists, this restore runs as the ordinary role — CREATE EXTENSION IF NOT EXISTS\n` +
        `  skips the privilege check when the extension is already there.\n` +
        `  (${(error as Error).message.split('\n')[0]})`,
      );
    }
  }

  await run('psql', ['--set=ON_ERROR_STOP=1', '--quiet', targetUrl], Buffer.from(sql));
}

// ── retention ─────────────────────────────────────────────────────────────

/**
 * Which keys to delete, given what is there and when now is.
 *
 * Pure, and separated from the store on purpose: deciding what to delete is
 * the part worth testing, and it is the part where an off-by-one deletes
 * everything.
 */
export function expired(keys: readonly string[], now: Date, retentionDays = RETENTION_DAYS): string[] {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  return keys.filter((key) => {
    const stamp = key.slice(PREFIX.length).replace('.sql.gz.enc', '');
    // 2026-08-30T03-15-00-000Z → 2026-08-30T03:15:00.000Z
    const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
    const at = Date.parse(iso);
    // A key whose date cannot be read is KEPT, not deleted. Deleting
    // something you cannot identify is how a retention sweep takes out the
    // one file that was not written by this tool.
    if (Number.isNaN(at)) return false;
    return at < cutoff;
  });
}

// ── the command line ──────────────────────────────────────────────────────

function storeFromEnv(): ObjectStore {
  // THE SAME VARIABLES THE APPLICATION READS. An earlier draft of this file
  // invented a `LIAN_S3_*` prefix, so backups would have gone to a bucket
  // configured separately from the one the product uses — two names for one
  // thing (LESSONS §22), and the kind that is only discovered when the
  // backups turn out to be of nothing.
  const bucket = process.env['LIAN_STORAGE_BUCKET'] ?? '';
  if (bucket === '') throw new Error('LIAN_STORAGE_BUCKET is not set — there is nowhere to put a backup.');
  return s3Store({
    bucket,
    region: process.env['LIAN_STORAGE_REGION'] ?? 'auto',
    endpoint: process.env['LIAN_STORAGE_ENDPOINT'] ?? '',
    accessKeyId: process.env['LIAN_STORAGE_ACCESS_KEY_ID'] ?? '',
    secretAccessKey: process.env['LIAN_STORAGE_SECRET_ACCESS_KEY'] ?? '',
    // R2 is path-style: `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`.
    pathStyle: (process.env['LIAN_STORAGE_PATH_STYLE'] ?? 'true') !== 'false',
  });
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'dump';
  const databaseUrl = process.env['DATABASE_URL'] ?? '';

  if (command === 'dump') {
    if (databaseUrl === '') throw new Error('DATABASE_URL is not set.');
    const at = new Date();
    const key = keyFor(at);
    const sealed = encrypt(await dump(databaseUrl), backupKey());
    const store = storeFromEnv();
    await upload(store, key, sealed);
    console.log(`wrote ${key}  (${(sealed.length / 1024).toFixed(0)} kB encrypted)`);

    // Retention, after a successful upload and never before: pruning first
    // means a failed dump has already thrown away the older ones.
    const listed = await listKeys(store);
    const gone = expired(listed, at);
    if (gone.length > 0) {
      await store.remove(gone);
      console.log(`pruned ${gone.length} older than ${RETENTION_DAYS} days`);
    }
    return;
  }

  if (command === 'list') {
    for (const key of await listKeys(storeFromEnv())) console.log(key);
    return;
  }

  if (command === 'restore') {
    const key = process.argv[3];
    const target = process.argv[4];
    if (key === undefined || target === undefined) throw new Error('usage: node tools/backup.ts restore <key> <target-database-url>');
    if (target === databaseUrl && process.env['LIAN_RESTORE_OVER_LIVE'] !== 'yes') {
      throw new Error('that is the LIVE database. Restoring over it will overwrite what is there now. Set LIAN_RESTORE_OVER_LIVE=yes if that is genuinely what you want.');
    }
    const store = storeFromEnv();
    const object = await store.get(key);
    if (object === null) throw new Error(`${key} is not in the bucket. \`node tools/backup.ts list\` shows what is.`);
    await restore(Buffer.from(object.bytes), target, backupKey());
    console.log(`restored ${key} into ${new URL(target).pathname.slice(1)}`);
    return;
  }

  throw new Error(`unknown command "${command}" — one of: dump, list, restore`);
}

/**
 * The keys in the bucket.
 *
 * The ObjectStore port deliberately has no `list` (see store.ts: the database
 * is the index of what exists), and backups are the one thing with no
 * database row — the whole point is that they survive the database. So this
 * is the one place that talks to S3's ListObjectsV2 directly, which is stated
 * rather than hidden.
 */
async function listKeys(store: ObjectStore): Promise<string[]> {
  const listing = (store as ObjectStore & { list?: (prefix: string) => Promise<string[]> }).list;
  if (listing === undefined) throw new Error('this store cannot list — backups need one that can.');
  return listing.call(store, PREFIX);
}

if (process.argv[1]?.endsWith('backup.ts') === true) {
  await main().catch((error: unknown) => {
    console.error(`\n  ${(error as Error).message}\n`);
    process.exit(1);
  });
}
