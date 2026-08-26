// LESSONS §11, as a passing test rather than a promise.
//
// "The product is sold on ownership. Anything that contradicts it in code
// contradicts it in fact."
//
// The deletion test does NOT check a list of tables. It reads
// information_schema, finds every table with a user_id or assistant_id
// column, and asserts zero rows for the deleted user in all of them. A list
// would be a list I could forget to update — and forgetting one is exactly
// how "delete everything" becomes false.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../client.ts';
import { HAS_DB, ready, freshUser, freshAssistant, done } from '../test-support.ts';
import * as accounts from './accounts.ts';
import * as memories from './memories.ts';
import * as canon from './canon.ts';
import * as conversations from './conversations.ts';
import * as life from './life.ts';
import * as profile from './profile.ts';
import * as reflections from './reflections.ts';
import * as push from './push.ts';
import * as auth from './auth.ts';
import * as limits from './limits.ts';

/** Every table in the schema that holds a row belonging to somebody. */
async function scopedTables(column: 'user_id' | 'assistant_id'): Promise<string[]> {
  const { rows } = await db().query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = $1
     ORDER BY table_name`,
    [column],
  );
  return rows.map((row) => row.table_name);
}

async function countFor(table: string, column: string, id: string): Promise<number> {
  const { rows } = await db().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM "${table}" WHERE ${column} = $1`,
    [id],
  );
  return rows[0]?.n ?? 0;
}

describe('§11 ownership', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  before(async () => { await ready(); });
  after(async () => { await done(); });

  /** A user with something in every corner of the schema. */
  async function populated() {
    const user = await freshUser('paid');
    const scope = await freshAssistant(user, 'Lian');
    const conversation = await conversations.createConversation(scope, { kind: 'main' });
    const message = await conversations.appendMessage(scope, { conversationId: conversation.id, role: 'user', body: 'I paid the gym 400.' });

    await memories.remember(scope, { type: 'fact', statement: 'They pay the gym monthly.', sourceMessageId: message.id }, 100);
    await canon.state(scope, { statement: 'You do not drink coffee.' });
    await reflections.record(scope, { kind: 'diary', body: 'A lighter day than the last few.', aboutDay: '2026-05-18' });
    await profile.upsert(user, 'about', 'I work in operations.');
    await life.createTask(user, { title: 'return the book', dueOn: '2026-05-19' });
    await life.createNote(user, { body: 'the lease renews in March' });
    await life.createTransaction(user, { direction: 'out', amountMinor: 40_000, currency: 'AED', occurredOn: '2026-05-18', category: 'gym' });
    await life.createHealthEntry(user, { kind: 'workout', description: 'strength training', occurredAt: new Date() });
    await push.save(user, { endpoint: `https://push.test/${user.userId}`, p256dh: 'x'.repeat(87), auth: 'y'.repeat(22) });
    await auth.upsertDevice(user, { fingerprint: 'fp-1', userAgent: 'Firefox' });
    await accounts.setUserName(user, 'Adam');

    return { user, scope };
  }

  test('export contains something from every corner, not just the easy ones', async () => {
    const { user, scope } = await populated();

    // Assembled the way the product does it, but asserted per source so a
    // silently empty slice cannot hide inside a large archive.
    assert.equal((await memories.list(scope, 'active')).length, 1);
    assert.equal((await canon.allIncludingMerged(scope)).length, 1);
    assert.equal((await reflections.allForExport(scope)).length, 1);
    assert.equal((await profile.list(user)).length, 1);
    assert.equal((await life.allTasks(user)).length, 1);
    assert.equal((await life.allNotes(user)).length, 1);
    assert.equal((await life.allTransactions(user)).length, 1);
    assert.equal((await life.allHealth(user)).length, 1);
    assert.equal((await conversations.listSearchable(scope)).length, 1);
    assert.equal((await auth.listDevices(user)).length, 1);
    assert.equal((await push.active(user)).length, 1);
    assert.equal((await accounts.getUser(user))!.email.length > 0, true);
  });

  test('canon in an export includes merged statements — she holds more than the active set', async () => {
    const { scope } = await populated();
    const first = (await canon.all(scope))[0]!;
    const second = await canon.state(scope, { statement: 'You keep early hours.' });
    await canon.compact(scope, [first.id, second.id], 'You keep early hours and do not drink coffee.');

    assert.equal((await canon.all(scope)).length, 1, 'one active statement');
    assert.equal((await canon.allIncludingMerged(scope)).length, 3, 'and three in the export');
  });

  test('deleting an account leaves NOTHING, in any table, checked generically', async () => {
    const { user, scope } = await populated();
    const userTables = await scopedTables('user_id');
    const assistantTables = await scopedTables('assistant_id');

    // Sanity: the fixture actually put rows somewhere, or the assertion below
    // would pass against an empty database and prove nothing.
    let before = 0;
    for (const table of userTables) before += await countFor(table, 'user_id', user.userId);
    for (const table of assistantTables) before += await countFor(table, 'assistant_id', scope.assistantId);
    assert.ok(before >= 10, `fixture should populate the schema; found ${before} rows`);

    await accounts.deleteAccount(user);

    for (const table of userTables) {
      assert.equal(await countFor(table, 'user_id', user.userId), 0, `${table} still holds rows for a deleted user`);
    }
    for (const table of assistantTables) {
      assert.equal(await countFor(table, 'assistant_id', scope.assistantId), 0, `${table} still holds rows for a deleted assistant`);
    }
    assert.equal(await accounts.getUser(user), null);
  });

  test('deletion is real: the rows are gone, not flagged', async () => {
    // LESSONS §11 says "deleting is real".  A deleted_at flag on the account
    // would satisfy every query in the app and none of the promise.
    const { user } = await populated();
    await accounts.deleteAccount(user);
    const { rows } = await db().query(`SELECT 1 FROM users WHERE id = $1`, [user.userId]);
    assert.equal(rows.length, 0);
  });

  test('§5 canon goes with the assistant, and only that way', async () => {
    const { user, scope } = await populated();
    // The trigger refuses a direct delete…
    await assert.rejects(() => db().query(`DELETE FROM canon WHERE assistant_id = $1`, [scope.assistantId]), /never deleted/);
    // …and the account cascade takes it anyway, which is the intended path.
    await accounts.deleteAccount(user);
    assert.equal(await countFor('canon', 'assistant_id', scope.assistantId), 0);
  });

  test("one user's deletion touches nobody else", async () => {
    const doomed = await populated();
    const survivor = await populated();
    await accounts.deleteAccount(doomed.user);

    assert.equal((await memories.list(survivor.scope, 'active')).length, 1);
    assert.equal((await life.allTasks(survivor.user)).length, 1);
    assert.ok(await accounts.getUser(survivor.user));
  });

  test('deletion takes the rate-limit buckets with it', async () => {
    // The one table the generic sweep cannot reach. A bucket key reading
    // `chat:<their uuid>` is still their identifier after they asked to be
    // forgotten (LESSONS §11).
    const user = await freshUser();
    await limits.takeToken(`chat:${user.userId}`, 60, 10, new Date());
    await limits.takeToken(`write:${user.userId}`, 60, 10, new Date());
    const before = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rate_limits WHERE bucket_key LIKE '%:' || $1`, [user.userId],
    );
    assert.equal(before.rows[0]!.n, 2);

    await accounts.deleteAccount(user);

    const after = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rate_limits WHERE bucket_key LIKE '%:' || $1`, [user.userId],
    );
    assert.equal(after.rows[0]!.n, 0);
  });

  test('every scoped table is reachable by the generic sweep', async () => {
    // If a future table has neither column, deletion would miss it and this
    // test would not notice — so the sweep's own coverage is asserted.
    const { rows } = await db().query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const all = rows.map((row) => row.table_name);
    const scoped = new Set([...(await scopedTables('user_id')), ...(await scopedTables('assistant_id'))]);
    // Tables that legitimately belong to nobody.  Each is a decision.
    const unscoped = new Set([
      'schema_migrations', // infrastructure
      'api_key_pool',      // provider state, no user in it
      'tts_cache',         // keyed by content hash, holds no user reference
      'events',            // user_id is nullable: pre-signup events are real
      'sign_in_attempts',  // an attempt on an unknown email has no user yet
      'users',             // the scope root itself
      // No foreign key to cascade from: swept explicitly by deleteAccount,
      // and the test below is what says so.
      'rate_limits',
    ]);
    const unaccounted = all.filter((table) => !scoped.has(table) && !unscoped.has(table));
    assert.deepEqual(unaccounted, [], 'a table in neither set would survive account deletion unnoticed');
  });
});
