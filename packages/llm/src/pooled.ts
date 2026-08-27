// A provider that takes its key from the pool, and tells the pool what
// happened — LESSONS §12's rotation, finally connected.
//
// The pool has existed and been tested since the first run.  The table has
// existed since migration 0002.  Nothing constructed a KeyPool outside its
// own test, and the composition root did `anthropicProvider(keys[0] ?? '')`,
// so a second key was read from the environment, validated at startup, and
// discarded.  When the first key hit a 429 she stopped answering with a
// spare key sitting unused.
//
// This is the join, and it is deliberately thin: it does not know what a
// completion is, only that a call needs a key and produces a status code.
/**
 * What this needs from a pool: a key, and somewhere to report the outcome.
 *
 * Structural rather than `KeyPool` itself, so the composition root can put a
 * lazy prime in front of `take` without subclassing, and so a test can drive
 * the retry logic without a database.
 */
export type Rotating = {
  take(now: Date): Promise<{ ref: string; key: string } | null>;
  report(ref: string, statusCode: number, now: Date): Promise<void>;
};
import { ProviderError, type Provider, type CompletionRequest, type CompletionResult } from './provider.ts';
import type { ModelCapabilities } from './catalogue.ts';

/**
 * Wrap a per-key provider factory in the pool.
 *
 * `make` is called once per distinct key and its result cached: a provider
 * holds an HTTP client, and building one per request would give up connection
 * reuse for nothing.
 */
export function pooledProvider(
  pool: Rotating,
  make: (apiKey: string) => Provider,
  now: () => Date = () => new Date(),
): Provider {
  const built = new Map<string, Provider>();
  const providerFor = (apiKey: string): Provider => {
    const existing = built.get(apiKey);
    if (existing !== undefined) return existing;
    const made = make(apiKey);
    built.set(apiKey, made);
    return made;
  };

  return {
    id: 'pooled',

    // Capabilities are the MODEL's, not the key's, so this needs no key —
    // which matters, because it is called on paths that must not be able to
    // fail on an exhausted pool.
    capabilities(model: string): ModelCapabilities {
      return make('').capabilities(model);
    },

    async stream(request: CompletionRequest, onDelta: (delta: string) => void): Promise<CompletionResult> {
      // Every key gets at most one attempt per call. Without that bound, a
      // pool where every key 429s becomes an infinite retry loop that looks
      // like a hang rather than a refusal.
      const tried = new Set<string>();
      let last: ProviderError | null = null;

      for (;;) {
        const taken = await pool.take(now());
        if (taken === null || tried.has(taken.ref)) {
          // Nothing usable. If a key actually failed, that error is the true
          // answer and is rethrown; otherwise every key is cooling down, and
          // saying so is more useful than the last 429 from ten minutes ago.
          if (last !== null) throw last;
          throw new ProviderError(
            'every API key is cooling down — see api_key_pool.cooldown_until',
            429, true,
          );
        }
        tried.add(taken.ref);

        try {
          const result = await providerFor(taken.key).stream(request, onDelta);
          // 200. Reported so the failure streak resets — a key that failed
          // twice yesterday and works today should not still be carrying the
          // longer backoff (KeyPool.report).
          await pool.report(taken.ref, 200, now());
          return result;
        } catch (error) {
          if (!(error instanceof ProviderError)) throw error;
          await pool.report(taken.ref, error.statusCode, now());
          // Only a cooldown status is worth another key. A 400 is the
          // REQUEST being wrong, and sending the same wrong request with a
          // different key just spends the pool.
          if (error.statusCode !== 401 && error.statusCode !== 403 && error.statusCode !== 429) throw error;
          last = error;
          // Deltas already emitted stay emitted: a retry after partial output
          // would append a second answer to the first half of one. The
          // provider streams nothing before the request is accepted, so in
          // practice a cooldown status arrives with nothing written — and if
          // that ever stops being true, this is the comment that was wrong.
        }
      }
    },
  };
}
