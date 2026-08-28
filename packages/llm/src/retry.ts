// Retry, backoff and a deadline, in front of any provider.
//
// The pool (pooled.ts) already rotates KEYS on a cooldown status, which is
// the right answer when a second key exists. This is the other half, and the
// one that actually matters for a deployment with one key: a 500, a reset
// socket, or a provider that accepts the request and then stops talking.
//
// TWO RULES DECIDE EVERYTHING HERE.
//
//   1. A RETRY IS ONLY SAFE BEFORE THE FIRST DELTA. Once text has been
//      written to the caller's sink it is on the screen, and a second attempt
//      appends a whole second answer to the first half of one. So the moment
//      `onDelta` fires, this wrapper stops being a retrier and becomes a
//      plain pass-through. That is not a limitation to work around — a
//      half-sentence followed by a fresh reply is worse than one failure.
//
//   2. A STREAM THAT STOPS IS NOT A STREAM THAT FAILED. A provider that dies
//      between the first token and the last leaves a promise that never
//      settles, and nothing above notices: no error, no timeout, no end. That
//      is the spinner-forever case, and it is the reason the deadline is
//      measured from the LAST DELTA rather than from the start of the call.
//      A long answer is allowed to take a long time; a silent one is not.
import { ProviderError, type CompletionRequest, type CompletionResult, type Provider } from './provider.ts';
import type { ModelCapabilities } from './catalogue.ts';

export type RetryOptions = {
  /** Total attempts, including the first. 3 means two retries. */
  readonly attempts?: number;
  /** First backoff, doubled each attempt. */
  readonly baseDelayMs?: number;
  /**
   * How long the provider may be silent before the attempt is abandoned.
   *
   * ASSUMPTION, stated because the number is a judgement: 45 seconds between
   * deltas. Anthropic's own client defaults to a 10-minute whole-request
   * timeout, which is the right order for a batch job and far too long for
   * somebody watching three dots. The PROVIDER's own latency is deliberately
   * not measured in docs/PERFORMANCE.md — there is no key in this environment
   * — so this is a judgement against the published one-to-two-second
   * time-to-first-token for this model family rather than against a number of
   * ours: long enough that a slow provider is not cut off, short enough that
   * a dead one becomes a sentence she says while the person is still looking
   * at the screen. When a key exists, measure and revisit.
   */
  readonly silenceMs?: number;
  /**
   * Statuses this wrapper must NOT retry because a layer above it handles
   * them better.
   *
   * It exists for one composition: `pooledProvider(pool, key =>
   * retrying(anthropicProvider(key)))`. Retrying belongs INSIDE the pool, so
   * a 500 is retried on the key that is already warm rather than spending a
   * second key on it. But a 401, 403 or 429 is a statement about THE KEY, and
   * the useful response is another key, not the same one half a second later
   * — so those go straight up to the pool untouched (COOLDOWN_STATUSES).
   */
  readonly skipStatuses?: ReadonlySet<number>;
  /** Injected so a test does not spend its own backoff. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injected for the same reason: the deadline is wall-clock. */
  readonly setTimer?: (fn: () => void, ms: number) => { cancel(): void };
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const defaultTimer = (fn: () => void, ms: number): { cancel(): void } => {
  const handle = setTimeout(fn, ms);
  // NOT unref'd. An unref'd deadline is not a deadline: the loop empties
  // while the provider is silent and the process exits before the timer
  // fires — which is precisely the hang it exists to prevent. It is cancelled
  // on every path in stream(), so it holds the loop open for at most
  // silenceMs and only while a call is genuinely in flight.
  return { cancel: () => clearTimeout(handle) };
};

/** Raised when a stream goes silent. Retryable, because nothing was said. */
export class ProviderSilenceError extends ProviderError {
  constructor(ms: number) {
    super(`the provider stopped sending for ${ms}ms`, 504, true);
    this.name = 'ProviderSilenceError';
  }
}

export function retrying(inner: Provider, options: RetryOptions = {}): Provider {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const silenceMs = options.silenceMs ?? 45_000;
  const skipStatuses = options.skipStatuses ?? new Set<number>();
  const sleep = options.sleep ?? defaultSleep;
  const setTimer = options.setTimer ?? defaultTimer;

  return {
    id: `retrying(${inner.id})`,
    capabilities(model: string): ModelCapabilities {
      return inner.capabilities(model);
    },

    async stream(request: CompletionRequest, onDelta: (delta: string) => void): Promise<CompletionResult> {
      let emitted = false;
      let last: unknown = null;

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        // One controller per attempt. The caller may also have passed a
        // signal — theirs aborts everything, ours aborts this attempt.
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        request.signal?.addEventListener('abort', abort, { once: true });

        let silent = false;
        let timer = setTimer(() => { silent = true; controller.abort(); }, silenceMs);
        const restart = (): void => {
          timer.cancel();
          timer = setTimer(() => { silent = true; controller.abort(); }, silenceMs);
        };

        try {
          const result = await inner.stream(
            { ...request, signal: controller.signal },
            (delta) => { emitted = true; restart(); onDelta(delta); },
          );
          return result;
        } catch (error) {
          // Our own deadline, not the provider's error. Named, so a log says
          // "stopped sending" rather than "aborted".
          last = silent ? new ProviderSilenceError(silenceMs) : error;

          // The caller cancelled — that is not a failure to retry past.
          if (request.signal?.aborted === true) throw last;

          // RULE 1. Text is on the screen; a second attempt would double it.
          if (emitted) throw last;

          const retryable = last instanceof ProviderError
            && last.retryable
            && !skipStatuses.has(last.statusCode);
          if (!retryable || attempt === attempts) throw last;

          // Full jitter (AWS's "Exponential Backoff and Jitter"): a fixed
          // delay synchronises every caller that failed on the same provider
          // blip into one retry spike, which is how a recovering service is
          // knocked over a second time.
          const ceiling = baseDelayMs * 2 ** (attempt - 1);
          await sleep(Math.round(Math.random() * ceiling));
        } finally {
          timer.cancel();
          request.signal?.removeEventListener('abort', abort);
        }
      }

      /* c8 ignore next -- the loop returns or throws; this is the type's tail */
      throw last;
    },
  };
}
