// API key pool — LESSONS §12.
//
// "API key pools must rotate and cool down on 429, 403 and 401."  And:
// "Rate limiting held in process memory resets on every cold start and is
// per-instance. It is not a rate limit."  Both apply here: the pool's state
// lives behind a store port so it is shared across instances, and the same
// is true of the cooldown.
//
// The KEY ITSELF is never stored — only a reference to the environment
// variable that holds it.  A database is not a place secrets should
// accumulate, and this product is sold on the user holding their own keys.
export type KeyRef = { readonly provider: string; readonly ref: string };

export type KeyState = {
  readonly ref: string;
  readonly cooldownUntil: Date | null;
  readonly consecutiveFails: number;
};

/** Implemented by @lian/db in the composition root. */
export type KeyPoolStore = {
  list(provider: string): Promise<KeyState[]>;
  register(provider: string, refs: string[]): Promise<void>;
  penalise(provider: string, ref: string, statusCode: number, until: Date): Promise<void>;
  clear(provider: string, ref: string): Promise<void>;
};

/** Status codes that take a key out of rotation, per LESSONS §12. */
export const COOLDOWN_STATUSES = new Set([401, 403, 429]);

/** Backoff per consecutive failure, in milliseconds.  A 401 is not transient,
 *  so it earns the long end quickly; a 429 usually clears in a minute. */
export function cooldownMs(statusCode: number, consecutiveFails: number): number {
  const base = statusCode === 429 ? 60_000 : 15 * 60_000;
  return Math.min(base * 2 ** Math.max(0, consecutiveFails), 6 * 60 * 60_000);
}

export class KeyPool {
  readonly #provider: string;
  readonly #store: KeyPoolStore;
  readonly #read: (ref: string) => string | undefined;
  #cursor = 0;

  constructor(provider: string, store: KeyPoolStore, read: (ref: string) => string | undefined = (r) => process.env[r]) {
    this.#provider = provider;
    this.#store = store;
    this.#read = read;
  }

  /** Register the refs present in the environment.  Missing ones are skipped
   *  rather than registered as broken keys. */
  async prime(refs: readonly string[]): Promise<string[]> {
    const present = refs.filter((ref) => (this.#read(ref) ?? '') !== '');
    await this.#store.register(this.#provider, present);
    return present;
  }

  /** The next usable key, round-robin over what is not cooling down. */
  async take(now: Date): Promise<{ ref: string; key: string } | null> {
    const states = await this.#store.list(this.#provider);
    const usable = states.filter((s) => s.cooldownUntil === null || s.cooldownUntil <= now);
    if (usable.length === 0) return null;
    for (let i = 0; i < usable.length; i++) {
      const state = usable[(this.#cursor + i) % usable.length]!;
      const key = this.#read(state.ref);
      if (key !== undefined && key !== '') {
        this.#cursor = (this.#cursor + i + 1) % usable.length;
        return { ref: state.ref, key };
      }
    }
    return null;
  }

  /** Report the outcome of a call.  Success clears the failure count. */
  async report(ref: string, statusCode: number, now: Date): Promise<void> {
    if (!COOLDOWN_STATUSES.has(statusCode)) {
      if (statusCode < 400) await this.#store.clear(this.#provider, ref);
      return;
    }
    const states = await this.#store.list(this.#provider);
    const fails = states.find((s) => s.ref === ref)?.consecutiveFails ?? 0;
    await this.#store.penalise(this.#provider, ref, statusCode, new Date(now.getTime() + cooldownMs(statusCode, fails)));
  }
}
