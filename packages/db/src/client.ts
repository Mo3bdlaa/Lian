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

/**
 * How long a query may run before the server cancels it.
 *
 * ASSUMPTION, stated because it is a judgement rather than a measurement: 15
 * seconds. The slowest query in the measured baseline is memory retrieval at
 * ten thousand memories, at roughly 40ms (docs/PERFORMANCE.md), so this is
 * three hundred times the worst normal case — it can only fire on something
 * genuinely wedged. It is set on the SERVER (`statement_timeout`) rather than
 * with a client-side timer on purpose: a client that gives up leaves the
 * query running, holding its locks and its connection, which is how one slow
 * statement becomes an outage.
 */
const STATEMENT_TIMEOUT_MS = 15_000;

export function db(): pg.Pool {
  if (pool !== undefined) return pool;
  const made = new pg.Pool({
    connectionString: databaseUrl(),
    max: 10,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    // A connection nobody can get hold of is worse than a refusal: without
    // this, `connect()` waits forever when the pool is saturated and every
    // request piles up behind the one that is stuck.
    connectionTimeoutMillis: 10_000,
  });

  // THIS LISTENER IS NOT DECORATION — IT IS WHY THE PROCESS SURVIVES A
  // POSTGRES RESTART.
  //
  // node-postgres emits 'error' on the pool when an IDLE client's connection
  // dies: a database restart, a failover, a network blip, an idle timeout on
  // a managed instance. 'error' is EventEmitter's one special event — with no
  // listener it is THROWN, and an uncaught throw from a socket callback is
  // outside every try/catch in the product. So the whole server exits because
  // a connection nobody was using went away.
  //
  // The pool discards the broken client and hands out a fresh one by itself.
  // There is nothing to do here but refuse to die, which is exactly the point.
  made.on('error', (error: Error) => {
    logIdleError(error);
  });

  pool = made;
  return pool;
}

/** Where an idle-client error goes. Replaceable so a test can prove one was
 *  seen rather than inferring it from the process still being alive. */
let logIdleError: (error: Error) => void = (error) => {
  process.stderr.write(`[db] idle client error (the pool will replace it): ${error.message}\n`);
};

export function onIdleClientError(log: (error: Error) => void): void {
  logIdleError = log;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

/** Run a unit of work in one transaction. */
export async function transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const client = await db().connect();

  // THE POOL'S LISTENER DOES NOT COVER THIS CLIENT WHILE WE HOLD IT.
  //
  // pg forwards an idle client's socket error to the pool; a CHECKED-OUT
  // client emits 'error' on itself, and with nobody listening EventEmitter
  // throws it — from a socket callback, so it lands nowhere near the await
  // below. The whole process dies because a transaction's connection was
  // terminated, which is what a failover or a restart during a deploy does.
  //
  // The in-flight query rejects on its own and that rejection is the answer
  // the caller gets. This listener exists only so the SECOND notification of
  // the same death is not fatal.
  const swallow = (error: Error): void => { logIdleError(error); };
  client.on('error', swallow);

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // THE ROLLBACK GETS ITS OWN CATCH, and this is not defensiveness.
    //
    // The interesting failure is a connection that DIED mid-transaction — and
    // on a dead connection ROLLBACK is exactly the statement that also
    // fails. An unguarded `await client.query('ROLLBACK')` here rejects,
    // replaces `error`, and the caller is told the rollback failed instead of
    // being told what actually went wrong. The real cause never leaves this
    // function, in the one case where you most need it.
    //
    // A rollback that could not be sent is also not a leak: a broken
    // connection is destroyed rather than returned to the pool, and Postgres
    // rolls back an aborted session's transaction itself.
    try {
      await client.query('ROLLBACK');
    } catch {
      // Deliberately swallowed. `error` below is the answer.
    }
    throw error;
  } finally {
    client.off('error', swallow);
    client.release();
  }
}
