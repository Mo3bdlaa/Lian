import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractMemories, extractCanon, titleConversation, MAX_CANDIDATES_PER_EXCHANGE } from './extract.ts';
import { extractJson, parseArray } from './json.ts';
import { ANALYSIS_PROMPTS, MEMORY_EXTRACTION_SYSTEM, CANON_EXTRACTION_SYSTEM } from './prompts.ts';
import { scriptedModel } from './test-fakes.ts';

const EXCHANGE = {
  userMessage: 'My sister Dana moved to Cairo last month and I keep forgetting the time difference.',
  assistantMessage: "That's a two-hour gap — I'll keep it in mind.",
  userMessageId: 'm-user',
  assistantMessageId: 'm-assistant',
};

describe('§1 the non-voice path carries no persona', () => {
  test('the extraction prompts never mention her, her canon, or the relationship', async () => {
    const model = scriptedModel('[]');
    await extractMemories(EXCHANGE, model);
    await extractCanon(EXCHANGE, model);
    for (const call of model.calls) {
      assert.ok(!/You are Lian|You are \{\{name\}\}/.test(call.system), 'no identity');
      assert.ok(!/WHAT YOU HAVE SAID ABOUT YOURSELF|HOW WELL YOU KNOW EACH OTHER/.test(call.system), 'no voice blocks');
    }
  });

  test('every non-voice prompt is declared, so the set stays countable', () => {
    // Adding one is deliberate: it is the whole condition §1 allows this
    // path under, so the list is asserted exactly rather than by count.
    assert.deepEqual([...ANALYSIS_PROMPTS], [
      'memory_extraction', 'canon_extraction', 'conversation_title', 'conversation_summary',
    ]);
  });

  test('the prompts ask for JSON only — no tool-calling is assumed (Q17)', () => {
    for (const system of [MEMORY_EXTRACTION_SYSTEM, CANON_EXTRACTION_SYSTEM]) {
      assert.match(system, /Return ONLY a JSON array/);
      assert.match(system, /An empty array is correct and common/, 'the common case must be the easy one');
    }
  });
});

describe('memory extraction', () => {
  test('valid candidates are typed and attributed to the user message', async () => {
    const model = scriptedModel(JSON.stringify([
      { type: 'person', statement: 'Their sister Dana moved to Cairo.', salience: 0.8 },
      { type: 'fact', statement: 'There is a two-hour time difference with Cairo.', salience: 0.4 },
    ]));
    const result = await extractMemories(EXCHANGE, model);
    assert.equal(result.candidates.length, 2);
    // Q11: direct single-source provenance, and the source is the USER's
    // message — a memory about them attributed to her reply is unshowable.
    assert.ok(result.candidates.every((c) => c.sourceMessageId === 'm-user'));
    assert.equal(result.candidates[0]!.type, 'person');
  });

  test('nothing is extracted without a source message (Q11)', async () => {
    const model = scriptedModel(JSON.stringify([{ type: 'fact', statement: 'Something plausible.', salience: 0.9 }]));
    const result = await extractMemories({ ...EXCHANGE, userMessage: null, userMessageId: null }, model);
    assert.deepEqual(result.candidates, [], 'a memory with no provenance cannot be shown, so it is not kept');
    assert.equal(model.calls.length, 0, 'and the model is not even called');
  });

  test('an empty array is the common case and costs nothing downstream', async () => {
    const result = await extractMemories(EXCHANGE, scriptedModel('[]'));
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.rejected, []);
  });

  test('malformed elements are dropped with a reason, never coerced', async () => {
    const model = scriptedModel(JSON.stringify([
      { type: 'nonsense', statement: 'A statement long enough.', salience: 0.5 },
      { type: 'fact', statement: 'tiny' },
      { type: 'fact', statement: 'A perfectly good statement about them.', salience: 0.5 },
      'not an object',
    ]));
    const result = await extractMemories(EXCHANGE, model);
    assert.equal(result.candidates.length, 1, 'only the valid one survives');
    assert.equal(result.rejected.length, 3);
    assert.match(result.rejected[0]!.reason, /unknown type/);
  });

  test('a missing salience defaults, and an out-of-range one is clamped', async () => {
    const model = scriptedModel(JSON.stringify([
      { type: 'fact', statement: 'No salience given here at all.' },
      { type: 'fact', statement: 'Salience is wildly out of range.', salience: 9 },
    ]));
    const result = await extractMemories(EXCHANGE, model);
    assert.equal(result.candidates[0]!.salience, 0.5);
    assert.equal(result.candidates[1]!.salience, 1);
  });

  test('duplicates within one exchange collapse, and the count is bounded', async () => {
    const model = scriptedModel(JSON.stringify([
      { type: 'fact', statement: 'Their sister is called Dana.', salience: 0.5 },
      { type: 'fact', statement: 'Their sister is called Dana!', salience: 0.5 },
      ...Array.from({ length: 8 }, (_, i) => ({ type: 'topic', statement: `Distinct statement number ${i}.`, salience: 0.3 })),
    ]));
    const result = await extractMemories(EXCHANGE, model);
    assert.equal(result.candidates.length, MAX_CANDIDATES_PER_EXCHANGE, 'a model that starts narrating is capped');
    assert.equal(result.candidates.filter((c) => c.statement.startsWith('Their sister')).length, 1);
  });
});

describe('canon extraction — LESSONS §5', () => {
  test('canon is attributed to HER message, not the user\'s', async () => {
    const model = scriptedModel(JSON.stringify([{ category: 'self', statement: 'You find late nights easier for thinking.' }]));
    const result = await extractCanon(EXCHANGE, model);
    assert.equal(result.candidates[0]!.sourceMessageId, 'm-assistant');
  });

  test('only her own message is shown to the extractor', async () => {
    const model = scriptedModel('[]');
    await extractCanon(EXCHANGE, model);
    assert.equal(model.calls[0]!.user, EXCHANGE.assistantMessage, 'canon is what SHE said, so the user turn is not even sent');
  });

  test('an unknown category is rejected — canon can never be contradicted, so a false positive is expensive', async () => {
    const model = scriptedModel(JSON.stringify([{ category: 'vibe', statement: 'A statement long enough to pass.' }]));
    const result = await extractCanon(EXCHANGE, model);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.rejected.length, 1);
  });
});

describe('tolerant JSON parsing (Q17: no tool-calling assumed)', () => {
  test('survives a code fence, a preamble, and a bare object', () => {
    assert.deepEqual(extractJson('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
    assert.deepEqual(extractJson('Here is the JSON:\n[{"a":1}]'), [{ a: 1 }]);
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  });

  test('a single object where an array was asked for is still one candidate', async () => {
    const model = scriptedModel('{"type":"fact","statement":"A single object came back.","salience":0.5}');
    const result = await extractMemories(EXCHANGE, model);
    assert.equal(result.candidates.length, 1);
  });

  test('unparseable output is reported, not thrown', () => {
    const result = parseArray('I could not do that.', () => 'unused');
    assert.deepEqual(result.values, []);
    assert.match(result.rejected[0]!.reason, /no JSON found/);
  });
});

describe('conversation titling', () => {
  test('strips quotes and trailing punctuation', async () => {
    assert.equal(await titleConversation(['a'], scriptedModel('"Apartment viewing in Marina."')), 'Apartment viewing in Marina');
  });

  test('an over-long or empty title is refused rather than truncated', async () => {
    assert.equal(await titleConversation(['a'], scriptedModel('x'.repeat(80))), null);
    assert.equal(await titleConversation(['a'], scriptedModel('   ')), null);
    assert.equal(await titleConversation([], scriptedModel('anything')), null);
  });
});
