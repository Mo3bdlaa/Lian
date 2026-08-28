// Billing, end to end, over the real HTTP layer.
//
// The webhook's own defences are tested in packages/billing (as attacks).
// What is tested HERE is the thing those defences are protecting: that the
// plan a person is on follows from what Stripe said, that the same event
// arriving twice does not apply twice, and that the plan gate then actually
// gates — a paid account with a free account's limits is a person who paid
// for nothing.
//
// Stripe itself is faked at the CLIENT boundary rather than at fetch: the
// four calls are the whole surface, and a fake of four functions is a smaller
// lie than a fake of an HTTP API.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createHmac } from 'node:crypto';
import { db, closeDb, migrate, accounts } from '@lian/db';
import { limitsFor } from '@lian/domain';
import { deterministicEmbedder, EMBEDDING_DIMENSIONS, type AnalysisModel } from '@lian/analysis';
import { DEFAULT_MODEL, type Provider } from '@lian/llm';
import { generateVapidKeys } from '@lian/push';
import type { StripeClient, SubscriptionState } from '@lian/billing';
import { createApplication } from './app.ts';
import { loadConfig } from './config.ts';

/**
 * A different client address on every run.
 *
 * These tests send an X-Forwarded-For to model distinct clients — and the
 * `auth:ip:` rate limit is a DATABASE row keyed on that address (LESSONS
 * §12), so a fixed one accumulates across runs and the suite starts failing
 * the second time somebody runs it locally. That is the worst kind of
 * flake: it passes in CI, where the database is new, and fails on the
 * machine of whoever is trying to work.
 *
 * The addresses stay inside 192.0.2.0/24 — TEST-NET-1, which is reserved for
 * documentation and which `isRoutable` refuses, so nothing here ever reaches
 * a geo lookup either.
 */
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
const VAPID = generateVapidKeys();
const WEBHOOK_SECRET = 'whsec_test';
const PERIOD_END = new Date('2026-06-18T06:30:00.000Z');

const provider: Provider = {
  id: 'fake',
  capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 200_000, maxOutputTokens: 4_000 }),
  async stream(request, onDelta) {
    onDelta(request.model === DEFAULT_MODEL ? 'Noted.' : '[]');
    return { usage: { inputTokens: 100, outputTokens: 10, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
  },
};
const analysis: AnalysisModel = { async complete() { return { text: '[]', usage: { inputTokens: 1, outputTokens: 1 } }; } };

/**
 * Each account gets its OWN customer, because in Stripe it would: the schema
 * has a unique index on stripe_customer_id, and two accounts sharing one is a
 * constraint violation rather than a scenario. A fake that shared one would
 * be testing something that cannot happen.
 */
function fakeStripe(): StripeClient {
  return {
    async createCheckout() { return { id: 'cs_test', url: 'https://checkout.stripe.test/session' }; },
    async createPortal() { return { url: 'https://billing.stripe.test/portal' }; },
    async getSubscription(subscriptionId) {
      return {
        subscriptionId, customerId: subscriptionId.replace('sub_', 'cus_'), status: 'active',
        active: true, currentPeriodEnd: PERIOD_END, cancelAtPeriodEnd: false,
      };
    },
  };
}

const sign = (body: string, at: Date = NOW): string => {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', WEBHOOK_SECRET).update(`${t}.${body}`, 'utf8').digest('hex')}`;
};

const subscriptionEvent = (input: { id: string; type: string; userId: string; status: string; cancelAtPeriodEnd?: boolean }): string =>
  JSON.stringify({
    id: input.id, type: input.type,
    data: {
      object: {
        id: `sub_${input.userId}`, customer: `cus_${input.userId}`, status: input.status,
        current_period_end: Math.floor(PERIOD_END.getTime() / 1000),
        cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
        metadata: { user_id: input.userId },
      },
    },
  });

describe('billing, over HTTP', { skip: HAS_DB ? false : 'DATABASE_URL not set' }, () => {
  const created: string[] = [];
  let close: (() => Promise<void>) | null = null;
  let base = '';
  const stripe = fakeStripe();

  before(async () => {
    await migrate(() => {});
    const config = loadConfig({
      NODE_ENV: 'test', DATABASE_URL: process.env['DATABASE_URL'], PORT: '0',
      // ONE TRUSTED PROXY, declared. These tests send an X-Forwarded-For to
      // model distinct clients, and that only means anything if the
      // deployment says a proxy is in front of it. With the default of zero
      // the header is ignored and every request shares the loopback's
      // rate-limit bucket — which is the point of the default, and is what
      // stops an attacker minting fresh buckets by rotating a header.
      LIAN_TRUSTED_PROXIES: '1',
      LIAN_TICK_SECRET: 'x', LIAN_VAPID_PUBLIC_KEY: VAPID.publicKey, LIAN_VAPID_PRIVATE_KEY: VAPID.privateKey,
      LIAN_STRIPE_SECRET_KEY: 'sk_test', LIAN_STRIPE_PRICE_ID: 'price_test',
      LIAN_STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    }).config;
    const { server } = createApplication(config, {
      provider, analysisModel: analysis,
      embedder: deterministicEmbedder(EMBEDDING_DIMENSIONS),
      now: () => NOW, log: () => {}, stripe,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    if (close !== null) await close();
    for (const userId of created) await accounts.deleteAccount({ userId });
    await closeDb();
  });

  let counter = 0;
  async function account(): Promise<{ userId: string; token: string }> {
    counter += 1;
    const response = await fetch(`${base}/api/auth/sign-up`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `bsu-${Date.now()}-${counter}`, 'x-forwarded-for': clientAddress() },
      body: JSON.stringify({
        email: `bill-${Date.now()}-${counter}@example.test`, password: 'a-long-enough-password',
        timeZone: 'Asia/Dubai', isAdult: true, agreedToTerms: true,
      }),
    });
    const json = (await response.json()) as { userId: string; sessionToken: string };
    assert.equal(response.status, 201, JSON.stringify(json));
    created.push(json.userId);
    return { userId: json.userId, token: json.sessionToken };
  }

  const call = (token: string, method: string, path: string, body?: unknown): Promise<Response> => {
    counter += 1;
    return fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json', authorization: `Bearer ${token}`,
        'idempotency-key': `bill-${Date.now()}-${counter}`, 'x-forwarded-for': clientAddress(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };

  const webhook = (body: string, header = sign(body)): Promise<Response> =>
    fetch(`${base}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': header, 'x-forwarded-for': clientAddress() },
      body,
    });

  test('a new account is free, and there is nothing to manage yet', async () => {
    const who = await account();
    const response = await call(who.token, 'GET', '/api/subscription');
    const summary = (await response.json()) as { plan: string; manageable: boolean; renewsOn: string | null };
    assert.equal(summary.plan, 'free');
    assert.equal(summary.manageable, false, 'a portal session for somebody with no customer opens a page about nothing');
    assert.equal(summary.renewsOn, null);
  });

  test('checkout hands back a hosted URL, and this server never sees a card', async () => {
    const who = await account();
    const response = await call(who.token, 'POST', '/api/subscription/checkout');
    const json = (await response.json()) as { url: string };
    assert.equal(response.status, 200);
    assert.match(json.url, /^https:\/\/checkout\.stripe\.test\//);
  });

  test('a signed subscription event makes the account paid, and the plan gate follows', async () => {
    const who = await account();
    // Free limits, before.
    assert.equal(limitsFor('free').voice, false);

    const body = subscriptionEvent({ id: `evt_${Date.now()}`, type: 'customer.subscription.created', userId: who.userId, status: 'active' });
    assert.equal((await webhook(body)).status, 200);

    const { rows } = await db().query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1`, [who.userId]);
    assert.equal(rows[0]!.plan, 'paid');

    const summary = (await (await call(who.token, 'GET', '/api/subscription')).json()) as { plan: string; renewsOn: string; manageable: boolean };
    assert.equal(summary.plan, 'paid');
    assert.equal(summary.renewsOn, PERIOD_END.toISOString());
    assert.equal(summary.manageable, true);

    // The gate itself: voice was refused with 402 on the free plan, and the
    // same route answers now. This is what the subscription is FOR.
    const said = await call(who.token, 'POST', `/api/conversations/${await mainConversation(who.userId)}/messages`, {
      message: 'Hello', clientId: `c-${Date.now()}`,
    });
    await said.text();
    const { rows: messages } = await db().query<{ id: string }>(
      `SELECT m.id FROM messages m JOIN assistants a ON a.id = m.assistant_id
       WHERE a.user_id = $1 AND m.role = 'assistant' ORDER BY m.created_at DESC LIMIT 1`,
      [who.userId],
    );
    const spoken = await call(who.token, 'POST', `/api/messages/${messages[0]!.id}/voice`);
    // 503 because this test has no speech provider — the point is that it is
    // no longer 402, which is what a free account gets.
    assert.notEqual(spoken.status, 402, 'a paid account must not be refused for being on the free plan');
  });

  test('the same event twice is applied once', async () => {
    const who = await account();
    const eventId = `evt_dup_${Date.now()}`;
    const body = subscriptionEvent({ id: eventId, type: 'customer.subscription.created', userId: who.userId, status: 'active' });
    assert.equal((await webhook(body)).status, 200);
    // Stripe delivers at least once and retries on any non-2xx, so a repeat
    // is routine. It must be acknowledged and not re-applied.
    assert.equal((await webhook(body)).status, 200);
    const { rows } = await db().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM billing_events WHERE stripe_event_id = $1`, [eventId],
    );
    assert.equal(rows[0]!.n, '1');
  });

  test('a cancellation is a scheduled end, not an immediate downgrade', async () => {
    const who = await account();
    await webhook(subscriptionEvent({ id: `evt_a_${Date.now()}`, type: 'customer.subscription.created', userId: who.userId, status: 'active' }));
    await webhook(subscriptionEvent({
      id: `evt_c_${Date.now()}`, type: 'customer.subscription.updated',
      userId: who.userId, status: 'active', cancelAtPeriodEnd: true,
    }));

    const summary = (await (await call(who.token, 'GET', '/api/subscription')).json()) as { plan: string; cancelAtPeriodEnd: boolean; renewsOn: string };
    // §18: "what remains until the renewal date". They cancelled; they still
    // have it, and the screen says when it ends.
    assert.equal(summary.plan, 'paid', 'cancelling is not losing it today');
    assert.equal(summary.cancelAtPeriodEnd, true);
    assert.equal(summary.renewsOn, PERIOD_END.toISOString());

    // And when Stripe finally ends it, the plan follows.
    await webhook(subscriptionEvent({
      id: `evt_d_${Date.now()}`, type: 'customer.subscription.deleted', userId: who.userId, status: 'canceled',
    }));
    const { rows } = await db().query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1`, [who.userId]);
    assert.equal(rows[0]!.plan, 'free');
  });

  test('an unsigned webhook changes nothing', async () => {
    const who = await account();
    const body = subscriptionEvent({ id: `evt_forged_${Date.now()}`, type: 'customer.subscription.created', userId: who.userId, status: 'active' });
    const forged = await webhook(body, 't=1,v1=deadbeef');
    assert.equal(forged.status, 400);
    const { rows } = await db().query<{ plan: string }>(`SELECT plan FROM users WHERE id = $1`, [who.userId]);
    assert.equal(rows[0]!.plan, 'free', 'anyone on the internet could otherwise subscribe for free');
  });

  test('an event type nothing acts on is acknowledged rather than refused', async () => {
    // An endpoint that 400s on an unhandled type teaches Stripe to retry it
    // forever, and eventually gets the endpoint disabled.
    const body = JSON.stringify({ id: `evt_x_${Date.now()}`, type: 'invoice.paid', data: { object: { id: 'in_1' } } });
    assert.equal((await webhook(body)).status, 200);
  });

  async function mainConversation(userId: string): Promise<string> {
    const { rows } = await db().query<{ id: string }>(
      `SELECT c.id FROM conversations c JOIN assistants a ON a.id = c.assistant_id WHERE a.user_id = $1`,
      [userId],
    );
    return rows[0]!.id;
  }
});
