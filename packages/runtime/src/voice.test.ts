import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { speakForTurn } from './voice.ts';
import { limitsFor } from '@lian/domain';

function ports(fail = false) {
  const writes: string[] = [];
  let synthesised = 0;
  let charactersUsed = 0;
  return {
    writes,
    get synthesised() { return synthesised; },
    get charactersUsed() { return charactersUsed; },
    cache: {
      async find() { return null; },
      async put(input: { storageKey: string }) { writes.push(input.storageKey); },
    },
    synthesiser: {
      async synthesise() {
        if (fail) throw new Error('provider blocked this IP');
        synthesised += 1;
        return { storageKey: `audio-${synthesised}`, bytes: 1_000 };
      },
    },
    usage: {
      async reserveCharacters(_u: string, _m: string, ceiling: number, characters: number) {
        if (charactersUsed + characters > ceiling) return false;
        charactersUsed += characters;
        return true;
      },
    },
  };
}

const base = { userId: 'u-1', text: 'I put this into words for you.', voiceId: 'v-1', month: '2026-05' };

describe('§8 persist is derived from the conversation, never passed in', () => {
  test('a normal conversation caches', async () => {
    const p = ports();
    const result = await speakForTurn({ ...base, plan: 'paid', retention: 'persist' }, p);
    assert.equal(result.status, 'ready');
    assert.equal(p.writes.length, 1);
  });

  test('an incognito conversation never caches — and no caller can override it', async () => {
    const p = ports();
    // There is no `persist` parameter on this function.  The only input is
    // the conversation's own retention, which the database CHECK constraint
    // ties to kind='incognito'.
    const result = await speakForTurn({ ...base, plan: 'paid', retention: 'ephemeral' }, p);
    assert.equal(result.status, 'ready');
    assert.deepEqual(p.writes, []);
    assert.equal(p.synthesised, 1, 'she still speaks — the audio simply is not kept');
  });

  test('PRD §10 voice is paid-only, and a free user never costs a synthesis call', async () => {
    const p = ports();
    const result = await speakForTurn({ ...base, plan: 'free', retention: 'persist' }, p);
    assert.equal(result.status, 'not_on_this_plan');
    assert.equal(p.synthesised, 0);
    assert.equal(p.charactersUsed, 0);
  });

  test('§12 the monthly character ceiling comes from the plan, not the caller', async () => {
    const p = ports();
    const long = 'x'.repeat(limitsFor('paid').ttsCharsPerMonth + 1);
    const result = await speakForTurn({ ...base, text: long, plan: 'paid', retention: 'persist' }, p);
    assert.equal(result.status, 'ceiling_reached');
    assert.deepEqual(p.writes, []);
  });

  test('a provider failure falls back to text rather than throwing', async () => {
    const result = await speakForTurn({ ...base, plan: 'paid', retention: 'persist' }, ports(true));
    assert.equal(result.status, 'failed');
  });
});
