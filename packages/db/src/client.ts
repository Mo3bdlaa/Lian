// The database client.  Every query in the product goes through here, and
// every query in the product lives in this package (tools/gates/boundaries.ts
// enforces the second half).
import pg from 'pg';

// Money is bigint minor units; node-postgres hands bigint back as a string by
// default.  Parse int8 to number — safe to 2^53, which is 90 trillion fils.
pg.types.setTypeParser(20, (v: string) => Number(v));

export type Sql = { query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]): Promise<pg.QueryResult<R>> };

let pool: pg.Pool | undefined;
let configuredUrl: string | null = null;

/**
 * Tell this package which database to use, once, at boot.
 *
 * WHY THIS EXISTS. `Config` parses and validates `DATABASE_URL`, and this
 * package read `process.env` directly — two places holding one value, which
 * agree in production and can disagree anywhere else (LESSONS §22). It showed
 * up as a readiness probe reporting 200 against a deliberately broken URL: the
 * application had been configured with one database and the pool had already
 * opened another.
 *
 * `db()` still takes no arguments, because thirty repository functions call it
 * and threading a URL through all of them would be worse than the problem.
 * The composition root sets it; everything else asks.
 *
 * Setting it after a pool is open is refused rather than ignored: silently
 * keeping the old connection is how a process ends up talking to a database
 * nobody configured.
 */
export function configureDb(url: string): void {
  // Compared against the EFFECTIVE url, not against `configuredUrl`: a pool
  // opened from the environment before anybody configured anything is already
  // pointed at this database, and re-stating it is a no-op rather than a
  // conflict. Only a change of database is refused.
  if (pool !== undefined && databaseUrl() !== url) {
    throw new Error('configureDb() was called after the pool was opened — close it first, or configure before the first query.');
  }
  configuredUrl = url;
}

export function databaseUrl(): string {
  const url = configuredUrl ?? process.env['DATABASE_URL'];
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
 * ten thousand memories, at 74ms p95 84ms (docs/PERFORMANCE.md), so this is
 * roughly two hundred times the worst measured case — it can only fire on
 * something genuinely wedged. It is set on the SERVER (`statement_timeout`) rather than
 * with a client-side timer on purpose: a client that gives up leaves the
 * query running, holding its locks and its connection, which is how one slow
 * statement becomes an outage.
 */
const STATEMENT_TIMEOUT_MS = 15_000;

// ── surviving a database that was asleep ──────────────────────────────────
//
// Neon's free tier SUSPENDS an idle database. The first connection after that
// wakes it, and while it is waking, connection attempts fail or hang — which
// arrives in the product as an outage, indistinguishable from the database
// being gone.
//
// THE SAFETY RULE, and it is the whole design: only the ACQUISITION is
// retried, never a query. A failure to establish a connection proves no
// statement was executed, so trying again cannot repeat a write. A failure
// once a statement is in flight proves nothing of the kind — the insert may
// have committed and the acknowledgement been lost — so those are surfaced,
// and idempotency (not retries) is what makes them safe.
//
// This is the same rule as the model provider's retry (@lian/llm): retry only
// while nothing has happened yet.

/** Attempts to get a connection, including the first. */
const RESUME_ATTEMPTS = 4;
/**
 * ASSUMPTION, stated because it is a judgement: 250ms, doubling, so the four
 * attempts span roughly 250 + 500 + 1000 = 1.75s of waiting. Neon documents a
 * cold start of a few hundred milliseconds; this covers several times that
 * without turning a genuinely dead database into a four-second hang on every
 * request.
 */
const RESUME_BASE_DELAY_MS = 250;

/**
 * Is this the database being unreachable, as opposed to a statement failing?
 *
 * Deliberately a small allowlist of CONNECTION-PHASE conditions rather than a
 * catch-all. Anything not named here is surfaced, because the cost of
 * wrongly deciding "that was just a cold start" is retrying a write.
 */
export function isColdStart(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH') return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    // node-postgres' own words when connectionTimeoutMillis elapses.
    /timeout exceeded when trying to connect/i.test(message)
    // Neon's proxy, and pg, while an endpoint is waking.
    || /Connection terminated due to connection timeout/i.test(message)
    || /the database system is starting up/i.test(message)
    || /Connection terminated unexpectedly/i.test(message)
  );
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Acquire a connection, waiting out a database that is waking up.
 *
 * `connect` is passed in rather than reached for, so the retry can be tested
 * against a connector that fails a known number of times — which is the only
 * way to test this deterministically without a Neon endpoint to suspend.
 */
export async function connectWithResume<T>(
  connect: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; wait?: (ms: number) => Promise<void>; onRetry?: (attempt: number, error: unknown) => void } = {},
): Promise<T> {
  const attempts = options.attempts ?? RESUME_ATTEMPTS;
  const base = options.baseDelayMs ?? RESUME_BASE_DELAY_MS;
  const wait = options.wait ?? sleep;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      last = error;
      // NOT a cold start, or out of attempts: this is the answer.
      if (!isColdStart(error) || attempt === attempts) throw error;
      options.onRetry?.(attempt, error);
      await wait(base * 2 ** (attempt - 1));
    }
  }
  /* c8 ignore next -- the loop returns or throws */
  throw last;
}

/**
 * The pool, with acquisition that survives a suspended database.
 *
 * `query` is overridden rather than left alone: `pg.Pool#query` acquires and
 * queries in one call, so a cold start surfaces as a query failure with no
 * way to tell it apart from a statement that ran. Splitting them is what
 * makes the retry provably safe — see connectWithResume above.
 */
function withResume(made: pg.Pool): pg.Pool {
  const original = made.query.bind(made);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg.Pool#query has five overloads; this preserves all of them.
  (made as { query: unknown }).query = async function query(...args: unknown[]): Promise<unknown> {
    const client = await connectWithResume(
      () => made.connect(),
      { onRetry: (attempt, error) => logIdleError(new Error(`database asleep, attempt ${attempt}: ${(error as Error).message}`)) },
    );
    try {
      // ONE attempt. The connection is established, so a failure here may be
      // a statement that partly ran.
      return await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
    } finally {
      client.release();
    }
  } as typeof original;
  return made;
}

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

  pool = withResume(made);
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
  configuredUrl = null;
}

/** Run a unit of work in one transaction. */
export async function transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  // Acquisition retries; everything inside the transaction does not. A
  // transaction that dies halfway is rolled back by Postgres and re-running it
  // is the CALLER's decision, not this function's.
  const client = await connectWithResume(() => db().connect());

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
