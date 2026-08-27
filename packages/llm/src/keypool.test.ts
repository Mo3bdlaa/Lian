import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPool, COOLDOWN_STATUSES, cooldownMs, type KeyPoolStore, type KeyState } from './keypool.ts';
import { pooledProvider } from './pooled.ts';
import { ProviderError, type Provider } from './provider.ts';

/** A store standing in for the database — shared state, not module state. */
function memoryStore(): KeyPoolStore & { states: Map<string, KeyState> } {
  const states = new Map<string, KeyState>();
  return {
    states,
    async list() { return [...states.values()]; },
    async register(_p, refs) {
      for (const ref of refs) if (!states.has(ref)) states.set(ref, { ref, cooldownUntil: null, consecutiveFails: 0 });
    },
    async penalise(_p, ref, _code, until) {
      const previous = states.get(ref);
      states.set(ref, { ref, cooldownUntil: until, consecutiveFails: (previous?.consecutiveFails ?? 0) + 1 });
    },
    async clear(_p, ref) { states.set(ref, { ref, cooldownUntil: null, consecutiveFails: 0 }); },
  };
}

const NOW = new Date('2026-05-18T10:00:00Z');
const env = { A: 'key-a', B: 'key-b', MISSING: '' };
const read = (ref: string) => env[ref as keyof typeof env];

describe('§12 the key pool rotates and cools down', () => {
  test('only keys actually present in the environment are registered', async () => {
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, read);
    assert.deepEqual(await pool.prime(['A', 'B', 'MISSING', 'ABSENT']), ['A', 'B']);
  });

  test('rotation covers every usable key', async () => {
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, read);
    await pool.prime(['A', 'B']);
    const taken = new Set<string>();
    for (let i = 0; i < 4; i++) taken.add((await pool.take(NOW))!.ref);
    assert.deepEqual([...taken].sort(), ['A', 'B']);
  });

  test('401, 403 and 429 take a key out of rotation — and nothing else does', async () => {
    for (const status of [401, 403, 429]) {
      assert.ok(COOLDOWN_STATUSES.has(status), `${status} must cool down (LESSONS §12)`);
      const store = memoryStore();
      const pool = new KeyPool('anthropic', store, read);
      await pool.prime(['A', 'B']);
      await pool.report('A', status, NOW);
      for (let i = 0; i < 4; i++) assert.equal((await pool.take(NOW))!.ref, 'B', `${status}: A must be out of rotation`);
    }
    // A 500 is the provider's problem, not the key's.
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, read);
    await pool.prime(['A']);
    await pool.report('A', 500, NOW);
    assert.equal((await pool.take(NOW))!.ref, 'A');
  });

  test('a cooled key returns when its cooldown expires', async () => {
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, read);
    await pool.prime(['A']);
    await pool.report('A', 429, NOW);
    assert.equal(await pool.take(NOW), null, 'no usable key while cooling');
    const later = new Date(NOW.getTime() + cooldownMs(429, 0) + 1);
    assert.equal((await pool.take(later))!.ref, 'A');
  });

  test('repeated failures back off, and a success clears the count', async () => {
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, read);
    await pool.prime(['A']);
    await pool.report('A', 429, NOW);
    await pool.report('A', 429, NOW);
    assert.equal(store.states.get('A')!.consecutiveFails, 2);
    assert.ok(cooldownMs(429, 2) > cooldownMs(429, 0));
    await pool.report('A', 200, NOW);
    assert.equal(store.states.get('A')!.consecutiveFails, 0);
    assert.equal(store.states.get('A')!.cooldownUntil, null);
  });

  test('an auth failure cools longer than a rate limit — it is not transient', () => {
    assert.ok(cooldownMs(401, 0) > cooldownMs(429, 0));
  });

  test('the pool state is in the store, not in the instance', async () => {
    // A second process (a second KeyPool over the same store) sees the cooldown.
    const store = memoryStore();
    const one = new KeyPool('anthropic', store, read);
    await one.prime(['A']);
    await one.report('A', 429, NOW);
    const two = new KeyPool('anthropic', store, read);
    assert.equal(await two.take(NOW), null, 'in-process state would let the second instance through');
  });
});

describe('the pool, joined to a provider (LESSONS §12)', () => {
  const AT = new Date('2026-05-18T09:00:00.000Z');

  /** A provider whose every call fails with one status, counted per key. */
  function failing(statusFor: (key: string) => number | null): { provider: (key: string) => Provider; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      provider: (key: string) => ({
        id: `fake:${key}`,
        capabilities: () => ({ streaming: true, toolCalling: false, vision: false, contextTokens: 1_000, maxOutputTokens: 100 }),
        async stream() {
          calls.push(key);
          const status = statusFor(key);
          if (status !== null) throw new ProviderError(`status ${status}`, status, status >= 500);
          return { usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 }, stopReason: 'end_turn' };
        },
      }),
    };
  }

  const request = { model: 'm', system: [], messages: [], maxOutputTokens: 10, effort: 'low' } as never;

  test('a 429 on the first key is answered by the second', async () => {
    // The whole point, and what was missing: KeyPool was constructed nowhere
    // outside this file, and app.ts took modelApiKeys[0]. An operator who set
    // ANTHROPIC_API_KEY_2 had it validated at startup and never used, so a
    // rate-limited first key meant she stopped answering.
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, (ref) => ({ A: 'key-a', B: 'key-b' })[ref]);
    await pool.prime(['A', 'B']);
    const fake = failing((key) => (key === 'key-a' ? 429 : null));

    const result = await pooledProvider(pool, fake.provider, () => AT).stream(request, () => {});

    assert.equal(result.stopReason, 'end_turn');
    assert.deepEqual(fake.calls, ['key-a', 'key-b'], 'the second key was never reached');
    // And the first one is out of rotation, so the next call does not pay the
    // same 429 again.
    assert.ok(store.states.get('A')!.cooldownUntil! > AT);
  });

  test('a 400 is not retried on another key — the REQUEST is wrong', async () => {
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, (ref) => ({ A: 'key-a', B: 'key-b' })[ref]);
    await pool.prime(['A', 'B']);
    const fake = failing(() => 400);

    await assert.rejects(
      () => pooledProvider(pool, fake.provider, () => AT).stream(request, () => {}),
      /status 400/,
    );
    // Sending the same bad request with a different key only spends the pool.
    assert.deepEqual(fake.calls, ['key-a']);
    assert.equal(store.states.get('A')?.cooldownUntil ?? null, null);
  });

  test('every key cooling down is a refusal, not a loop', async () => {
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, (ref) => ({ A: 'key-a', B: 'key-b' })[ref]);
    await pool.prime(['A', 'B']);
    const fake = failing(() => 429);

    await assert.rejects(() => pooledProvider(pool, fake.provider, () => AT).stream(request, () => {}), /status 429/);
    // Each key tried exactly once. Without that bound this is an infinite
    // retry that looks like a hang rather than a refusal.
    assert.deepEqual(fake.calls, ['key-a', 'key-b']);

    // And with all of them cooling down, the next call says so rather than
    // reporting somebody else's stale 429.
    await assert.rejects(
      () => pooledProvider(pool, fake.provider, () => AT).stream(request, () => {}),
      /every API key is cooling down/,
    );
  });

  test('a success clears the streak, so yesterday does not lengthen today', async () => {
    const store = memoryStore();
    const pool = new KeyPool('anthropic', store, () => 'key-a');
    await pool.prime(['A']);
    await pool.report('A', 429, AT);
    assert.equal(store.states.get('A')!.consecutiveFails, 1);

    const later = new Date(AT.getTime() + 60 * 60_000);
    const fake = failing(() => null);
    await pooledProvider(pool, fake.provider, () => later).stream(request, () => {});
    assert.equal(store.states.get('A')!.consecutiveFails, 0);
  });
});
