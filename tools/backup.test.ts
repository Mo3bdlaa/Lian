// Backups, tested by restoring them.
//
// A BACKUP NOBODY HAS RESTORED IS A FILE. The failure mode is not that dumps
// stop being written — it is that they were never readable and nothing ever
// asked, which is discovered on the one day it matters. So the test that
// carries the weight here is the round trip: dump a real database, encrypt it,
// put it in a store, take it back out, restore it into a DIFFERENT database,
// and compare what arrived against what was there.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { db, closeDb, migrate, accounts } from '@lian/db';
import { memoryStore } from '@lian/storage';
import { encrypt, decrypt, expired, keyFor, dump, restore, run, upload, PREFIX, RETENTION_DAYS } from './backup.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
const KEY = randomBytes(32);

describe('backup encryption and retention', () => {
  test('a dump round-trips through encryption', () => {
    const plain = Buffer.from('-- pg_dump output\nCREATE TABLE memories (id uuid);\n'.repeat(50));
    const sealed = encrypt(plain, KEY);
    assert.notEqual(sealed.toString('utf8'), plain.toString('utf8'), 'the ciphertext contains the plaintext');
    assert.deepEqual(decrypt(sealed, KEY), plain);
  });

  test('THE WRONG KEY FAILS, rather than producing rubbish', () => {
    const sealed = encrypt(Buffer.from('CREATE TABLE users (id uuid);'), KEY);
    assert.throws(() => decrypt(sealed, randomBytes(32)), /unable to authenticate|bad decrypt|Unsupported state/i);
  });

  test('A MODIFIED BACKUP FAILS — this is why it is GCM and not CBC', () => {
    // The failure worth paying for. A dump that decrypts to *something* after
    // a truncated upload or a flipped bit restores quietly wrong, and nobody
    // finds out until they compare it against a memory they still have.
    const sealed = encrypt(Buffer.from('CREATE TABLE money (id uuid);'), KEY);

    const flipped = Buffer.from(sealed);
    flipped[20] = flipped[20]! ^ 0x01;
    assert.throws(() => decrypt(flipped, KEY), /unable to authenticate/i, 'a flipped bit decrypted');

    const truncated = sealed.subarray(0, sealed.length - 4);
    assert.throws(() => decrypt(truncated, KEY), /unable to authenticate|too short/i, 'a truncated file decrypted');
  });

  test('a key of the wrong size is refused at the point of use', () => {
    assert.throws(() => encrypt(Buffer.from('x'), randomBytes(16)), /must be 32 bytes/);
  });

  test('retention deletes what is old and keeps what is not', () => {
    const now = new Date('2026-08-30T03:00:00.000Z');
    const at = (days: number): string => keyFor(new Date(now.getTime() - days * 86_400_000));

    const keys = [at(0), at(1), at(13), at(15), at(400)];
    const gone = expired(keys, now);

    assert.deepEqual(gone, [at(15), at(400)]);
    assert.ok(!gone.includes(at(13)), `${RETENTION_DAYS - 1} days old was deleted`);
  });

  test('A KEY IT CANNOT READ IS KEPT, not deleted', () => {
    // The direction that matters. A retention sweep that deletes anything it
    // cannot parse is a sweep that takes out the one file somebody put in the
    // bucket by hand — or every file, the day the naming changes.
    const now = new Date('2026-08-30T03:00:00.000Z');
    const strangers = [`${PREFIX}notes.txt`, `${PREFIX}manual-before-migration.sql.gz.enc`, `${PREFIX}`];
    assert.deepEqual(expired(strangers, now), []);
  });

  test('the boundary is asserted rather than assumed', () => {
    const now = new Date('2026-08-30T03:00:00.000Z');
    const exactly = keyFor(new Date(now.getTime() - RETENTION_DAYS * 86_400_000));
    const aMomentOlder = keyFor(new Date(now.getTime() - RETENTION_DAYS * 86_400_000 - 1_000));
    assert.deepEqual(expired([exactly], now), [], 'exactly at the retention edge was deleted');
    assert.deepEqual(expired([aMomentOlder], now), [aMomentOlder]);
  });
});

describe('the restore path, actually run', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  const created: string[] = [];
  let hasTools = true;

  before(async () => {
    await migrate(() => {});
    // pg_dump/psql are not in every environment, and a test that silently
    // passes because the tool was missing is the exact failure this file is
    // about. Detected once, reported as a skip.
    try { await run('pg_dump', ['--version']); } catch { hasTools = false; }
  });
  after(async () => {
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  test('DUMP → ENCRYPT → STORE → RESTORE → COMPARE, into a different database', async (t) => {
    if (!hasTools) { t.skip('pg_dump/psql are not installed here'); return; }

    // Something recognisable to look for on the other side.
    const user = await accounts.createUser({
      email: `backup-${Date.now()}@example.test`, passwordHash: 'x', timeZone: 'Asia/Dubai',
      consent: { isAdult: true, at: new Date(), version: 'test' },
    });
    created.push(user.id);
    await accounts.createAssistant({ userId: user.id }, { name: 'Lian', gender: 'female' });

    const source = process.env['DATABASE_URL']!;
    const sourceCounts = await counts(source);

    // The whole path, exactly as the cron runs it.
    const store = memoryStore();
    const key = keyFor(new Date());
    await upload(store, key, encrypt(await dump(source), KEY));

    // A DIFFERENT database, created for this and dropped after. Restoring
    // over the source would prove the dump was readable and nothing about
    // whether it CARRIES anything.
    const target = new URL(source);
    const restoredName = `lian_restore_probe_${process.pid}`;
    const admin = new URL(source);
    admin.pathname = '/postgres';
    await run('psql', ['--quiet', '-c', `DROP DATABASE IF EXISTS ${restoredName}`, admin.toString()]);
    await run('psql', ['--quiet', '-c', `CREATE DATABASE ${restoredName}`, admin.toString()]);
    target.pathname = `/${restoredName}`;
    // The target is PREPARED, the way an operator prepares one: pgvector
    // installed before the dump is applied. Without this the restore stops
    // three quarters of the way through on "permission denied to create
    // extension", which is the precondition restore() now names — and this
    // line is the test agreeing with that message rather than working around
    // it. Skipped when this role cannot, which is reported as a skip.
    try {
      await run('psql', ['--quiet', '-c', 'CREATE EXTENSION IF NOT EXISTS vector', target.toString()]);
    } catch {
      t.skip('this role cannot create the vector extension — the restore precondition cannot be met here');
      await run('psql', ['--quiet', '-c', `DROP DATABASE IF EXISTS ${restoredName}`, admin.toString()]).catch(() => {});
      return;
    }

    try {
      const object = await store.get(key);
      assert.ok(object !== null, 'the backup was not in the store');
      await restore(Buffer.from(object.bytes), target.toString(), KEY);

      // AND THE COMPARISON, which is the assertion that makes this a backup
      // test rather than a "the file exists" test.
      const restoredCounts = await counts(target.toString());
      assert.deepEqual(restoredCounts, sourceCounts, 'the restored database does not hold what the source did');
      assert.ok(sourceCounts['users']! > 0, 'the source was empty — this proved nothing');

      // The row itself, by value, not just by count.
      const found = await query(target.toString(), `SELECT email FROM users WHERE id = '${user.id}'`);
      assert.equal(found.trim(), user.email);

      // AND THE EXTENSION SURVIVED. pgvector is what memory retrieval needs;
      // a dump that restores every table and loses `vector` is a database
      // that comes back and then cannot answer a single turn.
      const extension = await query(target.toString(), `SELECT count(*) FROM pg_extension WHERE extname = 'vector'`);
      assert.equal(extension.trim(), '1', 'pgvector did not survive the restore');
    } finally {
      await run('psql', ['--quiet', '-c', `DROP DATABASE IF EXISTS ${restoredName}`, admin.toString()]).catch(() => {});
    }
  });
});

/** Row counts for the tables that carry somebody's data. */
async function counts(url: string): Promise<Record<string, number>> {
  const tables = ['users', 'assistants', 'conversations', 'messages', 'memories', 'tasks', 'transactions'];
  const out: Record<string, number> = {};
  for (const table of tables) {
    out[table] = Number.parseInt((await query(url, `SELECT count(*) FROM ${table}`)).trim(), 10);
  }
  return out;
}

async function query(url: string, sql: string): Promise<string> {
  return (await run('psql', ['--quiet', '--tuples-only', '--no-align', '-c', sql, url])).toString();
}

void db;
