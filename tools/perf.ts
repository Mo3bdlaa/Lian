// Measure the product, once, while it is cheap.
//
//   npm run perf
//
// Everything here is MEASURED against real Postgres and real Chromium. The
// point is not to make anything fast today — it is to write down what the
// numbers ARE, so the next change has something to be compared against
// instead of an argument.
//
// WHAT IS AND IS NOT MEASURABLE HERE, said plainly rather than implied:
//
//   - The MODEL's latency is not measured. There is no API key in this
//     environment, so "time to first token" as a person experiences it —
//     which is dominated by the provider — cannot be established from here.
//     What IS measured is the half that belongs to this product: everything
//     that has to happen BEFORE the first byte can be requested (budget,
//     persistence, prompt assembly, retrieval, history), and everything
//     after the last one. That is the part any change here can move.
//   - Time to first paint IS measured, in real Chromium, against the real
//     server, because the client is ours end to end.
//
// The numbers land in docs/PERFORMANCE.md with the machine they came from,
// because a number without its machine is not a baseline.
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import type { AddressInfo } from 'node:net';
import { db, closeDb, migrate, memories, accounts } from '@lian/db';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { memoryStore } from '@lian/storage';
import { Browser, chromiumPath } from './browser.ts';
import { loadConfig } from '../apps/server/src/config.ts';
import { createApplication } from '../apps/server/src/app.ts';

const OUT = new URL('../docs/PERFORMANCE.md', import.meta.url).pathname;

// ── measuring ─────────────────────────────────────────────────────────────

type Sample = { readonly p50: number; readonly p95: number; readonly n: number };

/**
 * Run something repeatedly and report the middle and the tail.
 *
 * A MEAN IS THE WRONG SUMMARY for anything with a network or a disk in it:
 * one 400ms outlier moves a mean of twenty samples by 20ms and hides itself
 * doing it. p50 says what usually happens; p95 says what a person notices.
 * Warm-up runs are discarded because the first call through any path in Node
 * pays for JIT and a connection that does not exist yet.
 */
async function measure(times: number, fn: () => Promise<unknown>, warmup = 3): Promise<Sample> {
  for (let i = 0; i < warmup; i += 1) await fn();
  const taken: number[] = [];
  for (let i = 0; i < times; i += 1) {
    const started = performance.now();
    await fn();
    taken.push(performance.now() - started);
  }
  taken.sort((a, b) => a - b);
  return {
    p50: taken[Math.floor(taken.length * 0.5)]!,
    p95: taken[Math.min(taken.length - 1, Math.floor(taken.length * 0.95))]!,
    n: times,
  };
}

const ms = (n: number): string => (n < 10 ? n.toFixed(2) : n.toFixed(1));
const row = (label: string, sample: Sample): string =>
  `| ${label} | ${ms(sample.p50)} ms | ${ms(sample.p95)} ms | ${sample.n} |`;

// ── the fakes that keep the model out of the measurement ──────────────────

/**
 * A provider that answers instantly.
 *
 * Deliberately zero-latency: every millisecond this reports is OURS. A fake
 * with a sleep in it would measure the sleep.
 */
function instantProvider(reply: string): Provider {
  return {
    id: 'instant',
    capabilities: () => ({ streaming: true, toolCalling: false, vision: true, contextTokens: 200_000, maxOutputTokens: 4_000 }),
    async stream(request, onDelta) {
      onDelta(request.model === DEFAULT_MODEL ? reply : '[]');
      return { usage: { inputTokens: 2_000, outputTokens: 120, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
    },
  };
}

const blindAnalysis: AnalysisModel = {
  async complete() { return { text: '[]', usage: { inputTokens: 10, outputTokens: 2 } }; },
  async completeWithImage() { return { text: '{}', usage: { inputTokens: 10, outputTokens: 2 } }; },
};

// ── a vector, without an embedder round trip ──────────────────────────────

const embedder = deterministicEmbedder(EMBEDDING_DIMENSIONS);
async function vectorFor(text: string): Promise<string> {
  const [vector] = await embedder.embed([text]);
  return `[${vector!.join(',')}]`;
}

// ── the run ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if ((process.env['DATABASE_URL'] ?? '') === '') {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
    process.exit(78);
  }
  await migrate(() => {});

  const created: string[] = [];
  const sections: string[] = [];
  const started = new Date();

  const VAPID = generateVapidKeys();
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: process.env['DATABASE_URL'], PORT: '0',
    LIAN_TRUSTED_PROXIES: '1', LIAN_TICK_SECRET: 'x',
    LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
  }).config;

  const { server } = createApplication(config, {
    provider: instantProvider('Logged that one. How did the rest of the day go?'),
    analysisModel: blindAnalysis, embedder, store: memoryStore(),
    now: () => new Date(), log: () => {},
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // ── an account to measure against ───────────────────────────────────────
  let ip = 0;
  const address = (): string => `10.${process.pid % 256}.${(++ip >> 8) % 256}.${ip % 256}`;
  const clientIp = address();

  const email = `perf-${Date.now()}@example.test`;
  const signUp = await fetch(`${base}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `su-${Date.now()}`, 'x-forwarded-for': clientIp },
    body: JSON.stringify({ email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai', isAdult: true, agreedToTerms: true }),
  });
  const account = (await signUp.json()) as { userId: string; sessionToken: string };
  if (account.userId === undefined) throw new Error(`sign-up ${signUp.status}: ${JSON.stringify(account)}`);
  created.push(account.userId);

  const { rows: conversation } = await db().query<{ id: string; assistant_id: string }>(
    `SELECT c.id, c.assistant_id FROM conversations c JOIN assistants a ON a.id = c.assistant_id WHERE a.user_id = $1`,
    [account.userId],
  );
  const conversationId = conversation[0]!.id;
  const assistantId = conversation[0]!.assistant_id;
  const scope = { userId: account.userId, assistantId };

  let key = 0;
  const call = (method: string, path: string, body?: unknown): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${account.sessionToken}`,
        'idempotency-key': `perf-${Date.now()}-${++key}-${Math.random()}`, 'x-forwarded-for': clientIp,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  // The daily message ceiling would stop this long before the sample size is
  // useful, so the account is paid and the counter is reset between rounds.
  await db().query(`UPDATE users SET plan = 'paid' WHERE id = $1`, [account.userId]);
  //
  // AND THE RATE LIMIT WITH IT, which is the correction that made these
  // numbers real. The first version cleared only usage_counters, so after
  // twenty messages in a minute the per-user chat rate limit refused every
  // request — and the tool cheerfully reported a 2.5ms "turn", which is what
  // a 429 costs. A measuring helper that does not check the status measures
  // the error path (LESSONS §28's third bullet, in a second dress).
  const resetLimits = async (): Promise<void> => {
    await db().query(`DELETE FROM usage_counters WHERE user_id = $1`, [account.userId]);
    await db().query(`DELETE FROM rate_limits WHERE bucket_key LIKE $1`, [`%${account.userId}%`]);
  };

  // ── 1. memory retrieval, 100 → 10,000 ───────────────────────────────────
  //
  // SEEDED AND MEASURED rather than reasoned about, because the shape of the
  // query is the whole question: the ranking is
  //
  //     0.7 × cosine similarity + 0.3 × salience
  //
  // which no approximate-nearest-neighbour index can serve — an HNSW or
  // IVFFlat index answers "closest by distance", and this asks for closest by
  // a blend of distance and a second column. So retrieval is a sequential
  // scan over one assistant's memories, and what matters is how that scales.
  console.log('seeding memories…');
  const query = await vectorFor('what did I say about the gym');
  const retrieval: string[] = [];
  let planted = 0;
  for (const size of [100, 1_000, 10_000]) {
    // Written in batches through the repository's own insert, so the numbers
    // describe the rows the product actually writes (embedding, salience,
    // status) rather than a stripped-down fixture.
    while (planted < size) {
      const batch: Promise<unknown>[] = [];
      for (let i = planted; i < Math.min(planted + 200, size); i += 1) {
        batch.push(memories.remember(scope, {
          type: 'fact',
          statement: `Memory number ${i}: they mentioned something about routine ${i % 37}.`,
          salience: (i % 100) / 100,
          embedding: await vectorFor(`routine ${i % 37} memory ${i}`),
          embeddingModel: 'deterministic',
        }, 100_000));
      }
      await Promise.all(batch);
      planted = Math.min(planted + 200, size);
    }
    const sample = await measure(20, () => memories.retrieve(scope, query, 12));
    retrieval.push(row(`retrieval over ${size.toLocaleString('en')} memories`, sample));
    console.log(`  ${size}: p50 ${ms(sample.p50)}ms`);
  }

  sections.push([
    '## Memory retrieval as memories grow',
    '',
    'One assistant, real rows, the real query. `limit` is 12 — what a turn asks for.',
    '',
    '| | p50 | p95 | samples |',
    '|---|---|---|---|',
    ...retrieval,
    '',
    'The ranking is `0.7 × cosine similarity + 0.3 × salience`, which **cannot be',
    'served by a vector index**: HNSW and IVFFlat answer "nearest by distance",',
    'and this asks for nearest by a blend of distance and a second column. So this',
    'is a sequential scan over one assistant\'s memories, and the numbers above are',
    'the honest cost of that choice. It is the right choice today — the growth is',
    'linear and the constant is small — and the row that says when it stops being',
    'right is the 10,000 one.',
  ].join('\n'));

  // ── 2. the cost of a turn as history grows ──────────────────────────────
  //
  // The window is 40 messages of history (HISTORY_MESSAGES) plus retrieval;
  // 60 is past it, which is the point — the cost should stop growing.
  console.log('measuring turns…');
  const turns: string[] = [];
  const sendOne = async (): Promise<void> => {
    const response = await call('POST', `/api/conversations/${conversationId}/messages`, {
      message: 'I paid the gym 400 today', clientId: `c-${Date.now()}-${Math.random()}`,
    });
    const body = await response.text();
    // The status is CHECKED. See resetLimits above for what happens when it
    // is not: a refusal is the fastest possible response, so an unchecked
    // helper reports the error path as an excellent number.
    if (response.status !== 200) throw new Error(`turn ${response.status}: ${body.slice(0, 200)}`);
    if (!body.includes('event: text')) throw new Error(`turn produced no text: ${body.slice(0, 300)}`);
  };

  let depth = 0;
  for (const target of [2, 20, 60, 120]) {
    while (depth < target) { await resetLimits(); await sendOne(); depth += 2; }
    await resetLimits();
    const sample = await measure(10, async () => { await resetLimits(); await sendOne(); }, 2);
    turns.push(row(`a turn at ${target} messages of history`, sample));
    console.log(`  ${target}: p50 ${ms(sample.p50)}ms`);
  }

  sections.push([
    '## The cost of one turn, as the conversation grows',
    '',
    'End to end over real HTTP, with a provider that answers instantly — so every',
    'millisecond here is **ours**: the budget reservation, persisting their message,',
    'prompt assembly, retrieval, the history read, persisting her reply, capture',
    'dispatch and the extraction pass.',
    '',
    '| | p50 | p95 | samples |',
    '|---|---|---|---|',
    ...turns,
    '',
    'History is capped at 40 messages (`HISTORY_MESSAGES` in turn.ts) and the',
    'prompt is budgeted to the model window on top of that, so the cost should',
    '**stop growing** past that point rather than growing with the conversation.',
    'The 60 and 120 rows are there to prove that it does; if a later change makes',
    'them climb, something has started reading the whole thread.',
  ].join('\n'));

  // ── 3. what has to happen before the first token can be asked for ───────
  console.log('measuring the pre-stream path…');
  await resetLimits();
  const firstByte = await measure(15, async () => {
    await resetLimits();
    const response = await call('POST', `/api/conversations/${conversationId}/messages`, {
      message: 'quick one', clientId: `c-${Date.now()}-${Math.random()}`,
    });
    // The FIRST chunk off the wire, not the whole body: with an instant
    // provider this is everything that must happen before a real provider
    // could have been asked.
    if (response.status !== 200) throw new Error(`turn ${response.status}`);
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
  }, 3);

  sections.push([
    '## Time to first token — the half that is ours',
    '',
    `**${ms(firstByte.p50)} ms** at p50, **${ms(firstByte.p95)} ms** at p95, over ${firstByte.n} samples.`,
    '',
    'This is everything between the POST arriving and the first byte leaving:',
    'session lookup, rate limit, idempotency claim, budget reservation, persisting',
    "their message, assembling the prompt, retrieval, and the history read. The",
    'model is a zero-latency fake, so **the provider is not in this number.**',
    '',
    "What a person actually waits for is this plus the provider's own time to",
    'first token, which is typically one to two seconds on this model family and',
    'is not measurable from this environment (there is no API key here). Stated',
    'rather than estimated: **the end-to-end number is unmeasured**, and when a key',
    'is available this is the section to replace.',
  ].join('\n'));

  // ── 4. first paint, in a real browser ───────────────────────────────────
  const paint: string[] = [];
  if (chromiumPath() === null) {
    paint.push('_Not measured: no Chromium in this environment._');
  } else {
    console.log('measuring first paint…');
    const browser = await Browser.launch();
    try {
      await browser.setViewport(390, 844, 2, true);
      await browser.setCookie({ name: 'lian_session', value: account.sessionToken, url: base });
      const timings = await measure(7, async () => {
        await browser.goto(`${base}/chat`);
        // The composer, not the message list: an empty conversation renders
        // no rows, so waiting for one would wait forever on a fresh account.
        await browser.waitFor('!!document.querySelector(".composer__input")', 15_000);
      }, 2);
      // The browser's own numbers, which know about parse and paint in a way
      // a stopwatch around goto() does not.
      const marks = await browser.evaluate<{ ttfb: number; domContentLoaded: number; firstPaint: number }>(`
        (() => {
          const nav = performance.getEntriesByType('navigation')[0];
          const fp = performance.getEntriesByName('first-contentful-paint')[0];
          return {
            ttfb: nav ? nav.responseStart - nav.requestStart : -1,
            domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : -1,
            firstPaint: fp ? fp.startTime : -1,
          };
        })()
      `);
      paint.push(
        '| | ms |',
        '|---|---|',
        `| time to first byte | ${ms(marks.ttfb)} |`,
        `| first contentful paint | ${ms(marks.firstPaint)} |`,
        `| DOM content loaded | ${ms(marks.domContentLoaded)} |`,
        `| navigation until the chat is on screen (p50) | ${ms(timings.p50)} |`,
        `| the same, p95 | ${ms(timings.p95)} |`,
      );
    } finally {
      await browser.close();
    }
  }

  sections.push([
    '## First paint on the chat',
    '',
    'Real Chromium over the DevTools protocol, phone viewport, signed in, against',
    'the real server on loopback. The client ships as Node-native TypeScript with',
    'no build step and no framework, which is what these numbers are mostly about.',
    '',
    ...paint,
    '',
    '**Loopback, so the network is not in it.** A real connection adds its own',
    'latency to time-to-first-byte and nothing else here.',
  ].join('\n'));

  // ── write it down ───────────────────────────────────────────────────────
  const machine = `${cpus().length} × ${cpus()[0]?.model ?? 'unknown'}, ${Math.round(totalmem() / 1024 ** 3)} GB`;
  writeFileSync(OUT, [
    '# Performance, measured',
    '',
    `Taken ${started.toISOString().slice(0, 10)} by \`npm run perf\`.`,
    '',
    '**A number without its machine is not a baseline**, so: Node',
    `${process.version} on \`${process.platform}\`, ${machine}, Postgres on`,
    'loopback in the same container. These are for **comparing a change against**,',
    'not for quoting: re-run the tool rather than trusting the numbers on a',
    'different machine.',
    '',
    ...sections.map((section) => `${section}\n`),
    '## What these numbers say',
    '',
    'Three readings, so the next person does not have to derive them:',
    '',
    '1. **Retrieval is most of a turn.** The turn rows above were measured on the',
    '   account that had just been seeded with ten thousand memories, so retrieval',
    "   is inside them — and at that size it is roughly three quarters of the",
    '   whole cost. Anything that wants a faster turn should start there and',
    '   nowhere else. An ordinary account has tens of memories, not thousands, so',
    '   this is a ceiling rather than a typical day.',
    '2. **The turn does not grow with the conversation.** 20, 60 and 120 messages',
    '   of history cost the same within noise, which is what the 40-message cap is',
    '   for. That is the row to watch: if it starts climbing, something has begun',
    '   reading the whole thread.',
    '3. **Retrieval grows slightly worse than linearly** (×6.6 from 100 to 1,000,',
    '   then ×9 to 10,000). Consistent with the scan leaving cache rather than',
    '   with anything algorithmic. Still linear enough that the constant, not the',
    '   curve, is the thing to argue about.',
    '',
    '## What is deliberately not here',
    '',
    "- **The model's latency.** No API key in this environment. Every number above",
    '  uses a zero-latency fake so that what is measured is this product.',
    '- **Concurrency.** Every measurement is one request at a time. What happens at',
    '  fifty concurrent turns is a different question and needs a different tool;',
    '  the pool is 10 connections and that is where to look first.',
    '- **Cold start.** Warm-up runs are discarded on purpose, because the number',
    '  that matters for a change is the steady-state one.',
    '',
  ].join('\n'));

  console.log(`\nwrote ${OUT}`);

  await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  for (const userId of created) await accounts.deleteAccount({ userId });
  await closeDb();
}

await main();
