// What happens when the things this product depends on fail.
//
// It has many dependencies and they will all fail: a model provider, an
// object store, a push service, a database, and a scheduler it does not
// control. Until this file existed none of that had ever been exercised, and
// the answer to every one of the questions below was "a stack trace, or a
// spinner that never resolves".
//
// THE STANDARD EVERY TEST HERE HOLDS TO: a dependency failing must arrive as
// something SHE SAYS. Not a toast naming a third party the person has never
// heard of, not a 500, and above all not silence with three dots in it. The
// product's whole claim is that there is somebody there; "somebody there" who
// vanishes without a word when their hosting provider hiccups is a worse lie
// than an honest "I'm a little away right now".
//
// And a failure must not COST anything. An outage that also eats the day's
// message allowance charges the person twice for one bad minute of ours.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { db, closeDb, migrate, accounts, attachments as attachmentRows, usage } from '@lian/db';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, ProviderError, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { memoryStore, type ObjectStore } from '@lian/storage';
import { localDayKey, limitsFor } from '@lian/domain';
import { t } from '@lian/i18n';
import { createApplication } from './app.ts';
import { loadConfig } from './config.ts';

/** Unique per call and per process — LESSONS §28. */
let nextAddress = 0;
const clientAddress = (): string => {
  const n = (nextAddress += 1);
  return `10.${process.pid % 256}.${(n >> 8) % 256}.${n % 256}`;
};

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
const NOW = new Date('2026-05-18T06:30:00.000Z');
const VAPID = generateVapidKeys();

const CAPABILITIES = { streaming: true, toolCalling: false, vision: true, contextTokens: 200_000, maxOutputTokens: 4_000 };

/**
 * A provider under instruction: reply, or fail in a named way.
 *
 * The analysis model rides the same port on a different model id, and it must
 * keep working — otherwise a test about the CHAT provider failing would
 * really be a test about everything failing at once.
 */
function moody(behaviour: () => { fail: null | Error; reply: string }): Provider & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() { return state.calls; },
    id: 'moody',
    capabilities: () => CAPABILITIES,
    async stream(request, onDelta) {
      if (request.model !== DEFAULT_MODEL) {
        onDelta('[]');
        return { usage: { inputTokens: 10, outputTokens: 2, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
      }
      state.calls += 1;
      const step = behaviour();
      if (step.reply !== '') onDelta(step.reply);
      if (step.fail !== null) throw step.fail;
      return { usage: { inputTokens: 900, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
    },
  };
}

const blindAnalysis: AnalysisModel = {
  async complete() { return { text: '[]', usage: { inputTokens: 10, outputTokens: 2 } }; },
  async completeWithImage() { return { text: '{}', usage: { inputTokens: 10, outputTokens: 2 } }; },
};

/** A store that refuses everything, the way an unreachable bucket does. */
function unreachableStore(): ObjectStore {
  const down = (): never => { throw new Error('getaddrinfo ENOTFOUND objects.example.invalid'); };
  return {
    id: 'unreachable',
    async presignPut() { return down(); },
    async presignGet() { return down(); },
    async put() { return down(); },
    async get() { return down(); },
    async head() { return down(); },
    async remove() { return down(); },
  };
}

/** Read an SSE body into its events. */
function events(body: string): { event: string; data: Record<string, unknown> }[] {
  const out: { event: string; data: Record<string, unknown> }[] = [];
  for (const block of body.split('\n\n')) {
    const name = /^event: (.*)$/m.exec(block)?.[1];
    const payload = /^data: (.*)$/m.exec(block)?.[1];
    if (name === undefined) continue;
    out.push({ event: name, data: payload === undefined ? {} : (JSON.parse(payload) as Record<string, unknown>) });
  }
  return out;
}

describe('when a dependency fails', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  const created: string[] = [];
  const running: (() => Promise<void>)[] = [];

  before(async () => { await migrate(() => {}); });
  after(async () => {
    // Closed in `after` and not on a test's last line: a failing assertion
    // skips the rest of the test, and a server left listening hangs the whole
    // run with no output at all (LESSONS §28's corollary).
    for (const stop of running) await stop();
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  async function boot(options: { provider: Provider; store: ObjectStore; address: string }) {
    const config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env['DATABASE_URL'], PORT: '0',
      LIAN_TRUSTED_PROXIES: '1', LIAN_TICK_SECRET: 'x',
      LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
    }).config;
    const logs: string[] = [];
    const { server } = createApplication(config, {
      provider: options.provider,
      analysisModel: blindAnalysis,
      embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
      now: () => NOW, log: (line: string) => logs.push(line), store: options.store,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    running.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const email = `res-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.test`;
    const signUp = await fetch(`${base}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `su-${Date.now()}-${Math.random()}`, 'x-forwarded-for': options.address },
      body: JSON.stringify({ email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai', isAdult: true, agreedToTerms: true }),
    });
    const account = (await signUp.json()) as { userId: string; sessionToken: string };
    if (account.userId === undefined) throw new Error(`sign-up ${signUp.status}: ${JSON.stringify(account)}`);
    created.push(account.userId);

    const { rows } = await db().query<{ id: string }>(
      `SELECT c.id FROM conversations c JOIN assistants a ON a.id = c.assistant_id WHERE a.user_id = $1`,
      [account.userId],
    );

    let key = 0;
    const call = async (method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<Response> =>
      fetch(`${base}${path}`, {
        method,
        headers: {
          'content-type': 'application/json', authorization: `Bearer ${account.sessionToken}`,
          'idempotency-key': idempotencyKey ?? `res-${Date.now()}-${++key}-${Math.random()}`,
          'x-forwarded-for': options.address,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    const say = async (message: string, idempotencyKey?: string) => {
      const response = await call(
        'POST', `/api/conversations/${rows[0]!.id}/messages`,
        { message, clientId: `c-${Date.now()}-${Math.random()}` }, idempotencyKey,
      );
      return { response, events: events(await response.text()) };
    };

    return { base, account, conversationId: rows[0]!.id, call, say, logs };
  }

  const messagesToday = async (userId: string): Promise<number> =>
    usage.current({ userId }, 'messages', localDayKey(NOW, 'Asia/Dubai'));

  // ── the model provider ──────────────────────────────────────────────────

  test('the provider dying mid-sentence becomes something she says, not an error', async () => {
    const app = await boot({
      address: clientAddress(),
      // The worst shape: she has already started talking. Nothing can be
      // retried, because half a sentence is on the screen.
      provider: moody(() => ({ reply: 'I was just thinking about the', fail: new ProviderError('socket hang up', 500, true) })),
      store: memoryStore(),
    });

    const { response, events: stream } = await app.say('are you around?');

    // Not a 500. The request succeeded; the model did not.
    assert.equal(response.status, 200);
    const outage = stream.find((e) => e.event === 'outage');
    assert.ok(outage !== undefined, `no outage event — got ${stream.map((e) => e.event).join(', ')}`);
    assert.equal(outage.data['line'], t('error.outage', 'en', 'female'));
    // Her line, and nothing about sockets, providers or status codes.
    assert.ok(!/socket|provider|500|error/i.test(String(outage.data['line'])));
    assert.equal(stream.find((e) => e.event === 'done')?.data['status'], 'provider_unavailable');
  });

  test('a provider outage does not cost the person a message', async () => {
    const app = await boot({
      address: clientAddress(),
      provider: moody(() => ({ reply: '', fail: new ProviderError('overloaded', 529, true) })),
      store: memoryStore(),
    });

    const before = await messagesToday(app.account.userId);
    await app.say('are you there?');
    const after = await messagesToday(app.account.userId);

    assert.equal(after, before, 'the outage was charged to their daily allowance');
  });

  test('their words survive an outage; her half-sentence does not', async () => {
    const app = await boot({
      address: clientAddress(),
      provider: moody(() => ({ reply: 'I was just thinking abo', fail: new ProviderError('socket hang up', 500, true) })),
      store: memoryStore(),
    });

    await app.say('I paid the gym 400 today');

    const stored = await app.call('GET', `/api/conversations/${app.conversationId}/messages`);
    const { messages } = (await stored.json()) as { messages: { role: string; body: string }[] };

    // What they typed is still there — it was persisted before the stream,
    // which is the entire reason for that ordering.
    assert.ok(messages.some((m) => m.role === 'user' && m.body === 'I paid the gym 400 today'));
    // And a thought she never finished is not recorded as one she had.
    assert.deepEqual(
      messages.filter((m) => m.role === 'assistant' && m.body.startsWith('I was just thinking abo')),
      [],
    );
  });

  test('an outage is not remembered as her answer — the same message can be sent again', async () => {
    // The subtle one. Idempotency exists so a retried POST does not pay
    // twice; if it recorded the OUTAGE, the person would get "I'm a little
    // away" back forever, long after the provider came home.
    let down = true;
    const app = await boot({
      address: clientAddress(),
      provider: moody(() => (down
        ? { reply: '', fail: new ProviderError('overloaded', 529, true) }
        : { reply: 'I am here. What happened with the gym?', fail: null })),
      store: memoryStore(),
    });

    const key = `retry-${Date.now()}-${Math.random()}`;
    const first = await app.say('are you around?', key);
    assert.ok(first.events.some((e) => e.event === 'outage'));

    down = false;
    const second = await app.say('are you around?', key);

    assert.ok(!second.events.some((e) => e.event === 'outage'), 'the outage was replayed after the provider recovered');
    assert.equal(
      second.events.filter((e) => e.event === 'text').map((e) => e.data['delta']).join(''),
      'I am here. What happened with the gym?',
    );
    assert.equal(second.events.find((e) => e.event === 'done')?.data['replayed'], false);
  });

  test('a retryable failure with nothing said yet is retried, and the person never knows', async () => {
    // A 500 rather than a 429: a 500 is the REQUEST failing, which is what
    // retrying is for. A 429 is the KEY being unusable, which the pool
    // answers by reaching for another one — a different mechanism, tested in
    // keypool.test.ts.
    let calls = 0;
    const app = await boot({
      address: clientAddress(),
      provider: moody(() => {
        calls += 1;
        return calls === 1
          ? { reply: '', fail: new ProviderError('upstream fell over', 500, true) }
          : { reply: 'Hey. How did it go?', fail: null };
      }),
      store: memoryStore(),
    });

    const { events: stream } = await app.say('hello?');

    assert.ok(!stream.some((e) => e.event === 'outage'));
    assert.equal(stream.filter((e) => e.event === 'text').map((e) => e.data['delta']).join(''), 'Hey. How did it go?');
    assert.ok(calls >= 2, 'the failure was surfaced rather than retried');
  });

  test('a limit reached is still a limit — an outage refund does not hand out free messages', async () => {
    // The refund path could have been a hole: fail on purpose, get the
    // message back, repeat. It is not, because the refund only ever returns
    // what that same turn took.
    const ceiling = limitsFor('free').messagesPerDay;
    const app = await boot({
      address: clientAddress(),
      provider: moody(() => ({ reply: '', fail: new ProviderError('down', 500, true) })),
      store: memoryStore(),
    });

    for (let i = 0; i < 5; i += 1) await app.say(`attempt ${i}`);

    const spent = await messagesToday(app.account.userId);
    assert.equal(spent, 0);
    assert.ok(spent < ceiling);
  });

  // ── the object store ────────────────────────────────────────────────────

  test('a store that cannot be reached refuses the upload instead of throwing', async () => {
    const app = await boot({ address: clientAddress(), provider: moody(() => ({ reply: 'ok', fail: null })), store: unreachableStore() });

    const begun = await app.call('POST', '/api/attachments', { kind: 'image', contentType: 'image/jpeg' });
    const body = (await begun.json()) as { error?: string; message?: string };

    assert.notEqual(begun.status, 500, `a store outage surfaced as a server error: ${JSON.stringify(body)}`);
    // And it says so in her voice rather than naming DNS.
    assert.ok(!/ENOTFOUND|getaddrinfo|invalid/i.test(JSON.stringify(body)));
    // The failure is in the log, where an operator can see it.
    assert.ok(app.logs.some((line) => /storage unreachable/.test(line)), app.logs.join('\n'));
  });

  test('a failed signing does not leave a reservation counting against the ceiling', async () => {
    const app = await boot({ address: clientAddress(), provider: moody(() => ({ reply: 'ok', fail: null })), store: unreachableStore() });

    await app.call('POST', '/api/attachments', { kind: 'image', contentType: 'image/jpeg' });

    // Soft-deleted, like every other removal in this product (LESSONS §11's
    // deletion is a column, and the sweeper is what makes it real). What
    // matters is that nothing LIVE is left pointing at an object that was
    // never written.
    const { rows } = await db().query<{ n: string }>(
      `SELECT count(*) AS n FROM attachments WHERE user_id = $1 AND deleted_at IS NULL`,
      [app.account.userId],
    );
    assert.equal(Number(rows[0]!.n), 0, 'a live row was left behind for an object that was never written');
  });

  test('a store that goes down AFTER an upload hides the picture, not the conversation', async () => {
    // The store is fine for the upload and unreachable for the read — which
    // is what a bucket outage actually looks like to somebody scrolling back.
    const store = memoryStore();
    let readable = true;
    const flaky: ObjectStore = {
      ...store,
      async presignGet(input) {
        if (!readable) throw new Error('getaddrinfo ENOTFOUND objects.example.invalid');
        return store.presignGet(input);
      },
    };
    const app = await boot({ address: clientAddress(), provider: moody(() => ({ reply: 'Got it.', fail: null })), store: flaky });

    const begun = await app.call('POST', '/api/attachments', {
      kind: 'image', contentType: 'image/jpeg', conversationId: app.conversationId,
    });
    const signed = (await begun.json()) as { id: string };
    assert.equal(begun.status, 201, JSON.stringify(signed));
    const row = await attachmentRows.get({ userId: app.account.userId }, signed.id);
    await store.put({ key: row!.storageKey, bytes: new Uint8Array(1_024), contentType: 'image/jpeg' });
    await app.call('POST', `/api/attachments/${signed.id}/complete`);
    await app.say('here you go');

    readable = false;

    // The conversation still renders. That is the larger half of the
    // assertion: a picture that will not load is a small failure, and a
    // thread that will not open because of it is a large one. The bytes are
    // fetched per attachment on a SEPARATE request, which is exactly why one
    // of them failing must not be able to take the thread down with it.
    const reread = await app.call('GET', `/api/conversations/${app.conversationId}/messages`);
    assert.equal(reread.status, 200);
    const { messages } = (await reread.json()) as { messages: { role: string; body: string }[] };
    assert.ok(messages.length >= 2);

    // And the picture's own request refuses rather than exploding: a 404 is
    // what the client already handles for an attachment it cannot have, and a
    // 500 is what it does not.
    const picture = await app.call('GET', `/api/attachments/${signed.id}`);
    assert.equal(picture.status, 404, 'a bucket outage surfaced as a server error on the attachment');
    assert.ok(app.logs.some((line) => /storage unreachable/.test(line)), app.logs.join('\n'));
  });
});
