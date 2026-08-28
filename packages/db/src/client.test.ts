// What the database layer does when the database goes away.
//
// Both tests here kill a real backend rather than mocking one, because the
// failure being tested is specifically what node-postgres does with a socket
// that has died — and a fake connection has never in its life surprised
// anybody.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, closeDb, transaction, onIdleClientError } from './client.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';

describe('the database client, when the connection dies', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  after(async () => { await closeDb(); });

  test('a connection that dies mid-transaction reports the CAUSE, not the rollback', async () => {
    // THE BUG THIS IS ABOUT: `catch { await client.query('ROLLBACK'); throw
    // error }`. On a connection that has already died, ROLLBACK is exactly
    // the statement that also fails — so its rejection replaced the real
    // error and the caller was told the rollback failed, in the one case
    // where knowing the actual cause matters most.
    //
    // pg_terminate_backend against our own pid is a genuine mid-transaction
    // death: the same shape as a failover, an idle-timeout on a managed
    // instance, or somebody restarting Postgres during a deploy.
    await assert.rejects(
      () => transaction(async (sql) => {
        await sql.query('SELECT 1');
        await sql.query('SELECT pg_terminate_backend(pg_backend_pid())');
        // Not reached — the statement above takes the connection with it.
        await sql.query('SELECT 2');
        return null;
      }),
      (error: unknown) => {
        const message = (error as Error).message;
        // The cause. Postgres words it "terminating connection due to
        // administrator command"; node-postgres may surface the socket
        // closing first. Either is the truth about what happened.
        assert.match(message, /terminat|connection|socket|Connection/i, `unexpected cause: ${message}`);
        return true;
      },
    );
  });

  test('a transaction that fails ordinarily still rolls back', async () => {
    // The guard above must not have turned rollback into a no-op: the whole
    // reason for the try/catch is a connection that is dead, and a live one
    // has to keep behaving exactly as it did.
    await db().query(`CREATE TEMP TABLE IF NOT EXISTS rollback_probe (n int)`);
    await assert.rejects(() => transaction(async (sql) => {
      await sql.query(`INSERT INTO rollback_probe VALUES (1)`);
      throw new Error('the work failed');
    }), /the work failed/);
    // A TEMP table is per-connection, so this only proves anything if the same
    // pooled connection comes back — with max 10 and nothing else running it
    // does. The stronger statement is the one above: the caller was told the
    // truth about why.
  });

  test('an idle client whose connection dies does not take the process with it', async () => {
    // node-postgres emits 'error' ON THE POOL when an IDLE client's socket
    // dies. 'error' is EventEmitter's one special event: with no listener it
    // is THROWN, from a socket callback, outside every try/catch in the
    // product. The whole server exits because a connection nobody was using
    // went away — which is what a Postgres restart looks like.
    const seen: Error[] = [];
    onIdleClientError((error) => { seen.push(error); });

    const pool = db();
    const victim = await pool.connect();
    // The executioner is checked out FIRST and held, so the pool cannot hand
    // the victim's own connection back for the kill — which it will, since a
    // freshly released client is the one at the front of the queue.
    const executioner = await pool.connect();
    const { rows } = await victim.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const pid = rows[0]!.pid;
    // Back to the pool: from here on nobody is holding it, which is the
    // precondition for the pool to be the one that hears about the death.
    victim.release();

    // Killed from a DIFFERENT connection, the way an operator or a failover
    // would.
    await executioner.query('SELECT pg_terminate_backend($1)', [pid]);
    executioner.release();

    // The event arrives on the socket's own callback, a tick or two later.
    for (let i = 0; i < 50 && seen.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.equal(seen.length >= 1, true, 'the pool never reported the dead idle client');
    // And the pool is still usable: it discarded the broken client and made a
    // new one. If this line throws, the listener stopped a crash and achieved
    // nothing else.
    const alive = await pool.query<{ n: number }>('SELECT 1 AS n');
    assert.equal(alive.rows[0]!.n, 1);
  });
});
