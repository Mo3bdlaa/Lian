import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { KeyPool, COOLDOWN_STATUSES, cooldownMs, type KeyPoolStore, type KeyState } from './keypool.ts';

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
