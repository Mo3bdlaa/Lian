// Liveness and readiness, over the real HTTP layer.
//
// The failure these replace is the one every health endpoint has by default:
// **200 OK while the database is unreachable**, because the handler returns a
// literal. So the tests that matter here are the negative ones — a probe that
// only ever passes is indistinguishable from no probe at all.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { closeDb, migrate, accounts } from '@lian/db';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { memoryStore, type ObjectStore } from '@lian/storage';
import { createApplication } from './app.ts';
import { loadConfig } from './config.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
const VAPID = generateVapidKeys();

const provider: Provider = {
  id: 'quiet',
  capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 1_000, maxOutputTokens: 100 }),
  async stream(_r, onDelta) {
    onDelta('.');
    return { usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
  },
};
const analysis: AnalysisModel = {
  async complete() { return { text: '[]', usage: { inputTokens: 1, outputTokens: 1 } }; },
  async completeWithImage() { return { text: '{}', usage: { inputTokens: 1, outputTokens: 1 } }; },
};

type Probe = { ready: boolean; failing: string[]; checks: { name: string; state: string; detail?: string }[] };

describe('liveness and readiness', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  const running: (() => Promise<void>)[] = [];
  const created: string[] = [];

  before(async () => { await migrate(() => {}); });
  after(async () => {
    for (const stop of running) await stop();
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  async function boot(options: { store?: ObjectStore | null; keys?: string } = {}) {
    const { config } = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env['DATABASE_URL'], PORT: '0',
      LIAN_TICK_SECRET: 'x', LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
      ...(options.keys === undefined ? {} : { ANTHROPIC_API_KEY: options.keys }),
    });
    const { server } = createApplication(config, {
      provider, analysisModel: analysis, embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
      log: () => {}, store: options.store === undefined ? memoryStore() : options.store,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    running.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  // ── liveness ────────────────────────────────────────────────────────────

  test('liveness answers without touching anything external', async () => {
    const base = await boot();
    const response = await fetch(`${base}/health/live`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { live: boolean; uptimeSeconds: number };
    assert.equal(body.live, true);
    assert.ok(Number.isInteger(body.uptimeSeconds));
  });

  /**
   * An application pointed at a database that is not there.
   *
   * The pool is a PROCESS-WIDE SINGLETON — one process, one pool, one
   * database, which is what production is — so pointing a second application
   * somewhere else means closing the first. `configureDb` refuses to do it
   * silently, which is the whole reason these two tests are shaped like this
   * rather than just calling `boot()` with a different URL.
   */
  async function bootBroken(): Promise<{ base: string; stop: () => Promise<void> }> {
    await closeDb();
    const { config } = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none', PORT: '0',
      LIAN_TICK_SECRET: 'x', LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
    });
    const { server } = createApplication(config, {
      provider, analysisModel: analysis, embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
      log: () => {}, store: memoryStore(),
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
      base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      // Closed AND the pool released, so the next test reopens against the
      // real database rather than inheriting this one.
      stop: async () => {
        await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
        await closeDb();
      },
    };
  }

  test('LIVENESS IGNORES THE DATABASE — restarting the app does not fix Postgres', async () => {
    // The rule this enforces. A liveness probe that checks a dependency
    // restarts the app when the DEPENDENCY is down: it fixes nothing, drops
    // every in-flight stream, and turns a bad minute at the database into a
    // restart loop that outlasts it.
    //
    // Pointed at a database that does not exist, and asked whether the
    // PROCESS is alive. It is.
    const broken = await bootBroken();
    try {
      assert.equal((await fetch(`${broken.base}/health/live`)).status, 200);
    } finally {
      await broken.stop();
    }
  });

  // ── readiness ───────────────────────────────────────────────────────────

  test('readiness reaches every dependency and names each one', async () => {
    const base = await boot();
    const response = await fetch(`${base}/health/ready`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Probe;
    assert.equal(body.ready, true);
    assert.deepEqual(body.failing, []);
    assert.deepEqual(body.checks.map((c) => c.name).sort(), ['database', 'model', 'storage']);
    assert.equal(body.checks.find((c) => c.name === 'database')!.state, 'ok');
  });

  test('THE FAILURE THIS REPLACES: readiness is 503 when the database is unreachable', async () => {
    // 200-while-broken is the default behaviour of every health endpoint that
    // returns a literal, and it is worse than having none: it tells a load
    // balancer to keep sending traffic to a process that cannot serve it.
    const broken = await bootBroken();
    try {
      const response = await fetch(`${broken.base}/health/ready`);
      assert.equal(response.status, 503, 'a broken database answered 200');
      const body = (await response.json()) as Probe;
      assert.equal(body.ready, false);
      assert.deepEqual(body.failing, ['database']);
      // AND IT SAYS WHY, in the driver's own words. "Not ready" is binary;
      // "not ready: database, ECONNREFUSED" is something to act on at 2am.
      const database = body.checks.find((c) => c.name === 'database')!;
      assert.equal(database.state, 'failing');
      assert.match(database.detail ?? '', /ECONNREFUSED|connect|timeout/i);
    } finally {
      await broken.stop();
    }
  });

  test('a store that refuses is named as failing, and does NOT take the app out of rotation', async () => {
    // Storage down means an attachment refuses and she says so. The app still
    // serves, signs in, and shows somebody their own history — so it stays
    // ready. Naming the failure without acting on it is the point.
    const unreachable: ObjectStore = {
      id: 'unreachable',
      async presignPut() { throw new Error('getaddrinfo ENOTFOUND bucket.example.invalid'); },
      async presignGet() { throw new Error('getaddrinfo ENOTFOUND bucket.example.invalid'); },
      async put() { throw new Error('getaddrinfo ENOTFOUND bucket.example.invalid'); },
      async get() { throw new Error('getaddrinfo ENOTFOUND bucket.example.invalid'); },
      async head() { throw new Error('getaddrinfo ENOTFOUND bucket.example.invalid'); },
      async remove() { throw new Error('getaddrinfo ENOTFOUND bucket.example.invalid'); },
    };
    const base = await boot({ store: unreachable });
    const response = await fetch(`${base}/health/ready`);

    assert.equal(response.status, 200, 'a bucket outage took the whole app out of the load balancer');
    const body = (await response.json()) as Probe;
    assert.equal(body.ready, true);
    assert.deepEqual(body.failing, ['storage']);
    assert.match(body.checks.find((c) => c.name === 'storage')!.detail ?? '', /ENOTFOUND/);
  });

  test('NOT CONFIGURED IS NOT OK — an absent dependency reports as absent', async () => {
    // The distinction that makes the endpoint readable: a deployment with no
    // store is fine; a deployment whose store check could not be run is not
    // the same thing as one whose store works, and neither is `ok`.
    const base = await boot({ store: null });
    const body = (await (await fetch(`${base}/health/ready`)).json()) as Probe;
    const storage = body.checks.find((c) => c.name === 'storage')!;
    assert.equal(storage.state, 'not_configured');
    assert.notEqual(storage.state, 'ok');
    // And with no model key either — this deployment has neither, and says so
    // rather than claiming both are healthy.
    assert.equal(body.checks.find((c) => c.name === 'model')!.state, 'not_configured');
    assert.equal(body.ready, true, 'an unconfigured optional dependency is not an outage');
  });

  test('neither endpoint needs a session — a probe cannot be behind auth', async () => {
    // An orchestrator has no credentials. A health endpoint that 401s is a
    // health endpoint that reports the app as down, permanently.
    const base = await boot();
    for (const path of ['/health/live', '/health/ready']) {
      const response = await fetch(`${base}${path}`);
      assert.notEqual(response.status, 401, `${path} is behind auth`);
      assert.notEqual(response.status, 404, `${path} is not routed`);
    }
  });
});
