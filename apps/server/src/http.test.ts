// The HTTP layer, end to end.
//
// A real server on a real port, driven with fetch, against a real Postgres.
// Nothing below is a unit test with a stubbed router: the two things this run
// was asked to get right — a rate limiter that is not process memory
// (LESSONS §12) and idempotency on EVERY write route — are only true if they
// are true across processes and across routes, and a mock cannot show that.
//
// The model provider is the one fake, because a test that costs money is a
// test nobody runs.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { db, closeDb, migrate, accounts, outreach } from '@lian/db';
import { signTick } from '@lian/jobs';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider, type CompletionRequest } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { CONSENT_VERSION } from '@lian/i18n';
import { hashToken } from '@lian/auth';
import { createApplication, type Overrides } from './app.ts';
import { loadConfig, type Config } from './config.ts';

/**
 * A client address that is unique per CALL and per PROCESS.
 *
 * These tests send an X-Forwarded-For to model distinct clients, and the
 * `auth:ip:` rate limit is a DATABASE row keyed on that address (LESSONS
 * §12). So an address that repeats — across runs, across files, or across
 * two calls in one file — means two sign-ups share a bucket and the second
 * is refused with a 429 that surfaces three lines later as an undefined
 * property.
 *
 * TEST-NET-1 was not big enough. A /24 is 250 addresses and the suite makes
 * hundreds of sign-ups, so collisions were near-certain by birthday alone —
 * which is why a random base per file fixed it for one file and not for the
 * run. This is a /8 keyed on the process id, so two files cannot collide and
 * a counter inside one cannot either.
 *
 * 10.0.0.0/8 is private, so `isRoutable` refuses it and nothing here reaches
 * a geo lookup — which is also the honest thing for a fake address to be.
 */
let nextAddress = 0;
const clientAddress = (): string => {
  const n = (nextAddress += 1);
  return `10.${process.pid % 256}.${(n >> 8) % 256}.${n % 256}`;
};


const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
const NOW = new Date('2026-05-18T06:30:00.000Z');
const TICK_SECRET = 'test-tick-secret';
const VAPID = generateVapidKeys();

/** A provider that answers, counts its calls, and never leaves the process. */
function fakeProvider(reply = 'Noted — I will keep that in mind.'): Provider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  return {
    calls,
    id: 'fake',
    capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
    async stream(request, onDelta) {
      calls.push(request);
      for (let i = 0; i < reply.length; i += 9) onDelta(reply.slice(i, i + 9));
      return { usage: { inputTokens: 1_200, outputTokens: 60, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
    },
  };
}

function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env['DATABASE_URL'],
    PORT: '0',
    // ONE TRUSTED PROXY, declared. These tests send an X-Forwarded-For to
    // model distinct clients, and that only means anything if the
    // deployment says a proxy is in front of it. With the default of zero
    // the header is ignored and every request shares the loopback's
    // rate-limit bucket — which is the point of the default, and is what
    // stops an attacker minting fresh buckets by rotating a header.
    LIAN_TRUSTED_PROXIES: '1',
    LIAN_TICK_SECRET: TICK_SECRET,
    LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey,
    LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
    ...overrides,
  }).config;
}

type Running = { base: string; close: () => Promise<void>; provider: Provider & { calls: CompletionRequest[] } };

/** Every server started by a test, closed in `after` whether the test that
 *  started it passed or not — otherwise a failing assertion leaves a listening
 *  socket and the run never exits. */
const running: Running[] = [];

async function start(overrides: Overrides & { env?: Record<string, string> } = {}): Promise<Running> {
  const provider = (overrides.provider as Provider & { calls: CompletionRequest[] } | undefined) ?? fakeProvider();
  const { server } = createApplication(testConfig(overrides.env ?? {}), {
    provider,
    embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
    now: () => NOW,
    log: () => {},
    ...overrides,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const instance: Running = {
    base: `http://127.0.0.1:${port}`,
    provider,
    close: () => new Promise<void>((resolve) => {
      // Keep-alive connections from fetch hold the event loop open long after
      // the last assertion; the server drops them rather than waiting.
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
  running.push(instance);
  return instance;
}

let keyCounter = 0;

/** Every message the app tried to send, in order. */
const mail: { to: string; subject: string; body: string }[] = [];

/** The raw token out of the most recent message to an address matching a
 *  pattern — how a test reads a link the way a person does. */
function lastEmailFor(email: string, pattern: RegExp): string | null {
  for (let index = mail.length - 1; index >= 0; index -= 1) {
    const message = mail[index]!;
    if (message.to !== email) continue;
    const match = pattern.exec(message.body);
    if (match !== null) return decodeURIComponent(match[1]!);
  }
  return null;
}

/** The raw token out of the most recent reset email. */
function lastResetTokenFor(email: string): string | null {
  for (let index = mail.length - 1; index >= 0; index -= 1) {
    const message = mail[index]!;
    if (message.to !== email) continue;
    const match = /\/reset-password\?token=([^\s]+)/.exec(message.body);
    if (match !== null) return decodeURIComponent(match[1]!);
  }
  return null;
}
const freshKey = (): string => `k-${Date.now()}-${++keyCounter}`;

type Json = Record<string, unknown>;

/**
 * A distinct client address per test.
 *
 * The auth limiter is ten sign-ups a minute PER ADDRESS, which is the right
 * number for people and the wrong one for a test file that signs up fifteen
 * times in four seconds. Every test that is not about rate limiting comes
 * from its own address; the two that are share one deliberately.
 */
let ipCounter = 0;
const nextIp = (): string => `198.51.100.${(ipCounter += 1) % 250}`;

async function post(base: string, path: string, body: unknown, init: { token?: string; key?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': init.ip ?? nextIp() };
  if (init.token !== undefined) headers['authorization'] = `Bearer ${init.token}`;
  if (init.key !== null) headers['idempotency-key'] = init.key ?? freshKey();
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, json: (text === '' ? {} : JSON.parse(text)) as Json, headers: response.headers };
}

async function get(base: string, path: string, token: string) {
  const response = await fetch(`${base}${path}`, {
    headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': nextIp() },
  });
  const text = await response.text();
  return { status: response.status, json: (text === '' ? {} : JSON.parse(text)) as Json };
}

async function patch(base: string, path: string, body: unknown, token: string) {
  const response = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json', authorization: `Bearer ${token}`,
      'idempotency-key': freshKey(), 'x-forwarded-for': nextIp(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: (text === '' ? {} : JSON.parse(text)) as Json };
}

/** Reads an SSE body into its events. The turn is short, so this waits for
 *  the stream to end rather than pretending to be a client. */
async function sse(base: string, path: string, body: unknown, init: { token: string; key?: string; ip?: string }) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${init.token}`,
      'idempotency-key': init.key ?? freshKey(),
      'x-forwarded-for': init.ip ?? nextIp(),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const events: { event: string; data: Json }[] = [];
  for (const chunk of text.split('\n\n')) {
    const event = /^event: (.+)$/m.exec(chunk)?.[1];
    const data = /^data: (.+)$/m.exec(chunk)?.[1];
    if (event !== undefined && data !== undefined) events.push({ event, data: JSON.parse(data) as Json });
  }
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', events, text };
}

/** A correctly signed tick, at the clock the application is running on. */
async function tick(base: string, payload: unknown) {
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(NOW.getTime() / 1000);
  const response = await fetch(`${base}/api/tick`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lian-timestamp': String(timestamp),
      'x-lian-signature': signTick(TICK_SECRET, timestamp, body),
      'x-forwarded-for': nextIp(),
    },
    body,
  });
  return { status: response.status, json: (await response.json()) as Json };
}

const created: string[] = [];

async function signUp(base: string, overrides: Json = {}): Promise<{ userId: string; token: string; conversationId: string; email: string }> {
  const email = `http-${Date.now()}-${++keyCounter}@example.test`;
  const result = await post(base, '/api/auth/sign-up', { email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai', isAdult: true, agreedToTerms: true, ...overrides });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  const userId = result.json['userId'] as string;
  created.push(userId);
  const { rows } = await db().query<{ id: string }>(
    `SELECT c.id FROM conversations c JOIN assistants a ON a.id = c.assistant_id WHERE a.user_id = $1`,
    [userId],
  );
  return { userId, email, token: result.json['sessionToken'] as string, conversationId: rows[0]!.id };
}

describe('the HTTP layer', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  let app: Running;

  before(async () => {
    await migrate(() => {});
    // A transport that captures instead of sending. The reset token only
    // ever leaves the server in an email, which is the property under test —
    // so the test reads it the way the person does, out of the message.
    app = await start({ sendEmail: async (message) => { mail.push(message); } });
  });
  after(async () => {
    for (const instance of running) await instance.close();
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  // ── the flow ────────────────────────────────────────────────────────────

  test('LIAN_TRUSTED_PROXIES changes who a request is attributed to, not just what parses', async () => {
    // LESSONS §25. The setting was added to ServerOptions, read in
    // server.ts, given a config entry, an env var, docs, and a test asserting
    // it PARSED — and app.ts never passed it. The whole thing was inert and
    // every request was attributed to the socket.
    //
    // So this asserts the BEHAVIOUR, from outside, the only way it can be
    // seen: the `auth:ip:` rate limit is keyed on the client address, so two
    // requests with different forwarded addresses share a bucket when the
    // header is ignored and have their own when it is trusted. Nothing about
    // the config object is inspected.
    const forged = (address: string) => ({ 'x-forwarded-for': address });
    const attempts = async (server: Running, address: string): Promise<number[]> => {
      const seen: number[] = [];
      for (let n = 0; n < 12; n += 1) {
        const response = await fetch(`${server.base}/api/auth/sign-in`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...forged(address) },
          body: JSON.stringify({ email: `nobody-${n}@example.test`, password: 'wrong-but-long-enough' }),
        });
        seen.push(response.status);
      }
      return seen;
    };

    // Trusting one hop: each forged address is its own bucket, so a fresh
    // address is never rate limited by what the previous one spent.
    const trusting = await start({ env: { LIAN_TRUSTED_PROXIES: '1' } });
    running.push(trusting);
    await attempts(trusting, clientAddress());
    const freshBucket = await attempts(trusting, clientAddress());
    assert.ok(
      !freshBucket.every((status) => status === 429),
      'with a trusted proxy, a different forwarded address must get its own rate-limit bucket',
    );

    // Trusting nothing: the header is ignored, both addresses are the same
    // socket, and the second run is refused by what the first spent. THIS is
    // the assertion that would have caught the missing wire — it fails
    // identically whether the setting is 0 or simply never passed.
    const ignoring = await start({ env: { LIAN_TRUSTED_PROXIES: '0' } });
    running.push(ignoring);
    await attempts(ignoring, clientAddress());
    const sameBucket = await attempts(ignoring, clientAddress());
    assert.ok(
      sameBucket.some((status) => status === 429),
      'with no trusted proxy the forwarded header must be IGNORED — a client that can pick its own address can mint rate-limit buckets',
    );
  });

  test('sign-up creates an account, an assistant and somewhere to talk', async () => {
    const user = await signUp(app.base);
    assert.ok(user.token.length > 20);
    assert.ok(user.conversationId.length > 0, 'onboarding is a conversation, so one has to exist');
  });

  test('a chat turn streams her answer over SSE', async () => {
    const user = await signUp(app.base);
    const stream = await sse(app.base, `/api/conversations/${user.conversationId}/messages`, { message: 'I run every morning before work.' }, { token: user.token });

    assert.equal(stream.status, 200);
    assert.match(stream.contentType, /text\/event-stream/);
    const text = stream.events.filter((e) => e.event === 'text').map((e) => e.data['delta'] as string).join('');
    assert.match(text, /Noted/);
    const done = stream.events.at(-1);
    assert.equal(done?.event, 'done');
    assert.equal(done?.data['status'], 'done');
  });

  test('a signed-out request gets 401, not a hint about what exists', async () => {
    const stranger = await sse(app.base, `/api/conversations/${crypto.randomUUID()}/messages`, { message: 'hello' }, { token: 'not-a-token' });
    assert.equal(stranger.status, 401);
  });

  test("another person's conversation is 404, not 403", async () => {
    const mine = await signUp(app.base);
    const theirs = await signUp(app.base);
    const response = await sse(app.base, `/api/conversations/${theirs.conversationId}/messages`, { message: 'hello' }, { token: mine.token });
    // 403 would confirm the conversation exists.
    assert.equal(response.status, 404);
  });

  test('a task with no day is still somewhere she will raise it', async () => {
    // "Remind me to call the bank." → "I'll remind you." → a row with
    // due_on NULL, which appeared in NO briefing block (`today` wants
    // dueOn === localDay, `carriedOver` wanted dueOn !== null, `habits`
    // wants a recurrence) and was invisible to outreach, whose query is
    // `due_on = $2::date`. She kept a promise she had no mechanism to keep,
    // and the Tasks screen said "No date", which reads as whenever.
    //
    // Found by asking her for a reminder and then looking, which is the only
    // way this was ever going to be found: every part of it is correct.
    const user = await signUp(app.base);
    const { rows } = await db().query<{ id: string }>(
      `SELECT a.id FROM assistants a WHERE a.user_id = $1`, [user.userId],
    );
    await db().query(
      `INSERT INTO tasks (user_id, kind, title, due_on, origin_assistant_id) VALUES ($1, 'task', 'call the bank', NULL, $2)`,
      [user.userId, rows[0]!.id],
    );

    const briefing = await get(app.base, '/api/briefing', user.token);
    assert.equal(briefing.status, 200);
    const carried = briefing.json['carriedOver'] as { title: string; dueOn: string | null }[];
    const found = carried.find((task) => task.title === 'call the bank');
    assert.ok(found !== undefined, 'a task she promised to remind them about appears in no block of the briefing');
    // Null travels, so the screen can say "No day set" rather than leaving an
    // empty slot that reads as a rendering failure.
    assert.equal(found.dueOn, null);
  });

  test('the story timeline starts on the first day and reads in the language it is read in', async () => {
    // UI-UX §8's timeline. `story_events` held its three types since
    // migration 0001 with NOT ONE ROW EVER WRITTEN, while the coverage matrix
    // said ✅ — LESSONS §20. Milestones are built; moments and inside jokes
    // are a judgement only she can make, which is a capability, and HANDOFF
    // says so rather than a matrix implying otherwise.
    const user = await signUp(app.base);

    const story = await get(app.base, '/api/story', user.token);
    assert.equal(story.status, 200);
    const timeline = story.json['timeline'] as { title: string; at: string }[];
    assert.equal(timeline.length, 1, 'signing up is the first thing that ever happened');
    assert.equal(timeline[0]!.title, 'We started talking');

    // The words are RESOLVED on the read, not stored. Switching language
    // moves the whole history, rather than stranding it in whichever one they
    // happened to be using on the day — which is the mistake registry.ts
    // already names for capture lines, in a place where it would be worse.
    await patch(app.base, '/api/settings', { languageStyle: 'ar-eg' }, user.token);
    const arabic = await get(app.base, '/api/story', user.token);
    const inArabic = (arabic.json['timeline'] as { title: string }[])[0]!.title;
    assert.notEqual(inArabic, 'We started talking');
    assert.match(inArabic, /[\u0600-\u06FF]/, `the timeline stayed in English: ${inArabic}`);

    // And it is not written twice. Every derived milestone is idempotent on
    // its key, because they are re-derived on a schedule that runs forever —
    // without that, a timeline of the relationship becomes a timeline of the
    // cron job.
    const { rows } = await db().query<{ n: string }>(
      `SELECT count(*) AS n FROM story_events s JOIN assistants a ON a.id = s.assistant_id WHERE a.user_id = $1`,
      [user.userId],
    );
    assert.equal(Number(rows[0]!.n), 1);
  });

  test('she speaks first, in the language the sign-up screens were read in', async () => {
    // "She texts you first" is the positioning, and until this the first
    // interaction was somebody opening an empty conversation and typing into
    // it — the promise broken on the first screen, in the three minutes where
    // the product is won. AUTHORED, not generated: on turn zero there is no
    // context to generate from.
    const english = await signUp(app.base);
    const before = await get(app.base, `/api/conversations/${english.conversationId}/messages`, english.token);
    const opening = (before.json['messages'] as { role: string; body: string }[])[0]!;
    assert.equal(opening.role, 'assistant', 'the first message in a new account is not hers');
    assert.match(opening.body, /secretary, more or less/);
    assert.match(opening.body, /What should I call you\?$/, 'PRD §8: it ends by asking one thing');

    // The language the CLIENT rendered, not a stored preference.
    const arabic = await signUp(app.base, { language: 'ar' });
    const theirs = await get(app.base, `/api/conversations/${arabic.conversationId}/messages`, arabic.token);
    const inArabic = (theirs.json['messages'] as { body: string }[])[0]!.body;
    assert.match(inArabic, /[\u0600-\u06FF]/, `her opening was English for an Arabic reader: ${inArabic}`);

    // AND ONBOARDING STILL ASKS WHICH LANGUAGE. The browser's guess is not
    // somebody's choice, so language_style stays 'auto' — without this, a
    // person whose browser happened to be Arabic would never be asked, and
    // would never know they could change it.
    const me = await get(app.base, '/api/me', arabic.token);
    const user = me.json['user'] as { languageStyle: string; language: string };
    assert.equal(user.languageStyle, 'auto');

    // WHILE THE APP RENDERS IN ARABIC ANYWAY. 'auto' means "match the user",
    // and before they have said anything there is nothing to match — so it
    // falls back to what they signed up in. Without this, her Arabic opening
    // arrived inside an English left-to-right app: the most incoherent screen
    // in the product, on the first one anybody sees. It was invisible until
    // she spoke first, because before that everything was English together.
    assert.equal(user.language, 'ar', 'her opening was Arabic and the app around it was not');
    assert.equal(me.json['direction'], 'rtl');
  });

  // ── idempotency, on every write route ───────────────────────────────────

  test('a retried chat turn replays the first answer and does not pay twice', async () => {
    const app2 = await start();
    const user = await signUp(app2.base);
    const key = freshKey();
    const body = { message: 'The rent is due on the fifth.' };

    const first = await sse(app2.base, `/api/conversations/${user.conversationId}/messages`, body, { token: user.token, key });
    const second = await sse(app2.base, `/api/conversations/${user.conversationId}/messages`, body, { token: user.token, key });

    assert.equal(first.events.at(-1)?.data['replayed'], false);
    assert.equal(second.events.at(-1)?.data['replayed'], true);
    const replayedText = second.events.filter((e) => e.event === 'text').map((e) => e.data['delta'] as string).join('');
    assert.match(replayedText, /Noted/, 'a replay still renders as an answer');
    // Chat calls only: the absorber runs on the same provider with the
    // analysis model, and those are a different question.
    const chatCalls = app2.provider.calls.filter((call) => call.model === DEFAULT_MODEL);
    assert.equal(chatCalls.length, 1, 'the model was called once for two identical requests');
    await app2.close();
  });

  test('the same key with a different body is refused rather than answered', async () => {
    const user = await signUp(app.base);
    const key = freshKey();
    await sse(app.base, `/api/conversations/${user.conversationId}/messages`, { message: 'first' }, { token: user.token, key });
    const conflict = await sse(app.base, `/api/conversations/${user.conversationId}/messages`, { message: 'entirely different' }, { token: user.token, key });
    assert.equal(conflict.events.find((e) => e.event === 'error')?.data['error'], 'idempotency_conflict');
  });

  test('EVERY write route requires a key — not just capture', async () => {
    const user = await signUp(app.base);
    const routes: [string, unknown][] = [
      ['/api/push/subscribe', { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } }],
      ['/api/push/unsubscribe', { endpoint: 'https://push.example/x' }],
      ['/api/push/prompted', { outcome: 'denied' }],
      ['/api/data/export', {}],
      ['/api/data/delete', { confirm: 'DELETE' }],
      ['/api/auth/sign-out-everywhere', {}],
    ];
    for (const [path, body] of routes) {
      const response = await post(app.base, path, body, { token: user.token, key: null });
      assert.equal(response.status, 400, `${path} accepted a write with no idempotency key`);
      assert.equal(response.json['error'], 'idempotency_key_required', path);
    }
  });

  test('a retried correction is applied once', async () => {
    const user = await signUp(app.base);
    const { rows } = await db().query<{ id: string }>(
      `INSERT INTO tasks (user_id, kind, title, due_on) VALUES ($1, 'task', 'call the bank', '2026-05-18') RETURNING id`,
      [user.userId],
    );
    const taskId = rows[0]!.id;
    const key = freshKey();
    const patch = async () => {
      const response = await fetch(`${app.base}/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}`, 'idempotency-key': key },
        body: JSON.stringify({ title: 'call the bank back' }),
      });
      return { status: response.status, json: (await response.json()) as Json };
    };
    assert.equal((await patch()).status, 200);
    assert.equal((await patch()).status, 200);
    const after = await db().query<{ title: string }>(`SELECT title FROM tasks WHERE user_id = $1 AND id = $2`, [user.userId, taskId]);
    assert.equal(after.rows[0]!.title, 'call the bank back');
  });

  test('a correction cannot set a column nobody offered', async () => {
    const user = await signUp(app.base);
    const { rows } = await db().query<{ id: string }>(
      `INSERT INTO tasks (user_id, kind, title) VALUES ($1, 'task', 'x') RETURNING id`, [user.userId],
    );
    const response = await fetch(`${app.base}/api/tasks/${rows[0]!.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}`, 'idempotency-key': freshKey() },
      body: JSON.stringify({ user_id: '00000000-0000-0000-0000-000000000000' }),
    });
    assert.equal(response.status, 422);
  });

  // ── the rate limiter is in the database (LESSONS §12) ───────────────────

  test('a limit is shared across processes, not per instance', async () => {
    // The failure this is here for, verbatim from LESSONS §12: "Rate limiting
    // held in process memory resets on every cold start and is per-instance.
    // It is not a rate limit." Two independent applications, one database.
    const one = await start();
    const two = await start();
    const user = await signUp(one.base);

    // The write bucket is 60 a minute. Spend it alternating between the two
    // servers: if the counter were in memory, each would see only half.
    let refused = 0;
    for (let i = 0; i < 62; i += 1) {
      const target = i % 2 === 0 ? one.base : two.base;
      const response = await post(target, '/api/push/prompted', { outcome: 'dismissed' }, { token: user.token, ip: clientAddress() });
      if (response.status === 429) refused += 1;
    }
    assert.ok(refused > 0, 'the shared limit was never reached — the counter is not shared');

    // And it says when to come back, rather than just refusing.
    const refusal = await post(two.base, '/api/push/prompted', { outcome: 'dismissed' }, { token: user.token, ip: clientAddress() });
    assert.equal(refusal.status, 429);
    assert.match(String(refusal.json['message']), /try again in \d+s/);

    await one.close();
    await two.close();
  });

  test('a wrong password is slowed per account, not just per address', async () => {
    const { email } = await signUp(app.base);
    const attempts: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      attempts.push((await post(app.base, '/api/auth/sign-in', { email, password: 'wrong-password-here' }, { ip: clientAddress() })).status);
    }
    assert.ok(attempts.includes(429), 'guessing was never slowed down');
    // And never 200 with a session.
    assert.ok(!attempts.includes(200));
  });

  // ── the tick ────────────────────────────────────────────────────────────

  test('the tick refuses everything that is not signed', async () => {
    const unsigned = await post(app.base, '/api/tick', {}, { key: null });
    assert.equal(unsigned.status, 401);

    const body = JSON.stringify({ source: 'test' });
    const wrong = await fetch(`${app.base}/api/tick`, {
      method: 'POST',
      headers: { 'x-lian-timestamp': String(Math.floor(NOW.getTime() / 1000)), 'x-lian-signature': 'not-the-signature' },
      body,
    });
    assert.equal(wrong.status, 401);

    // An old signature, correctly computed, is still refused: replay is the
    // attack a timestamp exists for.
    const old = Math.floor(NOW.getTime() / 1000) - 3_600;
    const replayed = await fetch(`${app.base}/api/tick`, {
      method: 'POST',
      headers: { 'x-lian-timestamp': String(old), 'x-lian-signature': signTick(TICK_SECRET, old, body) },
      body,
    });
    assert.equal(replayed.status, 401);
  });

  test('a signed tick runs the real schedule: her message is written and delivered', async () => {
    const user = await signUp(app.base);
    const { rows } = await db().query<{ id: string }>(`SELECT id FROM assistants WHERE user_id = $1`, [user.userId]);
    const assistantId = rows[0]!.id;
    // Something she owes them: a reminder they asked for, due now.
    await outreach.schedule(
      { userId: user.userId, assistantId },
      { kind: 'reminder', source: 'user_requested', scheduledFor: new Date(NOW.getTime() - 60_000), dedupeKey: `test:${user.userId}` },
    );
    // And a rate-limit window old enough to sweep.
    await db().query(`INSERT INTO rate_limits (bucket_key, window_start, count) VALUES ($1, $2, 1)`, [`sweep-me:${user.userId}`, new Date(NOW.getTime() - 48 * 60 * 60 * 1000)]);

    const report = await tick(app.base, { source: 'test' });
    assert.equal(report.status, 200);

    const outreachReport = report.json['outreach'] as Json;
    assert.ok((outreachReport['sent'] as number) >= 1, 'nothing was delivered');
    assert.ok((report.json['swept'] as Json)['rateLimits'] as number >= 1, 'the sweep did not run');

    // The message exists in the conversation, written by the same turn
    // function chat uses. Asserted BY SURFACE rather than by counting every
    // assistant message: her authored opening is also an assistant message
    // now (PRD §8 — she speaks first), and a count was never what this test
    // meant.
    const messages = await db().query<{ body: string; surface: string | null }>(
      `SELECT body, surface FROM messages WHERE assistant_id = $1 AND role = 'assistant' AND surface = 'scheduled'`,
      [assistantId],
    );
    assert.equal(messages.rows.length, 1);
    assert.match(messages.rows[0]!.body, /Noted/);

    const swept = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM rate_limits WHERE bucket_key = $1`, [`sweep-me:${user.userId}`]);
    assert.equal(swept.rows[0]!.n, 0);
  });

  // ── ownership (LESSONS §11) ─────────────────────────────────────────────

  test('export returns the account, and deletion takes the confirmation seriously', async () => {
    const user = await signUp(app.base);
    await sse(app.base, `/api/conversations/${user.conversationId}/messages`, { message: 'I moved to Dubai in March.' }, { token: user.token });

    const exported = await post(app.base, '/api/data/export', {}, { token: user.token });
    assert.equal(exported.status, 200);
    assert.match(String(exported.json['filename']), /^lian-export-\d{4}-\d{2}-\d{2}\.json$/);
    assert.ok(JSON.stringify(exported.json['archive']).includes('conversations'));

    const unconfirmed = await post(app.base, '/api/data/delete', {}, { token: user.token });
    assert.equal(unconfirmed.status, 400);

    const deleted = await post(app.base, '/api/data/delete', { confirm: 'DELETE' }, { token: user.token });
    assert.equal(deleted.status, 200);
    assert.match(String(deleted.json['message']), /Thank you/);
    assert.equal(deleted.headers.get('set-cookie')?.includes('Max-Age=0'), true);

    // The session died with the account.
    const after = await post(app.base, '/api/data/export', {}, { token: user.token });
    assert.equal(after.status, 401);
    const { rows } = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM users WHERE id = $1`, [user.userId]);
    assert.equal(rows[0]!.n, 0);
  });

  // ── the shape of the thing ──────────────────────────────────────────────

  test('the PWA files are served, and the service worker is never cached', async () => {
    const shell = await fetch(`${app.base}/`);
    assert.equal(shell.status, 200);
    assert.match(shell.headers.get('content-type') ?? '', /text\/html/);

    const worker = await fetch(`${app.base}/sw.js`);
    assert.equal(worker.headers.get('cache-control'), 'no-cache');

    const manifest = await fetch(`${app.base}/manifest.webmanifest`);
    assert.match(manifest.headers.get('content-type') ?? '', /manifest\+json/);
  });

  test('§22 an account cannot be made without both consent answers', async () => {
    // Refused at the door AND inside signUp(), so a caller that skips the
    // screen gets a specific status rather than a 500 — and, more to the
    // point, no row exists to clean up afterwards.
    const email = `consent-${Date.now()}-${++keyCounter}@example.test`;
    const under = await post(app.base, '/api/auth/sign-up', {
      email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai',
      isAdult: false, agreedToTerms: true,
    });
    assert.equal(under.status, 403);
    assert.equal(under.json['error'], 'under_age');

    const unagreed = await post(app.base, '/api/auth/sign-up', {
      email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai',
      isAdult: true, agreedToTerms: false,
    });
    assert.equal(unagreed.status, 400);
    assert.equal(unagreed.json['error'], 'consent_required');

    const missing = await post(app.base, '/api/auth/sign-up', {
      email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai',
    });
    assert.equal(missing.status, 403, 'absent is not the same as true');

    // Nothing was created by any of the three.
    const { rows } = await db().query(`SELECT id FROM users WHERE email = $1`, [email]);
    assert.equal(rows.length, 0, 'a refused sign-up must not leave an account behind');
  });

  test('§22 consent is recorded WITH the version of the text that was agreed to', async () => {
    // Without the version, revising the terms silently reinterprets every
    // existing agreement as being to the new wording.
    const account = await signUp(app.base);
    const { rows } = await db().query<{ is_adult: boolean; consented_at: Date | null; consent_version: string | null }>(
      `SELECT is_adult, consented_at, consent_version FROM users WHERE id = $1`, [account.userId],
    );
    assert.equal(rows[0]!.is_adult, true);
    assert.notEqual(rows[0]!.consented_at, null);
    assert.equal(rows[0]!.consent_version, CONSENT_VERSION);
  });

  test('§21 recovery: forgot, reset, and every other session ending', async () => {
    const account = await signUp(app.base);
    // A second session on the same account, standing in for the intruder.
    const intruder = await post(app.base, '/api/auth/sign-in', { email: account.email, password: 'a-long-enough-password' });
    const intruderToken = intruder.json['sessionToken'] as string | undefined;

    const asked = await post(app.base, '/api/auth/forgot', { email: account.email });
    assert.equal(asked.status, 202);
    assert.equal(asked.json['status'], 'accepted');

    // The token never leaves the server in a response; it is in the row.
    const { rows } = await db().query<{ token_hash: string }>(
      `SELECT token_hash FROM password_resets WHERE user_id = $1 AND used_at IS NULL`, [account.userId],
    );
    assert.equal(rows.length, 1);
    assert.equal(JSON.stringify(asked.json).includes(rows[0]!.token_hash), false, 'the response must not carry the token');

    // The link carries the raw token, and the only place it exists is the
    // email — so the test reads it the way the person does.
    const token = lastResetTokenFor(account.email);
    assert.notEqual(token, null, 'no reset link was produced');
    assert.equal(hashToken(token!), rows[0]!.token_hash, 'the stored hash is of the token that was sent');

    const reset = await post(app.base, '/api/auth/reset', { token, password: 'a-brand-new-password' });
    assert.equal(reset.status, 200, JSON.stringify(reset.json));

    // The old password no longer works.
    const stale = await post(app.base, '/api/auth/sign-in', { email: account.email, password: 'a-long-enough-password' });
    assert.equal(stale.status, 401);
    assert.equal(stale.json['error'], 'rejected');

    // And the intruder's session is gone — that is what the reset was for.
    if (intruderToken !== undefined) {
      const response = await fetch(`${app.base}/api/me`, { headers: { authorization: `Bearer ${intruderToken}` } });
      assert.equal(response.status, 401, 'a reset that leaves the other session alive is ceremonial');
    }

    // Used once.
    const again = await post(app.base, '/api/auth/reset', { token, password: 'yet-another-password' });
    assert.equal(again.status, 400);
    assert.equal(again.json['error'], 'reset_invalid');
  });

  test('§21 asking about an address that has no account is indistinguishable', async () => {
    const known = await signUp(app.base);
    const a = await post(app.base, '/api/auth/forgot', { email: known.email });
    const b = await post(app.base, '/api/auth/forgot', { email: `nobody-${Date.now()}@example.test` });
    assert.equal(a.status, b.status);
    assert.deepEqual(a.json, b.json, 'the two responses must be byte-identical, or this is an enumeration oracle');

    // And no row was created for the address that does not exist.
    const { rows } = await db().query<{ n: string }>(`SELECT count(*)::text AS n FROM password_resets`);
    assert.ok(Number(rows[0]!.n) >= 1);
  });

  test('§21 a forged reset token cannot sign anybody out', async () => {
    const account = await signUp(app.base);
    const before = await fetch(`${app.base}/api/me`, { headers: { authorization: `Bearer ${account.token}` } });
    assert.equal(before.status, 200);
    const forged = await post(app.base, '/api/auth/reset', { token: 'not-a-real-token', password: 'a-long-enough-password' });
    assert.equal(forged.status, 400);
    const after = await fetch(`${app.base}/api/me`, { headers: { authorization: `Bearer ${account.token}` } });
    assert.equal(after.status, 200, 'a refused reset must not revoke a session');
  });

  test('§21 an address is confirmed by the link that was sent to it', async () => {
    const account = await signUp(app.base);
    // Sent at sign-up, without blocking it.
    const verify = lastEmailFor(account.email, /\/confirm-email\?token=([^\s]+)/);
    assert.notEqual(verify, null, 'no confirmation was sent at sign-up');

    const before = await get(app.base, '/api/me', account.token);
    assert.equal((before.json['user'] as { emailVerified: boolean }).emailVerified, false);

    const confirmed = await post(app.base, '/api/auth/confirm-email', { token: verify });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
    const after = await get(app.base, '/api/me', account.token);
    assert.equal((after.json['user'] as { emailVerified: boolean }).emailVerified, true);

    // Once.
    assert.equal((await post(app.base, '/api/auth/confirm-email', { token: verify })).status, 400);
  });

  test('§21 confirming blocks nothing before it happens', async () => {
    // A wall here would be a wall in front of the first conversation.
    const account = await signUp(app.base);
    const said = await sse(app.base, `/api/conversations/${account.conversationId}/messages`,
      { message: 'Hello' }, { token: account.token, key: freshKey() });
    assert.equal(said.status, 200);
    assert.ok(said.events.some((event) => event.event === 'done'), 'an unconfirmed address could not talk to her');
  });

  test('§21 a forged confirmation token confirms nothing', async () => {
    const account = await signUp(app.base);
    assert.equal((await post(app.base, '/api/auth/confirm-email', { token: 'not-a-token' })).status, 400);
    const me = await get(app.base, '/api/me', account.token);
    assert.equal((me.json['user'] as { emailVerified: boolean }).emailVerified, false);
  });

  test('§21 the three emails are in the reader\u2019s language, not English', async () => {
    // The device-confirmation body was the one user-facing string in the
    // product hardcoded in English in a composition root — invisible to the
    // copy tests and to the Arabic gate.
    const account = await signUp(app.base);
    await patch(app.base, '/api/settings', { languageStyle: 'ar-eg' }, account.token);
    const asked = await post(app.base, '/api/auth/forgot', { email: account.email });
    assert.equal(asked.status, 202);
    const message = mail.filter((entry) => entry.to === account.email).at(-1)!;
    assert.match(message.subject, /[\u0600-\u06FF]/, `the subject was not Arabic: ${message.subject}`);
    assert.match(message.body, /[\u0600-\u06FF]/, 'the body was not Arabic');
    assert.match(message.body, /reset-password\?token=/, 'and it still carries the link');
  });

  test('an unknown route answers in JSON rather than an HTML error page', async () => {
    const response = await fetch(`${app.base}/api/nothing-here`);
    assert.equal(response.status, 404);
    assert.equal(((await response.json()) as Json)['error'], 'not_found');
  });

  test('a body that is too large is refused before it is read', async () => {
    const user = await signUp(app.base);
    const response = await fetch(`${app.base}/api/conversations/${user.conversationId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}`, 'idempotency-key': freshKey() },
      body: JSON.stringify({ message: 'x'.repeat(2_000_000) }),
    });
    assert.equal(response.status, 413);
  });
});
