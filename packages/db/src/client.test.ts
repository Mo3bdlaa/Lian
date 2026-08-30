// What the database layer does when the database goes away.
//
// Both tests here kill a real backend rather than mocking one, because the
// failure being tested is specifically what node-postgres does with a socket
// that has died — and a fake connection has never in its life surprised
// anybody.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, closeDb, transaction, onIdleClientError, connectWithResume, isColdStart, configureDb } from './client.ts';

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

describe('a database that was asleep', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  after(async () => { await closeDb(); });

  // ── the decision, deterministically ─────────────────────────────────────

  test('only CONNECTION-phase failures are treated as a cold start', () => {
    // THE SAFETY RULE. Retrying an acquisition is safe because no statement
    // ran; retrying a query is not, because the insert may have committed and
    // only the acknowledgement been lost. So this predicate is an allowlist,
    // and anything it does not recognise is surfaced.
    for (const cold of [
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('getaddrinfo ENOTFOUND ep-x.neon.tech'), { code: 'ENOTFOUND' }),
      new Error('timeout exceeded when trying to connect'),
      new Error('Connection terminated due to connection timeout'),
      new Error('the database system is starting up'),
    ]) assert.equal(isColdStart(cold), true, `not recognised: ${cold.message}`);

    for (const notCold of [
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      new Error('syntax error at or near "SELCT"'),
      new Error('canceling statement due to statement timeout'),
      Object.assign(new Error('permission denied for table memories'), { code: '42501' }),
    ]) assert.equal(isColdStart(notCold), false, `wrongly treated as a cold start: ${notCold.message}`);
  });

  test('it waits out a database that is waking, and gives up on one that is gone', async () => {
    const waits: number[] = [];
    const wait = async (ms: number): Promise<void> => { waits.push(ms); };

    // Asleep for two attempts, then awake — which is what a Neon cold start
    // looks like from here.
    let calls = 0;
    const woken = await connectWithResume(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      return 'connected';
    }, { wait });
    assert.equal(woken, 'connected');
    assert.equal(calls, 3);
    assert.deepEqual(waits, [250, 500], 'the backoff doubles');

    // Gone, not asleep: bounded, and the real error comes out.
    let attempts = 0;
    await assert.rejects(
      () => connectWithResume(async () => {
        attempts += 1;
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      }, { wait }),
      /ECONNREFUSED/,
    );
    assert.equal(attempts, 4, 'the retry is bounded');

    // A statement-level failure is not retried AT ALL.
    let once = 0;
    await assert.rejects(
      () => connectWithResume(async () => { once += 1; throw new Error('duplicate key value violates unique constraint'); }, { wait }),
      /duplicate key/,
    );
    assert.equal(once, 1, 'a real error was retried — a write could be repeated');
  });

  // ── against a real database that is actually paused ──────────────────────

  test('A DATABASE THAT REFUSES, THEN WAKES: the query survives it', async () => {
    // WHAT THIS REPLACES, because the first version of it passed for the
    // wrong reason and that is worth writing down. It used SIGSTOP on the
    // local postmaster, on the assumption that a paused database refuses
    // connections. It does not: the kernel holds the TCP connection in the
    // accept backlog and it completes when the process resumes. The query
    // waited 1515ms and succeeded with **zero retries** — the retry path was
    // never entered, and the test asserted nothing about it.
    //
    // A suspended Neon endpoint can present either way. This models the half
    // that needs the retry: connections REFUSED, then a listener appears.
    // Nothing is listening on the port when the query is issued.
    const net = await import('node:net');
    const proxyPort = 5_400 + (process.pid % 100);
    const real = new URL(process.env['DATABASE_URL']!);

    const retries: string[] = [];
    onIdleClientError((error) => { retries.push(error.message); });

    await closeDb();
    configureDb(`postgres://${real.username}:${real.password}@127.0.0.1:${proxyPort}${real.pathname}`);

    // The endpoint "wakes" after 600ms: a plain TCP proxy to the real server.
    let server: import('node:net').Server | null = null;
    const wake = setTimeout(() => {
      server = net.createServer((incoming) => {
        const upstream = net.connect(Number(real.port || 5432), real.hostname);
        incoming.pipe(upstream); upstream.pipe(incoming);
        incoming.on('error', () => upstream.destroy());
        upstream.on('error', () => incoming.destroy());
      });
      server.listen(proxyPort, '127.0.0.1');
    }, 600);

    try {
      // An ordinary query, issued while the port refuses everything.
      const answer = await db().query<{ n: number }>('SELECT 1 AS n');
      assert.equal(answer.rows[0]!.n, 1);
      // AND THE RETRY IS WHAT DID IT. Without this assertion the test would
      // pass on a database that was never asleep, which is precisely how the
      // first version of it fooled me.
      assert.ok(retries.length >= 1, 'the query succeeded without ever retrying — the database was not actually refusing');
      assert.match(retries[0]!, /database asleep, attempt 1/);
    } finally {
      clearTimeout(wake);
      await closeDb();
      await new Promise<void>((resolve) => {
        if (server === null) resolve();
        else (server as import('node:net').Server).close(() => resolve());
      });
      configureDb(process.env['DATABASE_URL']!);
    }
  });

  test('and a database that merely HANGS is waited out, without retrying', async (t) => {
    // The other half of the same failure, and the reason the first version of
    // the test above proved nothing: a paused postmaster does not refuse, it
    // holds the connection in the accept backlog. No retry is needed or
    // wanted — pg simply waits, bounded by connectionTimeoutMillis.
    const postmaster = await findPostmaster();
    if (postmaster === null) {
      t.skip('no local postmaster to pause — this test needs Postgres as a child process');
      return;
    }
    const retries: string[] = [];
    onIdleClientError((error) => { retries.push(error.message); });
    await closeDb();

    process.kill(postmaster, 'SIGSTOP');
    let resumed = false;
    const wake = setTimeout(() => { resumed = true; process.kill(postmaster, 'SIGCONT'); }, 800);
    try {
      const answer = await db().query<{ n: number }>('SELECT 1 AS n');
      assert.equal(answer.rows[0]!.n, 1);
      assert.equal(resumed, true, 'the query answered before the resume — it was never actually paused');
      assert.equal(retries.length, 0, 'a hang was retried; only a refusal should be');
    } finally {
      clearTimeout(wake);
      try { process.kill(postmaster, 'SIGCONT'); } catch { /* already running */ }
    }
  });
});

/** The local postmaster's pid, or null when Postgres is not a process here. */
async function findPostmaster(): Promise<number | null> {
  const { readFileSync, existsSync } = await import('node:fs');
  for (const path of ['/var/lib/postgresql/16/main/postmaster.pid', '/var/run/postgresql/16-main.pid']) {
    if (!existsSync(path)) continue;
    const pid = Number.parseInt(readFileSync(path, 'utf8').split('\n')[0] ?? '', 10);
    if (Number.isInteger(pid) && pid > 0) return pid;
  }
  return null;
}
