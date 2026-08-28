// The two rules in retry.ts, as tests rather than as comments.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { retrying, ProviderSilenceError } from './retry.ts';
import { ProviderError, type CompletionResult, type Provider } from './provider.ts';

const USAGE: CompletionResult = {
  usage: { inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 },
  stopReason: 'end_turn',
};

const CAPABILITIES = { streaming: true, toolCalling: false, vision: false, contextTokens: 1_000, maxOutputTokens: 100 };

/** A provider driven by a script of per-attempt behaviours. */
function scripted(script: ((onDelta: (d: string) => void) => Promise<CompletionResult>)[]): Provider & { calls: number } {
  const state = { calls: 0 };
  return {
    get calls() { return state.calls; },
    id: 'scripted',
    capabilities: () => CAPABILITIES,
    async stream(_request, onDelta) {
      const step = script[Math.min(state.calls, script.length - 1)]!;
      state.calls += 1;
      return step(onDelta);
    },
  };
}

const REQUEST = {
  model: 'm', system: [], messages: [{ role: 'user' as const, content: 'hi' }],
  cacheHistory: false, maxOutputTokens: 100, effort: 'low' as const,
};

/** No real waiting: every backoff resolves at once and is recorded. */
function instant(): { sleep: (ms: number) => Promise<void>; waits: number[] } {
  const waits: number[] = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
}

describe('retrying', () => {
  test('a retryable failure before the first delta is retried, and the answer is whole', async () => {
    const { sleep, waits } = instant();
    const inner = scripted([
      async () => { throw new ProviderError('upstream fell over', 500, true); },
      async () => { throw new ProviderError('again', 503, true); },
      async (onDelta) => { onDelta('there you are'); return USAGE; },
    ]);

    const text: string[] = [];
    const result = await retrying(inner, { attempts: 3, baseDelayMs: 100, sleep }).stream(REQUEST, (d) => text.push(d));

    assert.equal(inner.calls, 3);
    assert.equal(text.join(''), 'there you are');
    assert.equal(result.stopReason, 'end_turn');
    // Two backoffs, each drawn from a doubling ceiling. Full jitter means the
    // value is random, so the CEILING is what is asserted.
    assert.equal(waits.length, 2);
    assert.ok(waits[0]! <= 100, `first backoff ${waits[0]} exceeded its ceiling`);
    assert.ok(waits[1]! <= 200, `second backoff ${waits[1]} exceeded its ceiling`);
  });

  test('RULE 1: a failure AFTER text has been emitted is never retried', async () => {
    const { sleep } = instant();
    const inner = scripted([
      async (onDelta) => { onDelta('I was thinking about'); throw new ProviderError('died mid-sentence', 500, true); },
      async (onDelta) => { onDelta('A COMPLETELY SECOND ANSWER'); return USAGE; },
    ]);

    const text: string[] = [];
    await assert.rejects(
      () => retrying(inner, { attempts: 3, baseDelayMs: 1, sleep }).stream(REQUEST, (d) => text.push(d)),
      /died mid-sentence/,
    );

    // The point of the rule: one attempt, and the caller keeps the half it
    // got rather than half plus a whole.
    assert.equal(inner.calls, 1);
    assert.equal(text.join(''), 'I was thinking about');
  });

  test('a non-retryable status is not retried — the same bad request costs the same 400 twice', async () => {
    const { sleep } = instant();
    const inner = scripted([async () => { throw new ProviderError('max_tokens is too large', 400, false); }]);

    await assert.rejects(
      () => retrying(inner, { attempts: 4, baseDelayMs: 1, sleep }).stream(REQUEST, () => {}),
      /max_tokens/,
    );
    assert.equal(inner.calls, 1);
  });

  test('attempts are bounded — an always-failing provider refuses rather than looping', async () => {
    const { sleep, waits } = instant();
    const inner = scripted([async () => { throw new ProviderError('down', 500, true); }]);

    await assert.rejects(() => retrying(inner, { attempts: 3, baseDelayMs: 1, sleep }).stream(REQUEST, () => {}), /down/);
    assert.equal(inner.calls, 3);
    assert.equal(waits.length, 2);
  });

  test('RULE 2: a stream that goes silent is abandoned, not awaited forever', async () => {
    const { sleep } = instant();
    // The shape that has no error and no end: the promise simply never
    // settles. Without a deadline this test would hang, which is exactly what
    // the product did.
    let aborted = false;
    const inner: Provider = {
      id: 'mute',
      capabilities: () => CAPABILITIES,
      stream(request) {
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
        });
      },
    };

    // One attempt, so the assertion is about the deadline rather than retries.
    await assert.rejects(
      () => retrying(inner, { attempts: 1, silenceMs: 20, sleep }).stream(REQUEST, () => {}),
      (error: unknown) => error instanceof ProviderSilenceError,
    );
    assert.equal(aborted, true, 'the attempt was abandoned but the provider was never told');
  });

  test('the deadline is measured from the last delta, so a long answer is not cut off', async () => {
    const { sleep } = instant();
    // Six deltas, each 15ms apart, against a 40ms silence budget. The whole
    // call takes 90ms — more than twice the deadline — and must survive,
    // because she was talking the entire time.
    const inner: Provider = {
      id: 'slow-but-alive',
      capabilities: () => CAPABILITIES,
      async stream(_request, onDelta) {
        for (let i = 0; i < 6; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 15));
          onDelta('word ');
        }
        return USAGE;
      },
    };

    const text: string[] = [];
    const result = await retrying(inner, { attempts: 1, silenceMs: 40, sleep }).stream(REQUEST, (d) => text.push(d));
    assert.equal(text.length, 6);
    assert.equal(result.stopReason, 'end_turn');
  });

  test('a silence before the first delta IS retried — nothing was on the screen', async () => {
    const { sleep } = instant();
    let call = 0;
    const inner: Provider = {
      id: 'mute-once',
      capabilities: () => CAPABILITIES,
      async stream(request, onDelta) {
        call += 1;
        if (call === 1) {
          return new Promise((_resolve, reject) => {
            request.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        onDelta('sorry, I am here');
        return USAGE;
      },
    };

    const text: string[] = [];
    await retrying(inner, { attempts: 2, baseDelayMs: 1, silenceMs: 20, sleep }).stream(REQUEST, (d) => text.push(d));
    assert.equal(call, 2);
    assert.equal(text.join(''), 'sorry, I am here');
  });

  test("the caller's own cancellation is not a failure to retry past", async () => {
    const { sleep } = instant();
    const controller = new AbortController();
    const inner: Provider = {
      id: 'waits',
      capabilities: () => CAPABILITIES,
      stream(request) {
        return new Promise((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new Error('caller went away')));
        });
      },
    };

    const promise = retrying(inner, { attempts: 3, baseDelayMs: 1, silenceMs: 5_000, sleep })
      .stream({ ...REQUEST, signal: controller.signal }, () => {});
    controller.abort();
    await assert.rejects(() => promise, /caller went away/);
  });

  test('capabilities do not go through the retry path — they must not be able to fail', () => {
    const inner = scripted([async () => USAGE]);
    assert.equal(retrying(inner).capabilities('m').contextTokens, 1_000);
    assert.equal(inner.calls, 0);
  });
});
