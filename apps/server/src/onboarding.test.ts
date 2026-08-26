// Onboarding, end to end, through the real HTTP layer.
//
// Client addresses here are in 192.0.2.0/24 and nowhere else in the suite:
// sign-up is rate limited per address, so two test files sharing one address
// make the limiter the thing under test — and only when they happen to run in
// the same minute, which is the worst kind of failure to chase.
//
// PRD §8: onboarding is a conversation whose emotional goal is "she remembers
// me". There is no wizard, no form and no step counter — the state is the set
// of facts she has, and the next question is whichever one is missing.
//
// So this test does not check a sequence of screens. It signs up, talks to
// her over the same route the product uses, and asserts what she is being
// told to find out next — including the one ordering rule that is a product
// decision rather than a UI preference: the notification permission is asked
// AFTER she has remembered something, never before.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { db, closeDb, migrate, accounts } from '@lian/db';
import { nextStep } from '@lian/domain';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type CompletionRequest, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import { createApplication } from './app.ts';
import { loadConfig } from './config.ts';

const HAS_DB = (process.env['DATABASE_URL'] ?? '') !== '';
const NOW = new Date('2026-05-18T06:30:00.000Z');
const VAPID = generateVapidKeys();

/** Her replies, in order, each one able to carry control tags. */
function scriptedProvider(replies: string[]): Provider & { chatRequests: CompletionRequest[] } {
  const chatRequests: CompletionRequest[] = [];
  let next = 0;
  return {
    chatRequests,
    id: 'scripted',
    capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
    async stream(request, onDelta) {
      if (request.model === DEFAULT_MODEL) {
        chatRequests.push(request);
        onDelta(replies[Math.min(next++, replies.length - 1)]!);
      } else {
        // The analysis model on the same provider: canon extraction.
        onDelta('[]');
      }
      return { usage: { inputTokens: 900, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
    },
  };
}

/** Extraction, faked: one memory from the exchange that mentions running. */
function scriptedAnalysis(): AnalysisModel {
  return {
    async complete(input) {
      const remembers = input.user.includes('run every morning');
      return {
        text: remembers
          ? JSON.stringify([{ type: 'fact', statement: 'They run every morning before work.', salience: 0.7 }])
          : '[]',
        usage: { inputTokens: 200, outputTokens: 20 },
      };
    },
  };
}

describe('onboarding, over HTTP', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  const created: string[] = [];
  let close: (() => Promise<void>) | null = null;

  before(async () => { await migrate(() => {}); });
  after(async () => {
    if (close !== null) await close();
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  test('she asks one thing at a time, and asks about notifications only after she has remembered something', async () => {
    const provider = scriptedProvider([
      // 1. greet — she asks what to call them
      'I keep track of things for you. What should I call you?',
      // 2. they answer; she records it
      'Good to meet you, Adam. <call_me>{"name":"Adam"}</call_me> Which language suits you?',
      // 3. language
      'English it is. <language>{"style":"en"}</language> Tell me what your week looks like.',
      // 4. the thing she remembers
      'I will remember that you run every morning before work.',
      // 5. after the memory: she raises notifications herself
      'I can reach you when the app is closed, if you would like that.',
      // 6. they name her
      'Then I am Noor. <my_name>{"name":"Noor","chosenByThem":true}</my_name>',
      // 7. onboarding is over
      'What is on today?',
    ]);

    const config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env['DATABASE_URL'], PORT: '0',
      LIAN_TICK_SECRET: 'x', LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
    }).config;
    const { server } = createApplication(config, {
      provider, analysisModel: scriptedAnalysis(),
      embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS), now: () => NOW, log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    let key = 0;
    const say = async (message: string, token: string): Promise<string> => {
      const response = await fetch(`${base}/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json', authorization: `Bearer ${token}`,
          'idempotency-key': `ob-${Date.now()}-${++key}`, 'x-forwarded-for': `192.0.2.${key}`,
        },
        body: JSON.stringify({ message }),
      });
      return response.text();
    };

    // ── sign up ───────────────────────────────────────────────────────────
    const email = `ob-${Date.now()}@example.test`;
    const signUp = await fetch(`${base}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `su-${Date.now()}`, 'x-forwarded-for': '192.0.2.100' },
      body: JSON.stringify({ email, password: 'a-long-enough-password', timeZone: 'Asia/Dubai' }),
    });
    const account = (await signUp.json()) as { userId: string; sessionToken: string };
    created.push(account.userId);
    const { rows } = await db().query<{ id: string; assistant_id: string }>(
      `SELECT c.id, c.assistant_id FROM conversations c JOIN assistants a ON a.id = c.assistant_id WHERE a.user_id = $1`,
      [account.userId],
    );
    const conversationId = rows[0]!.id;
    const scope = { userId: account.userId, assistantId: rows[0]!.assistant_id };

    const step = async (): Promise<string> => nextStep(await accounts.onboardingFacts(scope));

    // Nothing known yet: she introduces herself and asks for a name.
    assert.equal(await step(), 'greet');
    await say('hello', account.sessionToken);
    // The prompt she was given said so, in the onboarding block.
    assert.match(provider.chatRequests[0]!.messages.at(-1)!.content, /Introduce yourself|ask what to call them/i);

    // They answer, and her control tag records it — no form, no field.
    await say("I'm Adam.", account.sessionToken);
    assert.equal(await step(), 'learn_language');

    await say('English, please.', account.sessionToken);
    assert.equal(await step(), 'learn_something');

    // The moment the product exists for.
    await say('I run every morning before work.', account.sessionToken);
    const memories = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM memories WHERE assistant_id = $1 AND deleted_at IS NULL`, [scope.assistantId],
    );
    assert.equal(memories.rows[0]!.n, 1, 'she remembered nothing, so there is nothing to ask permission for');

    // ── the ordering rule ─────────────────────────────────────────────────
    // Only NOW does she ask about notifications.
    assert.equal(await step(), 'ask_notification_permission');
    const turn = await say('That is right.', account.sessionToken);
    assert.ok(turn.includes('reach you'), 'she did not raise it');
    assert.match(
      provider.chatRequests.at(-1)!.messages.at(-1)!.content,
      /reach them even when the app is closed/i,
      'the instruction to ask arrives only after the first remembered moment',
    );

    // The browser answers. Declined, and she still moves on — asking twice is
    // the failure this route exists to prevent.
    const declined = await fetch(`${base}/api/push/prompted`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${account.sessionToken}`,
        'idempotency-key': `np-${Date.now()}`, 'x-forwarded-for': '192.0.2.101',
      },
      body: JSON.stringify({ outcome: 'denied' }),
    });
    assert.equal(declined.status, 200);
    assert.equal(await step(), 'name_her');

    // ── she gets her name from them (Q18) ─────────────────────────────────
    await say('You can be Noor.', account.sessionToken);
    assert.equal(await step(), 'done');

    const assistant = await accounts.getAssistant(scope);
    assert.equal(assistant?.name, 'Noor');

    // Finishing is a funnel milestone, recorded once (PRD §18).
    await say('What is on today?', account.sessionToken);
    const events = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM events WHERE user_id = $1 AND name = 'onboarding_completed'`, [account.userId],
    );
    assert.equal(events.rows[0]!.n, 1, 'completion should be recorded exactly once');

    // And she stops being told about onboarding at all.
    const afterwards = provider.chatRequests.at(-1)!;
    assert.doesNotMatch(afterwards.messages.at(-1)!.content, /ask what to call them|name they give you/i);
    assert.doesNotMatch(afterwards.system.map((segment) => segment.text).join('\n'), /call_me|my_name/,
      'the identity tags are offered during onboarding only');
  });

  test('a person who grants the permission is counted, and one who declines is not', async () => {
    // PRD §18 counts notification opt-in as a success metric, so the two
    // answers must be distinguishable — while both stop her asking again.
    const config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env['DATABASE_URL'], PORT: '0',
      LIAN_TICK_SECRET: 'x', LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
    }).config;
    const { server } = createApplication(config, {
      provider: scriptedProvider(['Hello.']), analysisModel: scriptedAnalysis(),
      embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS), now: () => NOW, log: () => {},
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const signUpOne = async () => {
      const response = await fetch(`${base}/api/auth/sign-up`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `su-${Date.now()}-${Math.random()}`, 'x-forwarded-for': '192.0.2.110' },
        body: JSON.stringify({ email: `perm-${Date.now()}-${Math.random()}@example.test`, password: 'a-long-enough-password', timeZone: 'UTC' }),
      });
      const account = (await response.json()) as { userId: string; sessionToken: string };
      created.push(account.userId);
      return account;
    };

    const granting = await signUpOne();
    const subscribe = await fetch(`${base}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${granting.sessionToken}`,
        'idempotency-key': `sub-${Date.now()}`, 'x-forwarded-for': '192.0.2.111',
      },
      body: JSON.stringify({ endpoint: 'https://push.example.test/abc', keys: { p256dh: 'BPk', auth: 'xyz' } }),
    });
    assert.equal(subscribe.status, 201);

    const declining = await signUpOne();
    await fetch(`${base}/api/push/prompted`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${declining.sessionToken}`,
        'idempotency-key': `np-${Date.now()}`, 'x-forwarded-for': '192.0.2.112',
      },
      body: JSON.stringify({ outcome: 'denied' }),
    });

    const asked = await db().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[]) AND notification_prompted_at IS NOT NULL`,
      [[granting.userId, declining.userId]],
    );
    assert.equal(asked.rows[0]!.n, 2, 'both were asked, so neither should be asked again');

    const granted = await db().query<{ user_id: string }>(
      `SELECT user_id FROM events WHERE name = 'notification_permission_granted' AND user_id = ANY($1::uuid[])`,
      [[granting.userId, declining.userId]],
    );
    assert.deepEqual(granted.rows.map((row) => row.user_id), [granting.userId]);

    await new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  });
});
